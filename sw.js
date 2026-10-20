// Service worker ของ Project Hub
// ทุกครั้งที่แก้ไฟล์เว็บแล้ว deploy ต้องเพิ่มเลข VERSION นี้ เพื่อให้เครื่องที่ติดตั้งไว้เห็น "มีเวอร์ชันใหม่"
const VERSION = 'v1';
const SHELL_CACHE = `hub-shell-${VERSION}`;
const RUNTIME_CACHE = 'hub-runtime-v1'; // ฟอนต์และไลบรารีจาก CDN (ไม่ผูกกับ VERSION)

const SHELL = [
  './', 'index.html', 'manifest.json', 'css/style.css',
  'js/app.js', 'js/config.js', 'js/db.js', 'js/detail.js', 'js/gantt.js', 'js/links.js',
  'js/ui.js', 'js/util.js', 'js/cache.js', 'js/net.js', 'js/pwa.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];
const CDN_HOSTS = ['cdn.jsdelivr.net', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  // ไม่ skipWaiting เอง: รอให้ผู้ใช้กด "รีเฟรช" ในแถบเวอร์ชันใหม่
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) {
      if (k.startsWith('hub-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE) await caches.delete(k);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  const msg = e.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  if (msg.type === 'CACHE_URLS' && Array.isArray(msg.urls)) {
    // หน้าเว็บส่งรายการทรัพยากร CDN ที่โหลดไปแล้วมาให้เก็บไว้ใช้ออฟไลน์
    e.waitUntil(caches.open(RUNTIME_CACHE).then((c) => Promise.all(msg.urls
      .filter((u) => CDN_HOSTS.includes(new URL(u).hostname))
      .map(async (u) => {
        if (await c.match(u)) return;
        try {
          const r = await fetch(u, { mode: new URL(u).hostname === 'fonts.googleapis.com' ? 'no-cors' : 'cors' });
          if (r.ok || r.type === 'opaque') await c.put(u, r);
        } catch (err) { /* ข้าม */ }
      }))));
  }
});

async function cacheFirst(req, cacheName) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    const copy = res.clone();
    caches.open(cacheName).then((c) => c.put(req, copy));
  }
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Supabase (API + auth) ห้าม cache ใน SW: ปล่อยผ่านไปเครือข่ายตรงๆ
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) return;

  const sameOrigin = url.origin === self.location.origin;
  if (!sameOrigin && !CDN_HOSTS.includes(url.hostname)) return;

  if (req.mode === 'navigate') {
    // cache-first: เสิร์ฟ index.html จาก cache (ใช้ได้ทั้งออฟไลน์และ #hash ของ magic link)
    e.respondWith(caches.match(new URL('index.html', self.registration.scope).href, { ignoreSearch: true })
      .then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(cacheFirst(req, sameOrigin ? SHELL_CACHE : RUNTIME_CACHE));
});
