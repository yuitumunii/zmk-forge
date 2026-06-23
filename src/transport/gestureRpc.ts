// Client for the firmware's "pyuron_gesture" custom Studio RPC subsystem.
// Lets the app read and live-change each zip_keybind trackball gesture's
// tick / wait-ms / threshold etc. without reflashing.
//
// The wire format mirrors proto/pyuron/gesture/gesture.proto in the
// zmk-input-processor-keybind fork. We hand-encode it with protobufjs/minimal
// (the same primitive the generated client uses) so no protoc/ts-proto step is
// needed in this app. Each response carries at most one GestureInfo, so we
// probe get_count then get(0..n-1) instead of receiving a list.

import * as _m0 from "protobufjs/minimal";
import { call_rpc, type RpcConnection } from "@zmkfirmware/zmk-studio-ts-client";

export const GESTURE_SUBSYSTEM_ID = "pyuron_gesture";

// Must match enum Param in gesture.proto / enum zip_keybind_param in the firmware.
export enum GestureParam {
  Tick = 0,
  WaitMs = 1,
  TapMs = 2,
  Threshold = 3,
  MaxThreshold = 4,
}

export interface GestureInfo {
  id: number;
  name: string;
  tick: number;
  waitMs: number;
  tapMs: number;
  threshold: number;
  maxThreshold: number;
}

export interface GestureBinding {
  id: number;
  dir: number;
  behaviorId: number;
  param1: number;
  param2: number;
}

/** LayerBinding: レイヤー別ジェスチャー割当 (動的レイヤー方式) */
export interface LayerBinding {
  layer: number;
  dir: number;
  behaviorId: number;
  param1: number;
  param2: number;
  enabled: boolean;
}

/** LayerSens: レイヤー×方向別の感度 (per-dir-sens) */
export interface LayerSens {
  layer: number;
  dir: number;
  tick: number;
  waitMs: number;
  threshold: number;
}

type GestureRequest =
  | { kind: "getCount" }
  | { kind: "get"; id: number }
  | { kind: "setParam"; id: number; param: GestureParam; value: number }
  | { kind: "reset"; id: number }
  | { kind: "getBinding"; id: number; dir: number }
  | { kind: "setBinding"; id: number; dir: number; behaviorId: number; param1: number; param2: number }
  // Layer-based (dynamic): request field 7..12
  | { kind: "getLayerBinding"; layer: number; dir: number }
  | { kind: "setLayerBinding"; layer: number; dir: number; behaviorId: number; param1: number; param2: number }
  | { kind: "enableLayer"; layer: number }
  | { kind: "disableLayer"; layer: number }
  | { kind: "getLayerCount" }
  | { kind: "getConfiguredLayer"; index: number }
  // Per-direction sensitivity: request field 13..15
  | { kind: "getLayerSens"; layer: number; dir: number }
  | { kind: "setLayerSens"; layer: number; dir: number; param: GestureParam; value: number }
  | { kind: "resetLayerSens"; layer: number; dir: number };

type GestureResponse =
  | { kind: "count"; count: number }
  | { kind: "gesture"; gesture: GestureInfo }
  | { kind: "binding"; binding: GestureBinding }
  | { kind: "layerBinding"; binding: LayerBinding }
  | { kind: "layerToggle"; layer: number; enabled: boolean }
  | { kind: "layerCount"; count: number }
  | { kind: "configuredLayer"; layer: number; enabled: boolean }
  | { kind: "layerSens"; sens: LayerSens }
  | { kind: "error"; message: string }
  | { kind: "unknown" };

// ---- wire codec ------------------------------------------------------------

