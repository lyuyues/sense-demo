/* SENSE offline package for the iPad (2026-10-31, ported from VideoASD's offline.js).
 * Loaded by index.html, baseline.html and export.html.
 *
 * Downloads every file the study needs (server.py /offline-manifest.json) into Cache
 * Storage; sw.js then serves the pages, videos, audio stems and art from there, so a slow or
 * missing connection doesn't stall anything. Guards against the ways this can go wrong:
 *
 *  - Stale version: the package is pinned. A newer server version only shows
 *    "有新版本 · 更新" and is applied when a grown-up taps it (never mid-session).
 *    The active version is shown on the page and written into every export
 *    (app.js buildExportPayload `appVersion`), so data always says which version produced it.
 *  - Half-downloaded / corrupted files: each file is checked against its sha256 before
 *    it is stored, and a package is switched to only when complete. Downloads resume.
 *  - iOS clearing storage: every launch checks the package is still complete and, when
 *    online, quietly re-downloads what is missing. Storage persistence is requested.
 *  - Home Screen vs Safari: on iPad they keep separate storage, so a warning shows
 *    when the page isn't opened from the Home Screen icon.
 *  - Development: off on localhost unless ?offline=1; ?nocache=1 turns it off on this
 *    device (removes the worker and the package, never the data backups), ?nocache=0
 *    turns it back on.
 *
 * Pages show the status in any element with [data-offline-status]; pages without one
 * get a small corner badge, shown only when something needs a grown-up's attention.
 */

const ROOT = new URL('./', import.meta.url);
const META_CACHE = 'sense-meta';
const META_KEY = new URL('offline-meta.json', ROOT).href;
const PKG_PREFIX = 'sense-pkg-';
const LS_VERSION = 'sense_offline_version';
const LS_OFF = 'sense_offline_off';
const LS_DEV = 'sense_offline_dev';
const PARALLEL = 4;

const ls = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/** Version of the package this page runs from ('online' = straight from the server). */
export const offlineVersion = () => ls.get(LS_VERSION) || 'online';

export const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isStandalone = navigator.standalone === true ||
  (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);

const state = {
  mode: 'starting',   // off | dev | pages | unsupported | none | downloading | ready | incomplete | error
  version: null, built: null, files: 0, missing: 0,
  server: null,       // { version, built } when the server answered
  updateAvailable: false,
  done: 0, total: 0, bytesDone: 0, bytesTotal: 0,
  error: '', pending: 0, persisted: null,
};
export const offlineState = () => ({ ...state });

const listeners = new Set();
export function onOfflineChange(fn) { listeners.add(fn); fn(offlineState()); return () => listeners.delete(fn); }
function set(patch) { Object.assign(state, patch); listeners.forEach((fn) => fn(offlineState())); render(); }

/* ---------- package metadata ---------- */
async function readMeta() {
  try {
    const r = await (await caches.open(META_CACHE)).match(META_KEY);
    return r ? await r.json() : null;
  } catch { return null; }
}
async function writeMeta(meta) {
  await (await caches.open(META_CACHE)).put(META_KEY,
    new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
  ls.set(LS_VERSION, meta.version);
  const sw = navigator.serviceWorker && navigator.serviceWorker.controller;
  if (sw) sw.postMessage('meta-changed');
}

const abs = (rel) => new URL(rel, ROOT).href;

async function missingFiles(meta) {
  if (!meta || !(await caches.has(meta.cache))) return Object.keys(meta ? meta.files : {});
  const have = new Set((await (await caches.open(meta.cache)).keys()).map((r) => r.url));
  return Object.keys(meta.files).filter((u) => !have.has(abs(u)));
}

async function fetchManifest() {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const r = await fetch(abs('offline-manifest.json'), { cache: 'no-store', signal: ctl.signal });
    return r.ok ? await r.json() : null;
  } catch { return null; } finally { clearTimeout(t); }
}

