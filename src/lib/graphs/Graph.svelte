<script lang="ts">
import { PathSearchGraph } from "$lib/graphs/graph";
import { filterByAtomCount, filterChargeCount, filterMultiplicityCount, filterDuplicateReactions, FILTERWORDS } from "$lib/filter/filter";
import Fuse from "fuse.js";
import createLayout, { type Vector } from "ngraph.forcelayout";
import createGraph, {
  type Node,
  type Graph,
  type Link,
  type NodeId,
} from "ngraph.graph";
import KeycapButton from "$lib/ui/KeycapButton.svelte";
import RoundButton from "$lib/ui/RoundButton.svelte";
import SideButton from "$lib/ui/SideButton.svelte";

import { COUNT_OPERATORS, type Filter } from "$lib/filter/filter";
import { MoleculeGenerator } from "$lib/rendering/molecules";
import { parseRun } from "$lib/rendering/xyz.js";
import { onMount } from "svelte";
import {
  Group,
  AmbientLight,
  BoxGeometry,
  DirectionalLight,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  Color,
  Matrix4,
  Quaternion,
  InstancedMesh,
  CylinderGeometry,
  SRGBColorSpace,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
    import { bool, ConstNode } from "three/examples/jsm/nodes/Nodes.js";
    import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

export let graph: Graph;
export let secondaryGraphs: Graph[] = [];
export let xyzPath: string;
export let useHash: boolean = false;
export let xyzFiles: Map<string, File> | null = null;
export let startSpecies: string[] = [];

let scene: THREE.Scene;
let meshes: Object3D;

let pathSearchStart = new Array<string>();
let pathChanged = false;

const queuedNodeEvents = new Array<{ changeType: string; node: Node }>();
const queuedLinkEvents = new Array<{ changeType: string; link: Link }>();

console.info("Number of nodes in graph: ", graph.getNodesCount());
console.log("Number of links in graph: ", graph.getLinksCount());

let pathSearchGraph = new PathSearchGraph(graph);
let shortestPath = new Array<string>();

let initialSpecies = new Set<string>();

let graphElement: HTMLCanvasElement;
let canvasWrapper: HTMLDivElement;
const moleculeGenerator = new MoleculeGenerator();
const mousePosition = new Vector2();
let layoutIterations = 1000;
let currentLayoutIteration = 0;
let hoveredNode: Object3D | undefined;
let targetedNode: Object3D | undefined;
let searchVisible = false;
let pathSearchVisible = false;
let settingsVisible = false;
let filterVisible = false;
let rerenderLines = false;
let perspectiveCamera: PerspectiveCamera;
let orthographicCamera: OrthographicCamera;
let camera: PerspectiveCamera | OrthographicCamera;
let controls: OrbitControls;
let controllers: [OrbitControls, OrbitControls];
let directionalLight: DirectionalLight;
let lineInstances: InstancedMesh;
let cameraTarget = new Vector3();
let newCameraTarget = new Vector3();
let zoomTarget = 10.0;
let zoomFinished = true;
let lockedOnMolecule = false;

let allMoleculesVisible = true;

let cursorInfo: HTMLDivElement;
let pointerIsDown = false;

let moleculeSize = 1.0;
let reactionSize = 0.35;
let lineWidth = 0.01;

type NodeType = "species" | "reaction";

interface FilterDefinition {
  id: string;
  type: NodeType;
  fn: (node: Node) => boolean;
  sentence: string;
  removedNodes: NodeId[];
  removedEdges: [NodeId, NodeId][];
}
let allFilters: FilterDefinition[] = [];

let undoStack: UndoAction[] = [];
type UndoAction =
  | { type: "filter"; filterId: string }
  | { type: "addLayer"; addedNodes: NodeId[]; addedEdges: [NodeId, NodeId][] }
  | { type: "addInitialNode"; node: NodeId; addedNodes: NodeId[]; addedEdges: [NodeId, NodeId][] };
let undoEnabled = false;

let filters = new Array<Filter>();
let reactionFilters: Array<(node: Node) => boolean> = [];
let removedByFilter = new Array<{
  nodes: Set<NodeId>;
  edges: Set<[NodeId, NodeId]>;
}>();
let filterSentences = new Array<string>();

let filterApplied = false;
let seenReactions = new Set<string>();

let most_freqent_species = new Set<string>();
let species_count = new Map<string, number>();

let inAddLayerContext = false;
const moleculeGroups = new Map<string, Group>();
const runs = new Map<string, Run>();
let currentFrameIndex = 0;
let selectedSpecies = new Set<string>();
let hiddenElements = new Set<string>();

let speciesEnergyMap: Map<string, number> | null = null;
let reactionEnergyMap: Map<string, number> | null = null;
let energyViewEnabled = false;
let energyZScale: number = 0.05;
const DISPLAY_SCALE = 0.5;
const HARTREE_TO_KJMOL = 2625.4995;
const KJTOKCAL = 4.184;
let energyDirty = true;

let isMac = false;

onMount(() => {
  isMac = navigator.platform.toUpperCase().includes("MAC");
});

// Begin Graph Export
function collectMeshesRecursive(obj, parentMatrix = new Matrix4()) {
  const collected = [];

  const worldMatrix = new Matrix4();
  worldMatrix.multiplyMatrices(parentMatrix, obj.matrix);

  if (obj.isCamera || obj.isLight) {
    return [];
  }

  if (obj.isMesh) {
    const meshClone = obj.clone();
    // Absolute Transformation anwenden
    meshClone.applyMatrix4(worldMatrix);
    meshClone.updateMatrixWorld(true);
    collected.push(meshClone);
  }

  if (obj.isInstancedMesh) {
    const tempMatrix = new Matrix4();
    const tempPos = new Vector3();
    const tempQuat = new Quaternion();
    const tempScale = new Vector3();

    for (let i = 0; i < obj.count; i++) {
      obj.getMatrixAt(i, tempMatrix);

      const pos = new Vector3().setFromMatrixPosition(tempMatrix);

      if (pos.lengthSq() === 0) continue;

      const instanceMatrixWorld = new Matrix4();
      instanceMatrixWorld.multiplyMatrices(worldMatrix, tempMatrix);

      const color = new Color();
      let material = obj.material;

      if (obj.instanceColor) {
        obj.getColorAt(i, color);
        material = material.clone();

        if (material.color) {
          material.color.copy(color);
        }
      } else {
        material = material.clone();
      }

      const mesh = new Mesh(obj.geometry, material);
      mesh.applyMatrix4(instanceMatrixWorld);
      mesh.updateMatrixWorld(true);

      collected.push(mesh);
    }
  }

  if (obj.children?.length) {
    for (const child of obj.children) {
      collected.push(...collectMeshesRecursive(child, worldMatrix));
    }
  }

  return collected;
}

function exportGraphAsGLTF(rootObject) {
  if (!rootObject) return console.warn("Kein Root-Objekt zum Exportieren gefunden!");

  const exportRoot = new Group();

  const graph = rootObject.children[3];
  const edges = rootObject.children[4];

  const nodes = collectNodes(graph);
  const edgeMeshes = collectEdges(edges);

  nodes.forEach(n => exportRoot.add(n));
  edgeMeshes.forEach(e => exportRoot.add(e));

  const exporter = new GLTFExporter();
  exporter.parse(
    exportRoot,
    (gltf) => {
      const blob = new Blob([JSON.stringify(gltf)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = "graph.gltf";
      link.click();
      console.log("[Export] GLTF erfolgreich erstellt! Total Meshes:", allMeshes.length);
    },
    { binary: false }
  );
}

function collectEdges(obj) {
  const collected = [];

  if (!obj) return collected;

  if (obj.isInstancedMesh) {
    const tempMatrix = new Matrix4();

    for (let i = 0; i < obj.count; i++) {
      obj.getMatrixAt(i, tempMatrix);

      const pos = new Vector3().setFromMatrixPosition(tempMatrix);

      // ❗ Zentrum-Zylinder raus
      if (pos.lengthSq() < 1e-6) continue;

      const instanceMatrixWorld = new Matrix4();
      instanceMatrixWorld.multiplyMatrices(obj.matrixWorld, tempMatrix);

      const mesh = new Mesh(obj.geometry, obj.material.clone());
      mesh.applyMatrix4(instanceMatrixWorld);

      collected.push(mesh);
    }
  }

  return collected;
}

function collectNodes(obj, parentMatrix = new Matrix4()) {
  const collected = [];

  if (!obj) return collected;

  // lokale Matrix korrekt kombinieren
  const worldMatrix = new Matrix4();
  worldMatrix.multiplyMatrices(parentMatrix, obj.matrix);

  // InstancedMesh (Moleküle!)
  if (obj.isInstancedMesh) {
    const tempMatrix = new Matrix4();

    for (let i = 0; i < obj.count; i++) {
      obj.getMatrixAt(i, tempMatrix);

      const instanceMatrixWorld = new Matrix4();
      instanceMatrixWorld.multiplyMatrices(worldMatrix, tempMatrix);

      let material = obj.material.clone();

      // Farben fixen
      if (obj.instanceColor) {
        const color = new Color();
        obj.getColorAt(i, color);
        if (material.color) material.color.copy(color);
      }

      const mesh = new Mesh(obj.geometry, material);
      mesh.applyMatrix4(instanceMatrixWorld);

      collected.push(mesh);
    }

    return collected;
  }

  // normale Meshes (Node-Sphären etc.)
  if (obj.isMesh) {
    const mesh = new Mesh(
      obj.geometry,
      obj.material.clone()
    );

    mesh.applyMatrix4(worldMatrix);
    collected.push(mesh);
  }

  // weiter traversieren
  if (obj.children?.length) {
    for (const child of obj.children) {
      collected.push(...collectNodes(child, worldMatrix));
    }
  }

  return collected;
}

// Begin energiedata addition
function parseEnergyTSV(text: string): Map<number, number> {
  const map = new Map<number, number>();
  const lines = text.split("\n");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const [folderStr, energyStr] = line.split("\t");
    const folder = Number(folderStr);

    if (energyStr === "NO FILE") {
      continue;
    }

    const energy = Number(energyStr);
    if (!Number.isNaN(folder) && !Number.isNaN(energy)) {
      map.set(folder, energy);
    }
  }

  return map;
}

function normalizeReactionLabel(label: string): string {
  let [reactants, products] = label.split("=>").map(s => s.trim());

  if (!reactants || !products) {
    console.warn("Ungültiges Reaktionslabel:", label);
    return label.trim();
  }

  const reactantParts = reactants
    .split(/\s*\+\s*/)
    .map(s => s.trim())
    .sort();

  const productParts = products
    .split(/\s*\+\s*/)
    .map(s => s.trim())
    .sort();

  const forward = reactantParts.join("+") + "=>" + productParts.join("+");
  const backward = productParts.join("+") + "=>" + reactantParts.join("+");

  return forward < backward ? forward : backward;
}

// Liest TSV aus einem String und erstellt Map
function loadReactionEnergyMapFromString(tsvContent: string): Map<string, number> {
  const map = new Map<string, number>();

  const lines = tsvContent.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("#"));

  lines.forEach(line => {
    const [rawLabel, rawBarrier] = line.split("\t").map(s => s.trim());

    if (!rawLabel || !rawBarrier) return;

    const key = normalizeReactionLabel(rawLabel);
    const barrier = parseFloat(rawBarrier);

    if (!Number.isFinite(barrier)) {
      console.warn("Ungültige Barriere für Label:", rawLabel);
      return;
    }

    if (map.has(key)) {
      console.warn("Doppelte Reaktion gefunden, überschreibe:", key, "mit Barriere:", barrier);
    }

    map.set(key, barrier);
  });

  console.log("Reaktionen geladen:", map.size);
  return map;
}

function parseRenameMapTSV(text: string): Map<number, string> {
  const map = new Map<number, string>();
  const lines = text.split("\n");

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const [oldName, newName] = line.split("\t");

    // "1.xyz" → 1
    const folder = Number(oldName.replace(".xyz", ""));
    if (Number.isNaN(folder)) continue;

    // "[H][S][H]{0,1}.xyz" → "[H][S][H]{0,1}"
    const nodeId = newName.replace(/\.xyz$/, "");

    map.set(folder, nodeId);
  }

  return map;
}

