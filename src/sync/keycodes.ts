// Mapping between ZMK keycode mnemonics (as used in .keymap source) and HID
// usages (as used over the ZMK Studio RPC protocol). Used by the demo data
// (name -> usage), the keymap serializer (usage -> name), and the keymap parser
// (name -> usage, including modifier wrappers like LG(SPACE)).
//
// Usage value encoding matches the ts-client: (modMask << 24) | (page << 16) | id.
// Page 7 = Keyboard/Keypad, Page 12 = Consumer, Page 9 = Buttons (mouse).

import { hid_usage_from_page_and_id } from "../hid-usages";

type Entry = [name: string, page: number, id: number];

/** Implicit-modifier bits (high byte of a usage). Matches HidUsagePicker. */
export const MOD_BIT: Record<string, number> = {
  LC: 0x01,
  LS: 0x02,
  LA: 0x04,
  LG: 0x08,
  RC: 0x10,
  RS: 0x20,
  RA: 0x40,
  RG: 0x80,
};

// Outer-to-inner wrap order for emitting nested modifiers on an edited key.
// (Only matters for keys the user actually changed — unchanged keys keep their
// original source text verbatim via the source-preserving merge.)
const WRAP_ORDER: Array<[number, string]> = [
  [MOD_BIT.LG, "LG"],
  [MOD_BIT.RG, "RG"],
  [MOD_BIT.LA, "LA"],
  [MOD_BIT.RA, "RA"],
  [MOD_BIT.LC, "LC"],
  [MOD_BIT.RC, "RC"],
  [MOD_BIT.LS, "LS"],
  [MOD_BIT.RS, "RS"],
];

// --- Canonical entries (long ZMK names; these win the reverse map) ---------
const CANONICAL: Entry[] = [];

// Letters A-Z -> 0x04..0x1D
for (let i = 0; i < 26; i++) {
  CANONICAL.push([String.fromCharCode(65 + i), 7, 0x04 + i]);
}
// Numbers NUMBER_1..NUMBER_9, NUMBER_0 -> 0x1E..0x27
for (let i = 0; i < 9; i++) {
  CANONICAL.push([`NUMBER_${i + 1}`, 7, 0x1e + i]);
}
CANONICAL.push(["NUMBER_0", 7, 0x27]);
// Function keys F1..F24 -> 0x3A..0x45, then 0x68..0x73
for (let i = 0; i < 12; i++) CANONICAL.push([`F${i + 1}`, 7, 0x3a + i]);
for (let i = 0; i < 12; i++) CANONICAL.push([`F${i + 13}`, 7, 0x68 + i]);
// Keypad digits KP_NUMBER_1..9 -> 0x59..0x61, KP_NUMBER_0 -> 0x62
for (let i = 0; i < 9; i++) CANONICAL.push([`KP_NUMBER_${i + 1}`, 7, 0x59 + i]);
CANONICAL.push(["KP_NUMBER_0", 7, 0x62]);

