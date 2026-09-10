import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import * as three from 'three';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/rendering/ConfettiBurst.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText;

function setup(t) {
  let seed = 42;
  const math = Object.create(Math);
  math.random = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 2 ** 32);
  const exports = {};
  vm.runInNewContext(code, { exports, require: () => three, Math: math });
  const effect = new exports.ConfettiBurst();
  t.after(() => effect.dispose());
  new three.Scene().add(effect.mesh);
  return effect;
}

function visibleParticles(effect, camera) {
  if (!effect.mesh.visible || effect.mesh.material.opacity <= 0.01) return 0;
  effect.mesh.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const transform = new three.Matrix4();
  const point = new three.Vector3();
  let visible = 0;
  for (let i = 0; i < effect.mesh.count; i++) {
    effect.mesh.getMatrixAt(i, transform);
    if (new three.Vector3().setFromMatrixScale(transform).lengthSq() < 1e-8) continue;
    point.setFromMatrixPosition(transform).applyMatrix4(effect.mesh.matrixWorld).project(camera);
    if (Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) < 1) visible++;
  }
  return visible;
}

test('confetti surrounds the headset during flight and stays in the room when looking around', t => {
  const effect = setup(t);
  const headset = new three.PerspectiveCamera(90, 1, 0.1, 100);
  headset.position.set(7, 1.65, -3);
  effect.play(headset, true);
  effect.update(2.25);
  const roomPosition = effect.mesh.position.clone();

  for (let second = 0; second < 3; second++) {
    for (let direction = 0; direction < 8; direction++) {
      headset.rotation.y = direction * Math.PI / 4;
      assert.ok(visibleParticles(effect, headset) >= 50, `Confetti visible at second ${second}, direction ${direction}`);
      assert.ok(effect.mesh.position.equals(roomPosition), 'Looking around does not move the confetti');
    }
    effect.update(1);
  }
  effect.update(4);
  assert.equal(effect.mesh.visible, false);
});

function particleHeights(effect) {
  const matrix = new three.Matrix4();
  return Array.from({ length: effect.mesh.count }, (_, i) => {
    effect.mesh.getMatrixAt(i, matrix);
    return matrix.elements[13];
  });
}

test('confetti pauses, shoots upward, then slows into a fall', t => {
  const effect = setup(t);
  effect.play(new three.PerspectiveCamera(), true);
  assert.equal(effect.mesh.visible, false);
  effect.update(1.2);
  assert.equal(effect.mesh.visible, false, 'The discovery gets a moment before the launch');

  effect.update(0.75);
  const launching = particleHeights(effect);
  effect.update(0.2);
  const rising = particleHeights(effect);
  assert.ok(rising.length > 0);
  assert.ok(rising.every((y, i) => y > launching[i]), 'All launched pieces initially travel upward');

  effect.update(2);
  const beforeFall = particleHeights(effect);
  effect.update(0.2);
  const falling = particleHeights(effect);
  assert.ok(falling.every((y, i) => y < beforeFall[i]), 'Pieces fall naturally after the apex');
  const upwardTravel = rising.reduce((sum, y, i) => sum + y - launching[i], 0);
  const downwardTravel = falling.reduce((sum, y, i) => sum + beforeFall[i] - y, 0);
  assert.ok(downwardTravel < upwardTravel * 0.6, 'The overall fall is gentler than the launch');
});

test('reset during the pause cancels the launch and allows a fresh celebration', t => {
  const effect = setup(t);
  const camera = new three.PerspectiveCamera();
  effect.play(camera, true);
  effect.update(1);
  effect.clear();
  effect.update(2);
  assert.equal(effect.mesh.visible, false);
  assert.equal(effect.mesh.count, 0);
  effect.play(camera, true);
  effect.update(2.25);
  assert.ok(visibleParticles(effect, camera) > 0);
});

test('desktop confetti remains visible with a heavily zoomed perspective camera', t => {
  const effect = setup(t);
  const camera = new three.PerspectiveCamera(75, 1.44, 0.1, 1000);
  camera.position.set(0, 0, 30);
  for (const zoom of [1, 10, 60]) {
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    effect.play(camera, false);
    effect.update(2.25);
    assert.ok(visibleParticles(effect, camera) >= 50, `Confetti visible at zoom ${zoom}`);
  }
});

test('desktop confetti fills an orthographic view at different zoom levels', t => {
  const effect = setup(t);
  const camera = new three.OrthographicCamera(-720, 720, 500, -500, -1000, 1000);
  camera.position.set(0, 0, 30);
  for (const zoom of [1, 10, 60]) {
    camera.zoom = zoom;
    camera.updateProjectionMatrix();
    effect.play(camera, false);
    effect.update(2.25);
    assert.ok(visibleParticles(effect, camera) >= 50, `Confetti visible at zoom ${zoom}`);
  }
});
