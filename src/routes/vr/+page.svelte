<script lang="ts">
import Graph from "$lib/graphs/Graph.svelte";
import type { GraphEvent } from "$lib/graphs/graph-events";
import { createGraphFromString, mergeGraphs } from "$lib/graphs/graphs";
import { onMount } from "svelte";
import type { Graph as NGraph } from "ngraph.graph";

type GraphController = {
  addInitialSpecies(
    speciesIds: readonly string[],
    fadeInDurationMs?: number,
    fadeInDelayMs?: number,
  ): string[];
  addGraphContent(
    nodeIds: readonly string[],
    fadeInDurationMs?: number,
    fadeInDelayMs?: number,
  ): string[];
};

const TUTORIAL_START_SPECIES = ["O=O"];
const TUTORIAL_NITROGEN_SPECIES = "NttN";
const TUTORIAL_ATOMIC_OXYGEN_SPECIES = "[O]";
const TUTORIAL_WATER_SPECIES = "O";
const TUTORIAL_COMPLETION_SPECIES = "O[N+](=O)[O-]";
const TUTORIAL_UNLOCK_FADE_MS = 650;
const TUTORIAL_UNLOCK_FADE_DELAY_MS = 1000;
const SHOW_FULL_EXTENDED_NETWORK_ON_COMPLETION = true;
const EXTENDED_NETWORK_FADE_MS = 900;

let graph: NGraph;
let graphLoaded = false;
let graphController: GraphController | undefined;
let extendedNetworkNodeIds: string[] = [];
let deferredNetworkNodeIds: string[] = [];
let tutorialNitrogenUnlocked = false;
let tutorialWaterUnlocked = false;
let tutorialExtendedNetworkUnlocked = false;

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
    tutorialExtendedNetworkUnlocked = false;
    return;
  }

  if (event.type !== "layer-added" || !graphController) return;

  if (
    !tutorialExtendedNetworkUnlocked &&
    event.addedNodeIds.includes(TUTORIAL_COMPLETION_SPECIES)
  ) {
    tutorialExtendedNetworkUnlocked = true;
    if (SHOW_FULL_EXTENDED_NETWORK_ON_COMPLETION) {
      graphController.addGraphContent(
        extendedNetworkNodeIds,
        EXTENDED_NETWORK_FADE_MS,
      );
    }
    return;
  }

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
    const [tutorialResponse, extendedResponse] = await Promise.all([
      fetch("/graphs/AtmosphereReduced/atmosphere_nox_reduced.json"),
      fetch(
        "/graphs/AtmosphereReduced/extended/hno_reaction_graph_smiles.json",
      ),
    ]);
    if (!tutorialResponse.ok || !extendedResponse.ok) {
      throw new Error("A tutorial graph file could not be loaded.");
    }

    const tutorialGraph = createGraphFromString(await tutorialResponse.text());
    const extendedGraph = createGraphFromString(await extendedResponse.text());
    const tutorialNodeIds = new Set<string>();
    tutorialGraph.forEachNode((node) => {
      tutorialNodeIds.add(String(node.id));
    });
    extendedGraph.forEachNode((node) => {
      extendedNetworkNodeIds.push(String(node.id));
    });
    deferredNetworkNodeIds = extendedNetworkNodeIds.filter(
      (nodeId) => !tutorialNodeIds.has(nodeId),
    );
    graph = mergeGraphs([tutorialGraph, extendedGraph]);
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
    xyzFallbackPaths={["/graphs/AtmosphereReduced/extended/xyz_species/"]}
    deferredNodeIds={deferredNetworkNodeIds}
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
