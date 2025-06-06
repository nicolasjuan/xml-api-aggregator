// modules/aggregatorService.js
const DataFetcher = require('./dataFetcher');
const XmlProcessor = require('./xmlProcessor');
const ConfigManager = require('./configManager');

class AggregatorService {
  constructor() {
    this.dataFetcher = new DataFetcher();
    this.xmlProcessor = new XmlProcessor();
    this.configManager = new ConfigManager();
    
    // Estadísticas del servicio
    this.stats = {
      totalAggregations: 0,
      successfulAggregations: 0,
      failedAggregations: 0,
      totalProcessingTime: 0,
      lastReset: new Date().toISOString()
    };
  }

  /**
   * Agrega XMLs de todas las fuentes habilitadas
   * @param {Object} options - Opciones de agregación
   * @returns {Promise<Object>} Resultado de la agregación
   */
  async aggregateAllSources(options = {}) {
    const startTime = Date.now();
    
    try {
      console.log('🔄 Iniciando agregación de fuentes XML...');
      this.stats.totalAggregations++;

      // Paso 1: Validar que hay APIs habilitadas
      const enabledApis = await this.configManager.getEnabledApis();
      
      if (enabledApis.length === 0) {
        return this._createWarningResponse(
          'No hay APIs habilitadas configuradas',
          { totalSources: 0 }
        );
      }

      console.log(`📡 Obteniendo datos de ${enabledApis.length} APIs...`);

      // Paso 2: Obtener datos de todas las APIs
      const fetchOptions = {
        sequential: options.sequential === true,
        timeout: options.timeout
      };
      
      const fetchResults = await this.dataFetcher.fetchAllApis(fetchOptions);
      const successfulFetches = fetchResults.results.filter(r => r.success);

      if (successfulFetches.length === 0) {
        return this._createErrorResponse(
          'No se pudieron obtener datos de ninguna API',
          503,
          {
            totalSources: enabledApis.length,
            fetchErrors: fetchResults.results.map(r => ({
              apiId: r.apiId,
              apiName: r.apiName,
              error: r.error,
              errorType: r.errorType
            })),
            fetchStats: fetchResults.stats
          }
        );
      }

      console.log(`✅ Datos obtenidos de ${successfulFetches.length}/${enabledApis.length} APIs`);

      // Paso 3: Validar XMLs (sin parsear completamente)
      const validatedSources = await this._validateXmlSources(successfulFetches);
      const validSources = validatedSources.filter(s => s.isValid);

      if (validSources.length === 0) {
        return this._createErrorResponse(
          'No se encontraron fuentes XML válidas',
          422,
          {
            totalSources: enabledApis.length,
            fetchedSources: successfulFetches.length,
            validationErrors: validatedSources.map(s => ({
              apiId: s.apiId,
              apiName: s.apiName,
              error: s.validationError
            }))
          }
        );
      }

      console.log(`🔍 XMLs validados: ${validSources.length}/${successfulFetches.length} válidos`);

      // Paso 4: Crear XML agregado manteniendo estructura original
      const aggregationResult = await this._createAggregatedXml(validSources, options);

      if (!aggregationResult.success) {
        return this._createErrorResponse(
          'Error creando XML agregado',
          500,
          { error: aggregationResult.error }
        );
      }

      // Paso 5: Preparar respuesta exitosa
      const processingTime = Date.now() - startTime;
      this.stats.successfulAggregations++;
      this.stats.totalProcessingTime += processingTime;

      console.log(`✅ Agregación completada: ${validSources.length} fuentes en ${processingTime}ms`);

      return this._createSuccessResponse(aggregationResult, {
        totalConfiguredApis: enabledApis.length,
        successfulFetches: successfulFetches.length,
        validSources: validSources.length,
        processingTime,
        fetchStats: fetchResults.stats,
        options
      });

    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.stats.failedAggregations++;
      
      console.error('❌ Error en agregación:', error.message);
      
      return this._createErrorResponse(
        'Error interno durante la agregación',
        500,
        { 
          error: process.env.NODE_ENV === 'development' ? error.message : 'Error interno',
          processingTime
        }
      );
    }
  }

