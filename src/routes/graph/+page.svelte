<script lang="ts">
import type { Graph } from "ngraph.graph";
import GraphElement from "$lib/graphs/Graph.svelte";
import { createGraphFromString } from "$lib/graphs/graphs";
import { chemkinFileToGraph, parseChemkinFile } from "$lib/files/chemkin";
import { onMount } from "svelte";
let loadedGraph = false;
let graph: Graph;
let xyzPath = "";
let useHash = false;
let xyzFiles: Map<string, File> | null = null;
let startSpecies = new Array<string>();

const startingSpeciesMap = new Map<string, Array<string>>();
startingSpeciesMap.set("GKHP", ["gamma-Ketohydroperoxide"]);
startingSpeciesMap.set("isooctane", ["CC(C)CC(C)(C)C"]);
startingSpeciesMap.set("jam", ["[H][S][H]{0,1}", "[H][O]{0,2}"]);

async function loadGraph(graphName: string) {
  const jsongraphs = ["GKHP", "isooctane", "jam"];
  if (jsongraphs.includes(graphName)) {
    await fetch(`/graphs/${graphName}/graph.json`)
      .then((response) => response.text())
      .then((text) => {
        graph = createGraphFromString(text);
        xyzPath = `/graphs/${graphName}/`;
      });
  }
  if ("aramco" === graphName) {
    await fetch(`/graphs/aramco/AramcoMech2.0.mech`)
      .then((response) => response.text())
      .then((text) => {
        const chemkin = parseChemkinFile(text);
        graph = chemkinFileToGraph(chemkin);
        xyzPath = "/graphs/aramco/structures/";
      });
  }

  if ("gri" === graphName) {
    await fetch(`/graphs/gri/grimech30.dat`)
      .then((response) => response.text())
      .then((text) => {
        const chemkin = parseChemkinFile(text);
        graph = chemkinFileToGraph(chemkin);
        xyzPath = "/graphs/aramco/structures/";
      });
  }
  startSpecies = startingSpeciesMap.get(graphName) || [];
}

onMount(async () => {
  // get url search params
  const urlParams = new URLSearchParams(window.location.search);
  const graphParam = urlParams.get("graph");
  if (graphParam) {
    console.log(graphParam);
    await loadGraph(graphParam);
    loadedGraph = true;
  }
});
</script>

<h1>Autograph</h1>

{#if loadedGraph}
  <GraphElement {graph} {xyzPath} {useHash} {xyzFiles} {startSpecies} />
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

* {
  font-family: "Quicksand", sans-serif;
  font-size: 1.2rem;
}

.page {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background-color: #f0f0f0;
  gap: 1rem;
}

h1 {
  position: absolute;
  top: 0px;
  left: 0px;
  margin: 15px;
  padding: 0px;
  font-size: 2em;
  font-family: "Quicksand-Bold", sans-serif;
  font-weight: 400;
  color: #000000;
  z-index: 100;
  pointer-events: none;
}

.ownDataset {
  width: 100%;
}

.center {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.center input {
  width: 40%;
}

.center label {
  display: inline-block;
  margin: 0px;
  padding: 0px;
  width: 40%;
  text-align: right;
  padding-right: 0.5rem;
}
</style>
