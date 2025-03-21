// Archivo principal que inicializa el juego y maneja la comunicación con el servidor
import Game from './game.js';

// Elementos DOM
let loadingScreen = document.getElementById('loading-screen');
let menuScreen = document.getElementById('menu-screen');
let createRoomScreen = document.getElementById('create-room-screen');
let joinRoomScreen = document.getElementById('join-room-screen');
let lobbyScreen = document.getElementById('lobby-screen');
let gameContainer = document.getElementById('game-container');
let gameUI = document.getElementById('game-ui');

// Variables globales
let socket;
let currentRoomId = null;
let gameInstance = null;
let myPlayerId = null;
let playerName = '';
let players = {};

// Inicializar conexión Socket.io
function initializeSocket() {
    socket = io();

    // Manejo de conexión
    socket.on('connect', () => {
        console.log('Conectado al servidor');
        hideElement(loadingScreen);
        showElement(menuScreen);
    });

    // Manejo de errores
    socket.on('error', (data) => {
        alert(data.message);
    });

    // Recibir lista de salas
    socket.on('roomList', (rooms) => {
        updateRoomList(rooms);
    });

    // Sala creada con éxito
    socket.on('roomCreated', (data) => {
        currentRoomId = data.roomId;
        joinRoom(currentRoomId, playerName);
    });

    // Unirse a sala con éxito
    socket.on('joinedRoom', (data) => {
        currentRoomId = data.roomId;
        myPlayerId = socket.id;
        
        // Guardar los jugadores globalmente
        players = data.players;
        
        // Actualizar interfaz de lobby
        hideAllScreens();
        showElement(lobbyScreen);
        
        // Usar menuManager para actualizar la interfaz
        window.menuManager.updateRoomName(data.roomName || 'Sala');
        window.menuManager.updateMaxPlayerCount(data.maxPlayers);
        window.menuManager.updatePlayerList(data.players, myPlayerId);
        
        // Actualizar estado del botón de inicio
        updateStartButtonState();
        
        console.log('Unido a sala con jugadores:', Object.keys(players).length);
        console.log('Nuestro ID:', myPlayerId);
        console.log('¿Somos host?', players[myPlayerId]?.isHost);
        
        // Si el juego ya ha comenzado, iniciar el juego
        if (data.gameStarted) {
            startGame(data);
        }
    });

    // Un jugador se unió a la sala
    socket.on('playerJoined', (data) => {
        if (currentRoomId) {
            console.log('Jugador unido:', data.playerId);
            
            // Actualizar la lista de jugadores
            players = data.players;
            window.menuManager.updatePlayerList(players, myPlayerId);
            
            // Actualizar botón de inicio según cantidad de jugadores
            updateStartButtonState();
            
            // Si el juego ya está en curso, actualizar jugadores
            if (gameInstance && gameInstance.isRunning) {
                gameInstance.addPlayer(data.playerId, data.player);
            }
        }
    });

    // Un jugador abandonó la sala
    socket.on('playerLeft', (data) => {
        if (currentRoomId) {
            console.log('Jugador abandonó:', data.playerId);
            
            // Actualizar la lista de jugadores
            players = data.players;
            window.menuManager.updatePlayerList(players, myPlayerId);
            
            // Actualizar botón de inicio según cantidad de jugadores
            updateStartButtonState();
            
            // Si el juego ya está en curso, eliminar jugador
            if (gameInstance && gameInstance.isRunning) {
                gameInstance.removePlayer(data.playerId);
            }
        }
    });

    // El juego ha comenzado
    socket.on('gameStarted', function(data) {
        console.log('Juego iniciado con datos:', data);
        
        // Verificar que los datos recibidos son válidos
        if (!data || !data.players || !data.platforms) {
            console.error('Datos del juego inválidos:', data);
            return;
        }

        // Ocultar TODAS las pantallas y elementos de la interfaz
        document.querySelectorAll('.screen, .container').forEach(element => {
            element.style.display = 'none';
            console.log('Ocultando elemento:', element.id);
        });

        // Ocultar elementos específicos por ID para asegurar que estén ocultos
        const elementsToHide = [
            'menu-container', 'menu-screen', 'lobby-screen', 
            'loading-screen', 'join-room-screen', 'create-room-screen'
        ];
        
        elementsToHide.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.style.display = 'none';
                element.style.visibility = 'hidden';
                console.log('Ocultando elemento específico:', id);
            }
        });

        // Mostrar el contenedor del juego explícitamente
        const gameContainer = document.getElementById('game-container');
        if (gameContainer) {
            gameContainer.style.display = 'block';
            gameContainer.style.visibility = 'visible';
            gameContainer.style.opacity = '1';
            gameContainer.style.zIndex = '999';
            console.log('Mostrando contenedor del juego');
            
            // Forzar un reflow para asegurar que los cambios de estilo se apliquen
            void gameContainer.offsetWidth;
        } else {
            console.error('No se encontró el contenedor del juego');
        }
        
        // Mostrar UI del juego
        const gameUI = document.getElementById('game-ui');
        if (gameUI) {
            console.log("Mostrando UI del juego");
            gameUI.style.display = 'block';
            gameUI.style.visibility = 'visible';
            gameUI.style.opacity = '1';
        }
        
        // Inicializar juego con los datos recibidos - utilizar el formato correcto del constructor
        gameInstance = new Game(
            gameContainer, 
            socket, 
            socket.id, 
            data.players, 
            data.platforms, 
            data.lavaHeight
        );
        
        // Iniciar el juego
        gameInstance.start();
        
        // Forzar un reflow para que el navegador actualice la visualización
        gameContainer.offsetHeight;
        
        console.log('Juego iniciado correctamente');
    });

    // Actualizar la posición de un jugador
    socket.on('playerMoved', (data) => {
        const { playerId, position } = data;
        
        // Actualizar los datos locales
        if (players[playerId]) {
            players[playerId].position = position;
            
            // Si el juego está activo, actualizar la posición visual
            if (gameInstance && gameInstance.isRunning) {
                gameInstance.updatePlayerPosition(playerId, position);
            }
        }
    });

    // Actualización de la altura de la lava
    socket.on('lavaUpdate', (data) => {
        if (gameInstance && gameInstance.isRunning) {
            gameInstance.updateLavaHeight(data.lavaHeight);
            
            // Si se incluye la velocidad, actualizarla también
            if (data.lavaSpeed !== undefined) {
                gameInstance.updateLavaSpeed(data.lavaSpeed);
            }
        }
    });

    // La velocidad de la lava ha cambiado
    socket.on('lavaSpeedChanged', (data) => {
        if (gameInstance && gameInstance.isRunning) {
            gameInstance.updateLavaSpeed(data.speed);
            
            // Mostrar mensaje de alerta sobre el aumento de velocidad
            const messageDiv = document.createElement('div');
            messageDiv.classList.add('message-overlay', 'warning-message');
            messageDiv.textContent = '¡La lava está subiendo más rápido!';
            document.body.appendChild(messageDiv);
            
            // Eliminar mensaje después de 3 segundos
            setTimeout(() => {
                document.body.removeChild(messageDiv);
            }, 3000);
        }
    });

    // Reinicio de un jugador (cayó en la lava)
    socket.on('playerReset', (data) => {
        if (gameInstance && gameInstance.isRunning) {
            gameInstance.resetPlayer(data.playerId, data.position, data.livesRemaining);
        }
    });

    // Jugador perdió una vida
    socket.on('playerLostLife', (data) => {
        if (gameInstance && gameInstance.isRunning) {
            // Actualizar UI o mostrar algún efecto visual
            const playerName = gameInstance.players[data.playerId]?.name || 'Jugador';
            showTemporaryMessage(`${playerName} perdió una vida (${data.livesRemaining} restantes)`, 'life-lost-notification');
        }
    });
    
    // Jugador se convirtió en espectador
    socket.on('playerBecameSpectator', (data) => {
        if (gameInstance && gameInstance.isRunning) {
            // Actualizar UI o mostrar mensaje
            const playerName = gameInstance.players[data.playerId]?.name || 'Jugador';
            showTemporaryMessage(`${playerName} perdió todas sus vidas`, 'player-eliminated-message');
            
            // Actualizar jugador como espectador
            if (gameInstance.players[data.playerId]) {
                gameInstance.players[data.playerId].isSpectator = true;
            }
        }
    });
    
    // Convertirnos en espectador
    socket.on('becomeSpectator', (data) => {
        if (gameInstance && gameInstance.isRunning) {
            gameInstance.becomeSpectator(data.alivePlayers);
        }
    });
    
    // Espectador cambió de vista
    socket.on('spectatorViewChanged', (data) => {
        if (gameInstance && gameInstance.isRunning && gameInstance.isSpectator) {
            gameInstance.spectatingPlayerId = data.targetId;
        }
    });

    // Recibir ráfaga de aire de otro jugador
    socket.on('receivedAirBlast', (data) => {
        if (gameInstance && gameInstance.isRunning) {
            // Aplicar la velocidad recibida al personaje local
            gameInstance.applyAirBlastEffect(data.velocity);
            
            // Mostrar efecto visual
            const messageDiv = document.createElement('div');
            messageDiv.classList.add('message-overlay', 'attack-message');
            messageDiv.textContent = '¡Has recibido una ráfaga de aire!';
            document.body.appendChild(messageDiv);
            
            // Eliminar mensaje después de 2 segundos
            setTimeout(() => {
                document.body.removeChild(messageDiv);
            }, 2000);
        }
    });

    // Efecto visual de ráfaga de aire entre jugadores
    socket.on('airBlastEffect', (data) => {
        if (gameInstance && gameInstance.isRunning) {
            // Mostrar efecto visual entre el jugador origen y el objetivo
            gameInstance.showAirBlastBetweenPlayers(data.fromId, data.targetId);
        }
    });

    // Manejar evento cuando este jugador es expulsado
    socket.on('kicked', () => {
        // Mostrar mensaje de expulsión y volver al menú principal
        window.menuManager.showKickMessage();
        
        // Reiniciar el estado del cliente
        currentRoomId = null;
        myPlayerId = null;
    });

    // Fin del juego con ganador
    socket.on('gameOver', (data) => {
        // Mostrar pantalla de fin de juego con nombre del ganador
        const gameOverScreen = document.getElementById('game-over-screen');
        const winnerNameElement = document.getElementById('winner-name');
        const countdownElement = document.getElementById('countdown-timer');
        
        // Establecer nombre del ganador
        winnerNameElement.textContent = data.winnerName;
        
        // Iniciar cuenta regresiva
        let countdown = 10;
        countdownElement.textContent = countdown;
        
        // Mostrar pantalla
        gameOverScreen.style.display = 'flex';
        
        // Actualizar cuenta regresiva
        const countdownInterval = setInterval(() => {
            countdown--;
            countdownElement.textContent = countdown;
            
            if (countdown <= 0) {
                clearInterval(countdownInterval);
            }
        }, 1000);
    });

    // Volver al lobby después de fin del juego
    socket.on('returnToLobby', (data) => {
        // Ocultar pantalla de fin de juego
        const gameOverScreen = document.getElementById('game-over-screen');
        gameOverScreen.style.display = 'none';
        
        // Actualizar datos del lobby
        currentRoomId = data.roomId;
        players = data.players;
        
        // Detener el juego si estaba en curso
        if (gameInstance) {
            gameInstance.stop();
            gameInstance = null;
        }
        
        // Mostrar pantalla del lobby
        hideAllScreens();
        showElement(lobbyScreen);
        
        // Actualizar información del lobby
        window.menuManager.updateRoomName(data.roomName || 'Sala');
        window.menuManager.updateMaxPlayerCount(data.maxPlayers);
        window.menuManager.updatePlayerList(players, myPlayerId);
        
        // Actualizar estado del botón de inicio
        updateStartButtonState();
    });

    // Ahora somos el anfitrión de la sala
    socket.on('becameHost', () => {
        if (players && players[myPlayerId]) {
            players[myPlayerId].isHost = true;
            showTemporaryMessage('¡Ahora eres el anfitrión de la sala!', 'host-notification', 3000);
            updateStartButtonState();
        }
    });
}