async function sha256(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- download ---------- */
let running = null;
function download(manifest, prev) {
  if (running) return running;
  running = (async () => {
    const name = PKG_PREFIX + manifest.version;
    const cache = await caches.open(name);
    const old = prev && prev.cache !== name && (await caches.has(prev.cache)) ? await caches.open(prev.cache) : null;
    const queue = manifest.files.slice();
    const bytesTotal = queue.reduce((s, f) => s + f.size, 0);
    let done = 0, bytesDone = 0;
    set({ mode: 'downloading', total: queue.length, done, bytesDone, bytesTotal, error: '' });
    const tick = (f) => { done++; bytesDone += f.size; set({ done, bytesDone }); };

    async function one(f) {
      const key = abs(f.url);
      if (await cache.match(key)) return tick(f);                    // resumed
      if (old && prev.files[f.url] === f.sha) {                      // unchanged: copy
        const r = await old.match(key);
        if (r) { await cache.put(key, r); return tick(f); }
      }
      let lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          // ?__pkg= makes sw.js and any HTTP cache (Cloudflare) go to the server.
          const r = await fetch(`${key}?__pkg=${f.sha.slice(0, 12)}`, { cache: 'no-store' });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const buf = await r.arrayBuffer();
          if ((await sha256(buf)) !== f.sha) throw new Error('校验不一致');
          await cache.put(key, new Response(buf, { headers: {
            'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream',
            'Content-Length': String(buf.byteLength),
          } }));
          return tick(f);
        } catch (e) { lastErr = e; }
      }
      throw new Error(`${f.url}: ${lastErr && lastErr.message}`);
    }
    await Promise.all(Array.from({ length: PARALLEL }, async () => {
      while (queue.length) await one(queue.shift());
    }));

    const files = Object.fromEntries(manifest.files.map((f) => [f.url, f.sha]));
    const meta = { version: manifest.version, built: manifest.built, cache: name, files, at: new Date().toISOString() };
    await writeMeta(meta);
    for (const k of await caches.keys()) if (k.startsWith(PKG_PREFIX) && k !== name) await caches.delete(k);
    set({ mode: 'ready', version: meta.version, built: meta.built, files: manifest.files.length, missing: 0,
          updateAvailable: false });
    return meta;
  })().catch((e) => {
    set({ mode: 'error', error: String(e.message || e) });
    throw e;
  }).finally(() => { running = null; });
  return running;
}

/* ---------- check / update ---------- */
let lastManifest = null;
export async function checkOffline({ repair = true } = {}) {
  if (state.mode === 'off' || state.mode === 'unsupported') return offlineState();
  const meta = await readMeta();
  const missing = meta ? (await missingFiles(meta)).length : 0;
  set({ version: meta && meta.version, built: meta && meta.built, files: meta ? Object.keys(meta.files).length : 0, missing,
        mode: running ? 'downloading' : !meta ? 'none' : missing ? 'incomplete' : 'ready' });
  ls.set(LS_VERSION, meta && !missing ? meta.version : null);
  const manifest = await fetchManifest();
  lastManifest = manifest;
  if (!manifest) { set({ server: null }); return offlineState(); }
  set({ server: { version: manifest.version, built: manifest.built },
        updateAvailable: !!meta && manifest.version !== meta.version });
  // First install, or files lost from the package in use: fetch them now. A broken
  // package can't be repaired at its old version once the server moved on, so in that
  // case taking the update is the fix.
  if (repair && !running && (!meta || missing)) download(manifest, meta).catch(() => {});
  return offlineState();
}

/** Grown-up tapped "更新": take the server's version, then reload onto it. */
export async function applyUpdate() {
  const manifest = lastManifest || await fetchManifest();
  if (!manifest) { set({ error: '连不上服务器，联网后再试' }); return false; }
  await download(manifest, await readMeta());
  location.reload();
  return true;
}

/** Throw the package away and download it again (backup page). */
export async function redownload() {
  const manifest = await fetchManifest();
  if (!manifest) { set({ error: '连不上服务器，联网后再试' }); return false; }
  for (const k of await caches.keys()) if (k.startsWith(PKG_PREFIX)) await caches.delete(k);
  await download(manifest, null);
  return true;
}

/* ---------- status display ---------- */
const MB = (n) => `${(n / 1e6).toFixed(0)} MB`;
function describe(s) {
  const v = s.version ? `v${s.version.slice(0, 6)}` : '';
  switch (s.mode) {
    case 'off': return { cls: 'warn', text: '离线包已关闭（开发模式，?nocache=0 恢复）' };
    case 'dev': return { cls: 'warn', text: '本机开发：未启用离线包（?offline=1 启用）' };
    case 'pages': return { cls: 'warn', text: 'GitHub 演示版：不带离线包、记录只存本机（实验请用研究链接）' };
    case 'unsupported': return { cls: 'warn', text: '这个链接不支持离线包（需要 https 研究链接）' };
    case 'downloading': return { cls: 'busy',
      text: `⬇ 正在下载离线包 ${s.done}/${s.total} · ${MB(s.bytesDone)}/${MB(s.bytesTotal)}（请保持联网，别关页面）` };
    case 'none': return { cls: 'warn', text: s.server === null ? '⚠ 还没有离线包，请联网打开一次' : '准备下载离线包…' };
    case 'incomplete': return { cls: 'bad', text: `⚠ 离线包不完整（缺 ${s.missing} 个文件），请联网打开一次自动补齐` };
    case 'error': return { cls: 'bad', text: `⚠ 离线包下载没完成：${s.error}`, retry: true };
    case 'ready': return { cls: s.updateAvailable ? 'busy' : 'ok',
      text: `✓ 离线可用 · ${v} · ${s.built || ''}`, update: s.updateAvailable };
    default: return { cls: 'busy', text: '检查离线包…' };
  }
}
const needsAttention = (s) => !['ready', 'starting', 'off', 'dev', 'pages'].includes(s.mode) || s.updateAvailable;

