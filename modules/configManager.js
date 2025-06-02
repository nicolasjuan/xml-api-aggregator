// modules/configManager.js
const fs = require('fs').promises;
const path = require('path');

class ConfigManager {
  constructor() {
    this.configPath = path.join(__dirname, '../config/apis.json');
    this.defaultConfig = {
      apis: [],
      settings: {
        cacheTime: 300,        // 5 minutos por defecto
        timeout: 5000,         // 5 segundos timeout
        retries: 3,            // 3 reintentos
        userAgent: 'XML-Aggregator/1.0',
        enableCors: true,
        port: 8080,
        logLevel: 'info'
      },
      lastModified: new Date().toISOString()
    };
  }

  /**
   * Carga la configuración desde el archivo JSON
   * @returns {Object} Configuración completa
   */
  async loadConfig() {
    try {
      // Verificar si el archivo existe
      await fs.access(this.configPath);
      const data = await fs.readFile(this.configPath, 'utf8');
      const config = JSON.parse(data);
      
      // Validar y mezclar con configuración por defecto
      return this.validateConfig(config);
    } catch (error) {
      if (error.code === 'ENOENT') {
        // Archivo no existe, crear configuración por defecto
        console.log('📁 Archivo de configuración no encontrado, creando uno nuevo...');
        await this.saveConfig(this.defaultConfig);
        return this.defaultConfig;
      }
      throw new Error(`Error al cargar configuración: ${error.message}`);
    }
  }

  /**
   * Guarda la configuración en el archivo JSON
   * @param {Object} config - Configuración a guardar
   */
  async saveConfig(config) {
    try {
      // Crear directorio si no existe
      await fs.mkdir(path.dirname(this.configPath), { recursive: true });
      
      // Actualizar timestamp
      config.lastModified = new Date().toISOString();
      
      // Validar antes de guardar
      const validConfig = this.validateConfig(config);
      
      // Guardar con formato legible
      await fs.writeFile(
        this.configPath, 
        JSON.stringify(validConfig, null, 2), 
        'utf8'
      );
      
      console.log('💾 Configuración guardada correctamente');
    } catch (error) {
      throw new Error(`Error al guardar configuración: ${error.message}`);
    }
  }

  /**
   * Valida y normaliza la configuración
   * @param {Object} config - Configuración a validar
   * @returns {Object} Configuración validada
   */
  validateConfig(config) {
    const validConfig = {
      ...this.defaultConfig,
      ...config
    };

    // Validar APIs
    if (Array.isArray(config.apis)) {
      validConfig.apis = config.apis.map((api, index) => {
        return {
          id: api.id || `api_${Date.now()}_${index}`,
          name: api.name || `API ${index + 1}`,
          url: api.url || '',
          interval: Math.max(30, parseInt(api.interval) || 300), // Mínimo 30 segundos
          enabled: api.enabled !== false, // True por defecto
          order: api.order || index,
          headers: api.headers || {},
          timeout: api.timeout || validConfig.settings.timeout,
          retries: api.retries || validConfig.settings.retries,
          lastFetch: api.lastFetch || null,
          lastStatus: api.lastStatus || 'pending'
        };
      });
    }

    // Validar settings
    if (config.settings) {
      validConfig.settings = {
        ...this.defaultConfig.settings,
        ...config.settings,
        cacheTime: Math.max(30, parseInt(config.settings.cacheTime) || 300),
        timeout: Math.max(1000, parseInt(config.settings.timeout) || 5000),
        retries: Math.max(1, parseInt(config.settings.retries) || 3),
        port: Math.max(1024, parseInt(config.settings.port) || 8080)
      };
    }

    return validConfig;
  }

  /**
   * Agrega una nueva API a la configuración
   * @param {Object} apiData - Datos de la nueva API
   * @returns {Object} API agregada con ID generado
   */
  async addApi(apiData) {
    const config = await this.loadConfig();
    
    const newApi = {
      id: `api_${Date.now()}`,
      name: apiData.name || 'Nueva API',
      url: apiData.url || '',
      interval: Math.max(30, parseInt(apiData.interval) || 300),
      enabled: apiData.enabled !== false,
      order: config.apis.length,
      headers: apiData.headers || {},
      timeout: apiData.timeout || config.settings.timeout,
      retries: apiData.retries || config.settings.retries,
      lastFetch: null,
      lastStatus: 'pending'
    };

    config.apis.push(newApi);
    await this.saveConfig(config);
    
    return newApi;
  }

  /**
   * Elimina una API por ID
   * @param {string} apiId - ID de la API a eliminar
   * @returns {boolean} True si se eliminó correctamente
   */
  async removeApi(apiId) {
    const config = await this.loadConfig();
    const initialLength = config.apis.length;
    
    config.apis = config.apis.filter(api => api.id !== apiId);
    
    if (config.apis.length < initialLength) {
      await this.saveConfig(config);
      return true;
    }
    
    return false;
  }

  /**
   * Actualiza una API existente
   * @param {string} apiId - ID de la API a actualizar
   * @param {Object} updateData - Datos a actualizar
   * @returns {Object|null} API actualizada o null si no existe
   */
  async updateApi(apiId, updateData) {
    const config = await this.loadConfig();
    const apiIndex = config.apis.findIndex(api => api.id === apiId);
    
    if (apiIndex === -1) {
      return null;
    }

    // Actualizar campos específicos
    config.apis[apiIndex] = {
      ...config.apis[apiIndex],
      ...updateData,
      id: apiId, // Preservar ID
      lastModified: new Date().toISOString()
    };

    await this.saveConfig(config);
    return config.apis[apiIndex];
  }

  /**
   * Reordena las APIs según un array de IDs
   * @param {Array} orderedIds - Array con el orden deseado de IDs
   */
  async reorderApis(orderedIds) {
    const config = await this.loadConfig();
    
    const reorderedApis = orderedIds
      .map(id => config.apis.find(api => api.id === id))
      .filter(Boolean)
      .map((api, index) => ({ ...api, order: index }));

    // Agregar APIs que no estaban en la lista ordenada
    const missingApis = config.apis
      .filter(api => !orderedIds.includes(api.id))
      .map((api, index) => ({ ...api, order: reorderedApis.length + index }));

    config.apis = [...reorderedApis, ...missingApis];
    await this.saveConfig(config);
  }

  /**
   * Obtiene solo las APIs habilitadas ordenadas
   * @returns {Array} APIs habilitadas
   */
  async getEnabledApis() {
    const config = await this.loadConfig();
    return config.apis
      .filter(api => api.enabled && api.url)
      .sort((a, b) => a.order - b.order);
  }

  /**
   * Actualiza el estado de una API después de un fetch
   * @param {string} apiId - ID de la API
   * @param {string} status - Estado ('success', 'error', 'timeout')
   * @param {Object} metadata - Metadatos adicionales
   */
  async updateApiStatus(apiId, status, metadata = {}) {
    const config = await this.loadConfig();
    const apiIndex = config.apis.findIndex(api => api.id === apiId);
    
    if (apiIndex !== -1) {
      config.apis[apiIndex].lastFetch = new Date().toISOString();
      config.apis[apiIndex].lastStatus = status;
      
      if (metadata.responseTime) {
        config.apis[apiIndex].lastResponseTime = metadata.responseTime;
      }
      
      if (metadata.error) {
        config.apis[apiIndex].lastError = metadata.error;
      }

      await this.saveConfig(config);
    }
  }
}

module.exports = ConfigManager;