// Actualizar la lista de salas disponibles
function updateRoomList(rooms) {
    const roomListElement = document.getElementById('room-list');
    roomListElement.innerHTML = '';

    if (rooms.length === 0) {
        const noRoomsMessage = document.createElement('p');
        noRoomsMessage.textContent = 'No hay salas disponibles. ¡Crea una!';
        noRoomsMessage.style.textAlign = 'center';
        noRoomsMessage.style.padding = '10px';
        roomListElement.appendChild(noRoomsMessage);
        return;
    }

    rooms.forEach(room => {
        const roomItem = document.createElement('div');
        roomItem.className = 'room-item';
        roomItem.dataset.roomId = room.id;

        const roomInfo = document.createElement('div');
        roomInfo.className = 'room-info';
        
        const roomName = document.createElement('div');
        roomName.className = 'room-name';
        roomName.textContent = room.name;
        
        const playerCount = document.createElement('div');
        playerCount.className = 'player-count';
        playerCount.textContent = `Jugadores: ${room.players}/${room.maxPlayers}`;
        
        roomInfo.appendChild(roomName);
        roomInfo.appendChild(playerCount);

        const joinButton = document.createElement('button');
        joinButton.textContent = 'Unirse';
        joinButton.addEventListener('click', () => {
            const playerNameInput = document.getElementById('player-name-join');
            playerName = playerNameInput.value.trim() || `Jugador ${Math.floor(Math.random() * 1000)}`;
            joinRoom(room.id, playerName);
        });

        roomItem.appendChild(roomInfo);
        roomItem.appendChild(joinButton);
        roomListElement.appendChild(roomItem);
    });
}

