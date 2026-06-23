// Client for the firmware's "pyuron_scroll" custom Studio RPC subsystem.
// Lets the app read and live-change scroll invert flags (vertical / horizontal)
// without reflashing. Built on the same hand-encoded protobufjs/minimal approach
// as cpiRpc.ts / gestureRpc.ts — no protoc/ts-proto step needed.
//
// Wire format:
//   Request (oneof):
//     get   = field1 (tag 10, LEN, empty submessage)
//     set   = field2 (tag 18, LEN)
//       SetScrollRequest: invert_v=field1(tag8,bool/varint), invert_h=field2(tag16,bool/varint)
//   Response (oneof):
//     error = field1 (tag 10, LEN) { message=field1 string }
//     info  = field2 (tag 18, LEN) ScrollInfo
//       ScrollInfo: invert_v=field1(tag8,bool/varint), invert_h=field2(tag16,bool/varint)

import * as _m0 from "protobufjs/minimal";
import { call_rpc, type RpcConnection } from "@zmkfirmware/zmk-studio-ts-client";

export const SCROLL_SUBSYSTEM_ID = "pyuron_scroll";

export interface ScrollInfo {
  invertV: boolean;
  invertH: boolean;
}

type ScrollRequest =
  | { kind: "get" }
  | { kind: "set"; invertV: boolean; invertH: boolean };

type ScrollResponse =
  | { kind: "info"; info: ScrollInfo }
  | { kind: "error"; message: string }
  | { kind: "unknown" };

// ---- wire codec ------------------------------------------------------------

function encodeRequest(req: ScrollRequest): Uint8Array {
  const w = _m0.Writer.create();
  switch (req.kind) {
    case "get":
      // Request.get = field 1 (empty submessage)
      w.uint32(10).fork().ldelim();
      break;
    case "set":
      // Request.set = field 2 (tag 18, LEN)
      // SetScrollRequest: invert_v=field1(tag8,bool/varint), invert_h=field2(tag16,bool/varint)
      // Emit both unconditionally — false(=0) must not be dropped as a proto3 default,
      // or the firmware can't distinguish "set to false" from "unset".
      w.uint32(18).fork();
      w.uint32(8).uint32(req.invertV ? 1 : 0);
      w.uint32(16).uint32(req.invertH ? 1 : 0);
      w.ldelim();
      break;
  }
  return w.finish();
}

function decodeScrollInfo(r: _m0.Reader, length: number): ScrollInfo {
  const end = r.pos + length;
  const info: ScrollInfo = { invertV: false, invertH: false };
  while (r.pos < end) {
    const tag = r.uint32();
    switch (tag >>> 3) {
      case 1: info.invertV = r.uint32() !== 0; break; // field1 tag8 (bool/varint)
      case 2: info.invertH = r.uint32() !== 0; break; // field2 tag16 (bool/varint)
      default: r.skipType(tag & 7);
    }
  }
  return info;
}

function decodeResponse(bytes: Uint8Array): ScrollResponse {
  const r = _m0.Reader.create(bytes);
  let result: ScrollResponse = { kind: "unknown" };
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
        // Response.info = field 2 ScrollInfo
        const info = decodeScrollInfo(r, r.uint32());
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

async function callScroll(
  conn: RpcConnection,
  subsystemIndex: number,
  req: ScrollRequest
): Promise<ScrollResponse> {
  const payload = encodeRequest(req);
  const resp = await call_rpc(conn, { custom: { call: { subsystemIndex, payload } } });
  const out = resp?.custom?.call?.payload;
  if (!out) {
    throw new Error("scroll RPC: empty response from firmware");
  }
  const decoded = decodeResponse(out);
  if (decoded.kind === "error") {
    throw new Error(`scroll RPC: firmware error: ${decoded.message}`);
  }
  return decoded;
}

/** Look up the live subsystem index for "pyuron_scroll", or null if the
 *  connected firmware does not expose it (e.g. an older build). */
export async function findScrollSubsystemIndex(
  conn: RpcConnection
): Promise<number | null> {
  const resp = await call_rpc(conn, { custom: { listCustomSubsystems: {} } });
  const subs = resp?.custom?.listCustomSubsystems?.subsystems ?? [];
  const found = subs.find((s) => s.identifier === SCROLL_SUBSYSTEM_ID);
  return found ? found.index : null;
}

export interface ScrollClient {
  /** Read the current scroll invert state from firmware. */
  get(): Promise<ScrollInfo>;
  /** Live-change scroll invert flags; returns the applied state echoed by firmware. */
  set(invertV: boolean, invertH: boolean): Promise<ScrollInfo>;
}

/** Resolve the scroll subsystem on this connection. Returns null if the
 *  firmware lacks live scroll tuning (the UI then shows a "未対応" hint instead of failing). */
export async function connectScroll(
  conn: RpcConnection
): Promise<ScrollClient | null> {
  const index = await findScrollSubsystemIndex(conn);
  if (index === null) return null;

  return {
    async get() {
      const r = await callScroll(conn, index, { kind: "get" });
      if (r.kind !== "info") throw new Error("scroll RPC: unexpected get response");
      return r.info;
    },
    async set(invertV, invertH) {
      const r = await callScroll(conn, index, { kind: "set", invertV, invertH });
      if (r.kind !== "info") throw new Error("scroll RPC: unexpected set response");
      return r.info;
    },
  };
}
