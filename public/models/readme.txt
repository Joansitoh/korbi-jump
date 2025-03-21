# Modelos 3D para Korbo Jump

Esta carpeta está destinada a contener modelos 3D para el juego.

## Modelo Kirby
El juego intenta cargar un modelo `kirby.glb` desde esta carpeta. Si el modelo no existe o 
no se puede cargar, el juego usará automáticamente un modelo simple creado con geometrías básicas
de Three.js.

Para añadir un modelo personalizado:
1. Crea un modelo 3D en formato GLB
2. Nombra el archivo como `kirby.glb`
3. Colócalo en esta carpeta

Las partes del modelo con material llamado 'body' serán coloreadas según el color asignado al jugador. 