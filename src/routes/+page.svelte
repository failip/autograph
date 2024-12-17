<script lang="ts">
import { Graph } from "ngraph.graph";
import GraphElement from "$lib/graphs/Graph.svelte";
import { createGraphFromString } from "$lib/graphs/graphs";
import { chemkinFileToGraph, parseChemkinFile } from "$lib/files/chemkin";
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
                        const jsongraphs = ["GKHP", "isooctane", "jam"];
                        if (jsongraphs.includes(value)) {
                            fetch(`/graphs/${value}/graph.json`)
                                .then((response) => response.text())
                                .then((text) => {
                                    graph = createGraphFromString(text);
                                    xyzPath = `/graphs/${value}/`;
                                });
                        }
                        if ("aramco" === value) {
                            fetch(`/graphs/aramco/AramcoMech2.0.mech`)
                                .then((response) => response.text())
                                .then((text) => {
                                    const chemkin = parseChemkinFile(text);
                                    graph = chemkinFileToGraph(chemkin);
                                    xyzPath = "/graphs/aramco/structures/";
                                });
                        }

                        if ("gri" === value) {
                            fetch(`/graphs/gri/grimech30.dat`)
                                .then((response) => response.text())
                                .then((text) => {
                                    const chemkin = parseChemkinFile(text);
                                    graph = chemkinFileToGraph(chemkin);
                                    xyzPath = "/graphs/aramco/structures/";
                                });
                        }
                        startSpecies = startingSpeciesMap.get(value) || [];
                    }}
                >
                    <option disabled selected value> select an option </option>
                    <option value="GKHP">gamma-ketohydroperoxide</option>
                    <option value="isooctane">Combustion of Isooctane</option>
                    <option value="jam">Oxidation of Hydrogensulfide</option>
                    <option value="aramco">AramcoMech2.0</option>
                    <option value="gri">GRI-Mech 3.0</option>
                </select>
            </div>
        </div>
        <div style="font-size: 0.8rem;">or</div>
        <div>Explore your own dataset</div>
        <div class="ownDataset">
            <div class="center">
                <label for="graphFile">Graph file:</label>
                <input
                    name="graphFile"
                    id="graphFile"
                    type="file"
                    accept=".json,.dat,.mech,.MECH,.txt,.CKI,.cki,.TXT,.chemkin"
                    on:change={async (event) => {
                        console.log(event.target.files);
                        const file = event.target.files[0];
                        const reader = new FileReader();
                        reader.onload = async (event) => {
                            const isJson = file.name.endsWith(".json");
                            if (isJson) {
                                graph = createGraphFromString(
                                    event.target.result,
                                );
                            } else {
                                const chemkin = parseChemkinFile(
                                    event.target.result,
                                );
                                console.log(chemkin.elements);
                                console.log(chemkin.species);
                                console.log(chemkin.reactions);
                                graph = chemkinFileToGraph(chemkin);
                            }
                        };
                        reader.readAsText(file);
                    }}
                />
            </div>
            <div class="center">
                <label for="xyzDirectory">XYZ files (optional):</label>
                <input
                    name="xyzDirectory"
                    id="xyzDirectory"
                    type="file"
                    webkitdirectory
                    multiple
                    on:change={(event) => {
                        xyzFiles = new Map();
                        for (const file of event.target.files) {
                            xyzFiles.set(file.name, file);
                        }
                    }}
                />
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
