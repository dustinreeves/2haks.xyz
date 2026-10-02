// Fire Raze: a small 3D game engine for 2haks.xyz games, made by Tripp.
// Portals, box physics and test-chamber worlds on top of Three.js.
export const ENGINE = { name: "Fire Raze", version: "1.0.0" };

export { AXES, box3, castRay, insideBox, overlaps, rayBox } from "./collide.js";
export { ceilingLights, setupLighting } from "./lighting.js";
export { applyGravity, GRAVITY, MAX_FALL_SPEED, moveBody } from "./physics.js";
export { PORTAL_H, PORTAL_W, PortalSystem } from "./portals.js";
export { canvasTexture, TEXTURES, tiledBox } from "./textures.js";
export { CUBE_HALF, World } from "./world.js";
