// In-JS emulation of the "pyuron_gesture" custom Studio RPC subsystem (the
// subsystem ID is part of the wire protocol; do not rename it), so the
// Demo (no-hardware) connection can drive the real gesture-tuning UI —
// including the dynamic per-layer gesture assignment editor — without flashing.
//
// The wire format mirrors src/transport/gestureRpc.ts exactly (encodeRequest /
// decodeResponse). We decode the request payload here and synthesize the
// matching response payload with the same protobufjs/minimal primitive.

import * as _m0 from "protobufjs/minimal";
import { usage } from "../sync/keycodes";
import { BEHAVIOR_IDS } from "./demoData";

export const GESTURE_SUBSYSTEM_ID = "pyuron_gesture";
export const GESTURE_SUBSYSTEM_INDEX = 0;

// --- emulated firmware state ------------------------------------------------

interface GestureInfoState {
  id: number;
  name: string;
  tick: number;
  waitMs: number;
  tapMs: number;
  threshold: number;
  maxThreshold: number;
}

// Trackball gesture instances (the 感度 / tick・wait-ms sliders). Values mirror
// the demo defaults (mirror the reference keyboard firmware values).
const PARAM_DEFAULTS: GestureInfoState[] = [
  { id: 0, name: "keys",    tick: 40,  waitMs: 0,   tapMs: 10, threshold: 4, maxThreshold: 200 },
  { id: 1, name: "3finger", tick: 180, waitMs: 600, tapMs: 10, threshold: 6, maxThreshold: 200 },
  { id: 2, name: "pagenav", tick: 180, waitMs: 600, tapMs: 10, threshold: 6, maxThreshold: 200 },
];

let params: GestureInfoState[] = PARAM_DEFAULTS.map((g) => ({ ...g }));

interface LayerBindingState {
  behaviorId: number;
  param1: number;
  param2: number;
  enabled: boolean;
}

const TRANS: LayerBindingState = {
  behaviorId: BEHAVIOR_IDS.trans,
  param1: 0,
  param2: 0,
  enabled: false,
};

const kpBind = (name: string): LayerBindingState => ({
  behaviorId: BEHAVIOR_IDS.kp,
  param1: usage(name),
  param2: 0,
  enabled: true,
});

// dir: 0=右, 1=左, 2=下, 3=上 (firmware spec)
function seedBindings(): Record<number, LayerBindingState> {
  return { 0: { ...TRANS }, 1: { ...TRANS }, 2: { ...TRANS }, 3: { ...TRANS } };
}

// Pre-configured layers so the dynamic gesture editor shows populated rows.
// Layer 8 (Gesture2) and 9 (Gesture3) match the demo keymap's lt(8)/lt(9) keys.
const layerBindings: Record<number, Record<number, LayerBindingState>> = {
  8: { 0: kpBind("RIGHT"), 1: kpBind("LEFT"), 2: kpBind("DOWN"), 3: kpBind("UP") },
  9: { 0: kpBind("TAB"), 1: { ...TRANS }, 2: kpBind("PG_DN"), 3: kpBind("PG_UP") },
};

let configuredLayers: { layer: number; enabled: boolean }[] = [
  { layer: 8, enabled: true },
  { layer: 9, enabled: true },
];

// Per-(layer,dir) sensitivity state.
// dir: 0=右, 1=左, 2=下, 3=上
interface LayerSensState {
  tick: number;
  waitMs: number;
  threshold: number;
}

// Defaults per direction — dir2(下)に長めのクールダウンを設定しF11連打抑止のデモを兼ねる
function defaultSens(dir: number): LayerSensState {
  if (dir === 2) return { tick: 180, waitMs: 300, threshold: 1 };
  return { tick: 180, waitMs: 0, threshold: 1 };
}

// layerSens[layer][dir] = { tick, waitMs, threshold }
const layerSensDefaults: Record<number, Record<number, LayerSensState>> = {
  8: { 0: defaultSens(0), 1: defaultSens(1), 2: defaultSens(2), 3: defaultSens(3) },
  9: { 0: defaultSens(0), 1: defaultSens(1), 2: defaultSens(2), 3: defaultSens(3) },
};