function encodeRequest(req: GestureRequest): Uint8Array {
  const w = _m0.Writer.create();
  switch (req.kind) {
    case "getCount":
      // Request.get_count = 1 (empty submessage)
      w.uint32(10).fork().ldelim();
      break;
    case "get":
      // Request.get = 2 { id = 1 }
      w.uint32(18).fork();
      if (req.id !== 0) w.uint32(8).uint32(req.id);
      w.ldelim();
      break;
    case "setParam":
      // Request.set_param = 3 { id = 1, param = 2, value = 3 }
      // Emit all three fields unconditionally — param=Tick(0) and value=0
      // (e.g. wait-ms=0) are legitimate and must not be dropped as proto3
      // defaults, or the firmware can't tell "set to 0" from "unset".
      w.uint32(26).fork();
      w.uint32(8).uint32(req.id);
      w.uint32(16).int32(req.param);
      w.uint32(24).int32(req.value);
      w.ldelim();
      break;
    case "reset":
      // Request.reset = 4 { id = 1 }
      w.uint32(34).fork();
      if (req.id !== 0) w.uint32(8).uint32(req.id);
      w.ldelim();
      break;
    case "getBinding":
      // Request.get_binding = 5 { id = 1, dir = 2 }
      // Emit all fields unconditionally (dir=0 is a valid direction).
      w.uint32(42).fork();
      w.uint32(8).uint32(req.id);
      w.uint32(16).uint32(req.dir);
      w.ldelim();
      break;
    case "setBinding":
      // Request.set_binding = 6 { id = 1, dir = 2, behavior_id = 3, param1 = 4, param2 = 5 }
      // Emit all fields unconditionally — behavior_id=0 / param=0 are valid.
      w.uint32(50).fork();
      w.uint32(8).uint32(req.id);
      w.uint32(16).uint32(req.dir);
      w.uint32(24).uint32(req.behaviorId);
      w.uint32(32).int32(req.param1);
      w.uint32(40).int32(req.param2);
      w.ldelim();
      break;

    // ---- Layer-based (dynamic) fields 7..12 ---------------------------------

    case "getLayerBinding":
      // Request.get_layer_binding = 7 { layer = 1, dir = 2 }
      // forkTag = (7 << 3) | 2 = 58
      w.uint32(58).fork();
      w.uint32(8).uint32(req.layer);
      w.uint32(16).uint32(req.dir);
      w.ldelim();
      break;

    case "setLayerBinding":
      // Request.set_layer_binding = 8 { layer = 1, dir = 2, behavior_id = 3, param1 = 4, param2 = 5 }
      // forkTag = (8 << 3) | 2 = 66
      w.uint32(66).fork();
      w.uint32(8).uint32(req.layer);
      w.uint32(16).uint32(req.dir);
      w.uint32(24).uint32(req.behaviorId);
      w.uint32(32).uint32(req.param1);
      w.uint32(40).uint32(req.param2);
      w.ldelim();
      break;

    case "enableLayer":
      // Request.enable_layer = 9 { layer = 1 }
      // forkTag = (9 << 3) | 2 = 74
      w.uint32(74).fork();
      w.uint32(8).uint32(req.layer);
      w.ldelim();
      break;

    case "disableLayer":
      // Request.disable_layer = 10 { layer = 1 }
      // forkTag = (10 << 3) | 2 = 82
      w.uint32(82).fork();
      w.uint32(8).uint32(req.layer);
      w.ldelim();
      break;

    case "getLayerCount":
      // Request.get_layer_count = 11 (empty submessage)
      // forkTag = (11 << 3) | 2 = 90
      w.uint32(90).fork().ldelim();
      break;

    case "getConfiguredLayer":
      // Request.get_configured_layer = 12 { index = 1 }
      // forkTag = (12 << 3) | 2 = 98
      w.uint32(98).fork();
      w.uint32(8).uint32(req.index);
      w.ldelim();
      break;

    // ---- Per-direction sensitivity fields 13..15 ----------------------------

    case "getLayerSens":
      // Request.get_layer_sens = 13 { layer = 1, dir = 2 }
      // forkTag = (13 << 3) | 2 = 106
      w.uint32(106).fork();
      w.uint32(8).uint32(req.layer);
      w.uint32(16).uint32(req.dir);
      w.ldelim();
      break;

    case "setLayerSens":
      // Request.set_layer_sens = 14 { layer = 1, dir = 2, param = 3, value = 4 }
      // forkTag = (14 << 3) | 2 = 114
      // Emit all fields unconditionally (param=Tick(0) and value=0 are valid).
      w.uint32(114).fork();
      w.uint32(8).uint32(req.layer);
      w.uint32(16).uint32(req.dir);
      w.uint32(24).int32(req.param);
      w.uint32(32).int32(req.value);
      w.ldelim();
      break;

    case "resetLayerSens":
      // Request.reset_layer_sens = 15 { layer = 1, dir = 2 }
      // forkTag = (15 << 3) | 2 = 122
      w.uint32(122).fork();
      w.uint32(8).uint32(req.layer);
      w.uint32(16).uint32(req.dir);
      w.ldelim();
      break;
  }
  return w.finish();
}

