// Verify mergeIntoExistingKeymap against the real Pyuron.keymap: device
// bindings replace only the layer bindings blocks; combos/macros/config/
// defines/labels are preserved untouched.
// Run: npx --yes tsx scripts/test-merge.ts

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type {
  Keymap,
  BehaviorBinding,
} from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { mergeIntoExistingKeymap, type BehaviorMap } from "../src/sync/serializeKeymap";
import { DEMO_BEHAVIORS, BEHAVIOR_IDS } from "../src/demo/demoData";
import { usage } from "../src/sync/keycodes";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "fixtures", "Pyuron.keymap"), "utf8");

const behaviors: BehaviorMap = {};
for (const b of DEMO_BEHAVIORS) behaviors[b.id] = b;

const trans = (): BehaviorBinding => ({
  behaviorId: BEHAVIOR_IDS.trans,
  param1: 0,
  param2: 0,
});

// Pyuron: 10 layers x 40 keys. Build a device keymap; mark layer0 key0 = Z.
const keymap: Keymap = {
  availableLayers: 0,
  maxLayerNameLength: 16,
  layers: Array.from({ length: 10 }, (_, li) => ({
    id: li,
    name: li === 0 ? "default" : `layer_${li}`,
    bindings: Array.from({ length: 40 }, trans),
  })),
};
keymap.layers[0].bindings[0] = {
  behaviorId: BEHAVIOR_IDS.kp,
  param1: usage("Z"),
  param2: 0,
};

const { text, layersReplaced, deviceLayers } = mergeIntoExistingKeymap(
  source,
  keymap,
  behaviors
);

assert(deviceLayers === 10, `device has 10 layers`);
assert(layersReplaced === 10, `replaced 10 layer blocks (got ${layersReplaced})`);

// Preserved (outside keymap node) ------------------------------------------
assert(text.includes("#include <behaviors.dtsi>"), "preserved #include");
assert(text.includes("#define MOUSE 6"), "preserved #define MOUSE");
assert(text.includes('flavor = "balanced"'), "preserved &mt config");
assert(text.includes("compatible = \"zmk,combos\""), "preserved combos node");
assert(text.includes("key-positions = <17 16>"), "preserved combo lang1");
assert(text.includes("paste_reserch:"), "preserved macro paste_reserch");
assert(text.includes('label = "PW_APPLE"'), "preserved macro label");
assert(text.includes('label = "MOUSE"'), "preserved layer_6 label");

// Replaced (inside keymap node) --------------------------------------------
assert(!text.includes("&mt ESC Q"), "old default_layer binding removed");
assert(text.includes("&kp Z"), "new device binding written (&kp Z)");
const transCount = (text.match(/&trans/g) || []).length;
assert(transCount > 300, `bindings replaced with device trans (${transCount} &trans)`);

// Macros' own bindings must NOT have been touched (they live outside keymap node)
assert(
  text.includes("<&kp C &kp H &kp A &kp N &kp G &kp E &kp M &kp E>"),
  "macro bindings untouched"
);

console.log("\n----- merged default_layer (excerpt) -----");
const i = text.indexOf("default_layer");
console.log(text.slice(i, i + 360));
console.log("------------------------------------------\n");

console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED ✅");
