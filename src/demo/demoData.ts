// Demo data so the editor renders fully WITHOUT a physical keyboard.
// 40 keys, 4 matrix rows, 10 layers — a representative split keyboard layout.
// Key index order is row-major (col-major within each row).
// Fed to the editor via the mock RPC connection.

import type {
  Keymap,
  Layer,
  BehaviorBinding,
  PhysicalLayouts,
} from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import type { GetDeviceInfoResponse } from "@zmkfirmware/zmk-studio-ts-client/core";

import { usage } from "../sync/keycodes";

export const BEHAVIOR_IDS = {
  kp: 0,
  mt: 1,
  lt: 2,
  mo: 3,
  trans: 4,
  mkp: 5,
  tog: 6,
} as const;

const hidUsageParam = (name: string) => ({
  name,
  hidUsage: { keyboardMax: 0xff, consumerMax: 0xfff },
});
const layerParam = (name: string) => ({ name, layerId: {} });

export const DEMO_BEHAVIORS: GetBehaviorDetailsResponse[] = [
  {
    id: BEHAVIOR_IDS.kp,
    displayName: "Key Press",
    metadata: [{ param1: [hidUsageParam("Key")], param2: [] }],
  },
  {
    id: BEHAVIOR_IDS.mt,
    displayName: "Mod-Tap",
    metadata: [
      { param1: [hidUsageParam("Mod")], param2: [hidUsageParam("Tap")] },
    ],
  },
  {
    id: BEHAVIOR_IDS.lt,
    displayName: "Layer-Tap",
    metadata: [
      { param1: [layerParam("Layer")], param2: [hidUsageParam("Tap")] },
    ],
  },
  {
    id: BEHAVIOR_IDS.mo,
    displayName: "Momentary Layer",
    metadata: [{ param1: [layerParam("Layer")], param2: [] }],
  },
  {
    id: BEHAVIOR_IDS.trans,
    displayName: "Transparent",
    metadata: [{ param1: [], param2: [] }],
  },
  {
    id: BEHAVIOR_IDS.mkp,
    displayName: "Mouse Button Press",
    metadata: [{ param1: [{ name: "Button", range: { min: 1, max: 16 } }], param2: [] }],
  },
  {
    id: BEHAVIOR_IDS.tog,
    displayName: "Toggle Layer",
    metadata: [{ param1: [layerParam("Layer")], param2: [] }],
  },
];

// --- binding helpers --------------------------------------------------------
const kp = (name: string): BehaviorBinding => ({
  behaviorId: BEHAVIOR_IDS.kp,
  param1: usage(name),
  param2: 0,
});
const mt = (mod: string, key: string): BehaviorBinding => ({
  behaviorId: BEHAVIOR_IDS.mt,
  param1: usage(mod),
  param2: usage(key),
});
const lt = (layer: number, key: string): BehaviorBinding => ({
  behaviorId: BEHAVIOR_IDS.lt,
  param1: layer,
  param2: usage(key),
});
const mo = (layer: number): BehaviorBinding => ({
  behaviorId: BEHAVIOR_IDS.mo,
  param1: layer,
  param2: 0,
});
const trans = (): BehaviorBinding => ({
  behaviorId: BEHAVIOR_IDS.trans,
  param1: 0,
  param2: 0,
});
const mkp = (btn: number): BehaviorBinding => ({
  behaviorId: BEHAVIOR_IDS.mkp,
  param1: btn,
  param2: 0,
});
const transRow = (n: number) => Array.from({ length: n }, trans);

// --- layers -----------------------------------------------------------------
// 40 bindings per layer. Index order (split keyboard, row-major):
//   Row 0 (indices  0- 9): L cols 0-4 (x=0-4,y=0)   + R cols 5-9 (x=8-12,y=0)
//   Row 1 (indices 10-19): L cols 0-4 (x=0-4,y=1)   + R cols 5-9 (x=8-12,y=1)
//   Row 2 (indices 20-29): L cols 0-5 (x=0-5,y=2)   + R cols 6-9 (x=7-10,y=2)
//   Row 3 (indices 30-39): ext cols 0-1 (x=11-12,y=2)
//                          + thumb cols 2-9 (y=3)

