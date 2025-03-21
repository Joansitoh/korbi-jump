const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);

// Configuración de CORS para Socket.IO
const io = socketIO(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        allowedHeaders: ["*"],
        credentials: true
    },
    // Configuración específica para Vercel
    path: '/socket.io'
});

// Configuración del servidor
const PORT = process.env.PORT || 3000;

// Middleware para CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Servir el archivo de Socket.IO client desde node_modules
app.get('/socket.io/socket.io.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules', 'socket.io', 'client-dist', 'socket.io.js'));
});

// Ruta para la página principal
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Almacena las salas activas
const rooms = {};

// Manejador de conexiones de socket
io.on('connection', (socket) => {
  console.log('Nuevo usuario conectado: ' + socket.id);

  // Obtener salas disponibles
  socket.on('getRooms', () => {
    socket.emit('roomList', Object.keys(rooms).map(roomId => ({
      id: roomId,
      name: rooms[roomId].name,
      players: Object.keys(rooms[roomId].players).length,
      maxPlayers: rooms[roomId].maxPlayers
    })));
  });

  // Crear una nueva sala
  socket.on('createRoom', ({ roomName, maxPlayers }) => {
    const roomId = uuidv4();
    rooms[roomId] = {
      id: roomId,
      name: roomName,
      players: {},
      maxPlayers: maxPlayers || 4,
      gameStarted: false,
      lavaHeight: -5, // Altura inicial de la lava
      platforms: generateInitialPlatforms()
    };
    
    socket.emit('roomCreated', { roomId });
    io.emit('roomList', Object.keys(rooms).map(roomId => ({
      id: roomId,
      name: rooms[roomId].name,
      players: Object.keys(rooms[roomId].players).length,
      maxPlayers: rooms[roomId].maxPlayers
    })));
  });

  // Unirse a una sala existente
  socket.on('joinRoom', (data) => {
    const roomId = data.roomId;
    const playerName = data.playerName || 'Jugador';
    
    // Verificar si la sala existe
    if (!rooms[roomId]) {
      socket.emit('error', { message: 'La sala no existe' });
      return;
    }
    
    // Verificar si la sala está llena
    const room = rooms[roomId];
    if (Object.keys(room.players).length >= room.maxPlayers) {
      socket.emit('error', { message: 'La sala está llena' });
      return;
    }
    
    // Añadir jugador a la sala
    const playerId = socket.id;
    
    // Verificar si es el primer jugador (host)
    const isHost = Object.keys(room.players).length === 0;
    
    room.players[playerId] = {
      id: playerId,
      name: playerName,
      color: getRandomPlayerColor(),
      position: { x: 0, y: 10, z: 0 },
      height: 0,
      lives: 3,
      isSpectator: false,
      isHost: isHost // Marcar explícitamente si es el host
    };
    
    // Unir el socket a la sala
    socket.join(roomId);
    
    // Guardar datos en la sesión del socket
    socket.data.roomId = roomId;
    socket.data.playerId = playerId;
    
    // Notificar al jugador que se unió con éxito
    socket.emit('joinedRoom', {
      roomId,
      roomName: room.name,
      players: room.players,
      playerId,
      maxPlayers: room.maxPlayers,
      gameStarted: room.gameStarted
    });
    
    // Notificar a los demás jugadores sobre el nuevo jugador
    socket.to(roomId).emit('playerJoined', {
      playerId: playerId,
      player: room.players[playerId],
      players: room.players
    });
    
    console.log(`Jugador ${playerId} (${playerName}) se unió a la sala ${roomId}`);
  });

  // Expulsar a un jugador de la sala
  socket.on('kickPlayer', (data) => {
    const { playerId } = data;
    const roomId = socket.data.roomId;
    
    // Verificar si la sala existe
    if (!rooms[roomId]) {
      socket.emit('error', { message: 'La sala no existe' });
      return;
    }
    
    const room = rooms[roomId];
    
    // Verificar si el jugador que expulsa es el host (primer jugador de la sala)
    const hostId = Object.keys(room.players)[0];
    if (socket.id !== hostId) {
      socket.emit('error', { message: 'Solo el anfitrión puede expulsar jugadores' });
      return;
    }
    
    // Verificar si el jugador a expulsar existe en la sala
    if (!room.players[playerId]) {
      socket.emit('error', { message: 'Jugador no encontrado en la sala' });
      return;
    }
    
    // Obtener el socket del jugador a expulsar
    const playerSocket = io.sockets.sockets.get(playerId);
    if (playerSocket) {
      // Eliminar al jugador de la sala
      delete room.players[playerId];
      
      // Notificar al jugador que fue expulsado
      playerSocket.emit('kicked');
      
      // Hacer que el jugador deje la sala
      playerSocket.leave(roomId);
      
      // Limpiar los datos de la sesión del socket
      delete playerSocket.data.roomId;
      delete playerSocket.data.playerId;
      
      // Notificar a TODOS los jugadores incluyendo al host sobre la expulsión
      io.to(roomId).emit('playerLeft', {
        playerId: playerId,
        players: room.players
      });
      
      console.log(`Jugador ${playerId} fue expulsado de la sala ${roomId} por ${socket.id}`);
    }
  });

  // Iniciar el juego
  socket.on('startGame', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;

    // Verificar que hay al menos 2 jugadores
    const playerCount = Object.keys(rooms[roomId].players).length;
    if (playerCount < 2) {
      socket.emit('error', { message: 'Se necesitan al menos 2 jugadores para iniciar el juego' });
      return;
    }

    // Generar plataformas y establecer altura inicial de la lava
    rooms[roomId].gameStarted = true;
    rooms[roomId].lavaHeight = -10;
    rooms[roomId].platforms = generateGamePlatforms();

    // Establecer las posiciones iniciales de todos los jugadores
    Object.keys(rooms[roomId].players).forEach(playerId => {
      rooms[roomId].players[playerId].position = { x: 0, y: 15, z: 0 }; // Altura más alta para evitar caer inicialmente
      rooms[roomId].players[playerId].lives = 3;
      rooms[roomId].players[playerId].isSpectator = false;
    });

    // Notificar a todos los jugadores que el juego ha comenzado
    io.to(roomId).emit('gameStarted', {
      platforms: rooms[roomId].platforms,
      lavaHeight: rooms[roomId].lavaHeight,
      players: rooms[roomId].players // Enviar posiciones actualizadas de los jugadores
    });

    // Iniciar el aumento de la lava
    startLavaRise(roomId);
  });

  // Actualizar posición del jugador
  socket.on('updatePosition', (position) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId] || !rooms[roomId].players[socket.id]) return;

    rooms[roomId].players[socket.id].position = position;
    // Emitir la posición a todos los jugadores en la sala excepto al emisor
    socket.to(roomId).emit('playerMoved', {
      playerId: socket.id,
      position: position
    });
  });

  // Aplicar ráfaga de aire a otro jugador
  socket.on('applyAirBlast', (data) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    const { targetId, velocity } = data;
    
    // Verificar que el jugador objetivo existe en la sala
    if (!rooms[roomId].players[targetId]) return;
    
    // Emitir al jugador objetivo que recibió una ráfaga de aire
    io.to(targetId).emit('receivedAirBlast', {
      fromId: socket.id,
      velocity: velocity
    });
    
    // Notificar a todos los demás jugadores sobre el efecto visual
    socket.to(roomId).emit('airBlastEffect', {
      fromId: socket.id,
      targetId: targetId
    });
    
    console.log(`Jugador ${socket.id} aplicó ráfaga de aire a ${targetId} en sala ${roomId}`);
  });

  // Usar ráfaga de aire (nuevo evento)
  socket.on('useAirBlast', (data) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    const { position, direction } = data;
    
    // Notificar a todos los jugadores sobre el efecto visual
    io.to(roomId).emit('airBlastEffect', {
      position,
      direction
    });
    
    // Calcular jugadores afectados
    const blastRange = 10; // Mayor alcance
    const blastAngle = Math.PI / 3; // 60 grados
    const pushForce = 30; // Fuerza más baja para un empuje más suave
    
    Object.keys(rooms[roomId].players).forEach(targetId => {
      if (targetId === socket.id) return; // No afectar al jugador que la usa
      
      const targetPlayer = rooms[roomId].players[targetId];
      const targetPos = targetPlayer.position;
      
      // Vector desde la posición de la ráfaga al objetivo
      const dx = targetPos.x - position.x;
      const dy = targetPos.y - position.y;
      const dz = targetPos.z - position.z;
      
      // Calcular distancia
      const distance = Math.sqrt(dx*dx + dy*dy + dz*dz);
      
      // Comprobar si está en rango
      if (distance <= blastRange) {
        // Normalizar el vector hacia el objetivo
        const toTargetX = dx / distance;
        const toTargetZ = dz / distance;
        
        // Normalizar el vector de dirección
        const dirLength = Math.sqrt(direction.x*direction.x + direction.z*direction.z);
        const dirNormX = direction.x / dirLength;
        const dirNormZ = direction.z / dirLength;
        
        // Calcular producto escalar para el ángulo
        const dot = toTargetX * dirNormX + toTargetZ * dirNormZ;
        const clampedDot = Math.max(-1, Math.min(1, dot));
        const angle = Math.acos(clampedDot);
        
        // Si está dentro del cono de efecto
        if (angle <= blastAngle / 2) {
          // Calcular fuerza basada en la distancia
          const forceFactor = 1 - (distance / blastRange);
          const forceMagnitude = pushForce * forceFactor;
          
          // Calcular vector de empuje con menos componente vertical
          const pushVector = {
            x: dirNormX * forceMagnitude * 1.5, // Aumentar componente horizontal
            y: forceMagnitude * 0.3, // Reducir componente vertical significativamente
            z: dirNormZ * forceMagnitude * 1.5  // Aumentar componente horizontal
          };
          
          console.log(`[SERVIDOR] Aplicando ráfaga de aire a ${targetId} con fuerza:`, pushVector);
          
          // Emitir el empuje al cliente objetivo
          io.to(targetId).emit('airBlastPush', {
            targetId: targetId,
            pushVector: pushVector
          });
        }
      }
    });
    
    console.log(`Jugador ${socket.id} usó ráfaga de aire en sala ${roomId}`);
  });

  // Recibir información de impacto de ráfaga de aire
  socket.on('airBlastHit', (data) => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    const { targetId, force } = data;
    
    // Verificar que el jugador objetivo existe
    if (!targetId || !rooms[roomId].players[targetId]) return;
    
    console.log(`[SERVIDOR] Retransmitiendo impacto de ráfaga de aire a ${targetId} con fuerza:`, force);
    
    // Reenviar el evento al jugador afectado
    io.to(targetId).emit('airBlastPush', {
      targetId: targetId,
      pushVector: force
    });
  });

  // Abandonar sala
  socket.on('leaveRoom', () => {
    leaveCurrentRoom(socket);
  });

  // Obtener datos de una sala específica
  socket.on('getRoomData', (data, callback) => {
    const roomId = data.roomId;
    if (rooms[roomId]) {
      // Devolver solo los datos necesarios de la sala
      callback({
        name: rooms[roomId].name,
        players: rooms[roomId].players,
        platforms: rooms[roomId].platforms,
        lavaHeight: rooms[roomId].lavaHeight,
        gameStarted: rooms[roomId].gameStarted
      });
    } else {
      callback(null);
    }
  });

  // Reducir vidas del jugador
  socket.on('playerDied', () => {
    const roomId = socket.data.roomId;
    if (!roomId || !rooms[roomId]) return;
    
    // Verificar que el jugador existe en la sala
    if (!rooms[roomId].players[socket.id]) return;
    
    // Reducir vidas
    rooms[roomId].players[socket.id].lives -= 1;
    const remainingLives = rooms[roomId].players[socket.id].lives;
    
    // Notificar al jugador sus vidas restantes
    socket.emit('updateLives', { lives: remainingLives });
    
    // Si no quedan vidas, poner al jugador en modo espectador
    if (remainingLives <= 0) {
      rooms[roomId].players[socket.id].isSpectator = true;
      socket.emit('enterSpectatorMode');
      
      // Contar jugadores vivos
      const alivePlayers = Object.entries(rooms[roomId].players).filter(([_, player]) => 
        !player.isSpectator
      );
      
      // Si solo queda un jugador, terminar el juego
      if (alivePlayers.length === 1) {
        const winnerId = alivePlayers[0][0];
        const winnerName = rooms[roomId].players[winnerId].name;
        
        // Notificar a todos los jugadores que hay un ganador
        io.to(roomId).emit('gameOver', { 
          winnerId: winnerId, 
          winnerName: winnerName 
        });
        
        // Dar tiempo para mostrar el ganador y luego finalizar el juego
        setTimeout(() => {
          // Reiniciar la sala
          if (rooms[roomId]) {
            rooms[roomId].gameStarted = false;
            
            // Devolver a todos al lobby
            io.to(roomId).emit('returnToLobby', {
              roomId: roomId,
              players: rooms[roomId].players,
              roomName: rooms[roomId].name,
              maxPlayers: rooms[roomId].maxPlayers
            });
            
            // Resetear vidas y estado de espectador de todos los jugadores
            Object.keys(rooms[roomId].players).forEach(playerId => {
              rooms[roomId].players[playerId].lives = 3;
              rooms[roomId].players[playerId].isSpectator = false;
            });
          }
        }, 10000); // 10 segundos para mostrar al ganador
      }
    }
  });

  // Espectador cambia de perspectiva
  socket.on('spectatorSwitchView', (data) => {
    const roomId = socket.data.roomId;
    const targetId = data.targetId;
    
    if (!roomId || !rooms[roomId] || !rooms[roomId].players[socket.id]) return;
    
    // Verificar que es un espectador
    const player = rooms[roomId].players[socket.id];
    if (!player.isSpectator) return;
    
    // Verificar que el jugador objetivo existe y está vivo
    if (!rooms[roomId].players[targetId] || rooms[roomId].players[targetId].isSpectator) return;
    
    // Notificar al espectador que puede cambiar de vista
    socket.emit('spectatorViewChanged', {
      targetId: targetId
    });
  });
  
  // Desconexión
  socket.on('disconnect', () => {
    console.log('Usuario desconectado: ' + socket.id);
    leaveCurrentRoom(socket);
  });

  // Manejar generación de nuevas plataformas
  socket.on('newPlatformsGenerated', (platformsData) => {
    // Obtener la sala del jugador
    const room = getRoomByPlayerId(socket.id);
    if (!room) return;
    
    // Guardar las plataformas en el estado de la sala
    room.platforms = room.platforms || [];
    room.platforms = room.platforms.filter(p => p.position.y < Math.min(...platformsData.map(p => p.position.y)));
    room.platforms = [...room.platforms, ...platformsData];
    
    // Emitir las plataformas a todos los jugadores en la sala
    io.to(room.id).emit('syncNewPlatforms', platformsData);
  });
});