function buildNodeEnergyMap(
  energyByFolder: Map<number, number>,
  nodeByFolder: Map<number, string>
): Map<string, number> {
  const result = new Map<string, number>();

  for (const [folder, energy] of energyByFolder) {
    const nodeId = nodeByFolder.get(folder);
    if (!nodeId) continue;

    result.set(nodeId, energy);
  }

  return result;
}

async function loadEnergyData(basePath: string): Promise<{
  species: Map<string, number>;
  reactions: Map<string, number>;
}> {
  const [energyText, renameText, reactionEnergyText] = await Promise.all([
    fetch(`${basePath}/final_energies.tsv`).then(r => r.text()),
    fetch(`${basePath}/rename_map.tsv`).then(r => r.text()),
    fetch(`${basePath}/final_reactionenergies.tsv`).then(r => r.text())
  ]);

  const energyByFolder = parseEnergyTSV(energyText);
  const nodeByFolder = parseRenameMapTSV(renameText);

  const speciesMap = buildNodeEnergyMap(energyByFolder, nodeByFolder);
  const reactionMap = loadReactionEnergyMapFromString(reactionEnergyText);

  return {
    species: speciesMap,
    reactions: reactionMap
  };
}

function countElement(
  id: string,
  element: "H" | "O" | "S"
): number {
  const regex = new RegExp(`\\[${element}\\]`, "g");
  return (id.match(regex) || []).length;
}

function computeWeightedEnergy(
  nodeId: string,
  speciesEnergyMap: Map<string, number>,
  refs: { O2: number; SO2: number; H2O: number }
): number | null {

  const E = speciesEnergyMap.get(nodeId);
  if (E === undefined) return null;

  const nS = countElement(nodeId, "S");
  const nH = countElement(nodeId, "H");
  const nO = countElement(nodeId, "O");

  const y = nS;
  const z = nH / 2;
  const x = (nO - 2 * y - z) / 2;

  return E
    - y * refs.SO2
    - z * refs.H2O
    + x * refs.O2;
}

function computeMinWeightedEnergy(
  nodes: Iterable<string>,
  speciesEnergyMap: Map<string, number>,
  refs: { O2: number; SO2: number; H2O: number }
): number {
  let min = Infinity;

  for (const id of nodes) {
    const E = computeWeightedEnergy(id, speciesEnergyMap, refs);
    if (E !== null) {
      min = Math.min(min, E);
    }
  }

  return min;
}

function findLowestEnergy(
  predicate: (id: string) => boolean
): number | null {
  let min = Infinity;

  for (const [id, E] of speciesEnergyMap!) {
    if (predicate(id)) {
      if (E < min) min = E;
    }
  }

  return min === Infinity ? null : min;
}
// End engergiedata addition

// Begin Layout switch logic
let nodeEnergyZ = new Map<string, number>();

function computeEnergyZ() {
  if (!speciesEnergyMap || !reactionEnergyMap) {
    console.warn("Energy maps not loaded yet");
    return;
  }

  const speciesMap = speciesEnergyMap;
  const reactionMap = reactionEnergyMap;

  nodeEnergyZ.clear();

  // Referenzenergien bestimmen
  const refs = {
    O2: findLowestEnergy(
      id => countElement(id, "O") === 2 &&
            countElement(id, "H") === 0 &&
            countElement(id, "S") === 0
    ),
    H2O: findLowestEnergy(
      id => countElement(id, "H") === 2 &&
            countElement(id, "O") === 1 &&
            countElement(id, "S") === 0
    ),
    SO2: findLowestEnergy(
      id => countElement(id, "S") === 1 &&
            countElement(id, "O") === 2 &&
            countElement(id, "H") === 0
    ),
  };

  if (Object.values(refs).some(v => v === null)) {
    console.error("Referenzenergien unvollständig", refs);
    return;
  }
  //console.log(refs);

  // Berechne gewichtete Energien für alle Spezies
  const weightedMap = new Map<string, number>();
  speciesEnergyMap.forEach((E_abs, id) => {
    const y = countElement(id, "S");//Anzahl S ==> 1
    const z = countElement(id, "H") / 2;//Anzahl H2
    const x = (countElement(id, "O") - 2 * y - z) /2;// Anzahl O2

    const E_weighted = E_abs - y * refs.SO2 - z * refs.H2O - x * refs.O2;
    
    //console.log("abs: "+E_abs+" ; id: "+id+" ; Anzahl S: "+y+" ; Anzahl H2: "+z+" ; Anzahl O2: "+x+" ;e_weighted: "+E_weighted);
    weightedMap.set(id, E_weighted);
  });

  // Globales Minimum der gewichteten Energien
  const minE = Math.min(...Array.from(weightedMap.values()));

  // Spezies auf Z-Achse setzen (relativ zum Minimum, optional skaliert)
  weightedMap.forEach((E_weighted, id) => {
    const Z = (E_weighted - minE) * HARTREE_TO_KJMOL * DISPLAY_SCALE;
    nodeEnergyZ.set(id, Z);
  });

  // Reaktionsbarrieren auf Z-Achse setzen
  renderGraph.forEachNode(node => {
    if (node.data.type === "reaction") {
      const id = node.id as string;
      const normalizedID = normalizeReactionLabel(id);
      const barrier = reactionEnergyMap.get(normalizedID);
      if (!Number.isFinite(barrier)) return;

      //get E_weighted for every getInEdges(node)fromID, that is an educt
      const inEdges = getInEdges(node);
      let reactantEnergySum = 0;
      const [leftSide] = id.split("=>");
      const leftSpecies = leftSide
        .split("+")
        .map(s => s.trim());

      for (const edge of inEdges) {
        const reactantId = edge.fromId;
        if (leftSpecies.includes(reactantId)) {
          const temp_E_weighted = weightedMap.get(reactantId);
          if (Number.isFinite(temp_E_weighted)) {
            reactantEnergySum += ((temp_E_weighted - minE) * HARTREE_TO_KJMOL)!;
          }
        }
      }

      //console.log("barrier: "+barrier+" ;reactantEnergySum: "+reactantEnergySum)
      // Skalieren damit alles zur Spezies-Z-Achse passt
      const Z = barrier + reactantEnergySum * DISPLAY_SCALE;
      nodeEnergyZ.set(id, Z);
    }
  });
}
// End  layout switch logic

// Begin VR adapdter
let xrSession: XRSession | null = null;
let isXrSession = false;

setupXRSession().catch(err => {
  console.error("Fehler beim Starten der XR Session:", err);
});

async function isInlineXrAvailable(): Promise<boolean> {
  if (!('xr' in navigator)) return false;
  try {
    return await navigator.xr.isSessionSupported('inline');
  } catch {
    return false;
  }
}

async function setupXRSession() {
  if (!('xr' in navigator)) {
    console.warn("WebXR wird nicht unterstützt.");
    return;
  }

  let supported = false;
  try {
    supported = await navigator.xr.isSessionSupported('immersive-vr');
  } catch (err) {
    console.error("Fehler beim Prüfen von WebXR-Unterstützung:", err);
    return;
  }

  if (!supported) {
    console.warn("Immersive VR wird nicht unterstützt.");
    return;
  }

  console.log("WebXR und immersive-vr werden unterstützt. Setup beginnt...");

  xrSession = await navigator.xr.requestSession('inline');
  console.log("XR inline Session gestartet");

  xrSession.addEventListener('inputsourceschange', () => {
    console.log("InputSources aktualisiert:", xrSession!.inputSources);
  });

  // Startet die kontinuierliche Eingabeschleife
  xrSession.requestAnimationFrame(onXRFrame);
  isXrSession = true;
}

function onXRFrame(time: DOMHighResTimeStamp, frame: XRFrame) {
  if (!xrSession) return;

  const inputSources = xrSession.inputSources;

  for (const source of inputSources) {
    if (source.gamepad) {
      const buttons = source.gamepad.buttons;
      const hand = source.handedness;

      handleControllerInput(source, buttons, hand);
    }
  }

  // Schleife fortsetzen
  xrSession.requestAnimationFrame(onXRFrame);
}
// End VR Adapter

// Begin VR Input
function handleControllerInput(
  source: XRInputSource,
  buttons: GamepadButton[],
  hand: XRHandedness
) {
  if (buttons[0]?.pressed) {
    console.log(`[${hand}] Trigger gedrückt`);
    onTriggerPress(hand);
  }

  if (buttons[1]?.pressed) {
    console.log(`[${hand}] Grip gedrückt`);
    onGripPress(hand);
  }

  if (buttons[2]?.pressed) {
    console.log(`Unterer Tastenknopf [${hand}] gedrückt`);
    onLowerButtonPress(hand);
  }

  if (buttons[3]?.pressed) {
    console.log(`Oberer Tastenknopf [${hand}] gedrückt`);
    onUpperButtonPress(hand);
  }

  if (buttons[4]?.pressed) {
    console.log(`Klick auf den [${hand}]en Stick`);
    onStickPress(hand);
  }
}

