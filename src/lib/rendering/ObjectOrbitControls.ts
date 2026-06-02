import {
  Object3D,
  Quaternion,
  Vector2,
  Vector3,
  type Camera,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export class ObjectOrbitControls {
  public readonly orbitControls: OrbitControls;
  public enabled = true;
  public rotationSpeed = 1;

  private readonly lastPointer = new Vector2();
  private readonly cameraRight = new Vector3();
  private readonly cameraQuaternion = new Quaternion();
  private readonly worldUp = new Vector3(0, 1, 0);
  private rotating = false;

  constructor(
    private camera: Camera,
    private domElement: HTMLElement,
    private controlledObject: Object3D,
  ) {
    this.orbitControls = new OrbitControls(camera, domElement);
    this.orbitControls.enableRotate = false;

    domElement.addEventListener("pointerdown", this.handlePointerDown);
    domElement.addEventListener("pointermove", this.handlePointerMove);
    domElement.addEventListener("pointerup", this.handlePointerUp);
    domElement.addEventListener("pointerleave", this.handlePointerUp);
  }

  get target(): Vector3 {
    return this.orbitControls.target;
  }

  set target(target: Vector3) {
    this.orbitControls.target = target;
  }

  get enableDamping(): boolean {
    return this.orbitControls.enableDamping;
  }

  set enableDamping(enableDamping: boolean) {
    this.orbitControls.enableDamping = enableDamping;
  }

  get dampingFactor(): number {
    return this.orbitControls.dampingFactor;
  }

  set dampingFactor(dampingFactor: number) {
    this.orbitControls.dampingFactor = dampingFactor;
  }

  get enablePan(): boolean {
    return this.orbitControls.enablePan;
  }

  set enablePan(enablePan: boolean) {
    this.orbitControls.enablePan = enablePan;
  }

  get mouseButtons(): OrbitControls["mouseButtons"] {
    return this.orbitControls.mouseButtons;
  }

  set mouseButtons(mouseButtons: OrbitControls["mouseButtons"]) {
    this.orbitControls.mouseButtons = mouseButtons;
  }

  update(): void {
    this.orbitControls.enabled = this.enabled;
    this.orbitControls.update();
    this.controlledObject.updateMatrixWorld(true);
  }

  dispose(): void {
    this.domElement.removeEventListener("pointerdown", this.handlePointerDown);
    this.domElement.removeEventListener("pointermove", this.handlePointerMove);
    this.domElement.removeEventListener("pointerup", this.handlePointerUp);
    this.domElement.removeEventListener("pointerleave", this.handlePointerUp);
    this.orbitControls.dispose();
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (!this.enabled || event.button !== 0) return;

    this.rotating = true;
    this.lastPointer.set(event.clientX, event.clientY);
  };

  private handlePointerMove = (event: PointerEvent): void => {
    if (!this.enabled || !this.rotating) return;

    const dx = event.clientX - this.lastPointer.x;
    const dy = event.clientY - this.lastPointer.y;
    this.lastPointer.set(event.clientX, event.clientY);

    const rotationScale = this.rotationSpeed * 0.005;
    this.controlledObject.rotateOnWorldAxis(this.worldUp, dx * rotationScale);

    this.camera.getWorldQuaternion(this.cameraQuaternion);
    this.cameraRight.set(1, 0, 0).applyQuaternion(this.cameraQuaternion);
    this.controlledObject.rotateOnWorldAxis(
      this.cameraRight,
      dy * rotationScale,
    );
    this.controlledObject.updateMatrixWorld(true);
  };

  private handlePointerUp = (): void => {
    this.rotating = false;
  };
}
