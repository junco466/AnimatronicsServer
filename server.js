// server/server.js - VERSIÓN COMPLETA PARA RAILWAY + HIVEMQ
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

// Configuración CORS para Railway/Render
const allowedOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  process.env.FRONTEND_URL,
  'https://animatronics-frontend.up.railway.app',
  'https://animatronics-frontend.onrender.com'
].filter(Boolean); // Eliminar valores undefined

console.log('🌐 Orígenes CORS permitidos:', allowedOrigins);

const io = socketIo(server, {
  cors: {
    origin: (origin, callback) => {
      // Permitir requests sin origin (como mobile apps, curl, Postman)
      if (!origin) return callback(null, true);
      
      // Permitir orígenes en la lista
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } 
      // Permitir IPs locales (192.168.x.x, 10.x.x.x)
      else if (origin.match(/^http:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):\d+$/)) {
        console.log('✅ Permitiendo red local:', origin);
        callback(null, true);
      }
      else {
        console.warn('⚠️ Origen bloqueado por CORS:', origin);
        callback(new Error('No permitido por CORS'));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  }
});

// Middleware CORS para HTTP
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    
    // Verificar lista permitida
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } 
    // Permitir IPs locales
    else if (origin.match(/^http:\/\/(192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+):\d+$/)) {
      console.log('✅ HTTP permitiendo red local:', origin);
      callback(null, true);
    }
    else {
      console.warn('⚠️ HTTP Origen bloqueado por CORS:', origin);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());
app.use(express.static('public'));

// Estado de los animatrónicos con timestamp
const animatronics = {
  '1': { connected: false, name: 'Sapo Dardo Dorada', emoji: '🐸', lastSeen: null },
  '2': { connected: false, name: 'Jaguar', emoji: '🐆', lastSeen: null },
  '3': { connected: false, name: 'Armadillo', emoji: '🦔', lastSeen: null },
  '4': { connected: false, name: 'Delfín Rosado', emoji: '🐬', lastSeen: null },
  '5': { connected: false, name: 'Nutria', emoji: '🦦', lastSeen: null },
  '6': { connected: false, name: 'Guacamaya Jacinto', emoji: '🦜', lastSeen: null }
};

// ============================================
// 🔧 CONFIGURACIÓN MQTT FLEXIBLE
// ============================================

// DEBUG: Mostrar variables de entorno antes de procesarlas
console.log('🔍 DEBUG - Variables de entorno RAW:');
console.log('   MQTT_HOST:', process.env.MQTT_HOST);
console.log('   MQTT_PORT:', process.env.MQTT_PORT);
console.log('   MQTT_USER:', process.env.MQTT_USER);
console.log('   MQTT_PASSWORD:', process.env.MQTT_PASSWORD ? '***' : 'undefined');
console.log('   MQTT_PROTOCOL:', process.env.MQTT_PROTOCOL);

const MQTT_CONFIG = {
  host: process.env.MQTT_HOST || 'localhost',
  port: parseInt(process.env.MQTT_PORT) || 1883,
  username: process.env.MQTT_USER || '',
  password: process.env.MQTT_PASSWORD || '',
  protocol: process.env.MQTT_PROTOCOL || 'mqtt'  // 'mqtt' o 'mqtts' para SSL
};

// Construir URL de conexión MQTT
const mqttUrl = `${MQTT_CONFIG.protocol}://${MQTT_CONFIG.host}:${MQTT_CONFIG.port}`;

console.log('🔗 Configuración MQTT procesada:');
console.log(`   Host: ${MQTT_CONFIG.host}`);
console.log(`   Port: ${MQTT_CONFIG.port}`);
console.log(`   Protocol: ${MQTT_CONFIG.protocol}`);
console.log(`   URL: ${mqttUrl}`);
console.log(`   Auth: ${MQTT_CONFIG.username ? '✅ Con credenciales' : '❌ Sin credenciales'}`);

// Opciones de conexión MQTT
const mqttOptions = {
  clientId: `server_${Math.random().toString(16).substr(2, 8)}`,
  clean: true,
  connectTimeout: 4000,
  reconnectPeriod: 1000
};

// Agregar credenciales si existen
if (MQTT_CONFIG.username) {
  mqttOptions.username = MQTT_CONFIG.username;
  mqttOptions.password = MQTT_CONFIG.password;
  console.log(`   Usuario: ${MQTT_CONFIG.username}`);
}

// Cliente MQTT con todas las opciones
const mqttClient = mqtt.connect(mqttUrl, mqttOptions);

mqttClient.on('connect', () => {
  console.log('✅ Conectado a broker MQTT');
  
  // Suscribirse a respuestas de los animatrónicos
  mqttClient.subscribe('animatronics/+/status');
  mqttClient.subscribe('animatronics/+/response');
  
  console.log('📡 Esperando animatrónicos...');
});

mqttClient.on('error', (error) => {
  console.error('❌ Error MQTT:', error.message);
});

mqttClient.on('reconnect', () => {
  console.log('🔄 Reconectando a MQTT...');
});