  /**
   * Valida que las fuentes contengan XML válido
   * @param {Array} fetchResults - Resultados del fetch
   * @returns {Promise<Array>} Fuentes validadas
   */
  async _validateXmlSources(fetchResults) {
    const validatedSources = [];

    for (const fetchResult of fetchResults) {
      try {
        // Validación básica sin parsear completamente
        const validation = this.xmlProcessor.validateXml(fetchResult.data);
        
        const sourceInfo = {
          ...fetchResult,
          isValid: validation.isValid,
          validationError: validation.error || null,
          xmlPreview: validation.isValid 
            ? this._getXmlPreview(fetchResult.data)
            : null
        };

        validatedSources.push(sourceInfo);

      } catch (error) {
        validatedSources.push({
          ...fetchResult,
          isValid: false,
          validationError: `Validation error: ${error.message}`
        });
      }
    }

    return validatedSources;
  }

  /**
   * Crea el XML agregado manteniendo estructura original
   * @param {Array} validSources - Fuentes XML válidas
   * @param {Object} options - Opciones de agregación
   * @returns {Promise<Object>} XML agregado
   */
  async _createAggregatedXml(validSources, options = {}) {
    try {
      const timestamp = new Date().toISOString();
      
      // Crear XML agregado manualmente para mantener estructura original
      let aggregatedXml = '<?xml version="1.0" encoding="UTF-8"?>\n';
      aggregatedXml += `<xml-aggregator version="1.0" timestamp="${timestamp}" sources="${validSources.length}">\n`;
      
      // Metadatos del agregado
      aggregatedXml += '  <metadata>\n';
      aggregatedXml += `    <generated>${timestamp}</generated>\n`;
      aggregatedXml += `    <totalSources>${validSources.length}</totalSources>\n`;
      aggregatedXml += `    <generator>XML-API-Aggregator</generator>\n`;
      aggregatedXml += `    <version>1.0</version>\n`;
      
      // Lista de fuentes en metadatos
      aggregatedXml += '    <sources>\n';
      for (const source of validSources) {
        aggregatedXml += `      <source id="${this._escapeXml(source.apiId)}" name="${this._escapeXml(source.apiName)}" />\n`;
      }
      aggregatedXml += '    </sources>\n';
      aggregatedXml += '  </metadata>\n';

      // Agregar cada fuente XML manteniendo su estructura original
      for (const source of validSources) {
        const sourceAttrs = [
          `id="${this._escapeXml(source.apiId)}"`,
          `name="${this._escapeXml(source.apiName)}"`,
          `url="${this._escapeXml(source.metadata?.url || 'unknown')}"`,
          `timestamp="${this._escapeXml(source.metadata?.timestamp || timestamp)}"`,
          `status="success"`,
          `content-type="${this._escapeXml(source.metadata?.contentType || 'application/xml')}"`,
          `content-length="${source.metadata?.contentLength || source.data.length}"`
        ];

        aggregatedXml += `  <source ${sourceAttrs.join(' ')}>\n`;
        
        // Insertar XML original con indentación
        const indentedXml = this._indentXml(source.data, '    ');
        aggregatedXml += indentedXml;
        
        if (!indentedXml.endsWith('\n')) {
          aggregatedXml += '\n';
        }
        
        aggregatedXml += '  </source>\n';
      }

      aggregatedXml += '</xml-aggregator>';

      // Crear estructura de datos para respuestas JSON
      const structure = {
        'xml-aggregator': {
          '@_version': '1.0',
          '@_timestamp': timestamp,
          '@_sources': validSources.length,
          metadata: {
            generated: timestamp,
            totalSources: validSources.length,
            generator: 'XML-API-Aggregator',
            version: '1.0',
            sources: validSources.map(s => ({
              '@_id': s.apiId,
              '@_name': s.apiName
            }))
          },
          sources: validSources.map(s => ({
            '@_id': s.apiId,
            '@_name': s.apiName,
            '@_url': s.metadata?.url || 'unknown',
            '@_timestamp': s.metadata?.timestamp || timestamp,
            '@_status': 'success',
            xmlContent: s.data // XML original como string
          }))
        }
      };

      return {
        success: true,
        xml: aggregatedXml,
        structure: structure,
        sources: validSources.map(s => ({
          id: s.apiId,
          name: s.apiName,
          url: s.metadata?.url,
          timestamp: s.metadata?.timestamp,
          contentLength: s.data.length,
          preview: this._getXmlPreview(s.data, 200)
        }))
      };

    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Indenta XML para incluirlo dentro del agregado
   * @param {string} xmlString - XML a indentar
   * @param {string} indent - String de indentación
   * @returns {string} XML indentado
   */
  _indentXml(xmlString, indent = '  ') {
    try {
      // Remover declaración XML si existe (ya está en el agregado)
      let cleanXml = xmlString.replace(/<\?xml[^>]*\?>\s*/, '');
      
      // Indentación simple línea por línea
      return cleanXml
        .split('\n')
        .map(line => line.trim() ? indent + line : line)
        .join('\n');
        
    } catch (error) {
      // Si falla la indentación, devolver XML original con indentación básica
      return xmlString.split('\n').map(line => indent + line).join('\n');
    }
  }

  /**
   * Escapa caracteres especiales XML
   * @param {string} str - String a escapar
   * @returns {string} String escapado
   */
  _escapeXml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Obtiene preview de XML
   * @param {string} xmlString - XML string
   * @param {number} maxLength - Longitud máxima
   * @returns {string} Preview
   */
  _getXmlPreview(xmlString, maxLength = 300) {
    if (!xmlString) return 'No XML content';
    
    const preview = xmlString.trim();
    return preview.length > maxLength 
      ? preview.substring(0, maxLength) + '...'
      : preview;
  }

  /**
   * Crea respuesta de éxito estandarizada
   * @param {Object} aggregationResult - Resultado de agregación
   * @param {Object} summary - Resumen de procesamiento
   * @returns {Object} Respuesta estandarizada
   */
  _createSuccessResponse(aggregationResult, summary) {
    return {
      status: 'success',
      timestamp: new Date().toISOString(),
      summary,
      metadata: {
        sources: aggregationResult.sources
      },
      aggregatedXml: aggregationResult.xml,
      aggregatedStructure: aggregationResult.structure,
      stats: this.getStats()
    };
  }

  /**
   * Crea respuesta de advertencia estandarizada
   * @param {string} message - Mensaje de advertencia
   * @param {Object} data - Datos adicionales
   * @returns {Object} Respuesta de advertencia
   */
  _createWarningResponse(message, data = {}) {
    return {
      status: 'warning',
      message,
      timestamp: new Date().toISOString(),
      ...data,
      aggregatedXml: null,
      stats: this.getStats()
    };
  }

  /**
   * Crea respuesta de error estandarizada
   * @param {string} message - Mensaje de error
   * @param {number} statusCode - Código de estado HTTP
   * @param {Object} data - Datos adicionales
   * @returns {Object} Respuesta de error
   */
  _createErrorResponse(message, statusCode = 500, data = {}) {
    return {
      status: 'error',
      statusCode,
      message,
      timestamp: new Date().toISOString(),
      ...data,
      stats: this.getStats()
    };
  }

  /**
   * Obtiene estadísticas del servicio
   * @returns {Object} Estadísticas
   */
  getStats() {
    return {
      ...this.stats,
      averageProcessingTime: this.stats.totalAggregations > 0
        ? Math.round(this.stats.totalProcessingTime / this.stats.totalAggregations)
        : 0,
      successRate: this.stats.totalAggregations > 0
        ? Math.round((this.stats.successfulAggregations / this.stats.totalAggregations) * 100)
        : 0
    };
  }

  /**
   * Resetea estadísticas del servicio
   */
  resetStats() {
    this.stats = {
      totalAggregations: 0,
      successfulAggregations: 0,
      failedAggregations: 0,
      totalProcessingTime: 0,
      lastReset: new Date().toISOString()
    };
  }

  /**
   * Obtiene configuración de fuentes activas
   * @returns {Promise<Object>} Información de configuración
   */
  async getSourcesInfo() {
    try {
      const config = await this.configManager.loadConfig();
      const enabledApis = await this.configManager.getEnabledApis();
      
      return {
        total: config.apis.length,
        enabled: enabledApis.length,
        disabled: config.apis.length - enabledApis.length,
        apis: enabledApis.map(api => ({
          id: api.id,
          name: api.name,
          url: api.url,
          enabled: api.enabled,
          lastStatus: api.lastStatus || 'unknown'
        }))
      };
    } catch (error) {
      throw new Error(`Error getting sources info: ${error.message}`);
    }
  }
}

module.exports = AggregatorService;