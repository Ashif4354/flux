import scriptLoader from './script-loader.js';
import logger from './logger.js';

function parseBody(body, contentType) {
    if (!body) return { body, wasParsed: false, isNdjson: false };

    const type = contentType || '';
    const isJson = type.includes('application/json');
    const isNdjson = type.includes('application/x-ndjson') || type.includes('ndjson') || type.includes('application/logplex-1');

    if (isJson) {
        try {
            const parsed = typeof body === 'string' ? JSON.parse(body) : JSON.parse(JSON.stringify(body));
            return { body: parsed, wasParsed: true, isNdjson: false };
        } catch (e) {
            logger.warn(`Failed to parse JSON body: ${e.message}`);
        }
    } else if (isNdjson && typeof body === 'string') {
        try {
            const lines = body.split('\n').map(line => line.trim()).filter(Boolean);
            const parsed = lines.map(line => JSON.parse(line));
            return { body: parsed, wasParsed: true, isNdjson: true };
        } catch (e) {
            logger.warn(`Failed to parse NDJSON body: ${e.message}`);
        }
    }
    return { body, wasParsed: false, isNdjson: false };
}

function serializeBody(body, wasParsed, isNdjson) {
    if (!wasParsed) return body;
    if (isNdjson && Array.isArray(body)) {
        return body.map(obj => JSON.stringify(obj)).join('\n') + '\n';
    }
    return body;
}

class TransformationEngine {
    /**
     * Apply all transformations to the request
     * @param {Object} request - Original request
     * @param {string} scriptName - Optional script name
     * @param {Object} targetMetadata - Target-specific metadata (e.g., licenseKey)
     */
    async transform(request, scriptName = null, targetMetadata = {}) {
        const contentType = request.headers['content-type'] || '';
        const { body: parsedBody, wasParsed, isNdjson } = parseBody(request.body, contentType);

        const result = {
            headers: { ...request.headers },
            params: { ...request.params },
            body: parsedBody
        };

        // If no script specified, try to use first available or skip
        let script;
        if (scriptName) {
            script = scriptLoader.getScript(scriptName);
            if (!script) {
                logger.warn(`Script "${scriptName}" not found, skipping transformations`);
                return result;
            }
        } else {
            const scripts = scriptLoader.getAllScripts();

            for (const name of scripts) {
                script = scriptLoader.getScript(name);
                logger.debug(`Using script: ${name}`);
                break;
            }

            if (!script) {
                logger.debug('No matching transformation script found for this path');
                return result;
            }
        }

        // Apply transformations safely
        try {
            if (typeof script.transformHeaders === 'function') {
                result.headers = await this.safeExecute(
                    script.transformHeaders,
                    result.headers,
                    'transformHeaders',
                    targetMetadata
                );
            }

            if (typeof script.transformParams === 'function') {
                result.params = await this.safeExecute(
                    script.transformParams,
                    result.params,
                    'transformParams',
                    targetMetadata
                );
            }

            if (typeof script.transformBody === 'function' && result.body !== null) {
                if (isNdjson && Array.isArray(result.body)) {
                    result.body = await Promise.all(
                        result.body.map(obj => this.safeExecute(
                            script.transformBody,
                            obj,
                            'transformBody',
                            targetMetadata
                        ))
                    );
                } else {
                    result.body = await this.safeExecute(
                        script.transformBody,
                        result.body,
                        'transformBody',
                        targetMetadata
                    );
                }
            }
        } catch (err) {
            logger.error('Transformation error:', err);
            throw err;
        }

        result.body = serializeBody(result.body, wasParsed, isNdjson);
        return result;
    }

    /**
     * Safely execute a transformation function
     */
    async safeExecute(fn, data, fnName, metadata = {}) {
        try {
            return await fn(data, metadata);
        } catch (err) {
            logger.error(`Error in ${fnName}:`, err.message);
            // Return original data on error
            return data;
        }
    }

    /**
     * Test transformation with sample data (for preview)
     */
    async preview(scriptName, sampleData) {
        const script = scriptLoader.getScript(scriptName);
        if (!script) {
            throw new Error(`Script "${scriptName}" not found`);
        }

        const contentType = sampleData.headers?.['content-type'] || sampleData.headers?.['Content-Type'] || '';
        const { body: parsedBody, wasParsed, isNdjson } = parseBody(sampleData.body, contentType);

        const result = {
            headers: sampleData.headers || {},
            params: sampleData.params || {},
            body: parsedBody
        };

        const transformations = {
            headers: { applied: false, result: result.headers },
            params: { applied: false, result: result.params },
            body: { applied: false, result: result.body }
        };

        // Apply each transformation
        if (typeof script.transformHeaders === 'function') {
            transformations.headers.result = await this.safeExecute(
                script.transformHeaders,
                result.headers,
                'transformHeaders'
            );
            transformations.headers.applied = true;
        }

        if (typeof script.transformParams === 'function') {
            transformations.params.result = await this.safeExecute(
                script.transformParams,
                result.params,
                'transformParams'
            );
            transformations.params.applied = true;
        }

        if (typeof script.transformBody === 'function' && result.body !== null) {
            let transformedBody;
            if (isNdjson && Array.isArray(result.body)) {
                transformedBody = await Promise.all(
                    result.body.map(obj => this.safeExecute(
                        script.transformBody,
                        obj,
                        'transformBody'
                    ))
                );
            } else {
                transformedBody = await this.safeExecute(
                    script.transformBody,
                    result.body,
                    'transformBody'
                );
            }
            transformations.body.result = serializeBody(transformedBody, wasParsed, isNdjson);
            transformations.body.applied = true;
        }

        return {
            original: sampleData,
            transformed: {
                headers: transformations.headers.result,
                params: transformations.params.result,
                body: transformations.body.result
            },
            applied: {
                transformHeaders: transformations.headers.applied,
                transformParams: transformations.params.applied,
                transformBody: transformations.body.applied
            }
        };
    }
}

export default new TransformationEngine();
