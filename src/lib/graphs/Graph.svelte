<script lang="ts">
import { PathSearchGraph } from "$lib/graphs/graph";
import {
  filterByAtomCount,
  filterChargeCount,
  filterMultiplicityCount,
  FILTERWORDS,
} from "$lib/filter/filter";
import Fuse from "fuse.js";
import createLayout, { type Vector } from "ngraph.forcelayout";
import createGraph, {
  type Node,
  type Graph,
  type Link,
  type NodeId,
} from "ngraph.graph";
import KeycapButton from "$lib/ui/KeycapButton.svelte";

import { COUNT_OPERATORS, type Filter } from "$lib/filter/filter";
import { MoleculeGenerator } from "$lib/rendering/molecules";
import { parseRun } from "$lib/rendering/xyz.js";
import { onMount } from "svelte";
import {
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
  InstancedMesh,
  CylinderGeometry,
  SRGBColorSpace,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import { XRControllerModelFactory } from "three/examples/jsm/webxr/XRControllerModelFactory.js";

export let graph: Graph;
export let secondaryGraphs: Graph[] = [];
export let xyzPath: string;
export let useHash: boolean = false;
export let xyzFiles: Map<string, File> | null = null;
export let startSpecies: string[] = [];
export let webXR: boolean = false;

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

let filters = new Array<Filter>();
let filterApplied = false;
let removedByFilter = new Array<{
  nodes: Set<NodeId>;
  edges: Set<[NodeId, NodeId]>;
}>();
let filterSentences = new Array<string>();

let most_freqent_species = new Set<string>();
let species_count = new Map<string, number>();

let hiddenElements = new Set<string>();
hiddenElements.add("Cu");

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
});

const objects = new Map<string, Object3D>();