// Unirse a una sala
function joinRoom(roomId, playerName) {
    socket.emit('joinRoom', { roomId, playerName });
}

// Crear una sala
function createRoom(roomName, playerName, maxPlayers) {
    socket.emit('createRoom', { 
        roomName: roomName || `Sala ${Math.floor(Math.random() * 1000)}`,
        maxPlayers: maxPlayers || 4
    });
}

// Abandonar la sala actual
function leaveRoom() {
    if (currentRoomId) {
        socket.emit('leaveRoom');
        currentRoomId = null;

        if (gameInstance) {
            gameInstance.stop();
            gameInstance = null;
        }

        hideAllScreens();
        showElement(menuScreen);
    }
}

// Función para verificar y mostrar todos los elementos principales del DOM
function checkAndLogDOMElements() {
    console.log("=== VERIFICACIÓN DE ELEMENTOS DOM ===");
    
    const elementsToCheck = [
        'loading-screen', 
        'menu-screen', 
        'create-room-screen', 
        'join-room-screen', 
        'lobby-screen',
        'game-container',
        'game-ui',
        'game-over-screen'
    ];
    
    elementsToCheck.forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            console.log(`✅ Elemento '${id}' encontrado - display: ${getComputedStyle(element).display}`);
        } else {
            console.error(`❌ Elemento '${id}' NO encontrado`);
        }
    });
    
    console.log("=============================");
}