CANONICAL.push(
  // Named keyboard keys (long ZMK names)
  ["ENTER", 7, 0x28],
  ["ESCAPE", 7, 0x29],
  ["BACKSPACE", 7, 0x2a],
  ["TAB", 7, 0x2b],
  ["SPACE", 7, 0x2c],
  ["MINUS", 7, 0x2d],
  ["EQUAL", 7, 0x2e],
  ["LEFT_BRACKET", 7, 0x2f],
  ["RIGHT_BRACKET", 7, 0x30],
  ["BACKSLASH", 7, 0x31],
  ["NON_US_HASH", 7, 0x32],
  ["SEMICOLON", 7, 0x33],
  ["SINGLE_QUOTE", 7, 0x34],
  ["GRAVE", 7, 0x35],
  ["COMMA", 7, 0x36],
  ["PERIOD", 7, 0x37],
  ["SLASH", 7, 0x38],
  ["CAPSLOCK", 7, 0x39],
  ["PRINTSCREEN", 7, 0x46],
  ["SCROLLLOCK", 7, 0x47],
  ["PAUSE_BREAK", 7, 0x48],
  ["INSERT", 7, 0x49],
  ["HOME", 7, 0x4a],
  ["PAGE_UP", 7, 0x4b],
  ["DELETE", 7, 0x4c],
  ["END", 7, 0x4d],
  ["PAGE_DOWN", 7, 0x4e],
  ["RIGHT_ARROW", 7, 0x4f],
  ["LEFT_ARROW", 7, 0x50],
  ["DOWN_ARROW", 7, 0x51],
  ["UP_ARROW", 7, 0x52],
  ["KP_NUMLOCK", 7, 0x53],
  ["KP_SLASH", 7, 0x54],
  ["KP_ASTERISK", 7, 0x55],
  ["KP_MINUS", 7, 0x56],
  ["KP_PLUS", 7, 0x57],
  ["KP_ENTER", 7, 0x58],
  ["KP_DOT", 7, 0x63],
  ["KP_EQUAL", 7, 0x67],
  ["K_MUTE", 7, 0x7f],
  ["LANGUAGE_1", 7, 0x90],
  ["LANGUAGE_2", 7, 0x91],
  // Modifiers (long names)
  ["LEFT_CONTROL", 7, 0xe0],
  ["LEFT_SHIFT", 7, 0xe1],
  ["LEFT_ALT", 7, 0xe2],
  ["LEFT_GUI", 7, 0xe3],
  ["RIGHT_CONTROL", 7, 0xe4],
  ["RIGHT_SHIFT", 7, 0xe5],
  ["RIGHT_ALT", 7, 0xe6],
  ["RIGHT_GUI", 7, 0xe7],
  // NOTE: &mkp's button param is a plain number (range 1-16), and MB1.. are
  // #defines for those numbers — NOT keyboard usages. They are intentionally
  // not in this table; the merge keeps unchanged &mkp keys verbatim.
  // Consumer (page 12, long names)
  ["C_BRIGHTNESS_INC", 12, 0x6f],
  ["C_BRIGHTNESS_DEC", 12, 0x70],
  ["C_NEXT", 12, 0xb5],
  ["C_PREVIOUS", 12, 0xb6],
  ["C_STOP", 12, 0xb7],
  ["C_PLAY_PAUSE", 12, 0xcd],
  ["C_MUTE", 12, 0xe2],
  ["C_VOLUME_UP", 12, 0xe9],
  ["C_VOLUME_DOWN", 12, 0xea],
  ["GLOBE", 12, 0x29d]
);

// --- Aliases (alternate spellings; forward-resolvable, never emitted) ------
const ALIASES: Entry[] = [
  ["RET", 7, 0x28],
  ["RETURN", 7, 0x28],
  ["ESC", 7, 0x29],
  ["BSPC", 7, 0x2a],
  ["LBKT", 7, 0x2f],
  ["RBKT", 7, 0x30],
  ["BSLH", 7, 0x31],
  ["SEMI", 7, 0x33],
  ["SQT", 7, 0x34],
  ["APOS", 7, 0x34],
  ["DOT", 7, 0x37],
  ["FSLH", 7, 0x38],
  ["CAPS", 7, 0x39],
  ["PG_UP", 7, 0x4b],
  ["DEL", 7, 0x4c],
  ["PG_DN", 7, 0x4e],
  ["INS", 7, 0x49],
  ["RIGHT", 7, 0x4f],
  ["LEFT", 7, 0x50],
  ["DOWN", 7, 0x51],
  ["UP", 7, 0x52],
  ["KP_MULTIPLY", 7, 0x55],
  ["KP_SUBTRACT", 7, 0x56],
  ["KP_DIVIDE", 7, 0x54],
  ["LEFT_COMMAND", 7, 0xe3],
  ["LEFT_WIN", 7, 0xe3],
  ["RIGHT_COMMAND", 7, 0xe7],
  ["C_PP", 12, 0xcd],
  ["C_PREV", 12, 0xb6],
  ["C_VOL_UP", 12, 0xe9],
  ["C_VOL_DN", 12, 0xea],
  ["K_VOLUME_UP", 12, 0xe9],
  ["K_VOLUME_DOWN", 12, 0xea],
];
// Short modifier aliases LCTRL/LSHFT/...
ALIASES.push(
  ["LCTRL", 7, 0xe0],
  ["LSHFT", 7, 0xe1],
  ["LSHIFT", 7, 0xe1],
  ["LALT", 7, 0xe2],
  ["LGUI", 7, 0xe3],
  ["RCTRL", 7, 0xe4],
  ["RSHFT", 7, 0xe5],
  ["RSHIFT", 7, 0xe5],
  ["RALT", 7, 0xe6],
  ["RGUI", 7, 0xe7]
);
// Short number aliases N1..N9, N0
for (let i = 0; i < 9; i++) ALIASES.push([`N${i + 1}`, 7, 0x1e + i]);
ALIASES.push(["N0", 7, 0x27]);

