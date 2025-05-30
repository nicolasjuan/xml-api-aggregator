// public/js/admin.js - JavaScript del Panel de Administración
class AdminPanel {
    constructor() {
        this.sortable = null;
        this.editingApiId = null;
        this.testingUrls = new Set();
        this.refreshInterval = null;
        
        this.init();
    }

    /**
     * Inicializa la aplicación
     */
    init() {
        console.log('🚀 Inicializando panel de administración...');
        
        // Configurar drag & drop
        this.initSortable();
        
        // Configurar eventos
        this.setupEventListeners();
        
        // Auto-refresh cada 30 segundos
        this.startAutoRefresh();
        
        console.log('✅ Panel inicializado correctamente');
    }

    /**
     * Configura el drag & drop con SortableJS
     */
    initSortable() {
        const container = document.getElementById('apis-container');
        if (!container) return;

        this.sortable = Sortable.create(container, {
            handle: '.drag-handle',
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: (evt) => {
                this.handleReorder(evt);
            }
        });
    }

    /**
     * Configura los event listeners
     */
    setupEventListeners() {
        // Modal overlay para cerrar modales
        const overlay = document.getElementById('modal-overlay');
        if (overlay) {
            overlay.addEventListener('click', () => this.closeApiModal());
        }

        // Escape key para cerrar modales
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeApiModal();
            }
        });

        // Validation en tiempo real para URLs
        const urlInput = document.getElementById('api-url');
        if (urlInput) {
            urlInput.addEventListener('input', () => {
                this.validateUrl(urlInput.value);
            });
        }
    }

    /**
     * Inicia el auto-refresh
     */
    startAutoRefresh() {
        this.refreshInterval = setInterval(() => {
            this.refreshApis();
        }, 30000); // 30 segundos
    }

    /**
     * Detiene el auto-refresh
     */
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    /**
     * Maneja el reordenamiento de APIs
     */
    async handleReorder(evt) {
        const container = evt.to;
        const items = Array.from(container.children);
        const orderedIds = items
            .map(item => item.dataset.apiId)
            .filter(id => id);

        try {
            const response = await fetch('/api/apis-order', {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ orderedIds })
            });

            if (response.ok) {
                this.showToast('Orden actualizado correctamente', 'success');
            } else {
                throw new Error('Error al actualizar orden');
            }
        } catch (error) {
            console.error('Error reordenando APIs:', error);
            this.showToast('Error al actualizar el orden', 'error');
            // Revertir el cambio visual
            location.reload();
        }
    }

    /**
     * Muestra el modal para agregar API
     */
    showAddApiModal() {
        this.editingApiId = null;
        document.getElementById('modal-title').textContent = 'Agregar Nueva API';
        document.getElementById('api-form').reset();
        document.getElementById('api-enabled').checked = true;
        document.getElementById('url-test-result').innerHTML = '';
        this.showModal();
    }

    /**
     * Muestra el modal para editar API
     */
    async editApi(apiId) {
        try {
            const response = await fetch('/api/config');
            const config = await response.json();
            const api = config.apis.find(a => a.id === apiId);

            if (!api) {
                this.showToast('API no encontrada', 'error');
                return;
            }

            this.editingApiId = apiId;
            document.getElementById('modal-title').textContent = 'Editar API';
            document.getElementById('api-name').value = api.name;
            document.getElementById('api-url').value = api.url;
            document.getElementById('api-interval').value = api.interval;
            document.getElementById('api-timeout').value = api.timeout || 5000;
            document.getElementById('api-enabled').checked = api.enabled;
            document.getElementById('url-test-result').innerHTML = '';
            
            this.showModal();
        } catch (error) {
            console.error('Error cargando API:', error);
            this.showToast('Error al cargar los datos de la API', 'error');
        }
    }

    /**
     * Guarda la API (crear o actualizar)
     */
    async saveApi(event) {
        event.preventDefault();
        
        const formData = new FormData(event.target);
        const apiData = {
            name: formData.get('name'),
            url: formData.get('url'),
            interval: parseInt(formData.get('interval')),
            timeout: parseInt(formData.get('timeout')),
            enabled: formData.has('enabled')
        };

        try {
            let response;
            if (this.editingApiId) {
                // Actualizar API existente
                response = await fetch(`/api/apis/${this.editingApiId}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(apiData)
                });
            } else {
                // Crear nueva API
                response = await fetch('/api/apis', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(apiData)
                });
            }

            if (response.ok) {
                this.closeApiModal();
                this.showToast(
                    this.editingApiId ? 'API actualizada correctamente' : 'API agregada correctamente',
                    'success'
                );
                setTimeout(() => location.reload(), 1000);
            } else {
                const error = await response.json();
                throw new Error(error.error || 'Error al guardar API');
            }
        } catch (error) {
            console.error('Error guardando API:', error);
            this.showToast('Error al guardar la API: ' + error.message, 'error');
        }
    }

    /**
     * Elimina una API
     */
    async deleteApi(apiId, apiName) {
        if (!confirm(`¿Estás seguro de que quieres eliminar la API "${apiName}"?`)) {
            return;
        }

        try {
            const response = await fetch(`/api/apis/${apiId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                this.showToast('API eliminada correctamente', 'success');
                setTimeout(() => location.reload(), 1000);
            } else {
                throw new Error('Error al eliminar API');
            }
        } catch (error) {
            console.error('Error eliminando API:', error);
            this.showToast('Error al eliminar la API', 'error');
        }
    }

    /**
     * Alterna el estado habilitado/deshabilitado de una API
     */
    async toggleApi(apiId, newState) {
        try {
            const response = await fetch(`/api/apis/${apiId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ enabled: newState === 'true' })
            });

            if (response.ok) {
                this.showToast(
                    newState === 'true' ? 'API habilitada' : 'API deshabilitada',
                    'success'
                );
                setTimeout(() => location.reload(), 1000);
            } else {
                throw new Error('Error al cambiar estado de API');
            }
        } catch (error) {
            console.error('Error cambiando estado de API:', error);
            this.showToast('Error al cambiar el estado de la API', 'error');
        }
    }

    /**
     * Prueba la conectividad de una API específica
     */
    async testApi(apiId) {
        try {
            const response = await fetch('/api/config');
            const config = await response.json();
            const api = config.apis.find(a => a.id === apiId);

            if (!api) {
                this.showToast('API no encontrada', 'error');
                return;
            }

            await this.testUrl(api.url, `Probando ${api.name}...`);
        } catch (error) {
            console.error('Error probando API:', error);
            this.showToast('Error al probar la API', 'error');
        }
    }

    /**
     * Prueba todas las APIs habilitadas
     */
    async testAllApis() {
        try {
            const response = await fetch('/api/config');
            const config = await response.json();
            const enabledApis = config.apis.filter(api => api.enabled && api.url);

            if (enabledApis.length === 0) {
                this.showToast('No hay APIs habilitadas para probar', 'warning');
                return;
            }

            this.showToast(`Probando ${enabledApis.length} APIs...`, 'info');

            const results = await Promise.allSettled(
                enabledApis.map(api => this.testSingleUrl(api.url))
            );

            const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
            const failed = results.length - successful;

            this.showToast(
                `Pruebas completadas: ${successful} exitosas, ${failed} fallidas`,
                successful === results.length ? 'success' : 'warning'
            );
        } catch (error) {
            console.error('Error probando todas las APIs:', error);
            this.showToast('Error al probar las APIs', 'error');
        }
    }

    /**
     * Prueba la URL actual en el modal
     */
    async testCurrentUrl() {
        const urlInput = document.getElementById('api-url');
        const url = urlInput.value.trim();

        if (!url) {
            this.showToast('Ingresa una URL para probar', 'warning');
            return;
        }

        await this.testUrl(url, 'Probando URL...');
    }

    /**
     * Prueba una URL específica y muestra el resultado
     */
    async testUrl(url, loadingMessage = 'Probando...') {
        if (this.testingUrls.has(url)) {
            return; // Ya se está probando esta URL
        }

        this.testingUrls.add(url);
        const resultContainer = document.getElementById('url-test-result');
        
        if (resultContainer) {
            resultContainer.innerHTML = `
                <div class="flex items-center text-blue-600">
                    <div class="spinner mr-2"></div>
                    ${loadingMessage}
                </div>
            `;
        }

        try {
            const result = await this.testSingleUrl(url);
            
            if (resultContainer) {
                if (result.success) {
                    resultContainer.innerHTML = `
                        <div class="text-green-600 text-sm">
                            <div class="flex items-center">
                                <i data-lucide="check-circle" class="w-4 h-4 mr-2"></i>
                                Conectividad exitosa (${result.responseTime}ms)
                            </div>
                            <div class="mt-1 text-xs text-gray-500">
                                Status: ${result.status} | 
                                Tipo: ${result.contentType} |
                                XML: ${result.isXml ? 'Sí' : 'No'}
                            </div>
                        </div>
                    `;
                } else {
                    resultContainer.innerHTML = `
                        <div class="text-red-600 text-sm">
                            <div class="flex items-center">
                                <i data-lucide="x-circle" class="w-4 h-4 mr-2"></i>
                                Error de conectividad
                            </div>
                            <div class="mt-1 text-xs text-gray-500">
                                ${result.error}
                            </div>
                        </div>
                    `;
                }
                
                // Reinicializar iconos de Lucide
                lucide.createIcons();
            }

            // Mostrar toast con resultado
            this.showToast(
                result.success ? 'URL conectada correctamente' : 'Error de conectividad',
                result.success ? 'success' : 'error'
            );

        } catch (error) {
            console.error('Error probando URL:', error);
            if (resultContainer) {
                resultContainer.innerHTML = `
                    <div class="text-red-600 text-sm">
                        <div class="flex items-center">
                            <i data-lucide="x-circle" class="w-4 h-4 mr-2"></i>
                            Error inesperado
                        </div>
                    </div>
                `;
                lucide.createIcons();
            }
            this.showToast('Error al probar la URL', 'error');
        } finally {
            this.testingUrls.delete(url);
        }
    }

    /**
     * Realiza la prueba de una URL individual
     */
    async testSingleUrl(url) {
        const response = await fetch('/api/test-url', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url, timeout: 10000 })
        });

        return await response.json();
    }

    /**
     * Valida una URL en tiempo real
     */
    validateUrl(url) {
        const urlInput = document.getElementById('api-url');
        const resultContainer = document.getElementById('url-test-result');
        
        if (!url || !resultContainer) return;

        try {
            new URL(url);
            urlInput.classList.remove('border-red-300');
            urlInput.classList.add('border-green-300');
            
            resultContainer.innerHTML = `
                <div class="text-green-600 text-sm">
                    <i data-lucide="check" class="w-4 h-4 inline mr-1"></i>
                    URL válida
                </div>
            `;
            lucide.createIcons();
        } catch {
            urlInput.classList.remove('border-green-300');
            urlInput.classList.add('border-red-300');
            
            resultContainer.innerHTML = `
                <div class="text-red-600 text-sm">
                    <i data-lucide="x" class="w-4 h-4 inline mr-1"></i>
                    URL inválida
                </div>
            `;
            lucide.createIcons();
        }
    }

    /**
     * Muestra el modal
     */
    showModal() {
        document.getElementById('modal-overlay').classList.remove('hidden');
        document.getElementById('api-modal').classList.remove('hidden');
        document.body.style.overflow = 'hidden';
    }

    /**
     * Cierra el modal
     */
    closeApiModal() {
        document.getElementById('modal-overlay').classList.add('hidden');
        document.getElementById('api-modal').classList.add('hidden');
        document.body.style.overflow = 'auto';
        this.editingApiId = null;
    }

    /**
     * Refresca la lista de APIs
     */
    async refreshApis() {
        try {
            const response = await fetch('/api/config');
            if (response.ok) {
                // Recargar página para mostrar datos actualizados
                location.reload();
            }
        } catch (error) {
            console.error('Error refrescando APIs:', error);
        }
    }

    /**
     * Muestra la configuración global
     */
    async showSettings() {
        // Por ahora solo mostramos un toast
        this.showToast('Configuración global - Próximamente', 'info');
    }

    /**
     * Muestra vista previa del XML agregado
     */
    async previewAggregated() {
        try {
            const response = await fetch('/api/aggregated');
            const data = await response.json();
            
            // Abrir en nueva ventana/pestaña
            const newWindow = window.open('', '_blank');
            newWindow.document.write(`
                <html>
                    <head>
                        <title>Vista Previa - XML Agregado</title>
                        <style>
                            body { font-family: monospace; padding: 20px; }
                            pre { background: #f5f5f5; padding: 15px; border-radius: 5px; overflow: auto; }
                        </style>
                    </head>
                    <body>
                        <h1>Vista Previa del XML Agregado</h1>
                        <pre>${JSON.stringify(data, null, 2)}</pre>
                    </body>
                </html>
            `);
        } catch (error) {
            console.error('Error obteniendo preview:', error);
            this.showToast('Error obteniendo vista previa', 'error');
        }
    }

    /**
     * Exporta la configuración
     */
    async exportConfig() {
        try {
            const response = await fetch('/api/config');
            const config = await response.json();
            
            const blob = new Blob([JSON.stringify(config, null, 2)], {
                type: 'application/json'
            });
            
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `xml-aggregator-config-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            this.showToast('Configuración exportada correctamente', 'success');
        } catch (error) {
            console.error('Error exportando configuración:', error);
            this.showToast('Error al exportar configuración', 'error');
        }
    }

    /**
     * Importa configuración desde archivo
     */
    async importConfig(input) {
        const file = input.files[0];
        if (!file) return;

        try {
            const text = await file.text();
            const config = JSON.parse(text);
            
            if (!config.apis || !config.settings) {
                throw new Error('Formato de configuración inválido');
            }

            const response = await fetch('/api/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(config)
            });

            if (response.ok) {
                this.showToast('Configuración importada correctamente', 'success');
                setTimeout(() => location.reload(), 1000);
            } else {
                throw new Error('Error al guardar configuración');
            }
        } catch (error) {
            console.error('Error importando configuración:', error);
            this.showToast('Error al importar configuración: ' + error.message, 'error');
        }
        
        // Limpiar input
        input.value = '';
    }

    /**
     * Muestra una notificación toast
     */
    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast-notification transform transition-all duration-300 translate-x-full`;
        
        const colors = {
            success: 'bg-green-500 text-white',
            error: 'bg-red-500 text-white',
            warning: 'bg-yellow-500 text-white',
            info: 'bg-blue-500 text-white'
        };

        const icons = {
            success: 'check-circle',
            error: 'x-circle',
            warning: 'alert-triangle',
            info: 'info'
        };

        toast.innerHTML = `
            <div class="flex items-center space-x-3 ${colors[type]} px-4 py-3 rounded-lg shadow-lg min-w-80">
                <i data-lucide="${icons[type]}" class="w-5 h-5 flex-shrink-0"></i>
                <span class="flex-1">${message}</span>
                <button onclick="this.parentElement.parentElement.remove()" 
                        class="text-white hover:text-gray-200 flex-shrink-0">
                    <i data-lucide="x" class="w-4 h-4"></i>
                </button>
            </div>
        `;

        container.appendChild(toast);
        lucide.createIcons();

        // Animación de entrada
        setTimeout(() => {
            toast.classList.remove('translate-x-full');
        }, 100);

        // Auto-eliminar después de 5 segundos
        setTimeout(() => {
            toast.classList.add('translate-x-full');
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.remove();
                }
            }, 300);
        }, 5000);
    }
}

// Instancia global
let adminPanel;

// Funciones globales para compatibilidad con el HTML
function initializeApp() {
    adminPanel = new AdminPanel();
}

function showAddApiModal() {
    adminPanel.showAddApiModal();
}

function editApi(apiId) {
    adminPanel.editApi(apiId);
}

function deleteApi(apiId, apiName) {
    adminPanel.deleteApi(apiId, apiName);
}

function toggleApi(apiId, newState) {
    adminPanel.toggleApi(apiId, newState);
}

function testApi(apiId) {
    adminPanel.testApi(apiId);
}

function testAllApis() {
    adminPanel.testAllApis();
}

function testCurrentUrl() {
    adminPanel.testCurrentUrl();
}

function saveApi(event) {
    adminPanel.saveApi(event);
}

function closeApiModal() {
    adminPanel.closeApiModal();
}

function refreshApis() {
    adminPanel.refreshApis();
}

function showSettings() {
    adminPanel.showSettings();
}

function previewAggregated() {
    adminPanel.previewAggregated();
}

function exportConfig() {
    adminPanel.exportConfig();
}

function importConfig(input) {
    adminPanel.importConfig(input);
}