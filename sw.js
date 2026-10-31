/* SENSE offline package worker (2026-10-31, ported from VideoASD's sw.js).
 *
 * Serves the study from the offline package that offline.js downloaded into Cache
 * Storage, so videos start instantly on a slow link and the whole study runs with no
 * network at all. The package is pinned: the iPad keeps using the version it has
 * until a grown-up taps "更新" (offline.js), never mid-session.
 *
 * Which cache is active lives in the 'sense-meta' cache (written by offline.js
 * only after a package is complete and verified), so a half-downloaded update is
 * never served.
 *
 * Network only: non-GET (saves, AI calls), /api/, the manifest, this file, other origins.
 * A file not in the package falls through to the network as before.
 */

const META_CACHE = 'sense-meta';
const META_KEY = 'offline-meta.json';
const scope = new URL(self.registration.scope);

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

let meta = null;   // { version, cache, ... } of the active package, or null
async function loadMeta() {
  try {
    const r = await (await caches.open(META_CACHE)).match(new URL(META_KEY, scope));
    meta = r ? await r.json() : null;
  } catch { meta = null; }
  return meta;
}
// offline.js posts this after switching packages.
self.addEventListener('message', (e) => { if (e.data === 'meta-changed') loadMeta(); });

function passThrough(url, req) {
  if (req.method !== 'GET' || url.origin !== scope.origin) return true;
  if (url.searchParams.has('__pkg')) return true;   // offline.js downloading a package file
  const p = url.pathname.slice(scope.pathname.length - 1);
  return p.startsWith('/api/') || p === '/offline-manifest.json' || p === '/sw.js';
}

// iOS Safari plays <video> only via byte ranges; answer them from the cached file.
async function rangeResponse(cached, header) {
  const blob = await cached.blob();
  const m = /bytes=(\d*)-(\d*)/.exec(header || '');
  const size = blob.size;
  let start = 0, end = size - 1;
  if (m && m[1] === '') { start = Math.max(0, size - Number(m[2] || 0)); }
  else if (m) { start = Number(m[1]); if (m[2] !== '') end = Math.min(Number(m[2]), size - 1); }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

async function respond(req, url) {
  const m = meta || await loadMeta();
  if (m && m.cache) {
    const cache = await caches.open(m.cache);
    let key = url.origin + url.pathname;              // ?v= / ?k= / ?dev= don't matter
    if (key.endsWith('/')) key += 'index.html';
    const hit = await cache.match(key);
    if (hit) {
      return req.headers.has('range') ? rangeResponse(hit, req.headers.get('range')) : hit;
    }
  }
  try {
    return await fetch(req);
  } catch (e) {
    if (req.mode === 'navigate') {
      return new Response('<meta charset="utf-8"><p style="font:18px system-ui;padding:24px">' +
        '没有网络，并且这个页面不在离线包里。请联网后重新打开。</p>',
        { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
    throw e;
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (passThrough(url, e.request)) return;
  e.respondWith(respond(e.request, url));
});