// Función para que un jugador abandone su sala actual
function leaveCurrentRoom(socket) {
  const roomId = socket.data.roomId;
  if (!roomId || !rooms[roomId]) return;

  // Obtener ID del jugador antes de eliminarlo
  const playerId = socket.id;
  
  // Verificar si era el host
  const isHost = rooms[roomId].players[playerId]?.isHost;
  
  // Eliminar jugador de la sala
  delete rooms[roomId].players[playerId];
  
  // Si el jugador era el host y quedan jugadores, transferir el rol de host
  if (isHost) {
    const remainingPlayers = Object.keys(rooms[roomId].players);
    if (remainingPlayers.length > 0) {
      // Asignar el rol de host al primer jugador que queda
      const newHostId = remainingPlayers[0];
      rooms[roomId].players[newHostId].isHost = true;
      
      // Notificar al nuevo host
      io.to(newHostId).emit('becameHost');
    }
  }

  // Notificar a todos los jugadores que un jugador se fue
  io.to(roomId).emit('playerLeft', { 
    playerId: playerId,
    players: rooms[roomId].players 
  });

  // Si no quedan jugadores, eliminar la sala
  if (Object.keys(rooms[roomId].players).length === 0) {
    delete rooms[roomId];
    io.emit('roomList', Object.keys(rooms).map(roomId => ({
      id: roomId,
      name: rooms[roomId].name,
      players: Object.keys(rooms[roomId].players).length,
      maxPlayers: rooms[roomId].maxPlayers
    })));
  }

  // Salir de la sala
  socket.leave(roomId);
  
  // Limpiar datos de la sesión
  delete socket.data.roomId;
  delete socket.data.playerId;
}

