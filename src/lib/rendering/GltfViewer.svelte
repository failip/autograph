<script lang="ts">
import { onDestroy, onMount } from "svelte";
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HdrSceneBackground } from "./background";
import { ObjectOrbitControls } from "./ObjectOrbitControls";

export let modelPath = "/tasks/PES.gltf";
export let modelName = "GLTF model";

const origin = new Vector3(0, 0, 0);
const targetModelSize = 5;

let wrapper: HTMLDivElement;
let canvas: HTMLCanvasElement;
let scene: Scene | null = null;
let renderer: WebGLRenderer | null = null;
let camera: PerspectiveCamera | null = null;
let controls: ObjectOrbitControls | null = null;
let sceneBackground: HdrSceneBackground | null = null;
let resizeObserver: ResizeObserver | null = null;
let modelRoot: Group | null = null;
let modelPivot: Group | null = null;
let currentModel: Object3D | null = null;
let mounted = false;
let disposed = false;
let loadToken = 0;
let loadedPath = "";
let modelRadius = 3;
let isLoading = true;
let errorMessage = "";

$: if (mounted && modelPath !== loadedPath) {
  loadModel(modelPath);
}

function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    if (child instanceof Mesh) {
      child.geometry.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach((material) => material.dispose());
    }
  });
}

function clearModel(): void {
  if (!modelPivot || !currentModel) return;
  modelPivot.remove(currentModel);
  disposeObject(currentModel);
  currentModel = null;
}

function getCameraDistance(): number {
  return Math.max(7, modelRadius * 2.35);
}

function resetView(): void {
  if (!camera || !controls || !modelRoot) return;

  modelRoot.position.set(0, 0, 0);
  modelRoot.rotation.set(0, 0, 0);
  camera.position.set(0, 0, getCameraDistance());
  camera.lookAt(origin);
  camera.near = 0.01;
  camera.far = 1000;
  camera.updateProjectionMatrix();
  controls.target.copy(origin);
  controls.update();
}

function frameModel(model: Object3D): void {
  if (!modelPivot) return;

  model.position.set(0, 0, 0);
  model.rotation.set(0, 0, 0);
  model.scale.setScalar(1);
  modelPivot.scale.setScalar(1);
  model.updateMatrixWorld(true);

  const box = new Box3().setFromObject(model);
  if (box.isEmpty()) {
    modelRadius = 3;
    return;
  }

  const center = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 1);
  const scale = targetModelSize / maxDimension;

  model.position.copy(center).multiplyScalar(-1);
  modelPivot.scale.setScalar(scale);
  modelRadius = Math.max(size.length() * scale * 0.5, 1);
}

function loadModel(path: string): void {
  if (!modelPivot) return;

  const currentToken = ++loadToken;
  loadedPath = path;
  isLoading = true;
  errorMessage = "";
  clearModel();

  new GLTFLoader().load(
    path,
    (gltf) => {
      if (disposed || currentToken !== loadToken) {
        disposeObject(gltf.scene);
        return;
      }

      currentModel = gltf.scene;
      currentModel.name = modelName;
      frameModel(currentModel);
      modelPivot?.add(currentModel);
      isLoading = false;
      resetView();
    },
    undefined,
    (error) => {
      if (currentToken !== loadToken) return;
      isLoading = false;
      errorMessage =
        error instanceof Error ? error.message : "Unable to load GLTF model.";
    },
  );
}

function updateSize(): void {
  if (!renderer || !camera || !wrapper) return;

  const width = Math.max(wrapper.clientWidth, 1);
  const height = Math.max(wrapper.clientHeight, 1);
  renderer.setSize(width, height, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function animate(): void {
  if (!renderer || !scene || !camera) return;

  controls?.update();
  renderer.render(scene, camera);
}

onMount(() => {
  scene = new Scene();
  modelRoot = new Group();
  modelRoot.name = "GLTF Object Stage";
  modelPivot = new Group();
  modelRoot.add(modelPivot);
  scene.add(modelRoot);

  camera = new PerspectiveCamera(55, 1, 0.01, 1000);
  scene.add(camera);

  const ambientLight = new AmbientLight(0xffffff, 1.2);
  scene.add(ambientLight);

  const directionalLight = new DirectionalLight(0xffffff, 2.8);
  directionalLight.position.set(2, 4, 5);
  camera.add(directionalLight);

  renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(new Color(0xf0f0f0), 1);

  sceneBackground = new HdrSceneBackground(scene, renderer);
  sceneBackground.load();

  controls = new ObjectOrbitControls(camera, renderer.domElement, modelRoot);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.target.copy(origin);

  resizeObserver = new ResizeObserver(updateSize);
  resizeObserver.observe(wrapper);
  updateSize();
  resetView();

  renderer.setAnimationLoop(animate);
  mounted = true;
  loadModel(modelPath);
});

onDestroy(() => {
  disposed = true;
  loadToken += 1;
  renderer?.setAnimationLoop(null);
  resizeObserver?.disconnect();
  controls?.dispose();
  clearModel();
  sceneBackground?.dispose();
  renderer?.dispose();
});
</script>

<main class="viewer" bind:this={wrapper}>
  <canvas bind:this={canvas} aria-label={modelName}></canvas>

  {#if isLoading}
    <div class="status">Loading {modelName}</div>
  {:else if errorMessage}
    <div class="status error">{errorMessage}</div>
  {/if}
</main>

<style>
:global(body) {
  margin: 0;
  background: #f0f0f0;
}

.viewer {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #f0f0f0;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}

.status {
  position: absolute;
  left: 16px;
  bottom: 16px;
  max-width: min(420px, calc(100vw - 32px));
  border: 1px solid rgba(255, 255, 255, 0.36);
  border-radius: 6px;
  padding: 8px 10px;
  background: rgba(17, 18, 20, 0.72);
  color: #ffffff;
  font-family: system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.35;
}

.error {
  background: rgba(126, 24, 28, 0.84);
}
</style>
