import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

class Game {
    constructor(container, socket, playerId, players, platforms, lavaHeight) {
        this.container = container;
        this.socket = socket;
        this.playerId = playerId;
        this.players = players || {};
        this.platforms = platforms || [];
        this.lavaHeight = lavaHeight || -10;
        this.lavaSpeed = 0.02; // Velocidad inicial de la lava
        
        console.log("Constructor Game - Lava inicial:", this.lavaHeight);
        console.log("Constructor Game - Plataformas:", this.platforms.length);
        console.log("Constructor Game - Jugadores:", Object.keys(this.players).length);
        
        // Propiedades de Three.js
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = null;
        
        // Objetos del juego
        this.playerMeshes = {};
        this.platformMeshes = [];
        this.lavaMesh = null;
        
        // Física y movimiento
        this.playerVelocity = {};
        this.playerOnGround = {};
        this.keys = {};
        this.mouse = { x: 0, y: 0 };
        this.cameraOffset = { x: 0, y: 5, z: 8 };
        this.isJumping = false;
        
        // Control de cámara
        this.isMouseDown = false;
        this.cameraAngle = 0;
        this.lastMouseX = 0;
        
        // Estado del juego
        this.isRunning = false;
        this.gameLoopId = null;
        this.frameCount = 0; // Contador de frames para depuración
        
        // Zoom de la cámara
        this.zoomLevel = 10;
        this.minZoom = 5;
        this.maxZoom = 20;
        
        // Altura máxima alcanzada
        this.maxHeight = 0;
        
        // Tiempo de juego
        this.gameStartTime = Date.now();
        this.gameTime = 0;
        
        // Mecánica de ráfaga de aire
        this.canUseAirBlast = true;
        this.airBlastCooldownTime = 3; // segundos
        this.lastAirBlastTime = 0;
        
        // Sistema de vidas y espectador
        this.lives = 3;
        this.isSpectator = false;
        this.spectatingPlayerId = null;
        this.alivePlayers = [];
        this.currentSpectatorIndex = 0;
        
        // Nombres de jugadores sobre modelos
        this.nameTags = {};
        
        // Inicialización de estructuras de datos
        Object.keys(this.players).forEach(id => {
            this.playerVelocity[id] = { x: 0, y: 0, z: 0 };
            this.playerOnGround[id] = false;
        });
        
        // Cargar modelo de Kirby
        this.kirbyModel = null;
        this.loadingKirby = false;
        
        // Array para mantener registro de animaciones activas
        this.activeAnimations = [];
        
        // Configurar evento para recibir efectos de ráfaga de aire
        this.socket.on('airBlastEffect', (data) => {
            const { position, direction } = data;
            if (position && direction) {
                console.log('Recibido efecto de ráfaga');
                const pos = new THREE.Vector3(position.x, position.y, position.z);
                const dir = new THREE.Vector3(direction.x, direction.y, direction.z);
                this.createAirBlastEffect(pos, dir);
            }
        });
        
        // Configurar evento para recibir empuje de ráfaga de aire
        this.socket.on('airBlastPush', (data) => {
            const { targetId, pushVector } = data;
            
            // Solo aplicar si este cliente es el objetivo
            if (targetId === this.playerId) {
                console.log('Recibido empuje de ráfaga con fuerza:', pushVector);
                
                // Aplicar el empuje a nuestro jugador
                this.applyServerPush(pushVector);
            }
        });
        
        // Compatibilidad con sistema antiguo
        this.socket.on('receivedAirBlast', (data) => {
            const { velocity } = data;
            console.log('Recibido evento legacy de ráfaga:', velocity);
            if (velocity) {
                this.applyServerPush(velocity);
            }
        });
    }
    
    // Iniciar el juego
    start() {
        if (this.isRunning) return;
        
        console.log("Iniciando juego...");
        console.log(`Datos del juego al iniciar - Plataformas: ${this.platforms.length}, Jugadores: ${Object.keys(this.players).length}`);
        
        // Ocultar todas las pantallas excepto el juego
        const screens = ['menu-screen', 'create-room-screen', 'join-room-screen', 'lobby-screen'];
        screens.forEach(screenId => {
            const screen = document.getElementById(screenId);
            if (screen) screen.style.display = 'none';
        });
        
        // Mostrar y configurar el contenedor del juego
        const gameContainer = document.getElementById('game-container');
        if (gameContainer) {
            gameContainer.style.display = 'block';
            gameContainer.style.width = '100%';
            gameContainer.style.height = '100vh';
            gameContainer.style.position = 'absolute';
            gameContainer.style.top = '0';
            gameContainer.style.left = '0';
            gameContainer.style.zIndex = '1';
        }
        
        // Mostrar y configurar la UI del juego
        const gameUI = document.getElementById('game-ui');
        if (gameUI) {
            gameUI.style.display = 'block';
            gameUI.style.position = 'fixed';
            gameUI.style.top = '20px';
            gameUI.style.left = '20px';
            gameUI.style.zIndex = '1000';
            gameUI.style.color = 'white';
            gameUI.style.textShadow = '2px 2px 4px rgba(0,0,0,0.5)';
            gameUI.style.fontFamily = "'Fredoka', sans-serif";
            gameUI.style.fontSize = '18px';
            // gameUI.style.backgroundColor = 'rgba(0,0,0,0.5)';
            gameUI.style.padding = '15px';
            gameUI.style.borderRadius = '10px';
            gameUI.style.minWidth = '200px';
            gameUI.style.pointerEvents = 'none'; // Permitir que los clicks pasen a través de la UI
        }
        
        // Limpiar el contenedor antes de inicializar
        if (this.container) this.container.innerHTML = '';
        
        this.initThree();
        this.setupLights();
        this.createPlatforms(this.platforms);
        this.createLava();
        this.createPlayers();
        this.setupControls();
        
        this.isRunning = true;
        this.gameLoop();
        
        // Ajustar canvas al tamaño de la ventana
        this.onWindowResize();
        window.addEventListener('resize', this.onWindowResize.bind(this));
        
        // Inicializar UI
        this.updateUI();
        
        // Forzar una primera actualización de la UI
        requestAnimationFrame(() => this.updateUI());
    }
    
    // Detener el juego
    stop() {
        if (!this.isRunning) return;
        
        console.log("Deteniendo juego y limpiando estado...");
        
        // Detener el juego antes de limpiar
        this.isRunning = false;
        cancelAnimationFrame(this.gameLoopId);
        
        // Cancelar todas las animaciones en curso
        this.activeAnimations = this.activeAnimations || [];
        this.activeAnimations.forEach(animation => {
            if (animation && animation.cancel) {
                animation.cancel();
            }
        });
        this.activeAnimations = [];
        
        // Limpiar eventos
        window.removeEventListener('resize', this.onWindowResize.bind(this));
        document.removeEventListener('keydown', this.onKeyDown.bind(this));
        document.removeEventListener('keyup', this.onKeyUp.bind(this));
        document.removeEventListener('mousemove', this.onMouseMove.bind(this));
        document.removeEventListener('mousedown', this.onMouseDown.bind(this));
        document.removeEventListener('mouseup', this.onMouseUp.bind(this));
        document.removeEventListener('wheel', this.onWheel.bind(this));
        
        // Limpiar UI y elementos del juego
        this.cleanupGame();
        
        // Restablecer variables de estado
        this.resetGameState();
        
        // Mostrar la sala de espera
        this.showLobbyScreen();
        
        // Forzar una actualización del DOM para asegurar que los cambios se aplican
        requestAnimationFrame(() => {
            // Asegurar que el contenedor del juego está oculto
            const gameContainer = document.getElementById('game-container');
            if (gameContainer) {
                gameContainer.style.display = 'none';
                gameContainer.innerHTML = '';
            }
            
            // Asegurar que la UI del juego está oculta
            const gameUI = document.getElementById('game-ui');
            if (gameUI) {
                gameUI.style.display = 'none';
            }
            
            // Mostrar el lobby explícitamente
            const lobbyScreen = document.getElementById('lobby-screen');
            if (lobbyScreen) {
                lobbyScreen.style.display = 'block';
                lobbyScreen.style.opacity = '1';
                lobbyScreen.style.visibility = 'visible';
            }
        });
    }
    
    // Limpiar todos los elementos del juego
    cleanupGame() {
        // Limpiar escena
        if (this.scene) {
            while(this.scene.children.length > 0) { 
                const object = this.scene.children[0];
                if (object.geometry) object.geometry.dispose();
                if (object.material) {
                    if (Array.isArray(object.material)) {
                        object.material.forEach(material => material.dispose());
                    } else {
                        object.material.dispose();
                    }
                }
                this.scene.remove(object);
            }
        }
        
        // Limpiar renderer
        if (this.renderer) {
            this.renderer.dispose();
            this.container.removeChild(this.renderer.domElement);
        }
        
        // Limpiar UI del juego
        const gameUI = document.getElementById('game-ui');
        if (gameUI) gameUI.style.display = 'none';
        
        // Limpiar UI del espectador
        const spectatorOverlay = document.getElementById('spectator-overlay');
        if (spectatorOverlay) spectatorOverlay.remove();
        
        // Limpiar otros overlays
        const messageOverlays = document.querySelectorAll('.message-overlay');
        messageOverlays.forEach(overlay => overlay.remove());
        
        // Ocultar contenedor del juego
        const gameContainer = document.getElementById('game-container');
        if (gameContainer) {
            gameContainer.style.display = 'none';
            gameContainer.innerHTML = '';
        }
    }
    
    // Restablecer variables de estado del juego
    resetGameState() {
        // Restablecer propiedades básicas
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.clock = null;
        
        // Limpiar referencias a objetos del juego
        this.playerMeshes = {};
        this.platformMeshes = [];
        this.lavaMesh = null;
        this.lavaLight = null;
        this.lavaParticles = null;
        
        // Restablecer física y movimiento
        this.playerVelocity = {};
        this.playerOnGround = {};
        this.keys = {};
        this.mouse = { x: 0, y: 0 };
        
        // Restablecer estado del juego
        this.isSpectator = false;
        this.spectatingPlayerId = null;
        this.lives = 3;
        this.maxHeight = 0;
        this.gameTime = 0;
        this.canUseAirBlast = true;
        this.airBlastCooldown = 0;
        
        // Limpiar nametags
        this.nameTags = {};
    }
    
