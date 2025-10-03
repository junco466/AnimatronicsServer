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

// Estado de los animatrónicos
const animatronics = {
  '1': { connected: false, name: 'Sapo Dardo Dorada', emoji: '🐸' },
  '2': { connected: false, name: 'Jaguar', emoji: '🐆' },
  '3': { connected: false, name: 'Armadillo', emoji: '🦔' },
  '4': { connected: false, name: 'Delfín Rosado', emoji: '🐬' },
  '5': { connected: false, name: 'Nutria', emoji: '🦦' },
  '6': { connected: false, name: 'Guacamaya Jacinto', emoji: '🦜' }
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
    // Marcar como conectado
    animatronics[deviceId].connected = true;
    console.log(`🔌 Animatrónico ${deviceId} conectado`);
    
    // Notificar a la interfaz React
    io.emit('animatronic_status', {
      id: deviceId,
      connected: true,
      ...animatronics[deviceId]
    });
  }
  
  if (msgType === 'response') {
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
    return res.status(400).json({ error: 'Animatrónico desconectado' });
  }
  
  // Enviar comando por MQTT
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
  
  socket.on('disconnect', () => {
    console.log('🔌 Cliente React desconectado');
  });
});

// Monitoreo de conexiones (cada 60 segundos)
setInterval(() => {
  Object.keys(animatronics).forEach(id => {
    if (animatronics[id].connected) {
      // Ping para verificar conexión
      mqttClient.publish(`animatronics/${id}/ping`, 'ping');
    }
  });
}, 60000);

const PORT = process.env.PORT || 5000;

server.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 Servidor iniciado');
  console.log(`🌐 API REST: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket: http://localhost:${PORT}`);
  console.log('📶 Asegúrate de tener Mosquitto corriendo: mosquitto -v');
});

module.exports = app;