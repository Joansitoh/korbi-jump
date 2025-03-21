// Gestión de los menús y pantallas del juego

class MenuManager {
    constructor() {
        this.screens = {
            loading: document.getElementById('loading-screen'),
            menu: document.getElementById('menu-screen'),
            createRoom: document.getElementById('create-room-screen'),
            joinRoom: document.getElementById('join-room-screen'),
            lobby: document.getElementById('lobby-screen'),
            game: document.getElementById('game-container'),
            gameUI: document.getElementById('game-ui')
        };
        
        // Estado actual
        this.currentScreen = 'loading';
    }
    
    // Mostrar una pantalla específica y ocultar las demás
    showScreen(screenName) {
        if (!this.screens[screenName]) {
            console.error(`Pantalla no encontrada: ${screenName}`);
            return;
        }
        
        // Ocultar todas las pantallas
        Object.values(this.screens).forEach(screen => {
            screen.classList.add('hidden');
        });
        
        // Mostrar la pantalla solicitada
        this.screens[screenName].classList.remove('hidden');
        this.currentScreen = screenName;
    }
    
    // Crear y añadir elementos a la lista de salas
    updateRoomList(rooms) {
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
                const playerName = playerNameInput.value.trim() || `Jugador ${Math.floor(Math.random() * 1000)}`;
                
                // Emitir evento personalizado
                const event = new CustomEvent('joinRoom', { 
                    detail: { roomId: room.id, playerName: playerName }
                });
                document.dispatchEvent(event);
            });
            
            roomItem.appendChild(roomInfo);
            roomItem.appendChild(joinButton);
            roomListElement.appendChild(roomItem);
        });
    }
    
    // Actualizar la lista de jugadores en el lobby
    updatePlayerList(players, myPlayerId) {
        const playerList = document.getElementById('player-list');
        const playerCount = document.getElementById('player-count');
        
        // Limpiar lista existente
        playerList.innerHTML = '';
        
        // Actualizar contador de jugadores
        if (playerCount) {
            const count = Object.keys(players).length;
            playerCount.textContent = count;
        }
        
        // Si no hay jugadores
        if (Object.keys(players).length === 0) {
            const emptyItem = document.createElement('li');
            emptyItem.textContent = 'No hay jugadores en la sala.';
            emptyItem.style.fontStyle = 'italic';
            emptyItem.style.opacity = '0.7';
            playerList.appendChild(emptyItem);
            return;
        }
        
        // Ordenar jugadores (host primero)
        const playerIds = Object.keys(players).sort((a, b) => {
            // El host siempre primero
            if (players[a].isHost) return -1;
            if (players[b].isHost) return 1;
            return 0;
        });
        
        // Para comprobar si somos el host
        const isHost = players[myPlayerId]?.isHost === true;
        
        // Crear elemento para cada jugador
        playerIds.forEach((playerId) => {
            const player = players[playerId];
            const isCurrentPlayer = playerId === myPlayerId;
            
            // Crear elemento de lista
            const playerItem = document.createElement('li');
            playerItem.className = 'player-item';
            playerItem.style.borderLeft = `4px solid ${player.color}`;
            
            // Info del jugador (nombre, icono de host)
            const playerInfo = document.createElement('div');
            playerInfo.className = 'player-info';
            
            // Icono de corona para el host
            if (player.isHost) {
                const crownIcon = document.createElement('span');
                crownIcon.className = 'crown-icon';
                crownIcon.innerHTML = '👑';
                crownIcon.title = 'Anfitrión de la sala';
                playerInfo.appendChild(crownIcon);
            }
            
            // Nombre del jugador
            const playerName = document.createElement('span');
            playerName.textContent = player.name;
            
            // Resaltar jugador actual
            if (isCurrentPlayer) {
                playerName.classList.add('current-player');
                playerName.textContent += ' (Tú)';
            }
            
            playerInfo.appendChild(playerName);
            playerItem.appendChild(playerInfo);
            
            // Si el jugador actual es el host, mostrar botones de expulsión para otros jugadores
            if (isHost && playerId !== myPlayerId) {
                const kickButton = document.createElement('button');
                kickButton.className = 'kick-button';
                kickButton.textContent = 'Expulsar';
                kickButton.addEventListener('click', () => {
                    // Emitir evento para expulsar al jugador
                    const event = new CustomEvent('kickPlayer', { 
                        detail: { playerId: playerId }
                    });
                    document.dispatchEvent(event);
                });
                playerItem.appendChild(kickButton);
            }
            
            playerList.appendChild(playerItem);
        });
    }
    
    // Actualizar el nombre de la sala en el lobby
    updateRoomName(roomName) {
        document.getElementById('lobby-name').textContent = roomName;
    }
    
    // Actualizar el contador máximo de jugadores
    updateMaxPlayerCount(maxPlayers) {
        document.getElementById('max-player-count').textContent = maxPlayers;
    }

    // Mostrar mensaje de expulsión y volver al menú principal
    showKickMessage() {
        const messageOverlay = document.createElement('div');
        messageOverlay.className = 'message-overlay kick-message';
        messageOverlay.textContent = '¡Has sido expulsado de la sala!';
        
        document.body.appendChild(messageOverlay);
        
        // Volver al menú principal después de mostrar el mensaje
        setTimeout(() => {
            this.showScreen('menu');
            setTimeout(() => {
                messageOverlay.remove();
            }, 500);
        }, 2000);
    }
}