function decodeGestureInfo(r: _m0.Reader, length: number): GestureInfo {
  const end = r.pos + length;
  const g: GestureInfo = {
    id: 0,
    name: "",
    tick: 0,
    waitMs: 0,
    tapMs: 0,
    threshold: 0,
    maxThreshold: 0,
  };
  while (r.pos < end) {
    const tag = r.uint32();
    switch (tag >>> 3) {
      case 1:
        g.id = r.uint32();
        break;
      case 2:
        g.name = r.string();
        break;
      case 3:
        g.tick = r.uint32();
        break;
      case 4:
        g.waitMs = r.uint32();
        break;
      case 5:
        g.tapMs = r.uint32();
        break;
      case 6:
        g.threshold = r.int32();
        break;
      case 7:
        g.maxThreshold = r.int32();
        break;
      default:
        r.skipType(tag & 7);
    }
  }
  return g;
}

function decodeBindingInfo(r: _m0.Reader, length: number): GestureBinding {
  const end = r.pos + length;
  const b: GestureBinding = {
    id: 0,
    dir: 0,
    behaviorId: 0,
    param1: 0,
    param2: 0,
  };
  while (r.pos < end) {
    const tag = r.uint32();
    switch (tag >>> 3) {
      case 1:
        b.id = r.uint32();
        break;
      case 2:
        b.dir = r.uint32();
        break;
      case 3:
        b.behaviorId = r.uint32();
        break;
      case 4:
        b.param1 = r.int32();
        break;
      case 5:
        b.param2 = r.int32();
        break;
      default:
        r.skipType(tag & 7);
    }
  }
  return b;
}

function decodeLayerBindingInfo(r: _m0.Reader, length: number): LayerBinding {
  const end = r.pos + length;
  const b: LayerBinding = {
    layer: 0,
    dir: 0,
    behaviorId: 0,
    param1: 0,
    param2: 0,
    enabled: false,
  };
  while (r.pos < end) {
    const tag = r.uint32();
    switch (tag >>> 3) {
      case 1: b.layer = r.uint32(); break;
      case 2: b.dir = r.uint32(); break;
      case 3: b.behaviorId = r.uint32(); break;
      case 4: b.param1 = r.uint32(); break;
      case 5: b.param2 = r.uint32(); break;
      case 6: b.enabled = r.bool(); break;
      default: r.skipType(tag & 7);
    }
  }
  return b;
}

function decodeLayerSensInfo(r: _m0.Reader, length: number): LayerSens {
  const end = r.pos + length;
  const s: LayerSens = {
    layer: 0,
    dir: 0,
    tick: 0,
    waitMs: 0,
    threshold: 0,
  };
  while (r.pos < end) {
    const tag = r.uint32();
    switch (tag >>> 3) {
      case 1: s.layer = r.uint32(); break;
      case 2: s.dir = r.uint32(); break;
      case 3: s.tick = r.uint32(); break;
      case 4: s.waitMs = r.uint32(); break;
      case 5: s.threshold = r.int32(); break;
      default: r.skipType(tag & 7);
    }
  }
  return s;
}

