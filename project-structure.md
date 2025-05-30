# ===== ESTRUCTURA DEL PROYECTO =====
xml-api-aggregator/
├── package.json
├── app.js                 # Servidor principal
├── config/
│   └── apis.json         # Configuración de APIs (se crea automáticamente)
├── modules/
│   ├── configManager.js  # Gestor de configuración
│   ├── dataFetcher.js    # Recolector de datos
│   ├── xmlProcessor.js   # Procesador XML
│   ├── cacheManager.js   # Gestor de cache
│   └── scheduler.js      # Programador de tareas
├── routes/
│   ├── api.js           # Rutas de la API
│   └── admin.js         # Rutas del panel admin
├── views/
│   └── admin.ejs        # Template del panel
├── public/
│   ├── css/
│   │   └── admin.css    # Estilos personalizados
│   └── js/
│       └── admin.js     # JavaScript del frontend
└── logs/
    └── app.log          # Logs de la aplicación

# ===== COMANDOS DE SETUP =====
mkdir xml-api-aggregator
cd xml-api-aggregator

# Inicializar proyecto
npm init -y

# Instalar dependencias
npm install express ejs axios node-cron fast-xml-parser cors helmet morgan

# Instalar dependencias de desarrollo
npm install --save-dev nodemon

# Crear estructura de carpetas
mkdir config modules routes views public public/css public/js logs