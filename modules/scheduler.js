// modules/scheduler.js
const cron = require('node-cron');
const ConfigManager = require('./configManager');
const DataFetcher = require('./dataFetcher');
const XmlProcessor = require('./xmlProcessor');
const CacheManager = require('./cacheManager');

class Scheduler {
  constructor() {
    this.configManager = new ConfigManager();
    this.dataFetcher = new DataFetcher();
    this.xmlProcessor = new XmlProcessor();
    this.cacheManager = new CacheManager();
    
    this.jobs = new Map(); // Trabajos cron activos
    this.intervals = new Map(); // Intervalos personalizados
    this.isRunning = false;
    
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      lastExecution: null,
      nextExecution: null,
      activeJobs: 0,
      lastReset: new Date().toISOString()
    };
  }

  /**
   * Inicializa el scheduler
   */
  async initialize() {
    try {
      await this.cacheManager.initialize();
      console.log('⏰ Scheduler inicializado correctamente');
      this.isRunning = true;
      
      // Programar limpieza automática de cache
      this.scheduleCacheCleanup();
      
      // Programar ejecución de APIs
      await this.scheduleApiExecution();
      
    } catch (error) {
      console.error('❌ Error inicializando Scheduler:', error.message);
      throw error;
    }
  }

  /**
   * Programa la ejecución automática de todas las APIs
   */
  async scheduleApiExecution() {
    try {
      const config = await this.configManager.loadConfig();
      const enabledApis = config.apis.filter(api => api.enabled && api.url);

      console.log(`📋 Programando ${enabledApis.length} APIs para ejecución automática`);

      // Limpiar trabajos existentes
      this.clearAllJobs();

      // Crear trabajos individuales para cada API
      for (const api of enabledApis) {
        await this.scheduleApiJob(api);
      }

      // Trabajo principal de agregación cada 5 minutos
      this.scheduleAggregationJob();

      this.stats.activeJobs = this.jobs.size + this.intervals.size;
      console.log(`✅ ${this.stats.activeJobs} trabajos programados activos`);

    } catch (error) {
      console.error('❌ Error programando APIs:', error.message);
    }
  }

  /**
   * Programa un trabajo individual para una API
   * @param {Object} api - Configuración de la API
   */
  async scheduleApiJob(api) {
    const jobId = `api_${api.id}`;
    
    try {
      // Convertir intervalo a expresión cron
      const cronExpression = this.intervalToCron(api.interval);
      
      if (cronExpression) {
        // Usar cron para intervalos estándar
        const job = cron.schedule(cronExpression, async () => {
          await this.executeApiJob(api);
        }, {
          scheduled: false,
          timezone: 'America/Argentina/Buenos_Aires'
        });

        job.start();
        this.jobs.set(jobId, {
          job,
          api,
          type: 'cron',
          expression: cronExpression,
          lastRun: null
        });

        console.log(`⏰ API ${api.name} programada con cron: ${cronExpression}`);
        
      } else {
        // Usar setInterval para intervalos personalizados
        const intervalMs = api.interval * 1000;
        const intervalId = setInterval(async () => {
          await this.executeApiJob(api);
        }, intervalMs);

        this.intervals.set(jobId, {
          intervalId,
          api,
          type: 'interval',
          intervalMs,
          lastRun: null
        });

        console.log(`⏰ API ${api.name} programada con intervalo: ${api.interval}s`);
      }

      // Ejecutar inmediatamente si no hay datos cacheados
      const cachedData = await this.cacheManager.getApiData(api.id);
      if (!cachedData) {
        console.log(`🚀 Ejecutando ${api.name} inmediatamente (sin cache)`);
        // Ejecutar con pequeño delay para evitar sobrecargar
        setTimeout(() => this.executeApiJob(api), Math.random() * 5000);
      }

    } catch (error) {
      console.error(`❌ Error programando API ${api.name}:`, error.message);
    }
  }

  /**
   * Ejecuta el trabajo de una API específica
   * @param {Object} api - Configuración de la API
   */
  async executeApiJob(api) {
    const startTime = Date.now();
    
    try {
      console.log(`🔄 Ejecutando trabajo para ${api.name}...`);
      
      // Obtener datos
      const fetchResult = await this.dataFetcher.fetchApiData(api);
      
      if (fetchResult.success) {
        // Procesar XML
        const processedResult = await this.xmlProcessor.processXmlData(fetchResult);
        
        if (processedResult.success) {
          // Cachear resultado
          await this.cacheManager.setApiData(api.id, processedResult, api.interval);
          
          // Actualizar estadísticas
          this.updateJobStats(`api_${api.id}`, true);
          this.stats.successfulExecutions++;
          
          const executionTime = Date.now() - startTime;
          console.log(`✅ Trabajo completado para ${api.name} (${executionTime}ms)`);
          
        } else {
          throw new Error(`Error procesando XML: ${processedResult.error}`);
        }
      } else {
        throw new Error(`Error obteniendo datos: ${fetchResult.error}`);
      }

    } catch (error) {
      console.error(`❌ Error ejecutando trabajo ${api.name}:`, error.message);
      this.updateJobStats(`api_${api.id}`, false);
      this.stats.failedExecutions++;
    } finally {
      this.stats.totalExecutions++;
      this.stats.lastExecution = new Date().toISOString();
    }
  }

  /**
   * Programa el trabajo de agregación
   */
  scheduleAggregationJob() {
    const jobId = 'aggregation';
    
    // Cada 5 minutos
    const job = cron.schedule('*/5 * * * *', async () => {
      await this.executeAggregationJob();
    }, {
      scheduled: false,
      timezone: 'America/Argentina/Buenos_Aires'
    });

    job.start();
    this.jobs.set(jobId, {
      job,
      type: 'aggregation',
      expression: '*/5 * * * *',
      lastRun: null
    });

    console.log('⏰ Trabajo de agregación programado cada 5 minutos');
  }

  /**
   * Ejecuta el trabajo de agregación
   */
  async executeAggregationJob() {
    try {
      console.log('🔄 Ejecutando agregación de datos XML...');
      
      const enabledApis = await this.configManager.getEnabledApis();
      const processedResults = [];

      // Obtener datos cacheados de cada API
      for (const api of enabledApis) {
        const cachedData = await this.cacheManager.getApiData(api.id);
        if (cachedData && cachedData.success) {
          processedResults.push(cachedData);
        }
      }

      if (processedResults.length > 0) {
        // Agregar datos XML
        const aggregatedResult = await this.xmlProcessor.aggregateXmlSources(processedResults);
        
        if (aggregatedResult.success) {
          // Cachear resultado agregado
          await this.cacheManager.setAggregatedData(aggregatedResult);
          
          console.log(`✅ Agregación completada: ${processedResults.length} fuentes`);
          this.updateJobStats('aggregation', true);
        } else {
          throw new Error(`Error en agregación: ${aggregatedResult.error}`);
        }
      } else {
        console.log('⚠️ No hay datos para agregar');
      }

    } catch (error) {
      console.error('❌ Error en agregación:', error.message);
      this.updateJobStats('aggregation', false);
    }
  }

  /**
   * Programa limpieza automática de cache
   */
  scheduleCacheCleanup() {
    const job = cron.schedule('0 */2 * * *', async () => {
      console.log('🧹 Ejecutando limpieza automática de cache...');
      const cleaned = await this.cacheManager.cleanExpiredCache();
      console.log(`✅ Limpieza completada: ${cleaned} entradas eliminadas`);
    }, {
      scheduled: true,
      timezone: 'America/Argentina/Buenos_Aires'
    });

    this.jobs.set('cache_cleanup', {
      job,
      type: 'maintenance',
      expression: '0 */2 * * *',
      lastRun: null
    });

    console.log('🧹 Limpieza automática de cache programada cada 2 horas');
  }

  /**
   * Convierte intervalo en segundos a expresión cron
   * @param {number} interval - Intervalo en segundos
   * @returns {string|null} Expresión cron o null
   */
  intervalToCron(interval) {
    // Solo convertir intervalos estándar a cron
    switch (interval) {
      case 60: return '* * * * *';        // Cada minuto
      case 300: return '*/5 * * * *';     // Cada 5 minutos
      case 600: return '*/10 * * * *';    // Cada 10 minutos
      case 900: return '*/15 * * * *';    // Cada 15 minutos
      case 1800: return '*/30 * * * *';   // Cada 30 minutos
      case 3600: return '0 * * * *';      // Cada hora
      case 7200: return '0 */2 * * *';    // Cada 2 horas
      case 21600: return '0 */6 * * *';   // Cada 6 horas
      case 43200: return '0 */12 * * *';  // Cada 12 horas
      case 86400: return '0 0 * * *';     // Cada día
      default: return null;               // Usar setInterval
    }
  }

  /**
   * Actualiza estadísticas de un trabajo
   * @param {string} jobId - ID del trabajo
   * @param {boolean} success - Si fue exitoso
   */
  updateJobStats(jobId, success) {
    const job = this.jobs.get(jobId) || this.intervals.get(jobId);
    if (job) {
      job.lastRun = new Date().toISOString();
      job.lastSuccess = success;
    }
  }

  /**
   * Ejecuta todas las APIs inmediatamente
   * @returns {Promise<Object>} Resultado de la ejecución
   */
  async executeAllNow() {
    try {
      console.log('🚀 Ejecutando todas las APIs inmediatamente...');
      
      const result = await this.dataFetcher.fetchAllApis();
      
      if (result.results && result.results.length > 0) {
        // Procesar resultados
        const processedResult = await this.xmlProcessor.processMultipleXmlData(result.results);
        
        // Cachear resultados individuales
        for (const processed of processedResult.results) {
          if (processed.success) {
            await this.cacheManager.setApiData(processed.apiId, processed);
          }
        }

        // Crear agregación
        const aggregated = await this.xmlProcessor.aggregateXmlSources(processedResult.results);
        if (aggregated.success) {
          await this.cacheManager.setAggregatedData(aggregated);
        }

        return {
          success: true,
          timestamp: new Date().toISOString(),
          fetchResult: result,
          processedResult,
          aggregated
        };
      }

      return {
        success: false,
        error: 'No hay APIs para ejecutar',
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      console.error('❌ Error ejecutando todas las APIs:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Recarga la configuración y reprograma trabajos
   */
  async reloadSchedule() {
    console.log('🔄 Recargando programación de trabajos...');
    await this.scheduleApiExecution();
  }

  /**
   * Limpia todos los trabajos programados
   */
  clearAllJobs() {
    // Limpiar trabajos cron
    for (const [jobId, jobData] of this.jobs.entries()) {
      if (jobData.job && typeof jobData.job.destroy === 'function') {
        jobData.job.destroy();
      }
    }
    this.jobs.clear();

    // Limpiar intervalos
    for (const [intervalId, intervalData] of this.intervals.entries()) {
      clearInterval(intervalData.intervalId);
    }
    this.intervals.clear();

    this.stats.activeJobs = 0;
    console.log('🧹 Todos los trabajos programados han sido limpiados');
  }

  /**
   * Detiene el scheduler
   */
  async stop() {
    console.log('🛑 Deteniendo scheduler...');
    this.isRunning = false;
    this.clearAllJobs();
    console.log('✅ Scheduler detenido');
  }

  /**
   * Obtiene el estado de todos los trabajos
   * @returns {Object} Estado de los trabajos
   */
  getJobsStatus() {
    const cronJobs = Array.from(this.jobs.entries()).map(([id, data]) => ({
      id,
      type: data.type,
      expression: data.expression,
      lastRun: data.lastRun,
      lastSuccess: data.lastSuccess,
      apiName: data.api?.name || 'System'
    }));

    const intervalJobs = Array.from(this.intervals.entries()).map(([id, data]) => ({
      id,
      type: data.type,
      intervalMs: data.intervalMs,
      intervalSeconds: Math.round(data.intervalMs / 1000),
      lastRun: data.lastRun,
      lastSuccess: data.lastSuccess,
      apiName: data.api?.name || 'System'
    }));

    return {
      isRunning: this.isRunning,
      totalJobs: cronJobs.length + intervalJobs.length,
      cronJobs,
      intervalJobs,
      stats: this.getStats()
    };
  }

  /**
   * Obtiene estadísticas del scheduler
   * @returns {Object} Estadísticas
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalExecutions > 0
        ? Math.round((this.stats.successfulExecutions / this.stats.totalExecutions) * 100)
        : 0,
      cacheStats: this.cacheManager.getStats()
    };
  }

  /**
   * Resetea estadísticas
   */
  resetStats() {
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      lastExecution: null,
      nextExecution: null,
      activeJobs: this.jobs.size + this.intervals.size,
      lastReset: new Date().toISOString()
    };
    
    this.cacheManager.resetStats();
  }

  /**
   * Obtiene próximas ejecuciones programadas
   * @returns {Array} Lista de próximas ejecuciones
   */
  getUpcomingExecutions() {
    const upcoming = [];
    const now = new Date();

    // Para trabajos cron, calcular próxima ejecución
    for (const [id, data] of this.jobs.entries()) {
      if (data.expression) {
        // Esto es una aproximación simple, en producción usarías una librería como cron-parser
        upcoming.push({
          jobId: id,
          apiName: data.api?.name || 'System',
          type: data.type,
          nextRun: 'Calculando...' // Placeholder
        });
      }
    }

    return upcoming;
  }
}

module.exports = Scheduler;