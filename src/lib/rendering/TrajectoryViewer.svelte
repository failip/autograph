<script lang="ts">
import { VRControls } from "$lib/vr/controls/VRControls";
import { onDestroy, onMount } from "svelte";
import {
  AmbientLight,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { HdrSceneBackground } from "./background";
import { MoleculeGenerator } from "./molecules";
import { ObjectOrbitControls } from "./ObjectOrbitControls";
import { parseRun, type Run } from "./xyz";

export let xyzText: string;
export let fileName: string | undefined = undefined;
export let initialFps = 30;
export let showToolbar = true;
export let autoPlayOnce = false;
export let autoPlayDelayMs = 0;
export let onComplete: () => void = () => {};

type XrMode = "immersive-vr" | "immersive-ar";

const NODE_ID = "trajectory";
const SINGLE_FRAME_HOLD_MS = 1200;
const selectedSpecies = new Set<string>();
const moleculeGenerator = new MoleculeGenerator();
const origin = new Vector3(0, 0, 0);

let wrapper: HTMLDivElement;
let canvas: HTMLCanvasElement;
let scene: Scene | null = null;
let renderer: WebGLRenderer | null = null;
let camera: PerspectiveCamera | null = null;
let orbitControls: ObjectOrbitControls | null = null;
let xrControls: VRControls | null = null;
let currentSession: XRSession | null = null;
let resizeObserver: ResizeObserver | null = null;
let sceneRoot: Group | null = null;
let moleculeGroup: Group | null = null;
let sceneBackground: HdrSceneBackground | null = null;
let referencePlane: GridHelper | null = null;
let loadedText = "";
let mounted = false;
let errorMessage = "";
let xrError = "";

let run: Run | null = null;
let frameIndex = 0;
let playbackFps = initialFps;
let isPlaying = true;
let loop = true;
let hasVr = false;
let hasAr = false;
let isImmersive = false;
let activeXrMode: XrMode | null = null;
let frameAccumulator = 0;
let lastAnimationTime = 0;
let moleculeScale = 1;
let viewRadius = 3;
let completionNotified = false;
let completionTimer: ReturnType<typeof setTimeout> | null = null;
let playbackStartTimer: ReturnType<typeof setTimeout> | null = null;

$: if (mounted && xyzText !== loadedText) {
  loadTrajectory(xyzText);
}

function validateRun(parsedRun: Run): void {
  if (
    !Number.isInteger(parsedRun.number_of_atoms) ||
    parsedRun.number_of_atoms <= 0
  ) {
    throw new Error("The file does not start with a valid atom count.");
  }

  if (
    !Number.isInteger(parsedRun.number_of_frames) ||
    parsedRun.number_of_frames <= 0
  ) {
    throw new Error("No complete XYZ frames were found.");
  }

  if (parsedRun.symbols.length !== parsedRun.number_of_atoms) {
    throw new Error("The first XYZ frame does not contain the expected atoms.");
  }

  parsedRun.symbols.forEach((symbol, atomIndex) => {
    if (!symbol) {
      throw new Error(`Atom ${atomIndex + 1} is missing an element symbol.`);
    }
  });

  parsedRun.frames.forEach((frame, currentFrame) => {
    if (frame.positions.length !== parsedRun.number_of_atoms * 3) {
      throw new Error(
        `Frame ${currentFrame + 1} has an invalid coordinate count.`,
      );
    }

    for (let index = 0; index < frame.positions.length; index += 1) {
      if (!Number.isFinite(frame.positions[index])) {
        throw new Error(
          `Frame ${currentFrame + 1} contains an invalid coordinate.`,
        );
      }
    }
  });
}

function prepareRun(parsedRun: Run): Run {
  let maxRadius = 0;
  const frames = parsedRun.frames.map((frame) => {
    const positions = new Float32Array(frame.positions.length);
    let centerX = 0;
    let centerY = 0;
    let centerZ = 0;

    for (
      let atomIndex = 0;
      atomIndex < parsedRun.number_of_atoms;
      atomIndex += 1
    ) {
      centerX += frame.positions[atomIndex * 3];
      centerY += frame.positions[atomIndex * 3 + 1];
      centerZ += frame.positions[atomIndex * 3 + 2];
    }

    centerX /= parsedRun.number_of_atoms;
    centerY /= parsedRun.number_of_atoms;
    centerZ /= parsedRun.number_of_atoms;

    for (
      let atomIndex = 0;
      atomIndex < parsedRun.number_of_atoms;
      atomIndex += 1
    ) {
      const x = frame.positions[atomIndex * 3] - centerX;
      const y = frame.positions[atomIndex * 3 + 1] - centerY;
      const z = frame.positions[atomIndex * 3 + 2] - centerZ;

      positions[atomIndex * 3] = x;
      positions[atomIndex * 3 + 1] = y;
      positions[atomIndex * 3 + 2] = z;

      maxRadius = Math.max(maxRadius, Math.sqrt(x * x + y * y + z * z));
    }

    return { positions };
  });

  moleculeScale = 2.8 / Math.max(maxRadius, 1);
  viewRadius = Math.max(maxRadius * moleculeScale + 0.7, 2.2);

  return {
    number_of_atoms: parsedRun.number_of_atoms,
    number_of_frames: parsedRun.number_of_frames,
    symbols: [...parsedRun.symbols],
    frames,
  };
}

function disposeMaterial(material: Mesh["material"]): void {
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((item) => item.dispose());
}

function disposeMolecule(group: Group): void {
  group.traverse((child) => {
    if (child instanceof Mesh) {
      if (child.geometry !== moleculeGenerator.bond_geometry) {
        child.geometry.dispose();
      }
      disposeMaterial(child.material);
    }
  });
}

function removeCurrentMolecule(): void {
  if (!sceneRoot || !moleculeGroup) return;
  sceneRoot.remove(moleculeGroup);
  disposeMolecule(moleculeGroup);
  moleculeGroup = null;
}

function loadTrajectory(text: string): void {
  loadedText = text;
  frameAccumulator = 0;
  frameIndex = 0;
  errorMessage = "";
  completionNotified = false;

  if (completionTimer) {
    clearTimeout(completionTimer);
    completionTimer = null;
  }

  if (playbackStartTimer) {
    clearTimeout(playbackStartTimer);
    playbackStartTimer = null;
  }

  if (!scene) return;

  try {
    if (!text.trim()) {
      throw new Error("Choose a non-empty XYZ file.");
    }

    const parsedRun = parseRun(text);
    validateRun(parsedRun);
    const preparedRun = prepareRun(parsedRun);
    const nextMolecule = moleculeGenerator.generateMolecule(
      preparedRun,
      new Set(),
      false,
    );

    nextMolecule.scale.setScalar(moleculeScale);
    nextMolecule.userData.name = NODE_ID;
    nextMolecule.traverse((child) => {
      child.userData.name = NODE_ID;
    });

    removeCurrentMolecule();
    run = preparedRun;
    moleculeGroup = nextMolecule;
    sceneRoot?.add(moleculeGroup);
    loop = autoPlayOnce ? false : loop;

    const canPlay = preparedRun.number_of_frames > 1;
    if (autoPlayOnce && canPlay && autoPlayDelayMs > 0) {
      isPlaying = false;
      playbackStartTimer = setTimeout(() => {
        playbackStartTimer = null;
        isPlaying = true;
      }, autoPlayDelayMs);
    } else {
      isPlaying = canPlay;
    }

    updateReferencePlane();
    resetView();

    if (autoPlayOnce && preparedRun.number_of_frames <= 1) {
      notifyComplete(autoPlayDelayMs + SINGLE_FRAME_HOLD_MS);
    }
  } catch (error) {
    removeCurrentMolecule();
    run = null;
    isPlaying = false;
    errorMessage =
      error instanceof Error ? error.message : "Unable to parse this XYZ file.";

    if (autoPlayOnce) {
      notifyComplete(autoPlayDelayMs + SINGLE_FRAME_HOLD_MS);
    }
  }
}

function getFrameCount(): number {
  return run?.number_of_frames ?? 0;
}

function normalizeFrameIndex(index: number): number {
  const frameCount = getFrameCount();
  if (frameCount === 0) return 0;
  if (loop) return ((index % frameCount) + frameCount) % frameCount;
  return Math.max(0, Math.min(frameCount - 1, index));
}

function applyFrame(index: number): void {
  if (!run || !moleculeGroup) return;
  frameIndex = normalizeFrameIndex(index);
  moleculeGenerator.updateMolecule(
    moleculeGroup,
    run,
    frameIndex,
    selectedSpecies,
    NODE_ID,
  );
}

function notifyComplete(delay = 0): void {
  if (!autoPlayOnce || completionNotified) return;
  completionNotified = true;

  if (delay > 0) {
    completionTimer = setTimeout(() => {
      completionTimer = null;
      onComplete();
    }, delay);
    return;
  }

  onComplete();
}

function advancePlaybackFrame(delta: number): void {
  if (!run || run.number_of_frames <= 1) return;

  const nextFrame = frameIndex + delta;
  if (!loop && nextFrame >= run.number_of_frames) {
    applyFrame(run.number_of_frames - 1);
    isPlaying = false;
    notifyComplete();
    return;
  }

  applyFrame(nextFrame);
}

function stepFrame(delta: number): void {
  if (!run) return;
  isPlaying = false;
  frameAccumulator = 0;
  applyFrame(frameIndex + delta);
}

function togglePlayback(): void {
  if (!run || run.number_of_frames <= 1) return;
  isPlaying = !isPlaying;
}

function adjustPlaybackSpeed(delta: number): void {
  playbackFps = Math.max(1, Math.min(60, playbackFps + delta));
}

function handleSpeedInput(event: Event): void {
  const input = event.currentTarget as HTMLInputElement;
  playbackFps = Number(input.value);
}

function getCameraDistance(): number {
  return Math.max(6, viewRadius * 2.8);
}

function getXrObjectDistance(): number {
  return Math.max(2.5, Math.min(8, viewRadius * 1.35));
}

function resetSceneRootForDesktop(): void {
  if (!sceneRoot) return;
  sceneRoot.position.set(0, 0, 0);
  sceneRoot.rotation.set(0, 0, 0);
  sceneRoot.scale.setScalar(1);
}

function resetSceneRootForXr(): void {
  if (!sceneRoot) return;
  sceneRoot.position.set(0, 0, -getXrObjectDistance());
  sceneRoot.rotation.set(0, 0, 0);
  sceneRoot.scale.setScalar(1);
}

function resetView(): void {
  if (isImmersive) {
    resetSceneRootForXr();
    return;
  }

  if (!camera || !orbitControls) return;

  resetSceneRootForDesktop();
  camera.position.set(0, 0, getCameraDistance());
  camera.lookAt(origin);
  camera.near = 0.01;
  camera.far = 1000;
  camera.updateProjectionMatrix();

  orbitControls.target.copy(origin);
  orbitControls.update();
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

function updateReferencePlane(): void {
  if (!referencePlane) return;
  referencePlane.position.y = -Math.max(viewRadius + 0.4, 3);
}

function applyEnvironmentForMode(): void {
  sceneBackground?.setTransparentBackground(activeXrMode === "immersive-ar");
  if (referencePlane) {
    referencePlane.visible = false;
  }
}

async function detectXrSupport(): Promise<void> {
  const xr = navigator.xr;
  if (!xr) return;

  try {
    hasVr = await xr.isSessionSupported("immersive-vr");
    hasAr = await xr.isSessionSupported("immersive-ar");
  } catch {
    hasVr = false;
    hasAr = false;
  }
}

function handleXrEnded(): void {
  if (currentSession) {
    currentSession.removeEventListener("end", handleXrEnded);
  }

  if (xrControls && scene) {
    scene.remove(xrControls.dolly);
  }

  xrControls = null;
  currentSession = null;
  activeXrMode = null;
  isImmersive = false;
  resetSceneRootForDesktop();

  if (orbitControls) {
    orbitControls.enabled = true;
  }

  applyEnvironmentForMode();
  resetView();
}

async function startXr(mode: XrMode): Promise<void> {
  const xr = navigator.xr;
  if (!renderer || !scene || !camera || !xr) return;

  xrError = "";

  try {
    const supported = await xr.isSessionSupported(mode);
    if (!supported) {
      xrError =
        mode === "immersive-ar"
          ? "AR is not available on this device."
          : "VR is not available on this device.";
      return;
    }

    const session = await xr.requestSession(mode, {
      optionalFeatures: ["local-floor", "bounded-floor"],
    });

    currentSession = session;
    activeXrMode = mode;
    isImmersive = true;
    renderer.xr.enabled = true;
    resetSceneRootForXr();
    applyEnvironmentForMode();

    await renderer.xr.setSession(session);

    if (orbitControls) {
      orbitControls.enabled = false;
    }

    const target = new Object3D();
    target.position.copy(origin);
    xrControls = new VRControls(
      renderer,
      scene,
      camera,
      target,
      undefined,
      getXrObjectDistance(),
      "object",
      sceneRoot ?? undefined,
    );
    xrControls.minDistance = 1.2;
    xrControls.maxDistance = 20;
    xrControls.rotationSpeed = 1.25;
    xrControls.onSelect = togglePlayback;
    xrControls.onAPressed = () => stepFrame(1);
    xrControls.onBPressed = () => stepFrame(-1);
    xrControls.onXPressed = () => adjustPlaybackSpeed(-1);
    xrControls.onYPressed = () => adjustPlaybackSpeed(1);

    session.addEventListener("end", handleXrEnded);
  } catch (error) {
    handleXrEnded();
    xrError = error instanceof Error ? error.message : "Unable to start WebXR.";
  }
}

function animate(time: number): void {
  if (!renderer || !scene || !camera) return;

  const deltaSeconds =
    lastAnimationTime === 0 ? 0 : (time - lastAnimationTime) / 1000;
  lastAnimationTime = time;

  if (isPlaying && run && run.number_of_frames > 1) {
    frameAccumulator += deltaSeconds * playbackFps;
    while (frameAccumulator >= 1) {
      advancePlaybackFrame(1);
      frameAccumulator -= 1;
    }
  }

  if (xrControls) {
    xrControls.update(deltaSeconds);
  } else {
    orbitControls?.update();
  }

  renderer.render(scene, camera);
}

onMount(() => {
  scene = new Scene();
  sceneRoot = new Group();
  sceneRoot.name = "Trajectory Object Stage";
  scene.add(sceneRoot);

  camera = new PerspectiveCamera(60, 1, 0.01, 1000);
  camera.position.set(0, 0, getCameraDistance());
  scene.add(camera);

  const ambientLight = new AmbientLight(0xffffff, 1.6);
  scene.add(ambientLight);

  const directionalLight = new DirectionalLight(0xffffff, 3.5);
  directionalLight.position.set(2, 4, 5);
  camera.add(directionalLight);

  referencePlane = new GridHelper(80, 80, 0x666666, 0xb8b8b8);
  referencePlane.visible = false;
  const referenceMaterials = Array.isArray(referencePlane.material)
    ? referencePlane.material
    : [referencePlane.material];
  referenceMaterials.forEach((material) => {
    material.transparent = true;
    material.opacity = 0.36;
  });
  updateReferencePlane();
  sceneRoot.add(referencePlane);

  renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(new Color(0xf0f0f0), 1);
  renderer.xr.enabled = true;
  sceneBackground = new HdrSceneBackground(scene, renderer);
  sceneBackground.load();
  applyEnvironmentForMode();

  orbitControls = new ObjectOrbitControls(camera, renderer.domElement, sceneRoot);
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.08;
  orbitControls.enablePan = true;
  orbitControls.target.copy(origin);

  resizeObserver = new ResizeObserver(updateSize);
  resizeObserver.observe(wrapper);
  updateSize();
  resetView();

  renderer.setAnimationLoop(animate);
  mounted = true;
  detectXrSupport();

  if (xyzText) {
    loadTrajectory(xyzText);
  }
});

onDestroy(() => {
  renderer?.setAnimationLoop(null);
  resizeObserver?.disconnect();
  orbitControls?.dispose();
  if (completionTimer) {
    clearTimeout(completionTimer);
    completionTimer = null;
  }
  if (playbackStartTimer) {
    clearTimeout(playbackStartTimer);
    playbackStartTimer = null;
  }
  if (currentSession) {
    currentSession.removeEventListener("end", handleXrEnded);
    currentSession.end().catch(() => {});
  }
  if (referencePlane) {
    referencePlane.geometry.dispose();
    const referenceMaterials = Array.isArray(referencePlane.material)
      ? referencePlane.material
      : [referencePlane.material];
    referenceMaterials.forEach((material) => material.dispose());
  }
  sceneBackground?.dispose();
  removeCurrentMolecule();
  renderer?.dispose();
});
</script>

<div class="viewer" bind:this={wrapper}>
  <canvas bind:this={canvas}></canvas>

  {#if showToolbar}
    <div class="toolbar">
      <div class="metadata">
        <strong>{fileName ?? "XYZ trajectory"}</strong>
        {#if run}
          <span>{run.number_of_atoms} atoms</span>
          <span>Frame {frameIndex + 1} / {run.number_of_frames}</span>
        {:else}
          <span>No trajectory loaded</span>
        {/if}
      </div>

      <div class="controls">
        <button type="button" on:click={() => stepFrame(-1)} disabled={!run}
          >Prev</button
        >
        <button
          type="button"
          on:click={togglePlayback}
          disabled={!run || run.number_of_frames <= 1}
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button type="button" on:click={() => stepFrame(1)} disabled={!run}
          >Next</button
        >
        <label>
          Speed
          <input
            type="range"
            min="1"
            max="60"
            step="1"
            value={playbackFps}
            on:input={handleSpeedInput}
            disabled={!run}
          />
          <span>{playbackFps} fps</span>
        </label>
        <label class="inline">
          <input type="checkbox" bind:checked={loop} disabled={!run} />
          Loop
        </label>
        <button type="button" on:click={resetView} disabled={!run}
          >Reset view</button
        >
      </div>

      <div class="xr-controls">
        {#if hasVr}
          <button
            type="button"
            on:click={() => startXr("immersive-vr")}
            disabled={isImmersive || !run}
          >
            Enter VR
          </button>
        {/if}
        {#if hasAr}
          <button
            type="button"
            on:click={() => startXr("immersive-ar")}
            disabled={isImmersive || !run}
          >
            Enter AR
          </button>
        {/if}
        {#if isImmersive}
          <span
            >{activeXrMode === "immersive-ar" ? "AR active" : "VR active"}</span
          >
        {/if}
      </div>
    </div>
  {/if}

  {#if errorMessage || xrError}
    <div class="message">
      {errorMessage || xrError}
    </div>
  {/if}
</div>

<style>
.viewer {
  position: relative;
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background: #f0f0f0;
  font-family: "Quicksand", sans-serif;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.toolbar {
  position: absolute;
  left: 16px;
  right: 16px;
  bottom: 16px;
  display: grid;
  grid-template-columns: minmax(180px, 1fr) auto auto;
  gap: 12px;
  align-items: center;
  padding: 12px;
  border: 1px solid #d7d7d7;
  border-radius: 1rem;
  background: #ffffff;
  color: #000000;
  box-shadow: rgba(149, 157, 165, 0.2) 0px 8px 24px;
}

.metadata,
.controls,
.xr-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.metadata {
  flex-wrap: wrap;
}

.metadata strong {
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.metadata span,
.xr-controls span,
.controls span {
  color: #333333;
  font-size: 0.95rem;
}

button,
label {
  font-family: "Quicksand", sans-serif;
  font-size: 1rem;
}

button {
  border: 1px solid #000000;
  border-radius: 0.4rem;
  background: #ffffff;
  color: #000000;
  padding: 0.45rem 0.7rem;
  cursor: pointer;
}

button:hover:not(:disabled) {
  background: #f0f0f0;
}

button:disabled,
input:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}

label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: #000000;
}

input[type="range"] {
  width: 120px;
  accent-color: #000000;
}

.inline {
  gap: 6px;
}

.message {
  position: absolute;
  top: 16px;
  left: 50%;
  max-width: min(520px, calc(100% - 32px));
  transform: translateX(-50%);
  padding: 0.75rem 1rem;
  border: 1px solid rgba(185, 28, 28, 0.25);
  border-radius: 0.5rem;
  background: #fff7f7;
  color: #7f1d1d;
  box-shadow: rgba(149, 157, 165, 0.2) 0px 8px 24px;
}

@media (max-width: 900px) {
  .toolbar {
    grid-template-columns: 1fr;
  }

  .controls,
  .xr-controls {
    flex-wrap: wrap;
  }
}

@media (max-width: 560px) {
  .toolbar {
    left: 8px;
    right: 8px;
    bottom: 8px;
  }

  .metadata strong {
    max-width: 220px;
  }

  input[type="range"] {
    width: 90px;
  }
}
</style>
