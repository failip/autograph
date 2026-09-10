<script lang="ts">
import { dev } from "$app/environment";
import { base } from "$app/paths";
import { page } from "$app/stores";
import { onMount } from "svelte";

type InstallPrompt = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let installPrompt: InstallPrompt | null = null;
let standalone = false;
let appleMobile = false;
let offline = false;
let offlineReady = false;
let updateReady = false;
let updateDismissed = false;
let installing = false;

$: isHome = $page.url.pathname === `${base}/` || $page.url.pathname === base;
$: showInstall = isHome && !standalone && (installPrompt || appleMobile);

async function install(): Promise<void> {
  if (!installPrompt) return;
  const prompt = installPrompt;
  installPrompt = null;
  installing = true;
  try {
    await prompt.prompt();
    await prompt.userChoice;
  } catch {
    // The browser's own installation menu remains available.
  } finally {
    installing = false;
  }
}

onMount(() => {
  const cleanup: Array<() => void> = [];
  let disposed = false;
  let registration: ServiceWorkerRegistration | undefined;
  let lastUpdateCheck = 0;
  const displayMode = window.matchMedia("(display-mode: standalone)");
  const updateDisplayMode = () => {
    standalone = displayMode.matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
  };
  updateDisplayMode();
  appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  offline = !navigator.onLine;

  const checkForUpdate = () => {
    if (document.visibilityState !== "visible" || !navigator.onLine ||
      Date.now() - lastUpdateCheck < 60_000) return;
    lastUpdateCheck = Date.now();
    void registration?.update().catch(() => {});
  };
  const updateConnection = () => {
    offline = !navigator.onLine;
    if (!offline) checkForUpdate();
  };
  const beforeInstall = (event: Event) => {
    event.preventDefault();
    installPrompt = event as InstallPrompt;
  };
  const appInstalled = () => {
    installPrompt = null;
    standalone = true;
  };

  window.addEventListener("beforeinstallprompt", beforeInstall);
  window.addEventListener("appinstalled", appInstalled);
  window.addEventListener("online", updateConnection);
  window.addEventListener("offline", updateConnection);
  document.addEventListener("visibilitychange", checkForUpdate);
  displayMode.addEventListener("change", updateDisplayMode);

  if (!dev && window.isSecureContext && "serviceWorker" in navigator) {
    offlineReady = Boolean(navigator.serviceWorker.controller);
    void navigator.serviceWorker.register(`${base}/service-worker.js`, { updateViaCache: "none" })
      .then(async (result) => {
        if (disposed) return;
        registration = result;
        const checkWaiting = () => {
          if (result.waiting && navigator.serviceWorker.controller) {
            updateReady = true;
          }
        };
        const watchInstalling = () => {
          const worker = result.installing;
          if (!worker) return;
          worker.addEventListener("statechange", checkWaiting);
          cleanup.push(() => worker.removeEventListener("statechange", checkWaiting));
        };
        result.addEventListener("updatefound", watchInstalling);
        cleanup.push(() => result.removeEventListener("updatefound", watchInstalling));
        watchInstalling();
        checkWaiting();
        await navigator.serviceWorker.ready;
        if (!disposed) offlineReady = true;
      })
      .catch((error) => console.warn("Offline support could not be enabled:", error));
  }

  return () => {
    disposed = true;
    cleanup.forEach((remove) => remove());
    window.removeEventListener("beforeinstallprompt", beforeInstall);
    window.removeEventListener("appinstalled", appInstalled);
    window.removeEventListener("online", updateConnection);
    window.removeEventListener("offline", updateConnection);
    document.removeEventListener("visibilitychange", checkForUpdate);
    displayMode.removeEventListener("change", updateDisplayMode);
  };
});
</script>

{#if offline || (updateReady && !updateDismissed) || showInstall || (isHome && offlineReady)}
  <aside class="pwa-status" class:in-view={!isHome} aria-label="App availability">
    <div role="status">
      {#if offline}
        <p>{offlineReady
          ? "You’re offline. Default views and local trajectory files are available."
          : "You’re offline. Reconnect to finish saving the app for offline use."}</p>
      {:else if isHome && offlineReady}
        <p>App ready offline. Reaction networks, PES, and trajectories are saved.</p>
      {/if}
    </div>

    {#if updateReady && !updateDismissed}
      <div class="update">
        <p role="status">An update is ready. Close all Autograph tabs and windows, then reopen the app to use it.</p>
        <button class="dismiss" aria-label="Dismiss update notice" onclick={() => updateDismissed = true}>×</button>
      </div>
    {/if}

    {#if showInstall}
      {#if installPrompt}
        <button class="install" onclick={install} disabled={installing}>Install Autograph</button>
      {:else if appleMobile}
        <details>
          <summary>Install Autograph</summary>
          <p>In Safari, open Share and choose Add to Home Screen.</p>
        </details>
      {/if}
    {/if}
  </aside>
{/if}

<style>
.pwa-status {
  position: fixed;
  bottom: max(20px, env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
  box-sizing: border-box;
  width: max-content;
  max-width: min(440px, calc(100vw - 32px));
  padding: 12px 16px;
  border: 1px solid #d8d8d8;
  border-radius: 14px;
  background: #fafafa;
  color: #333;
  font-family: "Quicksand", sans-serif;
  font-size: 0.875rem;
  line-height: 1.5;
  text-align: center;
  box-shadow: 0 4px 18px #0000000a;
}

p { margin: 0; }
.pwa-status.in-view {
  top: calc(80px + env(safe-area-inset-top));
  bottom: auto;
}
.update { display: flex; align-items: start; gap: 8px; }
.update:not(:first-child) { margin-top: 8px; }
button, summary { font: inherit; cursor: pointer; }
button:focus-visible, summary:focus-visible { outline: 2px solid #333; outline-offset: 4px; }
.install { padding: 8px 16px; border: 0; border-radius: 8px; background: #222; color: #fff; }
div:has(p) ~ .install, div:has(p) ~ details { margin-top: 10px; }
.install:hover { background: #444; }
.install:disabled { cursor: wait; opacity: 0.6; }
.dismiss { padding: 0 4px; border: 0; background: transparent; color: #555; font-size: 1.25rem; }
summary { font-weight: bold; }
details p { margin-top: 8px; }
</style>