// Layer 0 — default_layer
const defaultBindings: BehaviorBinding[] = [
  // Row 0
  mt("ESC","Q"), kp("W"), kp("E"), kp("R"), kp("T"),
  kp("Y"), kp("U"), kp("I"), lt(9,"O"), lt(8,"P"),
  // Row 1
  mt("LCTRL","A"), kp("S"), kp("D"), kp("F"), kp("G"),
  kp("H"), kp("J"), kp("K"), kp("L"), lt(7,"MINUS"),
  // Row 2 — 6 left + 4 right
  mt("LSHFT","Z"), kp("X"), kp("C"), kp("V"), kp("B"), lt(2,"TAB"),
  lt(2,"B"), kp("N"), kp("M"), kp("COMMA"),
  // Row 3 — ext(2) + thumb(8)
  kp("DOT"), lt(1,"RET"),
  mt("LSHFT","TAB"), kp("LALT"), mt("LGUI","SPACE"),
  lt(1,"SPACE"), lt(3,"SPACE"), lt(4,"BSPC"),
  kp("RGUI"), lt(5,"ESC"),
];

// Layer 1 — symbols / screenshot shortcuts
const layer1Bindings: BehaviorBinding[] = [
  // Row 0: ` 1 2 3 4 | ( ) \ + =
  kp("GRAVE"), kp("N1"), kp("N2"), kp("N3"), kp("N4"),
  kp("N9"), kp("N0"), kp("BSLH"), kp("MINUS"), kp("EQUAL"),
  // Row 1: Tab 5 6 7 8 | ; ' [ ] `
  kp("TAB"), kp("N5"), kp("N6"), kp("N7"), kp("N8"),
  kp("SEMI"), kp("SQT"), kp("LBKT"), kp("RBKT"), kp("GRAVE"),
  // Row 2: _ screenshot shortcuts | _ _ < > /
  trans(), kp("N3"), kp("N4"), kp("N5"), kp("N4"), trans(),
  trans(), kp("COMMA"), kp("DOT"), kp("FSLH"),
  // Row 3
  kp("FSLH"), trans(),
  trans(), trans(), trans(),
  trans(), trans(), trans(),
  trans(), kp("BSPC"),
];

// Layer 2 — numpad + media
const layer2Bindings: BehaviorBinding[] = [
  // Row 0: _ _ _ _ _ | 1 2 3 / =
  trans(), trans(), trans(), trans(), trans(),
  kp("N1"), kp("N2"), kp("N3"), kp("FSLH"), kp("EQUAL"),
  // Row 1: _ prev play next _ | 4 5 6 _ _
  trans(), kp("C_PREV"), kp("C_PLAY_PAUSE"), kp("C_NEXT"), trans(),
  kp("N4"), kp("N5"), kp("N6"), trans(), trans(),
  // Row 2: _ _ _ _ _ _ | _ 7 8 9
  trans(), trans(), trans(), trans(), trans(), trans(),
  trans(), kp("N7"), kp("N8"), kp("N9"),
  // Row 3: - _ | _ _ _ | . 0 + _
  kp("MINUS"), trans(),
  trans(), trans(), trans(),
  trans(), kp("DOT"), kp("N0"),
  kp("EQUAL"), trans(),
];