let layerSens: Record<number, Record<number, LayerSensState>> = {
  8: { 0: { ...layerSensDefaults[8][0] }, 1: { ...layerSensDefaults[8][1] }, 2: { ...layerSensDefaults[8][2] }, 3: { ...layerSensDefaults[8][3] } },
  9: { 0: { ...layerSensDefaults[9][0] }, 1: { ...layerSensDefaults[9][1] }, 2: { ...layerSensDefaults[9][2] }, 3: { ...layerSensDefaults[9][3] } },
};

function getLayerSens(layer: number, dir: number): LayerSensState {
  return layerSens[layer]?.[dir] ?? defaultSens(dir);
}

// --- request decoding -------------------------------------------------------

interface DecodedRequest {
  field: number;
  id?: number;
  param?: number;
  value?: number;
  dir?: number;
  behaviorId?: number;
  param1?: number;
  param2?: number;
  layer?: number;
  index?: number;
  sensParam?: number;
  sensValue?: number;
}

function decodeRequest(bytes: Uint8Array): DecodedRequest {
  const r = _m0.Reader.create(bytes);
  const out: DecodedRequest = { field: 0 };
  if (r.pos >= r.len) return out;
  const tag = r.uint32();
  out.field = tag >>> 3;
  const len = r.uint32();
  const end = r.pos + len;
  while (r.pos < end) {
    const t = r.uint32();
    const f = t >>> 3;
    switch (out.field) {
      case 2: // get { id=1 }
      case 4: // reset { id=1 }
        if (f === 1) out.id = r.uint32();
        else r.skipType(t & 7);
        break;
      case 3: // set_param { id=1, param=2, value=3 }
        if (f === 1) out.id = r.uint32();
        else if (f === 2) out.param = r.int32();
        else if (f === 3) out.value = r.int32();
        else r.skipType(t & 7);
        break;
      case 5: // get_binding { id=1, dir=2 }
        if (f === 1) out.id = r.uint32();
        else if (f === 2) out.dir = r.uint32();
        else r.skipType(t & 7);
        break;
      case 6: // set_binding { id=1, dir=2, behavior_id=3, param1=4, param2=5 }
        if (f === 1) out.id = r.uint32();
        else if (f === 2) out.dir = r.uint32();
        else if (f === 3) out.behaviorId = r.uint32();
        else if (f === 4) out.param1 = r.int32();
        else if (f === 5) out.param2 = r.int32();
        else r.skipType(t & 7);
        break;
      case 7: // get_layer_binding { layer=1, dir=2 }
        if (f === 1) out.layer = r.uint32();
        else if (f === 2) out.dir = r.uint32();
        else r.skipType(t & 7);
        break;
      case 8: // set_layer_binding { layer=1, dir=2, behavior_id=3, param1=4, param2=5 }
        if (f === 1) out.layer = r.uint32();
        else if (f === 2) out.dir = r.uint32();
        else if (f === 3) out.behaviorId = r.uint32();
        else if (f === 4) out.param1 = r.uint32();
        else if (f === 5) out.param2 = r.uint32();
        else r.skipType(t & 7);
        break;
      case 9: // enable_layer { layer=1 }
      case 10: // disable_layer { layer=1 }
        if (f === 1) out.layer = r.uint32();
        else r.skipType(t & 7);
        break;
      case 12: // get_configured_layer { index=1 }
        if (f === 1) out.index = r.uint32();
        else r.skipType(t & 7);
        break;
      case 13: // get_layer_sens { layer=1, dir=2 }
      case 15: // reset_layer_sens { layer=1, dir=2 }
        if (f === 1) out.layer = r.uint32();
        else if (f === 2) out.dir = r.uint32();
        else r.skipType(t & 7);
        break;
      case 14: // set_layer_sens { layer=1, dir=2, param=3, value=4 }
        if (f === 1) out.layer = r.uint32();
        else if (f === 2) out.dir = r.uint32();
        else if (f === 3) out.sensParam = r.int32();
        else if (f === 4) out.sensValue = r.int32();
        else r.skipType(t & 7);
        break;
      default:
        r.skipType(t & 7);
    }
  }
  return out;
}

