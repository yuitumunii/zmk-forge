// Client for the firmware's "pyuron_timing" custom Studio RPC subsystem.
// Lets the app read and live-change each Mod-Tap/Layer-Tap behavior's
// tapping-term / quick-tap / flavor without reflashing.
//
// The wire format mirrors the pyuron/timing/timing.proto definition in the
// companion ZMK firmware fork. We hand-encode it with protobufjs/minimal
// (the same primitive the generated client uses) so no protoc/ts-proto step is
// needed in this app. Each response carries at most one HoldTapInfo, so we
// probe get_count then get(0..n-1) instead of receiving a list.

import * as _m0 from "protobufjs/minimal";
import { call_rpc, type RpcConnection } from "@zmkfirmware/zmk-studio-ts-client";

export const TIMING_SUBSYSTEM_ID = "pyuron_timing";

// Must match enum Param in timing.proto.
export enum TimingParam {
  TappingTermMs = 0,
  QuickTapMs = 1,
  Flavor = 2,
}

export interface HoldTapInfo {
  id: number;
  name: string;
  tappingTermMs: number;
  quickTapMs: number;
  flavor: number;
}

type TimingRequest =
  | { kind: "getCount" }
  | { kind: "get"; id: number }
  | { kind: "setParam"; id: number; param: TimingParam; value: number }
  | { kind: "reset"; id: number };

type TimingResponse =
  | { kind: "count"; count: number }
  | { kind: "info"; info: HoldTapInfo }
  | { kind: "error"; message: string }
  | { kind: "unknown" };

// ---- wire codec ------------------------------------------------------------

function encodeRequest(req: TimingRequest): Uint8Array {
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
      // Emit all three fields unconditionally — param=TappingTermMs(0) and value=0
      // (e.g. quick-tap=0) are legitimate and must not be dropped as proto3
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
  }
  return w.finish();
}

function decodeHoldTapInfo(r: _m0.Reader, length: number): HoldTapInfo {
  const end = r.pos + length;
  const h: HoldTapInfo = {
    id: 0,
    name: "",
    tappingTermMs: 0,
    quickTapMs: 0,
    flavor: 0,
  };
  while (r.pos < end) {
    const tag = r.uint32();
    switch (tag >>> 3) {
      case 1:
        h.id = r.uint32();
        break;
      case 2:
        h.name = r.string();
        break;
      case 3:
        h.tappingTermMs = r.uint32();
        break;
      case 4:
        h.quickTapMs = r.int32();
        break;
      case 5:
        h.flavor = r.uint32();
        break;
      default:
        r.skipType(tag & 7);
    }
  }
  return h;
}

function decodeResponse(bytes: Uint8Array): TimingResponse {
  const r = _m0.Reader.create(bytes);
  let result: TimingResponse = { kind: "unknown" };
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
        // get / set_param / reset { info = 1 }
        const end = r.pos + r.uint32();
        let info: HoldTapInfo | null = null;
        while (r.pos < end) {
          const t = r.uint32();
          if (t >>> 3 === 1) info = decodeHoldTapInfo(r, r.uint32());
          else r.skipType(t & 7);
        }
        if (info) result = { kind: "info", info };
        break;
      }
      default:
        r.skipType(tag & 7);
    }
  }
  return result;
}

// ---- transport -------------------------------------------------------------

async function callTiming(
  conn: RpcConnection,
  subsystemIndex: number,
  req: TimingRequest
): Promise<TimingResponse> {
  const payload = encodeRequest(req);
  const resp = await call_rpc(conn, { custom: { call: { subsystemIndex, payload } } });
  const out = resp?.custom?.call?.payload;
  if (!out) {
    throw new Error("timing RPC: empty response from firmware");
  }
  const decoded = decodeResponse(out);
  if (decoded.kind === "error") {
    throw new Error(`timing RPC: firmware error: ${decoded.message}`);
  }
  return decoded;
}

/** Look up the live subsystem index for "pyuron_timing", or null if the
 *  connected firmware does not expose it (e.g. an older build). */
export async function findTimingSubsystemIndex(
  conn: RpcConnection
): Promise<number | null> {
  const resp = await call_rpc(conn, { custom: { listCustomSubsystems: {} } });
  const subs = resp?.custom?.listCustomSubsystems?.subsystems ?? [];
  const found = subs.find((s) => s.identifier === TIMING_SUBSYSTEM_ID);
  return found ? found.index : null;
}

export interface TimingClient {
  /** Snapshot of every hold-tap behavior instance. */
  list(): Promise<HoldTapInfo[]>;
  /** Live-change one parameter; returns the applied state echoed by firmware. */
  setParam(id: number, param: TimingParam, value: number): Promise<HoldTapInfo>;
  /** Restore one instance to its flashed (devicetree) defaults. */
  reset(id: number): Promise<HoldTapInfo>;
}

/** Resolve the timing subsystem on this connection. Returns null if the
 *  firmware lacks live timing tuning (the UI then shows a "needs firmware"
 *  hint instead of failing). */
export async function connectTiming(
  conn: RpcConnection
): Promise<TimingClient | null> {
  const index = await findTimingSubsystemIndex(conn);
  if (index === null) return null;

  return {
    async list() {
      const c = await callTiming(conn, index, { kind: "getCount" });
      const count = c.kind === "count" ? c.count : 0;
      const out: HoldTapInfo[] = [];
      for (let i = 0; i < count; i++) {
        const g = await callTiming(conn, index, { kind: "get", id: i });
        if (g.kind === "info") out.push(g.info);
      }
      return out;
    },
    async setParam(id, param, value) {
      const r = await callTiming(conn, index, { kind: "setParam", id, param, value });
      if (r.kind !== "info") throw new Error("timing RPC: unexpected set_param response");
      return r.info;
    },
    async reset(id) {
      const r = await callTiming(conn, index, { kind: "reset", id });
      if (r.kind !== "info") throw new Error("timing RPC: unexpected reset response");
      return r.info;
    },
  };
}