// Función para mostrar/ocultar elementos
function hideElement(element) {
    if (!element) {
        console.warn('Intentando ocultar un elemento null o undefined');
        return;
    }
    element.classList.add('hidden');
}

function showElement(element) {
    if (!element) {
        console.warn('Intentando mostrar un elemento null o undefined');
        return;
    }
    element.classList.remove('hidden');
}

function hideAllScreens() {
    console.log('Ocultando todas las pantallas...');
    
    const screens = [
        loadingScreen, 
        menuScreen, 
        createRoomScreen, 
        joinRoomScreen, 
        lobbyScreen
    ];
    
    // Ocultar por ID para asegurar que capturamos todos
    ['game-container', 'game-ui', 'game-over-screen'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.style.display = 'none';
        }
    });
    
    // Ocultar mediante las referencias a variables
    screens.forEach(screen => {
        if (screen) {
            hideElement(screen);
        }
    });
    
    checkAndLogDOMElements();
}

// Verificar el estado del DOM al cargar la página
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM completamente cargado');
    checkAndLogDOMElements();
    
    // Verificar que podemos acceder a window.menuManager
    if (window.menuManager) {
        console.log('✅ menuManager disponible');
    } else {
        console.error('❌ menuManager NO disponible');
    }
    
    // Inicializar referencias a elementos del DOM
    console.log('Inicializando referencias a elementos DOM...');
    
    // Redefinir las variables globales para asegurar que apuntan a elementos existentes
    loadingScreen = document.getElementById('loading-screen');
    menuScreen = document.getElementById('menu-screen');
    createRoomScreen = document.getElementById('create-room-screen');
    joinRoomScreen = document.getElementById('join-room-screen');
    lobbyScreen = document.getElementById('lobby-screen');
    gameContainer = document.getElementById('game-container');
    gameUI = document.getElementById('game-ui');
    
    // Verificar que Three.js esté disponible
    if (typeof THREE !== 'undefined') {
        console.log('✅ Three.js disponible');
    } else {
        console.error('❌ Three.js NO disponible - El juego podría no funcionar correctamente');
    }

    // Botones del menú principal
    document.getElementById('create-room-btn').addEventListener('click', () => {
        hideAllScreens();
        showElement(createRoomScreen);
    });

    document.getElementById('join-room-btn').addEventListener('click', () => {
        hideAllScreens();
        showElement(joinRoomScreen);
        socket.emit('getRooms');
    });

    // Botones de creación de sala
    document.getElementById('create-room-submit').addEventListener('click', () => {
        const roomNameInput = document.getElementById('room-name');
        const playerNameInput = document.getElementById('player-name-create');
        const maxPlayersInput = document.getElementById('max-players');

        const roomName = roomNameInput.value.trim();
        playerName = playerNameInput.value.trim() || `Jugador ${Math.floor(Math.random() * 1000)}`;
        const maxPlayers = parseInt(maxPlayersInput.value) || 4;

        createRoom(roomName, playerName, maxPlayers);
    });

    document.getElementById('create-room-back').addEventListener('click', () => {
        hideAllScreens();
        showElement(menuScreen);
    });

    // Botones de unirse a sala
    document.getElementById('refresh-rooms').addEventListener('click', () => {
        socket.emit('getRooms');
    });

    document.getElementById('join-room-back').addEventListener('click', () => {
        hideAllScreens();
        showElement(menuScreen);
    });

    // Botones de lobby
    document.getElementById('start-game').addEventListener('click', () => {
        socket.emit('startGame');
    });

    document.getElementById('leave-lobby').addEventListener('click', () => {
        leaveRoom();
    });

    // Escuchar evento para expulsar a un jugador
    document.addEventListener('kickPlayer', (event) => {
        const { playerId } = event.detail;
        
        // Emitir evento al servidor para expulsar al jugador
        socket.emit('kickPlayer', { playerId });
    });

    // Inicializar Socket.io
    initializeSocket();
});

