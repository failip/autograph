import { Object3D, PerspectiveCamera, Scene, Vector3, Vector2, WebGLRenderer, type WebXRArrayCamera, Spherical, Quaternion, Matrix4, Raycaster, CylinderGeometry, MeshBasicMaterial, Mesh } from "three";
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';

export class VRControls {
  public target: Object3D
  public camera: PerspectiveCamera;
  public distanceFromFocus = 50.0;
  public rotationSpeed = 1.0;
  public enabled = true;
  private xrSession: XRSession;

  private raycaster: Raycaster;
  private tempMatrix: Matrix4;

  public controller1: Object3D;
  public controller2: Object3D;

  private perspectiveCamera: PerspectiveCamera;

  dolly: Object3D;
  controllers: Gamepad[] = [];
  handedness: XRHandedness[] = [];

  private scene: Scene;
  private raycastGroup: Object3D | undefined;

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
  public onHover: ((object: Object3D | null) => void) | null = null;

  private hoveredObject: Object3D | null = null;
  private prevTriggerState: boolean[] = [false, false];
  private prevButton4State: boolean[] = [false, false];
  private prevButton5State: boolean[] = [false, false];

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, target: Object3D, raycastGroup?: Object3D) {

    const xrSession = renderer.xr.getSession();

    if (!xrSession) {
      throw new Error("XR Session not found. Make sure WebXR is enabled.");
    }

    this.xrSession = xrSession;

    this.xrSession.addEventListener('inputsourceschange', (event) => {
      this.controllers = [];
      this.handedness = [];

      // Reset states
      this.prevTriggerState = [false, false];
      this.prevButton4State = [false, false];
      this.prevButton5State = [false, false];

      this.xrSession.inputSources.forEach((source) => {
        if (source.gamepad) {
          this.controllers.push(source.gamepad);
          this.handedness.push(source.handedness);
        }
      });
    });

    this.raycaster = new Raycaster();
    this.tempMatrix = new Matrix4();

    this.dolly = new Object3D();
    this.dolly.name = "VR Dolly";

    scene.add(this.dolly);
    this.controller1 = renderer.xr.getController(0);
    this.controller2 = renderer.xr.getController(1);

    const geometry = new CylinderGeometry(0.002, 0.002, 5, 32);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0, -2.5);

    const material = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.5
    });

    const line = new Mesh(geometry, material);
    line.name = 'line';

    this.controller1.add(line.clone());
    this.controller2.add(line.clone());

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

    this.target = target;
    this.camera = renderer.xr.getCamera() as WebXRArrayCamera;
    this.perspectiveCamera = camera;
    this.perspectiveCamera.zoom = 1.0;
    this.perspectiveCamera.position.set(0.0, 0.0, 0.0);
    this.perspectiveCamera.rotation.set(0.0, 0.0, 0.0);
    this.perspectiveCamera.updateProjectionMatrix();
    this.dolly.add(this.perspectiveCamera);

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

  private initializeDollyPosition(): void {
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

  private clampDistance(dist: number): number {
    return Math.max(this.minDistance, Math.min(this.maxDistance, dist));
  }

  private getZoomScale(delta: number): number {
    const normalizedDelta = Math.abs(delta * 0.01);
    return Math.pow(0.95, normalizedDelta);
  }

  private handleControllerInput(): void {
    if (!this.controllers || this.controllers.length === 0) return;

    // Handle input from VR controllers
    this.controllers.forEach((controller, index) => {
      if (!controller) return;

      // Handle thumbstick rotation (orbit)
      const thumbstickX = controller.axes[2] || 0; // Right thumbstick X
      const thumbstickY = controller.axes[3] || 0; // Right thumbstick Y

      if (Math.abs(thumbstickX) > 0.1) {
        this.rotateLeft(thumbstickX * this.rotationSpeed * 0.02);
      }

      if (Math.abs(thumbstickY) > 0.1) {
        this.rotateUp(thumbstickY * this.rotationSpeed * 0.02);
      }

      // Handle trigger for selection
      const trigger = controller.buttons[0] ? controller.buttons[0].value : 0;
      const squeeze = controller.buttons[1] ? controller.buttons[1].value : 0;
      const handedness = this.handedness[index];

      if (trigger > 0.5 && !this.prevTriggerState[index]) {
        console.log("Trigger pressed on controller", trigger);
        if (this.onSelect) {
          this.onSelect();
        }
        this.prevTriggerState[index] = true;
      } else if (trigger < 0.5) {
        this.prevTriggerState[index] = false;
      }

      if (squeeze > 0.1) {
        if (handedness === "left") {
          this.dollyIn(1 + squeeze * 0.02);
        } else {
          this.dollyOut(1 + squeeze * 0.02);
        }
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
  }

  private updateRaycaster(): void {
    let foundIntersection = false;

    const controllers = [this.controller1, this.controller2];

    for (const controller of controllers) {
      this.tempMatrix.identity().extractRotation(controller.matrixWorld);
      this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);
      if (!this.raycastGroup) continue;
      const intersects = this.raycaster.intersectObjects(this.raycastGroup.children);
      if (intersects.length > 0) {
        console.log('intersected', intersects[0].object);
        const object = intersects[0].object;
        if (this.hoveredObject !== object) {
          this.hoveredObject = object;
          if (this.onHover) this.onHover(this.hoveredObject);
        }
        foundIntersection = true;

        // Adjust pointer length
        const line = controller.getObjectByName('line');
        if (line) {
          line.scale.z = intersects[0].distance / 5;
        }
        break;
      } else {
        // Reset pointer length
        const line = controller.getObjectByName('line');
        if (line) {
          line.scale.z = 1;
        }
      }
    }

    if (!foundIntersection && this.hoveredObject) {
      this.hoveredObject = null;
      if (this.onHover) this.onHover(null);
    }
  }

  public update(delta: number = 0.0001): void {
    if (!this.enabled) return;

    this.updateRaycaster();

    // Handle VR controller input
    this.handleControllerInput();

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

}