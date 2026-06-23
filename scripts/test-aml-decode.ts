// AML RPC デコーダの回帰テスト。
// nanopb(proto3)がファーム側で生成する実バイト列を再現してdecodeResponseを検証する。
// 実行: npx esbuild scripts/test-aml-decode.ts --bundle --platform=node --outfile=/tmp/test-aml.cjs && node /tmp/test-aml.cjs
import { decodeResponse } from "../src/transport/amlRpc";

function expectEq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`✅ ${name}`);
  } else {
    console.error(`❌ ${name}\n  expected: ${e}\n  actual:   ${a}`);
    process.exitCode = 1;
  }
}

// ---- Case 1: nanopb 実形式(packed) ----
// AmlConfig{ deactivation_ms=600, excluded=[8,9,17,18] }
//   08 D8 04            deactivation=600
//   1A 04 08 09 11 12   excluded packed(len=4)
// ConfigResponse{ config = 上記 } : 0A 09 ...
// Response{ config = 2 } : 12 0B ...
const packed = new Uint8Array([
  0x12, 0x0b, 0x0a, 0x09,
  0x08, 0xd8, 0x04,
  0x1a, 0x04, 0x08, 0x09, 0x11, 0x12,
]);
expectEq("packed: 既定4キー(8,9,17,18)を正しく復元", decodeResponse(packed), {
  kind: "config",
  config: { deactivationMs: 600, priorIdleMs: 0, excludedPositions: [8, 9, 17, 18] },
});

// ---- Case 2: 非packed(proto2系エンコーダ互換) ----
// 18 08 18 09 18 11 18 12 (field3 wire0 ×4)
const unpacked = new Uint8Array([
  0x12, 0x0d, 0x0a, 0x0b,
  0x08, 0xd8, 0x04,
  0x18, 0x08, 0x18, 0x09, 0x18, 0x11, 0x18, 0x12,
]);
expectEq("unpacked: 互換経路でも同じ結果", decodeResponse(unpacked), {
  kind: "config",
  config: { deactivationMs: 600, priorIdleMs: 0, excludedPositions: [8, 9, 17, 18] },
});

// ---- Case 3: 除外キー空 + prior_idle あり ----
// AmlConfig{ deactivation=600, prior_idle=200 } : 08 D8 04 10 C8 01
const empty = new Uint8Array([
  0x12, 0x08, 0x0a, 0x06,
  0x08, 0xd8, 0x04,
  0x10, 0xc8, 0x01,
]);
expectEq("empty: 除外空でも他フィールドが壊れない", decodeResponse(empty), {
  kind: "config",
  config: { deactivationMs: 600, priorIdleMs: 200, excludedPositions: [] },
});

// ---- Case 4: 旧バグの再現条件(packed) で deactivation/prior が破壊されないこと ----
// (Case1と同一だが、観点として明示: 旧実装は excluded=[4], deactivation=9, priorIdle上書き だった)
const r = decodeResponse(packed);
if (r.kind === "config" && r.config.excludedPositions.includes(4)) {
  console.error("❌ 旧バグ再発: 長さバイトを位置として誤読している");
  process.exitCode = 1;
} else {
  console.log("✅ 旧バグ(長さバイト=pos4誤読)は再発していない");
}

console.log(process.exitCode ? "\nFAILED" : "\nALL PASS");