function decodeResponse(bytes: Uint8Array): GestureResponse {
  const r = _m0.Reader.create(bytes);
  let result: GestureResponse = { kind: "unknown" };
  while (r.pos < r.len) {
    const tag = r.uint32();
    switch (tag >>> 3) {
      case 1: {
        // error { message = 1 }
        const end = r.pos + r.uint32();
        let message = "";
        while (r.pos < end) {
          const t = r.uint32();
          if (t >>> 3 === 1) message = r.string();
          else r.skipType(t & 7);
        }
        result = { kind: "error", message };
        break;
      }
      case 2: {
        // get_count { count = 1 }
        const end = r.pos + r.uint32();
        let count = 0;
        while (r.pos < end) {
          const t = r.uint32();
          if (t >>> 3 === 1) count = r.uint32();
          else r.skipType(t & 7);
        }
        result = { kind: "count", count };
        break;
      }
      case 3:
      case 4:
      case 5: {
        // get / set_param / reset { gesture = 1 }
        const end = r.pos + r.uint32();
        let gesture: GestureInfo | null = null;
        while (r.pos < end) {
          const t = r.uint32();
          if (t >>> 3 === 1) gesture = decodeGestureInfo(r, r.uint32());
          else r.skipType(t & 7);
        }
        if (gesture) result = { kind: "gesture", gesture };
        break;
      }
      case 6:
      case 7: {
        // get_binding / set_binding { binding = 1 }
        const end = r.pos + r.uint32();
        let binding: GestureBinding | null = null;
        while (r.pos < end) {
          const t = r.uint32();
          if (t >>> 3 === 1) binding = decodeBindingInfo(r, r.uint32());
          else r.skipType(t & 7);
        }
        if (binding) result = { kind: "binding", binding };
        break;
      }

      // ---- Layer-based response tags 8..13 -----------------------------------

      case 8:
      case 9: {
        // get_layer_binding (8) / set_layer_binding (9) { LayerBindingInfo = inner }
        // Response submessage contains the LayerBindingInfo fields directly.
        const end = r.pos + r.uint32();
        const lb = decodeLayerBindingInfo(r, end - r.pos);
        result = { kind: "layerBinding", binding: lb };
        break;
      }
      case 10:
      case 11: {
        // enable_layer (10) / disable_layer (11) { layer = 1, enabled = 2 }
        const end = r.pos + r.uint32();
        let layer = 0;
        let enabled = false;
        while (r.pos < end) {
          const t = r.uint32();
          if (t >>> 3 === 1) layer = r.uint32();
          else if (t >>> 3 === 2) enabled = r.bool();
          else r.skipType(t & 7);
        }
        result = { kind: "layerToggle", layer, enabled };
        break;
      }
      case 12: {
        // get_layer_count { count = 1 }
        const end = r.pos + r.uint32();
        let count = 0;
        while (r.pos < end) {
          const t = r.uint32();
          if (t >>> 3 === 1) count = r.uint32();
          else r.skipType(t & 7);
        }
        result = { kind: "layerCount", count };
        break;
      }
      case 13: {
        // get_configured_layer { layer = 1, enabled = 2 }
        const end = r.pos + r.uint32();
        let layer = 0;
        let enabled = false;
        while (r.pos < end) {
          const t = r.uint32();
          if (t >>> 3 === 1) layer = r.uint32();
          else if (t >>> 3 === 2) enabled = r.bool();
          else r.skipType(t & 7);
        }
        result = { kind: "configuredLayer", layer, enabled };
        break;
      }

      // ---- Per-direction sensitivity response tags 14..16 --------------------

      case 14:
      case 15:
      case 16: {
        // get_layer_sens (14) / set_layer_sens (15) / reset_layer_sens (16)
        // Response submessage contains LayerSensInfo fields (sens=1 submessage).
        const end = r.pos + r.uint32();
        let sens: LayerSens | null = null;
        while (r.pos < end) {
          const t = r.uint32();
          if (t >>> 3 === 1) sens = decodeLayerSensInfo(r, r.uint32());
          else r.skipType(t & 7);
        }
        if (sens) result = { kind: "layerSens", sens };
        break;
      }
      default:
        r.skipType(tag & 7);
    }
  }
  return result;
}