// Layer 3 — browser / media shortcuts
const layer3Bindings: BehaviorBinding[] = [
  // Row 0: _ _ _ _ _ | _ W R T Y (LG wrapped)
  trans(), trans(), trans(), trans(), trans(),
  trans(), kp("W"), kp("R"), kp("T"), kp("Y"),
  // Row 1: _ _ _ _ _ | prev C V _ vol+
  trans(), trans(), trans(), trans(), trans(),
  kp("C_PREV"), kp("C"), kp("V"), trans(), kp("C_VOL_UP"),
  // Row 2: _ _ _ _ _ _ | _ next N T
  trans(), trans(), trans(), trans(), trans(), trans(),
  trans(), kp("C_NEXT"), kp("N"), kp("T"),
  // Row 3: _ vol- | _ _ _ | _ _ play | Q bspc
  trans(), kp("C_VOL_DN"),
  trans(), trans(), trans(),
  trans(), trans(), kp("C_PLAY_PAUSE"),
  kp("Q"), kp("BSPC"),
];

// Layer 4 — navigation / numrow
const layer4Bindings: BehaviorBinding[] = [
  // Row 0: _ / 1 2 3 | up left up right space
  trans(), kp("FSLH"), kp("N1"), kp("N2"), kp("N3"),
  kp("UP"), kp("LEFT"), kp("UP"), kp("RIGHT"), kp("SPACE"),
  // Row 1: _ _ 4 5 6 | left left down right right
  trans(), trans(), kp("N4"), kp("N5"), kp("N6"),
  kp("LEFT"), kp("LEFT"), kp("DOWN"), kp("RIGHT"), kp("RIGHT"),
  // Row 2: lshft - 7 8 9 0 | mute left left up
  kp("LSHFT"), kp("MINUS"), kp("N7"), kp("N8"), kp("N9"), kp("N0"),
  kp("C_MUTE"), kp("LEFT"), kp("LEFT"), kp("UP"),
  // Row 3: right right | = = _ | lalt bspc _ | down bspc
  kp("RIGHT"), kp("RIGHT"),
  kp("EQUAL"), kp("EQUAL"), trans(),
  kp("LALT"), kp("BSPC"), trans(),
  kp("DOWN"), kp("BSPC"),
];

// Layer 5 — BT / system (most bindings are macros/BT, shown as trans)
const layer5Bindings: BehaviorBinding[] = [
  ...transRow(10), // Row 0 (BT_SEL 0-4)
  ...transRow(10), // Row 1 (sys_reset, BT_CLR)
  ...transRow(10), // Row 2
  // Row 3: pw_apple pw_plus _ _ _ _ _ LG(LC(Q)) pw_mac _
  trans(), trans(),
  trans(), trans(), trans(),
  trans(), kp("Q"), trans(),
  trans(), trans(),
];

// Layer 6 — MOUSE
const layer6Bindings: BehaviorBinding[] = [
  // Row 0: _ _ _ _ _ | _ _ _ MB3 _
  trans(), trans(), trans(), trans(), trans(),
  trans(), trans(), trans(), mkp(3), trans(),
  // Row 1: _ _ _ _ _ | _ _ MB1 MB2 mo(7)
  trans(), trans(), trans(), trans(), trans(),
  trans(), trans(), mkp(1), mkp(2), mo(7),
  // Row 2: all trans
  ...transRow(10),
  // Row 3: _ _ | lshft lalt lgui | _ _ _ | rgui ralt
  trans(), trans(),
  kp("LSHFT"), kp("LALT"), kp("LGUI"),
  trans(), trans(), trans(),
  kp("RGUI"), kp("RALT"),
];

// Layer 7 — SCROLL
const layer7Bindings: BehaviorBinding[] = [
  // Row 0: _ _ _ _ _ | _ _ _ lctrl _
  trans(), trans(), trans(), trans(), trans(),
  trans(), trans(), trans(), kp("LCTRL"), trans(),
  // Row 1: _ _ _ _ _ | _ _ _ lgui _
  trans(), trans(), trans(), trans(), trans(),
  trans(), trans(), trans(), kp("LGUI"), trans(),
  // Row 2: all trans
  ...transRow(10),
  // Row 3: _ _ | _ _ _ | _ tab _ | _ _
  trans(), trans(),
  trans(), trans(), trans(),
  trans(), kp("TAB"), trans(),
  trans(), trans(),
];

