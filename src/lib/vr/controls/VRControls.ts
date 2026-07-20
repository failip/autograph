import { Object3D, PerspectiveCamera, Scene, Vector3, Vector2, WebGLRenderer, type WebXRArrayCamera, Spherical, Quaternion, Matrix4, Raycaster, CylinderGeometry, RingGeometry, MeshBasicMaterial, Mesh } from "three";
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import {
  VRControllerHintsView,
  type VRControllerHints,
} from "./VRControllerHints";

export type {
  VRControlHint,
  VRControllerHintPanel,
  VRControllerHints,
} from "./VRControllerHints";

const POINTER_ORIGIN_INSET = 0.015;

export class VRControls {
  public target: Object3D
  public camera: PerspectiveCamera;
  public distanceFromFocus = 50.0;
  public rotationSpeed = 1.0;
  public enabled = true;
  private xrSession: XRSession;
  private renderer: WebGLRenderer;

  private raycaster: Raycaster;
  private tempMatrix: Matrix4;

  public controller1: Object3D;
  public controller2: Object3D;
  private controllerPointers: Mesh[] = [];
  private hoverIndicators: Mesh[] = [];
  private controllerGrips: Object3D[] = [];
  private controllerHintsView: VRControllerHintsView | null = null;
  private lastHintsUpdateTime: number | null = null;
  private disposed = false;

  private perspectiveCamera: PerspectiveCamera;

  dolly: Object3D;
  controllers: Gamepad[] = [];
  handedness: XRHandedness[] = [];

  private scene: Scene;
  private raycastGroup: Object3D | undefined;
  private controlMode: "camera" | "object";
  private controlledObject: Object3D | undefined;

  // Orbit controls properties
  private spherical: Spherical;
  private sphericalDelta: Spherical;
  private quat: Quaternion;
  private quatInverse: Quaternion;
  private lastPosition: Vector3;
  private scale: number;

  // Rotation state
  private rotateStart: Vector2;
  private rotateEnd: Vector2;
  private rotateDelta: Vector2;
  private readonly worldUp = new Vector3(0, 1, 0);
  private readonly cameraRight = new Vector3();
  private readonly cameraQuaternion = new Quaternion();

  // Control limits
  public minDistance = 5;
  public maxDistance = 100000.0;
  public minPolarAngle = 0;
  public maxPolarAngle = Math.PI;
  public enableDamping = true;
  public dampingFactor = 0.05;

  public onAPressed: (() => void) | null = null;
  public onBPressed: (() => void) | null = null;
  public onXPressed: (() => void) | null = null;
  public onYPressed: (() => void) | null = null;
  public onSelect: (() => void) | null = null;
  public onReset: (() => void) | null = null;
  public onHover: ((object: Object3D | null) => void) | null = null;

  private hoveredObject: Object3D | null = null;
  private prevTriggerState: boolean[] = [false, false];
  private prevButton4State: boolean[] = [false, false];
  private prevButton5State: boolean[] = [false, false];
  private resetHoldStartedAt: number | null = null;
  private resetGestureLatched = false;
  private readonly resetHoldDurationMs = 2000;

  private readonly handleInputSourcesChange = (): void => {
    this.prevTriggerState = [false, false];
    this.prevButton4State = [false, false];
    this.prevButton5State = [false, false];
    this.resetHoldStartedAt = null;
    this.resetGestureLatched = false;
    this.syncInputSources();
    this.refreshPointerVisuals();
    this.controllerHintsView?.refresh(this.handedness);
  };

  private readonly handleSessionEnd = (): void => {
    this.dispose();
  };

