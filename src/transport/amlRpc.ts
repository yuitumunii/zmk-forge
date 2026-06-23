// Client for the firmware's "pyuron_aml" custom Studio RPC subsystem.
// Lets the app read and live-change the AutoMouse Layer (AML) behavior
// (deactivation timeout, prior-idle guard, excluded key positions) without
// reflashing. Wire format mirrors proto/pyuron/aml/aml.proto in the ZMK fork.
// Hand-encoded with protobufjs/minimal — same approach as gestureRpc.ts.

import * as _m0 from "protobufjs/minimal";
import { call_rpc, type RpcConnection } from "@zmkfirmware/zmk-studio-ts-client";

export const AML_SUBSYSTEM_ID = "pyuron_aml";

export interface AmlConfig {
  deactivationMs: number;
  priorIdleMs: number;
  excludedPositions: number[];
  extendMs: number;
}

type AmlRequest =
  | { kind: "get" }
  | { kind: "setDeactivation"; ms: number }
  | { kind: "setPriorIdle"; ms: number }
  | { kind: "toggleExcluded"; position: number }
  | { kind: "setExtend"; ms: number }
  | { kind: "reset" };

type AmlResponse =
  | { kind: "config"; config: AmlConfig }
  | { kind: "error"; message: string }
  | { kind: "unknown" };

// ---- wire codec (hand-encoded proto3) ------------------------------------
//
// Request oneof:
//   get             = 1  (empty submessage)
//   set_deactivation= 2  { ms = 1 }
//   set_prior_idle  = 3  { ms = 1 }
//   toggle_excluded = 4  { position = 1 }
//   reset           = 5  (empty submessage)
//
// Response oneof:
//   error  = 1  { message = 1 (string) }
//   config = 2  { deactivation_ms=1, prior_idle_ms=2, excluded_positions=3 (repeated) }

function encodeRequest(req: AmlRequest): Uint8Array {
  const w = _m0.Writer.create();
  switch (req.kind) {
    case "get":
      // field 1, wire type 2 (ldelim), empty body
      w.uint32(0x0a).fork().ldelim();
      break;
    case "setDeactivation":
      // field 2, wire type 2  ← { field 1 = ms }
      w.uint32(0x12).fork();
      w.uint32(0x08).uint32(req.ms);
      w.ldelim();
      break;
    case "setPriorIdle":
      // field 3, wire type 2  ← { field 1 = ms }
      w.uint32(0x1a).fork();
      w.uint32(0x08).uint32(req.ms);
      w.ldelim();
      break;
    case "toggleExcluded":
      // field 4, wire type 2  ← { field 1 = position }
      w.uint32(0x22).fork();
      w.uint32(0x08).uint32(req.position);
      w.ldelim();
      break;
    case "reset":
      // field 5, wire type 2, empty body
      w.uint32(0x2a).fork().ldelim();
      break;
    case "setExtend":
      // field 6, wire type 2  ← { field 1 = ms }
      w.uint32(0x32).fork();
      w.uint32(0x08).uint32(req.ms);
      w.ldelim();
      break;
  }
  return w.finish();
}

function decodeAmlConfig(r: _m0.Reader, length: number): AmlConfig {
  const end = r.pos + length;
  const c: AmlConfig = { deactivationMs: 0, priorIdleMs: 0, excludedPositions: [], extendMs: 0 };
  while (r.pos < end) {
    const tag = r.uint32();
    switch (tag >>> 3) {
      case 1: c.deactivationMs = r.uint32(); break;
      case 2: c.priorIdleMs = r.uint32(); break;
      case 4: c.extendMs = r.uint32(); break;
      case 3: {
        // repeated uint32 — proto3/nanopb は packed(LEN) でエンコードする。
        // 旧実装は packed の長さバイトを位置として誤読し(例: 既定4個→「pos4」表示)、
        // さらに後続バイトをタグ誤読して deactivation/prior_idle も破壊していた。
        if ((tag & 7) === 2) {
          // 注意: `r.pos + r.uint32()` は JS の評価順で pos が読込前に評価され
          // 境界が1バイト短くなる(最終要素を取りこぼし以降が崩れる)。必ず2行に分ける。
          const subLen = r.uint32();
          const subEnd = r.pos + subLen;
          while (r.pos < subEnd) c.excludedPositions.push(r.uint32());
        } else {
          c.excludedPositions.push(r.uint32()); // 非packedにも一応対応
        }
        break;
      }
      default: r.skipType(tag & 7);
    }
  }
  return c;
}

