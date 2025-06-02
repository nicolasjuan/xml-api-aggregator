// modules/cacheManager.js
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

class CacheManager {
  constructor() {
    this.cacheDir = path.join(__dirname, '../cache');
    this.memoryCache = new Map();
    this.defaultTtl = 300000; // 5 minutos en ms
    this.maxMemorySize = 50; // Máximo 50 elementos en memoria
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      totalSize: 0,
      lastReset: new Date().toISOString()
    };
  }

  /**
   * Inicializa el cache manager
   */
  async initialize() {
    try {
      // Crear directorio de cache si no existe
      await fs.mkdir(this.cacheDir, { recursive: true });
      
      // Limpiar cache expirado al inicializar
      await this.cleanExpiredCache();
      
      console.log('💾 Cache Manager inicializado correctamente');
    } catch (error) {
      console.error('❌ Error inicializando Cache Manager:', error.message);
      throw error;
    }
  }

  /**
   * Genera una clave de cache única
   * @param {string} apiId - ID de la API
   * @param {Object} params - Parámetros adicionales
   * @returns {string} Clave de cache
   */
  generateCacheKey(apiId, params = {}) {
    const keyData = {
      apiId,
      ...params,
      timestamp: Math.floor(Date.now() / 60000) // Granularidad por minuto
    };
    
    return crypto
      .createHash('md5')
      .update(JSON.stringify(keyData))
      .digest('hex');
  }

  /**
   * Obtiene datos del cache
   * @param {string} key - Clave de cache
   * @returns {Promise<Object|null>} Datos cacheados o null
   */
  async get(key) {
    try {
      // Primero verificar cache en memoria
      const memoryData = this.memoryCache.get(key);
      if (memoryData && !this.isExpired(memoryData)) {
        this.stats.hits++;
        return memoryData.data;
      }

      // Si no está en memoria, verificar cache en disco
      const diskData = await this.getFromDisk(key);
      if (diskData && !this.isExpired(diskData)) {
        // Mover a memoria para acceso rápido
        this.setInMemory(key, diskData.data, diskData.ttl);
        this.stats.hits++;
        return diskData.data;
      }

      this.stats.misses++;
      return null;

    } catch (error) {
      console.warn('⚠️ Error obteniendo del cache:', error.message);
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Almacena datos en el cache
   * @param {string} key - Clave de cache
   * @param {*} data - Datos a cachear
   * @param {number} ttl - Time to live en milisegundos
   * @returns {Promise<boolean>} True si se guardó correctamente
   */
  async set(key, data, ttl = this.defaultTtl) {
    try {
      const cacheData = {
        data,
        timestamp: Date.now(),
        ttl,
        expiresAt: Date.now() + ttl
      };

      // Guardar en memoria
      this.setInMemory(key, data, ttl);

      // Guardar en disco para persistencia
      await this.setOnDisk(key, cacheData);

      this.stats.sets++;
      this.stats.totalSize = this.memoryCache.size;

      return true;

    } catch (error) {
      console.error('❌ Error guardando en cache:', error.message);
      return false;
    }
  }

  /**
   * Elimina una entrada del cache
   * @param {string} key - Clave a eliminar
   * @returns {Promise<boolean>} True si se eliminó
   */
  async delete(key) {
    try {
      // Eliminar de memoria
      const memoryDeleted = this.memoryCache.delete(key);

      // Eliminar de disco
      const diskPath = this.getDiskPath(key);
      try {
        await fs.unlink(diskPath);
      } catch (error) {
        // Archivo no existe, no es error
      }

      if (memoryDeleted) {
        this.stats.deletes++;
        this.stats.totalSize = this.memoryCache.size;
      }

      return memoryDeleted;

    } catch (error) {
      console.warn('⚠️ Error eliminando del cache:', error.message);
      return false;
    }
  }

  /**
   * Limpia todo el cache
   * @returns {Promise<void>}
   */
  async clear() {
    try {
      // Limpiar memoria
      this.memoryCache.clear();

      // Limpiar disco
      const files = await fs.readdir(this.cacheDir);
      const deletePromises = files
        .filter(file => file.endsWith('.cache'))
        .map(file => fs.unlink(path.join(this.cacheDir, file)).catch(() => {}));

      await Promise.all(deletePromises);

      console.log('🧹 Cache limpiado completamente');
      this.stats.totalSize = 0;

    } catch (error) {
      console.error('❌ Error limpiando cache:', error.message);
    }
  }

  /**
   * Limpia entradas expiradas
   * @returns {Promise<number>} Número de entradas eliminadas
   */
  async cleanExpiredCache() {
    let cleaned = 0;

    try {
      const now = Date.now();

      // Limpiar memoria
      for (const [key, data] of this.memoryCache.entries()) {
        if (this.isExpired(data)) {
          this.memoryCache.delete(key);
          cleaned++;
        }
      }

      // Limpiar disco
      const files = await fs.readdir(this.cacheDir);
      
      for (const file of files) {
        if (!file.endsWith('.cache')) continue;

        try {
          const filePath = path.join(this.cacheDir, file);
          const content = await fs.readFile(filePath, 'utf8');
          const data = JSON.parse(content);

          if (this.isExpired(data)) {
            await fs.unlink(filePath);
            cleaned++;
          }
        } catch (error) {
          // Si hay error leyendo el archivo, eliminarlo
          await fs.unlink(path.join(this.cacheDir, file)).catch(() => {});
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.log(`🧹 Limpiadas ${cleaned} entradas expiradas del cache`);
      }

      this.stats.totalSize = this.memoryCache.size;
      return cleaned;

    } catch (error) {
      console.error('❌ Error limpiando cache expirado:', error.message);
      return 0;
    }
  }

  /**
   * Almacena datos específicos de API con TTL inteligente
   * @param {string} apiId - ID de la API
   * @param {Object} data - Datos de la API
   * @param {number} interval - Intervalo de fetch de la API
   * @returns {Promise<boolean>}
   */
  async setApiData(apiId, data, interval = 300) {
    // TTL basado en el intervalo de la API (50% del intervalo)
    const ttl = Math.max(30000, (interval * 1000) * 0.5);
    const key = `api_${apiId}`;
    
    return await this.set(key, {
      ...data,
      cached: true,
      cacheTimestamp: new Date().toISOString()
    }, ttl);
  }

  /**
   * Obtiene datos específicos de API
   * @param {string} apiId - ID de la API
   * @returns {Promise<Object|null>}
   */
  async getApiData(apiId) {
    const key = `api_${apiId}`;
    return await this.get(key);
  }

  /**
   * Cachea datos agregados
   * @param {Object} aggregatedData - Datos agregados
   * @param {number} ttl - TTL personalizado
   * @returns {Promise<boolean>}
   */
  async setAggregatedData(aggregatedData, ttl = 60000) {
    const key = 'aggregated_xml';
    return await this.set(key, aggregatedData, ttl);
  }

  /**
   * Obtiene datos agregados cacheados
   * @returns {Promise<Object|null>}
   */
  async getAggregatedData() {
    return await this.get('aggregated_xml');
  }

  /**
   * Guarda en memoria con control de tamaño
   * @private
   */
  setInMemory(key, data, ttl) {
    // Si el cache está lleno, eliminar el más antiguo
    if (this.memoryCache.size >= this.maxMemorySize) {
      const oldestKey = this.memoryCache.keys().next().value;
      this.memoryCache.delete(oldestKey);
      this.stats.evictions++;
    }

    this.memoryCache.set(key, {
      data,
      timestamp: Date.now(),
      ttl,
      expiresAt: Date.now() + ttl
    });
  }

  /**
   * Obtiene datos del disco
   * @private
   */
  async getFromDisk(key) {
    try {
      const filePath = this.getDiskPath(key);
      const content = await fs.readFile(filePath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }

  /**
   * Guarda datos en disco
   * @private
   */
  async setOnDisk(key, data) {
    const filePath = this.getDiskPath(key);
    await fs.writeFile(filePath, JSON.stringify(data), 'utf8');
  }

  /**
   * Genera ruta de archivo en disco
   * @private
   */
  getDiskPath(key) {
    return path.join(this.cacheDir, `${key}.cache`);
  }

  /**
   * Verifica si una entrada está expirada
   * @private
   */
  isExpired(data) {
    return Date.now() > data.expiresAt;
  }

  /**
   * Obtiene estadísticas del cache
   * @returns {Object} Estadísticas
   */
  getStats() {
    const hitRate = this.stats.hits + this.stats.misses > 0
      ? Math.round((this.stats.hits / (this.stats.hits + this.stats.misses)) * 100)
      : 0;

    return {
      ...this.stats,
      hitRate,
      memorySize: this.memoryCache.size,
      maxMemorySize: this.maxMemorySize
    };
  }

  /**
   * Resetea estadísticas
   */
  resetStats() {
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      evictions: 0,
      totalSize: this.memoryCache.size,
      lastReset: new Date().toISOString()
    };
  }

  /**
   * Configura parámetros del cache
   * @param {Object} config - Configuración
   */
  configure(config) {
    if (config.defaultTtl) this.defaultTtl = config.defaultTtl;
    if (config.maxMemorySize) this.maxMemorySize = config.maxMemorySize;
  }

  /**
   * Obtiene información de debug del cache
   * @returns {Object} Información de debug
   */
  getDebugInfo() {
    const memoryKeys = Array.from(this.memoryCache.keys());
    const memoryInfo = memoryKeys.map(key => {
      const data = this.memoryCache.get(key);
      return {
        key,
        size: JSON.stringify(data.data).length,
        expiresIn: Math.max(0, data.expiresAt - Date.now()),
        expired: this.isExpired(data)
      };
    });

    return {
      memoryCache: memoryInfo,
      stats: this.getStats(),
      cacheDir: this.cacheDir
    };
  }
}

module.exports = CacheManager;