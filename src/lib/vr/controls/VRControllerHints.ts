import { Container, Svg, Text, reversePainterSortStable } from "@pmndrs/uikit";
import { Badge, Panel } from "@pmndrs/uikit-horizon";
import type { Object3D, WebGLRenderer } from "three";

type TransformTuple = readonly [x: number, y: number, z: number];
type ControllerHand = "left" | "right";

export type VRControlHintIcon =
  | "button-a"
  | "button-b"
  | "thumbstick-y"
  | "thumbstick-xy";

export type VRControlHint = {
  input: string;
  action: string;
  icon?: VRControlHintIcon;
};

export type VRControllerHintPanel = {
  hints: readonly VRControlHint[];
  position?: TransformTuple;
  rotation?: TransformTuple;
};

export type VRControllerHints = Partial<
  Record<ControllerHand, VRControllerHintPanel>
>;

const CARD_WIDTH = 320;
const CARD_PIXEL_SIZE = 0.0003;
const CARD_PADDING = 14;
const CARD_GAP = 12;
const INPUT_VISUAL_WIDTH = 86;
const INPUT_VISUAL_HEIGHT = 48;

const CONTROL_ICON_SVGS: Record<VRControlHintIcon, string> = {
  "button-a": `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="30" fill="#7b8490"/>
      <circle cx="32" cy="32" r="27" fill="#11161d"/>
      <ellipse cx="27" cy="23" rx="14" ry="7" fill="#29313b"/>
      <path d="M17 48L27.5 17H36.5L47 48H39L36.8 40H27.2L25 48H17Z" fill="#f8fafc"/>
      <path d="M29.2 33.5H34.8L32 24.5L29.2 33.5Z" fill="#11161d"/>
    </svg>
  `,
  "button-b": `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r="30" fill="#7b8490"/>
      <circle cx="32" cy="32" r="27" fill="#11161d"/>
      <ellipse cx="27" cy="23" rx="14" ry="7" fill="#29313b"/>
      <path d="M18 16H34C43 16 48 20.5 48 27.5C48 31.5 46 34.5 42 36C47 37.5 50 41.5 50 46C50 54 44 58 34 58H18V16Z" fill="#f8fafc"/>
      <path d="M27 23H34C38 23 40 25 40 28C40 31 38 33 34 33H27V23Z" fill="#11161d"/>
      <path d="M27 40H35C39.5 40 42 42 42 45.5C42 49 39.5 51 35 51H27V40Z" fill="#11161d"/>
    </svg>
  `,
  "thumbstick-y": `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <path d="M32 2L22 14H28V21H36V14H42L32 2Z" fill="#f8fafc"/>
      <path d="M32 62L42 50H36V43H28V50H22L32 62Z" fill="#f8fafc"/>
      <circle cx="32" cy="32" r="18" fill="#7b8490"/>
      <circle cx="32" cy="32" r="15" fill="#11161d"/>
      <ellipse cx="28" cy="27" rx="9" ry="5" fill="#303945"/>
    </svg>
  `,
  "thumbstick-xy": `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
      <path d="M32 1L23 12H28V19H36V12H41L32 1Z" fill="#f8fafc"/>
      <path d="M32 63L41 52H36V45H28V52H23L32 63Z" fill="#f8fafc"/>
      <path d="M1 32L12 23V28H19V36H12V41L1 32Z" fill="#f8fafc"/>
      <path d="M63 32L52 41V36H45V28H52V23L63 32Z" fill="#f8fafc"/>
      <circle cx="32" cy="32" r="15" fill="#7b8490"/>
      <circle cx="32" cy="32" r="12" fill="#11161d"/>
      <ellipse cx="29" cy="28" rx="7" ry="4" fill="#303945"/>
    </svg>
  `,
};

const DEFAULT_TRANSFORMS: Record<
  ControllerHand,
  { position: TransformTuple; rotation: TransformTuple }
> = {
  left: {
    position: [-0.1, 0.07, 0.02],
    rotation: [-0.55, 0, 0],
  },
  right: {
    position: [0.1, 0.07, 0.02],
    rotation: [-0.55, 0, 0],
  },
};