// exported for unit tests (scripts/test-aml-decode.ts)
export function decodeResponse(bytes: Uint8Array): AmlResponse {
  const r = _m0.Reader.create(bytes);
  let result: AmlResponse = { kind: "unknown" };
  while (r.pos < r.len) {
    const tag = r.uint32();
    switch (tag >>> 3) {
      case 1: {
        // error { message = 1 }
        const errLen = r.uint32();
        const end = r.pos + errLen;
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
        // Response.config = ConfigResponse { config = 1 (AmlConfig) }。
        // 旧実装は ConfigResponse の包みを剥がさず AmlConfig として直読みし、
        // 偶然のバイト並びで動いていた。正しく1段アンラップする。
        const crLen = r.uint32();
        const crEnd = r.pos + crLen;
        let cfg: AmlConfig = { deactivationMs: 0, priorIdleMs: 0, excludedPositions: [], extendMs: 0 };
        while (r.pos < crEnd) {
          const t = r.uint32();
          if (t >>> 3 === 1 && (t & 7) === 2) {
            const cLen = r.uint32();
            cfg = decodeAmlConfig(r, cLen);
          } else {
            r.skipType(t & 7);
          }
        }
        result = { kind: "config", config: cfg };
        break;
      }
      default:
        r.skipType(tag & 7);
    }
  }
  return result;
}

// ---- transport -----------------------------------------------------------

async function callAml(
  conn: RpcConnection,
  subsystemIndex: number,
  req: AmlRequest
): Promise<AmlResponse> {
  const payload = encodeRequest(req);
  const resp = await call_rpc(conn, { custom: { call: { subsystemIndex, payload } } });
  const out = resp?.custom?.call?.payload;
  if (!out) throw new Error("aml RPC: empty response from firmware");
  const decoded = decodeResponse(out);
  if (decoded.kind === "error") throw new Error(`aml RPC: firmware error: ${decoded.message}`);
  return decoded;
}

export async function findAmlSubsystemIndex(conn: RpcConnection): Promise<number | null> {
  const resp = await call_rpc(conn, { custom: { listCustomSubsystems: {} } });
  const subs = resp?.custom?.listCustomSubsystems?.subsystems ?? [];
  const found = subs.find((s) => s.identifier === AML_SUBSYSTEM_ID);
  return found ? found.index : null;
}

export interface AmlClient {
  get(): Promise<AmlConfig>;
  setDeactivation(ms: number): Promise<AmlConfig>;
  setPriorIdle(ms: number): Promise<AmlConfig>;
  toggleExcluded(position: number): Promise<AmlConfig>;
  setExtend(ms: number): Promise<AmlConfig>;
  reset(): Promise<AmlConfig>;
}

export async function connectAml(conn: RpcConnection): Promise<AmlClient | null> {
  const index = await findAmlSubsystemIndex(conn);
  if (index === null) return null;
  const subsystemIndex: number = index;

  async function req(r: AmlRequest): Promise<AmlConfig> {
    const resp = await callAml(conn, subsystemIndex, r);
    if (resp.kind !== "config")
      throw new Error("aml RPC: unexpected response kind: " + resp.kind);
    return resp.config;
  }

  return {
    get: () => req({ kind: "get" }),
    setDeactivation: (ms) => req({ kind: "setDeactivation", ms }),
    setPriorIdle: (ms) => req({ kind: "setPriorIdle", ms }),
    toggleExcluded: (position) => req({ kind: "toggleExcluded", position }),
    setExtend: (ms) => req({ kind: "setExtend", ms }),
    reset: () => req({ kind: "reset" }),
  };
}