// Generar plataformas iniciales para el lobby
function generateInitialPlatforms() {
  return [
    // Plataforma base circular
    {
      type: 'circle',
      position: { x: 0, y: 0, z: 0 },
      radius: 10,
      height: 0.5
    },
    // Algunas plataformas de prueba
    {
      type: 'box',
      position: { x: 5, y: 2, z: 0 },
      size: { x: 2, y: 0.5, z: 2 }
    },
    {
      type: 'box',
      position: { x: -5, y: 3, z: 2 },
      size: { x: 2, y: 0.5, z: 2 }
    },
    {
      type: 'box',
      position: { x: 0, y: 4, z: 5 },
      size: { x: 2, y: 0.5, z: 2 }
    }
  ];
}

// Generar plataformas para el juego
function generateGamePlatforms() {
  const platforms = [];
  // Añadir una plataforma base
  platforms.push({
    type: 'box',
    position: { x: 0, y: 0, z: 0 },
    size: { x: 20, y: 0.5, z: 20 }
  });

  // Generar plataformas en diferentes alturas
  for (let y = 5; y < 100; y += 5) {
    const numPlatforms = 3 + Math.floor(Math.random() * 5);
    
    for (let i = 0; i < numPlatforms; i++) {
      const x = Math.random() * 30 - 15;
      const z = Math.random() * 30 - 15;
      const width = 2 + Math.random() * 3;
      const depth = 2 + Math.random() * 3;
      
      platforms.push({
        type: 'box',
        position: { x, y, z },
        size: { x: width, y: 0.5, z: depth }
      });
    }
  }
  
  return platforms;
}

