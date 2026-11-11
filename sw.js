/* BOMX hizmet çalışanı (PWA): program dosyaları cihazda saklanır, bağlantı yokken de açılır.
   Önce ağ: internet varken her dosya yeni sürümüyle gelir ve saklanır; ağ yoksa ya da geç kalırsa saklanan sürüm.
   Veri (bomx-veri deposu, api.github.com) buradan geçmez: başka adresin isteğine dokunulmaz.
   Aynı adreste (thevanerr.github.io) başka programlar da durur: önbellek adı "bomx-program-" ile başlar,
   eski sürüm silinirken yalnız bu adlar silinir. */
const CACHE = 'bomx-program-v1';
const PREFIX = 'bomx-program-';
const NETWORK_WAIT = 4000;

// Açılışta gereken her dosya (test/pwa.test.js index.html ve output.js ile karşılaştırır)
const FILES = [
  './',
  'manifest.webmanifest',
  'codes/bomx.css',
  'codes/print.css',
  'ortak/bomx-db.js',
  'ortak/bomx-github.js',
  'ortak/bomx-boot.js',
  'codes/model.js',
  'codes/store.js',
  'codes/xlsx.js',
  'codes/reports.js',
  'codes/ui/util.js',
  'codes/ui/grid.js',
  'codes/ui/setup.js',
  'codes/ui/library.js',
  'codes/ui/home.js',
  'codes/ui/editor.js',
  'codes/ui/panels.js',
  'codes/ui/output.js',
  'codes/app.js',
  'codes/pdf/pdf.js',
  'codes/pdf/pdf-dom.js',
  'codes/pdf/fonts.js',
  'codes/pdf/logos.js',
  'assets/logos/dolfin.png',
  'assets/simge/simge.svg',
  'assets/simge/simge-192.png',
  'assets/simge/simge-512.png',
  'assets/simge/simge-maskeli-512.png',
  'assets/simge/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

async function fromNetwork(request, cache) {
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
  return response;
}

async function respond(event) {
  const request = event.request;
  const cache = await caches.open(CACHE);
  const network = fromNetwork(request, cache);
  // Ağ cevabı geç kalsa da gelince saklanır
  event.waitUntil(network.then(() => {}, () => {}));
  const late = new Promise((resolve) => setTimeout(resolve, NETWORK_WAIT, null));
  const fresh = await Promise.race([network.catch(() => null), late]);
  if (fresh && fresh.ok) return fresh;
  // Sayfa açılışı adresteki ek bilgiden bağımsız olarak saklanan ana sayfayla karşılanır
  const saved = request.mode === 'navigate'
    ? await cache.match('./') || await cache.match(request, { ignoreSearch: true })
    : await cache.match(request, { ignoreSearch: true });
  // Saklanan yoksa ağın cevabı (hata sayfası da) olduğu gibi verilir
  return saved || fresh || network;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(respond(event));
});
