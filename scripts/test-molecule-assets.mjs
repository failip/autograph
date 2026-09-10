import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';
import { loadConfigFromFile } from 'vite';

const configFile = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
const loaded = await loadConfigFromFile({ command: 'serve', mode: 'test' }, configFile);
const plugin = loaded.config.plugins.flat(Infinity).find((plugin) => plugin.name === 'encoded-molecule-assets');
const root = await mkdtemp(join(tmpdir(), 'autograph-molecule-test-'));
after(() => rm(root, { recursive: true, force: true }));

const molecule = 'N#[N+][O-]';
const xyz = await readFile(new URL(`../static/graphs/AtmosphereReduced/extended/xyz_species/${encodeURIComponent(molecule)}.xyz`, import.meta.url), 'utf8');
const path = `/graphs/AtmosphereReduced/extended/xyz_species/${encodeURIComponent(molecule)}.xyz`;

function handlerFor(hook) {
  let handler;
  plugin[hook]({ config: { root }, middlewares: { use(value) { handler = value; } } });
  return handler;
}

function request(handler, url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const response = new PassThrough();
    const chunks = [];
    const headers = new Map();
    response.setHeader = (name, value) => headers.set(name.toLowerCase(), value);
    response.on('data', (chunk) => chunks.push(chunk));
    response.on('error', reject);
    response.on('end', () => resolve({ handled: true, headers, body: Buffer.concat(chunks).toString() }));
    Promise.resolve(handler({ url, method }, response, () => {
      response.destroy();
      resolve({ handled: false });
    })).catch(reject);
  });
}

for (const [hook, directory] of [
  ['configureServer', 'static'],
  ['configurePreviewServer', '.svelte-kit/output/client']
]) {
  const destination = join(root, directory, 'graphs/AtmosphereReduced/extended/xyz_species');
  await mkdir(destination, { recursive: true });
  // Separate contents also verify that each server reads the correct directory.
  const expected = xyz.replace('SMILES:', `${directory} SMILES:`);
  await writeFile(join(destination, `${molecule}.xyz`), expected);
  const handler = handlerFor(hook);

  test(`${hook}: loads N#[N+][O-] with all three atoms from its encoded URL`, async () => {
    const result = await request(handler, path);
    assert.equal(result.handled, true);
    assert.equal(result.body, expected);
    assert.equal(result.headers.get('content-type'), 'chemical/x-xyz');
    assert.equal(result.headers.get('content-length'), Buffer.byteLength(expected));
    assert.deepEqual(result.body.trim().split('\n').slice(2).map((line) => line.split(/\s+/)[0]), ['N', 'N', 'O']);
  });

  test(`${hook}: HEAD and query strings preserve the molecule filename`, async () => {
    const head = await request(handler, `${path}?check=1`, 'HEAD');
    assert.equal(head.handled, true);
    assert.equal(head.body, '');
    assert.equal(head.headers.get('content-length'), Buffer.byteLength(expected));
  });

  test(`${hook}: missing and invalid files fall through without exposing other paths`, async () => {
    for (const [url, method] of [
      [path.replace('/extended/', '/'), 'GET'],
      ['/graphs/AtmosphereReduced/%zz.xyz', 'GET'],
      ['/graphs/AtmosphereReduced/%2e%2e%2foutside.xyz', 'GET'],
      [path.replace('AtmosphereReduced', 'another-graph'), 'GET'],
      [path, 'POST']
    ]) assert.equal((await request(handler, url, method)).handled, false, url);
  });
}
