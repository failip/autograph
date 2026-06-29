<script lang="ts">
import Graph from "$lib/graphs/Graph.svelte";
import { createGraphFromString } from "$lib/graphs/graphs";
import { onMount } from "svelte";

let graph;
let graphLoaded = false;

onMount(async () => {
  try {
    const response = await fetch(
      "/graphs/AtmosphereReduced/atmosphere_nox_reduced.json",
    );
    const text = await response.text();
    graph = createGraphFromString(text);
    graphLoaded = true;
  } catch (error) {
    console.error("Failed to load AtmosphereReduced graph data:", error);
  }
});
</script>

{#if graphLoaded}
  <Graph
    {graph}
    webXR={true}
    xyzPath="/graphs/AtmosphereReduced/xyz_species/"
    startSpecies={["O=O", "N#N"]}
  />
{:else}
  <div class="loading">
    <p>Loading AtmosphereReduced graph for VR...</p>
  </div>
{/if}

<style>
.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 100vh;
  font-family: sans-serif;
}
</style>
