import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { isMainThread } from 'worker_threads';
import Redis from 'ioredis';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, '../data/proxy.db');

// ---- Optional Redis-backed shared state (for horizontal scaling) ----
// When REDIS_URL is set, Redis is the cross-instance source of truth: every
// write is mirrored to Redis (per-entity HSET/HDEL + a version counter), and a
// poll materializes the full Redis snapshot into this local SQLite cache — which
// the existing proxy (10s) and script-loader (5s) pollers then pick up.
// When REDIS_URL is absent/unreachable, flux behaves exactly as before (SQLite
// only). Only the main thread owns Redis, so the proxy-worker thread's singleton
// stays a pure local reader.
const REDIS_URL = process.env.REDIS_URL;
const REDIS_PREFIX = process.env.REDIS_KEY_PREFIX || 'flux:';
const REDIS_POLL_MS = parseInt(process.env.REDIS_POLL_MS || '3000', 10);
const RK = {
    targets: `${REDIS_PREFIX}targets`,
    scripts: `${REDIS_PREFIX}scripts`,
    config: `${REDIS_PREFIX}config`,
    version: `${REDIS_PREFIX}version`,
};

class DatabaseService {
    constructor() {
        // Redis state defaults must exist before any write path runs
        this._redis = null;
        this._redisEnabled = false;
        this._materializing = false;      // true only during the local replace txn (suppresses write-through)
        this._materializeInFlight = false; // reentrancy guard for the async poll
        this._lastSeenVersion = null;      // opaque per-write token; null = never synced
        this._lastRedisErrLog = 0;

        this.db = new Database(DB_PATH);
        this.db.pragma('journal_mode = WAL'); // Better concurrent performance
        this.init();
        this._initRedis();
    }