// Función para mostrar un mensaje temporal en pantalla
function showTemporaryMessage(message, className = 'info-message', duration = 3000) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message-overlay ${className}`;
    messageDiv.textContent = message;
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        if (messageDiv.parentNode) {
            document.body.removeChild(messageDiv);
        }
    }, duration);
}

// Función para actualizar el estado del botón de inicio según la cantidad de jugadores
function updateStartButtonState() {
    const startButton = document.getElementById('start-game');
    if (!startButton || !players || !myPlayerId) return;
    
    const playerCount = Object.keys(players).length;
    const isHost = players[myPlayerId]?.isHost === true;
    
    // Mostrar u ocultar según si es anfitrión
    if (isHost) {
        startButton.style.display = 'block';
        
        // Verificar si hay suficientes jugadores
        if (playerCount < 2) {
            startButton.classList.add('disabled-btn');
            startButton.disabled = true;
            startButton.title = 'Se necesitan al menos 2 jugadores para iniciar';
        } else {
            startButton.classList.remove('disabled-btn');
            startButton.disabled = false;
            startButton.title = 'Iniciar el juego';
        }
    } else {
        startButton.style.display = 'none';
    }
    
    console.log(`Actualización de botón: isHost=${isHost}, playerCount=${playerCount}, botón visible: ${startButton.style.display}`);
} 