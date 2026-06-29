<script lang="ts">
import {
  StandaloneTrajectoryViewer,
  type TrajectoryViewerState,
} from "$lib/rendering/TrajectoryViewer.js";
import { onDestroy, onMount } from "svelte";

export let canvas: HTMLCanvasElement;
export let wrapper: HTMLElement;
export let xyzText: string;
export let fileName: string | undefined = undefined;
export let initialFps = 30;
export let showToolbar = true;
export let autoPlayOnce = false;
export let autoPlayDelayMs = 0;
export let onComplete: () => void = () => {};

let viewer: StandaloneTrajectoryViewer | null = null;
let mounted = false;
let loadedText = "";

let state: TrajectoryViewerState = {
  run: null,
  frameIndex: 0,
  playbackFps: initialFps,
  isPlaying: false,
  loop: true,
  hasVr: false,
  hasAr: false,
  isImmersive: false,
  activeXrMode: null,
  errorMessage: "",
  xrError: "",
};

$: if (mounted && !viewer && canvas && wrapper) {
  createViewer();
}

$: if (viewer && xyzText !== loadedText) {
  loadTrajectory(xyzText);
}

function updateState(nextState: TrajectoryViewerState): void {
  state = nextState;
}

function createViewer(): void {
  viewer = new StandaloneTrajectoryViewer({
    canvas,
    wrapper,
    initialFps,
    autoPlayOnce,
    autoPlayDelayMs,
    onComplete,
    onStateChange: updateState,
  });

  if (xyzText) {
    loadTrajectory(xyzText);
  }
}

function loadTrajectory(text: string): void {
  loadedText = text;
  viewer?.loadXyzText(text);
}

function stepFrame(delta: number): void {
  viewer?.stepFrame(delta);
}

function togglePlayback(): void {
  viewer?.togglePlayback();
}

function handleSpeedInput(event: Event): void {
  const input = event.currentTarget as HTMLInputElement;
  viewer?.setPlaybackFps(Number(input.value));
}

function handleLoopInput(event: Event): void {
  const input = event.currentTarget as HTMLInputElement;
  viewer?.setLoop(input.checked);
}

function resetView(): void {
  viewer?.resetView();
}

function startVr(): void {
  viewer?.startXr("immersive-vr");
}

function startAr(): void {
  viewer?.startXr("immersive-ar");
}

onMount(() => {
  mounted = true;
});

onDestroy(() => {
  viewer?.dispose();
  viewer = null;
});
</script>

<div class="viewer-ui">
  {#if showToolbar}
    <div class="toolbar">
      <div class="metadata">
        <strong>{fileName ?? "XYZ trajectory"}</strong>
        {#if state.run}
          <span>{state.run.number_of_atoms} atoms</span>
          <span>Frame {state.frameIndex + 1} / {state.run.number_of_frames}</span>
        {:else}
          <span>No trajectory loaded</span>
        {/if}
      </div>

      <div class="controls">
        <button type="button" on:click={() => stepFrame(-1)} disabled={!state.run}
          >Prev</button
        >
        <button
          type="button"
          on:click={togglePlayback}
          disabled={!state.run || state.run.number_of_frames <= 1}
        >
          {state.isPlaying ? "Pause" : "Play"}
        </button>
        <button type="button" on:click={() => stepFrame(1)} disabled={!state.run}
          >Next</button
        >
        <label>
          Speed
          <input
            type="range"
            min="1"
            max="60"
            step="1"
            value={state.playbackFps}
            on:input={handleSpeedInput}
            disabled={!state.run}
          />
          <span>{state.playbackFps} fps</span>
        </label>
        <label class="inline">
          <input
            type="checkbox"
            checked={state.loop}
            on:change={handleLoopInput}
            disabled={!state.run}
          />
          Loop
        </label>
        <button type="button" on:click={resetView} disabled={!state.run}
          >Reset view</button
        >
      </div>

      <div class="xr-controls">
        {#if state.hasVr}
          <button
            type="button"
            on:click={startVr}
            disabled={state.isImmersive || !state.run}
          >
            Enter VR
          </button>
        {/if}
        {#if state.hasAr}
          <button
            type="button"
            on:click={startAr}
            disabled={state.isImmersive || !state.run}
          >
            Enter AR
          </button>
        {/if}
        {#if state.isImmersive}
          <span
            >{state.activeXrMode === "immersive-ar"
              ? "AR active"
              : "VR active"}</span
          >
        {/if}
      </div>
    </div>
  {/if}

  {#if state.errorMessage || state.xrError}
    <div class="message">
      {state.errorMessage || state.xrError}
    </div>
  {/if}
</div>

<style>
.viewer-ui {
  position: absolute;
  inset: 0;
  pointer-events: none;
  font-family: "Quicksand", sans-serif;
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
  pointer-events: auto;
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
  pointer-events: none;
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
