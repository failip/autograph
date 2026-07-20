import { VRControls } from "$lib/vr/controls/VRControls";
import {
  AmbientLight,
  Color,
  DirectionalLight,
  GridHelper,
  Group,
  Material,
  Mesh,
  Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from "three";
import { HdrSceneBackground } from "./background";
import { MoleculeGenerator } from "./molecules";
import { ObjectOrbitControls } from "./ObjectOrbitControls";
import { parseRun, type Run } from "./xyz";

type XrMode = "immersive-vr" | "immersive-ar";

const NODE_ID = "trajectory";
const SINGLE_FRAME_HOLD_SECONDS = 1.2;
export const TRAJECTORY_CAMERA_FOV = 60;
const origin = new Vector3(0, 0, 0);

export function getTrajectoryCameraDistance(viewRadius: number): number {
  return Math.max(6, viewRadius * 2.8);
}

export function getTrajectoryXrObjectDistance(viewRadius: number): number {
  return Math.max(2.5, Math.min(8, viewRadius * 1.5));
}

export type TrajectoryViewerState = {
  run: Run | null;
  frameIndex: number;
  playbackFps: number;
  isPlaying: boolean;
  loop: boolean;
  hasVr: boolean;
  hasAr: boolean;
  isImmersive: boolean;
  activeXrMode: XrMode | null;
  errorMessage: string;
  xrError: string;
};

export type TrajectoryPlaybackOptions = {
  initialFps?: number;
  autoPlayOnce?: boolean;
  autoPlayDelayMs?: number;
  onComplete?: () => void;
  onStateChange?: () => void;
  moleculeGenerator?: MoleculeGenerator;
};

export type StandaloneTrajectoryViewerOptions = TrajectoryPlaybackOptions & {
  canvas: HTMLCanvasElement;
  wrapper: HTMLElement;
};

function validateRun(parsedRun: Run): void {
  if (
    !Number.isInteger(parsedRun.number_of_atoms) ||
    parsedRun.number_of_atoms <= 0
  ) {
    throw new Error("The file does not start with a valid atom count.");
  }

  if (
    !Number.isInteger(parsedRun.number_of_frames) ||
    parsedRun.number_of_frames <= 0
  ) {
    throw new Error("No complete XYZ frames were found.");
  }

  if (parsedRun.symbols.length !== parsedRun.number_of_atoms) {
    throw new Error("The first XYZ frame does not contain the expected atoms.");
  }

  parsedRun.symbols.forEach((symbol, atomIndex) => {
    if (!symbol) {
      throw new Error(`Atom ${atomIndex + 1} is missing an element symbol.`);
    }
  });

  parsedRun.frames.forEach((frame, currentFrame) => {
    if (frame.positions.length !== parsedRun.number_of_atoms * 3) {
      throw new Error(
        `Frame ${currentFrame + 1} has an invalid coordinate count.`,
      );
    }

    for (let index = 0; index < frame.positions.length; index += 1) {
      if (!Number.isFinite(frame.positions[index])) {
        throw new Error(
          `Frame ${currentFrame + 1} contains an invalid coordinate.`,
        );
      }
    }
  });
}

function prepareRun(parsedRun: Run): { run: Run; moleculeScale: number; viewRadius: number } {
  let maxRadius = 0;
  const frames = parsedRun.frames.map((frame) => {
    const positions = new Float32Array(frame.positions.length);
    let centerX = 0;
    let centerY = 0;
    let centerZ = 0;

    for (
      let atomIndex = 0;
      atomIndex < parsedRun.number_of_atoms;
      atomIndex += 1
    ) {
      centerX += frame.positions[atomIndex * 3];
      centerY += frame.positions[atomIndex * 3 + 1];
      centerZ += frame.positions[atomIndex * 3 + 2];
    }

    centerX /= parsedRun.number_of_atoms;
    centerY /= parsedRun.number_of_atoms;
    centerZ /= parsedRun.number_of_atoms;

    for (
      let atomIndex = 0;
      atomIndex < parsedRun.number_of_atoms;
      atomIndex += 1
    ) {
      const x = frame.positions[atomIndex * 3] - centerX;
      const y = frame.positions[atomIndex * 3 + 1] - centerY;
      const z = frame.positions[atomIndex * 3 + 2] - centerZ;

      positions[atomIndex * 3] = x;
      positions[atomIndex * 3 + 1] = y;
      positions[atomIndex * 3 + 2] = z;

      maxRadius = Math.max(maxRadius, Math.sqrt(x * x + y * y + z * z));
    }

    return { positions };
  });

  const moleculeScale = 2.8 / Math.max(maxRadius, 1);
  const viewRadius = Math.max(maxRadius * moleculeScale + 0.7, 2.2);

  return {
    run: {
      number_of_atoms: parsedRun.number_of_atoms,
      number_of_frames: parsedRun.number_of_frames,
      symbols: [...parsedRun.symbols],
      frames,
    },
    moleculeScale,
    viewRadius,
  };
}

function disposeMaterial(material: Mesh["material"]): void {
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((item) => item.dispose());
}

function disposeMolecule(group: Group, moleculeGenerator: MoleculeGenerator): void {
  group.traverse((child) => {
    if (child instanceof Mesh) {
      if (child.geometry !== moleculeGenerator.bond_geometry) {
        child.geometry.dispose();
      }
      disposeMaterial(child.material);
    }
  });
}

function forEachObjectMaterial(
  object: Object3D,
  callback: (material: Material) => void,
): void {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) return;

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    materials.forEach(callback);
  });
}

