// Client for the firmware's "pyuron_cpi" custom Studio RPC subsystem.
// Lets the app read and live-change each pmw3610 trackball sensor's CPI/DPI
// without reflashing. Built on the same hand-encoded protobufjs/minimal
// approach as gestureRpc.ts — no protoc/ts-proto step needed.
//
// Wire format mirrors the pyuron/cpi/cpi.proto definition in the companion ZMK firmware.
// Each response carries at most one CpiInfo; the app probes get_count then
// get(0..n-1) to build the list.
//
// Note: on a split keyboard, the Studio RPC reaches the central (right) half
// only. Live CPI change therefore affects trackball_R. Left trackball requires
// split sensor-attr forwarding, which is a separate future task.

import * as _m0 from "protobufjs/minimal";
import { call_rpc, type RpcConnection } from "@zmkfirmware/zmk-studio-ts-client";

export const CPI_SUBSYSTEM_ID = "pyuron_cpi";

export interface CpiInfo {
  id: number;
  name: string;
  cpi: number;
  defaultCpi: number;
  min: number;
  max: number;
  step: number;
  invertX: boolean;
  invertY: boolean;
}

type CpiRequest =
  | { kind: "getCount" }
  | { kind: "get"; id: number }
  | { kind: "set"; id: number; cpi: number }
  | { kind: "reset"; id: number }
  | { kind: "setInvert"; id: number; invertX: boolean; invertY: boolean };

type CpiResponse =
  | { kind: "count"; count: number }
  | { kind: "cpi"; info: CpiInfo }
  | { kind: "error"; message: string }
  | { kind: "unknown" };

// Proto field tags for Request oneof:
//   set_invert = field5 (tag 42, LEN)
//   SetInvertRequest: id=field1(tag8,uint32), invert_x=field2(tag16,bool), invert_y=field3(tag24,bool)

// ---- wire codec ------------------------------------------------------------
// Proto field tags for Request oneof (proto field number << 3 | wire type):
//   get_count = field1 (tag 10, LEN), get = field2 (tag 18, LEN)
//   set       = field3 (tag 26, LEN), reset = field4 (tag 34, LEN)

function encodeRequest(req: CpiRequest): Uint8Array {
  const w = _m0.Writer.create();
  switch (req.kind) {
    case "getCount":
      // Request.get_count = field 1 (empty submessage)
      w.uint32(10).fork().ldelim();
      break;
    case "get":
      // Request.get = field 2 { id = field1 uint32 }
      w.uint32(18).fork();
      if (req.id !== 0) w.uint32(8).uint32(req.id);
      w.ldelim();
      break;
    case "set":
      // Request.set = field 3 { id = field1 uint32, cpi = field2 uint32 }
      // Emit both unconditionally — id=0 is valid (first sensor).
      w.uint32(26).fork();
      w.uint32(8).uint32(req.id);
      w.uint32(16).uint32(req.cpi);
      w.ldelim();
      break;
    case "reset":
      // Request.reset = field 4 { id = field1 uint32 }
      w.uint32(34).fork();
      if (req.id !== 0) w.uint32(8).uint32(req.id);
      w.ldelim();
      break;
    case "setInvert":
      // Request.set_invert = field 5 (tag 42, LEN)
      // SetInvertRequest: id=field1(tag8,uint32), invert_x=field2(tag16,bool/varint), invert_y=field3(tag24,bool/varint)
      // Emit all fields unconditionally — id=0 is valid and bools must not be dropped as proto3 defaults.
      w.uint32(42).fork();
      w.uint32(8).uint32(req.id);
      w.uint32(16).uint32(req.invertX ? 1 : 0);
      w.uint32(24).uint32(req.invertY ? 1 : 0);
      w.ldelim();
      break;
  }
  return w.finish();
}

function decodeCpiInfo(r: _m0.Reader, length: number): CpiInfo {
  const end = r.pos + length;
  const info: CpiInfo = {
    id: 0,
    name: "",
    cpi: 0,
    defaultCpi: 0,
    min: 200,
    max: 3200,
    step: 200,
    invertX: false,
    invertY: false,
  };
  while (r.pos < end) {
    const tag = r.uint32();
    switch (tag >>> 3) {
      case 1: info.id = r.uint32(); break;         // field1 tag8
      case 2: info.name = r.string(); break;        // field2 tag18
      case 3: info.cpi = r.uint32(); break;         // field3 tag24
      case 4: info.defaultCpi = r.uint32(); break;  // field4 tag32
      case 5: info.min = r.uint32(); break;         // field5 tag40
      case 6: info.max = r.uint32(); break;         // field6 tag48
      case 7: info.step = r.uint32(); break;         // field7 tag56
      case 8: info.invertX = r.uint32() !== 0; break; // field8 tag64 (bool/varint)
      case 9: info.invertY = r.uint32() !== 0; break; // field9 tag72 (bool/varint)
      default: r.skipType(tag & 7);
    }
  }
  return info;
}