  constructor(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    target: Object3D,
    raycastGroup?: Object3D,
    distanceFromFocus: number = 50.0,
    controlMode: "camera" | "object" = "camera",
    controlledObject?: Object3D,
  ) {

    const xrSession = renderer.xr.getSession();

    if (!xrSession) {
      throw new Error("XR Session not found. Make sure WebXR is enabled.");
    }

    this.xrSession = xrSession;
    this.renderer = renderer;

    this.xrSession.addEventListener(
      "inputsourceschange",
      this.handleInputSourcesChange,
    );
    this.xrSession.addEventListener("end", this.handleSessionEnd);
    this.syncInputSources();

    this.raycaster = new Raycaster();
    this.tempMatrix = new Matrix4();

    this.dolly = new Object3D();
    this.dolly.name = "VR Dolly";

    scene.add(this.dolly);
    this.controller1 = renderer.xr.getController(0);
    this.controller2 = renderer.xr.getController(1);

    const pointerGeometry = new CylinderGeometry(0.002, 0.002, 5, 32);
    pointerGeometry.rotateX(-Math.PI / 2);
    pointerGeometry.translate(0, 0, -2.5);
    const pointerMaterial = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthTest: true,
      depthWrite: false,
    });
    const hoverIndicatorGeometry = new RingGeometry(0.65, 1, 32);
    const hoverIndicatorMaterial = new MeshBasicMaterial({
      color: 0x22d3ee,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
    });

    for (const controller of [this.controller1, this.controller2]) {
      const pointer = new Mesh(pointerGeometry, pointerMaterial);
      pointer.name = "line";
      pointer.position.z = POINTER_ORIGIN_INSET;
      controller.add(pointer);
      this.controllerPointers.push(pointer);

      const hoverIndicator = new Mesh(
        hoverIndicatorGeometry,
        hoverIndicatorMaterial,
      );
      hoverIndicator.name = "hover-indicator";
      hoverIndicator.visible = false;
      hoverIndicator.renderOrder = 1000;
      controller.add(hoverIndicator);
      this.hoverIndicators.push(hoverIndicator);
    }
    this.refreshPointerVisuals();

    this.dolly.add(this.controller1);
    this.dolly.add(this.controller2);
    const controllerModelFactory = new XRControllerModelFactory();
    const controllerGrip1 = renderer.xr.getControllerGrip(0);
    controllerGrip1.add(
      controllerModelFactory.createControllerModel(controllerGrip1),
    );
    this.dolly.add(controllerGrip1);
    const controllerGrip2 = renderer.xr.getControllerGrip(1);
    controllerGrip2.add(
      controllerModelFactory.createControllerModel(controllerGrip2),
    );
    this.dolly.add(controllerGrip2);
    this.controllerGrips = [controllerGrip1, controllerGrip2];

    this.target = target;
    this.distanceFromFocus = distanceFromFocus;
    this.controlMode = controlMode;
    this.controlledObject = controlledObject;
    this.camera = renderer.xr.getCamera() as WebXRArrayCamera;
    this.perspectiveCamera = camera;

    if (this.controlMode === "camera") {
      this.perspectiveCamera.zoom = 1.0;
      this.perspectiveCamera.position.set(0.0, 0.0, 0.0);
      this.perspectiveCamera.rotation.set(0.0, 0.0, 0.0);
      this.perspectiveCamera.updateProjectionMatrix();
      this.dolly.add(this.perspectiveCamera);
    }

    // Initialize orbit controls properties
    this.spherical = new Spherical();
    this.sphericalDelta = new Spherical();
    this.quat = new Quaternion().setFromUnitVectors(camera.up, new Vector3(0, 1, 0));
    this.quatInverse = this.quat.clone().invert();
    this.lastPosition = new Vector3();
    this.scale = 1;

    // Initialize rotation state
    this.rotateStart = new Vector2();
    this.rotateEnd = new Vector2();
    this.rotateDelta = new Vector2();

    // Initialize dolly position based on target and distance
    this.initializeDollyPosition();

    this.scene = scene;
    this.raycastGroup = raycastGroup;
  }

  public setControllerHints(hints: VRControllerHints | null): void {
    if (hints === null || (!hints.left && !hints.right)) {
      this.controllerHintsView?.dispose();
      this.controllerHintsView = null;
      this.lastHintsUpdateTime = null;
      return;
    }

    if (!this.controllerHintsView) {
      this.controllerHintsView = new VRControllerHintsView(
        this.renderer,
        this.controllerGrips,
      );
    }
    this.controllerHintsView.setHints(hints, this.handedness);
    this.lastHintsUpdateTime = null;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.xrSession.removeEventListener(
      "inputsourceschange",
      this.handleInputSourcesChange,
    );
    this.xrSession.removeEventListener("end", this.handleSessionEnd);
    this.controllerHintsView?.dispose();
    this.controllerHintsView = null;
    this.lastHintsUpdateTime = null;
  }

  private syncInputSources(): void {
    this.controllers = [];
    this.handedness = [];

    this.xrSession.inputSources.forEach((source) => {
      if (source.gamepad) {
        this.controllers.push(source.gamepad);
        this.handedness.push(source.handedness);
      }
    });
  }

  private refreshPointerVisuals(): void {
    for (let index = 0; index < this.controllerPointers.length; index++) {
      const isRightController = this.handedness[index] === "right";
      this.controllerPointers[index].visible = isRightController;
      this.hoverIndicators[index].visible = false;
    }
  }

  private initializeDollyPosition(): void {
    if (this.controlMode === "object") {
      this.dolly.position.set(0, 0, 0);
      this.dolly.rotation.set(0, 0, 0);
      this.dolly.scale.set(1, 1, 1);
      this.dolly.updateMatrixWorld(true);
      return;
    }

    // Initialize spherical coordinates with proper values
    this.spherical.radius = this.distanceFromFocus;
    this.spherical.phi = Math.PI / 2; // Start at horizontal level
    this.spherical.theta = 0; // Start facing the target

    // Set dolly position based on spherical coordinates
    this.updateDollyFromSpherical();
  }

  private setDollyPositionFromSpherical(): void {
    // Set spherical coordinates based on current distance and target
    const offset = new Vector3().copy(this.dolly.position).sub(this.target.position);
    offset.applyQuaternion(this.quat);
    this.spherical.setFromVector3(offset);
    this.spherical.radius = this.distanceFromFocus;
  }

  private updateDollyFromSpherical(): void {
    // Convert spherical coordinates back to world position
    const offset = new Vector3().setFromSpherical(this.spherical);
    offset.applyQuaternion(this.quatInverse);
    this.dolly.position.copy(this.target.position).add(offset);
    this.dolly.lookAt(this.target.position);
  }

  private rotateLeft(angle: number): void {
    this.sphericalDelta.theta -= angle;
  }

  private rotateUp(angle: number): void {
    this.sphericalDelta.phi -= angle;
  }

  private dollyOut(dollyScale: number): void {
    this.scale /= dollyScale;
  }

  private dollyIn(dollyScale: number): void {
    this.scale *= dollyScale;
  }

  private moveControlledObject(deltaDistance: number): void {
    if (!this.controlledObject) return;

    const currentDistance = Math.abs(this.controlledObject.position.z);
    const nextDistance = this.clampDistance(currentDistance + deltaDistance);
    this.controlledObject.position.z = -nextDistance;
  }

  private clampDistance(dist: number): number {
    return Math.max(this.minDistance, Math.min(this.maxDistance, dist));
  }

  private getZoomScale(delta: number): number {
    const normalizedDelta = Math.abs(delta * 0.01);
    return Math.pow(0.95, normalizedDelta);
  }

  private handleControllerInput(): void {
    if (this.controllers.length === 0) {
      this.syncInputSources();
    }

    if (!this.controllers || this.controllers.length === 0) return;

    // Handle input from VR controllers
    this.controllers.forEach((controller, index) => {
      if (!controller) return;

      const thumbstickX = controller.axes[2] || 0;
      const thumbstickY = controller.axes[3] || 0;
      const handedness = this.handedness[index];

      if (handedness === "left") {
        if (Math.abs(thumbstickY) > 0.1) {
          if (this.controlMode === "object") {
            this.moveControlledObject(
              thumbstickY * this.distanceFromFocus * 0.015,
            );
          } else {
            const zoomScale = 1 + Math.abs(thumbstickY) * 0.02;
            if (thumbstickY < 0) {
              this.dollyOut(zoomScale);
            } else {
              this.dollyIn(zoomScale);
            }
          }
        }
      } else if (this.controlMode === "object" && this.controlledObject) {
        let objectRotated = false;

        if (Math.abs(thumbstickX) > 0.1) {
          this.controlledObject.rotateOnWorldAxis(
            this.worldUp,
            -thumbstickX * this.rotationSpeed * 0.025,
          );
          objectRotated = true;
        }

        if (Math.abs(thumbstickY) > 0.1) {
          this.camera.getWorldQuaternion(this.cameraQuaternion);
          this.cameraRight
            .set(1, 0, 0)
            .applyQuaternion(this.cameraQuaternion)
            .normalize();
          this.controlledObject.rotateOnWorldAxis(
            this.cameraRight,
            -thumbstickY * this.rotationSpeed * 0.025,
          );
          objectRotated = true;
        }

        if (objectRotated) {
          this.controlledObject.updateMatrixWorld(true);
        }
      } else {
        if (Math.abs(thumbstickX) > 0.1) {
          this.rotateLeft(thumbstickX * this.rotationSpeed * 0.02);
        }

        if (Math.abs(thumbstickY) > 0.1) {
          this.rotateUp(thumbstickY * this.rotationSpeed * 0.02);
        }
      }

      // Handle trigger for selection
      const trigger = controller.buttons[0] ? controller.buttons[0].value : 0;

      if (trigger > 0.5 && !this.prevTriggerState[index]) {
        console.log("Trigger pressed on controller", trigger);
        if (this.onSelect) {
          this.onSelect();
        }
        this.prevTriggerState[index] = true;
      } else if (trigger < 0.5) {
        this.prevTriggerState[index] = false;
      }

      // Handle A/X buttons (Button 4)
      const button4 = controller.buttons[4]?.pressed || false;
      if (button4 && !this.prevButton4State[index]) {
        if (handedness === 'right' && this.onAPressed) this.onAPressed();
        if (handedness === 'left' && this.onXPressed) this.onXPressed();
        this.prevButton4State[index] = true;
      } else if (!button4) {
        this.prevButton4State[index] = false;
      }

      // Handle B/Y buttons (Button 5)
      const button5 = controller.buttons[5]?.pressed || false;
      if (button5 && !this.prevButton5State[index]) {
        if (handedness === 'right' && this.onBPressed) this.onBPressed();
        if (handedness === 'left' && this.onYPressed) this.onYPressed();
        this.prevButton5State[index] = true;
      } else if (!button5) {
        this.prevButton5State[index] = false;
      }
    });

    this.handleResetGesture();
  }

  private handleResetGesture(): void {
    const leftControllerIndex = this.handedness.indexOf("left");
    const rightControllerIndex = this.handedness.indexOf("right");
    const bothGripsPressed =
      leftControllerIndex >= 0 &&
      rightControllerIndex >= 0 &&
      Boolean(this.controllers[leftControllerIndex]?.buttons[1]?.pressed) &&
      Boolean(this.controllers[rightControllerIndex]?.buttons[1]?.pressed);

    if (!bothGripsPressed) {
      this.resetHoldStartedAt = null;
      this.resetGestureLatched = false;
      return;
    }

    if (this.resetGestureLatched) return;

    const now = performance.now();
    if (this.resetHoldStartedAt === null) {
      this.resetHoldStartedAt = now;
      return;
    }

    if (now - this.resetHoldStartedAt < this.resetHoldDurationMs) return;

    this.resetGestureLatched = true;
    this.onReset?.();
  }

  private updateRaycaster(): void {
    const controllers = [this.controller1, this.controller2];
    const defaultPointerLength = Math.max(this.distanceFromFocus, 5);
    const rightControllerIndex = this.handedness.indexOf("right");

    if (rightControllerIndex < 0) {
      this.clearHoveredObject();
      return;
    }

    const controller = controllers[rightControllerIndex];
    const pointer = this.controllerPointers[rightControllerIndex];
    const hoverIndicator = this.hoverIndicators[rightControllerIndex];
    pointer.scale.z = (defaultPointerLength + POINTER_ORIGIN_INSET) / 5;
    hoverIndicator.visible = false;

    if (!this.raycastGroup) {
      this.clearHoveredObject();
      return;
    }

    this.tempMatrix.identity().extractRotation(controller.matrixWorld);
    this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
    this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);
    const intersects = this.raycaster.intersectObjects(
      this.raycastGroup.children,
      true,
    );

    if (intersects.length === 0) {
      this.clearHoveredObject();
      return;
    }

    const intersection = intersects[0];
    pointer.scale.z = (intersection.distance + POINTER_ORIGIN_INSET) / 5;
    hoverIndicator.position.set(0, 0, -intersection.distance);
    hoverIndicator.scale.setScalar(
      Math.max(intersection.distance * 0.006, 0.03),
    );
    hoverIndicator.visible = true;

    if (this.hoveredObject !== intersection.object) {
      this.hoveredObject = intersection.object;
      this.onHover?.(this.hoveredObject);
    }
  }

  private clearHoveredObject(): void {
    if (!this.hoveredObject) return;

    this.hoveredObject = null;
    this.onHover?.(null);
  }

  public update(delta: number = 0.0001): void {
    if (!this.enabled) return;

    this.updateControllerHints();

    this.updateRaycaster();

    // Handle VR controller input
    this.handleControllerInput();

    if (this.controlMode === "object") return;

    // Apply damping and delta changes to spherical coordinates
    if (this.enableDamping) {
      this.spherical.theta += this.sphericalDelta.theta * this.dampingFactor;
      this.spherical.phi += this.sphericalDelta.phi * this.dampingFactor;
    } else {
      this.spherical.theta += this.sphericalDelta.theta;
      this.spherical.phi += this.sphericalDelta.phi;
    }

    // Restrict phi to be between desired limits
    this.spherical.phi = Math.max(this.minPolarAngle, Math.min(this.maxPolarAngle, this.spherical.phi));

    // Apply scale changes
    this.spherical.radius = this.clampDistance(this.spherical.radius * this.scale);
    this.distanceFromFocus = this.spherical.radius;

    this.spherical.makeSafe();

    // Convert spherical coordinates back to world position
    const offset = new Vector3().setFromSpherical(this.spherical);
    offset.applyQuaternion(this.quatInverse);

    // Update dolly position
    this.dolly.position.copy(this.target.position).add(offset);
    this.dolly.lookAt(this.target.position);
    this.dolly.rotateY(Math.PI); // Ensure the dolly faces the target

    if (this.enableDamping) {
      this.sphericalDelta.theta *= (1 - this.dampingFactor);
      this.sphericalDelta.phi *= (1 - this.dampingFactor);
    } else {
      this.sphericalDelta.set(0, 0, 0);
    }

    this.scale = 1;
  }

  private updateControllerHints(): void {
    if (!this.controllerHintsView) return;

    const now = performance.now();
    const deltaMilliseconds =
      this.lastHintsUpdateTime === null ? 0 : now - this.lastHintsUpdateTime;
    this.lastHintsUpdateTime = now;
    this.controllerHintsView.update(deltaMilliseconds);
  }

}