    // Mostrar la sala de espera
    showLobbyScreen() {
        // Ocultar todas las pantallas excepto el lobby
        const screens = ['game-container', 'game-ui', 'menu-screen', 'create-room-screen', 'join-room-screen'];
        screens.forEach(screenId => {
            const screen = document.getElementById(screenId);
            if (screen) {
                screen.style.display = 'none';
                screen.style.opacity = '0';
                screen.style.visibility = 'hidden';
            }
        });
        
        // Mostrar la sala de espera
        const lobbyScreen = document.getElementById('lobby-screen');
        if (lobbyScreen) {
            lobbyScreen.style.display = 'block';
            lobbyScreen.style.opacity = '1';
            lobbyScreen.style.visibility = 'visible';
            lobbyScreen.style.zIndex = '1000';
            lobbyScreen.style.position = 'fixed';
            lobbyScreen.style.top = '0';
            lobbyScreen.style.left = '0';
            lobbyScreen.style.width = '100%';
            lobbyScreen.style.height = '100%';
            lobbyScreen.style.backgroundColor = '#ffffff';
        }
        
        // Limpiar cualquier overlay o mensaje residual
        const overlays = document.querySelectorAll('.message-overlay, .spectator-overlay');
        overlays.forEach(overlay => {
            if (overlay && overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        });
        
        // Forzar un reflow del DOM para asegurar que los cambios se aplican
        document.body.offsetHeight;
    }
    
    // Inicializar Three.js
    initThree() {
        // Verificar que tenemos un contenedor válido
        if (!this.container) {
            console.error('Error: No se encontró el contenedor del juego');
            return false;
        }
        
        // Verificar que Three.js está disponible
        if (typeof THREE === 'undefined') {
            console.error('Error: THREE no está definido. Asegúrate de cargar Three.js correctamente.');
            return false;
        }
        
        console.log('Inicializando Three.js en el contenedor:', this.container);
        
        try {
            // Crear escena
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(0x87CEEB); // Color cielo
            
            // Crear cámara
            const aspectRatio = window.innerWidth / window.innerHeight;
            this.camera = new THREE.PerspectiveCamera(75, aspectRatio, 0.1, 1000);
            
            // Posición inicial de la cámara
            this.camera.position.set(0, 20, 20);
            this.camera.lookAt(0, 0, 0);
            
            // Crear renderizador con antialiasing y corrección gamma
            this.renderer = new THREE.WebGLRenderer({ 
                antialias: true,
                alpha: true,
                powerPreference: "high-performance"
            });
            this.renderer.setPixelRatio(window.devicePixelRatio);
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            this.renderer.outputColorSpace = THREE.SRGBColorSpace;
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1;
            
            // Limpiar el contenedor y añadir el canvas
            this.container.innerHTML = '';
            this.container.appendChild(this.renderer.domElement);
            
            // Reloj para animaciones
            this.clock = new THREE.Clock();
            
            // Niebla para efecto de distancia
            this.scene.fog = new THREE.FogExp2(0x87CEEB, 0.01);
            
            console.log('Three.js inicializado correctamente');
            return true;
        } catch (error) {
            console.error('Error al inicializar Three.js:', error);
            return false;
        }
    }
    
    // Configurar luces
    setupLights() {
        // Luz ambiental
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        this.scene.add(ambientLight);
        
        // Luz direccional principal (sol)
        const mainLight = new THREE.DirectionalLight(0xffffff, 1.0);
        mainLight.position.set(10, 20, 10);
        mainLight.castShadow = true;
        
        // Configurar sombras de alta calidad
        mainLight.shadow.mapSize.width = 2048;
        mainLight.shadow.mapSize.height = 2048;
        mainLight.shadow.camera.near = 0.5;
        mainLight.shadow.camera.far = 50;
        mainLight.shadow.camera.left = -20;
        mainLight.shadow.camera.right = 20;
        mainLight.shadow.camera.top = 20;
        mainLight.shadow.camera.bottom = -20;
        mainLight.shadow.bias = -0.0001;
        
        this.scene.add(mainLight);
        
        // Luz de relleno desde el lado opuesto
        const fillLight = new THREE.DirectionalLight(0x8088ff, 0.4);
        fillLight.position.set(-10, 15, -10);
        this.scene.add(fillLight);
        
        // Luz de rebote desde abajo
        const bounceLight = new THREE.DirectionalLight(0x4466ff, 0.2);
        bounceLight.position.set(0, -10, 0);
        this.scene.add(bounceLight);
        
        // Ayudantes visuales para depuración (comentados en producción)
        /*
        const helper = new THREE.DirectionalLightHelper(mainLight, 5);
        this.scene.add(helper);
        const shadowHelper = new THREE.CameraHelper(mainLight.shadow.camera);
        this.scene.add(shadowHelper);
        */
    }
    
    // Crear plataformas
    createPlatforms(platforms) {
        console.log("Creando plataformas:", platforms);
        
        // Validación - asegurarse que platforms existe y es un array
        if (!platforms || !Array.isArray(platforms)) {
            console.error("Error: platforms no es un array válido", platforms);
            platforms = [];
        }
        
        // Limpiar plataformas existentes
        this.platformMeshes.forEach(mesh => {
            if (mesh && mesh.parent) {
                this.scene.remove(mesh);
            }
        });
        this.platformMeshes = [];
        
        // Si no hay plataformas, o necesitamos asegurar una plataforma base
        const needBasePlatform = platforms.length === 0 || 
            !platforms.some(p => p.type === 'base' || 
                (p.position && p.position.y === 0) || 
                (p.y === 0));
        
        if (needBasePlatform) {
            console.warn("Agregando plataforma base garantizada para inicio seguro de jugadores");
            // Añadir plataforma base grande al inicio de la lista
            platforms.unshift({
                position: { x: 0, y: 0, z: 0 },
                size: { x: 30, y: 1, z: 30 },
                type: 'base'
            });
        }
        
        // Crear material para plataformas
        const platformMaterial = new THREE.MeshLambertMaterial({ color: 0x8BC34A });
        
        // Crear cada plataforma según su tipo
        platforms.forEach((platform, index) => {
            try {
                let mesh;
                
                // Normalizar el formato de la plataforma (manejar ambos formatos)
                const normalizedPlatform = {
                    position: {
                        x: platform.x !== undefined ? platform.x : (platform.position?.x || 0),
                        y: platform.y !== undefined ? platform.y : (platform.position?.y || 0),
                        z: platform.z !== undefined ? platform.z : (platform.position?.z || 0)
                    },
                    size: {
                        x: platform.width !== undefined ? platform.width : (platform.size?.x || 5),
                        y: platform.height !== undefined ? platform.height : (platform.size?.y || 1),
                        z: platform.depth !== undefined ? platform.depth : (platform.size?.z || 5)
                    },
                    type: platform.type || 'box',
                    radius: platform.radius || 2.5,
                    height: platform.height || 1
                };
                
                // Si es la plataforma base, asegurar que tiene tamaño suficiente
                if (index === 0 || normalizedPlatform.type === 'base') {
                    normalizedPlatform.size.x = Math.max(normalizedPlatform.size.x, 30);
                    normalizedPlatform.size.z = Math.max(normalizedPlatform.size.z, 30);
                    normalizedPlatform.type = 'base';
                }
                
                console.log(`Plataforma normalizada ${index}:`, normalizedPlatform);
                
                if (normalizedPlatform.type === 'box' || normalizedPlatform.type === 'base') {
                    // Plataforma rectangular
                    const geometry = new THREE.BoxGeometry(
                        normalizedPlatform.size.x, 
                        normalizedPlatform.size.y, 
                        normalizedPlatform.size.z
                    );
                    
                    // Usar material específico para la plataforma base
                    let material;
                    if (normalizedPlatform.type === 'base') {
                        material = new THREE.MeshStandardMaterial({ 
                            color: 0xA5D6A7,
                            roughness: 0.6,
                            metalness: 0.2
                        });
                    } else {
                        material = platformMaterial;
                    }
                    
                    mesh = new THREE.Mesh(geometry, material);
                    mesh.position.set(
                        normalizedPlatform.position.x,
                        normalizedPlatform.position.y,
                        normalizedPlatform.position.z
                    );
                } else if (normalizedPlatform.type === 'circle') {
                    // Plataforma circular
                    const geometry = new THREE.CylinderGeometry(
                        normalizedPlatform.radius,
                        normalizedPlatform.radius,
                        normalizedPlatform.height,
                        32
                    );
                    mesh = new THREE.Mesh(geometry, platformMaterial);
                    mesh.position.set(
                        normalizedPlatform.position.x,
                        normalizedPlatform.position.y,
                        normalizedPlatform.position.z
                    );
                }
                
                if (mesh) {
                    // Configurar sombras
                    mesh.receiveShadow = true;
                    mesh.castShadow = true;
                    
                    // Guardar datos de la plataforma en el mesh para detección de colisiones
                    mesh.userData.platform = normalizedPlatform;
                    mesh.userData.width = normalizedPlatform.size.x;
                    mesh.userData.height = normalizedPlatform.size.y;
                    mesh.userData.depth = normalizedPlatform.size.z;
                    mesh.userData.index = index;
                    
                    if (index === 0 || normalizedPlatform.type === 'base') {
                        mesh.userData.isBasePlatform = true;
                        console.log(`Plataforma base definida en posición (${normalizedPlatform.position.x}, ${normalizedPlatform.position.y}, ${normalizedPlatform.position.z}) con tamaño ${normalizedPlatform.size.x}x${normalizedPlatform.size.z}`);
                        
                        // Posicionar jugadores arriba de la plataforma base si es la primera creación
                        if (index === 0 && Object.keys(this.playerMeshes).length === 0) {
                            console.log("Posicionando jugadores sobre la plataforma base");
                            this.positionPlayersAbovePlatform(mesh);
                        }
                        
                        // Resaltar visualmente la plataforma base
                        this.highlightBasePlatform(mesh);
                    }
                    
                    // Añadir a la escena
                    this.scene.add(mesh);
                    this.platformMeshes.push(mesh);
                }
            } catch (error) {
                console.error(`Error al crear plataforma ${index}:`, error, platform);
            }
        });
        
        console.log(`Se crearon ${this.platformMeshes.length} plataformas`);
    }
    
    // Posicionar jugadores arriba de la plataforma base
    positionPlayersAbovePlatform(basePlatform) {
        if (!basePlatform || !this.players) return;
        
        const platformY = basePlatform.position.y;
        const platformTop = platformY + (basePlatform.userData.height / 2);
        const playerHeight = 1; // Altura aproximada del jugador
        
        // La posición Y segura está justo encima de la plataforma
        const safeY = platformTop + playerHeight + 0.5;
        
        // Distribuir jugadores en un círculo sobre la plataforma
        const playerIds = Object.keys(this.players);
        const radius = Math.min(5, playerIds.length); // Radio del círculo dependiendo del número de jugadores
        
        playerIds.forEach((playerId, index) => {
            // Calcular posición en círculo
            const angle = (index / playerIds.length) * Math.PI * 2;
            const offsetX = Math.cos(angle) * radius;
            const offsetZ = Math.sin(angle) * radius;
            
            // Actualizar posición del jugador
            if (this.players[playerId]) {
                this.players[playerId].position = {
                    x: basePlatform.position.x + offsetX,
                    y: safeY,
                    z: basePlatform.position.z + offsetZ
                };
                
                // Si el mesh ya existe, actualizarlo también
                if (this.playerMeshes[playerId]) {
                    this.playerMeshes[playerId].position.set(
                        basePlatform.position.x + offsetX,
                        safeY,
                        basePlatform.position.z + offsetZ
                    );
                    
                    // Actualizar nametag
                    this.updateNametagPosition(playerId);
                }
                
                console.log(`Jugador ${playerId} posicionado en (${basePlatform.position.x + offsetX}, ${safeY}, ${basePlatform.position.z + offsetZ})`);
            }
        });
    }
    
    // Crear lava
    createLava() {
        // Crear material de lava con efecto brillante y animado
        const lavaTexture = new THREE.TextureLoader().load('textures/lava.gif');
        lavaTexture.wrapS = THREE.RepeatWrapping;
        lavaTexture.wrapT = THREE.RepeatWrapping;
        lavaTexture.repeat.set(10, 10);
        
        // Textura de ruido para el desplazamiento
        const noiseTexture = new THREE.TextureLoader().load('textures/noise.jpg');
        noiseTexture.wrapS = THREE.RepeatWrapping;
        noiseTexture.wrapT = THREE.RepeatWrapping;
        noiseTexture.repeat.set(5, 5);
        
        const lavaMaterial = new THREE.MeshPhongMaterial({ 
            color: 0xff4500,
            emissive: 0xff2200,
            emissiveIntensity: 0.8,
            shininess: 80,
            specular: 0xff0000,
            map: lavaTexture,
            displacementMap: noiseTexture,
            displacementScale: 0.5,
            transparent: true,
            opacity: 0.9
        });
        
        // Crear geometría grande para la lava con más subdivisiones
        const lavaSize = 200;
        const segments = 128; // Más segmentos para mejor detalle
        const lavaGeometry = new THREE.PlaneGeometry(lavaSize, lavaSize, segments, segments);
        this.lavaMesh = new THREE.Mesh(lavaGeometry, lavaMaterial);
        
        // Rotar para que sea horizontal
        this.lavaMesh.rotation.x = -Math.PI / 2;
        
        // Posicionar lava
        this.lavaMesh.position.y = this.lavaHeight;
        
        // Habilitar sombras para la lava
        this.lavaMesh.receiveShadow = true;
        
        this.scene.add(this.lavaMesh);
        
        // Crear efecto de partículas sobre la lava
        this.createLavaParticles();
        
        // Crear luz de la lava
        const lavaLight = new THREE.PointLight(0xff4500, 2, 50);
        lavaLight.position.set(0, this.lavaHeight + 5, 0);
        this.scene.add(lavaLight);
        this.lavaLight = lavaLight;
    }
    
    // Crear efecto de partículas para la lava
    createLavaParticles() {
        const particleCount = 1000;
        const particles = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        
        for (let i = 0; i < particleCount * 3; i += 3) {
            positions[i] = Math.random() * 200 - 100;     // x
            positions[i + 1] = this.lavaHeight;           // y
            positions[i + 2] = Math.random() * 200 - 100; // z
        }
        
        particles.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        
        const particleMaterial = new THREE.PointsMaterial({
            color: 0xff6633,
            size: 0.5,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending
        });
        
        this.lavaParticles = new THREE.Points(particles, particleMaterial);
        this.scene.add(this.lavaParticles);
    }
    
    // Cargar y crear modelos de jugadores
    createPlayers() {
        console.log("Creando jugadores en la escena, total:", Object.keys(this.players).length);
        
        // Inicializar la velocidad del jugador local
        if (this.players[this.playerId]) {
            console.log(`Inicializando jugador local en: x=${this.players[this.playerId].position?.x || 0}, y=${this.players[this.playerId].position?.y || 15}, z=${this.players[this.playerId].position?.z || 0}`);
            
            // Asegurar que la posición tenga valores numéricos válidos
            if (!this.players[this.playerId].position) {
                this.players[this.playerId].position = { x: 0, y: 15, z: 0 };
            } else {
                // Verificar y corregir cada componente de posición
                if (isNaN(this.players[this.playerId].position.x)) this.players[this.playerId].position.x = 0;
                if (isNaN(this.players[this.playerId].position.y)) this.players[this.playerId].position.y = 15;
                if (isNaN(this.players[this.playerId].position.z)) this.players[this.playerId].position.z = 0;
            }
            
            this.playerVelocity[this.playerId] = { x: 0, y: 0, z: 0 };
            this.playerOnGround[this.playerId] = false;
        } else {
            console.error("No se encontró el jugador local en los datos");
        }
        
        // Crear un mesh para cada jugador
        Object.keys(this.players).forEach(playerId => {
            const player = this.players[playerId];
            
            // Verificar si el jugador tiene una posición definida
            if (!player.position) {
                console.warn(`Jugador ${playerId} sin posición, estableciendo predeterminada`);
                player.position = { x: 0, y: 15, z: 0 };
            } else {
                // Verificar y corregir cada componente de posición
                if (isNaN(player.position.x)) player.position.x = 0;
                if (isNaN(player.position.y)) player.position.y = 15;
                if (isNaN(player.position.z)) player.position.z = 0;
            }
            
            // Crear el modelo del jugador
            this.createPlayerMesh(playerId, player);
            
            // Para otros jugadores, inicializar vectores de velocidad
            if (playerId !== this.playerId) {
                this.playerVelocity[playerId] = { x: 0, y: 0, z: 0 };
                this.playerOnGround[playerId] = false;
            }
        });
    }
    
    // Crear un modelo de jugador con su nametag
    createPlayerMesh(playerId, player) {
        console.log(`Creando modelo para jugador ${playerId} en posición:`, player.position);
        
        // Crear nametag para el jugador
        const nametag = this.createNameTag(player.name, player.color);
        this.scene.add(nametag);
        this.nameTags[playerId] = nametag;
        
        try {
            // Intentar cargar modelo GLTF si es posible
            const loader = new GLTFLoader();
            loader.load(
                'models/kirby.glb',
                (gltf) => {
                    const model = gltf.scene;
                    model.scale.set(0.4, 0.4, 0.4);
                    
                    // Ajustar la posición vertical para que el modelo esté correctamente en el suelo
                    const modelOffset = -0.3; // Offset vertical para alinear el modelo con el suelo
                    model.position.set(
                        player.position.x,
                        player.position.y + modelOffset,
                        player.position.z
                    );
                    
                    model.traverse((child) => {
                        if (child.isMesh) {
                            child.castShadow = true;
                            // Colorear el modelo según el color del jugador
                            if (child.material && child.material.name === 'body') {
                                child.material.color.set(player.color);
                            }
                        }
                    });
                    this.scene.add(model);
                    this.playerMeshes[playerId] = model;
                    
                    // Actualizar posición del nametag
                    this.updateNametagPosition(playerId);
                },
                undefined,
                (error) => {
                    console.error("Error cargando modelo GLTF:", error);
                    // Usar modelo simple como fallback
                    this.createSimpleKirbyModel(playerId, player);
                }
            );
        } catch (e) {
            console.warn("Error intentando crear GLTFLoader, usando modelo simple:", e);
            // Usar modelo simple como fallback
            this.createSimpleKirbyModel(playerId, player);
        }
    }

    // Crear un modelo simple de Kirby como fallback
    createSimpleKirbyModel(playerId, player) {
        // Crear esfera para representar a Kirby
        const geometry = new THREE.SphereGeometry(0.3, 32, 32); // Reducido de 0.5 a 0.3
        const material = new THREE.MeshLambertMaterial({ color: player.color });
        const kirbyMesh = new THREE.Mesh(geometry, material);
        
        // Ajustar la posición vertical para que el modelo esté correctamente en el suelo
        const modelOffset = -0.3;
        kirbyMesh.position.set(
            player.position.x,
            player.position.y + modelOffset,
            player.position.z
        );
        kirbyMesh.castShadow = true;
        
        this.scene.add(kirbyMesh);
        this.playerMeshes[playerId] = kirbyMesh;
        
        // Actualizar posición del nametag
        this.updateNametagPosition(playerId);
    }
    
    // Actualizar posición del nametag con respecto al jugador
    updateNametagPosition(playerId) {
        if (!this.playerMeshes[playerId] || !this.nameTags[playerId]) {
            return;
        }
        
        const playerMesh = this.playerMeshes[playerId];
        const nametag = this.nameTags[playerId];
        
        // Posicionar el nametag encima del jugador
        const position = new THREE.Vector3();
        position.setFromMatrixPosition(playerMesh.matrixWorld);
        nametag.position.set(position.x, position.y + 1.5, position.z);
        
        // Hacer que el nametag siempre mire a la cámara
        if (this.camera) {
            nametag.lookAt(this.camera.position);
        }
    }
    
    // Actualizar la posición de un jugador
    updatePlayerPosition(playerId, position) {
        if (this.players[playerId] && this.playerMeshes[playerId]) {
            this.players[playerId].position = position;
            this.playerMeshes[playerId].position.set(
                position.x,
                position.y,
                position.z
            );
            
            // Actualizar también la posición del nametag
            this.updateNametagPosition(playerId);
        }
    }
    
    // Configurar controles
    setupControls() {
        // Teclado
        document.addEventListener('keydown', this.onKeyDown.bind(this));
        document.addEventListener('keyup', this.onKeyUp.bind(this));
        
        // Ratón
        document.addEventListener('mousemove', this.onMouseMove.bind(this));
        document.addEventListener('mousedown', this.onMouseDown.bind(this));
        document.addEventListener('mouseup', this.onMouseUp.bind(this));
        
        // Rueda para zoom
        document.addEventListener('wheel', this.onWheel.bind(this));
    }
    
    // Evento: Tecla pulsada
    onKeyDown(event) {
        // Guardar estado de la tecla (compatible con letras y teclas especiales)
        this.keys[event.key.toLowerCase()] = true;
        
        // También mapear teclas especiales con nombres alternativos
        switch (event.key) {
            case 'ArrowUp':
                this.keys['ArrowUp'] = true;
                break;
            case 'ArrowDown':
                this.keys['ArrowDown'] = true;
                break;
            case 'ArrowLeft':
                this.keys['ArrowLeft'] = true;
                break;
            case 'ArrowRight':
                this.keys['ArrowRight'] = true;
                break;
            case ' ':
                this.keys['Space'] = true;
                break;
        }
        
        // Evitar movimiento de la página con las teclas de flecha y espacio
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(event.key)) {
            event.preventDefault();
        }
        
        // Ráfaga de aire (Shift)
        if ((event.key === 'Shift' || event.key === 'ShiftLeft' || event.key === 'ShiftRight') && this.canUseAirBlast) {
            this.useAirBlast();
        }
    }
    