export class TrajectoryPlaybackObject {
  public readonly root = new Group();
  public run: Run | null = null;
  public frameIndex = 0;
  public playbackFps: number;
  public isPlaying = true;
  public loop = true;
  public errorMessage = "";
  public moleculeScale = 1;
  public viewRadius = 3;

  private moleculeGenerator: MoleculeGenerator;
  private moleculeGroup: Group | null = null;
  private frameAccumulator = 0;
  private autoPlayOnce: boolean;
  private autoPlayDelayMs: number;
  private onComplete: () => void;
  private onStateChange: () => void;
  private completionNotified = false;
  private playbackStartDelaySeconds = 0;
  private singleFrameCompletionDelaySeconds = 0;
  private selectedSpecies = new Set<string>();

  constructor(options: TrajectoryPlaybackOptions = {}) {
    this.playbackFps = options.initialFps ?? 30;
    this.autoPlayOnce = options.autoPlayOnce ?? false;
    this.autoPlayDelayMs = options.autoPlayDelayMs ?? 0;
    this.onComplete = options.onComplete ?? (() => {});
    this.onStateChange = options.onStateChange ?? (() => {});
    this.moleculeGenerator = options.moleculeGenerator ?? new MoleculeGenerator();
    this.root.name = "Trajectory Object Stage";
  }

  public loadXyzText(text: string): void {
    this.frameAccumulator = 0;
    this.frameIndex = 0;
    this.errorMessage = "";
    this.completionNotified = false;
    this.playbackStartDelaySeconds = 0;
    this.singleFrameCompletionDelaySeconds = 0;

    try {
      if (!text.trim()) {
        throw new Error("Choose a non-empty XYZ file.");
      }

      const parsedRun = parseRun(text);
      validateRun(parsedRun);
      const prepared = prepareRun(parsedRun);
      const nextMolecule = this.moleculeGenerator.generateMolecule(
        prepared.run,
        new Set(),
        false,
      );

      nextMolecule.scale.setScalar(prepared.moleculeScale);
      nextMolecule.userData.name = NODE_ID;
      nextMolecule.traverse((child) => {
        child.userData.name = NODE_ID;
      });

      this.removeCurrentMolecule();
      this.run = prepared.run;
      this.moleculeScale = prepared.moleculeScale;
      this.viewRadius = prepared.viewRadius;
      this.moleculeGroup = nextMolecule;
      this.root.add(this.moleculeGroup);
      this.loop = this.autoPlayOnce ? false : this.loop;

      if (this.autoPlayOnce) {
        this.playOnce(this.autoPlayDelayMs);
      } else {
        this.isPlaying = prepared.run.number_of_frames > 1;
      }

      this.onStateChange();
    } catch (error) {
      this.removeCurrentMolecule();
      this.run = null;
      this.isPlaying = false;
      this.errorMessage =
        error instanceof Error ? error.message : "Unable to parse this XYZ file.";
      this.onStateChange();
      throw error;
    }
  }

  public update(deltaSeconds: number): void {
    const safeDeltaSeconds = Math.max(0, Math.min(deltaSeconds, 0.1));
    let stateChanged = false;

    if (this.playbackStartDelaySeconds > 0) {
      this.playbackStartDelaySeconds -= safeDeltaSeconds;
      if (this.playbackStartDelaySeconds <= 0 && this.run) {
        this.playbackStartDelaySeconds = 0;
        this.isPlaying = this.run.number_of_frames > 1;
        stateChanged = true;
      }
    }

    if (this.singleFrameCompletionDelaySeconds > 0) {
      this.singleFrameCompletionDelaySeconds -= safeDeltaSeconds;
      if (this.singleFrameCompletionDelaySeconds <= 0) {
        this.singleFrameCompletionDelaySeconds = 0;
        this.notifyComplete();
        stateChanged = true;
      }
    }

    if (this.isPlaying && this.run && this.run.number_of_frames > 1) {
      this.frameAccumulator += safeDeltaSeconds * this.playbackFps;
      while (this.frameAccumulator >= 1) {
        const oldFrameIndex = this.frameIndex;
        this.advancePlaybackFrame(1);
        stateChanged = stateChanged || oldFrameIndex !== this.frameIndex;
        this.frameAccumulator -= 1;
      }
    }

    if (stateChanged) {
      this.onStateChange();
    }
  }