// ---- transport -------------------------------------------------------------

async function callGesture(
  conn: RpcConnection,
  subsystemIndex: number,
  req: GestureRequest
): Promise<GestureResponse> {
  const payload = encodeRequest(req);
  const resp = await call_rpc(conn, { custom: { call: { subsystemIndex, payload } } });
  const out = resp?.custom?.call?.payload;
  if (!out) {
    throw new Error("gesture RPC: empty response from firmware");
  }
  const decoded = decodeResponse(out);
  if (decoded.kind === "error") {
    throw new Error(`gesture RPC: firmware error: ${decoded.message}`);
  }
  return decoded;
}

/** Look up the live subsystem index for "pyuron_gesture", or null if the
 *  connected firmware does not expose it (e.g. an older build). */
export async function findGestureSubsystemIndex(
  conn: RpcConnection
): Promise<number | null> {
  const resp = await call_rpc(conn, { custom: { listCustomSubsystems: {} } });
  const subs = resp?.custom?.listCustomSubsystems?.subsystems ?? [];
  const found = subs.find((s) => s.identifier === GESTURE_SUBSYSTEM_ID);
  return found ? found.index : null;
}

export interface GestureClient {
  /** Snapshot of every zip_keybind gesture instance. */
  list(): Promise<GestureInfo[]>;
  /** Live-change one parameter; returns the applied state echoed by firmware. */
  setParam(id: number, param: GestureParam, value: number): Promise<GestureInfo>;
  /** Restore one instance to its flashed (devicetree) defaults. */
  reset(id: number): Promise<GestureInfo>;
  /** Get the behavior binding for one gesture direction (dir: 0=右,1=左,2=下,3=上). */
  getBinding(id: number, dir: number): Promise<GestureBinding>;
  /** Set the behavior binding for one gesture direction; returns applied state. */
  setBinding(id: number, dir: number, behaviorId: number, param1: number, param2: number): Promise<GestureBinding>;

  // ---- Layer-based (dynamic gesture) API ------------------------------------

  /** Get LayerBinding for one direction in a specific layer. */
  getLayerBinding(layer: number, dir: number): Promise<LayerBinding>;
  /** Set LayerBinding for one direction in a specific layer; returns applied state. */
  setLayerBinding(layer: number, dir: number, behaviorId: number, p1: number, p2: number): Promise<LayerBinding>;
  /** Enable (activate) gesture for a layer; returns new enabled state. */
  enableLayer(layer: number): Promise<{ layer: number; enabled: boolean }>;
  /** Disable (deactivate) gesture for a layer; returns new enabled state. */
  disableLayer(layer: number): Promise<{ layer: number; enabled: boolean }>;
  /** List all configured layers (getLayerCount → getConfiguredLayer × n). */
  listConfiguredLayers(): Promise<{ layer: number; enabled: boolean }[]>;

  // ---- Per-direction sensitivity API ----------------------------------------

  /** Get per-(layer,dir) sensitivity values. */
  getLayerSens(layer: number, dir: number): Promise<LayerSens>;
  /** Set one sensitivity parameter for (layer,dir); returns applied state echoed by firmware. */
  setLayerSens(layer: number, dir: number, param: GestureParam, value: number): Promise<LayerSens>;
  /** Reset (layer,dir) sensitivity to firmware defaults; returns applied state. */
  resetLayerSens(layer: number, dir: number): Promise<LayerSens>;
}

/** Resolve the gesture subsystem on this connection. Returns null if the
 *  firmware lacks live gesture tuning (the UI then shows a "needs firmware"
 *  hint instead of failing). */