onMount(async () => {
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

  // VR setup variables
  let dolly;
  let moveSpeed = 0.1;

  // Enable WebXR if the prop is set
  if (webXR) {
    renderer.xr.enabled = true;
    document.body.appendChild(VRButton.createButton(renderer));

    // Create dolly for VR movement
    dolly = new Object3D();
    scene.add(dolly);

    // Add VR controllers
    const controller1 = renderer.xr.getController(0);
    const controller2 = renderer.xr.getController(1);
    dolly.add(controller1);
    dolly.add(controller2);

    // Add controller models
    const controllerModelFactory = new XRControllerModelFactory();

    const controllerGrip1 = renderer.xr.getControllerGrip(0);
    controllerGrip1.add(
      controllerModelFactory.createControllerModel(controllerGrip1),
    );
    dolly.add(controllerGrip1);

    const controllerGrip2 = renderer.xr.getControllerGrip(1);
    controllerGrip2.add(
      controllerModelFactory.createControllerModel(controllerGrip2),
    );
    dolly.add(controllerGrip2);

    // Add controller interaction
    controller1.addEventListener("selectstart", () => {
      console.log("Controller 1 select start");
      selectMoleculeVR();
    });

    controller2.addEventListener("selectstart", () => {
      console.log("Controller 2 select start");
      selectMoleculeVR();
    });
  }

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

  const meshes = new Object3D();
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
    // Handle VR controller movement if in WebXR mode
    if (webXR) {
      const session = renderer.xr.getSession();
      if (session) {
        for (const source of session.inputSources) {
          if (source.gamepad) {
            const gamepad = source.gamepad;
            const hand = source.handedness;

            // Use thumbstick/touchpad for movement
            if (gamepad.axes.length >= 2) {
              const xAxis = gamepad.axes[2] || 0; // Right stick X or touchpad X
              const yAxis = gamepad.axes[3] || 0; // Right stick Y or touchpad Y

              if (Math.abs(xAxis) > 0.1 || Math.abs(yAxis) > 0.1) {
                // Get the camera's forward and right directions
                const cameraDirection = new Vector3();
                const cameraRight = new Vector3();

                renderer.xr.getCamera().getWorldDirection(cameraDirection);
                cameraDirection.y = 0; // Keep movement horizontal
                cameraDirection.normalize();

                cameraRight.crossVectors(cameraDirection, new Vector3(0, 1, 0));
                cameraRight.normalize();

                // Calculate movement vector
                const moveVector = new Vector3();
                moveVector.addScaledVector(cameraDirection, -yAxis * 0.1);
                moveVector.addScaledVector(cameraRight, xAxis * 0.1);

                // Apply movement to dolly
                const dolly = renderer.xr.getCamera().parent;
                if (dolly) {
                  dolly.position.add(moveVector);
                }
              }
            }

            // Use left thumbstick for up/down movement if available
            if (gamepad.axes.length >= 4 && hand === "left") {
              const leftYAxis = gamepad.axes[1] || 0; // Left stick Y

              if (Math.abs(leftYAxis) > 0.1) {
                const dolly = renderer.xr.getCamera().parent;
                if (dolly) {
                  dolly.position.y += leftYAxis * 0.1;
                }
              }
            }
          }
        }
      }
    }

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

    if (currentLayoutIteration < layoutIterations) {
      renderGraph.forEachNode((node) => {
        const position = layout.getNodePosition(node.id);
        const cube = objects.get(node.id as string);

        if (cube === undefined) {
          return;
        }

        if (dimensions == 2) {
          cube.position.x = position.x;
          cube.position.y = position.y;
        } else {
          cube?.position.copy(position);
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

    // Continue animation loop only if not in WebXR mode
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
    console.log("inside selectMolecule");
    if (!hoveredNode) return;

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

  function selectMoleculeVR() {
    console.log("inside selectMoleculeVR");
    if (!hoveredNode) return;

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

function pClick() {
  pathSearchVisible = !pathSearchVisible;
  pathSearchStart = [];
  if (pathSearchVisible) {
    searchVisible = false;
    filterVisible = false;
    settingsVisible = false;
  }
}

function fClick() {
  filterVisible = !filterVisible;
  if (filterVisible) {
    searchVisible = false;
    pathSearchVisible = false;
    settingsVisible = false;
  }
}

function wClick() {
  const anyOverlaysVisible =
    searchVisible || pathSearchVisible || filterVisible || settingsVisible;
  if (anyOverlaysVisible) {
    return;
  }
  addLayer();
  console.log("Adding layer");
  console.log("Nodes: ", renderGraph.getNodesCount());
  console.log("Links: ", renderGraph.getLinksCount());
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
  console.log("Filtering graph");
  renderGraph.forEachNode((node: Node) => {
    if (node.data.type == "reaction") {
      return;
    }
    const removeNode = filters.some((filter) => filter(node));
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
  });
  nodesToRemove.forEach((nodeId) => {
    if (initialSpecies.has(nodeId)) {
      return;
    }
    renderGraph.removeNode(nodeId);
    currentSpecies.delete(nodeId);
  });

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
  const oldSpecies = new Set<string>(currentSpecies);
  currentSpecies.forEach((species) => {
    addAllPossibleReactionsToRendergraph(
      graph,
      renderGraph,
      species,
      currentSpecies,
      oldSpecies,
    );
  });
}

function addInitialNode(node: string) {
  initialSpecies.add(node);
  currentSpecies.add(node);
  initialSpecies = initialSpecies;
  currentSpecies = currentSpecies;

  addSpeciesToRendergraph(graph, renderGraph, node, currentSpecies);
  addAllPossibleReactionsToRendergraph(
    graph,
    renderGraph,
    node,
    currentSpecies,
    initialSpecies,
  );
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
}

function addAllPossibleReactionsToRendergraph(
  graph: Graph,
  renderGraph: Graph,
  species: string,
  currentSpecies: Set<string>,
  oldSpecies: Set<string>,
) {
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

    const inEdges = getInEdges(reaction);
    const hasAllReactants = inEdges.every((edge) => {
      return oldSpecies.has(edge.fromId as string);
    });

    const outEdges = getOutEdges(reaction);
    const hasAllProducts = outEdges.every((edge) => {
      return oldSpecies.has(edge.toId as string);
    });

    if (!(hasAllReactants || hasAllProducts)) return;

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
    }

    if (!renderGraph.hasLink(species, reactionId)) {
      renderGraph.addLink(species, reactionId);
    }

    inEdges.forEach((edge) => {
      addSpeciesToRendergraph(
        graph,
        renderGraph,
        edge.fromId as string,
        currentSpecies,
      );

      const linkAlreadyInGraph = renderGraph.hasLink(edge.fromId, reactionId);

      if (!linkAlreadyInGraph) {
        renderGraph.addLink(edge.fromId, reactionId);
      }
    });

    outEdges.forEach((edge) => {
      addSpeciesToRendergraph(
        graph,
        renderGraph,
        edge.toId as string,
        currentSpecies,
      );
      if (!renderGraph.hasLink(reactionId, edge.toId)) {
        renderGraph.addLink(reactionId, edge.toId);
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

  <button
    class="settingsButton"
    on:click={() => {
      settingsVisible = !settingsVisible;
    }}
  >
    <picture>
      <img src="/images/settings.svg" alt="An icon of a settings" />
    </picture>
  </button>

  <div id="keys_overlay">
    <div class="key_input">
      <KeycapButton key="Q"></KeycapButton>
      <!-- svelte-ignore a11y-click-events-have-key-events -->
      <!-- svelte-ignore a11y-no-noninteractive-element-interactions -->
      <p
        on:click={() => {
          qClick();
        }}
      >
        add inital species
      </p>
    </div>

    <div class="key_input">
      <KeycapButton key="W"></KeycapButton>
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
      <KeycapButton key="F"></KeycapButton>
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
      <KeycapButton key="P"></KeycapButton>
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
      <KeycapButton key="R"></KeycapButton>
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
      </div>
    </div>
  {/if}

  {#if filterVisible}
    <div class="overlay" style="backdrop-filter: blur(10px);">
      <div class="filters_overlay">
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
                filters.push((node) =>
                  filterByAtomCount(node, element, count, operator),
                );
                filters = filters;

                filterSentences.push(
                  `Remove all molecules where the number of ${element} atoms is ${FILTERWORDS.get(operatorKey)} ${count}`,
                );
                filterSentences = filterSentences;

                document.getElementById("filterElement").value = "C";
                document.getElementById("filterELementOperator").value = "==";
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
                filters.push((node) =>
                  filterChargeCount(node, cargeCount, chargeOperator),
                );
                filters = filters;

                filterSentences.push(
                  `Remove all molecules where the charge is ${FILTERWORDS.get(chargeOperatorKey)} ${cargeCount}`,
                );
                filterSentences = filterSentences;

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
                filters.push((node) =>
                  filterMultiplicityCount(
                    node,
                    multiplicityCount,
                    multiplicityOperator,
                  ),
                );
                filters = filters;

                filterSentences.push(
                  `Remove all molecules where the spin-multilpicity is ${FILTERWORDS.get(multiplicityOperatorKey)} ${multiplicityCount}`,
                );
                filterSentences = filterSentences;

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
        {#each filterSentences.entries() as [index, filter]}
          <div style="display: flex; align-items: center">
            <p>{filter}</p>
            <button
              style="margin-left: 0.5rem; height: fit-content"
              on:click={() => {
                filters.splice(index, 1);
                filters = filters;
                filterSentences.splice(index, 1);
                filterSentences = filterSentences;
                const removedNodesAndEdges = removedByFilter.splice(index, 1);
                removedNodesAndEdges.forEach((removed) => {
                  removed.nodes.forEach((nodeId) => {
                    const node = graph.getNode(nodeId);
                    if (!node) {
                      return;
                    }
                    renderGraph.addNode(nodeId, node.data);
                  });
                  removed.edges.forEach((edgeNodes) => {
                    const edge = graph.getLink(edgeNodes[0], edgeNodes[1]);
                    if (!edge) {
                      return;
                    }
                    renderGraph.addLink(edgeNodes[0], edgeNodes[1], edge.data);
                  });
                });
              }}>Remove</button
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
  top: 0px;
  left: 0px;
  width: 100%;
  height: 100%;
  font-family: "Quicksand", sans-serif;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  grid-template-rows: 0.4fr auto 0.1fr;
  grid-template-areas:
    ". . ."
    ". initial_species_search current_initial_species"
    ". . .";
}

.gaussian_blur {
  filter: blur(10px);
}

#initial_species_search {
  grid-area: initial_species_search;
  width: 45rem;
  max-width: 100%;
  position: relative;
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
  border-top-left-radius: 6px;
  border-top-right-radius: 6px;
  border-width: 2px;
  border-color: #000000;
  border-style: solid;
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
  margin: none;
  padding: none;
  min-width: 100%;
  font-size: 1.5rem;
  font-family: "Quicksand", sans-serif;
  font-weight: 400;
  color: #000000;
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

.settingsButton {
  position: absolute;
  top: 0px;
  right: 0px;
  margin: 15px;
  padding: 0px;
  pointer-events: all;
  width: 2rem;
  height: 2rem;
  background: none;
  border: none;
  cursor: pointer;
  z-index: 100;
}

.settingsButton img {
  width: 100%;
  height: 100%;
}

@media (max-width: 400px) {
  #keys_overlay {
    display: none;
  }
}
</style>
