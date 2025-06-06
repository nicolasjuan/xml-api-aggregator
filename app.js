// app.js - Servidor Express Principal
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const fs = require('fs').promises;

// Importar módulos propios
const ConfigManager = require('./modules/configManager');
const AggregatorService = require('./modules/aggregatorService');

// Crear instancia del servicio
const aggregatorService = new AggregatorService();

// Inicializar Express
const app = express();
const configManager = new ConfigManager();

// Variables globales
let serverConfig = {};

/**
 * Configuración de middlewares
 */
async function setupMiddlewares() {
  // Cargar configuración
  serverConfig = await configManager.loadConfig();

  // Helmet para seguridad (configurado para desarrollo)
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        scriptSrcAttr: ["'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
      },
    },
  }));

  // CORS
  if (serverConfig.settings.enableCors) {
    app.use(cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
    }));
  }

  // Logging
  if (serverConfig.settings.logLevel !== 'none') {
    app.use(morgan('combined'));
  }

  // Parser de JSON y URL encoded
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Archivos estáticos
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/vendor', express.static(path.join(__dirname, 'public/vendor')));

  // View engine
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
}

/**
 * Rutas principales
 */
function setupRoutes() {
  // Ruta principal - API status
  app.get('/', async (req, res) => {
    try {
      const config = await configManager.loadConfig();
      const enabledApis = await configManager.getEnabledApis();

      res.json({
        status: 'active',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        totalApis: config.apis.length,
        enabledApis: enabledApis.length,
        settings: {
          cacheTime: config.settings.cacheTime,
          timeout: config.settings.timeout,
          retries: config.settings.retries
        },
        endpoints: {
          admin: '/admin',
          api: '/api',
          aggregated: '/api/aggregated',
          health: '/health'
        }
      });
    } catch (error) {
      console.error('❌ Error en ruta principal:', error.message);
      res.status(500).json({
        status: 'error',
        message: 'Error interno del servidor',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Health check
  app.get('/health', async (req, res) => {
    try {
      const config = await configManager.loadConfig();
      const enabledApis = await configManager.getEnabledApis();

      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        config: {
          totalApis: config.apis.length,
          enabledApis: enabledApis.length,
          lastConfigUpdate: config.lastModified
        }
      });
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Panel de administración
  app.get('/admin', async (req, res) => {
    try {
      const config = await configManager.loadConfig();
      res.render('admin', {
        title: 'XML API Aggregator - Admin Panel',
        config: config,
        apis: config.apis.sort((a, b) => a.order - b.order)
      });
    } catch (error) {
      console.error('❌ Error cargando panel admin:', error.message);
      res.status(500).render('error', {
        message: 'Error cargando el panel de administración'
      });
    }
  });

  // API Routes - CRUD de configuración
  app.get('/api/config', async (req, res) => {
    try {
      const config = await configManager.loadConfig();
      res.json(config);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/config', async (req, res) => {
    try {
      await configManager.saveConfig(req.body);
      res.json({ success: true, message: 'Configuración guardada' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // APIs CRUD
  app.get('/api/apis', async (req, res) => {
    try {
      const config = await configManager.loadConfig();
      res.json(config.apis);
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/apis', async (req, res) => {
    try {
      const newApi = await configManager.addApi(req.body);
      res.json({ success: true, api: newApi });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.put('/api/apis/:id', async (req, res) => {
    try {
      const updatedApi = await configManager.updateApi(req.params.id, req.body);
      if (updatedApi) {
        res.json({ success: true, api: updatedApi });
      } else {
        res.status(404).json({ error: 'API no encontrada' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.delete('/api/apis/:id', async (req, res) => {
    try {
      const deleted = await configManager.removeApi(req.params.id);
      if (deleted) {
        res.json({ success: true, message: 'API eliminada' });
      } else {
        res.status(404).json({ error: 'API no encontrada' });
      }
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Reordenar APIs
  app.put('/api/apis-order', async (req, res) => {
    try {
      await configManager.reorderApis(req.body.orderedIds);
      res.json({ success: true, message: 'Orden actualizado' });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  // Test de conectividad
  app.post('/api/test-url', async (req, res) => {
    const { url, timeout = 5000 } = req.body;

    if (!url) {
      return res.status(400).json({ error: 'URL requerida' });
    }

    try {
      const axios = require('axios');
      const startTime = Date.now();

      const response = await axios.get(url, {
        timeout: timeout,
        headers: {
          'User-Agent': serverConfig.settings.userAgent || 'XML-Aggregator/1.0'
        },
        validateStatus: function (status) {
          return status < 500; // Resolver solo si el código es menor a 500
        }
      });

      const responseTime = Date.now() - startTime;

      res.json({
        success: true,
        status: response.status,
        statusText: response.statusText,
        responseTime: responseTime,
        contentType: response.headers['content-type'] || 'unknown',
        contentLength: response.headers['content-length'] || 'unknown',
        isXml: (response.headers['content-type'] || '').includes('xml'),
        preview: typeof response.data === 'string'
          ? response.data.substring(0, 500) + (response.data.length > 500 ? '...' : '')
          : JSON.stringify(response.data).substring(0, 500)
      });

    } catch (error) {
      res.json({
        success: false,
        error: error.message,
        code: error.code,
        responseTime: null
      });
    }
  });

  // Ruta optimizada para datos agregados
  app.get('/api/aggregated', async (req, res) => {
    try {
      console.log('🔄 Solicitud de agregación XML recibida');

      // Preparar opciones de agregación desde query parameters
      const options = {
        sequential: req.query.sequential === 'true',
        timeout: req.query.timeout ? parseInt(req.query.timeout) : undefined,
        format: req.query.format || 'xml',
        include: req.query.include || 'xml'
      };

      // Ejecutar agregación usando el servicio
      const result = await aggregatorService.aggregateAllSources(options);

      // Manejar diferentes tipos de respuesta
      if (result.status === 'warning') {
        return res.status(200).json(result);
      }

      if (result.status === 'error') {
        return res.status(result.statusCode || 500).json(result);
      }

      // Respuesta exitosa - determinar formato
      const responseFormat = options.format || req.headers.accept;

      if (responseFormat === 'xml' || req.headers.accept?.includes('xml')) {
        // Responder con XML puro
        res.set('Content-Type', 'application/xml; charset=utf-8');
        res.set('X-Total-Sources', result.summary.validSources.toString());
        res.set('X-Processing-Time', result.summary.processingTime.toString());
        return res.send(result.aggregatedXml);
      }

      // Responder con JSON (personalizable según include parameter)
      const jsonResponse = {
        status: result.status,
        timestamp: result.timestamp,
        summary: result.summary,
        stats: result.stats
      };

      // Incluir diferentes partes según el parámetro include
      switch (options.include) {
        case 'xml':
          jsonResponse.aggregatedXml = result.aggregatedXml;
          break;

        case 'structure':
          jsonResponse.aggregatedStructure = result.aggregatedStructure;
          break;

        case 'metadata':
          jsonResponse.metadata = result.metadata;
          break;

        case 'all':
          jsonResponse.aggregatedXml = result.aggregatedXml;
          jsonResponse.aggregatedStructure = result.aggregatedStructure;
          jsonResponse.metadata = result.metadata;
          break;

        default:
          // Por defecto incluir XML
          jsonResponse.aggregatedXml = result.aggregatedXml;
          break;
      }

      res.json(jsonResponse);

    } catch (error) {
      console.error('❌ Error no controlado en ruta de agregación:', error);
      res.status(500).json({
        status: 'error',
        message: 'Error interno del servidor',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Error interno',
        timestamp: new Date().toISOString()
      });
    }
  });

  // Opcional: Ruta adicional para obtener información de fuentes
  app.get('/api/sources', async (req, res) => {
    try {
      const sourcesInfo = await aggregatorService.getSourcesInfo();
      res.json({
        status: 'success',
        timestamp: new Date().toISOString(),
        sources: sourcesInfo
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Opcional: Ruta para obtener estadísticas del agregador
  app.get('/api/aggregator/stats', async (req, res) => {
    try {
      const stats = aggregatorService.getStats();
      res.json({
        status: 'success',
        timestamp: new Date().toISOString(),
        stats
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // Opcional: Ruta para resetear estadísticas
  app.post('/api/aggregator/reset-stats', async (req, res) => {
    try {
      aggregatorService.resetStats();
      res.json({
        status: 'success',
        message: 'Estadísticas reseteadas',
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  // 404 Handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'Endpoint no encontrado',
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString(),
      availableEndpoints: [
        'GET /',
        'GET /health',
        'GET /admin',
        'GET /api/config',
        'POST /api/config',
        'GET /api/apis',
        'POST /api/apis',
        'PUT /api/apis/:id',
        'DELETE /api/apis/:id',
        'PUT /api/apis-order',
        'POST /api/test-url',
        'GET /api/aggregated'
      ]
    });
  });

  // Error handler global
  app.use((error, req, res, next) => {
    console.error('❌ Error no manejado:', error);
    res.status(500).json({
      error: 'Error interno del servidor',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Error interno',
      timestamp: new Date().toISOString()
    });
  });
}

/**
 * Función para crear archivos necesarios si no existen
 */
async function ensureDirectoriesAndFiles() {
  const directories = ['config', 'logs', 'views', 'public/css', 'public/js'];

  for (const dir of directories) {
    try {
      await fs.mkdir(path.join(__dirname, dir), { recursive: true });
    } catch (error) {
      // Directorio ya existe
    }
  }

  // Crear archivo de log si no existe
  const logPath = path.join(__dirname, 'logs', 'app.log');
  try {
    await fs.access(logPath);
  } catch {
    await fs.writeFile(logPath, `# XML API Aggregator Log\n# Started: ${new Date().toISOString()}\n\n`);
  }
}

/**
 * Inicialización del servidor
 */
async function startServer() {
  try {
    console.log('🚀 Inicializando XML API Aggregator...');

    // Crear directorios y archivos necesarios
    await ensureDirectoriesAndFiles();

    // Configurar middlewares
    await setupMiddlewares();

    // Configurar rutas
    setupRoutes();

    // Obtener puerto de configuración
    const port = serverConfig.settings.port || 8080;

    // Iniciar servidor
    const server = app.listen(port, () => {
      console.log('✅ Servidor iniciado correctamente');
      console.log(`📡 URL: http://localhost:${port}`);
      console.log(`🔧 Panel Admin: http://localhost:${port}/admin`);
      console.log(`📊 Health Check: http://localhost:${port}/health`);
      console.log(`📋 APIs configuradas: ${serverConfig.apis.length}`);
      console.log(`⚡ APIs habilitadas: ${serverConfig.apis.filter(api => api.enabled).length}`);
      console.log('');
      console.log('💡 Usa Ctrl+C para detener el servidor');
    });

    // Manejo de señales de cierre
    process.on('SIGTERM', () => {
      console.log('\n🛑 Recibida señal SIGTERM, cerrando servidor...');
      server.close(() => {
        console.log('✅ Servidor cerrado correctamente');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('\n🛑 Recibida señal SIGINT, cerrando servidor...');
      server.close(() => {
        console.log('✅ Servidor cerrado correctamente');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('❌ Error al inicializar servidor:', error.message);
    process.exit(1);
  }
}

// Inicializar servidor si este archivo se ejecuta directamente
if (require.main === module) {
  startServer();
}

module.exports = app;