const STYLE = `
.offline-status{font:600 13px/1.4 -apple-system,"PingFang SC",system-ui,sans-serif;display:inline-flex;flex-wrap:wrap;
  align-items:center;gap:6px;padding:4px 10px;border-radius:10px;background:#fff8;color:#3d3428}
.offline-status.ok{color:#15803d}.offline-status.busy{color:#b45309}.offline-status.bad,.offline-status.warn{color:#b91c1c}
.offline-status button{font:inherit;font-size:12px;padding:3px 9px;border-radius:8px;border:none;background:#f59e42;color:#fff;cursor:pointer}
.offline-float{position:fixed;left:8px;bottom:8px;z-index:99999;max-width:min(560px,calc(100vw - 16px));
  background:#fffdf8;box-shadow:0 2px 8px rgba(0,0,0,.18)}`;

function render() {
  if (typeof document === 'undefined' || !document.body) return;
  if (!document.getElementById('offline-style')) {
    const st = document.createElement('style'); st.id = 'offline-style'; st.textContent = STYLE;
    document.head.appendChild(st);
  }
  const d = describe(state);
  const extra = [];
  if (isIOS && !isStandalone && state.mode !== 'off') extra.push('请从主屏幕图标打开（Safari 和图标的存储是分开的）');
  if (state.pending) extra.push(`⏳ ${state.pending} 份记录待上传`);
  let hosts = [...document.querySelectorAll('[data-offline-status]')];
  let float = document.getElementById('offline-float');
  if (!hosts.length) {
    if (!needsAttention(state)) { if (float) float.hidden = true; return; }
    if (!float) {
      float = document.createElement('div'); float.id = 'offline-float';
      document.body.appendChild(float);
    }
    float.hidden = false;
    hosts = [float];
  }
  hosts.forEach((h) => {
    h.classList.add('offline-status');
    h.classList.toggle('offline-float', h.id === 'offline-float');
    ['ok', 'busy', 'bad', 'warn'].forEach((c) => h.classList.toggle(c, c === d.cls));
    h.textContent = [d.text, ...extra].join(' · ');
    if (d.update) {
      const b = document.createElement('button');
      b.textContent = `有新版本（${state.server && state.server.built}）· 更新`;
      b.onclick = () => { if (confirm('现在更新离线包？更新会重新加载页面，请不要在孩子做到一半时更新。')) applyUpdate(); };
      h.appendChild(b);
    }
    if (d.retry) {
      const b = document.createElement('button'); b.textContent = '重试';
      b.onclick = () => checkOffline();
      h.appendChild(b);
    }
  });
}

/* ---------- start ---------- */
// Records the server hasn't confirmed yet (app.js PENDING_KEY, re-sent every 30 s).
function refreshPending() {
  let n = 0;
  try { n = JSON.parse(localStorage.getItem('sense_pending') || '[]').length; } catch { /* ignore */ }
  if (n !== state.pending) set({ pending: n });
}

async function start() {
  const q = new URLSearchParams(location.search);
  if (q.get('nocache') === '1') ls.set(LS_OFF, '1');
  if (q.get('nocache') === '0') ls.set(LS_OFF, null);
  if (q.get('offline') === '1') ls.set(LS_DEV, '1');
  if (q.get('offline') === '0') ls.set(LS_DEV, null);
  const devHost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);

  if (ls.get(LS_OFF) || (devHost && !ls.get(LS_DEV)) || location.hostname === 'lyuyues.github.io') {
    ls.set(LS_VERSION, null);
    if (ls.get(LS_OFF) && 'serviceWorker' in navigator) {
      for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
      for (const k of await caches.keys()) if (k.startsWith('sense-')) await caches.delete(k);
    }
    set({ mode: ls.get(LS_OFF) ? 'off' : devHost ? 'dev' : 'pages' });
    return;
  }
  if (!('serviceWorker' in navigator) || !window.isSecureContext || !window.caches) {
    ls.set(LS_VERSION, null);
    set({ mode: 'unsupported' });
    return;
  }
  try {
    if (navigator.storage && navigator.storage.persist) set({ persisted: await navigator.storage.persist() });
  } catch { /* ignore */ }
  await navigator.serviceWorker.register(new URL('sw.js', ROOT), { scope: ROOT.pathname });
  await checkOffline();
  addEventListener('online', () => checkOffline());
  refreshPending();
  setInterval(refreshPending, 10000);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { render(); start(); });
else { render(); start(); }
