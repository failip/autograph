import {
  Container,
  Text,
  reversePainterSortStable,
  type ColorRepresentation,
} from "@pmndrs/uikit";
import { Panel } from "@pmndrs/uikit-horizon";
import type { Object3D, WebGLRenderer } from "three";

type TransformTuple = readonly [x: number, y: number, z: number];
type ControllerHand = "left" | "right";

export type VRControlHint = {
  input: string;
  action: string;
  accentColor?: ColorRepresentation;
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
const CARD_GAP = 9;
const BADGE_WIDTH = 94;
const DEFAULT_ACCENT_COLOR = "#475569";

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
      gap: 10,
      pointerEvents: "none",
    });
    const badge = new Container({
      width: BADGE_WIDTH,
      paddingTop: 6,
      paddingBottom: 6,
      paddingLeft: 8,
      paddingRight: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: hint.accentColor ?? DEFAULT_ACCENT_COLOR,
      borderRadius: 10,
      depthTest: false,
      pointerEvents: "none",
    });
    badge.add(
      new Text({
        text: hint.input,
        fontSize: 20,
        fontWeight: 700,
        color: "#ffffff",
        textAlign: "center",
        depthTest: false,
        pointerEvents: "none",
      }),
    );
    row.add(
      badge,
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
}
