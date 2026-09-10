import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import config from '../svelte.config.js';

const origin = 'https://autograph.test';
const source = await readFile(new URL('../src/service-worker.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

// Browser APIs are simulated here; the built app should also be checked in a
// real browser for service-worker lifecycle and installability (see README).
function setup({ base = '', version = 'v1' } = {}) {
  const listeners = new Map();
  const stores = new Map();
  const requests = [];
  let network = async () => new Response('online');
  let claimed = false;
  let rejectWrites = false;
  const urlOf = (input) => new URL(typeof input === 'string' ? input : input.url, origin).href;
  class WorkerRequest extends Request {
    constructor(input, init) {
      super(typeof input === 'string' ? new URL(input, origin) : input, init);
    }
  }
  const fetch = async (request) => {
    requests.push(urlOf(request));
    return network(request);
  };
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(key) { return stores.delete(key); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(input) { return store.get(urlOf(input))?.clone(); },
        async keys() { return [...store.keys()].map((url) => new WorkerRequest(url)); },
        async delete(input) { return store.delete(urlOf(input)); },
        async put(input, response) {
          if (rejectWrites) throw new Error('Storage quota exceeded');
          store.set(urlOf(input), response.clone());
        },
        async addAll(inputs) {
          const responses = await Promise.all(inputs.map(fetch));
          if (responses.some((response) => !response.ok)) throw new Error('Precache failed');
          await Promise.all(inputs.map((input, index) => this.put(input, responses[index])));
        }
      };
    }
  };
  const shell = {
    base, version,
    build: [`${base}/_app/immutable/app.js`],
    files: [`${base}/icons/icon-192.png`, `${base}/graphs/AtmosphereReduced/xyz_species/N#[N+][O-].xyz`, `${base}/graphs/AtmosphereReduced/xyz_species/[N] + [OH] => [N]=O + [H].xyz`, `${base}/tasks/PES.gltf`, `${base}/trajectory/Run1.xyz`],
    prerendered: [`${base}/`, `${base}/vr`, `${base}/pes`, `${base}/trajectory`, `${base}/graph`, `${base}/database`]
  };
  vm.runInNewContext(code, {
    exports: {}, require: () => shell, caches, fetch, URL, Headers, Response,
    Request: WorkerRequest,
    self: {
      location: { origin },
      clients: { async claim() { claimed = true; } },
      addEventListener(name, listener) { listeners.set(name, listener); }
    }
  });
  async function dispatch(name, request) {
    const pending = [];
    let handled = false;
    let result;
    listeners.get(name)({
      request,
      waitUntil(promise) { pending.push(promise); },
      respondWith(promise) { handled = true; result = promise; }
    });
    const response = await result;
    await Promise.all(pending);
    return { handled, response };
  }
  return {
    caches, requests, shell,
    install: () => dispatch('install'),
    activate: () => dispatch('activate'),
    get claimed() { return claimed; },
    setNetwork(value) { network = value; },
    failWrites() { rejectWrites = true; },
    async request(path, { navigate = false, ...init } = {}) {
      const request = new WorkerRequest(path, init);
      if (navigate) Object.defineProperty(request, 'mode', { value: 'navigate' });
      return dispatch('fetch', request);
    },
    offline() { network = async () => { throw new TypeError('Offline'); }; },
    dataCache: () => caches.open(`autograph:${base || '/'}:data:${version}`)
  };
}

test('installs the three default views and their selected data; deep links work offline', async () => {
  const app = setup();
  await app.install();
  assert.deepEqual(app.requests.sort(), [...app.shell.build, ...app.shell.files, ...app.shell.prerendered.filter((path) => !['/graph', '/database'].includes(path))]
    .map((path) => origin + path.split('/').map(encodeURIComponent).join('/')).sort());
  app.offline();
  for (const path of ['/', '/vr?reactionViewing=false', '/vr/', '/pes?model=PES.gltf', '/trajectory?file=Run1.xyz', '/_app/immutable/app.js']) {
    const { handled, response } = await app.request(path, { navigate: !path.startsWith('/_app/') });
    assert.equal(handled, true, path);
    assert.equal(response.status, 200, path);
  }
  for (const path of ['/unknown', '/graph', '/database']) {
    assert.equal((await app.request(path, { navigate: true })).handled, false);
  }
  for (const file of app.shell.files) {
    const encoded = file.split('/').map(encodeURIComponent).join('/');
    assert.equal((await app.request(encoded)).response.status, 200, file);
  }
});

test('keeps queries distinct, refreshes data online, and falls back offline or on server errors', async () => {
  const app = setup();
  app.setNetwork(async () => new Response('first'));
  await app.request('/graphs/AtmosphereReduced/network.json?variant=1');
  app.setNetwork(async () => new Response('second'));
  await app.request('/graphs/AtmosphereReduced/network.json?variant=2');
  app.offline();
  assert.equal(await (await app.request('/graphs/AtmosphereReduced/network.json?variant=1')).response.text(), 'first');
  assert.equal(await (await app.request('/graphs/AtmosphereReduced/network.json?variant=2')).response.text(), 'second');
  assert.equal((await app.request('/graphs/AtmosphereReduced/missing.json')).response.status, 503);
  app.setNetwork(async () => new Response('updated'));
  await app.request('/graphs/AtmosphereReduced/network.json?variant=1');
  app.setNetwork(async () => new Response('Server error', { status: 500 }));
  assert.equal(await (await app.request('/graphs/AtmosphereReduced/network.json?variant=1')).response.text(), 'updated');
});

