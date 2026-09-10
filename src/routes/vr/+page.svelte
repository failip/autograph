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
  enableGraphNodes(nodeIds: readonly string[]): string[];
  celebrateDiscovery(): void;
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
const REACTION_VIEWING_QUERY_PARAMETER = "reactionViewing";

let graph: NGraph;
let graphLoaded = false;
let loadError = "";
let reactionTrajectoryPlaybackEnabled = true;
let graphController: GraphController | undefined;
let extendedNetworkNodeIds: string[] = [];
let deferredNetworkNodeIds: string[] = [];
let tutorialNitrogenUnlocked = false;
let tutorialWaterUnlocked = false;
let tutorialCompletionSpeciesReached = false;
let tutorialExtendedNetworkPrimed = false;
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
    tutorialCompletionSpeciesReached = false;
    tutorialExtendedNetworkPrimed = false;
    tutorialExtendedNetworkUnlocked = false;
    return;
  }

  if (!graphController) return;

  if (event.type === "layer-requested") {
    if (
      tutorialCompletionSpeciesReached &&
      !tutorialExtendedNetworkUnlocked &&
      hasExactSelection(event.selectedSpecies, [TUTORIAL_COMPLETION_SPECIES])
    ) {
      graphController.enableGraphNodes(extendedNetworkNodeIds);
      tutorialExtendedNetworkPrimed = true;
    }
    return;
  }

  if (event.type !== "layer-added") return;

  if (
    !tutorialCompletionSpeciesReached &&
    event.addedNodeIds.includes(TUTORIAL_COMPLETION_SPECIES)
  ) {
    tutorialCompletionSpeciesReached = true;
    graphController.celebrateDiscovery();
    return;
  }

  if (
    tutorialExtendedNetworkPrimed &&
    !tutorialExtendedNetworkUnlocked &&
    hasExactSelection(event.selectedSpecies, [TUTORIAL_COMPLETION_SPECIES])
  ) {
    tutorialExtendedNetworkPrimed = false;
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
    reactionTrajectoryPlaybackEnabled =
      new URLSearchParams(window.location.search).get(
        REACTION_VIEWING_QUERY_PARAMETER,
      ) !== "false";

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
    loadError = navigator.onLine
      ? "The reaction network could not be loaded. Please try again."
      : "This reaction network is not saved offline yet. Connect to the internet and open it to save a copy.";
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
    {reactionTrajectoryPlaybackEnabled}
    onGraphEvent={handleGraphEvent}
  />
{:else}
  <div class="loading">
    {#if loadError}
      <p role="alert">{loadError}</p>
      <button onclick={() => window.location.reload()}>Try again</button>
      <a href="/">Back to Autograph</a>
    {:else}
      <p>Loading AtmosphereReduced graph for VR...</p>
    {/if}
  </div>
{/if}

<style>
.loading {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px;
  box-sizing: border-box;
  text-align: center;
  justify-content: center;
  align-items: center;
  height: 100vh;
  font-family: sans-serif;
}
</style>