// Iniciar el aumento de la lava
function startLavaRise(roomId) {
  // Velocidad inicial de subida de la lava
  let lavaRiseSpeed = 0.02;
  // Contador de tiempo para el incremento de velocidad
  let timeCounter = 0;
  
  const lavaInterval = setInterval(() => {
    if (!rooms[roomId]) {
      clearInterval(lavaInterval);
      return;
    }

    // Aumentar el contador de tiempo
    timeCounter += 0.1; // Incrementamos en aproximadamente 0.1 segundos (ajustar según intervalo real)
    
    // Cada 10 segundos, aumentar la velocidad de la lava
    if (timeCounter >= 30) {
      lavaRiseSpeed += 0.05; // Incrementar la velocidad
      timeCounter = 0; // Reiniciar contador
      
      // Notificar a los jugadores del aumento de velocidad
      io.to(roomId).emit('lavaSpeedChanged', { speed: lavaRiseSpeed });
      console.log(`Lava speed increased in room ${roomId}: ${lavaRiseSpeed}`);
    }

    // Aplicar la velocidad actual
    rooms[roomId].lavaHeight += lavaRiseSpeed;
    io.to(roomId).emit('lavaUpdate', { 
      lavaHeight: rooms[roomId].lavaHeight,
      lavaSpeed: lavaRiseSpeed
    });

    // Comprobar si algún jugador ha caído en la lava
    Object.keys(rooms[roomId].players).forEach(playerId => {
      const player = rooms[roomId].players[playerId];
      if (player.position.y < rooms[roomId].lavaHeight + 0.5) {
        // El jugador cayó en la lava
        player.position = { x: 0, y: rooms[roomId].lavaHeight + 10, z: 0 };
        io.to(roomId).emit('playerReset', { playerId, position: player.position });
      }
    });
  }, 100); // Ejecutar cada 100ms
}

// Obtener un color aleatorio para el jugador
function getRandomColor() {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFBE0B', 
    '#FB5607', '#8338EC', '#3A86FF', '#FF006E'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Obtener un color aleatorio para el jugador
function getRandomPlayerColor() {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFBE0B', 
    '#FB5607', '#8338EC', '#3A86FF', '#FF006E'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

// Función para obtener la sala de un jugador por su ID
function getRoomByPlayerId(playerId) {
    return Object.values(rooms).find(room => 
        room.players && Object.keys(room.players).includes(playerId)
    );
}

// Exportar para Vercel
if (process.env.NODE_ENV === 'production') {
    module.exports = server;
} else {
    server.listen(PORT, () => {
        console.log(`Servidor corriendo en puerto ${PORT}`);
    });
    module.exports = server;
} 