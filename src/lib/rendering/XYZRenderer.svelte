<script lang="ts">
import { onMount } from "svelte";
import {
  AmbientLight,
  DirectionalLight,
  Group,
  OrthographicCamera,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { MoleculeGenerator } from "./molecules";
import { parseRun } from "./xyz";

export let xyz_to_render: string;

let rendering_canvas: HTMLCanvasElement;

let requires_render: boolean = true;

const scene = new Scene();
let current_molecule_group: Group | null = null;
let orbit_controls: OrbitControls;
let renderer: WebGLRenderer;
let camera: PerspectiveCamera;

const molecule_generator = new MoleculeGenerator();

$: addXYZToScene(xyz_to_render);

function addXYZToScene(xyz: string) {
  if (!xyz) return;
  if (current_molecule_group) {
    scene.remove(current_molecule_group);
  }
  const run = parseRun(xyz);
  const molecule_group = molecule_generator.generateMolecule(run);
  current_molecule_group = molecule_group;
  scene.add(molecule_group);
  requires_render = true;
}

onMount(() => {
  renderer = new WebGLRenderer({
    canvas: rendering_canvas,
    antialias: true,
    alpha: true,
  });
  renderer.setSize(rendering_canvas.clientWidth, rendering_canvas.clientHeight);
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(window.devicePixelRatio ? window.devicePixelRatio : 2);

  const directional_light = new DirectionalLight(0xffffff, 3.0);
  directional_light.position.set(0, 1, 1);
  scene.add(directional_light);
  const ambient_light = new AmbientLight(0xffffff, 1.0);
  scene.add(ambient_light);

  // camera = new PerspectiveCamera(
  //   75,
  //   rendering_canvas.clientWidth / rendering_canvas.clientHeight,
  //   0.1,
  //   1000,
  // );

  camera = new OrthographicCamera(
    -rendering_canvas.clientWidth / 2,
    rendering_canvas.clientWidth / 2,
    rendering_canvas.clientHeight / 2,
    -rendering_canvas.clientHeight / 2,
    1,
    1000,
  );

  camera.zoom = 50;

  orbit_controls = new OrbitControls(camera, renderer.domElement);
  orbit_controls.addEventListener("change", () => {
    requires_render = true;
  });
  orbit_controls.enableDamping = true;
  orbit_controls.dampingFactor = 0.25;
  orbit_controls.enableZoom = true;

  camera.position.z = 5;

  const animate = () => {
    if (requires_render) {
      renderer.render(scene, camera);
      requires_render = false;
    }
    requestAnimationFrame(animate);
  };

  animate();
});
</script>

<canvas id="xyz_rendering_canvas" bind:this={rendering_canvas}> </canvas>

<style>
#xyz_rendering_canvas {
  width: 100%;
  height: 100%;
  background-color: transparent;
  border-radius: 1rem;
  box-shadow: rgba(149, 157, 165, 0.2) 0px 8px 24px;
}
</style>