    // Evento: Tecla liberada
    onKeyUp(event) {
        // Actualizar estado
        this.keys[event.key.toLowerCase()] = false;
        
        // Manejar teclas especiales
        switch (event.key) {
            case 'ArrowUp':
                this.keys['ArrowUp'] = false;
                break;
            case 'ArrowDown':
                this.keys['ArrowDown'] = false;
                break;
            case 'ArrowLeft':
                this.keys['ArrowLeft'] = false;
                break;
            case 'ArrowRight':
                this.keys['ArrowRight'] = false;
                break;
            case ' ':
                this.keys['Space'] = false;
                break;
        }
    }
    
    // Evento: Botón del ratón pulsado
    onMouseDown(event) {
        this.isMouseDown = true;
        this.lastMouseX = event.clientX;
    }
    
    // Evento: Botón del ratón liberado
    onMouseUp() {
        this.isMouseDown = false;
    }
    
    // Evento: Movimiento del ratón
    onMouseMove(event) {
        // Guardar posición del ratón para controles generales
        this.mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
        
        // Rotación de la cámara cuando se mantiene pulsado el botón del ratón
        if (this.isMouseDown) {
            const deltaX = this.lastMouseX - event.clientX;
            this.cameraAngle += deltaX * 0.01;
            this.lastMouseX = event.clientX;
        }
    }
    
