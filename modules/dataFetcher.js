// modules/dataFetcher.js
const axios = require('axios');
const ConfigManager = require('./config-manager');

class DataFetcher {
  constructor() {
    this.configManager = new ConfigManager();
    this.activeRequests = new Map(); // Para evitar requests duplicados
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalResponseTime: 0,
      lastReset: new Date().toISOString()
    };
  }

  /**
   * Obtiene datos de una API específica
   * @param {Object} apiConfig - Configuración de la API
   * @returns {Promise<Object>} Resultado del fetch
   */
  async fetchApiData(apiConfig) {
    const startTime = Date.now();
    const requestId = `${apiConfig.id}_${startTime}`;

    // Evitar requests duplicados simultáneos
    if (this.activeRequests.has(apiConfig.id)) {
      console.log(`⏳ Request ya en progreso para ${apiConfig.name}`);
      return {
        success: false,
        error: 'Request already in progress',
        apiId: apiConfig.id,
        timestamp: new Date().toISOString()
      };
    }

    this.activeRequests.set(apiConfig.id, requestId);

    try {
      console.log(`🔄 Fetching data from ${apiConfig.name} (${apiConfig.url})`);
      
      // Configurar axios
      const axiosConfig = {
        timeout: apiConfig.timeout || 5000,
        headers: {
          'User-Agent': 'XML-Aggregator/1.0',
          'Accept': 'application/xml, text/xml, */*',
          'Cache-Control': 'no-cache',
          ...apiConfig.headers
        },
        validateStatus: function (status) {
          return status >= 200 && status < 300;
        },
        maxRedirects: 5,
        responseType: 'text' // Siempre como texto para procesar XML
      };

      // Realizar request con reintentos
      let lastError;
      const maxRetries = apiConfig.retries || 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await axios.get(apiConfig.url, axiosConfig);
          const responseTime = Date.now() - startTime;

          // Actualizar estadísticas
          this.updateStats(true, responseTime);

          // Actualizar estado en configuración
          await this.configManager.updateApiStatus(apiConfig.id, 'success', {
            responseTime,
            contentLength: response.data.length,
            attempt
          });

          console.log(`✅ Success: ${apiConfig.name} (${responseTime}ms, attempt ${attempt})`);

          const result = {
            success: true,
            apiId: apiConfig.id,
            apiName: apiConfig.name,
            data: response.data,
            metadata: {
              url: apiConfig.url,
              status: response.status,
              statusText: response.statusText,
              responseTime,
              contentType: response.headers['content-type'] || 'unknown',
              contentLength: response.data.length,
              timestamp: new Date().toISOString(),
              attempt,
              headers: response.headers
            }
          };

          return result;

        } catch (error) {
          lastError = error;
          console.log(`❌ Attempt ${attempt}/${maxRetries} failed for ${apiConfig.name}: ${error.message}`);
          
          // Si no es el último intento, esperar antes de reintentar
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Backoff exponencial
            console.log(`⏱️ Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          }
        }
      }

      // Todos los reintentos fallaron
      const responseTime = Date.now() - startTime;
      this.updateStats(false, responseTime);

      const errorType = this.categorizeError(lastError);
      
      await this.configManager.updateApiStatus(apiConfig.id, 'error', {
        responseTime,
        error: lastError.message,
        errorType,
        attempts: maxRetries
      });

      console.log(`💥 All attempts failed for ${apiConfig.name}: ${lastError.message}`);

      return {
        success: false,
        apiId: apiConfig.id,
        apiName: apiConfig.name,
        error: lastError.message,
        errorType,
        attempts: maxRetries,
        responseTime,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.updateStats(false, responseTime);

      console.error(`💥 Unexpected error fetching ${apiConfig.name}:`, error.message);

      await this.configManager.updateApiStatus(apiConfig.id, 'error', {
        responseTime,
        error: error.message,
        errorType: 'unexpected'
      });

      return {
        success: false,
        apiId: apiConfig.id,
        apiName: apiConfig.name,
        error: error.message,
        errorType: 'unexpected',
        responseTime,
        timestamp: new Date().toISOString()
      };

    } finally {
      // Limpiar request activo
      this.activeRequests.delete(apiConfig.id);
    }
  }

  /**
   * Obtiene datos de todas las APIs habilitadas
   * @param {Object} options - Opciones de fetch
   * @returns {Promise<Array>} Array de resultados
   */
  async fetchAllApis(options = {}) {
    try {
      const enabledApis = await this.configManager.getEnabledApis();
      
      if (enabledApis.length === 0) {
        console.log('⚠️ No hay APIs habilitadas para obtener datos');
        return [];
      }

      console.log(`🚀 Fetching data from ${enabledApis.length} APIs...`);

      const fetchPromises = enabledApis.map(api => 
        this.fetchApiData(api).catch(error => ({
          success: false,
          apiId: api.id,
          apiName: api.name,
          error: error.message,
          timestamp: new Date().toISOString()
        }))
      );

      // Ejecutar todos los requests
      const results = options.sequential 
        ? await this.fetchSequentially(fetchPromises)
        : await Promise.all(fetchPromises);

      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      console.log(`📊 Fetch completed: ${successful.length} successful, ${failed.length} failed`);

      return {
        timestamp: new Date().toISOString(),
        total: results.length,
        successful: successful.length,
        failed: failed.length,
        results: results,
        stats: this.getStats()
      };

    } catch (error) {
      console.error('💥 Error in fetchAllApis:', error.message);
      throw error;
    }
  }

  /**
   * Ejecuta requests de forma secuencial
   * @param {Array} promises - Array de promesas
   * @returns {Promise<Array>} Resultados secuenciales
   */
  async fetchSequentially(promises) {
    const results = [];
    for (const promise of promises) {
      const result = await promise;
      results.push(result);
      // Pequeña pausa entre requests
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return results;
  }

  /**
   * Categoriza el tipo de error
   * @param {Error} error - Error a categorizar
   * @returns {string} Tipo de error
   */
  categorizeError(error) {
    if (error.code === 'ECONNABORTED') return 'timeout';
    if (error.code === 'ENOTFOUND') return 'dns_error';
    if (error.code === 'ECONNREFUSED') return 'connection_refused';
    if (error.code === 'ECONNRESET') return 'connection_reset';
    if (error.response?.status >= 400 && error.response?.status < 500) return 'client_error';
    if (error.response?.status >= 500) return 'server_error';
    if (error.message.includes('certificate')) return 'ssl_error';
    return 'unknown';
  }

  /**
   * Actualiza estadísticas internas
   * @param {boolean} success - Si fue exitoso
   * @param {number} responseTime - Tiempo de respuesta
   */
  updateStats(success, responseTime) {
    this.stats.totalRequests++;
    this.stats.totalResponseTime += responseTime;
    
    if (success) {
      this.stats.successfulRequests++;
    } else {
      this.stats.failedRequests++;
    }
  }

  /**
   * Obtiene estadísticas del fetcher
   * @returns {Object} Estadísticas
   */
  getStats() {
    return {
      ...this.stats,
      averageResponseTime: this.stats.totalRequests > 0 
        ? Math.round(this.stats.totalResponseTime / this.stats.totalRequests)
        : 0,
      successRate: this.stats.totalRequests > 0
        ? Math.round((this.stats.successfulRequests / this.stats.totalRequests) * 100)
        : 0,
      activeRequests: this.activeRequests.size
    };
  }

  /**
   * Resetea estadísticas
   */
  resetStats() {
    this.stats = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalResponseTime: 0,
      lastReset: new Date().toISOString()
    };
  }

  /**
   * Prueba conectividad de una URL
   * @param {string} url - URL a probar
   * @param {Object} options - Opciones adicionales
   * @returns {Promise<Object>} Resultado de la prueba
   */
  async testConnection(url, options = {}) {
    const startTime = Date.now();
    
    try {
      const response = await axios.get(url, {
        timeout: options.timeout || 5000,
        headers: {
          'User-Agent': 'XML-Aggregator/1.0',
          ...options.headers
        },
        validateStatus: () => true // Aceptar cualquier status
      });

      const responseTime = Date.now() - startTime;
      const isXml = (response.headers['content-type'] || '').toLowerCase().includes('xml');

      return {
        success: true,
        status: response.status,
        statusText: response.statusText,
        responseTime,
        contentType: response.headers['content-type'] || 'unknown',
        contentLength: typeof response.data === 'string' ? response.data.length : 0,
        isXml,
        preview: typeof response.data === 'string' 
          ? response.data.substring(0, 200) + (response.data.length > 200 ? '...' : '')
          : 'Binary data'
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        success: false,
        error: error.message,
        errorType: this.categorizeError(error),
        responseTime
      };
    }
  }

  /**
   * Obtiene información de requests activos
   * @returns {Array} Lista de requests activos
   */
  getActiveRequests() {
    return Array.from(this.activeRequests.entries()).map(([apiId, requestId]) => ({
      apiId,
      requestId,
      startTime: new Date(parseInt(requestId.split('_')[1])).toISOString()
    }));
  }
}

module.exports = DataFetcher;