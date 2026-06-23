/**
 * gestureLayerMap.ts
 *
 * ジェスチャーの「発動レイヤー」をlocalStorageに永続化するユーティリティ。
 * RPCにlayer情報が無いため、UIで選択したlayerIdをinstance名をキーにして保存する。
 */

import type { Keymap } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import {
  hid_usage_get_label,
  hid_usage_page_and_id_from_usage,
} from "../hid-usages";

// HID usage(layer-tap の param2 = タップキー) を "P" 等の短いキー名へ。
function keyLabelFromUsage(usage: number): string | null {
  if (!usage) return null;
  // eslint-disable-next-line prefer-const -- `id` cannot be extracted as const while `page` is mutated in the same array destructure
  let [page, id] = hid_usage_page_and_id_from_usage(usage);
  page &= 0xff;
  const label = hid_usage_get_label(page, id);
  if (!label) return null;
  return label.replace(/^Keyboard /, "");
}

const LS_KEY = "gestureLayerMap";

export type BehaviorMap = Record<number, GetBehaviorDetailsResponse>;

/** localStorage から gestureLayerMap を取得する */
export function getGestureLayerMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

/** gestureLayerMap にエントリを書き込む */
export function setGestureLayer(name: string, layerId: number): void {
  try {
    const map = getGestureLayerMap();
    map[name] = layerId;
    localStorage.setItem(LS_KEY, JSON.stringify(map));
  } catch {
    // localStorage が使えない環境ではサイレントに無視
  }
}

/**
 * instance名からlayerIdを推測するヒューリスティック。
 * ジェスチャー名を小文字化し、辞書トークンと部分一致させる。
 * 当たった最初のlayer.idを返す。当たらなければundefined。
 */
export function guessLayerId(
  instanceName: string,
  layers: { id: number; name: string }[]
): number | undefined {
  const lower = instanceName.toLowerCase();

  // トークン辞書: [instance名パターン, レイヤー名トークン]
  // ※数字単体("2","3")や "tab"/"page"(英字) は使わない:
  //   "2"/"3" は数字レイヤー名(0〜5)に、"tab" 等は無関係レイヤーに誤マッチするため。
  //   ジェスチャー用レイヤーは日本語名(画面切替/ページ・タブ/スクロール)で識別する。
  const DICT: [string[], string[]][] = [
    // 3本指 → 画面切替(GEST3)
    [["3finger", "3gest", "gest3", "3fin"], ["画面", "切替", "gest3"]],
    // 2本指 / ページナビ → ページ/タブ(GPAGE)
    [["pagenav", "2finger", "2fin", "gpage", "page"], ["ページ", "タブ", "gpage"]],
    // スクロール系
    [["scroll", "scrl"], ["スクロール", "scroll"]],
  ];

  for (const [namePatterns, layerTokens] of DICT) {
    if (namePatterns.some((p) => lower.includes(p))) {
      // layerトークンでレイヤー名を検索
      const matched = layers.find((l) => {
        const lname = l.name.toLowerCase();
        return layerTokens.some((t) => lname.includes(t.toLowerCase()));
      });
      if (matched) return matched.id;
    }
  }
  return undefined;
}

/**
 * layerIdに対応する「発動キー」をbase layerのbindingsから逆引きする。
 * layerId型のparam1を持つbinding（&mo / &lt 等）を探す。
 *
 * @returns { keyPosition, label } | null
 */
export function findActivationKey(
  keymap: Keymap | null | undefined,
  behaviors: BehaviorMap,
  layerId: number | undefined
): { keyPosition: number; label: string } | null {
  if (!keymap || layerId === undefined) return null;

  const baseLayer = keymap.layers[0];
  if (!baseLayer) return null;

  const layerIds = keymap.layers.map((l) => l.id);

  for (let pos = 0; pos < baseLayer.bindings.length; pos++) {
    const b = baseLayer.bindings[pos];
    const behavior = behaviors[b.behaviorId];
    if (!behavior) continue;

    // metadataのparam1 descriptorにlayerId型があり、かつ値が一致するかチェック
    const metadata = behavior.metadata ?? [];
    const hasLayerIdDescriptor = metadata.some((set) =>
      (set.param1 ?? []).some((desc) => {
        if (desc.layerId) return layerIds.includes(b.param1);
        return false;
      })
    );

    if (hasLayerIdDescriptor && b.param1 === layerId) {
      // layer-tap（param2あり）なら param2 がタップキー → 実キー名("P"等)に解決。
      // &mo 等タップキーが無いものはポジション表記にフォールバック。
      const keyName = keyLabelFromUsage(b.param2);
      const label = keyName ?? `pos${pos}`;
      return { keyPosition: pos, label };
    }
  }
  return null;
}