  public playOnce(delayMs = this.autoPlayDelayMs): void {
    this.loop = false;
    this.isPlaying = false;
    this.frameAccumulator = 0;
    this.completionNotified = false;
    this.playbackStartDelaySeconds = 0;
    this.singleFrameCompletionDelaySeconds = 0;

    if (!this.run) {
      this.onStateChange();
      return;
    }

    const delaySeconds = Math.max(0, delayMs / 1000);
    if (this.run.number_of_frames <= 1) {
      this.singleFrameCompletionDelaySeconds =
        delaySeconds + SINGLE_FRAME_HOLD_SECONDS;
    } else if (delaySeconds > 0) {
      this.playbackStartDelaySeconds = delaySeconds;
    } else {
      this.isPlaying = true;
    }

    this.onStateChange();
  }

  public togglePlayback(): void {
    if (!this.run || this.run.number_of_frames <= 1) return;
    this.isPlaying = !this.isPlaying;
    this.onStateChange();
  }

  public stepFrame(delta: number): void {
    if (!this.run) return;
    this.isPlaying = false;
    this.frameAccumulator = 0;
    this.applyFrame(this.frameIndex + delta);
    this.onStateChange();
  }

  public setPlaybackFps(fps: number): void {
    this.playbackFps = Math.max(1, Math.min(60, fps));
    this.onStateChange();
  }

  public setLoop(loop: boolean): void {
    this.loop = loop;
    this.onStateChange();
  }

  public setOpacity(alpha: number): void {
    const clampedAlpha = Math.max(0, Math.min(1, alpha));
    forEachObjectMaterial(this.root, (material) => {
      material.opacity = clampedAlpha;
      material.transparent = clampedAlpha < 1;
      material.needsUpdate = true;
    });
  }

  public dispose(): void {
    this.removeCurrentMolecule();
  }

  private getFrameCount(): number {
    return this.run?.number_of_frames ?? 0;
  }

  private normalizeFrameIndex(index: number): number {
    const frameCount = this.getFrameCount();
    if (frameCount === 0) return 0;
    if (this.loop) return ((index % frameCount) + frameCount) % frameCount;
    return Math.max(0, Math.min(frameCount - 1, index));
  }

  private applyFrame(index: number): void {
    if (!this.run || !this.moleculeGroup) return;
    this.frameIndex = this.normalizeFrameIndex(index);
    this.moleculeGenerator.updateMolecule(
      this.moleculeGroup,
      this.run,
      this.frameIndex,
      this.selectedSpecies,
      NODE_ID,
    );
  }

  private advancePlaybackFrame(delta: number): void {
    if (!this.run || this.run.number_of_frames <= 1) return;

    const nextFrame = this.frameIndex + delta;
    if (!this.loop && nextFrame >= this.run.number_of_frames) {
      this.applyFrame(this.run.number_of_frames - 1);
      this.isPlaying = false;
      this.notifyComplete();
      return;
    }

    this.applyFrame(nextFrame);
  }

  private notifyComplete(): void {
    if (this.completionNotified) return;
    this.completionNotified = true;
    this.onComplete();
  }

  private removeCurrentMolecule(): void {
    if (!this.moleculeGroup) return;
    this.root.remove(this.moleculeGroup);
    disposeMolecule(this.moleculeGroup, this.moleculeGenerator);
    this.moleculeGroup = null;
  }
}

export class StandaloneTrajectoryViewer {
  public readonly playback: TrajectoryPlaybackObject;
  public hasVr = false;
  public hasAr = false;
  public isImmersive = false;
  public activeXrMode: XrMode | null = null;
  public xrError = "";

  private canvas: HTMLCanvasElement;
  private wrapper: HTMLElement;
  private scene: Scene;
  private renderer: WebGLRenderer;
  private camera: PerspectiveCamera;
  private orbitControls: ObjectOrbitControls;
  private xrControls: VRControls | null = null;
  private currentSession: XRSession | null = null;
  private resizeObserver: ResizeObserver;
  private sceneBackground: HdrSceneBackground;
  private referencePlane: GridHelper;
  private lastAnimationTime = 0;
  private onStateChange: (state: TrajectoryViewerState) => void;

