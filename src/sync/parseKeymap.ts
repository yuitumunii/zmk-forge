// Source-preserving merge for "Sync to GitHub".
//
// The naive merge re-serializes every key, so even an unchanged keymap diffs
// (alias variance like LEFT_CONTROL vs LCTRL, #define layer names, hand-aligned
// whitespace). This module instead keeps each UNCHANGED key's original source
// text verbatim and only re-serializes keys the user actually edited — so an
// unedited device keymap produces a byte-identical file (zero diff).
//
// It does this by forward-parsing each existing binding back to a semantic
// {behaviorId, param1, param2} and comparing to the device binding. Parsing
// reuses the keycode table (keycodes.ts) including modifier wrappers and the
// file's own #define layer names. Anything it can't confidently parse (custom
// macros, &bt BT_SEL, ...) is conservatively kept as-is.

import type { Keymap, BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type {
  GetBehaviorDetailsResponse,
  BehaviorParameterValueDescription,
} from "@zmkfirmware/zmk-studio-ts-client/behaviors";

import { keycodeUsage } from "./keycodes";

export type BehaviorMap = Record<number, GetBehaviorDetailsResponse>;

/** Layer #define name <-> number maps parsed from the source. */
export interface DefineMap {
  nameToNum: Record<string, number>;
  numToName: Record<number, string>;
}

export interface MergeResult {
  text: string;
  layersReplaced: number;
  deviceLayers: number;
  /** Non-fatal issues (e.g. a key that couldn't be serialized and was kept). */
  warnings: string[];
}

/** Injected so this module doesn't depend on the serializer (avoids a cycle). */
export interface SerializeDeps {
  serialize: (
    binding: BehaviorBinding,
    behaviors: BehaviorMap,
    defines: DefineMap
  ) => string;
  labelFor: (displayName: string) => string;
  /** True for built-in behaviors we can faithfully render (kp/mt/lt/mkp/...).
   *  Custom behaviors (macros) report a display name that may differ from their
   *  devicetree node name, so we must never re-serialize them. */
  isBuiltinBehavior: (displayName: string) => boolean;
}

// --- #defines --------------------------------------------------------------
export function parseDefines(source: string): DefineMap {
  const nameToNum: Record<string, number> = {};
  const numToName: Record<number, string> = {};
  const re = /^[ \t]*#define[ \t]+([A-Za-z_]\w*)[ \t]+(\d+)[ \t]*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const name = m[1];
    const num = Number(m[2]);
    nameToNum[name] = num;
    // First define wins for the reverse map (a number may have several names).
    if (numToName[num] === undefined) numToName[num] = name;
  }
  return { nameToNum, numToName };
}

// --- bindings chunking -----------------------------------------------------
interface KeyChunk {
  raw: string; // exact source slice for this key (token + trailing whitespace)
  token: string; // "&mt ESC Q"
  trailingWs: string; // whitespace after the token, up to the next key
  label: string; // "mt"
  args: string[]; // ["ESC", "Q"]
}

// Params never start with '&', so each '&' begins a new key and runs up to just
// before the next '&'. The text before the first '&' is leading indentation.
function chunkBindings(inner: string): { leading: string; chunks: KeyChunk[] } {
  const amp: number[] = [];
  for (let i = 0; i < inner.length; i++) if (inner[i] === "&") amp.push(i);
  if (amp.length === 0) return { leading: inner, chunks: [] };

  const leading = inner.slice(0, amp[0]);
  const chunks: KeyChunk[] = [];
  for (let k = 0; k < amp.length; k++) {
    const start = amp[k];
    const end = k + 1 < amp.length ? amp[k + 1] : inner.length;
    const raw = inner.slice(start, end);
    const token = raw.replace(/\s+$/, "");
    const trailingWs = raw.slice(token.length);
    const parts = token.replace(/^&/, "").trim().split(/\s+/);
    chunks.push({
      raw,
      token,
      trailingWs,
      label: parts[0] ?? "",
      args: parts.slice(1),
    });
  }
  return { leading, chunks };
}