// Inicializar el gestor de menús al cargar el DOM
document.addEventListener('DOMContentLoaded', () => {
    window.menuManager = new MenuManager();
    
    // Crear más burbujas aleatorias
    createBubbles();
    
    // Añadir eventos de transición a los botones del menú
    setupMenuTransitions();
});

// Función para crear burbujas flotantes adicionales
function createBubbles() {
    const bubbleContainers = document.querySelectorAll('.floating-bubbles');
    
    bubbleContainers.forEach(container => {
        // Crear más burbujas aleatorias
        for (let i = 0; i < 15; i++) {
            const bubble = document.createElement('div');
            bubble.className = 'bubble';
            
            // Tamaño aleatorio
            const size = 10 + Math.random() * 30;
            bubble.style.width = `${size}px`;
            bubble.style.height = `${size}px`;
            
            // Posición aleatoria
            bubble.style.left = `${Math.random() * 100}%`;
            bubble.style.bottom = `-${size}px`;
            
            // Velocidad aleatoria
            const duration = 7 + Math.random() * 15;
            bubble.style.animation = `floatBubble ${duration}s infinite ease-in`;
            bubble.style.animationDelay = `${Math.random() * 5}s`;
            
            // Transparencia
            bubble.style.opacity = 0.1 + Math.random() * 0.3;
            
            container.appendChild(bubble);
        }
    });
    
    // Añadir estilo para las burbujas
    const style = document.createElement('style');
    style.textContent = `
        .bubble {
            position: absolute;
            background: rgba(255, 255, 255, 0.15);
            border-radius: 50%;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
}

// Configurar transiciones entre pantallas del menú
function setupMenuTransitions() {
    // Botón para crear sala
    const createRoomBtn = document.getElementById('create-room-btn');
    const joinRoomBtn = document.getElementById('join-room-btn');
    const menuScreen = document.getElementById('menu-screen');
    const createRoomScreen = document.getElementById('create-room-screen');
    const joinRoomScreen = document.getElementById('join-room-screen');
    const createRoomBackBtn = document.getElementById('create-room-back');
    const joinRoomBackBtn = document.getElementById('join-room-back');
    
    // Transición al hacer clic en "Crear Sala"
    createRoomBtn.addEventListener('click', () => {
        animateTransition(menuScreen, createRoomScreen);
    });
    
    // Transición al hacer clic en "Unirse a Sala"
    joinRoomBtn.addEventListener('click', () => {
        animateTransition(menuScreen, joinRoomScreen);
    });
    
    // Volver desde la pantalla de crear sala
    createRoomBackBtn.addEventListener('click', () => {
        animateTransition(createRoomScreen, menuScreen, true);
    });
    
    // Volver desde la pantalla de unirse a sala
    joinRoomBackBtn.addEventListener('click', () => {
        animateTransition(joinRoomScreen, menuScreen, true);
    });
}

// Función para animar la transición entre pantallas
function animateTransition(fromScreen, toScreen, isReverse = false) {
    // Preparar pantalla de destino
    toScreen.classList.remove('hidden');
    
    if (isReverse) {
        fromScreen.classList.add('screen-transition-exit');
        toScreen.classList.add('screen-transition-enter-active');
        
        // Ocultar pantalla de origen después de la animación
        setTimeout(() => {
            fromScreen.classList.add('hidden');
            fromScreen.classList.remove('screen-transition-exit');
            toScreen.classList.remove('screen-transition-enter-active');
        }, 500);
    } else {
        // Animar botones del menú primero
        if (fromScreen.id === 'menu-screen') {
            const buttons = fromScreen.querySelectorAll('.menu-btn');
            let delay = 0;
            
            buttons.forEach(button => {
                setTimeout(() => {
                    button.style.transform = 'translateX(-100%)';
                    button.style.opacity = '0';
                }, delay);
                delay += 100;
            });
            
            // Después animar el cambio de pantalla
            setTimeout(() => {
                fromScreen.classList.add('screen-transition-exit');
                toScreen.classList.add('screen-transition-enter-active');
                
                // Ocultar pantalla de origen después de la animación
                setTimeout(() => {
                    fromScreen.classList.add('hidden');
                    fromScreen.classList.remove('screen-transition-exit');
                    toScreen.classList.remove('screen-transition-enter-active');
                    
                    // Restablecer botones
                    buttons.forEach(button => {
                        button.style.transform = '';
                        button.style.opacity = '';
                    });
                }, 500);
            }, 300);
        } else {
            fromScreen.classList.add('screen-transition-exit');
            toScreen.classList.add('screen-transition-enter-active');
            
            // Ocultar pantalla de origen después de la animación
            setTimeout(() => {
                fromScreen.classList.add('hidden');
                fromScreen.classList.remove('screen-transition-exit');
                toScreen.classList.remove('screen-transition-enter-active');
            }, 500);
        }
    }
}

// Crear estrellas en el fondo con un efecto parallax
document.addEventListener('mousemove', (e) => {
    const stars = document.querySelectorAll('.stars-background');
    // Reducir la amplitud del movimiento
    const mouseX = (e.clientX / window.innerWidth - 0.5) * 0.5; // Reducido a la mitad (0.5)
    const mouseY = (e.clientY / window.innerHeight - 0.5) * 0.5; // Reducido a la mitad (0.5)
    
    stars.forEach(star => {
        star.style.transform = `translate(${mouseX * 20}px, ${mouseY * 20}px)`;
    });
}); 