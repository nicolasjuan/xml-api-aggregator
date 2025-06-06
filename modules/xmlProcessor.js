// modules/xmlProcessor.js
const { XMLParser, XMLBuilder } = require('fast-xml-parser');

class XmlProcessor {
  constructor() {
    // Configuración del parser XML
    this.parserOptions = {
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      parseAttributeValue: true,
      parseTrueNumberOnly: false,
      trimValues: true,
      ignoreNameSpace: false,
      removeNSPrefix: false,
      allowBooleanAttributes: true,
      parseNodeValue: true,
      parseTagValue: true,
      processEntities: true,
      htmlEntities: true
    };

    // Configuración del builder XML
    this.builderOptions = {
      ignoreAttributes: false,
      attributeNamePrefix: '@_',
      textNodeName: '#text',
      format: true,
      indentBy: '  ',
      suppressEmptyNode: false,
      suppressBooleanAttributes: false
    };

    this.parser = new XMLParser(this.parserOptions);
    this.builder = new XMLBuilder(this.builderOptions);

    // Estadísticas de procesamiento
    this.stats = {
      totalProcessed: 0,
      successfulParsing: 0,
      failedParsing: 0,
      totalAggregations: 0,
      lastReset: new Date().toISOString()
    };
  }

  /**
   * Procesa datos XML crudos de una fuente
   * @param {Object} fetchResult - Resultado del data fetcher
   * @returns {Object} Datos procesados
   */
  async processXmlData(fetchResult) {
    const startTime = Date.now();

    try {
      if (!fetchResult.success || !fetchResult.data) {
        return {
          success: false,
          apiId: fetchResult.apiId,
          apiName: fetchResult.apiName,
          error: 'No data to process',
          timestamp: new Date().toISOString()
        };
      }

      console.log(`🔄 Processing XML data from ${fetchResult.apiName}...`);

      // Validar que sea XML válido
      const xmlValidation = this.validateXml(fetchResult.data);
      if (!xmlValidation.isValid) {
        this.stats.failedParsing++;
        return {
          success: false,
          apiId: fetchResult.apiId,
          apiName: fetchResult.apiName,
          error: `Invalid XML: ${xmlValidation.error}`,
          rawDataPreview: fetchResult.data.substring(0, 500),
          timestamp: new Date().toISOString()
        };
      }

      // Parsear XML a objeto JavaScript
      const parsedData = this.parser.parse(fetchResult.data);

      // Extraer metadatos del XML
      const metadata = this.extractXmlMetadata(fetchResult.data, parsedData);

      // Normalizar estructura
      const normalizedData = this.normalizeXmlStructure(parsedData);

      const processingTime = Date.now() - startTime;
      this.stats.totalProcessed++;
      this.stats.successfulParsing++;

      console.log(`✅ XML processed successfully from ${fetchResult.apiName} (${processingTime}ms)`);

      return {
        success: true,
        apiId: fetchResult.apiId,
        apiName: fetchResult.apiName,
        originalMetadata: fetchResult.metadata,
        xmlMetadata: metadata,
        rawData: fetchResult.data,
        parsedData: normalizedData,
        processingTime,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      this.stats.failedParsing++;
      console.error(`❌ Error processing XML from ${fetchResult.apiName}:`, error.message);

      return {
        success: false,
        apiId: fetchResult.apiId,
        apiName: fetchResult.apiName,
        error: error.message,
        rawDataPreview: fetchResult.data ? fetchResult.data.substring(0, 500) : 'No data',
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Procesa múltiples resultados XML
   * @param {Array} fetchResults - Array de resultados del fetcher
   * @returns {Object} Resultados procesados
   */
  async processMultipleXmlData(fetchResults) {
    if (!Array.isArray(fetchResults)) {
      throw new Error('Expected array of fetch results');
    }

    console.log(`🚀 Processing ${fetchResults.length} XML sources...`);

    const processedResults = [];

    for (const fetchResult of fetchResults) {
      const processed = await this.processXmlData(fetchResult);
      processedResults.push(processed);
    }

    const successful = processedResults.filter(r => r.success);
    const failed = processedResults.filter(r => !r.success);

    console.log(`📊 XML processing completed: ${successful.length} successful, ${failed.length} failed`);

    return {
      timestamp: new Date().toISOString(),
      total: processedResults.length,
      successful: successful.length,
      failed: failed.length,
      results: processedResults,
      stats: this.getStats()
    };
  }

  /**
   * Agrega múltiples fuentes XML en una estructura unificada
   * @param {Array} processedResults - Resultados procesados
   * @param {Object} options - Opciones de agregación
   * @returns {Object} XML agregado
   */
  async aggregateXmlSources(processedResults, options = {}) {
    try {
      console.log('🔄 Aggregating XML sources...');
      const startTime = Date.now();

      const successfulResults = processedResults.filter(r => r.success);

      if (successfulResults.length === 0) {
        throw new Error('No successful XML sources to aggregate');
      }

      // Estructura base del XML agregado
      const aggregatedStructure = {
        'xml-aggregator': {
          '@_version': '1.0',
          '@_timestamp': new Date().toISOString(),
          '@_sources': successfulResults.length,
          metadata: {
            generated: new Date().toISOString(),
            totalSources: successfulResults.length,
            processingTime: 0, // Se calculará al final
            sources: successfulResults.map(r => ({
              id: r.apiId,
              name: r.apiName,
              url: r.originalMetadata?.url || 'unknown',
              lastFetch: r.originalMetadata?.timestamp || new Date().toISOString(),
              status: 'success'
            }))
          },
          data: {
            sources: []
          }
        }
      };

      // Agregar datos de cada fuente
      for (const result of successfulResults) {
        const sourceData = {
          '@_id': result.apiId,
          '@_name': result.apiName,
          '@_timestamp': result.timestamp,
          content: result.parsedData
        };

        aggregatedStructure['xml-aggregator'].data.sources.push(sourceData);
      }

      // Aplicar opciones de agregación
      if (options.mergeStrategy) {
        this.applyMergeStrategy(aggregatedStructure, options.mergeStrategy);
      }

      // Generar XML final
      const aggregatedXml = this.builder.build(aggregatedStructure);

      const processingTime = Date.now() - startTime;
      aggregatedStructure['xml-aggregator'].metadata.processingTime = processingTime;

      this.stats.totalAggregations++;

      console.log(`✅ XML aggregation completed (${processingTime}ms)`);

      return {
        success: true,
        xml: aggregatedXml,
        structure: aggregatedStructure,
        metadata: {
          totalSources: successfulResults.length,
          processingTime,
          timestamp: new Date().toISOString(),
          options: options
        }
      };

    } catch (error) {
      console.error('❌ Error aggregating XML sources:', error.message);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Valida si un string es XML válido
   * @param {string} xmlString - String XML a validar
   * @returns {Object} Resultado de validación
   */
  validateXml(xmlString) {
    try {
      if (!xmlString || typeof xmlString !== 'string') {
        return { isValid: false, error: 'No data or invalid data type' };
      }

      // Verificar que comience con declaración XML o tag
      const trimmed = xmlString.trim();
      if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<')) {
        return { isValid: false, error: 'Does not start with XML declaration or tag' };
      }

      // Intentar parsear
      this.parser.parse(xmlString);

      return { isValid: true };
    } catch (error) {
      return {
        isValid: false,
        error: error.message
      };
    }
  }

  /**
   * Extrae metadatos del XML
   * @param {string} rawXml - XML crudo
   * @param {Object} parsedXml - XML parseado
   * @returns {Object} Metadatos extraídos
   */
  extractXmlMetadata(rawXml, parsedXml) {
    const metadata = {
      size: rawXml.length,
      rootElement: null,
      encoding: 'utf-8',
      version: '1.0',
      namespaces: [],
      elementCount: 0,
      hasAttributes: false
    };

    try {
      // Extraer declaración XML
      const xmlDeclaration = rawXml.match(/<\?xml[^>]*\?>/);
      if (xmlDeclaration) {
        const versionMatch = xmlDeclaration[0].match(/version=["']([^"']+)["']/);
        const encodingMatch = xmlDeclaration[0].match(/encoding=["']([^"']+)["']/);

        if (versionMatch) metadata.version = versionMatch[1];
        if (encodingMatch) metadata.encoding = encodingMatch[1];
      }

      // Encontrar elemento raíz
      const rootKeys = Object.keys(parsedXml);
      if (rootKeys.length > 0) {
        metadata.rootElement = rootKeys[0];
      }

      // Contar elementos aproximado
      metadata.elementCount = this.countXmlElements(rawXml);

      // Detectar atributos
      metadata.hasAttributes = rawXml.includes('@_') || /<[^>]+\s+\w+\s*=/.test(rawXml);

      // Extraer namespaces
      const namespaceMatches = rawXml.match(/xmlns[^=]*=["'][^"']*["']/g);
      if (namespaceMatches) {
        metadata.namespaces = namespaceMatches.map(ns => {
          const parts = ns.split('=');
          return {
            prefix: parts[0].replace('xmlns:', '').replace('xmlns', 'default'),
            uri: parts[1].replace(/["']/g, '')
          };
        });
      }

    } catch (error) {
      console.warn('Warning extracting XML metadata:', error.message);
    }

    return metadata;
  }

  /**
   * Normaliza la estructura XML parseada
   * @param {Object} parsedData - Datos parseados
   * @returns {Object} Datos normalizados
   */
  normalizeXmlStructure(parsedData) {
    // Por ahora retorna los datos tal como están
    // Aquí se pueden implementar transformaciones específicas
    return parsedData;
  }

  /**
   * Cuenta elementos XML aproximadamente
   * @param {string} xmlString - String XML
   * @returns {number} Número aproximado de elementos
   */
  countXmlElements(xmlString) {
    const matches = xmlString.match(/<[^/!?][^>]*>/g);
    return matches ? matches.length : 0;
  }

  /**
   * Aplica estrategia de merge personalizada
   * @param {Object} structure - Estructura a modificar
   * @param {string} strategy - Estrategia de merge
   */
  applyMergeStrategy(structure, strategy) {
    switch (strategy) {
      case 'flatten':
        // Implementar lógica de aplanamiento
        break;
      case 'group-by-type':
        // Implementar agrupación por tipo
        break;
      default:
        // Sin cambios
        break;
    }
  }

  /**
   * Convierte objeto JavaScript de vuelta a XML
   * @param {Object} data - Datos a convertir
   * @param {Object} options - Opciones de construcción
   * @returns {string} XML string
   */
  buildXml(data, options = {}) {
    try {
      const builderOptions = { ...this.builderOptions, ...options };
      const builder = new XMLBuilder(builderOptions);
      return builder.build(data);
    } catch (error) {
      throw new Error(`Error building XML: ${error.message}`);
    }
  }

  /**
   * Obtiene estadísticas del procesador
   * @returns {Object} Estadísticas
   */
  getStats() {
    return {
      ...this.stats,
      successRate: this.stats.totalProcessed > 0
        ? Math.round((this.stats.successfulParsing / this.stats.totalProcessed) * 100)
        : 0
    };
  }

  /**
   * Resetea estadísticas
   */
  resetStats() {
    this.stats = {
      totalProcessed: 0,
      successfulParsing: 0,
      failedParsing: 0,
      totalAggregations: 0,
      lastReset: new Date().toISOString()
    };
  }

  /**
   * Busca elementos específicos en el XML parseado
   * @param {Object} parsedData - Datos parseados
   * @param {string} xpath - Path a buscar (simple)
   * @returns {*} Elemento encontrado o null
   */
  findElement(parsedData, xpath) {
    try {
      const path = xpath.split('.');
      let current = parsedData;

      for (const step of path) {
        if (current && typeof current === 'object' && step in current) {
          current = current[step];
        } else {
          return null;
        }
      }

      return current;
    } catch (error) {
      console.warn('Error finding element:', error.message);
      return null;
    }
  }

  /**
   * Obtiene una vista previa legible del XML
   * @param {string} xmlString - XML string
   * @param {number} maxLength - Longitud máxima
   * @returns {string} Preview del XML
   */
  getXmlPreview(xmlString, maxLength = 1000) {
    if (!xmlString) return 'No XML data';

    try {
      // Formatear XML básico
      const formatted = xmlString
        .replace(/></g, '>\n<')
        .replace(/^\s+|\s+$/g, '');

      return formatted.length > maxLength
        ? formatted.substring(0, maxLength) + '\n... (truncated)'
        : formatted;
    } catch (error) {
      return xmlString.substring(0, maxLength);
    }
  }

  /**
 * Validación rápida de XML sin parsing completo (optimizada)
 * @param {string} xmlString - String XML a validar
 * @returns {Object} Resultado de validación optimizada
 */
  validateXmlFast(xmlString) {
    try {
      if (!xmlString || typeof xmlString !== 'string') {
        return { isValid: false, error: 'No data or invalid data type' };
      }

      const trimmed = xmlString.trim();

      // Verificaciones básicas rápidas
      if (trimmed.length === 0) {
        return { isValid: false, error: 'Empty XML content' };
      }

      // Debe empezar con declaración XML o tag
      if (!trimmed.startsWith('<?xml') && !trimmed.startsWith('<')) {
        return { isValid: false, error: 'Does not start with XML declaration or tag' };
      }

      // Verificación rápida de balance de tags
      const openTags = (trimmed.match(/</g) || []).length;
      const closeTags = (trimmed.match(/>/g) || []).length;

      if (openTags !== closeTags) {
        return { isValid: false, error: 'Unbalanced XML tags' };
      }

      // Verificar que tenga al menos un elemento raíz
      const rootTagMatch = trimmed.match(/<([^\/!?][^>\s]*)/);
      if (!rootTagMatch) {
        return { isValid: false, error: 'No root element found' };
      }

      const rootTag = rootTagMatch[1];
      const rootClosePattern = new RegExp(`</${rootTag.split(/\s/)[0]}>`);

      if (!rootClosePattern.test(trimmed) && !trimmed.includes('/>')) {
        return { isValid: false, error: `Root element '${rootTag}' not properly closed` };
      }

      // Si pasa las validaciones rápidas, es probablemente válido
      return {
        isValid: true,
        rootElement: rootTag.split(/\s/)[0],
        hasXmlDeclaration: trimmed.startsWith('<?xml'),
        estimatedSize: trimmed.length
      };

    } catch (error) {
      return {
        isValid: false,
        error: `Validation error: ${error.message}`
      };
    }
  }

  /**
   * Obtiene información básica del XML sin parsing completo
   * @param {string} xmlString - XML string
   * @returns {Object} Información básica del XML
   */
  getXmlBasicInfo(xmlString) {
    try {
      const info = {
        size: xmlString.length,
        hasXmlDeclaration: false,
        rootElement: null,
        encoding: 'utf-8',
        version: '1.0',
        estimatedElements: 0,
        hasNamespaces: false
      };

      // Detectar declaración XML
      const xmlDeclaration = xmlString.match(/<\?xml[^>]*\?>/);
      if (xmlDeclaration) {
        info.hasXmlDeclaration = true;

        const versionMatch = xmlDeclaration[0].match(/version=["']([^"']+)["']/);
        const encodingMatch = xmlDeclaration[0].match(/encoding=["']([^"']+)["']/);

        if (versionMatch) info.version = versionMatch[1];
        if (encodingMatch) info.encoding = encodingMatch[1];
      }

      // Encontrar elemento raíz
      const rootMatch = xmlString.match(/<([^\/!?][^>\s]*)/);
      if (rootMatch) {
        info.rootElement = rootMatch[1].split(/\s/)[0];
      }

      // Contar elementos aproximadamente
      const elementMatches = xmlString.match(/<[^\/!?][^>]*>/g);
      info.estimatedElements = elementMatches ? elementMatches.length : 0;

      // Detectar namespaces
      info.hasNamespaces = /xmlns[^=]*=/.test(xmlString);

      return info;

    } catch (error) {
      console.warn('Warning getting XML basic info:', error.message);
      return {
        size: xmlString.length,
        hasXmlDeclaration: false,
        rootElement: null,
        encoding: 'utf-8',
        version: '1.0',
        estimatedElements: 0,
        hasNamespaces: false,
        error: error.message
      };
    }
  }

  /**
   * Limpia XML removiendo caracteres problemáticos pero manteniendo estructura
   * @param {string} xmlString - XML a limpiar
   * @returns {string} XML limpio
   */
  cleanXmlString(xmlString) {
    try {
      return xmlString
        // Remover caracteres de control excepto tab, newline, carriage return
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        // Normalizar espacios en blanco
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        // Mantener estructura pero limpiar espacios excesivos entre elementos
        .replace(/>\s+</g, '><')
        .trim();
    } catch (error) {
      console.warn('Error cleaning XML string:', error.message);
      return xmlString;
    }
  }

  /**
   * Extrae metadatos básicos sin parsing completo (para el agregador)
   * @param {string} rawXml - XML crudo
   * @returns {Object} Metadatos básicos
   */
  extractBasicMetadata(rawXml) {
    const basicInfo = this.getXmlBasicInfo(rawXml);

    return {
      size: basicInfo.size,
      rootElement: basicInfo.rootElement,
      encoding: basicInfo.encoding,
      version: basicInfo.version,
      hasXmlDeclaration: basicInfo.hasXmlDeclaration,
      estimatedElements: basicInfo.estimatedElements,
      hasNamespaces: basicInfo.hasNamespaces,
      isWellFormed: this.validateXmlFast(rawXml).isValid
    };
  }
}

module.exports = XmlProcessor;