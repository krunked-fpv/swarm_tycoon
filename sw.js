const CACHE_VERSION = 'swarm-tycoon-cache-v1';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.json',
  './styles/cleanroom.css',
  './vendor/phaser.min.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './src/main.js',
  './src/sim/gridEngine.js',
  './src/sim/beltRouter.js',
  './src/sim/shuttleFleet.js',
  './src/sim/cryoLoopSolver.js',
  './src/sim/powerGridSolver.js',
  './src/sim/dailySeedGenerator.js',
  './src/render/isoScene.js',
  './src/render/proceduralTextures.js',
  './src/render/waferIridescencePipeline.js',
  './src/render/heatmapOverlayPipeline.js',
  './src/render/cleanroomVfx.js',
  './src/economy/bigSilicon.js',
  './src/economy/scaleTiers.js',
  './src/economy/prestigeProtocol.js',
  './src/economy/agentWorkers.js',
  './src/economy/chaosIncidents.js',
  './src/economy/yieldCurves.js',
  './src/persistence/blueprintCodec.js',
  './src/persistence/offlineCatchupSolver.js',
  './src/persistence/cookieVault.js',
  './src/persistence/portableSaveIo.js',
  './src/audio/audioEngine.js',
  './src/audio/cleanroomAmbience.js',
  './src/audio/machineFoley.js',
  './src/audio/klaxonSynth.js',
  './src/ui/hudController.js',
  './src/ui/buildPalette.js',
  './src/ui/prestigeModal.js',
  './src/ui/crisisTicker.js',
  './src/ui/blueprintModal.js',
  './src/ui/offlineReportModal.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          (networkResponse.type === 'basic' || networkResponse.type === 'cors')
        ) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_VERSION).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          if (event.request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return new Response('Offline', {
            status: 503,
            statusText: 'Service Unavailable',
          });
        })
      )
  );
});
