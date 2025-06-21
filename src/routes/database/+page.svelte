<script lang="ts">
import { onMount } from "svelte";
import GraphElement from "$lib/graphs/Graph.svelte";
import { createGraphFromString } from "$lib/graphs/graphs";
import type { Graph } from "ngraph.graph";
let loadedGraph = false;
let graph: Graph;
let xyzPath = "";
let useHash = false;
let xyzFiles: Map<string, File> | null = null;
let startSpecies = new Array<string>();
let databaseURL = "https://autograph.kuboth.dev";

let databaseList: Promise<string[]> = fetch(databaseURL + "/api/database_list")
  .then((response) => response.json())
  .then((data) => {
    return data["database_list"];
  });

async function loadGraph(graphName: string) {
  const created = await fetch(`${databaseURL}/api/create_graph/${graphName}`, {
    method: "POST",
  });
  if (!created.ok) {
    console.error("Failed to create graph");
    return;
  }

  graph = await fetch(`${databaseURL}/${graphName}/${graphName}/graph.json`)
    .then((response) => response.text())
    .then((text) => {
      const graph = createGraphFromString(text);
      graph.forEachNode((node) => {
        if (node.data.type === "species") {
          startSpecies.push(node.id);
        }
      });
      useHash = true;
      xyzPath = `${databaseURL}/${graphName}/`;
      return graph;
    });
}

onMount(async () => {
  // get url search params
  const urlParams = new URLSearchParams(window.location.search);
  const databaseParam = urlParams.get("database");
  if (databaseParam) {
    console.log(databaseParam);
    await loadGraph(databaseParam);
    loadedGraph = true;
  }
});
</script>

<h1>Autograph</h1>

{#if !loadedGraph}
  <div class="page">
    <div>
      <div>
        Select a dataset to explore:
        <select
          on:change={(event) => {
            const value = event.target.value;
            if (!value) return;
            loadGraph(value);
          }}
        >
          <option value="">Select a dataset</option>
          {#await databaseList then databases}
            {#each databases as database}
              <option value={database}>{database}</option>
            {/each}
          {:catch error}
            <option value="">Error loading databases</option>
          {/await}
        </select>
      </div>
    </div>
    <div>
      <button
        on:click={() => {
          if (graph) {
            loadedGraph = true;
          }
        }}
      >
        Explore
      </button>
    </div>
  </div>
{:else}
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
