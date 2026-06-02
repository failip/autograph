<script lang="ts">
import TrajectoryViewer from "$lib/rendering/TrajectoryViewer.svelte";
import { onMount } from "svelte";

const AUTO_LOAD_DEFAULT = true;
const DEFAULT_FILE = "Run1.xyz";

let xyzText = "";
let fileName = "";
let errorMessage = "";
let isDragging = false;
let urlInput = "";

async function fetchAndLoad(resource: string): Promise<void> {
  if (!resource) return;

  const fetchUrl =
    /^https?:\/\//i.test(resource) || resource.startsWith("/")
      ? resource
      : `/trajectory/${resource}`;

  try {
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const text = await response.text();
    xyzText = text;
    fileName = resource;
    errorMessage = "";
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Unable to load file from URL.";
  }
}

async function loadFile(file: File | undefined): Promise<void> {
  if (!file) return;

  if (!file.name.toLowerCase().endsWith(".xyz")) {
    errorMessage = "Choose an .xyz trajectory file.";
    return;
  }

  try {
    xyzText = await file.text();
    fileName = file.name;
    errorMessage = "";
  } catch (error) {
    errorMessage =
      error instanceof Error ? error.message : "Unable to read this file.";
  }
}

async function loadFromUrl(): Promise<void> {
  if (!urlInput) return;
  await fetchAndLoad(urlInput);
}

function handleFileInput(event: Event): void {
  const input = event.currentTarget as HTMLInputElement;
  loadFile(input.files?.[0]);
  input.value = "";
}

function handleDragEnter(event: DragEvent): void {
  event.preventDefault();
  isDragging = true;
}

function handleDragOver(event: DragEvent): void {
  event.preventDefault();
  isDragging = true;
}

function handleDragLeave(event: DragEvent): void {
  event.preventDefault();
  isDragging = false;
}

function handleDrop(event: DragEvent): void {
  event.preventDefault();
  isDragging = false;
  loadFile(event.dataTransfer?.files?.[0]);
}

onMount(() => {
  try {
    const url = new URL(window.location.href);
    const fileParam = url.searchParams.get("file");
    if (fileParam && fileParam.toLowerCase().endsWith(".xyz")) {
      urlInput = fileParam;
      fetchAndLoad(fileParam);
      return;
    }

    const pathname = url.pathname;
    const match = pathname.match(/\/trajectory\/(.+\.xyz)$/i);
    if (match) {
      const pathFile = decodeURIComponent(match[1]);
      urlInput = pathFile;
      fetchAndLoad(pathFile);
      return;
    }

    if (AUTO_LOAD_DEFAULT) {
      urlInput = DEFAULT_FILE;
      fetchAndLoad(DEFAULT_FILE);
    }
  } catch {
    // Ignore malformed URLs or environments without window.
  }
});
</script>

<h1>Autograph</h1>

{#if xyzText}
  <TrajectoryViewer {xyzText} {fileName} />
  <label class="open-file loaded">
    Open XYZ
    <input
      type="file"
      accept=".xyz,chemical/x-xyz,text/plain"
      on:change={handleFileInput}
    />
  </label>
{:else}
  <main
    class="page"
    class:dragging={isDragging}
    on:dragenter={handleDragEnter}
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
  >
    <section class="drop-zone">
      <div>
        <p class="eyebrow">XYZ trajectory viewer</p>
        <h2>Drop a molecular dynamics .xyz file</h2>
        <p class="copy">
          Load a multi-frame XYZ trajectory, play it on the desktop canvas, then
          enter VR or AR when your device supports WebXR.
        </p>
      </div>

      <label class="open-file">
        Choose XYZ
        <input
          type="file"
          accept=".xyz,chemical/x-xyz,text/plain"
          on:change={handleFileInput}
        />
      </label>

      <div class="url-input-container">
        <input
          type="text"
          bind:value={urlInput}
          placeholder="Or enter a URL (e.g., Run1.xyz)"
          class="url-input"
        />
        <button on:click={loadFromUrl} class="load-url-button">
          Load from URL
        </button>
      </div>

      {#if errorMessage}
        <p class="error">{errorMessage}</p>
      {/if}
    </section>
  </main>
{/if}

<style>
@font-face {
  font-family: "Quicksand-Bold";
  src:
    url("/fonts/Quicksand-Bold.woff2") format("woff2"),
    url("/fonts/Quicksand-Bold.woff") format("woff"),
    url("/fonts/Quicksand-Bold.ttf") format("truetype");

  font-weight: normal;
  font-style: normal;
}

@font-face {
  font-family: "Quicksand";
  src:
    url("/fonts/Quicksand-Regular.woff2") format("woff2"),
    url("/fonts/Quicksand-Regular.woff") format("woff"),
    url("/fonts/Quicksand-Regular.ttf") format("truetype");

  font-weight: normal;
  font-style: normal;
}

:global(body) {
  margin: 0;
  background: #f0f0f0;
  font-family: "Quicksand", sans-serif;
}

.page {
  display: flex;
  min-height: 100vh;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background-color: #f0f0f0;
  color: #000000;
}

h1 {
  position: absolute;
  top: 0px;
  left: 0px;
  z-index: 100;
  margin: 15px;
  padding: 0px;
  color: #000000;
  font-family: "Quicksand-Bold", sans-serif;
  font-size: 2em;
  font-weight: 400;
  pointer-events: none;
}

.drop-zone {
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  min-height: 360px;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  padding: 36px;
  border: 2px dashed #b5b5b5;
  border-radius: 1rem;
  background: #ffffff;
  text-align: center;
  box-shadow: rgba(149, 157, 165, 0.2) 0px 8px 24px;
}

.page.dragging .drop-zone {
  border-color: #000000;
  background: #fafafa;
}

.eyebrow {
  margin: 0 0 0.5rem;
  color: #555555;
  font-size: 1rem;
}

h2 {
  margin: 0;
  font-family: "Quicksand-Bold", sans-serif;
  font-size: clamp(1.8rem, 5vw, 3rem);
  font-weight: 400;
  letter-spacing: 0;
}

.copy {
  max-width: 560px;
  margin: 1rem auto 0;
  color: #333333;
  font-size: 1.1rem;
  line-height: 1.5;
}

.open-file {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid #000000;
  border-radius: 0.4rem;
  background: #ffffff;
  color: #000000;
  font: inherit;
  font-family: "Quicksand", sans-serif;
  font-size: 1.1rem;
  cursor: pointer;
}

.open-file:hover {
  background: #f0f0f0;
}

.open-file input {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
}

.open-file.loaded {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 10;
  box-shadow: rgba(149, 157, 165, 0.2) 0px 8px 24px;
}

.url-input-container {
  display: flex;
  gap: 0.5rem;
  margin-top: 1rem;
  width: 100%;
  max-width: 400px;
}

.url-input {
  flex-grow: 1;
  padding: 0.5rem 1rem;
  border: 1px solid #b5b5b5;
  border-radius: 0.4rem;
  font-family: "Quicksand", sans-serif;
  font-size: 1rem;
}

.load-url-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid #000000;
  border-radius: 0.4rem;
  background: #000000;
  color: #ffffff;
  font: inherit;
  font-family: "Quicksand", sans-serif;
  font-size: 1.1rem;
  cursor: pointer;
}

.load-url-button:hover {
  background: #333333;
}

.error {
  margin: 0;
  color: #991b1b;
  font-size: 1rem;
}

@media (max-width: 560px) {
  .page {
    padding: 12px;
  }

  .drop-zone {
    min-height: 320px;
    padding: 24px;
  }
}
</style>
