// app.js - Servidor Express Principal
const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const fs = require('fs').promises;

// Importar módulos propios
const ConfigManager = require('./modules/configManager');
const DataFetcher = require('./modules/dataFetcher');
const XmlProcessor = require('./modules/xmlProcessor');

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

  // Ruta para datos agregados - IMPLEMENTACIÓN COMPLETA
  app.get('/api/aggregated', async (req, res) => {
    try {
      console.log('🔄 Iniciando agregación de datos XML...');

      // Importar módulos necesarios
      const DataFetcher = require('./modules/dataFetcher');
      const XmlProcessor = require('./modules/xmlProcessor');

      // Crear instancias
      const dataFetcher = new DataFetcher();
      const xmlProcessor = new XmlProcessor();

      // Obtener APIs habilitadas
      const enabledApis = await configManager.getEnabledApis();

      if (enabledApis.length === 0) {
        return res.json({
          status: 'warning',
          message: 'No hay APIs habilitadas configuradas',
          timestamp: new Date().toISOString(),
          totalSources: 0,
          data: null
        });
      }

      // Paso 1: Obtener datos de todas las APIs
      console.log(`📡 Obteniendo datos de ${enabledApis.length} APIs...`);
      const fetchResults = await dataFetcher.fetchAllApis({
        sequential: req.query.sequential === 'true' // Permitir modo secuencial via query param
      });

      // Verificar si hay datos exitosos
      const successfulFetches = fetchResults.results.filter(r => r.success);
      if (successfulFetches.length === 0) {
        return res.status(503).json({
          status: 'error',
          message: 'No se pudieron obtener datos de ninguna API',
          timestamp: new Date().toISOString(),
          totalSources: enabledApis.length,
          errors: fetchResults.results.map(r => ({
            apiId: r.apiId,
            apiName: r.apiName,
            error: r.error
          })),
          fetchStats: fetchResults.stats
        });
      }

      // Paso 2: Procesar datos XML
      console.log(`🔄 Procesando ${successfulFetches.length} fuentes XML...`);
      const processResults = await xmlProcessor.processMultipleXmlData(successfulFetches);

      const successfulProcessing = processResults.results.filter(r => r.success);
      if (successfulProcessing.length === 0) {
        return res.status(422).json({
          status: 'error',
          message: 'No se pudieron procesar datos XML válidos',
          timestamp: new Date().toISOString(),
          totalSources: enabledApis.length,
          fetchedSources: successfulFetches.length,
          processingErrors: processResults.results.map(r => ({
            apiId: r.apiId,
            apiName: r.apiName,
            error: r.error
          })),
          stats: {
            fetch: fetchResults.stats,
            processing: processResults.stats
          }
        });
      }

      // Paso 3: Agregar XMLs
      console.log(`🔗 Agregando ${successfulProcessing.length} fuentes XML...`);
      const aggregationOptions = {
        mergeStrategy: req.query.merge || 'default',
        includeMetadata: req.query.metadata !== 'false',
        format: req.query.format || 'xml'
      };

      const aggregationResult = await xmlProcessor.aggregateXmlSources(
        successfulProcessing,
        aggregationOptions
      );

      if (!aggregationResult.success) {
        return res.status(500).json({
          status: 'error',
          message: 'Error en la agregación de datos XML',
          error: aggregationResult.error,
          timestamp: new Date().toISOString()
        });
      }

      // Preparar respuesta según formato solicitado
      const responseFormat = req.query.format || req.headers.accept;

      if (responseFormat === 'xml' || req.headers.accept?.includes('xml')) {
        // Responder con XML
        res.set('Content-Type', 'application/xml; charset=utf-8');
        res.send(aggregationResult.xml);
      } else {
        // Responder con JSON (por defecto)
        const response = {
          status: 'success',
          timestamp: new Date().toISOString(),
          summary: {
            totalConfiguredApis: enabledApis.length,
            successfulFetches: successfulFetches.length,
            successfulProcessing: successfulProcessing.length,
            processingTime: aggregationResult.metadata.processingTime
          },
          metadata: {
            aggregationOptions,
            sources: successfulProcessing.map(r => ({
              id: r.apiId,
              name: r.apiName,
              url: r.originalMetadata?.url,
              lastFetch: r.originalMetadata?.timestamp,
              processingTime: r.processingTime,
              xmlMetadata: {
                rootElement: r.xmlMetadata?.rootElement,
                elementCount: r.xmlMetadata?.elementCount,
                size: r.xmlMetadata?.size
              }
            }))
          },
          stats: {
            fetch: fetchResults.stats,
            processing: processResults.stats,
            aggregation: {
              totalSources: successfulProcessing.length,
              processingTime: aggregationResult.metadata.processingTime
            }
          }
        };

        // Incluir datos agregados según query params
        if (req.query.include === 'xml') {
          response.aggregatedXml = aggregationResult.xml;
        }

        if (req.query.include === 'structure' || req.query.include === 'all') {
          response.aggregatedStructure = aggregationResult.structure;
        }

        if (req.query.include === 'raw' || req.query.include === 'all') {
          response.rawSources = successfulProcessing.map(r => ({
            apiId: r.apiId,
            apiName: r.apiName,
            rawData: r.rawData,
            parsedData: r.parsedData
          }));
        }

        // Si no se especifica qué incluir, por defecto incluir XML
        if (!req.query.include) {
          response.aggregatedXml = aggregationResult.xml;
        }

        res.json(response);
      }

      console.log(`✅ Agregación completada exitosamente: ${successfulProcessing.length} fuentes procesadas`);

    } catch (error) {
      console.error('❌ Error en agregación de datos:', error);
      res.status(500).json({
        status: 'error',
        message: 'Error interno durante la agregación',
        error: process.env.NODE_ENV === 'development' ? error.message : 'Error interno del servidor',
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