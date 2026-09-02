/**
 * Service Worker InsTRAM Conducteur — PWA.
 *
 * Stratégie : cache statique uniquement.
 *  - Assets statiques (JS, CSS, HTML) : cache-first
 *  - Appels API (/api/) : jamais mis en cache (network-only)
 *  - Pas d'offline write — uniquement read-through du cache statique
 *
 * Le SW est enregistré depuis fr/driver/layout.tsx.
 */

const CACHE_NAME = 'instram-driver-v1';

// Assets à pré-cacher lors de l'installation
const STATIC_ASSETS = [
  '/',
  '/fr/driver',
];

// ─── Installation ─────────────────────────────────────────────────────────────

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => {
        // Si le pré-cache échoue (ex: offline lors de l'install), on continue quand même
      }),
  );
  // Prendre le contrôle immédiatement sans attendre que l'ancien SW se termine
  self.skipWaiting();
});

// ─── Activation ────────────────────────────────────────────────────────────────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name)),
      ),
    ),
  );
  // Prendre le contrôle de toutes les pages ouvertes immédiatement
  self.clients.claim();
});

// ─── Interception des requêtes ─────────────────────────────────────────────────

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Ignorer les requêtes non-GET (POST, PUT, etc.)
  if (request.method !== 'GET') return;

  // Ignorer les appels API — jamais mis en cache
  if (request.url.includes('/api/')) return;

  // Ignorer les WebSocket
  if (request.url.startsWith('ws://') || request.url.startsWith('wss://')) return;

  // Ignorer les extensions de navigateur
  if (request.url.startsWith('chrome-extension://')) return;

  // Stratégie : cache-first avec fallback réseau
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      // Pas dans le cache → réseau
      return fetch(request).then((networkResponse) => {
        // Ne mettre en cache que les réponses valides (200) pour les assets statiques
        if (
          networkResponse.ok &&
          networkResponse.type === 'basic' &&
          !request.url.includes('/api/')
        ) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseClone);
          });
        }
        return networkResponse;
      });
    }),
  );
});
