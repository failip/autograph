<script lang="ts">
import GltfViewer from "$lib/rendering/GltfViewer.svelte";
import { onMount } from "svelte";

const DEFAULT_MODEL_PATH = "/tasks/PES.gltf";

let modelPath = DEFAULT_MODEL_PATH;

function resolveModelPath(path: string): string {
  if (/^https?:\/\//i.test(path) || path.startsWith("/")) {
    return path;
  }

  return `/tasks/${path}`;
}

onMount(() => {
  try {
    const url = new URL(window.location.href);
    const modelParam = url.searchParams.get("model")?.trim();
    if (modelParam) {
      modelPath = resolveModelPath(modelParam);
    }
  } catch {
    // Ignore malformed URLs or environments without window.
  }
});
</script>

<GltfViewer {modelPath} modelName="PES" />
