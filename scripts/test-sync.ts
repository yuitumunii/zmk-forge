// Headless smoke test: drive the mock connection through the real call_rpc
// stack and serialize, asserting the end-to-end Demo + Sync path works.
// Run: npx --yes tsx scripts/test-sync.ts

import { call_rpc } from "@zmkfirmware/zmk-studio-ts-client";
import { createMockConnection } from "../src/rpc/mockConnection";
import {
  serializeKeymapToDevicetree,
  type BehaviorMap,
} from "../src/sync/serializeKeymap";
import { BEHAVIOR_IDS } from "../src/demo/demoData";
import { usage } from "../src/sync/keycodes";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const conn = createMockConnection();

// device info + lock state
const info = await call_rpc(conn, { core: { getDeviceInfo: true } });
assert(info.core?.getDeviceInfo?.name === "Demo Keyboard", "device info name");

const lock = await call_rpc(conn, { core: { getLockState: true } });
assert(lock.core?.getLockState === 1, "lock state unlocked (1)");

// behaviors
const list = await call_rpc(conn, { behaviors: { listAllBehaviors: true } });
const ids = list.behaviors?.listAllBehaviors?.behaviors || [];
assert(ids.length >= 5, `behaviors listed (${ids.length})`);
const behaviorMap: BehaviorMap = {};
for (const id of ids) {
  const d = await call_rpc(conn, {
    behaviors: { getBehaviorDetails: { behaviorId: id } },
  });
  const det = d.behaviors?.getBehaviorDetails;
  if (det) behaviorMap[det.id] = det;
}

// keymap
const kmResp0 = await call_rpc(conn, { keymap: { getKeymap: true } });
let km = kmResp0.keymap?.getKeymap;
if (!km) throw new Error("getKeymap returned undefined");
assert(km.layers.length === 10, `10 layers (${km.layers.length})`);
assert(
  km.layers.every((l) => l.bindings.length === 40),
  "all layers have 40 bindings"
);

// live edit: set base layer key 0 (currently Q) to Z, confirm it sticks
await call_rpc(conn, {
  keymap: {
    setLayerBinding: {
      layerId: 0,
      keyPosition: 0,
      binding: { behaviorId: BEHAVIOR_IDS.kp, param1: usage("Z"), param2: 0 },
    },
  },
});
const kmResp1 = await call_rpc(conn, { keymap: { getKeymap: true } });
km = kmResp1.keymap?.getKeymap;
if (!km) throw new Error("getKeymap (after edit) returned undefined");
assert(km.layers[0].bindings[0].param1 === usage("Z"), "live edit Q->Z persisted");

// serialize
const text = serializeKeymapToDevicetree(km, behaviorMap);
console.log("\n----- generated .keymap (excerpt) -----");
console.log(text.split("\n").slice(0, 18).join("\n"));
console.log("---------------------------------------\n");

assert(text.includes('compatible = "zmk,keymap"'), "has keymap compatible");
assert(text.includes("&lt 1 SPACE"), "serializes layer-tap (&lt 1 SPACE)");
assert(text.includes("&mt LEFT_SHIFT TAB"), "serializes mod-tap (&mt LEFT_SHIFT TAB)");
assert(text.includes("&mo 7"), "serializes momentary (&mo 7)");
assert(text.includes("&trans"), "serializes transparent (&trans)");
assert(text.includes("&kp Z"), "edited key serialized (&kp Z)");
assert(text.includes("default_layer"), "base layer node name");

console.log(
  process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED ✅"
);