function onTriggerPress(hand: XRHandedness) {
  console.log(`→ Aktion: Trigger (${hand})`);
}

function onGripPress(hand: XRHandedness) {
  console.log(`→ Aktion: Grip (${hand})`);
  if (hand === 'left') {
    rClick();
  }
}

function onLowerButtonPress(hand: XRHandedness) {
  console.log(`→ Aktion: Lower button (${hand})`);
  if (hand === 'left') {
    pClick();
  } else {
    qClick();
  }
}

function onUpperButtonPress(hand: XRHandedness) {
  console.log(`→ Aktion: Upper button (${hand})`);
  if (hand === 'left') {
    fClick();
  } else {
    wClick();
  }
}

function onStickPress(hand: XRHandedness) {
  console.log(`→ Aktion: Stick (${hand})`);
}
// Ednd VR Input 

const reactionNodes = new Array<Node>();
graph.forEachNode((node) => {
  if (!node.data) {
    graph.removeNode(node.id);
    return;
  }
  if (node.data.type == "reaction") {
    reactionNodes.push(node);
  }
});

reactionNodes.forEach((reaction) => {
  const inEdges = getInEdges(reaction);
  inEdges.forEach((edge) => {
    const node = graph.getNode(edge.fromId);
    if (node) {
      if (species_count.has(node.data.name)) {
        species_count.set(
          node.data.name,
          species_count.get(node.data.name) + 1,
        );
      } else {
        species_count.set(node.data.name, 1);
      }
    }
  });

  const outEdges = getOutEdges(reaction);
  outEdges.forEach((edge) => {
    const node = graph.getNode(edge.toId);
    if (node) {
      if (species_count.has(node.data.name)) {
        species_count.set(
          node.data.name,
          species_count.get(node.data.name) + 1,
        );
      } else {
        species_count.set(node.data.name, 1);
      }
    }
  });
});

const sorted_species = new Map(
  [...species_count.entries()].sort((a, b) => b[1] - a[1]),
);

let i = 0;
for (let [species, count] of sorted_species) {
  if (i >= 15) {
    break;
  }
  most_freqent_species.add(species);
  i++;
}

const speciesNodes = new Array<String>();
graph.forEachNode((node) => {
  if (node.data.type == "species") {
    speciesNodes.push(node.data.name);
  }
});

const fuse = new Fuse(speciesNodes, {
  shouldSort: true,
  includeScore: true,
  useExtendedSearch: true,
});

const renderGraph = createGraph();
let currentSpecies = new Set<string>();
const initialReactions = new Set<string>();

type ViewMode = "force3d" | "energy2d";
let viewMode: ViewMode = "force3d";

let layout = createLayout(renderGraph, {
  timeStep: 0.5,
  dimensions: 3,
  theta: 0.5,
});

function rebuildLayout(dimensions: 2 | 3) {
  layout.dispose?.();
  layout = createLayout(renderGraph, {
    timeStep: 0.5,
    dimensions,
    theta: 0.5,
  });
  currentLayoutIteration = 0;
  console.log("currentLayoutIteration: " + currentLayoutIteration + " ; current Layout: " + dimensions);
}

const objects = new Map<string, Object3D>();

