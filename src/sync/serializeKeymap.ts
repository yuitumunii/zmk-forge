// Serialize an in-memory keymap (as read from the device over RPC) into ZMK
// `.keymap` devicetree source. This is the heart of "Sync to GitHub":
// device state -> source file. Metadata-driven so it works for any behavior
// whose parameter kinds (layer id / hid usage / number) are described.
//
// The real "Sync" path uses `mergeIntoExistingKeymap`, which delegates to the
// source-preserving merge (parseKeymap.ts): unchanged keys keep their original
// text, only edited keys are re-serialized here with canonical names.

import type {
  Keymap,
  BehaviorBinding,
} from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { BehaviorParameterValueDescription } from "@zmkfirmware/zmk-studio-ts-client/behaviors";

import { keycodeName, UnknownUsageError } from "./keycodes";
import {
  mergeSourcePreserving,
  type BehaviorMap,
  type MergeResult,
  type DefineMap,
} from "./parseKeymap";

export type { BehaviorMap, MergeResult, DefineMap };

const EMPTY_DEFINES: DefineMap = { nameToNum: {}, numToName: {} };

// ZMK behavior displayName -> devicetree node label (the `&xxx` reference).
const DISPLAYNAME_TO_LABEL: Record<string, string> = {
  "Key Press": "kp",
  "Mod-Tap": "mt",
  "Layer-Tap": "lt",
  "Momentary Layer": "mo",
  "Toggle Layer": "tog",
  "To Layer": "to",
  Transparent: "trans",
  None: "none",
  "Mouse Button Press": "mkp",
  "Mouse Key Press": "mkp",
  "Sticky Key": "sk",
  "Sticky Layer": "sl",
  Bluetooth: "bt",
  "Key Repeat": "key_repeat",
  "Caps Word": "caps_word",
  Bootloader: "bootloader",
  Reset: "sys_reset",
  "Grave/Escape": "gresc",
};

export function labelFor(displayName: string): string {
  return (
    DISPLAYNAME_TO_LABEL[displayName] ??
    displayName.toLowerCase().replace(/[^a-z0-9]+/g, "_")
  );
}

function formatParam(
  value: number,
  descs: BehaviorParameterValueDescription[],
  defines: DefineMap
): string {
  const isLayer = descs.some((d) => d.layerId);
  const isHid = descs.some((d) => d.hidUsage);
  if (isHid) return keycodeName(value); // throws UnknownUsageError, never hex
  if (isLayer) return defines.numToName[value] ?? String(value);
  // range / constant / nil -> plain number
  return String(value);
}

export function serializeBinding(
  binding: BehaviorBinding,
  behaviors: BehaviorMap,
  defines: DefineMap = EMPTY_DEFINES
): string {
  const behavior = behaviors[binding.behaviorId];
  if (!behavior) {
    return `&unknown_${binding.behaviorId} ${binding.param1} ${binding.param2}`;
  }
  const label = labelFor(behavior.displayName);
  const set = behavior.metadata[0];
  const parts = [`&${label}`];
  if (set?.param1?.length)
    parts.push(formatParam(binding.param1, set.param1, defines));
  if (set?.param2?.length)
    parts.push(formatParam(binding.param2, set.param2, defines));
  return parts.join(" ");
}

// Browser/demo helper: serialize the whole keymap from scratch. Tolerates an
// unknown usage by emitting a marked hex placeholder (this output is only ever
// copied/downloaded in the browser, never pushed — the desktop push path keeps
// the original source text for anything it can't serialize).
function safeSerialize(
  binding: BehaviorBinding,
  behaviors: BehaviorMap
): string {
  try {
    return serializeBinding(binding, behaviors);
  } catch (e) {
    if (e instanceof UnknownUsageError) {
      return `&kp 0x${e.usage.toString(16).toUpperCase()} /* unknown */`;
    }
    throw e;
  }
}

function sanitizeNodeName(name: string, index: number): string {
  const base = (name || `layer_${index}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${base || `layer_${index}`}_layer`;
}

const PER_LINE = 12;

/** Full `.keymap` keymap node text for the given device keymap. */
export function serializeKeymapToDevicetree(
  keymap: Keymap,
  behaviors: BehaviorMap
): string {
  const layers = keymap.layers
    .map((layer, index) => {
      const cells = layer.bindings.map((b) => safeSerialize(b, behaviors));
      const lines: string[] = [];
      for (let i = 0; i < cells.length; i += PER_LINE) {
        lines.push("                " + cells.slice(i, i + PER_LINE).join("  "));
      }
      return [
        `        ${sanitizeNodeName(layer.name, index)} {`,
        `            display-name = "${layer.name || `layer ${index}`}";`,
        `            bindings = <`,
        lines.join("\n"),
        `            >;`,
        `        };`,
      ].join("\n");
    })
    .join("\n\n");

  return [
    "/ {",
    "    keymap {",
    '        compatible = "zmk,keymap";',
    "",
    layers,
    "    };",
    "};",
    "",
  ].join("\n");
}

// Merge device keymap into an EXISTING `.keymap` source. Source-preserving:
// unchanged keys keep their original text (byte-identical), only edited keys
// are re-serialized. Preserves #defines, combos, macros, behavior config,
// comments, layer labels, and the hand-aligned whitespace of unchanged rows.
export function mergeIntoExistingKeymap(
  source: string,
  keymap: Keymap,
  behaviors: BehaviorMap
): MergeResult {
  return mergeSourcePreserving(source, keymap, behaviors, {
    serialize: serializeBinding,
    labelFor,
    isBuiltinBehavior: (displayName) => displayName in DISPLAYNAME_TO_LABEL,
  });
}