export async function connectGestures(
  conn: RpcConnection
): Promise<GestureClient | null> {
  const index = await findGestureSubsystemIndex(conn);
  if (index === null) return null;

  return {
    async list() {
      const c = await callGesture(conn, index, { kind: "getCount" });
      const count = c.kind === "count" ? c.count : 0;
      const out: GestureInfo[] = [];
      for (let i = 0; i < count; i++) {
        const g = await callGesture(conn, index, { kind: "get", id: i });
        if (g.kind === "gesture") out.push(g.gesture);
      }
      return out;
    },
    async setParam(id, param, value) {
      const r = await callGesture(conn, index, { kind: "setParam", id, param, value });
      if (r.kind !== "gesture") throw new Error("gesture RPC: unexpected set_param response");
      return r.gesture;
    },
    async reset(id) {
      const r = await callGesture(conn, index, { kind: "reset", id });
      if (r.kind !== "gesture") throw new Error("gesture RPC: unexpected reset response");
      return r.gesture;
    },
    async getBinding(id, dir) {
      const r = await callGesture(conn, index, { kind: "getBinding", id, dir });
      if (r.kind !== "binding") throw new Error("gesture RPC: unexpected getBinding response");
      return r.binding;
    },
    async setBinding(id, dir, behaviorId, param1, param2) {
      const r = await callGesture(conn, index, { kind: "setBinding", id, dir, behaviorId, param1, param2 });
      if (r.kind !== "binding") throw new Error("gesture RPC: unexpected setBinding response");
      return r.binding;
    },

    // ---- Layer-based (dynamic gesture) methods ------------------------------

    async getLayerBinding(layer, dir) {
      const r = await callGesture(conn, index, { kind: "getLayerBinding", layer, dir });
      if (r.kind !== "layerBinding") throw new Error("gesture RPC: unexpected getLayerBinding response");
      return r.binding;
    },
    async setLayerBinding(layer, dir, behaviorId, p1, p2) {
      const r = await callGesture(conn, index, { kind: "setLayerBinding", layer, dir, behaviorId, param1: p1, param2: p2 });
      if (r.kind !== "layerBinding") throw new Error("gesture RPC: unexpected setLayerBinding response");
      return r.binding;
    },
    async enableLayer(layer) {
      const r = await callGesture(conn, index, { kind: "enableLayer", layer });
      if (r.kind !== "layerToggle") throw new Error("gesture RPC: unexpected enableLayer response");
      return { layer: r.layer, enabled: r.enabled };
    },
    async disableLayer(layer) {
      const r = await callGesture(conn, index, { kind: "disableLayer", layer });
      if (r.kind !== "layerToggle") throw new Error("gesture RPC: unexpected disableLayer response");
      return { layer: r.layer, enabled: r.enabled };
    },
    async listConfiguredLayers() {
      const c = await callGesture(conn, index, { kind: "getLayerCount" });
      const count = c.kind === "layerCount" ? c.count : 0;
      const out: { layer: number; enabled: boolean }[] = [];
      for (let i = 0; i < count; i++) {
        const g = await callGesture(conn, index, { kind: "getConfiguredLayer", index: i });
        if (g.kind === "configuredLayer") out.push({ layer: g.layer, enabled: g.enabled });
      }
      return out;
    },

    // ---- Per-direction sensitivity methods ----------------------------------

    async getLayerSens(layer, dir) {
      const r = await callGesture(conn, index, { kind: "getLayerSens", layer, dir });
      if (r.kind !== "layerSens") throw new Error("gesture RPC: unexpected getLayerSens response");
      return r.sens;
    },
    async setLayerSens(layer, dir, param, value) {
      const r = await callGesture(conn, index, { kind: "setLayerSens", layer, dir, param, value });
      if (r.kind !== "layerSens") throw new Error("gesture RPC: unexpected setLayerSens response");
      return r.sens;
    },
    async resetLayerSens(layer, dir) {
      const r = await callGesture(conn, index, { kind: "resetLayerSens", layer, dir });
      if (r.kind !== "layerSens") throw new Error("gesture RPC: unexpected resetLayerSens response");
      return r.sens;
    },
  };
}