onMount(async () => {
  if (!(await isInlineXrAvailable())) {
    console.warn("XR nicht verfügbar.");
  } else {

    const supported = await navigator.xr.isSessionSupported('inline');
    if (!supported) {
      console.warn('WebXR inline-Modus nicht unterstützt.');
      return;
    }

    const session = await navigator.xr.requestSession('inline');
    console.log('XR inline Session gestartet');

    session.requestAnimationFrame(function onXRFrame(time: DOMHighResTimeStamp, frame: XRFrame) {
      for (const source of session.inputSources) {
        if (source.gamepad && source.handedness === 'right') {
          const buttons = source.gamepad.buttons;

          if (buttons[0].pressed) {
            selectMoleculeVR();
          }
        }
      }

      session.requestAnimationFrame(onXRFrame);
    })
  } 

  const energyData = await loadEnergyData("/energies/jam");
  speciesEnergyMap = energyData.species;
  reactionEnergyMap = energyData.reactions;

  if (viewMode === "energy2d") {
  computeEnergyZ();
  }

  const E_O2 = findLowestEnergy(
    id =>
      countElement(id, "O") === 2 &&
      countElement(id, "H") === 0 &&
      countElement(id, "S") === 0
  );

  const E_H2O = findLowestEnergy(
    id =>
      countElement(id, "H") === 2 &&
      countElement(id, "O") === 1 &&
      countElement(id, "S") === 0
  );

  const E_SO2 = findLowestEnergy(
    id =>
      countElement(id, "S") === 1 &&
      countElement(id, "O") === 2 &&
      countElement(id, "H") === 0
  );

  if (E_O2 === null || E_H2O === null || E_SO2 === null) {
    console.error("Referenzenergien nicht eindeutig bestimmbar", {
      E_O2, E_H2O, E_SO2
    });
    return;
  }

  function getElementAtCenter(): HTMLElement | null {
    const x = window.innerWidth / 2;
    const y = window.innerHeight / 2;
    return document.elementFromPoint(x, y) as HTMLElement | null;
  }

  function simulateClick(el: HTMLElement) {
    const event = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      view: window,
    });
    el.dispatchEvent(event);
  }

  scene = new Scene();

  perspectiveCamera = new PerspectiveCamera(
    75,
    canvasWrapper.clientWidth / canvasWrapper.clientHeight,
    0.1,
    1000,
  );
  orthographicCamera = new OrthographicCamera(
    -canvasWrapper.clientWidth / 2,
    canvasWrapper.clientWidth / 2,
    canvasWrapper.clientHeight / 2,
    -canvasWrapper.clientHeight / 2,
    -1000,
    1000,
  );

  perspectiveCamera.position.z = 30;
  orthographicCamera.position.z = 30;

  const renderer = new WebGLRenderer({
    canvas: graphElement,
    antialias: true,
    alpha: true,
  });

  const raycaster = new Raycaster();

  const ambientLight = new AmbientLight(0xffffff, 0.35);
  scene.add(ambientLight);

  const directionalLight = new DirectionalLight(0xffffff, 1.0);
  directionalLight.position.set(10, 20, 10);
  scene.add(directionalLight);

  window.onresize = () => {
    const width = canvasWrapper.clientWidth;
    const height = canvasWrapper.clientHeight;
    perspectiveCamera.aspect = width / height;
    perspectiveCamera.updateProjectionMatrix();
    orthographicCamera.left = -width / 2;
    orthographicCamera.right = width / 2;
    orthographicCamera.top = height / 2;
    orthographicCamera.bottom = -height / 2;
    orthographicCamera.updateProjectionMatrix();
    renderer.setSize(width, height);
  };

  renderer.outputColorSpace = SRGBColorSpace;
  renderer.pixelRatio = window.devicePixelRatio;
  renderer.setClearColor("white");
  controllers = [
    new OrbitControls(perspectiveCamera, graphElement),
    new OrbitControls(orthographicCamera, graphElement),
  ];

  perspectiveCamera.name = "Perspective Camera";
  orthographicCamera.name = "Orthographic Camera";
  scene.add(perspectiveCamera);
  scene.add(orthographicCamera);
  orthographicCamera.zoom = 10.0;
  camera = orthographicCamera;
  controls = controllers[1];
  controls.target = cameraTarget;
  controls.update();

  renderer.setSize(graphElement.clientWidth, graphElement.clientHeight);
  renderer.setPixelRatio(window.devicePixelRatio);

  const light = new AmbientLight(0x404040, 10.0);
  scene.add(light);

  graphElement.addEventListener(
    "wheel",
    (event) => {
      zoomFinished = true;
    },
    { passive: true },
  );

  directionalLight = new DirectionalLight(0xffffff, 5.0);
  directionalLight.position.set(0, 1, 1);
  camera.add(directionalLight);

  const geometry = new BoxGeometry(1.0, 1.0, 1.0);

  meshes = new Object3D();
  scene.add(meshes);

  graphElement.addEventListener("pointerdown", selectMolecule);

  graphElement.addEventListener("pointerdown", () => {
    pointerIsDown = true;
  });
  graphElement.addEventListener("pointerup", () => {
    pointerIsDown = false;
  });

  const lineOutMaterial = new LineBasicMaterial({
    color: 0xffffff,
    opacity: 0.5,
    transparent: true,
    linewidth: 3,
  });

  let maxLineCount = 1024;
  lineInstances = new InstancedMesh(
    new CylinderGeometry(1.0, 1.0, 1.0, 32),
    lineOutMaterial,
    maxLineCount,
  );
  lineInstances.frustumCulled = false;

  lineInstances.count = 0;

  scene.add(lineInstances);

  function hover() {
    raycaster.setFromCamera(mousePosition, camera);
    const intersects = raycaster.intersectObjects(meshes.children);
    if (intersects.length > 0) {
      hoveredNode = intersects[0].object;
      graphElement.style.cursor = "pointer";
      cursorInfo.style.left = `${(mousePosition.x + 1.0) * 50}%`;
      cursorInfo.style.bottom = `${(mousePosition.y + 1.0) * 50}%`;
    } else {
      hoveredNode = undefined;
      graphElement.style.cursor = "default";
    }
  }

  const animate = function () {
    if (currentLayoutIteration < layoutIterations) {
      layout.step();
      currentLayoutIteration++;
    }

    const removedNodes = new Set<NodeId>();
    queuedNodeEvents.forEach((change) => {
      if (change.changeType == "remove") {
        handleRemovedNode(change.node.id);
        removedNodes.add(change.node.id);
      } else if (change.changeType == "add") {
        handleAddedNode(change.node.id);
      }
      currentLayoutIteration = 0;
    });

    queuedNodeEvents.length = 0;

    queuedLinkEvents.forEach((change) => {
      if (change.changeType == "add") {
        handleAddedLink(change.link);
      }
    });

    const removedLinks = queuedLinkEvents
      .filter((change) => change.changeType == "remove")
      .map((change) => change.link);
    handleRemovedLinks(removedLinks);

    if (filterApplied) {
      removedByFilter.push({
        nodes: removedNodes,
        edges: new Set(removedLinks.map((link) => [link.fromId, link.toId])),
      });
      filterApplied = false;
    }

    if (queuedLinkEvents.length > 0) {
      lineInstances.instanceMatrix.needsUpdate = true;
      currentLayoutIteration = 0;
    }

    queuedLinkEvents.length = 0;
    hover();

    if (viewMode === "energy2d" && energyDirty) {
      computeEnergyZ();
      energyDirty = false;
    }

    if (currentLayoutIteration < layoutIterations) {
      renderGraph.forEachNode((node) => {
        computeEnergyZ(node);  // sorgt dafür, dass nodeEnergyZ für species & reaction gesetzt wird
      });

      renderGraph.forEachNode((node) => {
        const position = layout.getNodePosition(node.id);
        const cube = objects.get(node.id as string);

        if (cube === undefined) {
          return;
        }

        if (viewMode === "energy2d") {
          const z = nodeEnergyZ.get(node.id as string);
          cube.position.x = position.x;
          cube.position.y = position.y;
          cube.position.z = Number.isFinite(z) ? z * energyZScale : 0;
        } else {
          cube.position.copy(position);
        }
      });

      renderGraph.forEachLink((link) => {
        updateLink(link);
      });

      lineInstances.instanceMatrix.needsUpdate = true;
    }

    if (!zoomFinished) {
      camera.zoom = camera.zoom + (zoomTarget - camera.zoom) * 0.1;
      cameraTarget.lerp(newCameraTarget, 0.1);
      if (
        Math.abs(camera.zoom - zoomTarget) < 0.1 &&
        cameraTarget.distanceTo(newCameraTarget) < 0.1
      ) {
        zoomFinished = true;
      }
      controls.update();
    }

    if (camera.zoom > 40.0 && lockedOnMolecule) {
      hideMoleculesObstructingView();
    } else if (!allMoleculesVisible) {
      meshes.children.forEach((object) => {
        object.traverse((child) => {
          if (child instanceof Mesh) {
            child.material.opacity = 1.0;
            child.material.transparent = false;
            child.material.needsUpdate = true;
          }
        });
      });
      allMoleculesVisible = true;
    }

    rerenderLines =
      rerenderLines ||
      (pathChanged && currentLayoutIteration == layoutIterations);

    if (rerenderLines) {
      pathChanged = false;
      renderGraph.forEachLink((link) => {
        updateLink(link);
      });

      lineInstances.instanceMatrix.needsUpdate = true;
      rerenderLines = false;
    }

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  };

  animate();

  renderGraph.on("changed", (changes) => {
    const non_update = changes.filter(
      (change) => change.changeType != "update",
    );

    if (non_update.length == 0) {
      return;
    }

    const nodeChanges = non_update.filter((change) => change.node);
    const linkChanges = non_update.filter((change) => change.link);

    queuedNodeEvents.push(...nodeChanges);
    queuedLinkEvents.push(...linkChanges);

    if (viewMode === "energy2d") {
      energyDirty = true;
    }
  });

  const _helperMatrix1 = new Matrix4();
  const _helperMatrix2 = new Matrix4();
  const _yUpVector = new Vector3(0, 1, 0);
  const _helperVector = new Vector3(0, 0, 0);

  function updateLink(link: Link) {
    const isPartOfShortestPath =
      shortestPath.includes(link.fromId) || shortestPath.includes(link.toId);

    const posA = objects.get(link.fromId).position;
    const posB = objects.get(link.toId).position;

    if (link.data === undefined) {
      return;
    }

    const index = link.data.index;

    const matrix = _helperMatrix1.makeTranslation(
      (posA.x + posB.x) / 2,
      (posA.y + posB.y) / 2,
      (posA.z + posB.z) / 2,
    );

    matrix.lookAt(posA, posB, _yUpVector);
    matrix.multiply(_helperMatrix2.makeRotationX(Math.PI / 2));
    const width = isPartOfShortestPath
      ? Math.max(0.1, lineWidth * 1.1)
      : lineWidth;
    matrix.scale(_helperVector.set(width, posA.distanceTo(posB), width));

    lineInstances.setColorAt(
      index - 1,
      isPartOfShortestPath ? new Color("red") : new Color("black"),
    );
    lineInstances.instanceColor!.needsUpdate = true;

    lineInstances.setMatrixAt(index - 1, matrix);
  }

  function handleRemovedNode(nodeId: string) {
    const object = objects.get(nodeId);
    if (object === undefined) {
      return;
    }
    meshes.remove(object);
  }

  function handleRemovedLink(link: Link) {
    const index = link.data.index;
    lineInstances.count = lineInstances.count - 1;
    lineInstances.instanceMatrix.array.copyWithin(
      index * 16,
      (index + 1) * 16,
      lineInstances.count * 16,
    );
    renderGraph.forEachLink((link) => {
      if (link.data.index > index) {
        link.data.index -= 1;
      }
    });
  }

  function handleRemovedLinks(links: Link[]) {
    const sorted = links.sort((a, b) => b.data.index - a.data.index);
    sorted.forEach((link) => {
      handleRemovedLink(link);
    });
  }

  function hideMoleculesObstructingView() {
    allMoleculesVisible = false;
    const plane = new Plane();
    const normal_vector = new Vector3();
    camera.getWorldDirection(normal_vector);
    plane.setFromNormalAndCoplanarPoint(normal_vector, cameraTarget);
    meshes.children.forEach((object) => {
      if (object instanceof Mesh) return;
      if (targetedNode === object) {
        targetedNode.traverse((child) => {
          if (child instanceof Mesh) {
            child.material.opacity = 1.0;
            child.material.transparent = false;
            child.material.needsUpdate = true;
          }
        });
        return;
      }
      const position = object.position;
      const distanceToPlane = plane.distanceToPoint(position);

      function calculateOpacity(distance: number): number {
        if (distance >= 60) {
          return 0.05;
        } else if (distance <= 40) {
          return 1.0;
        } else {
          return 1.0 - ((distance - 40) / 20) * (1.0 - 0.05);
        }
      }

      const opacity = Math.min(
        1.0,
        Math.max(calculateOpacity(camera.zoom), distanceToPlane * 0.5),
      );
      object.children.forEach((child) => {
        if (child instanceof Mesh) {
          child.material.opacity = opacity;
          child.material.transparent = opacity < 1.0;
          child.material.needsUpdate = true;
        } else {
          child.traverse((child) => {
            if (child instanceof Mesh) {
              child.material.opacity = opacity * 0.5;
              child.material.transparent = opacity < 1.0;
              child.material.needsUpdate = true;
            }
          });
        }
      });
    });
  }

  function selectMolecule(event: PointerEvent) {
    if (!hoveredNode) return;
    const nodeId = hoveredNode.userData?.name;
    if (!nodeId) return;

    const moleculeGroup = moleculeGroups.get(nodeId);
    const run = runs.get(nodeId);

    if (!moleculeGroup || !run) {
      console.warn("Keine Molekülgruppe oder Run für", nodeId);
      return;
    }

    // Mehrfachauswahl: Toggle-Verhalten
    if (selectedSpecies.has(nodeId)) {
      selectedSpecies.delete(nodeId);
    } else {
      selectedSpecies.add(nodeId);
    }
 
    if (moleculeGroup && run) {
      moleculeGenerator.updateMolecule(
        moleculeGroup,
        run,
        currentFrameIndex,
        selectedSpecies,
        nodeId
      );
    }

    let parent = hoveredNode.parent;

    if (parent?.parent !== meshes) {
      parent = parent?.parent;
    }

    if (parent) {
      parent.getWorldPosition(newCameraTarget);
      zoomTarget = camera.zoom; 
      zoomFinished = false;
      targetedNode = parent;
    }

    lockedOnMolecule = true;
  }

  function selectMoleculeVR() {
    if (!hoveredNode) return;
    const nodeId = hoveredNode.userData?.name;
    if (!nodeId) return;

    const moleculeGroup = moleculeGroups.get(nodeId);
    const run = runs.get(nodeId);

    if (!moleculeGroup || !run) {
      console.warn("Keine Molekülgruppe oder Run für", nodeId);
      return;
    }

    // Mehrfachauswahl: Toggle-Verhalten
    if (selectedSpecies.has(nodeId)) {
      selectedSpecies.delete(nodeId);
    } else {
      selectedSpecies.add(nodeId);
    }

    if (moleculeGroup && run) {
      moleculeGenerator.updateMolecule(
        moleculeGroup,
        run,
        currentFrameIndex,
        selectedSpecies,
        nodeId
      );
    }
    

    let parent = hoveredNode.parent;

    if (parent?.parent !== meshes) {
      parent = parent?.parent;
    }

    if (parent) {
      parent.getWorldPosition(newCameraTarget);
      //zoomTarget = camera.zoom; 
      //zoomFinished = false;
      targetedNode = parent;
    }

    lockedOnMolecule = true;
  }

  async function handleAddedNode(nodeId: string) {
    let mostDistantPosition = {
      x: 0,
      y: 0,
      z: 0,
    } as Vector;
    let maxDistance = 0.0;
    const links = renderGraph.getNode(nodeId)?.links;
    links?.forEach((link) => {
      const otherNode = link.fromId === nodeId ? link.toId : link.fromId;
      const otherNodePos = layout.getNodePosition(otherNode);
      const distance = Math.sqrt(
        otherNodePos.x ** 2 + otherNodePos.y ** 2 + otherNodePos.z ** 2,
      );
      if (distance > maxDistance) {
        maxDistance = distance;
        mostDistantPosition = otherNodePos;
      }
    });

    layout.setNodePosition(
      nodeId,
      mostDistantPosition.x,
      mostDistantPosition.y,
      mostDistantPosition.z,
    );

    if (objects.has(nodeId)) {
      const object = objects.get(nodeId);

      if (object === undefined) {
        return;
      }

      meshes.add(object);
      return;
    }

    const material = new MeshBasicMaterial({ color: 0x771515 });
    const reaction_color = new MeshBasicMaterial({ color: 0xaaaaac });
    const node = graph.getNode(nodeId)?.data;

    const cube = new Mesh(
      geometry,
      node.type == "species" ? material : reaction_color,
    );

    if (!node.inSecondaryGraphs) {
      cube.material.opacity = 0.1;
      cube.material.transparent = true;
      cube.material.needsUpdate = true;
    }

    objects.set(nodeId, cube);
    cube.userData = node;
    cube.scale.set(
      node.type == "species" ? moleculeSize : reactionSize,
      node.type == "species" ? moleculeSize : reactionSize,
      node.type == "species" ? moleculeSize : reactionSize,
    );
    meshes.add(cube);

    if (node.type === "species") {
      let data: string;
      if (xyzFiles) {
        const file = xyzFiles.get(node.name + ".xyz");
        if (!file) {
          return;
        }
        data = await file.text();
      } else {
        const url = useHash
          ? `${xyzPath}${node.hash}/molecule.xyz`
          : `${xyzPath}${node.name.includes("#") ? node.name.replace("#", "tt") : node.name}.xyz`;
        const response = await fetch(url);
        if (!response.ok) {
          return;
        }
        data = await response.text();
      }
      const run = parseRun(data);
      const molecule = moleculeGenerator.generateMolecule(run, hiddenElements);

      moleculeGroups.set(nodeId, molecule); // molecule ist ein THREE.Group
      runs.set(nodeId, run);

      molecule.userData.run = run;
      molecule.scale.set(moleculeSize, moleculeSize, moleculeSize);
      
      scene.add(molecule);

      if (!molecule) return;
      molecule.traverse((child) => {
        child.userData = node;
      });
      molecule.scale.set(moleculeSize, moleculeSize, moleculeSize);
      if (renderGraph.hasNode(nodeId)) {
        objects.set(nodeId, molecule);
        meshes.remove(cube);
        meshes.add(molecule);

        if (!node.inSecondaryGraphs) {
          molecule.traverse((child) => {
            if (child instanceof Mesh) {
              child.material.opacity = 0.1;
              child.material.transparent = true;
              child.material.needsUpdate = true;
            }
          });
        }
      }
    }
    return;
  }

  function increaseLineCount() {
    const newLineInstances = new InstancedMesh(
      new CylinderGeometry(1.0, 1.0, 1.0, 32),
      lineInstances.material,
      maxLineCount * 2,
    );
    maxLineCount = maxLineCount * 2;
    newLineInstances.instanceMatrix.array.set(
      lineInstances.instanceMatrix.array,
    );
    newLineInstances.count = lineInstances.count;
    scene.remove(lineInstances);
    scene.add(newLineInstances);
    lineInstances = newLineInstances;
  }

  function handleAddedLink(link: Link) {
    const index = lineInstances.count + 1;
    const maxCountReached = index >= maxLineCount;
    if (maxCountReached) {
      increaseLineCount();
      console.debug(maxLineCount);
    }
    lineInstances.count = index;
    link.data = { index: index };
  }

  for (const species of startSpecies) {
    addInitialNode(species);
  }

  //start undo funktionality
  undoEnabled = true;
});

