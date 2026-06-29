import * as THREE from "three";
import { HDRLoader } from "three/examples/jsm/Addons.js";

export const DEFAULT_HDR_ENVIRONMENT_PATH = "/qwantani_dusk_2_puresky_1k.hdr";

export class HdrSceneBackground {
  private texture: THREE.Texture | null = null;
  private transparent = false;
  private disposed = false;
  private clearColor = new THREE.Color(0xf0f0f0);

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
    private hdrPath: string = DEFAULT_HDR_ENVIRONMENT_PATH,
  ) { }

  load(): void {
    new HDRLoader().load(
      this.hdrPath,
      (texture) => {
        if (this.disposed) {
          texture.dispose();
          return;
        }

        texture.mapping = THREE.EquirectangularReflectionMapping;
        this.texture = texture;
        this.apply();
      },
      undefined,
      (error) => {
        console.warn("Failed to load HDR environment:", error);
      },
    );
  }

  setTransparentBackground(transparent: boolean): void {
    this.transparent = transparent;
    this.apply();
  }

  apply(): void {
    this.scene.environment = this.texture;
    this.scene.backgroundBlurriness = 0.1;
    this.scene.backgroundIntensity = 0.7;

    if (this.transparent) {
      this.scene.background = null;
      this.renderer.setClearColor(this.clearColor, 0);
      return;
    }

    this.scene.background = this.texture;
    this.renderer.setClearColor(this.clearColor, 1);
  }

  dispose(): void {
    this.disposed = true;

    if (this.scene.environment === this.texture) {
      this.scene.environment = null;
    }

    if (this.scene.background === this.texture) {
      this.scene.background = null;
    }

    this.texture?.dispose();
    this.texture = null;
  }
}
