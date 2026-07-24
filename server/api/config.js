import express from 'express';
import db from '../lib/database.js';
import logger from '../lib/logger.js';

const router = express.Router();

/**
 * Get global proxy configuration
 */
router.get('/api/config', async (req, res) => {
    try {
        const requireScriptMatch = db.getConfig('requireScriptMatch') === true;
        res.json({
            requireScriptMatch
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Update global proxy configuration
 */
router.put('/api/config', async (req, res) => {
    try {
        const { requireScriptMatch } = req.body;

        if (requireScriptMatch !== undefined) {
            db.setConfig('requireScriptMatch', requireScriptMatch === true);
            logger.info(`[API] Configuration updated: requireScriptMatch = ${requireScriptMatch === true}`);
        }

        res.json({
            success: true,
            message: 'Configuration updated successfully',
            config: {
                requireScriptMatch: db.getConfig('requireScriptMatch') === true
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

export default router;