function updateMousePosition(event) {
  mousePosition.x = (event.clientX / graphElement.clientWidth) * 2 - 1;
  mousePosition.y = -(event.clientY / graphElement.clientHeight) * 2 + 1;
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key == "Escape") {
    searchVisible = false;
    pathSearchVisible = false;
    filterVisible = false;
    settingsVisible = false;
    search_value = "";
  }
  const isMod = event.ctrlKey || event.metaKey;

  if (event.key == "q") {
    qClick();
  }

  if (event.key == "p") {
    pClick();
  }

  if (event.key == "f") {
    fClick();
  }

  if (event.key == "w") {
    wClick();
  }

  if (event.key == "r") {
    rClick();
  }
  // Undo (Crtl/Cmd + Z)
  if (isMod && event.key === "z") {
    event.preventDefault();
    undoLastAction();
  }

  // Export (Ctrl/Cmd + E)
  if (isMod && event.key === "e") {
    event.preventDefault();
    exportGraphAsGLTF(scene, "myGraph.gltf");
  }
}

function qClick() {
  if (!searchVisible) {
    searchVisible = !searchVisible;
    search_value = "";

    if (searchVisible) {
      search_results.clear();
      most_freqent_species.forEach((species) => {
        search_results.add(species);
      });
      search_results = search_results;
      pathSearchVisible = false;
      filterVisible = false;
      settingsVisible = false;
    }
  }
}

function pClick() {
  if (!pathSearchVisible) {
    pathSearchVisible = !pathSearchVisible;
    pathSearchStart = [];
    if (pathSearchVisible) {
      searchVisible = false;
      filterVisible = false;
      settingsVisible = false;
    }
  }
}

function fClick() {
  if (!filterVisible) {
    filterVisible = !filterVisible;
    if (filterVisible) {
      searchVisible = false;
      pathSearchVisible = false;
      settingsVisible = false;
    }
  }
}

function wClick() {
  const anyOverlaysVisible =
    searchVisible || pathSearchVisible || filterVisible || settingsVisible;
  if (anyOverlaysVisible) {
    return;
  }
  addLayer();
}

function rClick() {
  const anyOverlaysVisible =
    searchVisible || pathSearchVisible || filterVisible || settingsVisible;
  if (anyOverlaysVisible) {
    return;
  }
  renderGraph.clear();
  initialSpecies.clear();
  initialReactions.clear();
  currentSpecies.clear();
  shortestPath = [];
}


function filterGraph(): { nodes: Set<NodeId>; edges: Set<[NodeId, NodeId]> } {
  const nodesToRemove = new Set<NodeId>();
  const edgesToRemove = new Set<[NodeId, NodeId]>();
  const reactionNodesToRemove = new Set<NodeId>();

  // Aufteilen der Filter nach Typ
  const speciesFilters = allFilters.filter((f) => f.type === "species");
  const reactionFilters = allFilters.filter((f) => f.type === "reaction");

  seenReactions.clear(); // clean start

  // Alle vorher gespeicherten Änderungen (für Undo) leeren
  allFilters.forEach((f) => {
    f.removedNodes = [];
    f.removedEdges = [];
  });

  // Erste Runde: Node-Filter anwenden
  renderGraph.forEachNode((node: Node) => {
    if (node.data.type === "reaction") {
      for (const filter of reactionFilters) {
        if (filter.fn(node)) {
          reactionNodesToRemove.add(node.id);
          filter.removedNodes.push(node.id);
        }
      }
    } else {
      for (const filter of speciesFilters) {
        if (filter.fn(node)) {
          if (!node.links) continue;

          node.links.forEach((link) => {
            nodesToRemove.add(link.fromId);
            nodesToRemove.add(link.toId);
            edgesToRemove.add([link.fromId, link.toId]);
            filter.removedNodes.push(link.fromId, link.toId);
            filter.removedEdges.push([link.fromId, link.toId]);
            renderGraph.removeLink(link);
          });
        }
      }
    }
  });

  // Zweite Runde: Kanten von/zu Reaktionsknoten entfernen
  renderGraph.forEachNode((node: Node) => {
    if (node.data.type === "reaction") return;
    if (!node.links) return;

    node.links.forEach((link) => {
      if (reactionNodesToRemove.has(link.fromId) || reactionNodesToRemove.has(link.toId)) {
        edgesToRemove.add([link.fromId, link.toId]);

        // Finde passende Filter, um die Entfernung zu registrieren
        for (const filter of reactionFilters) {
          if (reactionNodesToRemove.has(link.fromId) || reactionNodesToRemove.has(link.toId)) {
            filter.removedEdges.push([link.fromId, link.toId]);
          }
        }

        renderGraph.removeLink(link);
      }
    });
  });

  // Reaktionsknoten aus der finalen Löschliste übernehmen
  reactionNodesToRemove.forEach((nodeId) => {
    nodesToRemove.add(nodeId);
  });

  // Alle nodesToRemove (außer initialSpecies) löschen
  nodesToRemove.forEach((nodeId) => {
    if (initialSpecies.has(nodeId)) return;

    const node = graph.getNode(nodeId);
    if (!node) return;

    renderGraph.removeNode(nodeId);
    currentSpecies.delete(nodeId);
  });

  // Nachträgliches Entfernen isolierter Nodes (außer initialSpecies)
  renderGraph.forEachNode((node: Node) => {
    if (node.data.type === "reaction") return;
    if (initialSpecies.has(node.id)) return;
    if (!node.links || node.links.size === 0) {
      nodesToRemove.add(node.id);
      renderGraph.removeNode(node.id);
    }
  });

  return { nodes: nodesToRemove, edges: edgesToRemove };
}

/**
 * applies filters and returns 
 */
function filterGraphOld(): { nodes: Set<NodeId>; edges: Set<[NodeId, NodeId]> } {
  const nodesToRemove = new Set<NodeId>();
  const reactionNodesToRemove = new Set<NodeId>();
  const edgesToRemove = new Set<[NodeId, NodeId]>();

  seenReactions.clear(); //clean start
  console.warn(seenReactions);
  /**
   * iterate over all nodes and add their id to sets when a filter aplies to them
  */
  renderGraph.forEachNode((node: Node) => {
    let removeNode = false;
    let removeReactionNode = false;

    if (node.data.type === "reaction") {
      removeReactionNode = reactionFilters.some((filter) => filter(node));

      if (removeReactionNode) {
        if (!node.id) {
          return;
        }
        reactionNodesToRemove.add(node.id);
      }
    } else {
      removeNode = filters.some((filter) => filter(node));

      if (removeNode) {
        if (!node.links) {
          return;
        }
        node.links.forEach((link) => {
          nodesToRemove.add(link.fromId);
          nodesToRemove.add(link.toId);
          edgesToRemove.add([link.fromId, link.toId]);
          renderGraph.removeLink(link);
        });
      }
    }
  });
  /**
   * remove Links from or to reactions that will be removed by filters
  */
  renderGraph.forEachNode((node: Node) => {
    if (node.data.type == "reaction") {
      return;
    }
    if (!node.links) {
      return;
    }
    node.links.forEach((link) => {
      if (reactionNodesToRemove.has(link.fromId) || reactionNodesToRemove.has(link.toId)) {
      edgesToRemove.add([link.fromId, link.toId]);
    }
    });
  });

  /**
   * add all chosen reactionNodes to nodesToRemove after deleating all links to them
  */
 console.warn(reactionNodesToRemove);
  reactionNodesToRemove.forEach((nodeId) => {
    nodesToRemove.add(nodeId);
  })

  /**
   * remove all chosen nodes exept nodes of the initial species
  */
  nodesToRemove.forEach((nodeId) => {
    if (initialSpecies.has(nodeId)) {
      return;
    }
    renderGraph.removeNode(nodeId);
    currentSpecies.delete(nodeId);
  });

  /**
   * remove all nodes that are left with no connection to the network exept of the initial species
  */
  renderGraph.forEachNode((node: Node) => {
    if (node.data.type == "reaction") {
      return;
    }
    if (initialSpecies.has(node.id)) {
      return;
    }
    if (node.links?.size == 0) {
      nodesToRemove.add(node.id);
      renderGraph.removeNode(node.id);
    }
  });

  return { nodes: nodesToRemove, edges: edgesToRemove };
}