// --- response encoding ------------------------------------------------------

function encodeGestureInfo(w: _m0.Writer, g: GestureInfoState) {
  w.uint32(8).uint32(g.id);
  w.uint32(18).string(g.name);
  w.uint32(24).uint32(g.tick);
  w.uint32(32).uint32(g.waitMs);
  w.uint32(40).uint32(g.tapMs);
  w.uint32(48).int32(g.threshold);
  w.uint32(56).int32(g.maxThreshold);
}

// Response field 3/4/5: { gesture=1: GestureInfo }
function gestureResponse(responseField: number, g: GestureInfoState): Uint8Array {
  const w = _m0.Writer.create();
  w.uint32((responseField << 3) | 2).fork();
  w.uint32(10).fork(); // gesture field 1 submessage
  encodeGestureInfo(w, g);
  w.ldelim();
  w.ldelim();
  return w.finish();
}

// Response field 8/9: submessage content IS the LayerBindingInfo fields.
function layerBindingResponse(
  responseField: number,
  layer: number,
  dir: number,
  b: LayerBindingState
): Uint8Array {
  const w = _m0.Writer.create();
  w.uint32((responseField << 3) | 2).fork();
  w.uint32(8).uint32(layer);
  w.uint32(16).uint32(dir);
  w.uint32(24).uint32(b.behaviorId);
  w.uint32(32).uint32(b.param1);
  w.uint32(40).uint32(b.param2);
  w.uint32(48).bool(b.enabled);
  w.ldelim();
  return w.finish();
}

// Response field 14/15/16: { sens=1: LayerSensInfo }
// LayerSensInfo: layer=1, dir=2, tick=3, waitMs=4, threshold=5
function layerSensResponse(
  responseField: number,
  layer: number,
  dir: number,
  s: LayerSensState
): Uint8Array {
  const w = _m0.Writer.create();
  w.uint32((responseField << 3) | 2).fork();
  w.uint32(10).fork(); // sens field 1 submessage
  w.uint32(8).uint32(layer);
  w.uint32(16).uint32(dir);
  w.uint32(24).uint32(s.tick);
  w.uint32(32).uint32(s.waitMs);
  w.uint32(40).int32(s.threshold);
  w.ldelim();
  w.ldelim();
  return w.finish();
}

// Response field 10/11/13: { layer=1, enabled=2 }
function layerToggleResponse(
  responseField: number,
  layer: number,
  enabled: boolean
): Uint8Array {
  const w = _m0.Writer.create();
  w.uint32((responseField << 3) | 2).fork();
  w.uint32(8).uint32(layer);
  w.uint32(16).bool(enabled);
  w.ldelim();
  return w.finish();
}

// Response field 2/12: { count=1 }
function countResponse(responseField: number, count: number): Uint8Array {
  const w = _m0.Writer.create();
  w.uint32((responseField << 3) | 2).fork();
  w.uint32(8).uint32(count);
  w.ldelim();
  return w.finish();
}

function getLayerBinding(layer: number, dir: number): LayerBindingState {
  return layerBindings[layer]?.[dir] ?? { ...TRANS };
}

// --- dispatcher -------------------------------------------------------------

