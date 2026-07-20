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
    fadeInDelayMs?: number,
  ): string[];
};

const TUTORIAL_START_SPECIES = ["O=O"];
const TUTORIAL_NITROGEN_SPECIES = "NttN";
const TUTORIAL_ATOMIC_OXYGEN_SPECIES = "[O]";
const TUTORIAL_WATER_SPECIES = "O";
const TUTORIAL_UNLOCK_FADE_MS = 650;
const TUTORIAL_UNLOCK_FADE_DELAY_MS = 1000;

let graph: NGraph;
let graphLoaded = false;
let graphController: GraphController | undefined;
let tutorialNitrogenUnlocked = false;
let tutorialWaterUnlocked = false;

function hasExactSelection(
  selectedSpecies: readonly string[],
  requiredSpecies: readonly string[],
): boolean {
  if (selectedSpecies.length !== requiredSpecies.length) return false;

  const selection = new Set(selectedSpecies);
  return (
    selection.size === requiredSpecies.length &&
    requiredSpecies.every((speciesId) => selection.has(speciesId))
  );
}

function revealTutorialSpecies(speciesIds: readonly string[]): void {
  graphController?.addInitialSpecies(
    speciesIds,
    TUTORIAL_UNLOCK_FADE_MS,
    TUTORIAL_UNLOCK_FADE_DELAY_MS,
  );
}

function handleGraphEvent(event: GraphEvent): void {
  if (event.type === "reset") {
    tutorialNitrogenUnlocked = false;
    tutorialWaterUnlocked = false;
    return;
  }

  if (event.type !== "layer-added" || !graphController) return;

  if (
    !tutorialNitrogenUnlocked &&
    hasExactSelection(event.selectedSpecies, TUTORIAL_START_SPECIES)
  ) {
    tutorialNitrogenUnlocked = true;
    revealTutorialSpecies([TUTORIAL_NITROGEN_SPECIES]);
    return;
  }

  if (
    tutorialNitrogenUnlocked &&
    !tutorialWaterUnlocked &&
    hasExactSelection(event.selectedSpecies, [
      TUTORIAL_NITROGEN_SPECIES,
      TUTORIAL_ATOMIC_OXYGEN_SPECIES,
    ])
  ) {
    tutorialWaterUnlocked = true;
    revealTutorialSpecies([TUTORIAL_WATER_SPECIES]);
  }
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
