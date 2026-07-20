<script lang="ts">
import Graph from "$lib/graphs/Graph.svelte";
import type { GraphEvent } from "$lib/graphs/graph-events";
import { createGraphFromString } from "$lib/graphs/graphs";
import { onMount } from "svelte";
import type { Graph as NGraph } from "ngraph.graph";

type GraphController = {
  addInitialSpecies(
    speciesIds: readonly string[],
    fadeInDurationMs?: number,
  ): string[];
};

const TUTORIAL_START_SPECIES = ["O=O"];
const TUTORIAL_UNLOCK_SPECIES = ["NttN", "O"];
const TUTORIAL_UNLOCK_FADE_MS = 650;

let graph: NGraph;
let graphLoaded = false;
let graphController: GraphController | undefined;
let tutorialSpeciesUnlocked = false;

function handleGraphEvent(event: GraphEvent): void {
  if (event.type === "reset") {
    tutorialSpeciesUnlocked = false;
    return;
  }

  if (
    event.type !== "layer-added" ||
    tutorialSpeciesUnlocked ||
    event.selectedSpecies.length !== 1 ||
    event.selectedSpecies[0] !== TUTORIAL_START_SPECIES[0] ||
    !graphController
  ) {
    return;
  }

  tutorialSpeciesUnlocked = true;
  graphController.addInitialSpecies(
    TUTORIAL_UNLOCK_SPECIES,
    TUTORIAL_UNLOCK_FADE_MS,
  );
}

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
    bind:this={graphController}
    {graph}
    webXR={true}
    xyzPath="/graphs/AtmosphereReduced/xyz_species/"
    startSpecies={TUTORIAL_START_SPECIES}
    onGraphEvent={handleGraphEvent}
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
