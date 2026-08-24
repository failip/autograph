<script lang="ts">
import {
  filterByAtomCount,
  filterChargeCount,
  filterDuplicateReactions,
  filterMultiplicityCount,
  FILTERWORDS,
} from "$lib/filter/filter";
import { PathSearchGraph } from "$lib/graphs/graph";
import Fuse from "fuse.js";
import createLayout, { type Spring } from "ngraph.forcelayout";
import createGraph, {
  type Graph,
  type Link,
  type Node,
  type NodeId,
} from "ngraph.graph";
import KeycapButton from "$lib/ui/KeycapButton.svelte";
import RoundButton from "$lib/ui/RoundButton.svelte";
import SideButton from "$lib/ui/SideButton.svelte";

import { COUNT_OPERATORS, type Filter } from "$lib/filter/filter";
import type { GraphEvent, GraphEventHandler } from "$lib/graphs/graph-events";
import { HdrSceneBackground } from "$lib/rendering/background";
import { MoleculeGenerator } from "$lib/rendering/molecules";
import { ObjectOrbitControls } from "$lib/rendering/ObjectOrbitControls";
import {
  getTrajectoryCameraDistance,
  getTrajectoryXrObjectDistance,
  TRAJECTORY_CAMERA_FOV,
  TrajectoryPlaybackObject,
} from "$lib/rendering/TrajectoryViewer.js";
import { parseRun, type Run } from "$lib/rendering/xyz.js";
import {
  VRControls,
  type VRControllerHints,
} from "$lib/vr/controls/VRControls";
import { onMount } from "svelte";
import {
  AmbientLight,
  Box3,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  InstancedMesh,
  LineBasicMaterial,
  Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

export let graph: Graph;
export let secondaryGraphs: Graph[] = [];
export let xyzPath: string;
export let xyzFallbackPaths: string[] = [];
export let deferredNodeIds: readonly string[] = [];
export let useHash: boolean = false;
export let xyzFiles: Map<string, File> | null = null;
export let startSpecies: string[] = [];
export let webXR: boolean = false;
export let hideCu: boolean = false;
export let onGraphEvent: GraphEventHandler | undefined = undefined;

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
let controls: ObjectOrbitControls | VRControls;
let controllers: [ObjectOrbitControls, ObjectOrbitControls];

const GRAPH_VR_CONTROLLER_HINTS: VRControllerHints = {
  left: {
    hints: [{ input: "STICK Y", action: "Zoom", icon: "thumbstick-y" }],
  },
  right: {
    hints: [
      { input: "A", action: "Select molecule", icon: "button-a" },
      { input: "B", action: "Add layer", icon: "button-b" },
      {
        input: "STICK X/Y",
        action: "Rotate graph",
        icon: "thumbstick-xy",
      },
    ],
  },
};
const GRAPH_XR_OBJECT_DISTANCE = 45;
let directionalLight: DirectionalLight;
let lineInstances: InstancedMesh;
let cameraTarget = new Vector3();
let newCameraTarget = new Vector3();
let zoomTarget = 10.0;
let zoomFinished = true;
let lockedOnMolecule = false;
let initializeVR: () => void;

let allMoleculesVisible = true;

let cursorInfo: HTMLDivElement;
let pointerIsDown = false;
let xrError = "";

type ReactionTrajectoryPlayback = {
  reactionId: string;
  xyzText: string;
  onComplete?: () => void;
};

type ReactionTrajectoryStarter = (playback: ReactionTrajectoryPlayback) => void;

const REACTION_TRAJECTORY_FADE_MS = 350;
const reactionTrajectoryQueue: ReactionTrajectoryPlayback[] = [];
let activeReactionTrajectory: ReactionTrajectoryPlayback | null = null;
let reactionGraphFaded = false;
let reactionTrajectoryVisible = false;
let reactionTrajectoryStarting = false;
let reactionTrajectoryCompleting = false;
let reactionTrajectoryLoadChain = Promise.resolve();
let startReactionTrajectoryPlayback: ReactionTrajectoryStarter | null = null;
let layerCommitPending = false;
let reactionPlaybackActive = false;

$: reactionPlaybackActive =
  layerCommitPending || reactionGraphFaded || activeReactionTrajectory !== null;

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
  | {
      type: "addInitialNode";
      node: NodeId;
      addedNodes: NodeId[];
      addedEdges: [NodeId, NodeId][];
    };
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
const initiallyDeferredNodeIds = new Set<NodeId>(deferredNodeIds);
let enabledGraphNodeIds = new Set<NodeId>();
type NodeFadeInTiming = { durationMs: number; delayMs: number };
const pendingNodeFadeIns = new Map<string, NodeFadeInTiming>();

function resetEnabledGraphNodeIds(): void {
  enabledGraphNodeIds = new Set<NodeId>();
  graph.forEachNode((node) => {
    if (!initiallyDeferredNodeIds.has(node.id)) {
      enabledGraphNodeIds.add(node.id);
    }
  });
}

function isGraphNodeEnabled(nodeId: NodeId): boolean {
  return enabledGraphNodeIds.has(nodeId);
}

resetEnabledGraphNodeIds();

function emitGraphEvent(event: GraphEvent): void {
  onGraphEvent?.(event);
}

function setSpeciesSelected(nodeId: string, selected: boolean): boolean {
  const selectionChanged = selected !== selectedSpecies.has(nodeId);
  if (!selectionChanged) return false;

  if (selected) {
    selectedSpecies.add(nodeId);
  } else {
    selectedSpecies.delete(nodeId);
  }

  emitGraphEvent({
    type: "selection-changed",
    speciesId: nodeId,
    selected,
    selectedSpecies: Array.from(selectedSpecies),
  });
  return true;
}

function toggleSpeciesSelection(nodeId: string): void {
  setSpeciesSelected(nodeId, !selectedSpecies.has(nodeId));
}

function clearSpeciesSelection(): string[] {
  const previouslySelected = Array.from(selectedSpecies);
  for (const nodeId of previouslySelected) {
    setSpeciesSelected(nodeId, false);
  }
  return previouslySelected;
}

export function addInitialSpecies(
  speciesIds: readonly string[],
  fadeInDurationMs = 0,
  fadeInDelayMs = 0,
): string[] {
  const addedSpecies: string[] = [];

  for (const speciesId of new Set(speciesIds)) {
    if (initialSpecies.has(speciesId)) continue;

    const node = graph.getNode(speciesId);
    if (
      !node ||
      node.data?.type !== "species" ||
      !isGraphNodeEnabled(speciesId)
    ) {
      console.warn(`Cannot add unknown graph species: ${speciesId}`);
      continue;
    }

    if (
      (fadeInDurationMs > 0 || fadeInDelayMs > 0) &&
      !renderGraph.hasNode(speciesId)
    ) {
      pendingNodeFadeIns.set(speciesId, {
        durationMs: fadeInDurationMs,
        delayMs: fadeInDelayMs,
      });
    }
    addInitialNode(speciesId);
    addedSpecies.push(speciesId);
  }

  return addedSpecies;
}

export function addGraphContent(
  nodeIds: readonly string[],
  fadeInDurationMs = 0,
  fadeInDelayMs = 0,
): string[] {
  const requestedNodeIds = new Set<NodeId>();
  const addedNodeIds: NodeId[] = [];

  for (const nodeId of new Set(nodeIds)) {
    if (graph.hasNode(nodeId)) {
      requestedNodeIds.add(nodeId);
      enabledGraphNodeIds.add(nodeId);
    }
  }

  renderGraph.beginUpdate();
  try {
    requestedNodeIds.forEach((nodeId) => {
      if (renderGraph.hasNode(nodeId)) return;

      const node = graph.getNode(nodeId);
      if (!node) return;

      if (fadeInDurationMs > 0 || fadeInDelayMs > 0) {
        pendingNodeFadeIns.set(String(nodeId), {
          durationMs: fadeInDurationMs,
          delayMs: fadeInDelayMs,
        });
      }

      node.data.inSecondaryGraphs = secondaryGraphs.every((secondaryGraph) =>
        secondaryGraph.hasNode(nodeId),
      );
      renderGraph.addNode(nodeId, node.data);
      addedNodeIds.push(nodeId);

      if (node.data.type === "species") {
        currentSpecies.add(String(nodeId));
      }
    });

    graph.forEachLink((link) => {
      if (
        !requestedNodeIds.has(link.fromId) ||
        !requestedNodeIds.has(link.toId) ||
        renderGraph.hasLink(link.fromId, link.toId)
      ) {
        return;
      }

      renderGraph.addLink(link.fromId, link.toId, link.data);
    });
  } finally {
    renderGraph.endUpdate();
  }

  currentSpecies = new Set(currentSpecies);

  return addedNodeIds.map(String);
}

if (hideCu) {
  hiddenElements.add("Cu");
}

function getXyzBasePaths(): string[] {
  return [xyzPath, ...xyzFallbackPaths]
    .filter(Boolean)
    .map((path) => (path.endsWith("/") ? path : `${path}/`));
}

function getNamedXyzUrls(name: string): string[] {
  const candidates = getXyzBasePaths().flatMap((basePath) => [
    `${basePath}${encodeURIComponent(name)}.xyz`,
    `${basePath}${name}.xyz`,
  ]);

  return [...new Set(candidates)];
}

async function fetchXyzTextByName(
  name: string,
  fallbackName?: string,
): Promise<string | null> {
  const file = xyzFiles?.get(`${name}.xyz`);
  if (file) {
    return file.text();
  }

  const fallbackFile = fallbackName
    ? xyzFiles?.get(`${fallbackName}.xyz`)
    : undefined;
  if (fallbackFile) {
    return fallbackFile.text();
  }

  for (const url of getNamedXyzUrls(name)) {
    const response = await fetch(url);
    if (response.ok) {
      return response.text();
    }
  }

  if (fallbackName) {
    for (const fallbackUrl of getNamedXyzUrls(fallbackName)) {
      const fallbackResponse = await fetch(fallbackUrl);
      if (fallbackResponse.ok) {
        return fallbackResponse.text();
      }
    }
  }

  return null;
}

function playReactionTrajectoriesBefore(
  reactionIds: readonly string[],
  onComplete: () => void,
): void {
  let completed = false;
  const completeOnce = () => {
    if (completed) return;
    completed = true;
    onComplete();
  };

  reactionTrajectoryLoadChain = reactionTrajectoryLoadChain
    .then(async () => {
      const playbacks: ReactionTrajectoryPlayback[] = [];

      for (const reactionId of new Set(reactionIds)) {
        try {
          const xyzText = await fetchXyzTextByName(reactionId);
          if (xyzText) {
            playbacks.push({ reactionId, xyzText });
          }
        } catch {
          // Missing or unavailable reaction trajectories are expected.
        }
      }

      if (playbacks.length === 0) {
        completeOnce();
        return;
      }

      const finalPlayback = playbacks.at(-1);
      if (!finalPlayback) {
        completeOnce();
        return;
      }

      finalPlayback.onComplete = completeOnce;
      reactionTrajectoryQueue.push(...playbacks);
      void processReactionTrajectoryQueue();
    })
    .catch(completeOnce);
}

function processReactionTrajectoryQueue(): void {
  if (
    reactionTrajectoryStarting ||
    reactionTrajectoryCompleting ||
    activeReactionTrajectory ||
    !startReactionTrajectoryPlayback ||
    reactionTrajectoryQueue.length === 0
  ) {
    return;
  }

  reactionTrajectoryStarting = true;
  activeReactionTrajectory = reactionTrajectoryQueue.shift() ?? null;
  reactionGraphFaded = true;
  reactionTrajectoryVisible = false;

  if (!activeReactionTrajectory) {
    reactionGraphFaded = false;
    reactionTrajectoryStarting = false;
    return;
  }

  startReactionTrajectoryPlayback(activeReactionTrajectory);
}

function handleReactionTrajectoryComplete(): void {
  const completedTrajectory = activeReactionTrajectory;
  activeReactionTrajectory = null;
  reactionGraphFaded = false;
  reactionTrajectoryVisible = false;
  reactionTrajectoryStarting = false;
  reactionTrajectoryCompleting = false;
  completedTrajectory?.onComplete?.();
  void processReactionTrajectoryQueue();
}

// Begin VR adapdter
let xrSession: XRSession | null = null;
let isXrSession = false;

setupXRSession().catch((err) => {
  console.error("Fehler beim Starten der XR Session:", err);
});

async function isInlineXrAvailable(): Promise<boolean> {
  if (!("xr" in navigator)) return false;
  try {
    return await navigator.xr.isSessionSupported("inline");
  } catch {
    return false;
  }
}

async function setupXRSession() {
  if (!("xr" in navigator)) {
    console.warn("WebXR wird nicht unterstützt.");
    return;
  }

  let supported = false;
  try {
    supported = await navigator.xr.isSessionSupported("immersive-ar");
  } catch (err) {
    console.error("Fehler beim Prüfen von WebXR-Unterstützung:", err);
    return;
  }

  if (!supported) {
    console.warn("Immersive VR wird nicht unterstützt.");
    return;
  }

  console.log("WebXR und immersive-vr werden unterstützt. Setup beginnt...");

  xrSession = await navigator.xr.requestSession("inline");
  console.log("XR inline Session gestartet");

  xrSession.addEventListener("inputsourceschange", () => {
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
  hand: XRHandedness,
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
}

function onLowerButtonPress(hand: XRHandedness) {
  console.log(`→ Aktion: Lower button (${hand})`);
  if (hand === "left") {
    pClick();
  } else {
    qClick();
  }
}

function onUpperButtonPress(hand: XRHandedness) {
  console.log(`→ Aktion: Upper button (${hand})`);
  if (hand === "left") {
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

const dimensions = 3;
const layout = createLayout(renderGraph, {
  timeStep: 0.5,
  dimensions: dimensions,
  theta: 0.5,
  gravity: -1.5,
});
// Weak, layout-only springs keep disconnected components close without
// creating visible graph links or overriding positions after each step.
const disconnectedComponentSprings: Spring[] = [];
let disconnectedComponentSpringsDirty = true;

function getDisconnectedComponentAnchors(): NodeId[] {
  const anchors: NodeId[] = [];
  const visited = new Set<NodeId>();

  renderGraph.forEachNode((node) => {
    if (visited.has(node.id)) return;

    const queue = [node.id];
    let anchor = node.id;
    let anchorDegree = node.links?.size ?? 0;
    visited.add(node.id);

    while (queue.length > 0) {
      const nodeId = queue.shift();
      if (nodeId === undefined) continue;

      const currentNode = renderGraph.getNode(nodeId);
      const currentDegree = currentNode?.links?.size ?? 0;
      if (
        currentDegree > anchorDegree ||
        (currentDegree === anchorDegree &&
          String(nodeId).localeCompare(String(anchor)) < 0)
      ) {
        anchor = nodeId;
        anchorDegree = currentDegree;
      }

      currentNode?.links?.forEach((link) => {
        const neighborId = link.fromId === nodeId ? link.toId : link.fromId;
        if (visited.has(neighborId)) return;

        visited.add(neighborId);
        queue.push(neighborId);
      });
    }

    anchors.push(anchor);
  });

  return anchors.sort((left, right) =>
    String(left).localeCompare(String(right)),
  );
}

function syncDisconnectedComponentSprings(): void {
  disconnectedComponentSprings.forEach((spring) => {
    layout.simulator.removeSpring(spring);
  });
  disconnectedComponentSprings.length = 0;

  const anchors = getDisconnectedComponentAnchors();
  if (anchors.length < 2) return;

  const springLength = layout.simulator.settings.springLength * 1.25;
  const springCoefficient =
    layout.simulator.settings.springCoefficient * 0.2;
  const springCount = anchors.length === 2 ? 1 : anchors.length;

  for (let index = 0; index < springCount; index++) {
    const fromBody = layout.getBody(anchors[index]);
    const toBody = layout.getBody(anchors[(index + 1) % anchors.length]);
    if (!fromBody || !toBody) continue;

    disconnectedComponentSprings.push(
      layout.simulator.addSpring(
        fromBody,
        toBody,
        springLength,
        springCoefficient,
      ),
    );
  }
}

const objects = new Map<string, Object3D>();

onMount(async () => {
  if (!(await isInlineXrAvailable())) {
    console.warn("XR nicht verfügbar.");
  } else {
    const supported = await navigator.xr.isSessionSupported("inline");
    if (!supported) {
      console.warn("WebXR inline-Modus nicht unterstützt.");
      return;
    }

    const session = await navigator.xr.requestSession("inline");
    console.log("XR inline Session gestartet");

    session.requestAnimationFrame(function onXRFrame(
      time: DOMHighResTimeStamp,
      frame: XRFrame,
    ) {
      session.requestAnimationFrame(onXRFrame);
    });
  }

  function getElementAtCenter(): HTMLElement | null {
    const x = window.innerWidth / 2;
    const y = window.innerHeight / 2;
    return document.elementFromPoint(x, y) as HTMLElement | null;
  }

  function simulateClick(el: HTMLElement) {
    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      view: window,
    });
    el.dispatchEvent(event);
  }

  const scene = new Scene();
  const graphRoot = new Object3D();
  graphRoot.name = "Graph Object Stage";
  scene.add(graphRoot);

  type ReactionPlaybackPhase =
    | "idle"
    | "fadeGraphOut"
    | "fadeTrajectoryIn"
    | "playing"
    | "fadeTrajectoryOut"
    | "fadeGraphIn";

  type GraphMaterialSnapshot = {
    material: Material;
    opacity: number;
    transparent: boolean;
  };

  type TrajectoryCameraSnapshot = {
    activeCamera: PerspectiveCamera | OrthographicCamera;
    activeControls: ObjectOrbitControls | VRControls;
    controlsTarget: Vector3 | null;
    cameraTarget: Vector3;
    newCameraTarget: Vector3;
    zoomTarget: number;
    zoomFinished: boolean;
    perspectivePosition: Vector3;
    perspectiveQuaternion: Quaternion;
    perspectiveFov: number;
    perspectiveAspect: number;
    perspectiveZoom: number;
    perspectiveNear: number;
    perspectiveFar: number;
  };

  let reactionPlaybackPhase: ReactionPlaybackPhase = "idle";
  let reactionPhaseElapsed = 0;
  let reactionPlaybackObject: TrajectoryPlaybackObject | null = null;
  let graphMaterialSnapshot: GraphMaterialSnapshot[] = [];
  let trajectoryCameraSnapshot: TrajectoryCameraSnapshot | null = null;
  let lastGraphAnimationTime = 0;
  const trajectoryOrigin = new Vector3(0, 0, 0);
  const nodeFadeIns = new Map<
    string,
    NodeFadeInTiming & { startedAt: number }
  >();

  function getFadeProgress(deltaSeconds: number): number {
    reactionPhaseElapsed += Math.max(0, deltaSeconds);
    const fadeSeconds = REACTION_TRAJECTORY_FADE_MS / 1000;
    if (fadeSeconds <= 0) return 1;
    return Math.min(1, reactionPhaseElapsed / fadeSeconds);
  }

  function getObjectMaterials(object: Object3D): Material[] {
    if (!(object instanceof Mesh)) return [];
    return Array.isArray(object.material) ? object.material : [object.material];
  }

  function applyNodeFadeOpacity(
    nodeId: string,
    object: Object3D,
    alpha: number,
  ): void {
    const targetOpacity = graph.getNode(nodeId)?.data.inSecondaryGraphs
      ? 1
      : 0.1;
    const opacity = targetOpacity * Math.max(0, Math.min(1, alpha));

    object.traverse((child) => {
      getObjectMaterials(child).forEach((material) => {
        material.opacity = opacity;
        material.transparent = opacity < 1;
        material.needsUpdate = true;
      });
    });
  }

  function getNodeFadeProgress(
    fade: NodeFadeInTiming & { startedAt: number },
    time: number,
  ): number {
    const fadeElapsedMs = time - fade.startedAt - fade.delayMs;
    if (fadeElapsedMs <= 0) return 0;
    if (fade.durationMs <= 0) return 1;
    return Math.min(1, fadeElapsedMs / fade.durationMs);
  }

  function startNodeFadeIn(nodeId: string, object: Object3D): void {
    const timing = pendingNodeFadeIns.get(nodeId);
    if (!timing) return;

    pendingNodeFadeIns.delete(nodeId);
    nodeFadeIns.set(nodeId, {
      startedAt: performance.now(),
      ...timing,
    });
    applyNodeFadeOpacity(nodeId, object, 0);
  }

  function applyCurrentNodeFade(nodeId: string, object: Object3D): void {
    const fade = nodeFadeIns.get(nodeId);
    if (!fade) return;
    applyNodeFadeOpacity(
      nodeId,
      object,
      getNodeFadeProgress(fade, performance.now()),
    );
  }

  function updateNodeFadeIns(time: number): void {
    nodeFadeIns.forEach((fade, nodeId) => {
      if (!renderGraph.hasNode(nodeId)) {
        nodeFadeIns.delete(nodeId);
        return;
      }

      const object = objects.get(nodeId);
      if (!object) return;

      const progress = getNodeFadeProgress(fade, time);
      applyNodeFadeOpacity(nodeId, object, progress);
      if (progress >= 1) {
        nodeFadeIns.delete(nodeId);
      }
    });
  }

  function captureGraphMaterialSnapshot(): GraphMaterialSnapshot[] {
    const snapshots = new Map<Material, GraphMaterialSnapshot>();

    graphRoot.traverse((object) => {
      getObjectMaterials(object).forEach((material) => {
        if (snapshots.has(material)) return;
        snapshots.set(material, {
          material,
          opacity: material.opacity,
          transparent: material.transparent,
        });
      });
    });

    return [...snapshots.values()];
  }

  function applyGraphOpacity(alpha: number): void {
    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    graphMaterialSnapshot.forEach(({ material, opacity, transparent }) => {
      material.opacity = opacity * clampedAlpha;
      material.transparent = transparent || clampedAlpha < 1;
      material.needsUpdate = true;
    });
  }

  function restoreGraphOpacity(): void {
    graphMaterialSnapshot.forEach(({ material, opacity, transparent }) => {
      material.opacity = opacity;
      material.transparent = transparent;
      material.needsUpdate = true;
    });
    graphMaterialSnapshot = [];
  }

  function disposeReactionPlaybackObject(): void {
    if (!reactionPlaybackObject) return;
    scene.remove(reactionPlaybackObject.root);
    reactionPlaybackObject.dispose();
    reactionPlaybackObject = null;
  }

  function snapshotTrajectoryCamera(): void {
    if (isXrSession || trajectoryCameraSnapshot) return;

    trajectoryCameraSnapshot = {
      activeCamera: camera,
      activeControls: controls,
      controlsTarget:
        controls instanceof ObjectOrbitControls
          ? controls.target.clone()
          : null,
      cameraTarget: cameraTarget.clone(),
      newCameraTarget: newCameraTarget.clone(),
      zoomTarget,
      zoomFinished,
      perspectivePosition: perspectiveCamera.position.clone(),
      perspectiveQuaternion: perspectiveCamera.quaternion.clone(),
      perspectiveFov: perspectiveCamera.fov,
      perspectiveAspect: perspectiveCamera.aspect,
      perspectiveZoom: perspectiveCamera.zoom,
      perspectiveNear: perspectiveCamera.near,
      perspectiveFar: perspectiveCamera.far,
    };
  }

  function applyTrajectoryCameraSettings(
    playback: TrajectoryPlaybackObject,
  ): void {
    if (isXrSession) return;

    snapshotTrajectoryCamera();

    camera = perspectiveCamera;
    controls = controllers[0];
    perspectiveCamera.fov = TRAJECTORY_CAMERA_FOV;
    perspectiveCamera.aspect =
      canvasWrapper.clientWidth / Math.max(canvasWrapper.clientHeight, 1);
    perspectiveCamera.zoom = 1;
    perspectiveCamera.near = 0.01;
    perspectiveCamera.far = 1000;
    perspectiveCamera.position.set(
      0,
      0,
      getTrajectoryCameraDistance(playback.viewRadius),
    );
    perspectiveCamera.lookAt(trajectoryOrigin);
    perspectiveCamera.updateProjectionMatrix();

    cameraTarget.copy(trajectoryOrigin);
    newCameraTarget.copy(trajectoryOrigin);
    zoomTarget = perspectiveCamera.zoom;
    zoomFinished = true;

    if (controls instanceof ObjectOrbitControls) {
      controls.target.copy(trajectoryOrigin);
      controls.update();
    }
  }

  function restoreTrajectoryCameraSettings(): void {
    if (!trajectoryCameraSnapshot) return;

    const snapshot = trajectoryCameraSnapshot;
    perspectiveCamera.position.copy(snapshot.perspectivePosition);
    perspectiveCamera.quaternion.copy(snapshot.perspectiveQuaternion);
    perspectiveCamera.fov = snapshot.perspectiveFov;
    perspectiveCamera.aspect = snapshot.perspectiveAspect;
    perspectiveCamera.zoom = snapshot.perspectiveZoom;
    perspectiveCamera.near = snapshot.perspectiveNear;
    perspectiveCamera.far = snapshot.perspectiveFar;
    perspectiveCamera.updateProjectionMatrix();

    camera = snapshot.activeCamera;
    controls = snapshot.activeControls;
    cameraTarget.copy(snapshot.cameraTarget);
    newCameraTarget.copy(snapshot.newCameraTarget);
    zoomTarget = snapshot.zoomTarget;
    zoomFinished = snapshot.zoomFinished;

    if (snapshot.controlsTarget && controls instanceof ObjectOrbitControls) {
      controls.target.copy(snapshot.controlsTarget);
      controls.update();
    }

    trajectoryCameraSnapshot = null;
  }

  function positionReactionPlaybackObject(
    playback: TrajectoryPlaybackObject,
  ): void {
    playback.root.rotation.set(0, 0, 0);

    if (isXrSession) {
      const distance = getTrajectoryXrObjectDistance(playback.viewRadius);
      playback.root.position.set(0, 0, -distance);
      playback.root.scale.setScalar(1);
      return;
    }

    playback.root.position.copy(trajectoryOrigin);
    playback.root.scale.setScalar(1);
  }

  function startTrajectoryFadeOut(): void {
    if (reactionPlaybackPhase !== "playing") return;
    reactionPlaybackPhase = "fadeTrajectoryOut";
    reactionPhaseElapsed = 0;
    reactionTrajectoryCompleting = true;
    reactionTrajectoryVisible = false;
  }

  function finishReactionPlayback(): void {
    restoreGraphOpacity();
    graphRoot.visible = true;
    disposeReactionPlaybackObject();
    reactionPlaybackPhase = "idle";
    reactionPhaseElapsed = 0;
    handleReactionTrajectoryComplete();
  }

  function updateReactionPlayback(deltaSeconds: number): void {
    if (!reactionPlaybackObject && reactionPlaybackPhase !== "fadeGraphIn") {
      return;
    }

    if (reactionPlaybackPhase === "fadeGraphOut") {
      if (!reactionPlaybackObject) return;
      const progress = getFadeProgress(deltaSeconds);
      applyGraphOpacity(1 - progress);

      if (progress >= 1) {
        graphRoot.visible = false;
        applyTrajectoryCameraSettings(reactionPlaybackObject);
        reactionPlaybackObject.root.visible = true;
        reactionPlaybackObject.setOpacity(0);
        reactionPlaybackPhase = "fadeTrajectoryIn";
        reactionPhaseElapsed = 0;
        reactionTrajectoryVisible = true;
      }
      return;
    }

    if (reactionPlaybackPhase === "fadeTrajectoryIn") {
      if (!reactionPlaybackObject) return;
      const progress = getFadeProgress(deltaSeconds);
      reactionPlaybackObject.setOpacity(progress);

      if (progress >= 1) {
        reactionPlaybackObject.setOpacity(1);
        reactionPlaybackObject.playOnce();
        reactionPlaybackPhase = "playing";
        reactionPhaseElapsed = 0;
      }
      return;
    }

    if (reactionPlaybackPhase === "playing") {
      if (!reactionPlaybackObject) return;
      reactionPlaybackObject.update(deltaSeconds);
      return;
    }

    if (reactionPlaybackPhase === "fadeTrajectoryOut") {
      if (!reactionPlaybackObject) return;
      const progress = getFadeProgress(deltaSeconds);
      reactionPlaybackObject.setOpacity(1 - progress);

      if (progress >= 1) {
        disposeReactionPlaybackObject();
        graphRoot.visible = true;
        applyGraphOpacity(0);
        restoreTrajectoryCameraSettings();
        reactionPlaybackPhase = "fadeGraphIn";
        reactionPhaseElapsed = 0;
      }
      return;
    }

    if (reactionPlaybackPhase === "fadeGraphIn") {
      const progress = getFadeProgress(deltaSeconds);
      applyGraphOpacity(progress);

      if (progress >= 1) {
        finishReactionPlayback();
      }
    }
  }

  startReactionTrajectoryPlayback = (playback) => {
    if (reactionPlaybackPhase !== "idle") return;

    try {
      reactionPlaybackObject = new TrajectoryPlaybackObject({
        initialFps: 30,
        onComplete: startTrajectoryFadeOut,
      });
      reactionPlaybackObject.loadXyzText(playback.xyzText);
      reactionPlaybackObject.setLoop(false);
      reactionPlaybackObject.setOpacity(0);
      reactionPlaybackObject.root.visible = false;
      positionReactionPlaybackObject(reactionPlaybackObject);
      scene.add(reactionPlaybackObject.root);

      graphMaterialSnapshot = captureGraphMaterialSnapshot();
      reactionPlaybackPhase = "fadeGraphOut";
      reactionPhaseElapsed = 0;
      reactionTrajectoryStarting = false;
      reactionGraphFaded = true;
    } catch {
      disposeReactionPlaybackObject();
      finishReactionPlayback();
    }
  };

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

  const sceneBackground = new HdrSceneBackground(scene, renderer);
  sceneBackground.load();

  function resetGraphRootForDesktop() {
    graphRoot.position.set(0, 0, 0);
    graphRoot.rotation.set(0, 0, 0);
    graphRoot.scale.setScalar(1);
  }

  function resetGraphRootForXr() {
    graphRoot.position.set(0, 0, -GRAPH_XR_OBJECT_DISTANCE);
    graphRoot.rotation.set(0, 0, 0);
    graphRoot.scale.setScalar(1);
  }

  initializeVR = async () => {
    if (!navigator.xr) {
      xrError = "VR is not available in this browser.";
      return;
    }

    renderer.xr.enabled = true;
    const xrMode: XRSessionMode = "immersive-vr";
    const sessionOptions = {
      optionalFeatures: ["local-floor", "bounded-floor", "layers"],
    };

    xrError = "";

    try {
      const supported = await navigator.xr.isSessionSupported(xrMode);
      if (!supported) {
        xrError = "VR is not available on this device.";
        return;
      }

      const session = await navigator.xr.requestSession(xrMode, sessionOptions);
      resetGraphRootForXr();
      sceneBackground.setTransparentBackground(false);
      isXrSession = true;

      session.addEventListener("end", () => {
        resetGraphRootForDesktop();
        sceneBackground.setTransparentBackground(false);
        isXrSession = false;
      });

      await renderer.xr.setSession(session);
      camera = perspectiveCamera;
      controls.enabled = false;
      controls = new VRControls(
        renderer,
        scene,
        perspectiveCamera,
        new Object3D(),
        meshes,
        GRAPH_XR_OBJECT_DISTANCE,
        "object",
        graphRoot,
      );
      controls.onHover = (object) => {
        hoveredNode = object ?? undefined;
      };
      controls.onAPressed = () => {
        selectMoleculeVR();
      };
      controls.onBPressed = () => {
        wClick();
      };
      controls.onReset = () => {
        rClick();
      };
      controls.setControllerHints(GRAPH_VR_CONTROLLER_HINTS);
    } catch (error) {
      resetGraphRootForDesktop();
      sceneBackground.setTransparentBackground(false);
      isXrSession = false;
      xrError = error instanceof Error ? error.message : "Unable to start VR.";
    }
  };

  const raycaster = new Raycaster();

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
    new ObjectOrbitControls(perspectiveCamera, graphElement, graphRoot),
    new ObjectOrbitControls(orthographicCamera, graphElement, graphRoot),
  ];

  perspectiveCamera.name = "Perspective Camera";
  orthographicCamera.name = "Orthographic Camera";
  scene.add(perspectiveCamera);
  scene.add(orthographicCamera);
  orthographicCamera.zoom = 10.0;

  camera = perspectiveCamera;
  controls = controllers[0];
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

  const meshes = new Object3D();
  graphRoot.add(meshes);

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

  graphRoot.add(lineInstances);

  function hover() {
    if (reactionPlaybackActive) {
      hoveredNode = undefined;
      graphElement.style.cursor = "default";
      return;
    }

    if (controls instanceof VRControls) return;
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

  const box = new Box3();
  const center = new Vector3();
  const dir = new Vector3();
  const size = new Vector3();

  const animate = function (time = performance.now()) {
    const deltaSeconds =
      lastGraphAnimationTime === 0 ? 0 : (time - lastGraphAnimationTime) / 1000;
    lastGraphAnimationTime = time;

    if (reactionPlaybackActive) {
      updateReactionPlayback(deltaSeconds);
      renderer.render(scene, camera);

      if (!webXR) {
        requestAnimationFrame(animate);
      }

      return;
    }

    controls.update();
    if (disconnectedComponentSpringsDirty) {
      syncDisconnectedComponentSprings();
      disconnectedComponentSpringsDirty = false;
    }
    layout.step();

    const removedNodes = new Set<NodeId>();
    queuedNodeEvents.forEach((change) => {
      if (change.changeType == "remove") {
        handleRemovedNode(change.node.id);
        removedNodes.add(change.node.id);
      } else if (change.changeType == "add") {
        handleAddedNode(change.node.id);
      }
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
    }

    queuedLinkEvents.length = 0;
    hover();

    renderGraph.forEachNode((node) => {
      const position = layout.getNodePosition(node.id);
      const cube = objects.get(node.id as string);

      if (cube === undefined) {
        return;
      }

      cube.position.set(position.x, position.y, position.z ?? 0);
    });

    renderGraph.forEachLink((link) => {
      updateLink(link);
    });

    lineInstances.instanceMatrix.needsUpdate = true;

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

    rerenderLines = rerenderLines || pathChanged;

    if (rerenderLines) {
      pathChanged = false;
      renderGraph.forEachLink((link) => {
        updateLink(link);
      });

      lineInstances.instanceMatrix.needsUpdate = true;
      rerenderLines = false;
    }

    updateNodeFadeIns(time);
    renderer.render(scene, camera);

    if (!webXR) {
      requestAnimationFrame(animate);
    }
  };

  // Start the animation loop - use setAnimationLoop for WebXR, regular requestAnimationFrame otherwise
  if (webXR) {
    renderer.setAnimationLoop(animate);
  } else {
    animate();
  }

  renderGraph.on("changed", (changes) => {
    const non_update = changes.filter(
      (change) => change.changeType != "update",
    );

    if (non_update.length == 0) {
      return;
    }

    disconnectedComponentSpringsDirty = true;
    const nodeChanges = non_update.filter((change) => change.node);
    const linkChanges = non_update.filter((change) => change.link);

    queuedNodeEvents.push(...nodeChanges);
    queuedLinkEvents.push(...linkChanges);
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
    pendingNodeFadeIns.delete(nodeId);
    nodeFadeIns.delete(nodeId);
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

  function selectMolecule() {
    if (reactionPlaybackActive) return;
    if (!hoveredNode) return;
    const nodeId = hoveredNode.userData?.name;
    if (!nodeId) return;

    toggleSpeciesSelection(nodeId);

    updateMolecule(nodeId);

    // let parent = hoveredNode.parent;

    // if (parent?.parent !== meshes) {
    //   parent = parent?.parent;
    // }

    // if (parent) {
    //   parent.getWorldPosition(newCameraTarget);
    //   zoomTarget = 60.0;
    //   zoomFinished = false;
    //   targetedNode = parent;
    // }

    // lockedOnMolecule = false;
  }

  function selectMoleculeVR() {
    if (reactionPlaybackActive) return;
    if (!hoveredNode) return;
    const nodeId = hoveredNode.userData?.name;
    if (!nodeId) return;

    const moleculeGroup = moleculeGroups.get(nodeId);
    const run = runs.get(nodeId);

    if (!moleculeGroup || !run) {
      console.warn("Keine Molekülgruppe oder Run für", nodeId);
      return;
    }

    toggleSpeciesSelection(nodeId);

    if (moleculeGroup && run) {
      moleculeGenerator.updateMolecule(
        moleculeGroup,
        run,
        currentFrameIndex,
        selectedSpecies,
        nodeId,
      );
    }

    let parent = hoveredNode.parent;

    if (parent?.parent !== meshes) {
      parent = parent?.parent;
    }

    if (parent) {
      parent.getWorldPosition(newCameraTarget);
      zoomTarget = 60.0;
      zoomFinished = false;
      targetedNode = parent;
    }

    lockedOnMolecule = true;
  }

  async function handleAddedNode(nodeId: string) {
    if (objects.has(nodeId)) {
      const object = objects.get(nodeId);

      if (object === undefined) {
        return;
      }

      meshes.add(object);
      startNodeFadeIn(nodeId, object);
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
    startNodeFadeIn(nodeId, cube);

    if (node.type === "species") {
      let data = "";
      if (xyzFiles) {
        const file = xyzFiles.get(node.name + ".xyz");
        if (!file) {
          return;
        }
        data = await file.text();
      } else {
        if (useHash) {
          const response = await fetch(`${xyzPath}${node.hash}/molecule.xyz`);
          if (!response.ok) {
            return;
          }
          data = await response.text();
        } else {
          const xyzText = await fetchXyzTextByName(
            node.name,
            node.name.includes("#") ? node.name.replace("#", "tt") : undefined,
          );
          if (!xyzText) {
            return;
          }
          data = xyzText;
        }
      }

      if (!data) {
        return;
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

        if (!node.inSecondaryGraphs) {
          molecule.traverse((child) => {
            if (child instanceof Mesh) {
              child.material.opacity = 0.1;
              child.material.transparent = true;
              child.material.needsUpdate = true;
            }
          });
        }
        applyCurrentNodeFade(nodeId, molecule);
        meshes.add(molecule);
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
    lineInstances.parent?.remove(lineInstances);
    graphRoot.add(newLineInstances);
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

function updateMolecule(nodeId: string) {
  const moleculeGroup = moleculeGroups.get(nodeId);
  const run = runs.get(nodeId);

  if (!moleculeGroup || !run) {
    console.warn("Keine Molekülgruppe oder Run für", nodeId);
    return;
  }

  if (moleculeGroup && run) {
    moleculeGenerator.updateMolecule(
      moleculeGroup,
      run,
      currentFrameIndex,
      selectedSpecies,
      nodeId,
    );
  }
}

function updateMousePosition(event) {
  mousePosition.x = (event.clientX / graphElement.clientWidth) * 2 - 1;
  mousePosition.y = -(event.clientY / graphElement.clientHeight) * 2 + 1;
}

function onKeyDown(event: KeyboardEvent) {
  if (reactionPlaybackActive) return;

  if (event.key == "Escape") {
    searchVisible = false;
    pathSearchVisible = false;
    filterVisible = false;
    settingsVisible = false;
    search_value = "";
  }

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
}

function qClick() {
  if (reactionPlaybackActive) return;

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
  if (reactionPlaybackActive) return;

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
  if (reactionPlaybackActive) return;

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
  if (reactionPlaybackActive) return;

  const anyOverlaysVisible =
    searchVisible || pathSearchVisible || filterVisible || settingsVisible;
  if (anyOverlaysVisible) {
    return;
  }
  addLayer();
}

function rClick() {
  if (reactionPlaybackActive) return;

  const anyOverlaysVisible =
    searchVisible || pathSearchVisible || filterVisible || settingsVisible;
  if (anyOverlaysVisible) {
    return;
  }
  clearSpeciesSelection();
  renderGraph.clear();
  resetEnabledGraphNodeIds();
  pendingNodeFadeIns.clear();
  initialSpecies.clear();
  initialReactions.clear();
  currentSpecies.clear();
  shortestPath = [];

  for (const species of startSpecies) {
    addInitialNode(species);
  }

  emitGraphEvent({ type: "reset" });
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
      if (
        reactionNodesToRemove.has(link.fromId) ||
        reactionNodesToRemove.has(link.toId)
      ) {
        edgesToRemove.add([link.fromId, link.toId]);

        // Finde passende Filter, um die Entfernung zu registrieren
        for (const filter of reactionFilters) {
          if (
            reactionNodesToRemove.has(link.fromId) ||
            reactionNodesToRemove.has(link.toId)
          ) {
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
function filterGraphOld(): {
  nodes: Set<NodeId>;
  edges: Set<[NodeId, NodeId]>;
} {
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
      if (
        reactionNodesToRemove.has(link.fromId) ||
        reactionNodesToRemove.has(link.toId)
      ) {
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
  });

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

function cloneRenderGraph(): Graph {
  const clone = createGraph();

  renderGraph.forEachNode((node) => {
    clone.addNode(node.id, node.data);
  });
  renderGraph.forEachLink((link) => {
    clone.addLink(link.fromId, link.toId, link.data);
  });

  return clone;
}

function commitStagedLayer(
  stagedRenderGraph: Graph,
  stagedCurrentSpecies: Set<string>,
  layerSelection: string[],
  addedNodes: NodeId[],
  addedEdges: [NodeId, NodeId][],
): void {
  layerCommitPending = false;

  addedNodes.forEach((nodeId) => {
    const node = stagedRenderGraph.getNode(nodeId);
    if (node && !renderGraph.hasNode(nodeId)) {
      renderGraph.addNode(nodeId, node.data);
    }
  });
  addedEdges.forEach(([fromId, toId]) => {
    if (!renderGraph.hasLink(fromId, toId)) {
      renderGraph.addLink(fromId, toId);
    }
  });

  currentSpecies = stagedCurrentSpecies;

  if (undoEnabled) {
    undoStack.push({
      type: "addLayer",
      addedNodes,
      addedEdges,
    });
  }

  emitGraphEvent({
    type: "layer-added",
    selectedSpecies: layerSelection,
    addedNodeIds: addedNodes.map(String),
    addedEdges: addedEdges.map(([fromId, toId]) => [
      String(fromId),
      String(toId),
    ]),
  });
}

function addLayer() {
  if (reactionPlaybackActive) return;

  const layerSelection = Array.from(selectedSpecies);
  const stagedRenderGraph = cloneRenderGraph();
  const stagedCurrentSpecies = new Set(currentSpecies);
  const addedNodes: NodeId[] = [];
  const addedEdges: [NodeId, NodeId][] = [];
  inAddLayerContext = true;

  const oldSpecies = new Set<string>(currentSpecies);
  stagedCurrentSpecies.forEach((species) => {
    addAllPossibleReactionsToRendergraph(
      graph,
      stagedRenderGraph,
      species,
      stagedCurrentSpecies,
      oldSpecies,
      addedNodes,
      addedEdges,
    );
  });

  inAddLayerContext = false;

  const nodesToReset = clearSpeciesSelection();

  for (const nodeId of nodesToReset) {
    console.log("Updating molecule after layer addition:", nodeId);
    updateMolecule(nodeId);
  }

  if (addedNodes.length === 0 && addedEdges.length === 0) {
    if (undoEnabled) {
      undoStack.push({ type: "addLayer", addedNodes, addedEdges });
    }
    return;
  }

  const addedReactionIds = addedNodes
    .filter(
      (nodeId) => stagedRenderGraph.getNode(nodeId)?.data.type === "reaction",
    )
    .map(String);

  layerCommitPending = true;
  playReactionTrajectoriesBefore(addedReactionIds, () => {
    commitStagedLayer(
      stagedRenderGraph,
      stagedCurrentSpecies,
      layerSelection,
      addedNodes,
      addedEdges,
    );
  });
}

function addInitialNode(node: string) {
  if (!isGraphNodeEnabled(node)) return;

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
    addedEdges,
  );

  addAllPossibleReactionsToRendergraph(
    graph,
    renderGraph,
    node,
    currentSpecies,
    initialSpecies,
    addedNodes,
    addedEdges,
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
  if (reactionPlaybackActive) return;

  const species = event.target.value;
  addInitialNode(species);
}

function addSpeciesToRendergraph(
  graph: Graph,
  renderGraph: Graph,
  species: string,
  currentSpecies: Set<string>,
  addedNodes?: NodeId[], // Optional
  addedEdges?: [NodeId, NodeId][], // Optional
) {
  if (!isGraphNodeEnabled(species)) return;

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
) {
  if (!isGraphNodeEnabled(species)) return;

  const isSelectiveAdd = inAddLayerContext && selectedSpecies.size > 0;
  if (isSelectiveAdd && !selectedSpecies.has(species)) {
    return;
  }

  if (!isSelectiveAdd) {
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
    if (!reaction) return;
    if (!isGraphNodeEnabled(reactionId)) return;

    const inEdges = getInEdges(reaction);
    const outEdges = getOutEdges(reaction);
    const allParticipantsEnabled = [...inEdges, ...outEdges].every((edge) =>
      isGraphNodeEnabled(
        edge.fromId === reactionId ? edge.toId : edge.fromId,
      ),
    );
    if (!allParticipantsEnabled) return;

    const numberOfUniqueReactants = new Set(
      inEdges.map((edge) => edge.fromId as string),
    ).size;
    console.log(numberOfUniqueReactants);
    const hasAllReactants = inEdges.every((edge) => {
      return isSelectiveAdd
        ? selectedSpecies.has(edge.fromId as string) &&
            numberOfUniqueReactants == selectedSpecies.size
        : oldSpecies.has(edge.fromId as string);
    });

    const numberOfUniqueProducts = new Set(
      getOutEdges(reaction).map((edge) => edge.toId as string),
    ).size;
    const hasAllProducts = outEdges.every((edge) => {
      return isSelectiveAdd
        ? selectedSpecies.has(edge.toId as string) &&
            numberOfUniqueProducts == selectedSpecies.size
        : oldSpecies.has(edge.toId as string);
    });

    if (!(hasAllReactants || hasAllProducts)) return;

    const reverseReaction = (reactionSmile: string) => {
      const [eductStr, productStr] = reactionSmile
        .split("=>")
        .map((s) => s.trim());
      return `${productStr} => ${eductStr}`;
    };

    const reversedReactionAlreadyInGraph = renderGraph.hasNode(
      reverseReaction(reactionId),
    );

    if (reversedReactionAlreadyInGraph) return;

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
    if (filtered) return;

    const inSecondaryGraphs = secondaryGraphs
      .map((graph) => graph.hasNode(species))
      .every((value) => value);

    reaction.data.inSecondaryGraphs = inSecondaryGraphs;

    if (!renderGraph.hasNode(reactionId)) {
      renderGraph.addNode(reactionId, reaction.data);
      if (addedNodes) addedNodes.push(reactionId);
    }

    if (!renderGraph.hasLink(species, reactionId)) {
      renderGraph.addLink(species, reactionId);
      if (addedEdges) addedEdges.push([species, reactionId]);
    }

    inEdges.forEach((edge) => {
      addSpeciesToRendergraph(
        graph,
        renderGraph,
        edge.fromId as string,
        currentSpecies,
        addedNodes,
        addedEdges,
      );

      if (!renderGraph.hasLink(edge.fromId, reactionId)) {
        renderGraph.addLink(edge.fromId, reactionId);
        if (addedEdges) addedEdges.push([edge.fromId, reactionId]);
      }
    });

    outEdges.forEach((edge) => {
      addSpeciesToRendergraph(
        graph,
        renderGraph,
        edge.toId as string,
        currentSpecies,
        addedNodes,
        addedEdges,
      );

      if (!renderGraph.hasLink(reactionId, edge.toId)) {
        renderGraph.addLink(reactionId, edge.toId);
        if (addedEdges) addedEdges.push([reactionId, edge.toId]);
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
  const [eductStr, productStr] = reaction.split("=>").map((s) => s.trim());

  const educts = eductStr
    .split("+")
    .map((s) => s.trim())
    .sort();
  const products = productStr
    .split("+")
    .map((s) => s.trim())
    .sort();

  return `${educts.join(" + ")} ⇌ ${products.join(" + ")}`;
}

function removeFilter(id: string) {
  const index = allFilters.findIndex((f) => f.id === id);
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
    const filterIndex = allFilters.findIndex(
      (f) => f.id === lastAction.filterId,
    );
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
  } else if (
    lastAction.type === "addLayer" ||
    lastAction.type === "addInitialNode"
  ) {
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

function handleElementFilterChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  const selectedElement = target.value;

  if (hiddenElements.has(selectedElement)) {
    hiddenElements.delete(selectedElement);
  } else {
    hiddenElements.add(selectedElement);
  }

  rerenderMolecules();
}

function rerenderMolecules() {
  renderGraph.forEachNode((node) => {
    if (node.data.type !== "species") return;

    const oldObject = objects.get(node.id);
    if (oldObject) {
      meshes.remove(oldObject);
    }

    const run = runs.get(node.id);
    if (!run) return;

    const newMolecule = moleculeGenerator.generateMolecule(
      run,
      hiddenElements,
      true,
      undefined,
      selectedSpecies,
      node.id,
    );

    newMolecule.traverse((child) => {
      child.userData = node;
    });

    objects.set(node.id, newMolecule);
    meshes.add(newMolecule);
    moleculeGroups.set(node.id, newMolecule);
  });
}
</script>

<div class="page" class:reaction_playback_active={reactionPlaybackActive}>
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

  {#if activeReactionTrajectory}
    <div
      class="reaction-trajectory-label"
      class:visible={reactionTrajectoryVisible}
    >
      {activeReactionTrajectory.reactionId}
    </div>
  {/if}

  <div class="top-right-button-group">
    <button
      class="settingsButton"
      on:click={undoLastAction}
      title="Undo last action"
    >
      <picture>
        <img src="/images/undo.svg" alt="Undo icon" />
      </picture>
    </button>

    <button
      class="settingsButton"
      on:click={() => (settingsVisible = !settingsVisible)}
      title="Settings"
    >
      <picture>
        <img src="/images/settings.svg" alt="Settings icon" />
      </picture>
    </button>
  </div>

  <div id="keys_overlay">
    {#if webXR}
      <div class="graph-xr-toolbar">
        <div class="graph-xr-controls">
          <button
            class="graph-xr-button"
            type="button"
            on:pointerdown={(event) => event.stopPropagation()}
            on:click={initializeVR}
          >
            Enter VR
          </button>
          {#if xrError}
            <span class="xr-error">{xrError}</span>
          {/if}
        </div>
      </div>
    {/if}
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
      >
        {isXrSession ? "select molecule" : "add inital species"}
      </p>
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
      >
        add layer
      </p>
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
      >
        filter graph
      </p>
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
      >
        find path
      </p>
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
      >
        reset graph
      </p>
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
          disabled={webXR}
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
                const operatorKey = document.getElementById(
                  "filterElementOperator",
                ).value;
                const operator = COUNT_OPERATORS.get(operatorKey);
                const count =
                  document.getElementById("filterElementInput").value;
                let filterId = crypto.randomUUID();

                allFilters.push({
                  id: filterId,
                  type: "species",
                  fn: (node) =>
                    filterByAtomCount(node, element, count, operator),
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
                const chargeOperatorKey = document.getElementById(
                  "filterChargeOperator",
                ).value;
                const chargeOperator = COUNT_OPERATORS.get(chargeOperatorKey);
                const cargeCount =
                  document.getElementById("filterChargeInput").value;
                let filterId = crypto.randomUUID();

                allFilters.push({
                  id: filterId,
                  type: "species",
                  fn: (node) =>
                    filterChargeCount(node, cargeCount, chargeOperator),
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
                const multiplicityOperatorKey = document.getElementById(
                  "filterMultiplicityOperator",
                ).value;
                const multiplicityOperator = COUNT_OPERATORS.get(
                  multiplicityOperatorKey,
                );
                const multiplicityCount = document.getElementById(
                  "filterMultiplicityInput",
                ).value;
                let filterId = crypto.randomUUID();

                allFilters.push({
                  id: filterId,
                  type: "species",
                  fn: (node) =>
                    filterMultiplicityCount(
                      node,
                      multiplicityCount,
                      multiplicityOperator,
                    ),
                  sentence: `Remove all molecules where the spin-multilpicity is ${FILTERWORDS.get(multiplicityOperatorKey)} ${multiplicityCount}`,
                  removedNodes: [],
                  removedEdges: [],
                });
                undoStack.push({ type: "filter", filterId: filterId });

                allFilters = allFilters;

                document.getElementById("filterMultiplicityOperator").value =
                  "==";
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
                const duplicateReactionFilterFn =
                  filterDuplicateReactions(seenReactions);
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
              }}>Add</button
            >
          </div>
        </div>
        {#each allFilters as filter (filter.id)}
          <div style="display: flex; align-items: center">
            <p>{filter.sentence}</p>
            <button
              style="margin-left: 0.5rem; height: fit-content"
              on:click={() => removeFilter(filter.id)}>Remove</button
            >
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
  pointer-events: all;
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
  gap: 0.5rem;
  align-items: flex-start;
  pointer-events: none;
}

#canvas_wrapper {
  width: 100%;
  height: 100%;
  padding: 0px;
  margin: 0px;
  position: relative;
}

.reaction-trajectory-label {
  position: absolute;
  z-index: 200;
  top: 16px;
  left: 50%;
  max-width: min(720px, calc(100vw - 32px));
  transform: translateX(-50%);
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: rgba(149, 157, 165, 0.2) 0px 8px 24px;
  color: #000000;
  font-size: 1rem;
  text-align: center;
  opacity: 0;
  pointer-events: none;
  transition: opacity 350ms ease;
}

.reaction-trajectory-label.visible {
  opacity: 1;
}

.reaction_playback_active .top-right-button-group,
.reaction_playback_active #keys_overlay,
.reaction_playback_active #hovered_node {
  opacity: 0;
  pointer-events: none;
}

.reaction_playback_active #canvas_wrapper {
  pointer-events: none;
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

.graph-xr-toolbar {
  border: 1px solid #d7d7d7;
  border-radius: 1rem;
  padding: 12px;
  background: #ffffff;
  box-shadow: rgba(149, 157, 165, 0.2) 0px 8px 24px;
  color: #000000;
  pointer-events: all;
}

.graph-xr-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.graph-xr-button {
  border: 1px solid #000000;
  border-radius: 0.4rem;
  background: #ffffff;
  color: #000000;
  padding: 0.45rem 0.7rem;
  cursor: pointer;
  font-family: "Quicksand", sans-serif;
  font-size: 1rem;
}

.graph-xr-button:hover {
  background: #f0f0f0;
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

.xr-error {
  max-width: 18rem;
  color: #7f1d1d;
  font-size: 0.95rem;
}

@media (max-width: 400px) {
  #keys_overlay {
    display: none;
  }
}
</style>
