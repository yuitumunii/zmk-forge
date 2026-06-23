/**
 * GestureCrossPad.tsx
 *
 * Logi Options風の十字(3×3グリッド)でジェスチャー方向割当を編集するUI。
 * 上=上/左=左/中央アイコン/右=右/下=下 の空間配置。
 * 各セルをクリックするとBehaviorBindingPickerがグリッド下にインライン展開する。
 */

import { useState } from "react";
import { MousePointerClick } from "lucide-react";
import { BehaviorBindingPicker } from "../behaviors/BehaviorBindingPicker";
import { getKeyLabelContent } from "./Keymap";
import type { GestureBinding, GestureInfo, LayerBinding } from "../transport/gestureRpc";
import type { BehaviorBinding } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import type { BehaviorMap } from "./gestureLayerMap";

// dir: 0=右, 1=左, 2=下, 3=上  (firmware spec)
const DIRECTIONS = [
  { dir: 3, label: "↑ 上", gridClass: "col-start-2 row-start-1" },
  { dir: 1, label: "← 左",  gridClass: "col-start-1 row-start-2" },
  { dir: 0, label: "→ 右",  gridClass: "col-start-3 row-start-2" },
  { dir: 2, label: "↓ 下", gridClass: "col-start-2 row-start-3" },
] as const;

/** bindings に使える両方の型を受け付けるユーティリティ型。
 *  GestureBinding (id付き旧方式) と LayerBinding (layer付き新方式) の共通部分のみ使う。 */
type AnyBinding = Pick<GestureBinding, "behaviorId" | "param1" | "param2"> |
                  Pick<LayerBinding, "behaviorId" | "param1" | "param2">;

export interface GestureCrossPadProps {
  /** 旧方式(instance列挙)では必要。動的レイヤー方式では不要なので optional。 */
  gesture?: GestureInfo;
  bindings: Record<number, AnyBinding> | undefined;
  behaviors: BehaviorMap;
  behaviorsArray: GetBehaviorDetailsResponse[];
  layers: { id: number; name: string }[];
  onPick: (dir: number, b: BehaviorBinding) => void;
  /** 方向セルを選択/解除したときに通知 (右の方向別感度の表示切替に使う)。 */
  onSelectDir?: (dir: number | null) => void;
}

export function GestureCrossPad({
  bindings,
  behaviors,
  behaviorsArray,
  layers,
  onPick,
  onSelectDir,
}: GestureCrossPadProps) {
  const [editingDir, setEditingDir] = useState<number | null>(null);

  // 各方向の割当を「実際のキー/ショートカット」で表示する(behavior名"Key Press"ではなく
  // getKeyLabelContent.children = 実キーのラベルノード)。header(動作名)は小さく副題に。
  function renderCell(dir: number) {
    const gb = bindings?.[dir];
    if (!gb) return <span className="text-muted">—</span>;
    const binding = { behaviorId: gb.behaviorId, param1: gb.param1, param2: gb.param2 };
    const behavior = behaviors[gb.behaviorId];
    if (!behavior) return <span className="text-muted">—</span>;
    const { header, children } = getKeyLabelContent(binding, behaviors, layers);
    return (
      <span className="flex flex-col leading-tight">
        <span className="text-xs font-medium text-base-content truncate">{children}</span>
        <span className="text-[10px] text-base-content/50 truncate">{header}</span>
      </span>
    );
  }

  function handleCellClick(dir: number) {
    setEditingDir((prev) => {
      const next = prev === dir ? null : dir;
      onSelectDir?.(next);
      return next;
    });
  }

  const editingGb = editingDir !== null ? bindings?.[editingDir] : undefined;
  const editingBinding: BehaviorBinding | undefined = editingGb
    ? { behaviorId: editingGb.behaviorId, param1: editingGb.param1, param2: editingGb.param2 }
    : undefined;

  return (
    <div className="flex flex-col gap-3">
      {/* 3×3 十字グリッド */}
      <div className="grid grid-cols-3 grid-rows-3 gap-2">
        {DIRECTIONS.map(({ dir, label, gridClass }) => {
          const isEditing = editingDir === dir;
          return (
            <button
              key={dir}
              type="button"
              onClick={() => handleCellClick(dir)}
              className={[
                gridClass,
                "min-h-14 rounded-md border p-2 text-left transition-colors cursor-pointer",
                isEditing
                  ? "border-primary bg-primary/10"
                  : "border-border bg-base-100 hover:border-primary/50 hover:bg-base-200 hover:shadow-sm",
              ].join(" ")}
            >
              <div className="text-[11px] font-semibold text-base-content/50 mb-0.5">
                {label}
              </div>
              <div className="text-xs text-base-content truncate">
                {renderCell(dir)}
              </div>
            </button>
          );
        })}

        {/* 中央セル: アイコン */}
        <div className="col-start-2 row-start-2 flex items-center justify-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-base-200">
            <MousePointerClick className="size-5 text-muted" aria-hidden />
          </div>
        </div>

        {/* 四隅: 空セル（グリッドの歯抜けを埋める） */}
        <div className="col-start-1 row-start-1" />
        <div className="col-start-3 row-start-1" />
        <div className="col-start-1 row-start-3" />
        <div className="col-start-3 row-start-3" />
      </div>

      {/* BehaviorBindingPicker: 編集中の方向に対してグリッド下にインライン展開 */}
      {editingDir !== null && (
        <div className="rounded-md border border-primary/30 bg-base-100 p-3">
          <div className="text-xs font-semibold text-primary mb-2">
            {DIRECTIONS.find((d) => d.dir === editingDir)?.label} の割当を変更
          </div>
          {editingBinding ? (
            <BehaviorBindingPicker
              binding={editingBinding}
              behaviors={behaviorsArray}
              layers={layers}
              onBindingChanged={(nb) => {
                onPick(editingDir, nb);
              }}
            />
          ) : (
            <div className="text-xs text-muted">バインディングを読み込み中…</div>
          )}
        </div>
      )}
    </div>
  );
}