function decodeResponse(bytes: Uint8Array): CpiResponse {
  const r = _m0.Reader.create(bytes);
  let result: CpiResponse = { kind: "unknown" };
  while (r.pos < r.len) {
    const tag = r.uint32();
    switch (tag >>> 3) {
      case 1: {
        // Response.error = field 1 { message = field1 }
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
        // Response.get_count = field 2 { count = field1 }
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
      case 5:
      case 6: {
        // Response.get / set / reset / set_invert — each wraps { info = field1 CpiInfo }
        const end = r.pos + r.uint32();
        let info: CpiInfo | null = null;
        while (r.pos < end) {
          const t = r.uint32();
          if (t >>> 3 === 1) info = decodeCpiInfo(r, r.uint32());
          else r.skipType(t & 7);
        }
        if (info) result = { kind: "cpi", info };
        break;
      }
      default:
        r.skipType(tag & 7);
    }
  }
  return result;
}

// ---- transport -------------------------------------------------------------

async function callCpi(
  conn: RpcConnection,
  subsystemIndex: number,
  req: CpiRequest
): Promise<CpiResponse> {
  const payload = encodeRequest(req);
  const resp = await call_rpc(conn, { custom: { call: { subsystemIndex, payload } } });
  const out = resp?.custom?.call?.payload;
  if (!out) {
    throw new Error("cpi RPC: empty response from firmware");
  }
  const decoded = decodeResponse(out);
  if (decoded.kind === "error") {
    throw new Error(`cpi RPC: firmware error: ${decoded.message}`);
  }
  return decoded;
}

/** Look up the live subsystem index for "pyuron_cpi", or null if the
 *  connected firmware does not expose it (e.g. an older build). */
export async function findCpiSubsystemIndex(
  conn: RpcConnection
): Promise<number | null> {
  const resp = await call_rpc(conn, { custom: { listCustomSubsystems: {} } });
  const subs = resp?.custom?.listCustomSubsystems?.subsystems ?? [];
  const found = subs.find((s) => s.identifier === CPI_SUBSYSTEM_ID);
  return found ? found.index : null;
}

export interface CpiClient {
  /** Snapshot of every local pmw3610 sensor's CPI state. */
  list(): Promise<CpiInfo[]>;
  /** Live-change one sensor's CPI; returns the applied state echoed by firmware. */
  set(id: number, cpi: number): Promise<CpiInfo>;
  /** Restore one sensor's CPI to its flashed (devicetree) default. */
  reset(id: number): Promise<CpiInfo>;
  /** Live-change one sensor's cursor invert flags; returns the applied state echoed by firmware. */
  setInvert(id: number, invertX: boolean, invertY: boolean): Promise<CpiInfo>;
}

/** Resolve the CPI subsystem on this connection. Returns null if the
 *  firmware lacks live CPI tuning (the UI then shows a "needs firmware"
 *  hint instead of failing). */
export async function connectCpi(
  conn: RpcConnection
): Promise<CpiClient | null> {
  const index = await findCpiSubsystemIndex(conn);
  if (index === null) return null;

  return {
    async list() {
      const c = await callCpi(conn, index, { kind: "getCount" });
      const count = c.kind === "count" ? c.count : 0;
      const out: CpiInfo[] = [];
      for (let i = 0; i < count; i++) {
        const g = await callCpi(conn, index, { kind: "get", id: i });
        if (g.kind === "cpi") out.push(g.info);
      }
      return out;
    },
    async set(id, cpi) {
      const r = await callCpi(conn, index, { kind: "set", id, cpi });
      if (r.kind !== "cpi") throw new Error("cpi RPC: unexpected set response");
      return r.info;
    },
    async reset(id) {
      const r = await callCpi(conn, index, { kind: "reset", id });
      if (r.kind !== "cpi") throw new Error("cpi RPC: unexpected reset response");
      return r.info;
    },
    async setInvert(id, invertX, invertY) {
      const r = await callCpi(conn, index, { kind: "setInvert", id, invertX, invertY });
      if (r.kind !== "cpi") throw new Error("cpi RPC: unexpected set_invert response");
      return r.info;
    },
  };
}