function addLayer() {
  const addedNodes: NodeId[] = [];
  const addedEdges: [NodeId, NodeId][] = [];
  inAddLayerContext = true;

  const oldSpecies = new Set<string>(currentSpecies);
  const selectiveMode = selectedSpecies.size > 0;

  currentSpecies.forEach((species) => {
    addAllPossibleReactionsToRendergraph(
      graph,
      renderGraph,
      species,
      currentSpecies,
      oldSpecies,
      addedNodes,
      addedEdges,
      selectiveMode
    );
  });

  inAddLayerContext = false;

  if (addedNodes.length === 0) {
    console.log("No new reactions can be added with the currently selected species");
  }

  // Undo nur speichern, wenn es wirklich Änderungen gab
  if (undoEnabled && (addedNodes.length > 0 || addedEdges.length > 0)) {
    undoStack.push({
      type: "addLayer",
      addedNodes,
      addedEdges,
    });
  }
}

function addInitialNode(node: string) {
  const addedNodes: NodeId[] = [];
  const addedEdges: [NodeId, NodeId][] = [];

  initialSpecies.add(node);
  currentSpecies.add(node);
  initialSpecies = initialSpecies;
  currentSpecies = currentSpecies;

  addSpeciesToRendergraph(
    graph, 
    renderGraph, 
    node, 
    currentSpecies,
    addedNodes,
    addedEdges
  );

  addAllPossibleReactionsToRendergraph(
    graph,
    renderGraph,
    node,
    currentSpecies,
    initialSpecies,
    addedNodes,
    addedEdges
  );

  if (undoEnabled) {
    undoStack.push({
      type: "addInitialNode",
      node,
      addedNodes,
      addedEdges,
    });
  }
}

let search_results = new Set<string>();
most_freqent_species.forEach((species) => {
  search_results.add(species);
});
let search_value = "";

function filterToInitialSpecies(event) {
  search_results.clear();
  const fuse_results = fuse.search(search_value);
  for (let i = 0; i < Math.min(fuse_results.length, 15); i++) {
    search_results.add(fuse_results[i].item);
  }
  search_results = search_results;
}

function addSpeciesAsInitialSpecies(event) {
  const species = event.target.value;
  addInitialNode(species);
}

function addSpeciesToRendergraph(
  graph: Graph,
  renderGraph: Graph,
  species: string,
  currentSpecies: Set<string>,
  addedNodes?: NodeId[], // Optional
  addedEdges?: [NodeId, NodeId][] // Optional
) {
  const alreadyInGraph = renderGraph.hasNode(species);
  if (alreadyInGraph) {
    return;
  }

  const node = graph.getNode(species);
  if (!node) {
    return;
  }

  const filtered =
    filters.some((filter) => filter(node)) && !initialSpecies.has(species);
  if (filtered) {
    return;
  }

  const inSecondaryGraphs = secondaryGraphs
    .map((graph) => graph.hasNode(species))
    .every((value) => value);

  node.data.inSecondaryGraphs = inSecondaryGraphs;

  currentSpecies.add(species);
  renderGraph.addNode(node.id, node.data);

  if (addedNodes) {
    addedNodes.push(node.id);
  }
}

function addAllPossibleReactionsToRendergraph(
  graph: Graph,
  renderGraph: Graph,
  species: string,
  currentSpecies: Set<string>,
  oldSpecies: Set<string>,
  addedNodes?: NodeId[],
  addedEdges?: [NodeId, NodeId][],
  selectiveMode: boolean = false
) {
  const isSelectiveAdd = inAddLayerContext && selectedSpecies.size > 0;
  if (isSelectiveAdd && !selectedSpecies.has(species)) {
    return;
  }

  const node = graph.getNode(species);
  if (!node) {
    return;
  }

  const filtered = filters.some((filter) => filter(node));
  if (filtered) {
    return;
  }

  node.links?.forEach((link) => {
    const isReactant = link.fromId === species;
    const reactionId = isReactant ? link.toId : link.fromId;

    const reaction = graph.getNode(reactionId);
    if (!reaction) {
      return;
    }

    const inEdges = getInEdges(reaction);
    const outEdges = getOutEdges(reaction);

    let reactionRelevant = false;

    if (selectiveMode) {
      const hasSelectedReactant = inEdges.some((edge) => selectedSpecies.has(edge.fromId as string));
      reactionRelevant = hasSelectedReactant;

      if (reactionRelevant) {
        //console.log(`[AddLayer] Reaction selected due to selected reactant:`, reaction.data.name);
        const products = outEdges.map((edge) => edge.toId);
        //console.log(`[AddLayer] Products of this reaction:`, products);
      }
    } else {
      const hasAllReactants = inEdges.every((edge) => {
        return oldSpecies.has(edge.fromId as string);
      });

      const hasAllProducts = outEdges.every((edge) => {
        return oldSpecies.has(edge.toId as string);
      });

      reactionRelevant = hasAllReactants || hasAllProducts;
    }

    if (!reactionRelevant) {
      return;
    }

    const filtered = inEdges
      .map((edge) => edge.fromId as string)
      .concat(outEdges.map((edge) => edge.toId as string))
      .map((species) => {
        const node = graph.getNode(species);
        if (!node) {
          return true;
        }
        return filters.some((filter) => filter(node));
      })
      .some((value) => value);

    if (filtered) {
      return;
    }

    const inSecondaryGraphs = secondaryGraphs
      .map((graph) => graph.hasNode(species))
      .every((value) => value);

    reaction.data.inSecondaryGraphs = inSecondaryGraphs;

    if (!renderGraph.hasNode(reactionId)) {
      renderGraph.addNode(reactionId, reaction.data);
      if (addedNodes) {
        addedNodes.push(reactionId);
      }
    }

    if (!renderGraph.hasLink(species, reactionId)) {
      renderGraph.addLink(species, reactionId);
      if (addedEdges) {
        addedEdges.push([species, reactionId]);
      }
    }

    inEdges.forEach((edge) => {
      addSpeciesToRendergraph(
        graph,
        renderGraph,
        edge.fromId as string,
        currentSpecies,
        addedNodes,
        addedEdges
      );

      if (!renderGraph.hasLink(edge.fromId, reactionId)) {
        renderGraph.addLink(edge.fromId, reactionId);
        if (addedEdges) {
          addedEdges.push([edge.fromId, reactionId]);
        }
      }
    });

    outEdges.forEach((edge) => {
      addSpeciesToRendergraph(
        graph,
        renderGraph,
        edge.toId as string,
        currentSpecies,
        addedNodes,
        addedEdges
      );

      if (!renderGraph.hasLink(reactionId, edge.toId)) {
        renderGraph.addLink(reactionId, edge.toId);
        if (addedEdges) {
          addedEdges.push([reactionId, edge.toId]);
        }
      }
    });
  });
}

function getInEdges(node: Node): Array<Link> {
  const edges = new Array<Link>();
  node.links?.forEach((link) => {
    if (link.toId === node.id) {
      edges.push(link);
    }
  });
  return edges;
}

function getOutEdges(node: Node): Array<Link> {
  const edges = new Array<Link>();
  node.links?.forEach((link) => {
    if (link.fromId === node.id) {
      edges.push(link);
    }
  });
  return edges;
}

function resizeMolecules() {
  renderGraph.forEachNode((node) => {
    if (node.data.type == "species") {
      const object = objects.get(node.id);
      if (object === undefined) {
        return;
      }
      object.scale.set(moleculeSize, moleculeSize, moleculeSize);
    }
  });
}

//ToDo remove unused function if no further need
function canonicalizeReaction(reaction: string): string {
  const [eductStr, productStr] = reaction.split("=>").map(s => s.trim());

  const educts = eductStr.split("+").map(s => s.trim()).sort();
  const products = productStr.split("+").map(s => s.trim()).sort();

  return `${educts.join(" + ")} ⇌ ${products.join(" + ")}`;
}

function removeFilter(id: string) {
  const index = allFilters.findIndex(f => f.id === id);
  if (index === -1) return;

  const removedFilter = allFilters.splice(index, 1)[0];

  // Wiederherstellen der gelöschten Knoten/Edges
  removedFilter.removedNodes.forEach((nodeId) => {
    const node = graph.getNode(nodeId);
    if (!node) return;
    renderGraph.addNode(nodeId, node.data);
  });

  removedFilter.removedEdges.forEach(([from, to]) => {
    const edge = graph.getLink(from, to);
    if (!edge) return;
    renderGraph.addLink(from, to, edge.data);
  });

  allFilters = allFilters;
}

function undoLastAction() {
  if (undoStack.length === 0) {
    console.warn("Nothing to undo");
    return;
  }

  const lastAction = undoStack.pop();

  if (lastAction.type === "filter") {
    const filterIndex = allFilters.findIndex((f) => f.id === lastAction.filterId);
    if (filterIndex === -1) {
      console.warn("Filter not found");
      return;
    }

    const [removedFilter] = allFilters.splice(filterIndex, 1);
    allFilters = [...allFilters]; // Reaktivität auslösen

    // Wiederherstellen der entfernten Knoten und Kanten
    removedFilter.removedNodes?.forEach((nodeId) => {
      const node = graph.getNode(nodeId);
      if (node) {
        renderGraph.addNode(nodeId, node.data);
        currentSpecies.add(nodeId); // optional, je nach gewünschtem Verhalten
      }
    });

    removedFilter.removedEdges?.forEach(([from, to]) => {
      const edge = graph.getLink(from, to);
      if (edge) {
        renderGraph.addLink(from, to, edge.data);
      }
    });

  } else if (lastAction.type === "addLayer" || lastAction.type === "addInitialNode") {
    // Entferne Kanten
    lastAction.addedEdges.forEach(([from, to]) => {
      renderGraph.removeLink(from, to);
    });

    // Entferne Knoten
    lastAction.addedNodes.forEach((nodeId) => {
      renderGraph.removeNode(nodeId);
      currentSpecies.delete(nodeId);
    });

    // Wenn initial node, auch initialSpecies anpassen
    if (lastAction.type === "addInitialNode") {
      initialSpecies.delete(lastAction.node);
      currentSpecies.delete(lastAction.node);
      initialSpecies = new Set(initialSpecies);
      currentSpecies = new Set(currentSpecies);
    }
  }

  // Re-Render und ggf. Pfadsuche neu initialisieren
  filterGraph();
  pathSearchGraph = new PathSearchGraph(renderGraph);
}

