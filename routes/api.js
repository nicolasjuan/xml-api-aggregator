const express = require('express');
const router = express.Router();
const configManager = require('../modules/configManager');
const dataFetcher = require('../modules/dataFetcher');
const xmlProcessor = require('../modules/xmlProcessor');
const cacheManager = require('../modules/cacheManager');

// Middleware para logging de requests
router.use((req, res, next) => {
    console.log(`[API] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
    next();
});

// GET /api/xml - Endpoint principal para obtener XML agregado
router.get('/xml', async (req, res) => {
    try {
        const startTime = Date.now();
        
        // Verificar cache primero
        const cachedData = cacheManager.get('aggregated-xml');
        if (cachedData) {
            console.log(`[API] Serving from cache`);
            res.set('Content-Type', 'application/xml');
            res.set('X-Cache', 'HIT');
            res.set('X-Response-Time', `${Date.now() - startTime}ms`);
            return res.send(cachedData);
        }

        // Obtener configuración de APIs
        const config = configManager.getConfig();
        
        if (!config.apis || config.apis.length === 0) {
            return res.status(404).xml(`<?xml version="1.0" encoding="UTF-8"?>
<error>
    <message>No APIs configured</message>
    <timestamp>${new Date().toISOString()}</timestamp>
</error>`);
        }

        console.log(`[API] Fetching data from ${config.apis.length} APIs...`);
        
        // Obtener datos de todas las APIs
        const results = await dataFetcher.fetchAllData();
        
        // Procesar y agregar XML
        const aggregatedXml = xmlProcessor.aggregateXml(results);
        
        // Guardar en cache
        cacheManager.set('aggregated-xml', aggregatedXml);
        
        // Responder
        res.set('Content-Type', 'application/xml');
        res.set('X-Cache', 'MISS');
        res.set('X-Response-Time', `${Date.now() - startTime}ms`);
        res.send(aggregatedXml);
        
        console.log(`[API] Response sent in ${Date.now() - startTime}ms`);
        
    } catch (error) {
        console.error('[API] Error generating XML:', error);
        res.status(500).set('Content-Type', 'application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<error>
    <message>Internal server error</message>
    <details>${error.message}</details>
    <timestamp>${new Date().toISOString()}</timestamp>
</error>`);
    }
});

// GET /api/status - Endpoint de estado del sistema
router.get('/status', async (req, res) => {
    try {
        const config = configManager.getConfig();
        const cacheStats = cacheManager.getStats();
        
        // Verificar conectividad de APIs
        const apiStatuses = [];
        for (const api of config.apis || []) {
            try {
                const response = await fetch(api.url, { 
                    method: 'HEAD',
                    timeout: 5000 
                });
                apiStatuses.push({
                    id: api.id,
                    name: api.name,
                    url: api.url,
                    status: response.ok ? 'online' : 'error',
                    statusCode: response.status
                });
            } catch (error) {
                apiStatuses.push({
                    id: api.id,
                    name: api.name,
                    url: api.url,
                    status: 'offline',
                    error: error.message
                });
            }
        }
        
        const status = {
            system: 'online',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cache: cacheStats,
            apis: {
                total: config.apis?.length || 0,
                online: apiStatuses.filter(api => api.status === 'online').length,
                offline: apiStatuses.filter(api => api.status === 'offline').length,
                details: apiStatuses
            }
        };
        
        res.json(status);
        
    } catch (error) {
        console.error('[API] Error getting status:', error);
        res.status(500).json({
            system: 'error',
            timestamp: new Date().toISOString(),
            error: error.message
        });
    }
});

// GET /api/config - Obtener configuración actual
router.get('/config', (req, res) => {
    try {
        const config = configManager.getConfig();
        res.json(config);
    } catch (error) {
        console.error('[API] Error getting config:', error);
        res.status(500).json({ error: error.message });
    }
});

// POST /api/refresh - Forzar actualización del cache
router.post('/refresh', async (req, res) => {
    try {
        console.log('[API] Manual refresh requested');
        
        // Limpiar cache
        cacheManager.clear();
        
        // Obtener datos frescos
        const results = await dataFetcher.fetchAllData();
        const aggregatedXml = xmlProcessor.aggregateXml(results);
        
        // Actualizar cache
        cacheManager.set('aggregated-xml', aggregatedXml);
        
        res.json({ 
            success: true, 
            message: 'Cache refreshed successfully',
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[API] Error refreshing cache:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// GET /api/preview/:apiId - Preview de una API específica
router.get('/preview/:apiId', async (req, res) => {
    try {
        const { apiId } = req.params;
        const config = configManager.getConfig();
        
        const api = config.apis?.find(a => a.id === apiId);
        if (!api) {
            return res.status(404).json({ error: 'API not found' });
        }
        
        console.log(`[API] Previewing API: ${api.name}`);
        
        const result = await dataFetcher.fetchSingleData(api);
        
        res.json({
            api: {
                id: api.id,
                name: api.name,
                url: api.url
            },
            result: result,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[API] Error previewing API:', error);
        res.status(500).json({ error: error.message });
    }
});

// Middleware para manejar errores 404 de la API
router.use((req, res) => {
    res.status(404).json({
        error: 'API endpoint not found',
        path: req.originalUrl,
        timestamp: new Date().toISOString()
    });
});

module.exports = router;