  constructor(options: StandaloneTrajectoryViewerOptions) {
    this.canvas = options.canvas;
    this.wrapper = options.wrapper;
    this.onStateChange = options.onStateChange ?? (() => {});

    this.scene = new Scene();
    this.camera = new PerspectiveCamera(TRAJECTORY_CAMERA_FOV, 1, 0.01, 1000);
    this.camera.position.set(0, 0, this.getCameraDistance());
    this.scene.add(this.camera);

    this.playback = new TrajectoryPlaybackObject({
      initialFps: options.initialFps,
      autoPlayOnce: options.autoPlayOnce,
      autoPlayDelayMs: options.autoPlayDelayMs,
      onComplete: options.onComplete,
      onStateChange: () => this.emitState(),
    });
    this.scene.add(this.playback.root);

    const ambientLight = new AmbientLight(0xffffff, 1.6);
    this.scene.add(ambientLight);

    const directionalLight = new DirectionalLight(0xffffff, 3.5);
    directionalLight.position.set(2, 4, 5);
    this.camera.add(directionalLight);

    this.referencePlane = new GridHelper(80, 80, 0x666666, 0xb8b8b8);
    this.referencePlane.visible = false;
    const referenceMaterials = Array.isArray(this.referencePlane.material)
      ? this.referencePlane.material
      : [this.referencePlane.material];
    referenceMaterials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.36;
    });
    this.updateReferencePlane();
    this.playback.root.add(this.referencePlane);

    this.renderer = new WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.setClearColor(new Color(0xf0f0f0), 1);
    this.renderer.xr.enabled = true;

    this.sceneBackground = new HdrSceneBackground(this.scene, this.renderer);
    this.sceneBackground.load();
    this.applyEnvironmentForMode();

    this.orbitControls = new ObjectOrbitControls(
      this.camera,
      this.renderer.domElement,
      this.playback.root,
    );
    this.orbitControls.enableDamping = true;
    this.orbitControls.dampingFactor = 0.08;
    this.orbitControls.enablePan = true;
    this.orbitControls.target.copy(origin);

    this.resizeObserver = new ResizeObserver(() => this.updateSize());
    this.resizeObserver.observe(this.wrapper);
    this.updateSize();
    this.resetView();

    this.renderer.setAnimationLoop((time) => this.animate(time));
    void this.detectXrSupport();
    this.emitState();
  }

  public loadXyzText(text: string): void {
    try {
      this.playback.loadXyzText(text);
      this.updateReferencePlane();
      this.resetView();
    } catch {
      // The playback object already exposes the user-facing parse error.
    }
    this.emitState();
  }

  public togglePlayback(): void {
    this.playback.togglePlayback();
  }

  public stepFrame(delta: number): void {
    this.playback.stepFrame(delta);
  }

  public setPlaybackFps(fps: number): void {
    this.playback.setPlaybackFps(fps);
  }

  public setLoop(loop: boolean): void {
    this.playback.setLoop(loop);
  }

  public resetView(): void {
    if (this.isImmersive) {
      this.resetSceneRootForXr();
      return;
    }

    this.resetSceneRootForDesktop();
    this.camera.position.set(0, 0, this.getCameraDistance());
    this.camera.lookAt(origin);
    this.camera.near = 0.01;
    this.camera.far = 1000;
    this.camera.updateProjectionMatrix();

    this.orbitControls.target.copy(origin);
    this.orbitControls.update();
  }

  public async startXr(mode: XrMode): Promise<void> {
    const xr = navigator.xr;
    if (!xr) return;

    this.xrError = "";
    this.emitState();

    try {
      const supported = await xr.isSessionSupported(mode);
      if (!supported) {
        this.xrError =
          mode === "immersive-ar"
            ? "AR is not available on this device."
            : "VR is not available on this device.";
        this.emitState();
        return;
      }

      const session = await xr.requestSession(mode, {
        optionalFeatures: ["local-floor", "bounded-floor"],
      });

      this.currentSession = session;
      this.activeXrMode = mode;
      this.isImmersive = true;
      this.renderer.xr.enabled = true;
      this.resetSceneRootForXr();
      this.applyEnvironmentForMode();

      await this.renderer.xr.setSession(session);
      this.orbitControls.enabled = false;

      const target = new Object3D();
      target.position.copy(origin);
      this.xrControls = new VRControls(
        this.renderer,
        this.scene,
        this.camera,
        target,
        undefined,
        this.getXrObjectDistance(),
        "object",
        this.playback.root,
      );
      this.xrControls.minDistance = 1.2;
      this.xrControls.maxDistance = 20;
      this.xrControls.rotationSpeed = 1.25;
      this.xrControls.onSelect = () => this.togglePlayback();
      this.xrControls.onAPressed = () => this.stepFrame(1);
      this.xrControls.onBPressed = () => this.stepFrame(-1);
      this.xrControls.onXPressed = () => this.setPlaybackFps(this.playback.playbackFps - 1);
      this.xrControls.onYPressed = () => this.setPlaybackFps(this.playback.playbackFps + 1);

      session.addEventListener("end", this.handleXrEnded);
      this.emitState();
    } catch (error) {
      this.handleXrEnded();
      this.xrError =
        error instanceof Error ? error.message : "Unable to start WebXR.";
      this.emitState();
    }
  }

  public dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.orbitControls.dispose();

    if (this.currentSession) {
      this.currentSession.removeEventListener("end", this.handleXrEnded);
      this.currentSession.end().catch(() => {});
    }

    if (this.referencePlane) {
      this.referencePlane.geometry.dispose();
      const referenceMaterials = Array.isArray(this.referencePlane.material)
        ? this.referencePlane.material
        : [this.referencePlane.material];
      referenceMaterials.forEach((material) => material.dispose());
    }

    this.sceneBackground.dispose();
    this.playback.dispose();
    this.renderer.dispose();
  }

  public getState(): TrajectoryViewerState {
    return {
      run: this.playback.run,
      frameIndex: this.playback.frameIndex,
      playbackFps: this.playback.playbackFps,
      isPlaying: this.playback.isPlaying,
      loop: this.playback.loop,
      hasVr: this.hasVr,
      hasAr: this.hasAr,
      isImmersive: this.isImmersive,
      activeXrMode: this.activeXrMode,
      errorMessage: this.playback.errorMessage,
      xrError: this.xrError,
    };
  }

  private handleXrEnded = (): void => {
    if (this.currentSession) {
      this.currentSession.removeEventListener("end", this.handleXrEnded);
    }

    if (this.xrControls) {
      this.scene.remove(this.xrControls.dolly);
    }

    this.xrControls = null;
    this.currentSession = null;
    this.activeXrMode = null;
    this.isImmersive = false;
    this.resetSceneRootForDesktop();
    this.orbitControls.enabled = true;
    this.applyEnvironmentForMode();
    this.resetView();
    this.emitState();
  };

  private animate(time: number): void {
    const deltaSeconds =
      this.lastAnimationTime === 0 ? 0 : (time - this.lastAnimationTime) / 1000;
    this.lastAnimationTime = time;

    this.playback.update(deltaSeconds);

    if (this.xrControls) {
      this.xrControls.update(deltaSeconds);
    } else {
      this.orbitControls.update();
    }

    this.renderer.render(this.scene, this.camera);
  }

  private updateSize(): void {
    const width = Math.max(this.wrapper.clientWidth, 1);
    const height = Math.max(this.wrapper.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private updateReferencePlane(): void {
    this.referencePlane.position.y = -Math.max(this.playback.viewRadius + 0.4, 3);
  }

  private applyEnvironmentForMode(): void {
    this.sceneBackground.setTransparentBackground(
      this.activeXrMode === "immersive-ar",
    );
    this.referencePlane.visible = false;
  }

  private async detectXrSupport(): Promise<void> {
    const xr = navigator.xr;
    if (!xr) return;

    try {
      this.hasVr = await xr.isSessionSupported("immersive-vr");
      this.hasAr = await xr.isSessionSupported("immersive-ar");
    } catch {
      this.hasVr = false;
      this.hasAr = false;
    }

    this.emitState();
  }

  private getCameraDistance(): number {
    return getTrajectoryCameraDistance(this.playback.viewRadius);
  }

  private getXrObjectDistance(): number {
    return getTrajectoryXrObjectDistance(this.playback.viewRadius);
  }

  private resetSceneRootForDesktop(): void {
    this.playback.root.position.set(0, 0, 0);
    this.playback.root.rotation.set(0, 0, 0);
    this.playback.root.scale.setScalar(1);
  }

  private resetSceneRootForXr(): void {
    this.playback.root.position.set(0, 0, -this.getXrObjectDistance());
    this.playback.root.rotation.set(0, 0, 0);
    this.playback.root.scale.setScalar(1);
  }

  private emitState(): void {
    this.onStateChange(this.getState());
  }
}