test('leaves external requests, APIs, mutations, range requests, and private requests alone', async () => {
  const app = setup();
  for (const [path, init] of [
    ['https://other.test/graphs/AtmosphereReduced/network.json', {}],
    ['/api/database_list', {}],
    ['/graphs/isooctane/graph.json', {}],
    ['/graphs/AtmosphereReduced/network.json', { method: 'POST', body: 'new graph' }],
    ['/trajectory/Run1.xyz', { headers: { Range: 'bytes=0-20' } }],
    ['/graphs/AtmosphereReduced/network.json', { headers: { Authorization: 'Bearer test' } }],
    ['/graphs/AtmosphereReduced/network.json', { cache: 'no-store' }]
  ]) assert.equal((await app.request(path, init)).handled, false, path);
  assert.equal(app.requests.length, 0);
});

test('does not store errors, private responses, no-store responses, or oversized datasets', async () => {
  const app = setup();
  for (const response of [
    new Response('missing', { status: 404 }),
    new Response('temporary', { status: 503 }),
    new Response('private', { headers: { 'Cache-Control': 'private' } }),
    new Response('secret', { headers: { 'Cache-Control': 'no-store' } }),
    new Response(new Uint8Array(8 * 1024 * 1024 + 1))
  ]) {
    app.setNetwork(async () => response);
    await app.request('/tasks/model.gltf');
    assert.equal((await (await app.dataCache()).keys()).length, 0);
  }
});

test('cache write failures do not break a successful network response', async () => {
  const app = setup();
  app.failWrites();
  assert.equal(await (await app.request('/graphs/AtmosphereReduced/network.json')).response.text(), 'online');
});

test('parallel data requests respect the file count limit', async () => {
  const app = setup();
  await Promise.all(Array.from({ length: 162 }, (_, i) => app.request(`/graphs/AtmosphereReduced/${i}.xyz`)));
  const keys = await (await app.dataCache()).keys();
  assert.equal(keys.length, 160);
  assert.equal(keys[0].url, `${origin}/graphs/AtmosphereReduced/2.xyz`);
});

test('evicts old data when the byte limit is reached', async () => {
  const app = setup();
  app.setNetwork(async () => new Response(new Uint8Array(7 * 1024 * 1024)));
  for (let i = 0; i < 5; i += 1) await app.request(`/tasks/model-${i}.gltf`);
  const keys = await (await app.dataCache()).keys();
  assert.equal(keys.length, 4);
  assert.equal(keys[0].url, `${origin}/tasks/model-1.gltf`);
});

test('activation cleans only this app scope and claims the first open page', async () => {
  const app = setup({ base: '/autograph' });
  const names = ['autograph:/autograph:shell:old', 'autograph:/autograph:data:old',
    'autograph:/autograph:shell:v1', 'autograph:/autograph:data:v1',
    'autograph:/other:shell:old', 'another-app'];
  for (const name of names) await app.caches.open(name);
  await app.activate();
  assert.equal(app.claimed, true);
  assert.deepEqual(await app.caches.keys(), names.slice(2));
  await app.install();
  app.offline();
  assert.equal((await app.request('/autograph/vr?reactionViewing=false', { navigate: true })).response.status, 200);
  assert.equal((await app.request('/graphs/AtmosphereReduced/outside-scope.json')).handled, false);
});

test('a failed installation leaves the previous release cached', async () => {
  const app = setup();
  await app.caches.open('autograph:/:shell:old');
  app.setNetwork(async () => new Response('not deployed', { status: 404 }));
  await assert.rejects(app.install(), /Precache failed/);
  assert.ok((await app.caches.keys()).includes('autograph:/:shell:old'));
  assert.equal(app.claimed, false);
});

test('manifest includes standalone launch, correctly sized PNGs, and maskable artwork', async () => {
  const root = new URL('../static/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('manifest.webmanifest', root), 'utf8'));
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.id, './');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    const png = await readFile(new URL(icon.src, root));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});


test('precache selection includes only assets for the three default views', () => {
  const include = config.kit.serviceWorker.files;
  for (const file of [
    'graphs/AtmosphereReduced/atmosphere_nox_reduced.json',
    'graphs/AtmosphereReduced/xyz_species/NttN.xyz',
    'graphs/AtmosphereReduced/extended/hno_reaction_graph_smiles.json',
    'graphs/AtmosphereReduced/extended/xyz_species/N#N.xyz',
    'tasks/PES.gltf', 'trajectory/Run1.xyz', 'qwantani_dusk_2_puresky_1k.hdr',
    'fonts/Quicksand-Regular.woff2', 'icons/icon-512.png'
  ]) assert.equal(include(file), true, file);
  for (const file of [
    'graphs/GKHP/graph.json', 'graphs/aramco/AramcoMech2.0.mech',
    'graphs/AtmosphereReduced/.DS_Store', 'graphs/AtmosphereReduced/archive.zip',
    'test/AtmosphereReduced.zip', 'tasks/other.gltf', 'trajectory/other.xyz'
  ]) assert.equal(include(file), false, file);
});
