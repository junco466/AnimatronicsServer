// server/server.js
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mqtt = require('mqtt');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
// Configuración de IPs permitidas (más seguro)
const getAllowedOrigins = () => {
  const localIP = getLocalIP(); // Función para obtener IP local
  return [
    "http://localhost:3000",
    `http://${localIP}:3000`,
    "http://127.0.0.1:3000"
  ];
};

// Para desarrollo, usar "*" es más fácil
const io = socketIo(server, {
  cors: {
    origin: "*", // Cambiar por getAllowedOrigins() en producción
    methods: ["GET", "POST"],
    credentials: true
  }
});

// Middleware
app.use(cors({
  origin: "*", // Permitir todas las IPs
  credentials: true
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

// Cliente MQTT
const mqttClient = mqtt.connect('mqtt://localhost:1883');

mqttClient.on('connect', () => {
  console.log('✅ Conectado a broker MQTT');
  
  // Suscribirse a respuestas de los animatrónicos
  mqttClient.subscribe('animatronics/+/status');
  mqttClient.subscribe('animatronics/+/response');
  
  console.log('📡 Esperando animatrónicos...');
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

const PORT = process.env.PORT || 5000;

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

server.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Servidor iniciado');
  console.log(`🌐 API REST: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: http://localhost:${PORT}`);
  console.log('📶 Asegúrate de tener Mosquitto corriendo: mosquitto -v');
  console.log(`📱 Acceso desde red: http://[TU-IP]:${PORT}`);
  
  // Iniciar monitor de conexiones
  startConnectionMonitor();
});

module.exports = app;