function updateHiddenElements(newHidden: Set<string>) {
  hiddenElements = newHidden;

  // Für jedes existierende Molekül neu generieren
  moleculeGroups.forEach((oldGroup, nodeId) => {
    const run = runs.get(nodeId);
    if (!run) return;

    // neues Molekül erzeugen (generateMolecule unverändert!)
    const newGroup = moleculeGenerator.generateMolecule(
      run,
      hiddenElements,
      true,
      undefined,
      selectedSpecies,
      nodeId
    );

    // gleiche Skalierung wie altes Molekül beibehalten
    newGroup.scale.copy(oldGroup.scale);
    newGroup.position.copy(oldGroup.position);

    // altes Molekül entfernen
    scene.remove(oldGroup);
    meshes.remove(oldGroup);

    // neues hinzufügen
    scene.add(newGroup);
    meshes.add(newGroup);

    moleculeGroups.set(nodeId, newGroup);
  });
}

function getInputElement(): string {
  const el = document.getElementById("hideInput") as HTMLInputElement;
  return el?.value?.trim() ?? "";
}

function addHiddenElement() {
  const symbol = getInputElement();
  if (!symbol) return;

  hiddenElements.add(symbol);
  updateHiddenElements(hiddenElements);
}

function removeHiddenElement() {
  const symbol = getInputElement();
  if (!symbol) return;

  hiddenElements.delete(symbol);
  updateHiddenElements(hiddenElements);
}

</script>

