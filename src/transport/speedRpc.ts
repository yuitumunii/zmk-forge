// Client for the firmware's "pyuron_speed" custom Studio RPC subsystem.
// Lets the app read and live-change the trackball cursor speed multiplier
// (percent, 100 = x1.0) without reflashing. Same hand-encoded protobufjs/minimal
// approach as scrollRpc.ts / cpiRpc.ts.
//
// Wire format:
//   Request (oneof):
//     get = field1 (tag 10, LEN, empty submessage)
//     set = field2 (tag 18, LEN) { percent=field1(tag8, uint32) }
//   Response (oneof):
//     error = field1 (tag 10, LEN) { message=field1 string }
//     info  = field2 (tag 18, LEN) SpeedInfo { percent=field1(tag8, uint32) }

import * as _m0 from "protobufjs/minimal";
import { call_rpc, type RpcConnection } from "@zmkfirmware/zmk-studio-ts-client";

export const SPEED_SUBSYSTEM_ID = "pyuron_speed";

export interface SpeedInfo {
  percent: number;
}

type SpeedRequest = { kind: "get" } | { kind: "set"; percent: number };

type SpeedResponse =
  | { kind: "info"; info: SpeedInfo }
  | { kind: "error"; message: string }
  | { kind: "unknown" };

// ---- wire codec ------------------------------------------------------------

function encodeRequest(req: SpeedRequest): Uint8Array {
  const w = _m0.Writer.create();
  switch (req.kind) {
    case "get":
      w.uint32(10).fork().ldelim();
      break;
    case "set":
      // Request.set = field 2 { percent = field1 }
      w.uint32(18).fork();
      w.uint32(8).uint32(req.percent);
      w.ldelim();
      break;
  }
  return w.finish();
}

function decodeSpeedInfo(r: _m0.Reader, length: number): SpeedInfo {
  const end = r.pos + length;
  const info: SpeedInfo = { percent: 100 };
  while (r.pos < end) {
    const tag = r.uint32();
    switch (tag >>> 3) {
      case 1: info.percent = r.uint32(); break;
      default: r.skipType(tag & 7);
    }
  }
  return info;
}

function decodeResponse(bytes: Uint8Array): SpeedResponse {
  const r = _m0.Reader.create(bytes);
  let result: SpeedResponse = { kind: "unknown" };
  while (r.pos < r.len) {
    const tag = r.uint32();
    switch (tag >>> 3) {
      case 1: {
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
        const info = decodeSpeedInfo(r, r.uint32());
        result = { kind: "info", info };
        break;
      }
      default:
        r.skipType(tag & 7);
    }
  }
  return result;
}

// ---- transport -------------------------------------------------------------

async function callSpeed(
  conn: RpcConnection,
  subsystemIndex: number,
  req: SpeedRequest
): Promise<SpeedResponse> {
  const payload = encodeRequest(req);
  const resp = await call_rpc(conn, { custom: { call: { subsystemIndex, payload } } });
  const out = resp?.custom?.call?.payload;
  if (!out) {
    throw new Error("speed RPC: empty response from firmware");
  }
  const decoded = decodeResponse(out);
  if (decoded.kind === "error") {
    throw new Error(`speed RPC: firmware error: ${decoded.message}`);
  }
  return decoded;
}

/** Live subsystem index for "pyuron_speed", or null if the firmware lacks it. */
export async function findSpeedSubsystemIndex(
  conn: RpcConnection
): Promise<number | null> {
  const resp = await call_rpc(conn, { custom: { listCustomSubsystems: {} } });
  const subs = resp?.custom?.listCustomSubsystems?.subsystems ?? [];
  const found = subs.find((s) => s.identifier === SPEED_SUBSYSTEM_ID);
  return found ? found.index : null;
}

export interface SpeedClient {
  /** Read the current cursor speed multiplier (percent) from firmware. */
  get(): Promise<SpeedInfo>;
  /** Live-change the multiplier; returns the applied state echoed by firmware. */
  set(percent: number): Promise<SpeedInfo>;
}

export async function connectSpeed(
  conn: RpcConnection
): Promise<SpeedClient | null> {
  const index = await findSpeedSubsystemIndex(conn);
  if (index === null) return null;

  return {
    async get() {
      const r = await callSpeed(conn, index, { kind: "get" });
      if (r.kind !== "info") throw new Error("speed RPC: unexpected get response");
      return r.info;
    },
    async set(percent) {
      const r = await callSpeed(conn, index, { kind: "set", percent });
      if (r.kind !== "info") throw new Error("speed RPC: unexpected set response");
      return r.info;
    },
  };
}
