// Core guarantee for "Sync to GitHub": an UNCHANGED device keymap must merge
// back to a byte-identical .keymap (zero diff), and a single edited key must
// produce a minimal, canonical, hex-free diff.
// Run: npx --yes tsx scripts/test-roundtrip.ts

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import type { Keymap } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import {
  mergeIntoExistingKeymap,
  labelFor,
  type BehaviorMap,
} from "../src/sync/serializeKeymap";
import { parseSourceKeymap } from "../src/sync/parseKeymap";
import { DEMO_BEHAVIORS, BEHAVIOR_IDS } from "../src/demo/demoData";
import { usage } from "../src/sync/keycodes";

let failed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("ok:", msg);
  }
}

function firstDiff(a: string, b: string): string {
  const la = a.split("\n");
  const lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      return `line ${i + 1}:\n  src: ${JSON.stringify(la[i])}\n  out: ${JSON.stringify(lb[i])}`;
    }
  }
  return "(no line diff)";
}

function changedLines(a: string, b: string): number {
  const la = a.split("\n");
  const lb = b.split("\n");
  let n = 0;
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) n++;
  }
  return n;
}

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "fixtures", "Pyuron.keymap"), "utf8");

const behaviors: BehaviorMap = {};
for (const b of DEMO_BEHAVIORS) behaviors[b.id] = b;

// Synthesize the device keymap an UNCHANGED keyboard would report, by forward
// parsing the source itself.
const parsedLayers = parseSourceKeymap(source, behaviors, labelFor);
const clone = (): Keymap => ({
  availableLayers: parsedLayers.length,
  maxLayerNameLength: 16,
  layers: parsedLayers.map((bindings, i) => ({
    id: i,
    name: i === 0 ? "default" : `layer_${i}`,
    bindings: bindings.map((x) => ({ ...x })),
  })),
});

console.log(`parsed ${parsedLayers.length} layers, ${parsedLayers[0]?.length} keys/layer\n`);

// --- Test 1: identity (zero diff) -----------------------------------------
const r1 = mergeIntoExistingKeymap(source, clone(), behaviors);
assert(r1.text === source, "round-trip identity: unchanged device => byte-identical .keymap");
if (r1.text !== source) console.error("  " + firstDiff(source, r1.text));
assert(r1.warnings.length === 0, `no merge warnings (got ${r1.warnings.length})`);

// --- Test 2: single edited key -> minimal canonical diff -------------------
const km2 = clone();
// default_layer index 1 is `&kp W` in the source -> change to Z.
km2.layers[0].bindings[1] = { behaviorId: BEHAVIOR_IDS.kp, param1: usage("Z"), param2: 0 };
const r2 = mergeIntoExistingKeymap(source, km2, behaviors);
assert(r2.text !== source, "single key change produces a diff");
assert(changedLines(source, r2.text) === 1, `exactly one line differs (got ${changedLines(source, r2.text)})`);
assert(r2.text.includes("&kp Z"), "edited key serialized as `&kp Z`");
assert(source.includes("&kp W") && !r2.text.includes(" &kp W "), "old `&kp W` replaced");

// --- Test 3: modifier + consumer keys serialize canonically, never hex ----
const km3 = clone();
km3.layers[0].bindings[2] = { behaviorId: BEHAVIOR_IDS.kp, param1: usage("LG(SPACE)"), param2: 0 };
km3.layers[0].bindings[3] = { behaviorId: BEHAVIOR_IDS.kp, param1: usage("C_VOLUME_UP"), param2: 0 };
km3.layers[0].bindings[4] = { behaviorId: BEHAVIOR_IDS.kp, param1: usage("LG(LC(LS(NUMBER_4)))"), param2: 0 };
const r3 = mergeIntoExistingKeymap(source, km3, behaviors);
assert(r3.text.includes("&kp LG(SPACE)"), "modifier-wrapped key -> &kp LG(SPACE)");
assert(r3.text.includes("&kp C_VOLUME_UP"), "consumer key -> &kp C_VOLUME_UP");
assert(r3.text.includes("&kp LG(LC(LS(NUMBER_4)))"), "nested mods -> &kp LG(LC(LS(NUMBER_4)))");
// No raw hex anywhere in the keymap bindings.
const kmStart = r3.text.indexOf("keymap {");
const kmRegion = r3.text.slice(kmStart);
assert(!/&kp 0x/i.test(kmRegion), "no raw hex emitted in keymap bindings");
assert(r3.warnings.length === 0, `no warnings for known keys (got ${r3.warnings.length})`);

// --- Test 4: layer #define name preserved on an edited layer-tap ----------
const km4 = clone();
// Find a layer-tap on default_layer and re-point it to layer 9 (GEST_PAGE).
const ltIdx = km4.layers[0].bindings.findIndex((b) => b.behaviorId === BEHAVIOR_IDS.lt);
if (ltIdx >= 0) {
  km4.layers[0].bindings[ltIdx] = {
    behaviorId: BEHAVIOR_IDS.lt,
    param1: 9,
    param2: usage("A"),
  };
  const r4 = mergeIntoExistingKeymap(source, km4, behaviors);
  assert(r4.text.includes("&lt GEST_PAGE A"), "edited layer-tap uses #define name (&lt GEST_PAGE A)");
}

console.log(failed ? `\n${failed} CHECK(S) FAILED ❌` : "\nALL CHECKS PASSED ✅");
process.exitCode = failed ? 1 : 0;