<div class="page">
  <div
    bind:this={canvasWrapper}
    id="canvas_wrapper"
    class:gaussian_blur={searchVisible}
  >
    <canvas
      bind:this={graphElement}
      on:pointermove={updateMousePosition}
      id="graph_element"
    />
  </div>

  <div class="top-right-button-group">
    <button
      class="settingsButton exportButton"
      on:click={() => exportGraphAsGLTF(scene, "myGraph.gltf")}
      title={isMac ? "⌘ + E" : "Ctrl + E"}
    >
      <picture>
        <img src="/images/download-box.svg" alt="Download icon" />
      </picture>
    </button>

    <button
      class="settingsButton undoButton"
      on:click={undoLastAction}
      title={isMac ? "⌘ + Z" : "Ctrl + Z"}
    >
      <picture>
        <img src="/images/undo.svg" alt="Undo icon" />
      </picture>
    </button>

    <button
      class="settingsButton"
      on:click={() => settingsVisible = !settingsVisible}
      title="Settings"
    >
      <picture>
        <img src="/images/settings.svg" alt="Settings icon" />
      </picture>
    </button>
  </div>

  <div id="keys_overlay">
    <div class="key_input">
      {#if isXrSession}
        <RoundButton key="A"></RoundButton>
      {:else}
        <KeycapButton key="Q"></KeycapButton>
      {/if}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
      <p
        on:click={() => {
          qClick();
        }}
      >add inital species</p>
    </div>
    
    <div class="key_input">
      {#if isXrSession}
        <RoundButton key="B"></RoundButton>
      {:else}
        <KeycapButton key="W"></KeycapButton>
      {/if}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
       <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
      <p
        on:click={() => {
          wClick();
        }}
      >add layer</p>
    </div>

    <div class="key_input">
      {#if isXrSession}
        <RoundButton key="Y"></RoundButton>
      {:else}
        <KeycapButton key="F"></KeycapButton>
      {/if}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
      <p
        on:click={() => {
          fClick();
        }}
      >filter graph</p>
    </div>

    <div class="key_input">
      {#if isXrSession}
        <RoundButton key="X"></RoundButton>
      {:else}
        <KeycapButton key="P"></KeycapButton>
      {/if}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
      <p
        on:click={() => {
          pClick();
        }}
      >find path</p>
    </div>

    <div class="key_input">
      {#if isXrSession}
        <SideButton key="LB"></SideButton>
      {:else}
        <KeycapButton key="R"></KeycapButton>
      {/if}
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
      <p
        on:click={() => {
          rClick();
        }}
      >reset graph</p>
    </div>
  </div>

  <div id="hovered_node" bind:this={cursorInfo}>
    {#if hoveredNode && !pointerIsDown}
      {hoveredNode.userData.name}
    {/if}
  </div>

  {#if searchVisible}
    <div id="search_overlay">
      <div class="search-block">
        <button
          class="close-button"
          on:click={() => {
            searchVisible = false;
            pathSearchVisible = false;
            filterVisible = false;
            settingsVisible = false;
            search_value = "";
          }}>X</button
        >
        <div id="initial_species_search">
          <input
            type="text"
            bind:value={search_value}
            on:input={filterToInitialSpecies}
            placeholder="Search for species"
          />
          <div id="search_results">
            {#each search_results as species}
              <button
                class="search_result"
                on:click={addSpeciesAsInitialSpecies}
                value={species}>{species}</button
              >
            {/each}
          </div>
        </div>
      </div>
      <div id="current_initial_species">
        <h3>Current initial species</h3>
        <div id="inital_species">
          {#each initialSpecies as species}
            <p class="species">{species}</p>
          {/each}
        </div>
      </div>
    </div>
  {/if}
  {#if pathSearchVisible}
    <div id="pathSearchOverlay">
      <button
        style="padding-left: 25%; font-size: 1rem; background-color: transparent; border: none; cursor: pointer"
        on:click={() => {
          searchVisible = false;
          pathSearchVisible = false;
          filterVisible = false;
          settingsVisible = false;
          search_value = "";
        }}>X</button
      >
      <div>
        <datalist id="species">
          {#each currentSpecies as species}
            <option value={species} />
          {/each}
        </datalist>
        <div>
          <div>
            From:
            <ul>
              {#each initialSpecies as node}
                <li>{node}</li>
              {/each}
            </ul>
          </div>
        </div>
        <input
          type="text"
          name="to"
          id="toNode"
          placeholder="To"
          list="species"
        />
        <button
          on:click={() => {
            pathSearchStart = [...initialSpecies];
            const from = pathSearchStart;
            const to = document.getElementById("toNode").value;
            const newShortestPath = pathSearchGraph.shortestPath(
              from,
              to,
            ).shortestPath;
            if (newShortestPath) {
              shortestPath = newShortestPath;
              pathChanged = true;
              rerenderLines = true;
            } else {
              console.error("No path found");
              pathChanged = true;
              rerenderLines = true;
              shortestPath = [];
            }
          }}>Find</button
        >
        <button
          on:click={() => {
            shortestPath = [];
            pathSearchStart = [];
          }}>Clear</button
        >
      </div>
      <div>
        {#if shortestPath.length > 0}
          <div>
            <h3>Shortest path</h3>
            <ul>
              {#each shortestPath as node}
                <li>{node}</li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    </div>
  {/if}
  {#if settingsVisible}
    <div class="overlay">
      <div id="settings">
        <button
          style="position: absolute; top: 0; right: 0; font-size: 1rem;background-color: transparent; border: none; cursor: pointer; padding: 0.5rem"
          on:click={() => {
            settingsVisible = false;
          }}>X</button
        >
        <h2 class="settingsHeader">Settings</h2>
        <h3>Camera</h3>
        <label for="camera">Type</label>
        <select
          name="camera"
          id="camera"
          on:change={(event) => {
            const value = event.target.value;

            if (value == "orthographic") {
              camera.remove(directionalLight);
              camera = orthographicCamera;
              camera.add(directionalLight);
            } else {
              camera.remove(directionalLight);
              camera = perspectiveCamera;
              camera.add(directionalLight);
            }

            controls.enabled = false;
            controls = controllers[camera == perspectiveCamera ? 0 : 1];
            controls.enabled = true;
          }}
          value={camera == perspectiveCamera ? "perspective" : "orthographic"}
        >
          <option value="orthographic">Orthographic</option>
          <option value="perspective">Perspective</option>
        </select>
        <h3>Molecules</h3>
        <label for="moleculeSize">Size</label>
        <input
          type="range"
          min="0"
          max="5"
          value={moleculeSize}
          step="0.05"
          on:input={(event) => {
            moleculeSize = event.target.value;
            resizeMolecules();
          }}
        />
        <h3>Reactions</h3>
        <label for="reactionSize">Size</label>
        <input
          type="range"
          min="0.0"
          max="1.0"
          value={reactionSize}
          step="0.01"
          on:input={(event) => {
            renderGraph.forEachNode((node) => {
              reactionSize = event.target.value;
              if (node.data.type == "reaction") {
                const object = objects.get(node.id);
                if (object === undefined) {
                  return;
                }
                object.scale.set(reactionSize, reactionSize, reactionSize);
              }
            });
          }}
        />
        <h3>Edges</h3>
        <label for="lineWidth">Width</label>
        <input
          type="range"
          min="0"
          max="0.1"
          value={lineWidth}
          step="0.0005"
          on:input={(event) => {
            lineWidth = event.target.value;
            rerenderLines = true;
          }}
        />
        <p>Hide Elements</p>
        <input
          id="hideInput"
          placeholder="z.B. Cu oder O"
          on:keydown={(e) => {
            if (e.key === 'Enter') addHiddenElement();
          }}
        />
        <button on:click={addHiddenElement}>Hide</button>
        <button on:click={removeHiddenElement}>Show</button>
        <!-- zur Übersicht -->
        <p>Hidden: {Array.from(hiddenElements).join(", ")}</p>
        <!-- <h3>Layout</h3>
        <select
          on:change={(e) => {
            const value = e.target.value;

            if (value === "force3d") {
              viewMode = "force3d";
              rebuildLayout(3);
            } else {
              viewMode = "energy2d";
              rebuildLayout(2);
              computeEnergyZ();
            }
          }}
          value={viewMode}
        >
          <option value="force3d">3D Force Layout</option>
          <option value="energy2d">2D Energy Plane</option>
        </select> -->
      </div>
    </div>
  {/if}

  {#if filterVisible}
    <div class="overlay" style="backdrop-filter: blur(10px);">
      <div class="filters_overlay">
        <button
          style="display: flex; align-self: end; font-size: 1rem; background-color: transparent; border: none; cursor: pointer"
          on:click={() => {
            searchVisible = false;
            pathSearchVisible = false;
            filterVisible = false;
            settingsVisible = false;
            search_value = "";
          }}>X</button
        >
        <div class="filter_overlay">
          <div style="pointer-events: all;">
            <p>Elements</p>
            <select name="filterElement" id="filterElement">
              <option value="C">C</option>
              <option value="H">H</option>
              <option value="O">O</option>
              <option value="N">N</option>
              <option value="F">F</option>
              <option value="Cl">Cl</option>
              <option value="Br">Br</option>
              <option value="I">I</option>
              <option value="P">P</option>
              <option value="S">S</option>
            </select>
            <select name="operator" id="filterElementOperator">
              {#each COUNT_OPERATORS.keys() as key}
                <option value={key}>{key}</option>
              {/each}
            </select>
            <input type="number" id="filterElementInput" />
            <button
              on:click={() => {
                const element = document.getElementById("filterElement").value;
                const operatorKey = document.getElementById("filterElementOperator").value;
                const operator = COUNT_OPERATORS.get(operatorKey);
                const count = document.getElementById("filterElementInput").value;
                let filterId = crypto.randomUUID();

                allFilters.push({
                  id: filterId,
                  type: "species",
                  fn: (node) => filterByAtomCount(node, element, count, operator),
                  sentence: `Remove all molecules where the number of ${element} atoms is ${FILTERWORDS.get(operatorKey)} ${count}`,
                  removedNodes: [],
                  removedEdges: [],
                });
                undoStack.push({ type: "filter", filterId: filterId });

                allFilters = allFilters;

                document.getElementById("filterElement").value = "C";
                document.getElementById("filterElementOperator").value = "==";
                document.getElementById("filterElementInput").value = "";
                filterApplied = true;
                filterGraph();
                pathSearchGraph = new PathSearchGraph(renderGraph);
              }}>Add</button
            >
          </div>
        </div>
        <div class="filter_overlay">
          <div style="pointer-events: all;">
            <p>Charge</p>
            <select name="operator" id="filterChargeOperator">
              {#each COUNT_OPERATORS.keys() as key}
                <option value={key}>{key}</option>
              {/each}
            </select>
            <input type="number" step="1" id="filterChargeInput" />
            <button
              on:click={() => {
                const chargeOperatorKey = document.getElementById("filterChargeOperator").value;
                const chargeOperator = COUNT_OPERATORS.get(chargeOperatorKey);
                const cargeCount = document.getElementById("filterChargeInput").value;
                let filterId = crypto.randomUUID();

                allFilters.push({
                  id: filterId,
                  type: "species",
                  fn: (node) => filterChargeCount(node, cargeCount, chargeOperator),
                  sentence: `Remove all molecules where the charge is ${FILTERWORDS.get(chargeOperatorKey)} ${cargeCount}`,
                  removedNodes: [],
                  removedEdges: [],
                });
                undoStack.push({ type: "filter", filterId: filterId });

                allFilters = allFilters;

                document.getElementById("filterChargeOperator").value = "==";
                document.getElementById("filterChargeInput").value = "";
                filterApplied = true;
                filterGraph();
                pathSearchGraph = new PathSearchGraph(renderGraph);
              }}>Add</button
            >
          </div>
        </div>
        <div class="filter_overlay">
          <div style="pointer-events: all;">
            <p>Multiplicity</p>
            <select name="operator" id="filterMultiplicityOperator">
              {#each COUNT_OPERATORS.keys() as key}
                <option value={key}>{key}</option>
              {/each}
            </select>
            <input type="number" step="1" id="filterMultiplicityInput" />
            <button
              on:click={() => {
                const multiplicityOperatorKey = document.getElementById("filterMultiplicityOperator").value;
                const multiplicityOperator = COUNT_OPERATORS.get(multiplicityOperatorKey);
                const multiplicityCount = document.getElementById("filterMultiplicityInput").value;
                let filterId = crypto.randomUUID();

                allFilters.push({
                  id: filterId,
                  type: "species",
                  fn: (node) => filterMultiplicityCount(node, multiplicityCount, multiplicityOperator),
                  sentence: `Remove all molecules where the spin-multilpicity is ${FILTERWORDS.get(multiplicityOperatorKey)} ${multiplicityCount}`,
                  removedNodes: [],
                  removedEdges: [],
                });
                undoStack.push({ type: "filter", filterId: filterId });

                allFilters = allFilters;

                document.getElementById("filterMultiplicityOperator").value = "==";
                document.getElementById("filterMultiplicityInput").value = "";
                filterApplied = true;
                filterGraph();
                pathSearchGraph = new PathSearchGraph(renderGraph);
              }}>Add</button
            >
          </div>
        </div>
        <div class="filter_overlay">
          <div style="pointer-events: all;">
            <p>Remove duplicate reactions based on educt permutation</p>
            <button
              on:click={() => {  
                const duplicateReactionFilterFn = filterDuplicateReactions(seenReactions);
                let filterId = crypto.randomUUID();
                
                allFilters.push({
                  id: filterId,
                  type: "reaction",
                  fn: duplicateReactionFilterFn,
                  sentence: `Remove duplicate reactions based on educt permutation`,
                  removedNodes: [],
                  removedEdges: [],
                });
                undoStack.push({ type: "filter", filterId: filterId });

                allFilters = allFilters;

                filterApplied = true;
                filterGraph();
                pathSearchGraph = new PathSearchGraph(renderGraph);
              }}
          >Add</button>
          </div>
        </div>
        {#each allFilters as filter (filter.id)}
          <div style="display: flex; align-items: center">
            <p>{filter.sentence}</p>
            <button
              style="margin-left: 0.5rem; height: fit-content"
              on:click={() => removeFilter(filter.id)}
            >Remove</button>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<svelte:window on:keydown={onKeyDown} />

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
}

.overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.filters_overlay {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
}

.filter_overlay {
  display: flex;
  flex-direction: row;
}

#settings {
  position: relative;
  pointer-events: all;
  background-color: lightgray;
  width: min(80%, 40rem);
  min-height: 20rem;
  max-height: 80%;
  overflow: auto;
  padding: 1rem;
  font-family: "Quicksand", sans-serif;
  border-radius: 6px;
}

.settingsHeader {
  font-size: 1.5rem;
  font-family: "Quicksand", sans-serif;
  margin: 0px;
  padding: 0px;
  position: sticky;
}

#pathSearchOverlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  backdrop-filter: blur(10px);
}

#search_overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  font-family: "Quicksand", sans-serif;

  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 0.4fr auto 0.1fr;
  grid-template-areas:
    ". . ."
    ". search_block current_initial_species"
    ". . .";
}

.search-block {
  grid-area: search_block;
  width: 45rem;
  max-width: 100%;

  display: flex;
  flex-direction: column;
  align-items: stretch;
  position: relative;
}

.close-button {
  align-self: flex-end;
  background: transparent;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0 0.5rem;
  margin-bottom: 0.25rem;
  user-select: none;
  color: #000;
}

.gaussian_blur {
  filter: blur(10px);
}

#initial_species_search {
  display: flex;
  flex-direction: column;
  align-items: center;
}

#current_initial_species {
  grid-area: current_initial_species;
  max-width: 100%;
  margin-left: 0.5rem;
}

#initial_species_search > input {
  width: 100%;
  font-size: 1.5em;
  font-family: "Quicksand", sans-serif;
  padding: 0.5rem;
  box-sizing: border-box;
  border-radius: 6px 6px 0 0;
  border: 2px solid #000;
}

#search_results {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: flex-start;
}

.species {
  margin: 0px;
}

#search_results::after {
  content: "";
  width: 100%;
  height: 1rem;
  border-bottom-left-radius: 6px;
  border-bottom-right-radius: 6px;
  background-color: lightgray;
}

.search_result {
  background-color: lightgray;
  border: none;
  padding: 0.25rem 0.5rem;
  width: 100%;
  font-size: 1.5rem;
  font-family: "Quicksand", sans-serif;
  font-weight: 400;
  color: #000;
  text-align: left;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
  max-width: 100%;
}

.search_result:hover {
  background-color: darkgray;
}

.search_result:active {
  background-color: gray;
}

:global(html) {
  margin: 0px;
  padding: 0px;
  width: 100%;
  height: 100%;
}

:global(body) {
  margin: 0px;
  padding: 0px;
  width: 100%;
  height: 100%;
}

#hovered_node {
  position: absolute;
  pointer-events: none;
  font-size: 1.2rem;
  font-family: "Quicksand", sans-serif;
  backdrop-filter: blur(2px);
  border-radius: 6px;
  transform: translate(0px, 40px);
}

.key_input {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: center;
}

.key_input > p {
  margin-block-start: 0px;
  margin-block-end: 0px;
  margin: 0px;
  padding: 0px;
  margin-bottom: 0.2em;
  margin-left: 0.5rem;
}

#keys_overlay {
  z-index: 100;
  position: absolute;
  bottom: 2rem;
  left: auto;
  right: 2rem;
  font-size: 1.5em;
  font-family: "Quicksand", sans-serif;
  display: flex;
  flex-direction: column;
  gap: 0.1em;
  align-items: flex-start;
}

#canvas_wrapper {
  width: 100%;
  height: 100%;
  padding: 0px;
  margin: 0px;
  position: relative;
}

#graph_element {
  width: 100%;
  height: 100%;
  padding: 0px;
  margin: 0px;
}

.page {
  width: 100%;
  height: 100%;
  padding: 0px;
  margin: 0px;
  position: relative;
  overflow: hidden;
}

.page h1 {
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

.top-right-button-group {
  position: absolute;
  top: 0;
  right: 0;
  margin: 15px;
  display: flex;
  gap: 0.5rem;
  z-index: 100;
  pointer-events: all;
}

.settingsButton {
  width: 2rem;
  height: 2rem;
  padding: 0;
  background: none;
  border: none;
  cursor: pointer;
  pointer-events: all;
  display: flex;
  align-items: center;
  justify-content: center;
}

.settingsButton img {
  width: 100%;
  height: 100%;
  object-fit: contain;
}


@media (max-width: 400px) {
  #keys_overlay {
    display: none;
  }
}
</style>
