// Portal Fan Lab service worker: keeps a copy of the game on your computer so the installed
// app opens fast and works without internet.
//
//   game files     internet first (always up to date), saved copy if offline
//   chamber files  internet first, saved copy if offline
//   runs / times   internet only (the leaderboard needs the server)
//
// Bump VERSION when the list of files below changes.
const VERSION = "portal-lab-v5";

const FILES = [
  "/",
  "/index.html",
  "/style.css",
  "/game.js",
  "/monster.js",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/fireraze/index.js",
  "/fireraze/character.js",
  "/fireraze/collide.js",
  "/fireraze/console.js",
  "/fireraze/gamepad.js",
  "/fireraze/lighting.js",
  "/fireraze/physics.js",
  "/fireraze/portals.js",
  "/fireraze/portalgun.js",
  "/fireraze/postfx.js",
  "/fireraze/textures.js",
  "/fireraze/world.js",
  "/textures/carpet016/color.jpg",
  "/textures/carpet016/normal.jpg",
  "/textures/carpet016/roughness.jpg",
  "/textures/concrete031/color.jpg",
  "/textures/concrete031/normal.jpg",
  "/textures/concrete031/roughness.jpg",
  "/textures/metalplates008/color.jpg",
  "/textures/metalplates008/metalness.jpg",
  "/textures/metalplates008/normal.jpg",
  "/textures/metalplates008/roughness.jpg",
  "/textures/officeceiling001/color.jpg",
  "/textures/officeceiling001/emission.jpg",
  "/textures/officeceiling001/normal.jpg",
  "/textures/officeceiling001/roughness.jpg",
  "/textures/officeceiling005/color.jpg",
  "/textures/officeceiling005/emission.jpg",
  "/textures/officeceiling005/normal.jpg",
  "/textures/officeceiling005/roughness.jpg",
  "/textures/paintedplaster017/color.jpg",
  "/textures/paintedplaster017/normal.jpg",
  "/textures/paintedplaster017/roughness.jpg",
  "/textures/wallpaper001a/color.jpg",
  "/textures/wallpaper001a/normal.jpg",
  "/textures/wallpaper001a/roughness.jpg",
  "/vendor/three-0.170.0.module.min.js",
  "/vendor/three-addons/postprocessing/EffectComposer.js",
  "/vendor/three-addons/postprocessing/GTAOPass.js",
  "/vendor/three-addons/shaders/GTAOShader.js",
  "/vendor/three-addons/shaders/PoissonDenoiseShader.js",
  "/vendor/three-addons/math/SimplexNoise.js",
  "/vendor/three-addons/postprocessing/MaskPass.js",
  "/vendor/three-addons/postprocessing/OutputPass.js",
  "/vendor/three-addons/postprocessing/Pass.js",
  "/vendor/three-addons/postprocessing/RenderPass.js",
  "/vendor/three-addons/postprocessing/ShaderPass.js",
  "/vendor/three-addons/postprocessing/UnrealBloomPass.js",
  "/vendor/three-addons/shaders/CopyShader.js",
  "/vendor/three-addons/shaders/LuminosityHighPassShader.js",
  "/vendor/three-addons/shaders/OutputShader.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(FILES);
    // Save every chamber too, so the game can be played offline.
    try {
      const res = await fetch("/api/levels");
      if (res.ok) {
        await cache.put("/api/levels", res.clone());
        const { levels } = await res.json();
        await Promise.all(levels.map((lv) => cache.add(`/api/levels/${encodeURIComponent(lv.id)}`)));
      }
    } catch {
      // Offline while installing: chambers get saved the next time they load.
    }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/levels")) {
    // Internet first (so new chambers show up), saved copy when offline.
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch {
        return (await cache.match(req)) || Response.error();
      }
    })());
    return;
  }
  if (url.pathname.startsWith("/api/")) return; // runs, leaderboard: always live

  // Game files: internet first, so everyone always gets matching, up-to-date files
  // (mixing old and new engine files could break the game). Saved copy when offline.
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
