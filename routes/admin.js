const express = require('express');
const router = express.Router();
const configManager = require('../modules/configManager');
const { v4: uuidv4 } = require('uuid');

// Middleware para logging
router.use((req, res, next) => {
    console.log(`[ADMIN] ${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
    next();
});

// GET /admin - Panel principal de administración
router.get('/', (req, res) => {
    try {
        const config = configManager.getConfig();
        res.render('admin', { 
            title: 'XML API Aggregator - Admin Panel',
            config: config,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[ADMIN] Error loading admin panel:', error);
        res.status(500).send('Error loading admin panel');
    }
});

// GET /admin/config - Obtener configuración (AJAX)
router.get('/config', (req, res) => {
    try {
        const config = configManager.getConfig();
        res.json(config);
    } catch (error) {
        console.error('[ADMIN] Error getting config:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /admin/apis - Agregar nueva API
router.post('/apis', (req, res) => {
    try {
        const { name, url, enabled = true } = req.body;
        
        // Validaciones
        if (!name || !url) {
            return res.status(400).json({ 
                success: false, 
                error: 'Name and URL are required' 
            });
        }
        
        // Validar formato de URL
        try {
            new URL(url);
        } catch (e) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid URL format' 
            });
        }
        
        const config = configManager.getConfig();
        
        // Verificar si ya existe una API con el mismo nombre o URL
        const existingApi = config.apis.find(api => 
            api.name.toLowerCase() === name.toLowerCase() || 
            api.url === url
        );
        
        if (existingApi) {
            return res.status(400).json({ 
                success: false, 
                error: 'API with this name or URL already exists' 
            });
        }
        
        const newApi = {
            id: uuidv4(),
            name: name.trim(),
            url: url.trim(),
            enabled: Boolean(enabled),
            created: new Date().toISOString(),
            order: config.apis.length
        };
        
        config.apis.push(newApi);
        configManager.saveConfig(config);
        
        console.log(`[ADMIN] New API added: ${newApi.name}`);
        
        res.json({ 
            success: true, 
            message: 'API added successfully',
            api: newApi
        });
        
    } catch (error) {
        console.error('[ADMIN] Error adding API:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// PUT /admin/apis/:id - Actualizar API existente
router.put('/apis/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { name, url, enabled } = req.body;
        
        const config = configManager.getConfig();
        const apiIndex = config.apis.findIndex(api => api.id === id);
        
        if (apiIndex === -1) {
            return res.status(404).json({ 
                success: false, 
                error: 'API not found' 
            });
        }
        
        // Validaciones
        if (name !== undefined) {
            if (!name.trim()) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Name cannot be empty' 
                });
            }
            
            // Verificar nombre duplicado (excluyendo la API actual)
            const duplicateName = config.apis.find((api, index) => 
                index !== apiIndex && 
                api.name.toLowerCase() === name.toLowerCase()
            );
            
            if (duplicateName) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'API with this name already exists' 
                });
            }
        }
        
        if (url !== undefined) {
            // Validar formato de URL
            try {
                new URL(url);
            } catch (e) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Invalid URL format' 
                });
            }
            
            // Verificar URL duplicada (excluyendo la API actual)
            const duplicateUrl = config.apis.find((api, index) => 
                index !== apiIndex && 
                api.url === url
            );
            
            if (duplicateUrl) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'API with this URL already exists' 
                });
            }
        }
        
        // Actualizar campos
        if (name !== undefined) config.apis[apiIndex].name = name.trim();
        if (url !== undefined) config.apis[apiIndex].url = url.trim();
        if (enabled !== undefined) config.apis[apiIndex].enabled = Boolean(enabled);
        
        config.apis[apiIndex].updated = new Date().toISOString();
        
        configManager.saveConfig(config);
        
        console.log(`[ADMIN] API updated: ${config.apis[apiIndex].name}`);
        
        res.json({ 
            success: true, 
            message: 'API updated successfully',
            api: config.apis[apiIndex]
        });
        
    } catch (error) {
        console.error('[ADMIN] Error updating API:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// DELETE /admin/apis/:id - Eliminar API
router.delete('/apis/:id', (req, res) => {
    try {
        const { id } = req.params;
        const config = configManager.getConfig();
        
        const apiIndex = config.apis.findIndex(api => api.id === id);
        
        if (apiIndex === -1) {
            return res.status(404).json({ 
                success: false, 
                error: 'API not found' 
            });
        }
        
        const deletedApi = config.apis[apiIndex];
        config.apis.splice(apiIndex, 1);
        
        // Reordenar índices
        config.apis.forEach((api, index) => {
            api.order = index;
        });
        
        configManager.saveConfig(config);
        
        console.log(`[ADMIN] API deleted: ${deletedApi.name}`);
        
        res.json({ 
            success: true, 
            message: 'API deleted successfully',
            deletedApi: deletedApi
        });
        
    } catch (error) {
        console.error('[ADMIN] Error deleting API:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// POST /admin/apis/reorder - Reordenar APIs
router.post('/apis/reorder', (req, res) => {
    try {
        const { order } = req.body; // Array de IDs en el nuevo orden
        
        if (!Array.isArray(order)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Order must be an array of API IDs' 
            });
        }
        
        const config = configManager.getConfig();
        
        // Verificar que todos los IDs existan
        const existingIds = config.apis.map(api => api.id);
        const missingIds = order.filter(id => !existingIds.includes(id));
        
        if (missingIds.length > 0) {
            return res.status(400).json({ 
                success: false, 
                error: `APIs not found: ${missingIds.join(', ')}` 
            });
        }
        
        // Reordenar APIs
        const reorderedApis = order.map(id => {
            return config.apis.find(api => api.id === id);
        });
        
        // Actualizar orden
        reorderedApis.forEach((api, index) => {
            api.order = index;
        });
        
        config.apis = reorderedApis;
        configManager.saveConfig(config);
        
        console.log(`[ADMIN] APIs reordered: ${order.join(', ')}`);
        
        res.json({ 
            success: true, 
            message: 'APIs reordered successfully',
            order: order
        });
        
    } catch (error) {
        console.error('[ADMIN] Error reordering APIs:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// POST /admin/test-url - Probar conectividad de URL
router.post('/test-url', async (req, res) => {
    try {
        const { url } = req.body;
        
        if (!url) {
            return res.status(400).json({ 
                success: false, 
                error: 'URL is required' 
            });
        }
        
        // Validar formato de URL
        try {
            new URL(url);
        } catch (e) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid URL format' 
            });
        }
        
        console.log(`[ADMIN] Testing URL: ${url}`);
        
        const startTime = Date.now();
        
        try {
            const response = await fetch(url, {
                method: 'GET',
                timeout: 10000,
                headers: {
                    'User-Agent': 'XML-API-Aggregator/1.0'
                }
            });
            
            const responseTime = Date.now() - startTime;
            const contentType = response.headers.get('content-type') || '';
            
            // Leer una pequeña muestra del contenido para verificar si es XML
            const text = await response.text();
            const isXml = text.trim().startsWith('<?xml') || 
                         text.trim().startsWith('<') ||
                         contentType.includes('xml');
            
            res.json({
                success: true,
                status: response.status,
                statusText: response.statusText,
                responseTime: responseTime,
                contentType: contentType,
                isXml: isXml,
                contentLength: text.length,
                preview: text.substring(0, 500) + (text.length > 500 ? '...' : '')
            });
            
        } catch (fetchError) {
            res.json({
                success: false,
                error: fetchError.message,
                responseTime: Date.now() - startTime
            });
        }
        
    } catch (error) {
        console.error('[ADMIN] Error testing URL:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// POST /admin/backup - Crear backup de la configuración
router.post('/backup', (req, res) => {
    try {
        const config = configManager.getConfig();
        const backup = {
            ...config,
            backup: {
                created: new Date().toISOString(),
                version: '1.0'
            }
        };
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="xml-aggregator-backup-${new Date().toISOString().split('T')[0]}.json"`);
        res.send(JSON.stringify(backup, null, 2));
        
        console.log('[ADMIN] Configuration backup created');
        
    } catch (error) {
        console.error('[ADMIN] Error creating backup:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// POST /admin/restore - Restaurar configuración desde backup
router.post('/restore', (req, res) => {
    try {
        const backupConfig = req.body;
        
        // Validaciones básicas
        if (!backupConfig || !backupConfig.apis || !Array.isArray(backupConfig.apis)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid backup format' 
            });
        }
        
        // Validar estructura de APIs
        for (const api of backupConfig.apis) {
            if (!api.id || !api.name || !api.url) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Invalid API structure in backup' 
                });
            }
        }
        
        configManager.saveConfig(backupConfig);
        
        console.log(`[ADMIN] Configuration restored from backup with ${backupConfig.apis.length} APIs`);
        
        res.json({ 
            success: true, 
            message: `Configuration restored successfully with ${backupConfig.apis.length} APIs`
        });
        
    } catch (error) {
        console.error('[ADMIN] Error restoring backup:', error);
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

module.exports = router;