import { Object3D, PerspectiveCamera, Scene, Vector3, Vector2, WebGLRenderer, type WebXRArrayCamera, Spherical, Quaternion } from "three";
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';

export class VRControls {
  public target: Object3D
  public camera: PerspectiveCamera;
  public distanceFromFocus = 100.0;
  public rotationSpeed = 1.0;
  public enabled = true;
  private xrSession: XRSession;

  private perspectiveCamera: PerspectiveCamera;

  dolly: Object3D;
  controllers: Gamepad[] = [];
  handedness: XRHandedness[] = [];

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
  public maxDistance = 10;
  public minPolarAngle = 0;
  public maxPolarAngle = Math.PI;
  public enableDamping = true;
  public dampingFactor = 0.05;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, target: Object3D) {

    const xrSession = renderer.xr.getSession();

    if (!xrSession) {
      throw new Error("XR Session not found. Make sure WebXR is enabled.");
    }

    this.xrSession = xrSession;



    this.xrSession.addEventListener('inputsourceschange', (event) => {
      this.controllers = [];
      this.handedness = [];
      this.xrSession.inputSources.forEach((source) => {
        if (source.gamepad) {
          this.controllers.push(source.gamepad);
          this.handedness.push(source.handedness);
        }
      });
    });

    this.dolly = new Object3D();
    this.dolly.name = "VR Dolly";

    scene.add(this.dolly);
    const controller1 = renderer.xr.getController(0);
    const controller2 = renderer.xr.getController(1);
    this.dolly.add(controller1);
    this.dolly.add(controller2);
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
    this.setDollyPositionFromSpherical();
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

  private moveDollyToProperDistance(): void {
    // Initialize dolly position if needed
    if (this.spherical.radius === 0) {
      this.spherical.radius = this.distanceFromFocus;
      this.spherical.phi = Math.PI / 2;
      this.spherical.theta = 0;
    }
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

      // Handle trigger for zoom (dolly)
      const trigger = controller.buttons[0] ? controller.buttons[0].value : 0;
      const squeeze = controller.buttons[1] ? controller.buttons[1].value : 0;

      if (trigger > 0.1) {
        this.dollyIn(1 + trigger * 0.02);
      }

      if (squeeze > 0.1) {
        this.dollyOut(1 + squeeze * 0.02);
      }
    });
  }

  public update(delta: number = 0.0001): void {
    if (!this.enabled) return;

    this.moveDollyToProperDistance();

    // Handle VR controller input
    this.handleControllerInput();

    // Apply orbit controls logic similar to OrbitControls
    const position = this.dolly.position;
    const offset = new Vector3().copy(position).sub(this.target.position);

    // Rotate offset to "y-axis-is-up" space
    offset.applyQuaternion(this.quat);

    // Update spherical coordinates
    this.spherical.setFromVector3(offset);

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

    // Convert back to world coordinates
    offset.setFromSpherical(this.spherical);
    offset.applyQuaternion(this.quatInverse);

    // Update dolly position
    position.copy(this.target.position).add(offset);
    this.dolly.lookAt(this.target.position);

    if (this.enableDamping) {
      this.sphericalDelta.theta *= (1 - this.dampingFactor);
      this.sphericalDelta.phi *= (1 - this.dampingFactor);
    } else {
      this.sphericalDelta.set(0, 0, 0);
    }

    this.scale = 1;
  }

}