// Layers 8 (GEST2) and 9 (GEST3) — all transparent
const gest2Bindings: BehaviorBinding[] = transRow(40);
const gest3Bindings: BehaviorBinding[] = transRow(40);

const layers: Layer[] = [
  { id: 0, name: "Default",   bindings: defaultBindings },
  { id: 1, name: "Symbols",   bindings: layer1Bindings  },
  { id: 2, name: "Numpad",    bindings: layer2Bindings  },
  { id: 3, name: "Browser",   bindings: layer3Bindings  },
  { id: 4, name: "Nav",       bindings: layer4Bindings  },
  { id: 5, name: "System",    bindings: layer5Bindings  },
  { id: 6, name: "Mouse",     bindings: layer6Bindings  },
  { id: 7, name: "Scroll",    bindings: layer7Bindings  },
  { id: 8, name: "Gesture2",  bindings: gest2Bindings   },
  { id: 9, name: "Gesture3",  bindings: gest3Bindings   },
];

export function buildDemoKeymap(): Keymap {
  return {
    layers: layers.map((l) => ({
      ...l,
      bindings: l.bindings.map((b) => ({ ...b })),
    })),
    availableLayers: 10,
    maxLayerNameLength: 16,
  };
}

// --- physical layout --------------------------------------------------------
// Demo split keyboard layout. Units are 1/100 of a key (editor divides by 100).
//
// Visual shape:
//   Row 0 (y=0):  [0][1][2][3][4]              [8][9][10][11][12]   5+5
//   Row 1 (y=1):  [0][1][2][3][4]              [8][9][10][11][12]   5+5
//   Row 2 (y=2):  [0][1][2][3][4][5]   [7][8][9][10]               6+4
//   Row 2 ext:                                        [11][12]       +2 (right outer)
//   Row 3 (y=3):  [0][1]   [4][5]   [7][8]   [11][12]              2+2+2+2 thumbs
function pos(x: number, y: number) {
  return { width: 100, height: 100, x: x * 100, y: y * 100, r: 0, rx: 0, ry: 0 };
}

const layoutKeys = [
  // Row 0: L(x=0-4) + R(x=8-12)
  pos(0,0), pos(1,0), pos(2,0), pos(3,0), pos(4,0),
  pos(8,0), pos(9,0), pos(10,0), pos(11,0), pos(12,0),
  // Row 1: L(x=0-4) + R(x=8-12)
  pos(0,1), pos(1,1), pos(2,1), pos(3,1), pos(4,1),
  pos(8,1), pos(9,1), pos(10,1), pos(11,1), pos(12,1),
  // Row 2: L(x=0-5, 6 keys) + R(x=7-10, 4 keys)
  pos(0,2), pos(1,2), pos(2,2), pos(3,2), pos(4,2), pos(5,2),
  pos(7,2), pos(8,2), pos(9,2), pos(10,2),
  // Row 3, col 0-1: right outer extension (x=11-12, y=2)
  pos(11,2), pos(12,2),
  // Row 3, col 2-3: left thumbs (x=0-1, y=3)
  pos(0,3.3), pos(1,3.3),
  // Row 3, col 4-5: inner-left thumbs (x=4-5, y=3)
  pos(4,3.3), pos(5,3.3),
  // Row 3, col 6-7: inner-right thumbs (x=7-8, y=3)
  pos(7,3.3), pos(8,3.3),
  // Row 3, col 8-9: right thumbs (x=11-12, y=3)
  pos(11,3.3), pos(12,3.3),
];

export const DEMO_LAYOUTS: PhysicalLayouts = {
  activeLayoutIndex: 0,
  layouts: [{ name: "Demo Keyboard", keys: layoutKeys }],
};

export const DEMO_DEVICE_INFO: GetDeviceInfoResponse = {
  name: "Demo Keyboard",
  serialNumber: new Uint8Array([0xde, 0x60, 0x00, 0x01]),
};