export class VRControllerHintsView {
  private hints: VRControllerHints | null = null;
  private roots: Container[] = [];

  constructor(
    renderer: WebGLRenderer,
    private readonly controllerGrips: readonly Object3D[],
  ) {
    renderer.localClippingEnabled = true;
    renderer.setTransparentSort(reversePainterSortStable);
  }

  setHints(
    hints: VRControllerHints | null,
    handedness: readonly XRHandedness[],
  ): void {
    this.hints = hints;
    this.rebuild(handedness);
  }

  refresh(handedness: readonly XRHandedness[]): void {
    this.rebuild(handedness);
  }

  update(deltaMilliseconds: number): void {
    for (const root of this.roots) {
      root.update(deltaMilliseconds);
    }
  }

  dispose(): void {
    for (const root of this.roots) {
      root.dispose();
    }
    this.roots = [];
    this.hints = null;
  }

  private rebuild(handedness: readonly XRHandedness[]): void {
    for (const root of this.roots) {
      root.dispose();
    }
    this.roots = [];

    if (!this.hints) return;

    for (let index = 0; index < this.controllerGrips.length; index++) {
      const hand = handedness[index];
      if (hand !== "left" && hand !== "right") continue;

      const panelConfig = this.hints[hand];
      if (!panelConfig || panelConfig.hints.length === 0) continue;

      const root = this.createCard(hand, panelConfig);
      this.controllerGrips[index].add(root);
      this.roots.push(root);
    }
  }

  private createCard(
    hand: ControllerHand,
    config: VRControllerHintPanel,
  ): Container {
    const root = new Container({
      width: CARD_WIDTH,
      pixelSize: CARD_PIXEL_SIZE,
      alignItems: "stretch",
      pointerEvents: "none",
    });
    const panel = new Panel({
      width: "100%",
      padding: CARD_PADDING,
      gap: CARD_GAP,
      flexDirection: "column",
      backgroundColor: "#111827",
      borderColor: "#64748b",
      borderWidth: 2,
      borderRadius: 18,
      opacity: 0.94,
      depthTest: false,
      pointerEvents: "none",
    });
    panel.add(
      new Text({
        text: hand.toUpperCase(),
        fontSize: 18,
        fontWeight: 700,
        color: "#94a3b8",
        letterSpacing: 1.2,
        depthTest: false,
        pointerEvents: "none",
      }),
    );

    for (const hint of config.hints) {
      panel.add(this.createHintRow(hint));
    }

    root.add(panel);

    const defaults = DEFAULT_TRANSFORMS[hand];
    const [positionX, positionY, positionZ] =
      config.position ?? defaults.position;
    const [rotationX, rotationY, rotationZ] =
      config.rotation ?? defaults.rotation;
    root.position.set(positionX, positionY, positionZ);
    root.rotation.set(rotationX, rotationY, rotationZ);

    return root;
  }

  private createHintRow(hint: VRControlHint): Container {
    const row = new Container({
      width: "100%",
      flexDirection: "row",
      alignItems: "center",
      gap: 14,
      pointerEvents: "none",
    });
    row.add(
      this.createInputVisual(hint),
      new Text({
        text: hint.action,
        flexGrow: 1,
        fontSize: 23,
        fontWeight: 500,
        color: "#f8fafc",
        depthTest: false,
        pointerEvents: "none",
      }),
    );
    return row;
  }

  private createInputVisual(hint: VRControlHint): Container {
    if (!hint.icon) {
      return new Badge({
        label: hint.input,
        variant: "secondary",
        width: INPUT_VISUAL_WIDTH,
        height: 42,
        fontSize: 17,
        depthTest: false,
        pointerEvents: "none",
      });
    }

    const visual = new Container({
      width: INPUT_VISUAL_WIDTH,
      height: INPUT_VISUAL_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
      pointerEvents: "none",
    });
    visual.add(
      new Svg({
        content: CONTROL_ICON_SVGS[hint.icon],
        width: INPUT_VISUAL_HEIGHT,
        height: INPUT_VISUAL_HEIGHT,
        depthTest: false,
        pointerEvents: "none",
      }),
    );
    return visual;
  }
}