mqttClient.on('message', (topic, message) => {
  const parts = topic.split('/');
  const deviceId = parts[1];
  const msgType = parts[2];
  const payload = message.toString();
  
  console.log(`📨 MQTT: ${topic} = ${payload}`);
  
  if (msgType === 'status' && animatronics[deviceId]) {
    if (payload === 'connected') {
      // Marcar como conectado y actualizar timestamp
      animatronics[deviceId].connected = true;
      animatronics[deviceId].lastSeen = Date.now();
      
      console.log(`🔌 Animatrónico ${deviceId} (${animatronics[deviceId].name}) conectado`);
      
      // Notificar a la interfaz React
      io.emit('animatronic_status', {
        id: deviceId,
        connected: true,
        lastSeen: animatronics[deviceId].lastSeen,
        ...animatronics[deviceId]
      });
    } else if (payload === 'disconnected') {
      // Marcar como desconectado (Last Will Message)
      animatronics[deviceId].connected = false;
      
      console.log(`🔌 Animatrónico ${deviceId} (${animatronics[deviceId].name}) desconectado`);
      
      // Notificar a la interfaz React
      io.emit('animatronic_status', {
        id: deviceId,
        connected: false,
        lastSeen: animatronics[deviceId].lastSeen,
        ...animatronics[deviceId]
      });
    }
  }
  
  if (msgType === 'response') {
    // Actualizar timestamp también en respuestas
    if (animatronics[deviceId]) {
      animatronics[deviceId].lastSeen = Date.now();
    }
    
    // Reenviar respuesta a React
    io.emit('animatronic_response', {
      id: deviceId,
      action: payload
    });
  }
});

// Rutas API REST
app.get('/api/animatronics', (req, res) => {
  res.json(animatronics);
});

app.post('/api/command/:id/:action', (req, res) => {
  const { id, action } = req.params;
  
  if (!animatronics[id]) {
    return res.status(404).json({ error: 'Animatrónico no encontrado' });
  }
  
  if (!animatronics[id].connected) {
    console.log(`⚠️ Comando ${action} rechazado - ${animatronics[id].name} desconectado`);
    return res.status(400).json({ 
      error: `${animatronics[id].name} está desconectado`,
      connected: false
    });
  }
  
  // Enviar comando por MQTT solo si está conectado
  const topic = `animatronics/${id}/${action}`;
  mqttClient.publish(topic, 'activate');
  
  console.log(`📤 Comando: ${topic}`);
  
  res.json({ 
    success: true, 
    message: `${action} enviado a ${animatronics[id].name}` 
  });
});

// Health check para Railway/Render
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    mqtt: mqttClient.connected ? 'connected' : 'disconnected',
    animatronics: Object.keys(animatronics).filter(id => animatronics[id].connected).length
  });
});

// WebSocket para React
io.on('connection', (socket) => {
  console.log('🔗 Cliente React conectado');
  
  // Enviar estado actual
  Object.keys(animatronics).forEach(id => {
    socket.emit('animatronic_status', {
      id: id,
      ...animatronics[id]
    });
  });
  
  // Manejar comandos desde React
  socket.on('send_command', (data) => {
    const { id, action } = data;
    
    if (animatronics[id] && animatronics[id].connected) {
      const topic = `animatronics/${id}/${action}`;
      mqttClient.publish(topic, 'activate');
      
      console.log(`📤 WebSocket: ${topic}`);
      
      socket.emit('command_sent', { 
        id, 
        action, 
        success: true 
      });
    } else {
      socket.emit('command_sent', { 
        id, 
        action, 
        success: false, 
        error: 'Dispositivo no disponible' 
      });
    }
  });
  
  // Comando para hacer ping manual
  socket.on('ping_device', (data) => {
    const { id } = data;
    if (animatronics[id]) {
      console.log(`📡 Ping manual a animatrónico ${id}`);
      mqttClient.publish(`animatronics/${id}/ping`, 'ping');
    }
  });
  
  socket.on('disconnect', () => {
    console.log('🔌 Cliente React desconectado');
  });
});

// Función para detectar desconexiones automáticamente
const startConnectionMonitor = () => {
  console.log('🔍 Monitor de conexiones iniciado (verificación cada 30s)');
  
  setInterval(() => {
    const now = Date.now();
    const timeout = 45000; // 45 segundos timeout
    
    Object.keys(animatronics).forEach(deviceId => {
      const device = animatronics[deviceId];
      
      if (device.connected && device.lastSeen) {
        // Si no se ha visto en 45 segundos, marcar como desconectado
        if (now - device.lastSeen > timeout) {
          device.connected = false;
          console.log(`⏰ TIMEOUT: Animatrónico ${deviceId} (${device.name}) desconectado`);
          
          // Notificar a React
          io.emit('animatronic_status', {
            id: deviceId,
            connected: false,
            lastSeen: device.lastSeen,
            reason: 'timeout',
            ...device
          });
        }
      }
    });
  }, 30000); // Verificar cada 30 segundos
};

const PORT = process.env.PORT || 5000;

server.listen(PORT, '0.0.0.0', () => {
  console.log('═══════════════════════════════════════');
  console.log('🚀 Servidor Animatrónicos Iniciado');
  console.log('═══════════════════════════════════════');
  console.log(`🌐 API REST: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: http://localhost:${PORT}`);
  console.log(`📊 Health: http://localhost:${PORT}/health`);
  
  if (process.env.RAILWAY_STATIC_URL) {
    console.log(`🚂 Railway URL: https://${process.env.RAILWAY_STATIC_URL}`);
  }
  if (process.env.RENDER_EXTERNAL_URL) {
    console.log(`🎨 Render URL: ${process.env.RENDER_EXTERNAL_URL}`);
  }
  
  console.log('═══════════════════════════════════════');
  
  // Iniciar monitor de conexiones
  startConnectionMonitor();
});

module.exports = app;