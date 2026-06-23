// Verify the FULL sync pipeline including push, against a local bare remote
// (no token / no network). Mirrors what the Electron IPC handler runs.
// Run: npx --yes tsx scripts/test-push.ts

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, copyFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import type { Keymap, BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import { syncToGitHub, type SyncConfig } from "../src/sync/gitSync";
import { DEMO_BEHAVIORS, BEHAVIOR_IDS } from "../src/demo/demoData";
import { usage } from "../src/sync/keycodes";
import type { BehaviorMap } from "../src/sync/serializeKeymap";

function assert(c: boolean, m: string) {
  if (!c) { console.error("FAIL:", m); process.exitCode = 1; } else console.log("ok:", m);
}

const here = dirname(fileURLToPath(import.meta.url));
const bare = join(tmpdir(), "zmk-bare.git");
const clone = join(tmpdir(), "zmk-clone");
const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd }).toString().trim();

rmSync(bare, { recursive: true, force: true });
rmSync(clone, { recursive: true, force: true });

// bare remote
mkdirSync(bare, { recursive: true });
execFileSync("git", ["init", "--bare", "-q", "-b", "main", bare]);

// clone, seed, baseline, push
mkdirSync(join(clone, "config"), { recursive: true });
copyFileSync(join(here, "fixtures", "Pyuron.keymap"), join(clone, "config", "Pyuron.keymap"));
execFileSync("git", ["init", "-q", "-b", "main", clone]);
g(clone, "config", "user.email", "t@e.com");
g(clone, "config", "user.name", "t");
g(clone, "remote", "add", "origin", bare);
g(clone, "add", "-A");
g(clone, "commit", "-q", "-m", "baseline");
g(clone, "push", "-q", "origin", "main");

// device keymap (10 layers, layer0 key0 = Z)
const behaviors: BehaviorMap = {};
for (const b of DEMO_BEHAVIORS) behaviors[b.id] = b;
const trans = (): BehaviorBinding => ({ behaviorId: BEHAVIOR_IDS.trans, param1: 0, param2: 0 });
const keymap: Keymap = {
  availableLayers: 0,
  maxLayerNameLength: 16,
  layers: Array.from({ length: 10 }, (_, li) => ({
    id: li, name: li === 0 ? "default" : `layer_${li}`,
    bindings: Array.from({ length: 40 }, trans),
  })),
};
keymap.layers[0].bindings[0] = { behaviorId: BEHAVIOR_IDS.kp, param1: usage("Z"), param2: 0 };

const config: SyncConfig = { clonePath: clone, keymapRelPath: "config/Pyuron.keymap", remote: "origin", branch: "main" };

// push:true, no token (local bare remote needs none)
const res = await syncToGitHub(config, keymap, behaviors, "keymap: sync from device", { push: true });

assert(res.sha !== null, "commit created");
assert(res.pushed === true, "pushed to remote");

const cloneHead = g(clone, "rev-parse", "HEAD");
const bareHead = g(bare, "rev-parse", "main");
assert(cloneHead === bareHead, "remote received the commit (heads match)");
assert(cloneHead === res.sha, "returned sha == clone HEAD");

// the pushed content is on the remote
const remoteFile = g(bare, "show", "main:config/Pyuron.keymap");
assert(remoteFile.includes("&kp Z"), "remote file has new binding");
assert(remoteFile.includes("paste_reserch:"), "remote file preserved macros");

rmSync(bare, { recursive: true, force: true });
rmSync(clone, { recursive: true, force: true });
console.log(process.exitCode ? "\nSOME CHECKS FAILED" : "\nALL CHECKS PASSED ✅");