    // Evento: Rueda del ratón para zoom
    onWheel(event) {
        this.zoomLevel += event.deltaY * 0.01;
        this.zoomLevel = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomLevel));
    }
    
    // Evento: Cambio de tamaño de ventana
    onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }
    
    // Restablecer jugador (cayó en la lava)
    resetPlayer(playerId, position, livesRemaining) {
        try {
            // Actualizar vidas si es el jugador local
            if (playerId === this.playerId) {
                this.lives = livesRemaining || 0;
                
                // Si no quedan vidas, entrar en modo espectador
                if (this.lives <= 0) {
                    this.enterSpectatorMode();
                    return; // Salir temprano ya que el jugador está muerto
                }
                
                // Reiniciar velocidad
                if (this.playerVelocity[playerId]) {
                    this.playerVelocity[playerId] = { x: 0, y: 0, z: 0 };
                }
            }
            
            // Actualizar posición del jugador si aún existe
            if (this.players[playerId] && position) {
                this.players[playerId].position = position;
                
                // Actualizar mesh del jugador si existe
                if (this.playerMeshes[playerId]) {
                    this.playerMeshes[playerId].position.set(
                        position.x,
                        position.y,
                        position.z
                    );
                    
                    // Actualizar nametag
                    this.updateNametagPosition(playerId);
                }
                
                // Crear efecto de respawn
                this.createRespawnEffect(position);
            }
            
            // Actualizar UI
            this.updateUI();
            
        } catch (error) {
            console.error('Error en resetPlayer:', error);
        }
    }
    
    // Mostrar mensaje de vida perdida
    showLostLifeMessage(livesRemaining) {
        // Crear elemento de mensaje temporal
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message-overlay', 'life-lost-message');
        
        if (livesRemaining > 0) {
            messageDiv.innerHTML = `
                <span class="life-icon">❤️</span>
                <span>¡Perdiste una vida! Te quedan ${livesRemaining}</span>
            `;
        } else {
            messageDiv.innerHTML = `
                <span class="life-icon">💀</span>
                <span>¡Has perdido todas tus vidas!</span>
            `;
        }
        
        document.body.appendChild(messageDiv);
        
        // Eliminar mensaje después de 3 segundos
        setTimeout(() => {
            if (messageDiv.parentNode) {
                document.body.removeChild(messageDiv);
            }
        }, 3000);
    }
    
    // Crear efecto visual de respawn
    createRespawnEffect(position) {
        if (!this.isRunning || !this.scene) return;
        
        // Crear efecto de respawn (aura, partículas, etc.)
        const geometry = new THREE.SphereGeometry(1, 16, 16);
        const material = new THREE.MeshBasicMaterial({
            color: 0x00ffff,
            transparent: true,
            opacity: 0.5
        });
        
        const effect = new THREE.Mesh(geometry, material);
        effect.position.set(position.x, position.y, position.z);
        this.scene.add(effect);
        
        // Animar y eliminar después
        const startTime = Date.now();
        
        const animateEffect = () => {
            if (!this.isRunning || !this.scene) {
                if (effect.parent) {
                    effect.parent.remove(effect);
                }
                material.dispose();
                geometry.dispose();
                return;
            }
            
            const elapsed = (Date.now() - startTime) / 1000;
            
            // Expandir y desvanecer
            effect.scale.set(1 + elapsed, 1 + elapsed, 1 + elapsed);
            effect.material.opacity = 0.5 * (1 - elapsed / 1.5);
            
            if (elapsed < 1.5) {
                const animationId = requestAnimationFrame(animateEffect);
                this.activeAnimations = this.activeAnimations || [];
                this.activeAnimations.push({
                    cancel: () => {
                        cancelAnimationFrame(animationId);
                        if (effect.parent) {
                            effect.parent.remove(effect);
                        }
                        material.dispose();
                        geometry.dispose();
                    }
                });
            } else {
                if (effect.parent) {
                    effect.parent.remove(effect);
                }
                material.dispose();
                geometry.dispose();
            }
        };
        
        animateEffect();
    }
    
    // Actualizar la altura de la lava
    updateLavaHeight(height) {
        this.lavaHeight = height;
        
        if (this.lavaMesh) {
            this.lavaMesh.position.y = this.lavaHeight;
        }
        
        // Actualizar UI de la altura de la lava
        this.updateUI();
        
        // Comprobar y destruir plataformas sumergidas en la lava
        this.checkPlatformsInLava();
    }
    
    // Comprobar qué plataformas están sumergidas en la lava y destruirlas
    checkPlatformsInLava() {
        // Iteramos de atrás hacia adelante para poder eliminar elementos sin afectar al índice
        for (let i = this.platformMeshes.length - 1; i >= 0; i--) {
            const platform = this.platformMeshes[i];
            const platformData = platform.userData.platform;
            
            // Consideramos una plataforma sumergida si su parte superior está por debajo de la lava
            const platformTopY = platformData.position.y + (platformData.size ? platformData.size.y / 2 : platformData.height / 2);
            
            if (platformTopY <= this.lavaHeight) {
                // Añadir efecto de destrucción (partículas, sonido, etc.)
                this.createDestructionEffect(platform.position);
                
                // Eliminar la plataforma de la escena
                this.scene.remove(platform);
                this.platformMeshes.splice(i, 1);
            }
        }
    }
    
    // Crear efecto visual de destrucción de plataforma
    createDestructionEffect(position) {
        if (!this.isRunning || !this.scene) return;
        
        const geometry = new THREE.BufferGeometry();
        const vertices = [];
        
        for (let i = 0; i < 50; i++) {
            const x = position.x + (Math.random() - 0.5) * 2;
            const y = position.y + (Math.random() - 0.5) * 2;
            const z = position.z + (Math.random() - 0.5) * 2;
            vertices.push(x, y, z);
        }
        
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
        
        const material = new THREE.PointsMaterial({
            color: 0x8BC34A,
            size: 0.1,
            blending: THREE.AdditiveBlending
        });
        
        const particles = new THREE.Points(geometry, material);
        this.scene.add(particles);
        
        const startTime = Date.now();
        
        const animateParticles = () => {
            if (!this.isRunning || !this.scene) {
                if (particles.parent) {
                    particles.parent.remove(particles);
                }
                material.dispose();
                geometry.dispose();
                return;
            }
            
            const positions = particles.geometry.attributes.position.array;
            const elapsed = (Date.now() - startTime) / 1000;
            
            for (let i = 0; i < positions.length; i += 3) {
                positions[i] += (Math.random() - 0.5) * 0.05;
                positions[i + 1] += 0.05;
                positions[i + 2] += (Math.random() - 0.5) * 0.05;
            }
            
            particles.geometry.attributes.position.needsUpdate = true;
            particles.material.opacity = 1 - elapsed;
            
            if (elapsed < 2) {
                const animationId = requestAnimationFrame(animateParticles);
                this.activeAnimations = this.activeAnimations || [];
                this.activeAnimations.push({
                    cancel: () => {
                        cancelAnimationFrame(animationId);
                        if (particles.parent) {
                            particles.parent.remove(particles);
                        }
                        material.dispose();
                        geometry.dispose();
                    }
                });
            } else {
                if (particles.parent) {
                    particles.parent.remove(particles);
                }
                material.dispose();
                geometry.dispose();
            }
        };
        
        animateParticles();
    }
    
    // Actualizar la velocidad de subida de la lava
    updateLavaSpeed(speed) {
        this.lavaSpeed = speed;
        
        // Actualizar la UI
        this.updateUI();
        
        // Actualizar el material de la lava para indicar visualmente el cambio
        if (this.lavaMesh && this.lavaMesh.material) {
            // Aumentar el brillo o la intensidad del color según la velocidad
            const intensity = 0.5 + (speed * 10); // Ajustar factor según sea necesario
            this.lavaMesh.material.emissiveIntensity = intensity;
            
            // También podemos cambiar el color para que sea más intenso
            const r = Math.min(1, 0.6 + speed * 5);
            this.lavaMesh.material.emissive.setRGB(r, 0.2, 0);
        }
    }
    
    // Actualizar la UI del juego
    updateUI() {
        try {
            // Actualizar altura del jugador solo si no es espectador y existe el mesh
            const playerHeightElement = document.getElementById('player-height');
            if (playerHeightElement) {
                if (!this.isSpectator && this.playerMeshes[this.playerId]) {
                    const playerHeight = Math.floor(this.playerMeshes[this.playerId].position.y);
                    playerHeightElement.textContent = playerHeight.toString();
                    
                    // Actualizar altura máxima si corresponde
                    if (playerHeight > this.maxHeight) {
                        this.maxHeight = playerHeight;
                    }
                } else {
                    playerHeightElement.textContent = '0';
                }
            }
            
            // Actualizar altura de la lava
            const lavaHeightElement = document.getElementById('lava-height');
            if (lavaHeightElement) {
                lavaHeightElement.textContent = Math.floor(this.lavaHeight || 0).toString();
            }
            
            // Actualizar contador de jugadores restantes
            const playersRemainingElement = document.getElementById('players-remaining');
            if (playersRemainingElement) {
                const alivePlayers = Object.keys(this.players || {}).filter(id => 
                    this.players[id] && !this.players[id].isSpectator
                ).length;
                playersRemainingElement.textContent = alivePlayers.toString();
            }
            
            // Actualizar vidas restantes y corazones
            const livesRemainingElement = document.getElementById('lives-remaining');
            if (livesRemainingElement) {
                livesRemainingElement.textContent = (this.lives || 0).toString();
                this.updateLifeHearts();
            }
            
            // Actualizar velocidad de la lava
            const lavaSpeedElement = document.getElementById('lava-speed');
            if (lavaSpeedElement) {
                lavaSpeedElement.textContent = ((this.lavaSpeed || 0) * 100).toFixed(0);
            }
            
            // Actualizar tiempo de juego
            const gameTimeElement = document.getElementById('game-time');
            if (gameTimeElement) {
                this.gameTime = Math.floor((Date.now() - this.gameStartTime) / 1000);
                const minutes = Math.floor(this.gameTime / 60);
                const seconds = this.gameTime % 60;
                gameTimeElement.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            }
            
            // Actualizar UI de espectador si es necesario
            if (this.isSpectator) {
                this.updateSpectatorUI();
            }
        } catch (error) {
            console.error('Error actualizando UI:', error);
        }
    }
    
    // Actualizar visualización de corazones según vidas restantes
    updateLifeHearts() {
        const heartsContainer = document.querySelector('.lives-icons');
        if (!heartsContainer) return;
        
        // Limpiar corazones existentes
        heartsContainer.innerHTML = '';
        
        // Añadir corazones según vidas restantes
        for (let i = 0; i < this.lives; i++) {
            const heart = document.createElement('span');
            heart.className = 'life-heart';
            heart.textContent = '❤️';
            heartsContainer.appendChild(heart);
        }
        
        // Añadir corazones vacíos para las vidas perdidas
        for (let i = this.lives; i < 3; i++) {
            const heart = document.createElement('span');
            heart.className = 'life-heart empty';
            heart.textContent = '💔';
            heartsContainer.appendChild(heart);
        }
    }
    
    // Método para añadir un jugador al juego
    addPlayer(playerId, playerData) {
        // Crear modelo de jugador
        const playerMesh = this.createPlayerMesh(playerData.color);
        playerMesh.position.copy(playerData.position);
        this.scene.add(playerMesh);
        
        // Crear nametag para el jugador
        const nametag = this.createNameTag(playerData.name, playerData.color);
        this.scene.add(nametag);
        
        // Guardar referencia al jugador
        this.players[playerId] = {
            mesh: playerMesh,
            nametag: nametag,
            data: playerData,
            lastPosition: new THREE.Vector3().copy(playerData.position),
            respawning: false
        };
    }
    
    // Crear etiqueta de nombre para un jugador
    createNameTag(playerName, playerColor) {
        // Crear un canvas para generar la textura del texto
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.width = 256;
        canvas.height = 64;
        
        // Fondo transparente con borde
        context.fillStyle = 'rgba(0, 0, 0, 0.5)';
        
        // Dibujar rectángulo redondeado (compatible con la mayoría de navegadores)
        const radius = 16;
        context.beginPath();
        context.moveTo(radius, 0);
        context.lineTo(canvas.width - radius, 0);
        context.quadraticCurveTo(canvas.width, 0, canvas.width, radius);
        context.lineTo(canvas.width, canvas.height - radius);
        context.quadraticCurveTo(canvas.width, canvas.height, canvas.width - radius, canvas.height);
        context.lineTo(radius, canvas.height);
        context.quadraticCurveTo(0, canvas.height, 0, canvas.height - radius);
        context.lineTo(0, radius);
        context.quadraticCurveTo(0, 0, radius, 0);
        context.closePath();
        context.fill();
        
        // Dibujar texto del nombre
        context.font = 'bold 30px Fredoka, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        
        // Sombra del texto
        context.fillStyle = 'rgba(0, 0, 0, 0.8)';
        context.fillText(playerName, canvas.width / 2 + 2, canvas.height / 2 + 2);
        
        // Texto principal
        context.fillStyle = playerColor || '#FFFFFF';
        context.fillText(playerName, canvas.width / 2, canvas.height / 2);
        
        // Crear textura desde el canvas
        const texture = new THREE.CanvasTexture(canvas);
        texture.needsUpdate = true;
        
        // Crear material con esa textura
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true
        });
        
        // Crear sprite con el material
        const sprite = new THREE.Sprite(material);
        sprite.scale.set(2, 0.5, 1);
        sprite.position.y = 0.8; // Posición más cercana al modelo (antes era 1.5)
        
        return sprite;
    }
    
    // Remover un jugador
    removePlayer(playerId) {
        if (this.players[playerId]) {
            this.scene.remove(this.players[playerId].mesh);
            this.scene.remove(this.players[playerId].nametag);
            delete this.players[playerId];
        }
    }
    
    // Comprobar colisiones con plataformas
    checkPlatformCollisions(playerId) {
        if (!this.playerMeshes[playerId] || !this.platformMeshes || this.platformMeshes.length === 0) return;
        
        const playerMesh = this.playerMeshes[playerId];
        const velocity = this.playerVelocity[playerId];
        const playerRadius = 0.3; // Reducido de 0.5 a 0.3 para una hitbox más precisa
        
        // Corregir valores NaN
        if (isNaN(playerMesh.position.x)) playerMesh.position.x = 0;
        if (isNaN(playerMesh.position.y)) playerMesh.position.y = 15;
        if (isNaN(playerMesh.position.z)) playerMesh.position.z = 0;
        
        let isGrounded = false;
        
        // Primero manejar colisiones verticales (Y)
        isGrounded = this.handleVerticalCollisions(playerMesh, velocity, playerRadius);
        
        // Luego manejar colisiones horizontales (X y Z)
        this.handleHorizontalCollisions(playerMesh, velocity, playerRadius);
        
        // Actualizar estado en suelo
        this.playerOnGround[playerId] = isGrounded;
    }
    
    // Manejar colisiones verticales
    handleVerticalCollisions(playerMesh, velocity, playerRadius) {
        let isGrounded = false;
        const groundCheckOffset = 0.1; // Pequeño offset para detección de suelo
        
        for (const platform of this.platformMeshes) {
            if (platform.position.y < this.lavaHeight) continue;
            
            const bounds = this.getPlatformBounds(platform);
            
            // Verificar si el jugador está dentro del área XZ de la plataforma
            if (this.isWithinPlatformXZ(playerMesh.position, playerRadius, bounds)) {
                const playerBottom = playerMesh.position.y - playerRadius;
                const playerTop = playerMesh.position.y + playerRadius;
                
                // Colisión con la parte superior de la plataforma
                if (velocity.y <= 0 && 
                    playerBottom <= bounds.top + groundCheckOffset && 
                    playerBottom >= bounds.top - groundCheckOffset) {
                    playerMesh.position.y = bounds.top + playerRadius;
                    velocity.y = 0;
                    isGrounded = true;
                    break; // Salir del bucle una vez que encontramos una plataforma válida
                }
                
                // Colisión con la parte inferior de la plataforma
                if (velocity.y > 0 && 
                    playerTop >= bounds.bottom - groundCheckOffset && 
                    playerTop <= bounds.bottom + groundCheckOffset) {
                    playerMesh.position.y = bounds.bottom - playerRadius;
                    velocity.y = 0;
                }
            }
        }
        
        return isGrounded;
    }
    
    // Manejar colisiones horizontales
    handleHorizontalCollisions(playerMesh, velocity, playerRadius) {
        for (const platform of this.platformMeshes) {
            if (platform.position.y < this.lavaHeight) continue;
            
            const bounds = this.getPlatformBounds(platform);
            
            // Solo procesar colisiones horizontales si el jugador está a la altura de la plataforma
            const playerBottom = playerMesh.position.y - playerRadius;
            const playerTop = playerMesh.position.y + playerRadius;
            
            if (playerBottom < bounds.top && playerTop > bounds.bottom) {
                // Colisión en X
                if (Math.abs(playerMesh.position.x - platform.position.x) < bounds.halfWidth + playerRadius) {
                    if (playerMesh.position.z > bounds.back && playerMesh.position.z < bounds.front) {
                        // Determinar de qué lado está el jugador
                        if (velocity.x > 0 && playerMesh.position.x < platform.position.x) {
                            playerMesh.position.x = bounds.left - playerRadius;
                            velocity.x = 0;
                        } else if (velocity.x < 0 && playerMesh.position.x > platform.position.x) {
                            playerMesh.position.x = bounds.right + playerRadius;
                            velocity.x = 0;
                        }
                    }
                }
                
                // Colisión en Z
                if (Math.abs(playerMesh.position.z - platform.position.z) < bounds.halfDepth + playerRadius) {
                    if (playerMesh.position.x > bounds.left && playerMesh.position.x < bounds.right) {
                        // Determinar de qué lado está el jugador
                        if (velocity.z > 0 && playerMesh.position.z < platform.position.z) {
                            playerMesh.position.z = bounds.back - playerRadius;
                            velocity.z = 0;
                        } else if (velocity.z < 0 && playerMesh.position.z > platform.position.z) {
                            playerMesh.position.z = bounds.front + playerRadius;
                            velocity.z = 0;
                        }
                    }
                }
            }
        }
    }
    
    // Obtener límites de la plataforma
    getPlatformBounds(platform) {
        const width = platform.userData.width || 5;
        const height = platform.userData.height || 1;
        const depth = platform.userData.depth || 5;
        
        return {
            left: platform.position.x - width/2,
            right: platform.position.x + width/2,
            top: platform.position.y + height/2,
            bottom: platform.position.y - height/2,
            front: platform.position.z + depth/2,
            back: platform.position.z - depth/2,
            halfWidth: width/2,
            halfDepth: depth/2
        };
    }
    
    // Verificar si un punto está dentro del área XZ de una plataforma
    isWithinPlatformXZ(position, radius, bounds) {
        return position.x + radius > bounds.left &&
               position.x - radius < bounds.right &&
               position.z + radius > bounds.back &&
               position.z - radius < bounds.front;
    }
    
    // Actualizar el estado del juego (bucle principal)
    update(delta) {
        // Actualizar controles de cámara
        this.updateCameraControls(delta);
        
        // Animar lava
        this.updateLavaAnimation(delta);
        
        // Actualizar plataformas
        this.updatePlatforms(delta);
        
        // Actualizar partículas
        if (this.particleSystem) {
            this.particleSystem.update(delta);
        }
        
        // Si ya no estamos corriendo, no procesar más
        if (!this.isRunning) return;
        
        // Actualizar posiciones de todos los jugadores
        Object.keys(this.playerMeshes).forEach(playerId => {
            const playerMesh = this.playerMeshes[playerId];
            
            if (playerMesh) {
                // Para jugadores remotos, la posición se actualiza desde el servidor
                // Para el jugador local, actualizamos su física aquí
                if (playerId === this.playerId && !this.isSpectator) {
                    this.updatePlayerPhysics(playerId, delta);
                }
                
                // Actualizar su nametag (para todos los jugadores)
                this.updateNametagPosition(playerId);
                
                // Verificar si cayó en la lava
                if (playerMesh.position.y < this.lavaHeight + 0.5) {
                    // Solo gestionar el jugador local (los demás se controlan desde el servidor)
                    if (playerId === this.playerId && !this.isSpectator) {
                        // Notificar al servidor que el jugador cayó en la lava
                        this.playerFellInLava();
                    }
                }
            }
        });
        
        // Verificar colisiones entre jugadores
        this.checkPlayerCollisions();
        
        // Actualizar altura máxima y puntuación
        if (this.playerMeshes[this.playerId] && !this.isSpectator) {
            const currentHeight = this.playerMeshes[this.playerId].position.y;
            if (currentHeight > this.maxHeight) {
                this.maxHeight = currentHeight;
            }
        }
        
        // Actualizar interfaz
        this.updateUI();
        
        // Actualizar estadísticas si están activas
        if (this.stats) {
            this.stats.update();
        }
        
        // Actualizar cooldown de la ráfaga de aire
        if (this.airBlastCooldown > 0) {
            this.airBlastCooldown -= delta;
            if (this.airBlastCooldown <= 0) {
                this.airBlastCooldown = 0;
                this.canUseAirBlast = true;
            }
        }
    }

    // Método para actualizar la animación de la lava
    updateLavaAnimation(delta) {
        if (!this.lavaMesh) return;
        
        // Actualizar posición de la lava
        this.lavaHeight += this.lavaSpeed * delta;
        this.lavaMesh.position.y = this.lavaHeight;
        
        // Actualizar luz de la lava
        if (this.lavaLight) {
            this.lavaLight.position.y = this.lavaHeight + 5;
            
            // Hacer que la intensidad de la luz fluctúe
            const time = Date.now() * 0.001;
            this.lavaLight.intensity = 2 + Math.sin(time * 2) * 0.5;
        }
        
        // Animar textura de la lava
        if (this.lavaMesh.material.map) {
            const time = Date.now() * 0.001;
            this.lavaMesh.material.map.offset.x = Math.sin(time * 0.1) * 0.1;
            this.lavaMesh.material.map.offset.y = Math.cos(time * 0.1) * 0.1;
            
            // Animar el desplazamiento
            if (this.lavaMesh.material.displacementMap) {
                this.lavaMesh.material.displacementMap.offset.x = Math.sin(time * 0.2) * 0.1;
                this.lavaMesh.material.displacementMap.offset.y = Math.cos(time * 0.2) * 0.1;
                this.lavaMesh.material.displacementScale = 0.5 + Math.sin(time) * 0.2;
            }
            
            // Animar intensidad del brillo
            this.lavaMesh.material.emissiveIntensity = 0.8 + Math.sin(time * 3) * 0.2;
        }
        
        // Actualizar partículas
        if (this.lavaParticles) {
            const positions = this.lavaParticles.geometry.attributes.position.array;
            for (let i = 0; i < positions.length; i += 3) {
                // Mover partículas hacia arriba y reiniciarlas cuando llegan muy alto
                positions[i + 1] += delta * 2;
                if (positions[i + 1] > this.lavaHeight + 5) {
                    positions[i] = Math.random() * 200 - 100;     // x
                    positions[i + 1] = this.lavaHeight;           // y
                    positions[i + 2] = Math.random() * 200 - 100; // z
                }
            }
            this.lavaParticles.geometry.attributes.position.needsUpdate = true;
        }
    }

    // Método para actualizar las plataformas
    updatePlatforms(delta) {
        // Verificar plataformas que están bajo la lava
        this.checkPlatformsInLava();
    }

    // Actualizar controles de cámara
    updateCameraControls(delta) {
        if (!this.camera) return;
        
        if (this.isSpectator) {
            this.updateSpectatorControls();
            return;
        }
        
        const playerMesh = this.playerMeshes[this.playerId];
        if (!playerMesh) return;
        
        // Calcular posición objetivo de la cámara basada en el ángulo y zoom
        const targetX = playerMesh.position.x + Math.sin(this.cameraAngle) * this.zoomLevel;
        const targetY = playerMesh.position.y + this.cameraOffset.y;
        const targetZ = playerMesh.position.z + Math.cos(this.cameraAngle) * this.zoomLevel;
        
        // Aplicar suavizado al movimiento de la cámara
        const smoothFactor = 0.1;
        this.camera.position.x += (targetX - this.camera.position.x) * smoothFactor;
        this.camera.position.y += (targetY - this.camera.position.y) * smoothFactor;
        this.camera.position.z += (targetZ - this.camera.position.z) * smoothFactor;
        
        // La cámara siempre mira al jugador
        this.camera.lookAt(
            playerMesh.position.x,
            playerMesh.position.y + 1, // Mirar un poco más arriba del centro del jugador
            playerMesh.position.z
        );
    }

    // Actualizar la física del jugador
    updatePlayerPhysics(playerId, delta) {
        if (!this.playerMeshes[playerId]) return;
        
        const playerMesh = this.playerMeshes[playerId];
        let velocity = this.playerVelocity[playerId];
        const isGrounded = this.playerOnGround[playerId];
        
        // Validar velocidad
        if (!velocity || typeof velocity !== 'object') {
            velocity = { x: 0, y: 0, z: 0 };
            this.playerVelocity[playerId] = velocity;
        }
        
        // Corregir valores NaN
        if (isNaN(velocity.x)) velocity.x = 0;
        if (isNaN(velocity.y)) velocity.y = 0;
        if (isNaN(velocity.z)) velocity.z = 0;
        
        // Verificar y registrar velocidad alta (para depurar ráfaga de aire)
        if (Math.abs(velocity.x) > 5 || Math.abs(velocity.z) > 5 || Math.abs(velocity.y) > 5) {
            console.log(`Velocidad alta detectada para ${playerId}:`, 
                JSON.stringify(velocity), 
                "Position:", 
                JSON.stringify({x: playerMesh.position.x, y: playerMesh.position.y, z: playerMesh.position.z})
            );
        }
        
        // Obtener dirección de movimiento basada en la cámara
        const moveDirection = new THREE.Vector3();
        
        // Dirección frontal (donde mira la cámara en el plano XZ)
        const cameraDirection = new THREE.Vector3();
        this.camera.getWorldDirection(cameraDirection);
        cameraDirection.y = 0;
        cameraDirection.normalize();
        
        // Dirección derecha (perpendicular a la dirección de la cámara)
        const cameraRight = new THREE.Vector3(-cameraDirection.z, 0, cameraDirection.x);
        
        // Aplicar movimiento basado en las teclas
        if (this.keys['w'] || this.keys['ArrowUp']) {
            moveDirection.add(cameraDirection);
        }
        if (this.keys['s'] || this.keys['ArrowDown']) {
            moveDirection.sub(cameraDirection);
        }
        if (this.keys['a'] || this.keys['ArrowLeft']) {
            moveDirection.sub(cameraRight);
        }
        if (this.keys['d'] || this.keys['ArrowRight']) {
            moveDirection.add(cameraRight);
        }
        
        // Normalizar el vector de movimiento si existe
        if (moveDirection.lengthSq() > 0) {
            moveDirection.normalize();
            
            // Velocidad base aumentada
            const speed = isGrounded ? 12.0 : 8.0;
            
            // Aplicar movimiento
            velocity.x = moveDirection.x * speed;
            velocity.z = moveDirection.z * speed;
            
            // Rotar el modelo en la dirección del movimiento
            const targetRotation = Math.atan2(moveDirection.x, moveDirection.z);
            playerMesh.rotation.y = targetRotation;
        } else {
            // Frenar gradualmente si no hay input
            const damping = isGrounded ? 0.9 : 0.95;
            velocity.x *= damping;
            velocity.z *= damping;
        }
        
        // Salto mejorado
        if ((this.keys[' '] || this.keys['Space'])) {
            if (isGrounded) {
                velocity.y = 15.0;
                this.playerOnGround[playerId] = false;
                
                // Dar un pequeño impulso adicional en la dirección del movimiento
                if (moveDirection.lengthSq() > 0) {
                    velocity.x *= 1.2;
                    velocity.z *= 1.2;
                }
            }
        }
        
        // Aplicar gravedad más suave
        if (!isGrounded) {
            velocity.y += -15 * delta;
            velocity.y = Math.max(velocity.y, -20); // Limitar velocidad de caída
        }
        
        // Actualizar posición con delta time
        playerMesh.position.x += velocity.x * delta;
        playerMesh.position.y += velocity.y * delta;
        playerMesh.position.z += velocity.z * delta;
        
        // Comprobar colisiones
        this.checkPlatformCollisions(playerId);
        
        // Comprobar caída en lava
        if (playerMesh.position.y < this.lavaHeight + 0.5) {
            if (playerId === this.playerId) {
                this.playerFellInLava();
            }
        }
        
        // Actualizar posición en el servidor
        if (playerId === this.playerId && !this.isSpectator) {
            this.socket.emit('updatePosition', {
                x: playerMesh.position.x,
                y: playerMesh.position.y,
                z: playerMesh.position.z
            });
        }
        
        // Actualizar cooldown de la ráfaga de aire
        if (!this.canUseAirBlast && this.airBlastCooldown > 0) {
            this.airBlastCooldown -= delta;
            if (this.airBlastCooldown <= 0) {
                this.canUseAirBlast = true;
            }
        }
        
        // Actualizar posición del nametag
        this.updateNametagPosition(playerId);
    }

    // Comprobar colisiones entre jugadores
    checkPlayerCollisions() {
        const playerIds = Object.keys(this.players);
        const PLAYER_RADIUS = 0.4; // Radio aproximado del jugador
        
        // Comprobar cada par de jugadores
        for (let i = 0; i < playerIds.length; i++) {
            const playerId1 = playerIds[i];
            const player1 = this.players[playerId1];
            const mesh1 = this.playerMeshes[playerId1];
            
            if (!player1 || !mesh1) continue;
            
            for (let j = i + 1; j < playerIds.length; j++) {
                const playerId2 = playerIds[j];
                const player2 = this.players[playerId2];
                const mesh2 = this.playerMeshes[playerId2];
                
                if (!player2 || !mesh2) continue;
                
                // Calcular distancia en el plano horizontal (X,Z)
                const dx = mesh1.position.x - mesh2.position.x;
                const dz = mesh1.position.z - mesh2.position.z;
                const horizontalDistance = Math.sqrt(dx * dx + dz * dz);
                
                // Calcular distancia vertical (Y)
                const dy = Math.abs(mesh1.position.y - mesh2.position.y);
                
                // Si están demasiado cerca en horizontal y a una altura similar
                if (horizontalDistance < PLAYER_RADIUS * 2 && dy < 1) {
                    // Calcular vector de separación
                    const pushX = dx / horizontalDistance;
                    const pushZ = dz / horizontalDistance;
                    
                    // Aplicar fuerza de separación
                    const pushFactor = (PLAYER_RADIUS * 2 - horizontalDistance) / 2;
                    
                    // Aplicar al jugador local
                    if (playerId1 === this.playerId) {
                        player1.position.x += pushX * pushFactor;
                        player1.position.z += pushZ * pushFactor;
                        mesh1.position.x += pushX * pushFactor;
                        mesh1.position.z += pushZ * pushFactor;
                    }
                    
                    // Aplicar al otro jugador si es local
                    if (playerId2 === this.playerId) {
                        player2.position.x -= pushX * pushFactor;
                        player2.position.z -= pushZ * pushFactor;
                        mesh2.position.x -= pushX * pushFactor;
                        mesh2.position.z -= pushZ * pushFactor;
                    }
                    
                    // Actualizar nametags después de mover jugadores
                    this.updateNametagPosition(playerId1);
                    this.updateNametagPosition(playerId2);
                    
                    // Enviar posición actualizada al servidor si es el jugador local
                    if (playerId1 === this.playerId) {
                        this.socket.emit('updatePosition', player1.position);
                    } else if (playerId2 === this.playerId) {
                        this.socket.emit('updatePosition', player2.position);
                    }
                }
            }
        }
    }

    // Actualizar los controles en modo espectador
    updateSpectatorControls() {
        // Cambiar a jugador anterior
        if (this.keys['q'] && !this.keysPrevState['q']) {
            this.switchToPreviousPlayer();
        }
        
        // Cambiar a jugador siguiente
        if (this.keys['e'] && !this.keysPrevState['e']) {
            this.switchToNextPlayer();
        }
        
        // Salir de la sala
        if (this.keys['escape'] && !this.keysPrevState['escape']) {
            this.leaveRoom();
        }
        
        // Actualizar estado anterior de teclas
        this.keysPrevState = {...this.keys};
    }

    // Cambiar a jugador anterior
    switchToPreviousPlayer() {
        if (!this.isSpectator || this.alivePlayers.length === 0) return;
        
        this.currentSpectatorIndex = (this.currentSpectatorIndex - 1 + this.alivePlayers.length) % this.alivePlayers.length;
        this.switchToPlayer(this.alivePlayers[this.currentSpectatorIndex]);
    }

    // Cambiar a jugador siguiente
    switchToNextPlayer() {
        if (!this.isSpectator || this.alivePlayers.length === 0) return;
        
        this.currentSpectatorIndex = (this.currentSpectatorIndex + 1) % this.alivePlayers.length;
        this.switchToPlayer(this.alivePlayers[this.currentSpectatorIndex]);
    }

    // Cambiar a un jugador específico
    switchToPlayer(targetId) {
        if (!this.isSpectator || !this.players[targetId]) return;
        
        this.spectatingPlayerId = targetId;
        this.socket.emit('spectatorSwitchView', { targetId });
        
        // Actualizar UI
        this.updateSpectatorUI();
    }

    // Salir de la sala
    leaveRoom() {
        // Detener el juego primero
        this.stop();
        
        // Notificar al servidor
        this.socket.emit('leaveRoom');
        
        // Ocultar todas las pantallas
        const screens = ['game-container', 'game-ui', 'lobby-screen', 'spectator-overlay'];
        screens.forEach(screenId => {
            const screen = document.getElementById(screenId);
            if (screen) {
                screen.style.display = 'none';
                screen.style.opacity = '0';
                screen.style.visibility = 'hidden';
            }
        });
        
        // Mostrar el menú principal
        const menuScreen = document.getElementById('menu-screen');
        if (menuScreen) {
            menuScreen.style.display = 'block';
            menuScreen.style.opacity = '1';
            menuScreen.style.visibility = 'visible';
            menuScreen.style.zIndex = '1000';
            menuScreen.style.position = 'fixed';
            menuScreen.style.top = '0';
            menuScreen.style.left = '0';
            menuScreen.style.width = '100%';
            menuScreen.style.height = '100%';
            menuScreen.style.backgroundColor = '#ffffff';
        }
        
        // Limpiar el hash de la URL
        window.location.hash = '#menu';
        
        // Forzar un reflow del DOM para asegurar que los cambios se aplican
        document.body.offsetHeight;
        
        // Restablecer el fondo
        document.body.style.backgroundColor = '#ffffff';
        
        // Limpiar cualquier overlay residual
        const overlays = document.querySelectorAll('.message-overlay, .spectator-overlay');
        overlays.forEach(overlay => {
            if (overlay && overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        });
    }

    // Actualizar UI del modo espectador
    updateSpectatorUI() {
        const spectatorOverlay = document.getElementById('spectator-overlay');
        
        if (this.isSpectator) {
            // Crear o actualizar overlay de espectador
            if (!spectatorOverlay) {
                const overlay = document.createElement('div');
                overlay.id = 'spectator-overlay';
                overlay.className = 'spectator-overlay';
                
                const controls = document.createElement('div');
                controls.className = 'spectator-controls';
                controls.innerHTML = `
                    <h2>Modo Espectador</h2>
                    <p>¡Has perdido todas tus vidas!</p>
                    <p>Usa Q y E para cambiar entre jugadores</p>
                    <p>Presiona ESC para abandonar la sala</p>
                    <div class="spectating-info">Observando a: <span id="spectating-name">Nadie</span></div>
                `;
                
                const leaveButton = document.createElement('button');
                leaveButton.className = 'leave-button';
                leaveButton.textContent = 'Abandonar Sala';
                leaveButton.onclick = () => this.leaveRoom();
                
                overlay.appendChild(controls);
                overlay.appendChild(leaveButton);
                
                document.body.appendChild(overlay);
            }
            
            // Actualizar nombre del jugador observado
            const spectatingNameEl = document.getElementById('spectating-name');
            if (spectatingNameEl && this.spectatingPlayerId && this.players[this.spectatingPlayerId]) {
                spectatingNameEl.textContent = this.players[this.spectatingPlayerId].name || 'Desconocido';
            }
        } else if (spectatorOverlay) {
            // Eliminar overlay si no somos espectador
            document.body.removeChild(spectatorOverlay);
        }
    }

    // Entrar en modo espectador cuando el jugador pierde todas sus vidas
    enterSpectatorMode() {
        if (this.isSpectator) return; // Evitar activar el modo espectador dos veces
        
        console.log("Entrando en modo espectador");
        
        this.isSpectator = true;
        this.lives = 0;
        
        // Limpiar velocidades y estados del jugador
        if (this.playerVelocity[this.playerId]) {
            this.playerVelocity[this.playerId] = { x: 0, y: 0, z: 0 };
        }
        this.playerOnGround[this.playerId] = false;
        
        // Notificar al servidor
        this.socket.emit('enterSpectatorMode');
        
        // Solicitar lista de jugadores vivos
        this.socket.emit('getAlivePlayers', (alivePlayers) => {
            this.alivePlayers = alivePlayers || [];
            
            // Seleccionar primer jugador para observar si hay alguno disponible
            if (this.alivePlayers.length > 0) {
                this.currentSpectatorIndex = 0;
                this.switchToPlayer(this.alivePlayers[0]);
            }
        });
        
        // Mostrar mensaje e interfaz de espectador
        this.showSpectatorMessage();
        this.updateSpectatorUI();
        
        // Actualizar UI general
        this.updateUI();
    }

    // Manejador de caída en la lava
    playerFellInLava() {
        if (this.isSpectator) return; // Los espectadores no mueren
        
        try {
            this.lives--;
            
            // Actualizar UI de vidas
            const livesElement = document.getElementById('lives-remaining');
            if (livesElement) {
                livesElement.textContent = this.lives.toString();
            }
            
            // Notificar al servidor
            this.socket.emit('playerDied');
            
            if (this.lives <= 0) {
                // Entrar en modo espectador
                this.enterSpectatorMode();
            } else {
                // Encontrar la plataforma más alta para respawn
                let highestPlatform = null;
                let maxHeight = -Infinity;
                
                for (const platform of this.platformMeshes) {
                    if (platform.position.y > maxHeight && platform.position.y > this.lavaHeight) {
                        maxHeight = platform.position.y;
                        highestPlatform = platform;
                    }
                }
                
                // Si no hay plataforma segura, usar la posición inicial
                const respawnPosition = highestPlatform ? {
                    x: highestPlatform.position.x,
                    y: highestPlatform.position.y + 2,
                    z: highestPlatform.position.z
                } : {
                    x: 0,
                    y: 15,
                    z: 0
                };
                
                // Respawnear jugador
                this.resetPlayer(this.playerId, respawnPosition, this.lives);
                
                // Efecto visual de pérdida de vida
                const gameElement = document.getElementById('game');
                if (gameElement) {
                    gameElement.classList.add('damage-effect');
                    setTimeout(() => {
                        gameElement.classList.remove('damage-effect');
                    }, 500);
                }
                
                // Mostrar mensaje de vida perdida
                this.showLostLifeMessage(this.lives);
            }
        } catch (error) {
            console.error('Error en playerFellInLava:', error);
        }
    }

    // Bucle principal del juego
    gameLoop() {
        if (!this.isRunning) return;
        
        this.frameCount++;
        
        // Calcular delta time para animaciones suaves
        const delta = this.clock.getDelta();
        
        // Actualizar lógica del juego
        this.update(delta);
        
        // Renderizar escena
        if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
        }
        
        // Programar siguiente frame
        this.gameLoopId = requestAnimationFrame(this.gameLoop.bind(this));
    }

    // Resaltar visualmente la plataforma base para depuración
    highlightBasePlatform(platformMesh) {
        // Función vacía - eliminamos la visualización del wireframe de depuración
        console.log("Plataforma base creada correctamente");
    }

    // Mostrar mensaje de activación del modo espectador
    showSpectatorMessage() {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message-overlay', 'spectator-message');
        messageDiv.textContent = '¡Modo Espectador Activado!';
        document.body.appendChild(messageDiv);
        
        // Eliminar mensaje después de 3 segundos
        setTimeout(() => {
            if (messageDiv.parentNode) {
                document.body.removeChild(messageDiv);
            }
        }, 3000);
    }

    // Usar ráfaga de aire
    useAirBlast() {
        if (!this.canUseAirBlast || this.isSpectator) return;
        
        // Obtener la dirección en la que mira el jugador
        const playerMesh = this.playerMeshes[this.playerId];
        if (!playerMesh) return;
        
        // Obtener posición y dirección
        const position = playerMesh.position.clone();
        const direction = new THREE.Vector3(0, 0, 1);
        direction.applyQuaternion(playerMesh.quaternion);
        direction.y = 0; // Mantener la ráfaga horizontal
        direction.normalize();
        
        // Crear efecto visual localmente
        this.createAirBlastEffect(position, direction);
        
        // Enviar evento al servidor
        this.socket.emit('useAirBlast', {
            position: {
                x: position.x,
                y: position.y,
                z: position.z
            },
            direction: {
                x: direction.x,
                y: direction.y,
                z: direction.z
            }
        });
        
        // Activar cooldown
        this.canUseAirBlast = false;
        this.airBlastCooldown = this.airBlastCooldownTime;
        this.lastAirBlastTime = Date.now();
        
        // Actualizar UI de cooldown
        this.updateAirBlastCooldownUI();
        
        // Iniciar temporizador de cooldown
        setTimeout(() => {
            this.canUseAirBlast = true;
            // Actualizar UI cuando se completa el cooldown
            const cooldownBar = document.getElementById('cooldown-bar');
            if (cooldownBar) {
                cooldownBar.style.width = '0%';
            }
        }, this.airBlastCooldownTime * 1000);
    }
    
    // Aplicar empuje recibido del servidor
    applyServerPush(pushVector) {
        if (!this.playerVelocity[this.playerId] || !this.playerMeshes[this.playerId]) return;
        
        // Convertir a números si son strings
        const force = {
            x: Number(pushVector.x),
            y: Number(pushVector.y),
            z: Number(pushVector.z)
        };
        
        // Aplicar la fuerza a la velocidad del jugador
        // Con un factor de control para hacer el efecto más consistente
        const velocityFactor = 0.8; // Reducir ligeramente el impacto total
        this.playerVelocity[this.playerId].x = force.x * velocityFactor;
        this.playerVelocity[this.playerId].y = force.y * velocityFactor;
        this.playerVelocity[this.playerId].z = force.z * velocityFactor;
        
        // No aplicar impulso inmediato a la posición para evitar desincronización
        // Solo actualizar la velocidad y dejar que la física se encargue
        
        // Actualizar el nametag
        this.updateNametagPosition(this.playerId);
        
        console.log("Velocidad aplicada:", this.playerVelocity[this.playerId]);
    }
    
    // Actualizar la UI del cooldown de la ráfaga de aire
    updateAirBlastCooldownUI() {
        // Verificar si la UI de cooldown existe
        let cooldownContainer = document.getElementById('cooldown-container');
        
        // Si no existe, crearla
        if (!cooldownContainer) {
            cooldownContainer = document.createElement('div');
            cooldownContainer.id = 'cooldown-container';
            cooldownContainer.style.position = 'fixed';
            cooldownContainer.style.bottom = '20px';
            cooldownContainer.style.left = '50%';
            cooldownContainer.style.transform = 'translateX(-50%)';
            cooldownContainer.style.width = '200px';
            cooldownContainer.style.height = '15px';
            cooldownContainer.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
            cooldownContainer.style.borderRadius = '10px';
            cooldownContainer.style.overflow = 'hidden';
            cooldownContainer.style.zIndex = '1001';
            
            const cooldownBar = document.createElement('div');
            cooldownBar.id = 'cooldown-bar';
            cooldownBar.style.height = '100%';
            cooldownBar.style.width = '100%';
            cooldownBar.style.backgroundColor = '#40e0ff';
            cooldownBar.style.transition = 'width 0.1s linear';
            
            cooldownContainer.appendChild(cooldownBar);
            document.body.appendChild(cooldownContainer);
        }
        
        // Mostrar la barra llena
        const cooldownBar = document.getElementById('cooldown-bar');
        if (cooldownBar) {
            cooldownBar.style.width = '100%';
        }
        
        // Animar la barra gradualmente
        const updateBar = () => {
            if (!this.isRunning) return; // No actualizar si el juego no está corriendo
            
            const elapsed = (Date.now() - this.lastAirBlastTime) / 1000;
            const remaining = Math.max(0, this.airBlastCooldownTime - elapsed);
            const percent = (remaining / this.airBlastCooldownTime) * 100;
            
            if (cooldownBar) {
                cooldownBar.style.width = `${percent}%`;
            }
            
            if (percent > 0 && this.isRunning) {
                requestAnimationFrame(updateBar);
            }
        };
        
        updateBar();
    }

    // Crear efecto visual de la ráfaga de aire
    createAirBlastEffect(position, direction) {
        // Crear una textura cuadrada para las partículas
        const texture = this.createSquareTexture();
        
        // Número de partículas
        const particleCount = 120;
        
        // Crear geometría para las partículas
        const particlesGeometry = new THREE.BufferGeometry();
        const positions = new Float32Array(particleCount * 3);
        const sizes = new Float32Array(particleCount);
        const colors = new Float32Array(particleCount * 3);
        
        // Color base - Cyan claro
        const baseColor = new THREE.Color(0x40e0ff);
        
        // Generar posiciones iniciales de las partículas
        for (let i = 0; i < particleCount; i++) {
            // Posición inicial (ligeramente dispersa alrededor del punto de origen)
            const offset = 0.1; // Menor dispersión inicial para un inicio más concentrado
            positions[i * 3] = position.x + (Math.random() - 0.5) * offset;
            positions[i * 3 + 1] = position.y + (Math.random() - 0.5) * offset;
            positions[i * 3 + 2] = position.z + (Math.random() - 0.5) * offset;
            
            // Tamaño de partícula
            sizes[i] = 0.3 * (0.8 + Math.random() * 0.4); // Tamaño más consistente
            
            // Color con variación
            const colorVariation = 0.1;
            const color = baseColor.clone();
            color.r += (Math.random() - 0.5) * colorVariation;
            color.g += (Math.random() - 0.5) * colorVariation;
            color.b += (Math.random() - 0.5) * colorVariation;
            
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
        }
        
        // Configurar geometría
        particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        particlesGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
        particlesGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        
        // Material de partículas
        const particlesMaterial = new THREE.PointsMaterial({
            size: 0.3,
            map: texture,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            transparent: true,
            vertexColors: true
        });
        
        // Crear sistema de partículas
        const particles = new THREE.Points(particlesGeometry, particlesMaterial);
        this.scene.add(particles);
        
        // Datos de animación
        const animationData = {
            startTime: Date.now(),
            duration: 1.0, // Duración más corta para efecto más rápido
            direction: direction.clone(),
            speed: 0.13, // Velocidad más lenta para coincidir con el empuje más suave
            maxDistance: 10, // Mayor distancia máxima
            maxDispersion: 3, // Menor dispersión para un efecto más enfocado
            particles: particles
        };
        
        // Función de animación
        const animateBlast = () => {
            if (!this.scene) return;
            
            const now = Date.now();
            const elapsed = (now - animationData.startTime) / 1000;
            const progress = elapsed / animationData.duration;
            
            if (progress >= 1) {
                // Eliminar partículas al terminar
                this.scene.remove(particles);
                particlesGeometry.dispose();
                particlesMaterial.dispose();
                return;
            }
            
            // Actualizar posiciones
            const positions = particles.geometry.attributes.position.array;
            const sizes = particles.geometry.attributes.size.array;
            const colors = particles.geometry.attributes.color.array;
            
            for (let i = 0; i < particleCount; i++) {
                // Calcular nueva posición
                const speed = animationData.speed * (1 + Math.random() * 0.2); // Variación de velocidad
                const distance = speed * elapsed * (1 + i % 3); // Velocidad variable por partícula
                
                // Calcular ángulo de dispersión (menor para un cono más estrecho)
                const dispersionAngle = (Math.random() - 0.5) * (Math.PI / 8);
                const dispersionFactor = Math.min(1, elapsed * 0.15); // Aumento gradual de dispersión
                
                // Crear vector de dirección con dispersión
                const particleDir = animationData.direction.clone();
                
                // Aplicar rotación para dispersión
                particleDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), dispersionAngle * dispersionFactor);
                particleDir.applyAxisAngle(new THREE.Vector3(1, 0, 0), (Math.random() - 0.5) * (Math.PI / 8) * dispersionFactor);
                
                // Aplicar movimiento
                positions[i * 3] = position.x + particleDir.x * distance * (1 + Math.random() * 0.5);
                positions[i * 3 + 1] = position.y + particleDir.y * distance * (1 + Math.random() * 0.5) + Math.sin(progress * Math.PI) * 0.3; // Arco ligero
                positions[i * 3 + 2] = position.z + particleDir.z * distance * (1 + Math.random() * 0.5);
                
                // Reducir tamaño gradualmente
                const sizeProgress = Math.min(1, elapsed * 2); // Reducción más rápida
                sizes[i] *= (1 - sizeProgress * 0.01);
                
                // Reducir opacidad (mediante color)
                const opacity = 1 - progress;
                colors[i * 3 + 0] *= opacity;
                colors[i * 3 + 1] *= opacity;
                colors[i * 3 + 2] *= opacity;
            }
            
            // Actualizar geometría
            particles.geometry.attributes.position.needsUpdate = true;
            particles.geometry.attributes.size.needsUpdate = true;
            particles.geometry.attributes.color.needsUpdate = true;
            
            // Continuar animación
            requestAnimationFrame(animateBlast);
        };
        
        // Iniciar animación
        animateBlast();
        
        return particles;
    }

    // Crear textura cuadrada para las partículas
    createSquareTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        
        // Dibujar un cuadrado pixelado
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, 16, 16);
        
        // Añadir un borde suave
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.fillRect(0, 0, 16, 1);
        ctx.fillRect(0, 15, 16, 1);
        ctx.fillRect(0, 0, 1, 16);
        ctx.fillRect(15, 0, 1, 16);
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        return texture;
    }
}

// Exportar la clase Game para poder importarla en main.js
export default Game; 