// --- forward parse one source key -> semantic binding ----------------------
interface ParsedBinding {
  behaviorId?: number;
  param1: number;
  param2: number;
  confident: boolean;
}

function isNum(s: string | undefined): number | undefined {
  if (s == null) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

// &mkp's button #defines: MBn = 1 << (n-1)  (MB1=1, MB2=2, MB3=4, MB4=8, MB5=16)
function mbValue(arg: string): number | undefined {
  const m = /^MB([1-9])$/.exec(arg);
  return m ? 1 << (Number(m[1]) - 1) : undefined;
}

function resolveArg(
  arg: string | undefined,
  descs: BehaviorParameterValueDescription[],
  defines: DefineMap
): number | undefined {
  if (arg == null) return undefined;
  if (descs.some((d) => d.layerId)) {
    if (arg in defines.nameToNum) return defines.nameToNum[arg];
    return isNum(arg);
  }
  const mb = mbValue(arg);
  if (mb !== undefined) return mb;
  const u = keycodeUsage(arg);
  if (u !== undefined) return u;
  return isNum(arg);
}

function parseChunk(
  chunk: KeyChunk,
  behaviors: BehaviorMap,
  defines: DefineMap,
  labelToId: Record<string, number>
): ParsedBinding {
  const behaviorId = labelToId[chunk.label];
  if (behaviorId === undefined) {
    return { param1: 0, param2: 0, confident: false };
  }
  const set = behaviors[behaviorId]?.metadata?.[0];
  const wantP1 = !!set?.param1?.length;
  const wantP2 = !!set?.param2?.length;

  let param1 = 0;
  let param2 = 0;
  let confident = true;

  if (wantP1) {
    const r = resolveArg(chunk.args[0], set!.param1!, defines);
    if (r === undefined) confident = false;
    else param1 = r;
  }
  if (wantP2) {
    const r = resolveArg(chunk.args[1], set!.param2!, defines);
    if (r === undefined) confident = false;
    else param2 = r;
  }
  return { behaviorId, param1, param2, confident };
}

// --- rewrite one bindings block, keeping unchanged keys verbatim -----------
function rewriteBlock(
  blockFull: string,
  layer: Keymap["layers"][number],
  behaviors: BehaviorMap,
  defines: DefineMap,
  labelToId: Record<string, number>,
  deps: SerializeDeps,
  warnings: string[]
): { text: string; skipped: boolean } {
  const lt = blockFull.indexOf("<");
  const gt = blockFull.lastIndexOf(">");
  if (lt < 0 || gt < 0 || gt < lt) return { text: blockFull, skipped: true };

  const prefix = blockFull.slice(0, lt + 1);
  const inner = blockFull.slice(lt + 1, gt);
  const suffix = blockFull.slice(gt);

  const { leading, chunks } = chunkBindings(inner);
  if (chunks.length !== layer.bindings.length) {
    // Shape mismatch — never partially corrupt; leave this block untouched.
    return { text: blockFull, skipped: true };
  }

  const pieces = chunks.map((chunk, i) => {
    const dev = layer.bindings[i];
    const parsed = parseChunk(chunk, behaviors, defines, labelToId);

    const matches =
      parsed.confident &&
      parsed.behaviorId === dev.behaviorId &&
      parsed.param1 === dev.param1 &&
      parsed.param2 === dev.param2;
    if (matches) return chunk.raw;

    if (!parsed.confident) {
      // Couldn't parse the source key (custom macro, &bt BT_SEL, ...). Keep it
      // unless the device clearly switched to a different BUILT-IN behavior we
      // can render faithfully. Custom behaviors are always kept verbatim: the
      // device reports their display name (e.g. "PQ_MAC"), which can differ
      // from the devicetree node referenced in bindings (e.g. &pw_mac), so
      // re-serializing would write a node that doesn't exist and break the build.
      const devBeh = behaviors[dev.behaviorId];
      if (!devBeh || !deps.isBuiltinBehavior(devBeh.displayName)) return chunk.raw;
      if (deps.labelFor(devBeh.displayName) === chunk.label) return chunk.raw;
    }

    // Genuinely changed -> re-serialize the device binding (canonical names).
    try {
      return deps.serialize(dev, behaviors, defines) + chunk.trailingWs;
    } catch (e) {
      warnings.push(
        `Kept original for key ${i} on layer "${layer.name}" (cannot serialize: ${
          e instanceof Error ? e.message : String(e)
        })`
      );
      return chunk.raw;
    }
  });

  return { text: prefix + leading + pieces.join("") + suffix, skipped: false };
}

// Isolate the `keymap { ... }` node via brace matching so we never touch the
// separate combos/macros nodes (which also contain `bindings = <...>`).
function isolateKeymapBody(source: string): {
  before: string;
  body: string;
  after: string;
} {
  const m = /keymap\s*\{/.exec(source);
  if (!m) throw new Error("No `keymap { ... }` node found in source .keymap");
  const open = m.index + m[0].length - 1;
  let depth = 0;
  let end = -1;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error("Unbalanced braces in keymap node");
  return {
    before: source.slice(0, open + 1),
    body: source.slice(open + 1, end),
    after: source.slice(end),
  };
}

function buildLabelToId(
  behaviors: BehaviorMap,
  labelFor: (displayName: string) => string
): Record<string, number> {
  const labelToId: Record<string, number> = {};
  for (const [id, beh] of Object.entries(behaviors)) {
    labelToId[labelFor(beh.displayName)] = Number(id);
  }
  return labelToId;
}

const SENTINEL_BEHAVIOR_ID = -1;

// --- top-level merge -------------------------------------------------------
export function mergeSourcePreserving(
  source: string,
  keymap: Keymap,
  behaviors: BehaviorMap,
  deps: SerializeDeps
): MergeResult {
  const warnings: string[] = [];
  const defines = parseDefines(source);
  const labelToId = buildLabelToId(behaviors, deps.labelFor);
  const { before, body, after } = isolateKeymapBody(source);

  let idx = 0;
  const newBody = body.replace(/bindings\s*=\s*<[\s\S]*?>\s*;/g, (full) => {
    const layer = keymap.layers[idx++];
    if (!layer) return full;
    const { text } = rewriteBlock(
      full,
      layer,
      behaviors,
      defines,
      labelToId,
      deps,
      warnings
    );
    return text;
  });

  return {
    text: before + newBody + after,
    layersReplaced: idx,
    deviceLayers: keymap.layers.length,
    warnings,
  };
}

// Forward-parse a source `.keymap` into per-layer device bindings. Used by the
// round-trip test to synthesize the "device keymap" an UNCHANGED keyboard would
// report. Keys whose behavior/params can't be confidently parsed get a sentinel
// behaviorId (not in `behaviors`), which the merge keeps verbatim.
export function parseSourceKeymap(
  source: string,
  behaviors: BehaviorMap,
  labelFor: (displayName: string) => string
): BehaviorBinding[][] {
  const defines = parseDefines(source);
  const labelToId = buildLabelToId(behaviors, labelFor);
  const { body } = isolateKeymapBody(source);

  const layers: BehaviorBinding[][] = [];
  const re = /bindings\s*=\s*<([\s\S]*?)>\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const { chunks } = chunkBindings(m[1]);
    layers.push(
      chunks.map((chunk) => {
        const p = parseChunk(chunk, behaviors, defines, labelToId);
        if (p.confident && p.behaviorId !== undefined) {
          return { behaviorId: p.behaviorId, param1: p.param1, param2: p.param2 };
        }
        return { behaviorId: SENTINEL_BEHAVIOR_ID, param1: 0, param2: 0 };
      })
    );
  }
  return layers;
}