    /**
     * Initialize database schema
     */
    init() {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS targets (
                id TEXT PRIMARY KEY,
                nickname TEXT NOT NULL,
                base_url TEXT NOT NULL,
                tags TEXT,
                metadata TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS scripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                content TEXT NOT NULL,
                description TEXT,
                tags TEXT,
                path_pattern TEXT,
                response_strategy TEXT DEFAULT 'first',
                response_target_id TEXT,
                response_mock TEXT,
                response_mock_force INTEGER DEFAULT 0,
                response_enabled INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS config (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_targets_tags ON targets(tags);
            CREATE INDEX IF NOT EXISTS idx_scripts_name ON scripts(name);
            CREATE INDEX IF NOT EXISTS idx_scripts_tags ON scripts(tags);
        `);

        // Migration: Add missing columns if they don't exist
        try {
            const columns = this.db.pragma('table_info(scripts)');
            const columnNames = columns.map(c => c.name);
            
            if (!columnNames.includes('response_strategy')) {
                logger.info('Migrating database: Adding response_strategy column');
                this.db.exec("ALTER TABLE scripts ADD COLUMN response_strategy TEXT DEFAULT 'first'");
            }
            if (!columnNames.includes('response_target_id')) {
                logger.info('Migrating database: Adding response_target_id column');
                this.db.exec("ALTER TABLE scripts ADD COLUMN response_target_id TEXT");
            }
            if (!columnNames.includes('response_mock')) {
                logger.info('Migrating database: Adding response_mock column');
                this.db.exec("ALTER TABLE scripts ADD COLUMN response_mock TEXT");
            }
            if (!columnNames.includes('response_mock_force')) {
                logger.info('Migrating database: Adding response_mock_force column');
                this.db.exec("ALTER TABLE scripts ADD COLUMN response_mock_force INTEGER NOT NULL DEFAULT 0");
            }
            if (!columnNames.includes('response_enabled')) {
                logger.info('Migrating database: Adding response_enabled column');
                this.db.exec("ALTER TABLE scripts ADD COLUMN response_enabled INTEGER DEFAULT 0");
            }
        } catch (err) {
            logger.error(`Database migration failed: ${err.message}`);
        }

        logger.info('✓ Database initialized');
    }

    // ==================== TARGETS ====================

    /**
     * Get all targets
     */
    getAllTargets() {
        const stmt = this.db.prepare('SELECT * FROM targets ORDER BY created_at DESC');
        const rows = stmt.all();

        return rows.map(row => ({
            id: row.id,
            nickname: row.nickname,
            baseUrl: row.base_url,
            tags: JSON.parse(row.tags || '[]'),
            metadata: JSON.parse(row.metadata || '{}'),
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    }

    /**
     * Get target by ID
     */
    getTarget(id) {
        const stmt = this.db.prepare('SELECT * FROM targets WHERE id = ?');
        const row = stmt.get(id);

        if (!row) return null;

        return {
            id: row.id,
            nickname: row.nickname,
            baseUrl: row.base_url,
            tags: JSON.parse(row.tags || '[]'),
            metadata: JSON.parse(row.metadata || '{}'),
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    /**
     * Create new target
     */
    createTarget(data) {
        const stmt = this.db.prepare(`
            INSERT INTO targets (id, nickname, base_url, tags, metadata)
            VALUES (?, ?, ?, ?, ?)
        `);

        stmt.run(
            data.id,
            data.nickname,
            data.baseUrl,
            JSON.stringify(data.tags || []),
            JSON.stringify(data.metadata || {})
        );

        this._syncUpsert(RK.targets, data.id, () => this.getTarget(data.id));
        return this.getTarget(data.id);
    }

    /**
     * Update existing target
     */
    updateTarget(id, data) {
        const stmt = this.db.prepare(`
            UPDATE targets 
            SET nickname = ?, base_url = ?, tags = ?, metadata = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);

        stmt.run(
            data.nickname,
            data.baseUrl,
            JSON.stringify(data.tags || []),
            JSON.stringify(data.metadata || {}),
            id
        );

        this._syncUpsert(RK.targets, id, () => this.getTarget(id));
        return this.getTarget(id);
    }

    /**
     * Delete target
     */
    deleteTarget(id) {
        const stmt = this.db.prepare('DELETE FROM targets WHERE id = ?');
        const result = stmt.run(id);
        if (result.changes > 0) this._syncDelete(RK.targets, id);
        return result.changes > 0;
    }

    // ==================== SCRIPTS ====================

    /**
     * Get all scripts
     */
    getAllScripts() {
        const stmt = this.db.prepare('SELECT * FROM scripts ORDER BY name ASC');
        const rows = stmt.all();

        return rows.map(row => ({
            id: row.id,
            name: row.name,
            content: row.content,
            description: row.description || '',
            tags: JSON.parse(row.tags || '[]'),
            pathPattern: row.path_pattern || '',
            responseConfig: {
                strategy: row.response_strategy || 'first',
                targetId: row.response_target_id || null,
                mockResponse: row.response_mock ? JSON.parse(row.response_mock) : null,
                mockForce: row.response_mock_force === 1,
                enabled: row.response_enabled === 1
            },
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));
    }

    /**
     * Get script by name
     */
    getScript(name) {
        const stmt = this.db.prepare('SELECT * FROM scripts WHERE name = ?');
        const row = stmt.get(name);

        if (!row) return null;

        return {
            id: row.id,
            name: row.name,
            content: row.content,
            description: row.description || '',
            tags: JSON.parse(row.tags || '[]'),
            pathPattern: row.path_pattern || '',
            responseConfig: {
                strategy: row.response_strategy || 'first',
                targetId: row.response_target_id || null,
                mockResponse: row.response_mock ? JSON.parse(row.response_mock) : null,
                mockForce: row.response_mock_force === 1,
                enabled: row.response_enabled === 1
            },
            createdAt: row.created_at,
            updatedAt: row.updated_at
        };
    }

    /**
     * Create new script
     */
    createScript(data) {
        const stmt = this.db.prepare(`
            INSERT INTO scripts (name, content, description, tags, path_pattern, response_strategy, response_target_id, response_mock, response_mock_force, response_enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const responseConfig = data.responseConfig || {};
        stmt.run(
            data.name,
            data.content,
            data.description || '',
            JSON.stringify(data.tags || []),
            data.pathPattern || '',
            responseConfig.strategy || 'first',
            responseConfig.targetId || null,
            responseConfig.mockResponse ? JSON.stringify(responseConfig.mockResponse) : null,
            responseConfig.mockForce === true ? 1 : 0,
            responseConfig.enabled ? 1 : 0
        );

        this._syncUpsert(RK.scripts, data.name, () => this.getScript(data.name));
        return this.getScript(data.name);
    }

    /**
     * Update existing script
     */
    updateScript(name, data) {
        const stmt = this.db.prepare(`
            UPDATE scripts 
            SET content = ?, description = ?, tags = ?, path_pattern = ?, 
                response_strategy = ?, response_target_id = ?, response_mock = ?, response_mock_force = ?, response_enabled = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE name = ?
        `);

        const responseConfig = data.responseConfig || {};
        stmt.run(
            data.content,
            data.description || '',
            JSON.stringify(data.tags || []),
            data.pathPattern || '',
            responseConfig.strategy || 'first',
            responseConfig.targetId || null,
            responseConfig.mockResponse ? JSON.stringify(responseConfig.mockResponse) : null,
            responseConfig.mockForce === true ? 1 : 0,
            responseConfig.enabled ? 1 : 0,
            name
        );

        this._syncUpsert(RK.scripts, name, () => this.getScript(name));
        return this.getScript(name);
    }

    /**
     * Delete script
     */
    deleteScript(name) {
        const stmt = this.db.prepare('DELETE FROM scripts WHERE name = ?');
        const result = stmt.run(name);
        if (result.changes > 0) this._syncDelete(RK.scripts, name);
        return result.changes > 0;
    }

    /**
     * Get scripts by tags (for filtering)
     */
    getScriptsByTags(targetTags = []) {
        const allScripts = this.getAllScripts();

        if (!targetTags || targetTags.length === 0) {
            return allScripts;
        }

        return allScripts.filter(script => {
            if (!script.tags || script.tags.length === 0) {
                // Script has no tags, run for all targets
                return true;
            }

            // Check if any script tag matches any target tag
            return script.tags.some(tag => targetTags.includes(tag));
        });
    }

    // ==================== CONFIG ====================

    /**
     * Get config value
     */
    getConfig(key) {
        const stmt = this.db.prepare('SELECT value FROM config WHERE key = ?');
        const row = stmt.get(key);
        return row ? JSON.parse(row.value) : null;
    }

    /**
     * Set config value
     */
    setConfig(key, value) {
        const stmt = this.db.prepare(`
            INSERT INTO config (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = CURRENT_TIMESTAMP
        `);

        stmt.run(key, JSON.stringify(value), JSON.stringify(value));
        this._syncUpsert(RK.config, key, () => this.getConfig(key));
        return value;
    }

    /**
     * Get all config
     */
    getAllConfig() {
        const stmt = this.db.prepare('SELECT * FROM config');
        const rows = stmt.all();

        const config = {};
        for (const row of rows) {
            config[row.key] = JSON.parse(row.value);
        }
        return config;
    }

    // ==================== REDIS SHARED STATE ====================

    /**
     * Connect to Redis (main thread only) and start the materialize poll.
     * Any failure leaves flux running purely on local SQLite.
     */
    _initRedis() {
        if (!REDIS_URL || !isMainThread) return; // proxy-worker thread & no-redis => SQLite-only

        try {
            this._redis = new Redis(REDIS_URL, {
                maxRetriesPerRequest: 2,
                enableOfflineQueue: false, // fail fast instead of buffering when down (fail-safe)
                retryStrategy: (times) => Math.min(times * 200, 5000),
            });
            this._redisEnabled = true;

            this._redis.on('error', (err) => this._logRedisError(err));
            this._redis.on('ready', () => {
                logger.info('[Redis] Connected — flux running in shared-state mode');
                // boot seed: pull the current snapshot before serving stale/empty data
                this._materialize().catch((e) => logger.error('[Redis] boot materialize failed:', e?.message));
            });

            setInterval(() => {
                this._materialize().catch(() => {});
            }, REDIS_POLL_MS);

            logger.info(`[Redis] shared-state enabled (poll ${REDIS_POLL_MS}ms, prefix "${REDIS_PREFIX}")`);
        } catch (err) {
            logger.error('[Redis] init failed, continuing on local SQLite only:', err?.message);
            this._redisEnabled = false;
            this._redis = null;
        }
    }

    _logRedisError(err) {
        const now = Date.now();
        if (now - this._lastRedisErrLog > 30000) {
            this._lastRedisErrLog = now;
            logger.error('[Redis] error (serving from local cache):', err?.message || err);
        }
    }

    /** Fire-and-forget a Redis mutation; failures never break the local write. */
    _redisSafe(fn) {
        if (!this._redisEnabled || !this._redis || this._materializing) return;
        Promise.resolve().then(fn).catch((err) => this._logRedisError(err));
    }

    /**
     * A unique per-write token. Materialization keys off "token differs from
     * last seen" rather than a monotonic counter, so it stays correct even if
     * Redis is flushed/reset (a monotonic INCR would restart low and collide
     * with a version a pod had already seen, silently skipping the change).
     */
    _newToken() {
        return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }

    /**
     * Mirror one entity to a Redis hash and stamp a new version token.
     * We deliberately do NOT advance _lastSeenVersion here: the writing pod
     * re-materializes on its next poll so it also picks up any concurrent
     * change another pod landed in the hash (control-panel's multi-call saves
     * fan out across pods via the Service LB). Materialize is the sole owner of
     * _lastSeenVersion. The local write already happened, so the writer never
     * loses its own change in the meantime.
     */
    _syncUpsert(hashKey, field, getObj) {
        this._redisSafe(async () => {
            const obj = getObj();
            if (obj == null) return;
            await this._redis.hset(hashKey, String(field), JSON.stringify(obj));
            await this._redis.set(RK.version, this._newToken());
        });
    }

    /** Remove one entity from a Redis hash and stamp a new version token. */
    _syncDelete(hashKey, field) {
        this._redisSafe(async () => {
            await this._redis.hdel(hashKey, String(field));
            await this._redis.set(RK.version, this._newToken());
        });
    }

    /**
     * Pull the full snapshot from Redis and replace the local cache — but ONLY
     * against a complete, validated snapshot. If the version key is missing
     * (Redis empty/never populated) or ANY read/parse fails, we abort without
     * touching the local tables, so a Redis hiccup can never blank a live pod.
     */
    async _materialize() {
        if (!this._redisEnabled || !this._redis || this._materializeInFlight) return;
        this._materializeInFlight = true;
        try {
            let version, targetsH, scriptsH, configH;
            try {
                version = await this._redis.get(RK.version);
                if (version === null) return;            // Redis empty/wiped — keep local (fail-safe)
                if (version === this._lastSeenVersion) return; // token unchanged — nothing new
                // fetch EVERYTHING before touching local state
                [targetsH, scriptsH, configH] = await Promise.all([
                    this._redis.hgetall(RK.targets),
                    this._redis.hgetall(RK.scripts),
                    this._redis.hgetall(RK.config),
                ]);
            } catch (err) {
                this._logRedisError(err);
                return; // read failed — DO NOT touch local state
            }

            // parse the whole snapshot in memory; any parse error aborts cleanly
            let targets, scripts, config;
            try {
                targets = Object.values(targetsH || {}).map((s) => JSON.parse(s));
                scripts = Object.values(scriptsH || {}).map((s) => JSON.parse(s));
                config = Object.fromEntries(Object.entries(configH || {}).map(([k, v]) => [k, JSON.parse(v)]));
            } catch (err) {
                logger.error('[Redis] snapshot parse failed, keeping local state:', err?.message);
                return;
            }

            // atomic local replace (readers see old-or-new, never partial)
            try {
                this._materializing = true;
                const apply = this.db.transaction(() => {
                    this.db.exec('DELETE FROM targets; DELETE FROM scripts; DELETE FROM config;');
                    for (const t of targets) this.createTarget(t);
                    for (const s of scripts) this.createScript(s);
                    for (const [k, v] of Object.entries(config)) this.setConfig(k, v);
                });
                apply();
                this._lastSeenVersion = version;
                logger.info(`[Redis] synced local cache (${version}): ${targets.length} targets, ${scripts.length} scripts`);
            } catch (err) {
                logger.error('[Redis] materialize transaction failed, local state unchanged:', err?.message);
            } finally {
                this._materializing = false;
            }
        } finally {
            this._materializeInFlight = false;
        }
    }

    /**
     * Close database connection
     */
    close() {
        if (this._redis) {
            try { this._redis.disconnect(); } catch { /* ignore */ }
        }
        this.db.close();
    }
}

// Export singleton instance
export default new DatabaseService();
