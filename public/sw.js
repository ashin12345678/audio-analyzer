const CACHE_NAME = 'audio-analyzer-v1';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css',
  './js/main.js',
  './js/visualizer.js',
  './js/ui-controller.js',
  './manifest.json',
  './wasm/analyzer.js',
  './wasm/analyzer.wasm'
];

// Install
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// Activate
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
});

// Fetch
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      // Cache hit
      if (response) {
        return response;
      }
      return fetch(e.request);
    })
  );
});
