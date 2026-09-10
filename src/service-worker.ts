/// <reference lib="webworker" />

import { base, build, files, prerendered, version } from '$service-worker';

const worker = self as unknown as ServiceWorkerGlobalScope;
const cachePrefix = `autograph:${base || '/'}:`;
const shellCache = `${cachePrefix}shell:${version}`;
const dataCache = `${cachePrefix}data:${version}`;
const offlineRoutes = ['/', '/vr', '/pes', '/trajectory'].map((path) => `${base}${path}`);
const pages = new Set(prerendered.filter((path) => offlineRoutes.includes(path)));
// Molecule names contain #, +, brackets, and spaces. Encode each filename
// segment so a # in a species name is never interpreted as a URL fragment.
const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
const shellAssets = new Set([...build, ...files.map(encodePath), ...pages]);
const maxFileBytes = 8 * 1024 * 1024;
const maxCacheBytes = 32 * 1024 * 1024;
const maxCacheEntries = 160;
const sizeHeader = 'x-autograph-cache-bytes';
let cacheWrites = Promise.resolve();

worker.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(shellCache);
    // Bypass the HTTP cache when installing a new release. Installation is
    // atomic: the old worker stays active if any required asset fails to load.
    await cache.addAll([...shellAssets].map((url) => new Request(url, { cache: 'reload' })));
  })());
  // Let existing sessions finish before activating an update.
});

worker.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith(cachePrefix) && key !== shellCache && key !== dataCache)
      .map((key) => caches.delete(key)));
    await worker.clients.claim();
  })());
});

async function storeData(request: Request, response: Response): Promise<void> {
  if (response.status !== 200 || /no-store|private/i.test(response.headers.get('cache-control') || '')) return;
  const declaredSize = Number(response.headers.get('content-length'));
  if (declaredSize > maxFileBytes) return;

  const body = await response.blob();
  if (body.size > maxFileBytes) return;

  const cache = await caches.open(dataCache);
  const headers = new Headers(response.headers);
  headers.set(sizeHeader, String(body.size));
  // Refresh insertion order so eviction keeps the most recently fetched files.
  await cache.delete(request);
  await cache.put(request, new Response(body, { status: response.status, statusText: response.statusText, headers }));

  const keys = await cache.keys();
  const sizes = await Promise.all(keys.map(async (key) =>
    Number((await cache.match(key))?.headers.get(sizeHeader) || 0)));
  let totalBytes = sizes.reduce((total, size) => total + size, 0);
  let remaining = keys.length;
  for (let index = 0; index < keys.length; index += 1) {
    if (remaining <= maxCacheEntries && totalBytes <= maxCacheBytes) break;
    await cache.delete(keys[index]);
    totalBytes -= sizes[index];
    remaining -= 1;
  }
}

async function fetchData(event: FetchEvent): Promise<Response> {
  const cache = await caches.open(dataCache);
  try {
    const response = await fetch(event.request);
    if (response.status >= 500) {
      const cached = await cache.match(event.request);
      if (cached) return cached;
    }
    const copy = response.clone();
    // Serialize writes to enforce the storage limit even when many molecular
    // structures arrive together. Storage failures must not break online use.
    cacheWrites = cacheWrites.then(() => storeData(event.request, copy)).catch(() => {});
    event.waitUntil(cacheWrites);
    return response;
  } catch {
    return await cache.match(event.request) || new Response(
      'This file is unavailable offline. Open it while connected to save a copy.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    );
  }
}

worker.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== worker.location.origin ||
    request.headers.has('range') || request.headers.has('authorization') || request.cache === 'no-store') return;

  let pathname: string;
  try {
    pathname = url.pathname.split('/').map((segment) => encodeURIComponent(decodeURIComponent(segment))).join('/');
  } catch {
    return;
  }

  // Query strings select client-side datasets; every known route still uses
  // its own cached HTML. Unknown URLs and API calls keep normal HTTP behavior.
  const pagePath = pathname.replace(/\/$/, '') || '/';
  const route = pages.has(pathname) ? pathname : pagePath;
  const asset = request.mode === 'navigate' && pages.has(route) ? route : pathname;
  if (shellAssets.has(asset) && (request.mode !== 'navigate' || pages.has(route))) {
    event.respondWith((async () => {
      const cache = await caches.open(shellCache);
      return await cache.match(asset) || fetch(request);
    })());
    return;
  }

  const path = url.pathname.slice(base.length);
  if (request.mode !== 'navigate' && url.pathname.startsWith(`${base}/`) &&
    ['/graphs/AtmosphereReduced/', '/tasks/', '/trajectory/'].some((prefix) => path.startsWith(prefix))) {
    event.respondWith(fetchData(event));
  }
});