export const NAME_TO_USAGE: Record<string, number> = {};
export const USAGE_TO_NAME: Record<number, string> = {};

function register(name: string, usage: number) {
  NAME_TO_USAGE[name] = usage;
  // First definition wins for the reverse map (keeps canonical names).
  if (USAGE_TO_NAME[usage] === undefined) {
    USAGE_TO_NAME[usage] = name;
  }
}

for (const [name, page, id] of CANONICAL) {
  register(name, hid_usage_from_page_and_id(page, id));
}
for (const [name, page, id] of ALIASES) {
  register(name, hid_usage_from_page_and_id(page, id));
}

// --- Single-token shifted symbols (their usage carries the LS bit) ---------
// e.g. PLUS == LS(EQUAL). Registered with the full modified usage so both the
// forward parse and the reverse map round-trip the single token.
const SHIFTED: Array<[name: string, baseName: string]> = [
  ["EXCLAMATION", "NUMBER_1"],
  ["AT_SIGN", "NUMBER_2"],
  ["HASH", "NUMBER_3"],
  ["DOLLAR", "NUMBER_4"],
  ["PERCENT", "NUMBER_5"],
  ["CARET", "NUMBER_6"],
  ["AMPERSAND", "NUMBER_7"],
  ["ASTERISK", "NUMBER_8"],
  ["LEFT_PARENTHESIS", "NUMBER_9"],
  ["RIGHT_PARENTHESIS", "NUMBER_0"],
  ["UNDERSCORE", "MINUS"],
  ["PLUS", "EQUAL"],
  ["LEFT_BRACE", "LEFT_BRACKET"],
  ["RIGHT_BRACE", "RIGHT_BRACKET"],
  ["PIPE", "BACKSLASH"],
  ["COLON", "SEMICOLON"],
  ["DOUBLE_QUOTES", "SINGLE_QUOTE"],
  ["TILDE", "GRAVE"],
  ["LESS_THAN", "COMMA"],
  ["GREATER_THAN", "PERIOD"],
  ["QUESTION", "SLASH"],
];
for (const [name, base] of SHIFTED) {
  const full = NAME_TO_USAGE[base] | (MOD_BIT.LS << 24);
  register(name, full);
}

export class UnknownUsageError extends Error {
  constructor(public usage: number) {
    super(`No ZMK keycode name for usage 0x${usage.toString(16).toUpperCase()}`);
    this.name = "UnknownUsageError";
  }
}

/** Author helper: ZMK mnemonic -> HID usage. Throws on unknown name. */
export function usage(name: string): number {
  const u = keycodeUsage(name);
  if (u === undefined) {
    throw new Error(`Unknown keycode name: ${name}`);
  }
  return u;
}

/**
 * Forward parse a single keycode token to its HID usage, including recursive
 * modifier wrappers like `LG(SPACE)` / `LG(LS(NUMBER_4))` / `RC(TAB)`.
 * Returns undefined for names not in the table (caller treats as "can't parse").
 */
export function keycodeUsage(token: string): number | undefined {
  token = token.trim();
  const m = /^(LC|LS|LA|LG|RC|RS|RA|RG)\((.+)\)$/.exec(token);
  if (m) {
    const inner = keycodeUsage(m[2]);
    if (inner === undefined) return undefined;
    return inner | (MOD_BIT[m[1]] << 24);
  }
  return NAME_TO_USAGE[token];
}

/**
 * Reverse: HID usage -> ZMK mnemonic. Decomposes implicit modifiers into
 * LG()/LS()/... wrappers. NEVER emits raw hex — throws UnknownUsageError so the
 * caller can keep the original source text instead of writing a broken keymap.
 */
export function keycodeName(u: number): string {
  const direct = USAGE_TO_NAME[u];
  if (direct !== undefined) return direct;

  const mod = (u >>> 24) & 0xff;
  const base = u & 0x00ffffff;
  const baseName = USAGE_TO_NAME[base];
  if (mod !== 0 && baseName !== undefined) {
    let name = baseName;
    for (const [bit, fn] of WRAP_ORDER) {
      if (mod & bit) name = `${fn}(${name})`;
    }
    return name;
  }
  throw new UnknownUsageError(u);
}