export function handleGestureCall(payload: Uint8Array): Uint8Array {
  const req = decodeRequest(payload);
  switch (req.field) {
    case 1: // get_count
      return countResponse(2, params.length);
    case 2: { // get
      const g = params[req.id ?? 0] ?? params[0];
      return gestureResponse(3, g);
    }
    case 3: { // set_param
      const g = params[req.id ?? 0];
      if (g && req.param != null && req.value != null) {
        if (req.param === 0) g.tick = req.value;
        else if (req.param === 1) g.waitMs = req.value;
        else if (req.param === 2) g.tapMs = req.value;
        else if (req.param === 3) g.threshold = req.value;
        else if (req.param === 4) g.maxThreshold = req.value;
      }
      return gestureResponse(4, g ?? params[0]);
    }
    case 4: { // reset
      const id = req.id ?? 0;
      const def = PARAM_DEFAULTS.find((d) => d.id === id);
      if (def) params[id] = { ...def };
      return gestureResponse(5, params[id] ?? params[0]);
    }
    case 7: { // get_layer_binding
      const layer = req.layer ?? 0;
      const dir = req.dir ?? 0;
      return layerBindingResponse(8, layer, dir, getLayerBinding(layer, dir));
    }
    case 8: { // set_layer_binding
      const layer = req.layer ?? 0;
      const dir = req.dir ?? 0;
      const b: LayerBindingState = {
        behaviorId: req.behaviorId ?? 0,
        param1: req.param1 ?? 0,
        param2: req.param2 ?? 0,
        enabled: true,
      };
      (layerBindings[layer] ??= seedBindings())[dir] = b;
      return layerBindingResponse(9, layer, dir, b);
    }
    case 9: { // enable_layer
      const layer = req.layer ?? 0;
      const found = configuredLayers.find((x) => x.layer === layer);
      if (found) found.enabled = true;
      else configuredLayers.push({ layer, enabled: true });
      layerBindings[layer] ??= seedBindings();
      return layerToggleResponse(10, layer, true);
    }
    case 10: { // disable_layer
      const layer = req.layer ?? 0;
      const found = configuredLayers.find((x) => x.layer === layer);
      if (found) found.enabled = false;
      return layerToggleResponse(11, layer, false);
    }
    case 11: // get_layer_count
      return countResponse(12, configuredLayers.length);
    case 12: { // get_configured_layer
      const entry = configuredLayers[req.index ?? 0] ?? { layer: 0, enabled: false };
      return layerToggleResponse(13, entry.layer, entry.enabled);
    }
    case 13: { // get_layer_sens
      const layer = req.layer ?? 0;
      const dir = req.dir ?? 0;
      return layerSensResponse(14, layer, dir, getLayerSens(layer, dir));
    }
    case 14: { // set_layer_sens
      const layer = req.layer ?? 0;
      const dir = req.dir ?? 0;
      const s = { ...getLayerSens(layer, dir) };
      if (req.sensParam === 0) s.tick = req.sensValue ?? s.tick;
      else if (req.sensParam === 1) s.waitMs = req.sensValue ?? s.waitMs;
      else if (req.sensParam === 3) s.threshold = req.sensValue ?? s.threshold;
      (layerSens[layer] ??= {})[dir] = s;
      return layerSensResponse(15, layer, dir, s);
    }
    case 15: { // reset_layer_sens
      const layer = req.layer ?? 0;
      const dir = req.dir ?? 0;
      const def = defaultSens(dir);
      (layerSens[layer] ??= {})[dir] = { ...def };
      return layerSensResponse(16, layer, dir, def);
    }
    default:
      // Unknown request → empty payload (decoder yields "unknown").
      return new Uint8Array(0);
  }
}

// Reset emulated state to defaults (called when a fresh demo connection starts).
export function resetGestureFirmware() {
  params = PARAM_DEFAULTS.map((g) => ({ ...g }));
  configuredLayers = [
    { layer: 8, enabled: true },
    { layer: 9, enabled: true },
  ];
  layerBindings[8] = { 0: kpBind("RIGHT"), 1: kpBind("LEFT"), 2: kpBind("DOWN"), 3: kpBind("UP") };
  layerBindings[9] = { 0: kpBind("TAB"), 1: { ...TRANS }, 2: kpBind("PG_DN"), 3: kpBind("PG_UP") };
  for (const k of Object.keys(layerBindings)) {
    if (k !== "8" && k !== "9") delete layerBindings[Number(k)];
  }
  // Reset per-direction sensitivity
  layerSens = {
    8: { 0: { ...defaultSens(0) }, 1: { ...defaultSens(1) }, 2: { ...defaultSens(2) }, 3: { ...defaultSens(3) } },
    9: { 0: { ...defaultSens(0) }, 1: { ...defaultSens(1) }, 2: { ...defaultSens(2) }, 3: { ...defaultSens(3) } },
  };
}
