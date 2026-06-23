// Verify the git plumbing end-to-end against a throwaway local repo seeded
// with the real Pyuron config: write merged keymap -> git commit (no push).
// Run: npx --yes tsx scripts/test-gitsync.ts

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, copyFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import type { Keymap, BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { syncToGitHub, type SyncConfig } from "../src/sync/gitSync";
import { DEMO_BEHAVIORS, BEHAVIOR_IDS } from "../src/demo/demoData";
import { usage } from "../src/sync/keycodes";
import type { BehaviorMap } from "../src/sync/serializeKeymap";

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    process.exitCode = 1;
  } else {
    console.log("ok:", msg);
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(tmpdir(), "zmk-sync-test-repo");
const g = (...args: string[]) => execFileSync("git", args, { cwd: repo }).toString().trim();

// --- set up a throwaway clone with the real Pyuron config ---
rmSync(repo, { recursive: true, force: true });
mkdirSync(join(repo, "config"), { recursive: true });
copyFileSync(join(here, "fixtures", "Pyuron.keymap"), join(repo, "config", "Pyuron.keymap"));
g("init", "-q");
g("config", "user.email", "test@example.com");
g("config", "user.name", "test");
g("add", "-A");
g("commit", "-q", "-m", "baseline");
const baseCount = Number(g("rev-list", "--count", "HEAD"));

// --- device keymap (10 layers, layer0 key0 = Z) ---
const behaviors: BehaviorMap = {};
for (const b of DEMO_BEHAVIORS) behaviors[b.id] = b;
const trans = (): BehaviorBinding => ({ behaviorId: BEHAVIOR_IDS.trans, param1: 0, param2: 0 });
const keymap: Keymap = {
  availableLayers: 0,
  maxLayerNameLength: 16,
  layers: Array.from({ length: 10 }, (_, li) => ({
    id: li,
    name: li === 0 ? "default" : `layer_${li}`,
    bindings: Array.from({ length: 40 }, trans),
  })),
};
keymap.layers[0].bindings[0] = { behaviorId: BEHAVIOR_IDS.kp, param1: usage("Z"), param2: 0 };

const config: SyncConfig = {
  clonePath: repo,
  keymapRelPath: "config/Pyuron.keymap",
  branch: "main",
  remote: "origin",
};

const res = await syncToGitHub(config, keymap, behaviors, "keymap: sync from device", { push: false });

assert(res.sha !== null, "commit created");
assert(res.merge.layersReplaced === 10, `merged 10 layers (${res.merge.layersReplaced})`);
assert(res.pushed === false, "push skipped (no remote)");

const newCount = Number(g("rev-list", "--count", "HEAD"));
assert(newCount === baseCount + 1, `one new commit (${baseCount} -> ${newCount})`);

const committed = readFileSync(join(repo, "config", "Pyuron.keymap"), "utf8");
assert(committed.includes("&kp Z"), "committed file has new binding");
assert(committed.includes("paste_reserch:"), "committed file preserved macros");
assert(!committed.includes("&mt ESC Q"), "committed file replaced old bindings");

// second sync with identical state -> no new commit
const res2 = await syncToGitHub(config, keymap, behaviors, "keymap: noop", { push: false });
assert(res2.sha === null, "no-op sync makes no commit");

console.log("\nlast commit:", g("log", "--oneline", "-1"));
rmSync(repo, { recursive: true, force: true });
console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED ✅");
