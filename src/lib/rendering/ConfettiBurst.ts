import {
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedMesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  PlaneGeometry,
  Vector3,
  type Camera,
} from "three";

const PARTICLE_COUNT = 960;
const LAUNCH_DELAY_SECONDS = 1.25;
const DURATION_SECONDS = 8;
const CANNON_COUNT = 12;
const FLOOR = -2.5;
const COLORS = [0xffcc38, 0xff577f, 0x31d8c3, 0x61a9ff, 0xc885ff];

type Particle = {
  position: Vector3;
  velocity: Vector3;
  launchOffset: number;
  fallSpeed: number;
  rotation: Vector3;
  spin: Vector3;
  size: number;
};

/** Room-wide confetti in one draw call, anchored where the viewer was on discovery. */
export class ConfettiBurst {
  readonly mesh = new InstancedMesh(
    new PlaneGeometry(0.05, 0.085),
    new MeshBasicMaterial({
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }),
    PARTICLE_COUNT,
  );

  private readonly transform = new Object3D();
  private particles: Particle[] = [];
  private elapsed = 0;

  constructor() {
    this.mesh.name = "Acid discovery confetti";
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    // The particles move beyond the initial geometry bounds during the burst.
    this.mesh.frustumCulled = false;
    for (let index = 0; index < PARTICLE_COUNT; index++) {
      this.mesh.setColorAt(index, new Color(COLORS[index % COLORS.length]));
    }
    this.clear();
  }

  play(camera: Camera, immersive: boolean): void {
    this.elapsed = 0;
    camera.getWorldPosition(this.mesh.position);
    this.mesh.quaternion.identity();
    this.mesh.scale.setScalar(1);
    if (!immersive) {
      // Fill the desktop viewport even when the graph camera is zoomed in.
      camera.getWorldQuaternion(this.mesh.quaternion);
      const projection = camera.projectionMatrix.elements;
      const depth = camera instanceof OrthographicCamera ? 3 : 1;
      this.mesh.scale.set(
        1 / (projection[0] * depth),
        1 / (projection[5] * depth),
        1,
      );
    }
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.particles = Array.from({ length: PARTICLE_COUNT }, (_, index) => {
      const cannon = index % CANNON_COUNT;
      const angle = (cannon / CANNON_COUNT) * Math.PI * 2;
      // Low launch points surround the viewer, with fans directed up and outward.
      const radius = 2.7 + Math.random() * 0.2;
      const outwardSpeed = 0.25 + Math.random() * 0.6;
      const spread = (Math.random() - 0.5) * 3.8;
      return {
        position: new Vector3(
          Math.cos(angle) * radius,
          -1.65 + Math.random() * 0.12,
          Math.sin(angle) * radius,
        ),
        velocity: new Vector3(
          Math.cos(angle) * outwardSpeed - Math.sin(angle) * spread,
          8 + Math.random() * 3,
          Math.sin(angle) * outwardSpeed + Math.cos(angle) * spread,
        ),
        launchOffset: (cannon % 3) * 0.18 + Math.random() * 0.25,
        fallSpeed: 1.05 + Math.random() * 0.6,
        rotation: new Vector3(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          0,
        ),
        spin: new Vector3(
          Math.random() * 8 - 4,
          Math.random() * 8 - 4,
          Math.random() * 8 - 4,
        ),
        size: 0.7 + Math.random() * 0.8,
      };
    });
    this.update(0);
  }

  update(deltaSeconds: number): void {
    if (this.particles.length === 0) return;
    this.elapsed += Math.max(0, deltaSeconds);
    const time = this.elapsed - LAUNCH_DELAY_SECONDS;
    if (time < 0) return;
    if (time >= DURATION_SECONDS) {
      this.clear();
      return;
    }

    this.mesh.visible = true;
    this.mesh.count = PARTICLE_COUNT;
    this.particles.forEach(
      ({ position, velocity, launchOffset, fallSpeed, rotation, spin, size }, index) => {
        const age = Math.max(0, time - launchOffset);
        const travel = (1 - Math.exp(-0.8 * age)) / 0.8;
        // Air drag turns a fast upward shot into a slow fall, with a smooth apex.
        const rise = (1 - Math.exp(-1.65 * age)) / 1.65;
        const y = position.y + (velocity.y + fallSpeed) * rise - fallSpeed * age;
        const flutter = (1 - Math.exp(-age * 0.8)) * 0.18;
        this.transform.position.set(
          position.x + velocity.x * travel + Math.sin(age * 2.7 + rotation.x) * flutter,
          y,
          position.z + velocity.z * travel + Math.cos(age * 2.7 + rotation.y) * flutter,
        );
        const spinTime = age * 0.6 + (1 - Math.exp(-age * 2)) * 0.5;
        this.transform.rotation.set(
          rotation.x + spin.x * spinTime,
          rotation.y + spin.y * spinTime,
          rotation.z + spin.z * spinTime,
        );
        const launchFade = Math.min(1, age / 0.16);
        const landingFade = Math.max(0, Math.min(1, (y - FLOOR) / 0.5));
        this.transform.scale.setScalar(size * launchFade * landingFade);
        this.transform.updateMatrix();
        this.mesh.setMatrixAt(index, this.transform.matrix);
      },
    );
    this.mesh.material.opacity = Math.max(
      0,
      Math.min(1, time / 0.3, (DURATION_SECONDS - time) / 1.5),
    );
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear(): void {
    this.mesh.visible = false;
    this.mesh.count = 0;
    this.particles = [];
  }

  dispose(): void {
    this.clear();
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
