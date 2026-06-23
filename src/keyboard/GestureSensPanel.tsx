/**
 * GestureSensPanel.tsx
 *
 * レイヤー×方向別の感度(tick/クールダウン/しきい値)を編集するパネル。
 * GestureBindings のアコーディオン展開部から呼ばれる。
 *
 * 機能:
 * - 接続時に getLayerSens で各方向の値を取得して初期表示
 * - 楽観更新 + 120ms デバウンス送信 + echo 反映（方向選択中の個別スライダー）
 * - 一括適用: 「全方向に適用」「全レイヤーに適用」は確認ダイアログを経由する
 * - ファーム未対応時 (getLayerSens がエラー) は UI を非表示
 */

import { useEffect, useRef, useState } from "react";
import { ValueSlider } from "./ValueSlider";
import { UiButton } from "../misc/ui";
import { ConfirmDialog } from "../misc/ConfirmDialog";
import {
  GestureParam,
  type GestureClient,
  type LayerSens,
} from "../transport/gestureRpc";

// dir: 0=右, 1=左, 2=下, 3=上 (firmware spec)
const DIRS = [3, 2, 1, 0] as const;
const DIR_LABELS: Record<number, string> = { 0: "→ 右", 1: "← 左", 2: "↓ 下", 3: "↑ 上" };

type SensField = "tick" | "waitMs" | "threshold";

const CONTROLS: {
  field: SensField;
  param: GestureParam;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}[] = [
  {
    field: "tick",
    param: GestureParam.Tick,
    label: "感度 (tick)",
    hint: "大きいほど強く弾く必要がある。誤爆が減るが鈍くなる",
    min: 10,
    max: 400,
    step: 5,
  },
  {
    field: "waitMs",
    param: GestureParam.WaitMs,
    label: "クールダウン (wait-ms)",
    hint: "1回発火後、次まで待つ時間。クールダウンを上げると連続発火を抑制（F11連打対策に有効）",
    min: 0,
    max: 2000,
    step: 25,
    unit: "ms",
  },
  {
    field: "threshold",
    param: GestureParam.Threshold,
    label: "しきい値 (threshold)",
    hint: "この値未満の微小な動きは無視する",
    min: 0,
    max: 50,
    step: 1,
  },
];

// レイヤー別の全方向感度: dir → LayerSens
export type DirSensMap = Record<number, LayerSens>;

export interface GestureSensPanelProps {
  /** 表示中のレイヤー ID */
  layerId: number;
  /** 全設定済みレイヤー ID (一括適用 "全レイヤー" に使う) */
  allLayerIds: number[];
  client: GestureClient;
  /** 外部から初期値を注入。undefined = まだ取得中 */
  sensByDir: DirSensMap | undefined;
  /** 感度取得後に親へ通知 (キャッシュ保持用) */
  onFetched: (layerId: number, map: DirSensMap) => void;
  /** 左の十字で選択中の方向 (null = 未選択)。選んだ方向の感度だけ表示する。 */
  selectedDir: number | null;
}

/** 確認待ちの一括操作の種類と対象値 */
type PendingBulkOp =
  | { kind: "allDirs"; param: GestureParam; field: SensField; value: number }
  | { kind: "allLayers"; param: GestureParam; field: SensField; value: number };

export function GestureSensPanel({
  layerId,
  allLayerIds,
  client,
  sensByDir,
  onFetched,
  selectedDir,
}: GestureSensPanelProps) {
  // supported=null → 確認中, false → 非対応, true → 対応
  const [supported, setSupported] = useState<boolean | null>(null);

  // ローカル楽観値: dir → LayerSens (sensByDir が来たら同期)
  const [local, setLocal] = useState<DirSensMap>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const clientRef = useRef<GestureClient>(client);
  useEffect(() => { clientRef.current = client; }, [client]);

  // ---- 確認ダイアログ状態 -----------------------------------------------------
  const [pendingOp, setPendingOp] = useState<PendingBulkOp | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  // 展開時に感度を取得
  useEffect(() => {
    let ignore = false;
    if (sensByDir) {
      // 既にキャッシュ済み
      setLocal({ ...sensByDir });
      setSupported(true);
      return;
    }

    (async () => {
      try {
        const map: DirSensMap = {};
        for (const dir of DIRS) {
          const s = await clientRef.current.getLayerSens(layerId, dir);
          map[dir] = s;
        }
        if (ignore) return;
        setLocal(map);
        setSupported(true);
        onFetched(layerId, map);
      } catch {
        if (!ignore) setSupported(false);
      }
    })();

    return () => { ignore = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerId]);

  // sensByDir が親から更新されたら同期 (一括適用でecho反映時など)
  useEffect(() => {
    if (sensByDir) setLocal({ ...sensByDir });
  }, [sensByDir]);

  useEffect(() => {
    const t = timers.current;
    return () => { Object.values(t).forEach(clearTimeout); };
  }, []);

  // ---- 個別変更 (楽観更新 + デバウンス) — リアルタイム即時 --------------------

  function onChange(dir: number, field: SensField, param: GestureParam, value: number) {
    // 楽観更新
    setLocal((prev) => ({
      ...prev,
      [dir]: { ...(prev[dir] ?? defaultSens(layerId, dir)), [field]: value },
    }));

    const key = `${layerId}:${dir}:${param}`;
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(async () => {
      try {
        const applied = await clientRef.current.setLayerSens(layerId, dir, param, value);
        setLocal((prev) => {
          const next = { ...prev, [dir]: applied };
          // setLocal のコールバック内で最新の prev を使って親キャッシュを更新
          onFetched(layerId, next);
          return next;
        });
      } catch {
        // サイレント失敗 (次の操作で上書き)
      }
    }, 120);
  }

  // ---- 一括適用の実行 (確認 OK 後に呼ばれる) ----------------------------------

  async function executeBulk(op: PendingBulkOp) {
    setBulkBusy(true);
    try {
      if (op.kind === "allDirs") {
        // 各方向の RPC 結果(applied)を収集して refreshed を組み立てる
        const refreshed: DirSensMap = {};
        for (const dir of DIRS) {
          try {
            const applied = await clientRef.current.setLayerSens(layerId, dir, op.param, op.value);
            refreshed[dir] = applied;
          } catch { /* noop — 失敗方向は refreshed に含めない */ }
        }
        // setLocal と親への通知を一括で行う
        setLocal((prev) => {
          const next = { ...prev, ...refreshed };
          onFetched(layerId, next);
          return next;
        });
      } else {
        // allLayers
        for (const lyr of allLayerIds) {
          for (const dir of DIRS) {
            try {
              const applied = await clientRef.current.setLayerSens(lyr, dir, op.param, op.value);
              if (lyr === layerId) {
                setLocal((prev) => ({ ...prev, [dir]: applied }));
              }
              onFetched(lyr, {}); // キャッシュ無効化 → 次展開時に再取得
            } catch { /* noop */ }
          }
        }
      }
    } finally {
      setBulkBusy(false);
      setPendingOp(null);
    }
  }

  // ---- リセット ---------------------------------------------------------------

  async function resetDir(dir: number) {
    try {
      const applied = await clientRef.current.resetLayerSens(layerId, dir);
      setLocal((prev) => {
        const next = { ...prev, [dir]: applied };
        onFetched(layerId, next);
        return next;
      });
    } catch { /* noop */ }
  }

  // ---- 確認ダイアログの本文 ----------------------------------------------------

  function buildConfirmMessage(op: PendingBulkOp): string {
    const label = CONTROLS.find((c) => c.param === op.param)?.label ?? op.param.toString();
    if (op.kind === "allDirs") {
      return `このレイヤーの全方向（↑↓←→）の「${label}」を ${op.value} に変更します。よろしいですか？`;
    }
    return `全レイヤーの全方向（↑↓←→）の「${label}」を ${op.value} に変更します。よろしいですか？`;
  }

  // ---- 描画ガード -------------------------------------------------------------

  if (supported === null) {
    return <div className="text-xs text-muted py-1">感度データを読み込み中…</div>;
  }
  if (supported === false) {
    return null; // 非対応ファームでは感度UIを出さない
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-md border border-border bg-base-200/60 px-3 py-3">
      <div className="text-xs font-semibold text-base-content/70 uppercase tracking-wide">
        方向別感度
      </div>

      {/* 左の十字で方向を選んだときだけ、その方向の感度を表示 */}
      {selectedDir === null ? (
        <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-base-content/50">
          左の十字で方向（↑↓←→）をクリックすると、その方向の感度がここに出ます。
        </div>
      ) : !local[selectedDir] ? (
        <div className="text-xs text-muted py-1">感度を読み込み中…</div>
      ) : (
        (() => {
          const dir = selectedDir;
          const s = local[dir]!;
          return (
            <div className="flex flex-col gap-2 rounded-md border border-border bg-base-100 px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-base-content/70">
                  {DIR_LABELS[dir]} の感度
                </span>
                <UiButton variant="ghost" size="xs" onClick={() => resetDir(dir)}>
                  リセット
                </UiButton>
              </div>
              {CONTROLS.map((ctrl) => (
                <ValueSlider
                  key={ctrl.param}
                  label={ctrl.label}
                  hint={ctrl.hint}
                  value={s[ctrl.field]}
                  min={ctrl.min}
                  max={ctrl.max}
                  step={ctrl.step}
                  unit={ctrl.unit}
                  onChange={(v) => onChange(dir, ctrl.field, ctrl.param, v)}
                />
              ))}
            </div>
          );
        })()
      )}

      {/* 一括適用: 特定方向を選択中は出さない（個別調整に集中させる） */}
      {selectedDir === null && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed border-border px-3 py-2">
          <div className="text-xs text-muted">一括適用（各パラメータを全方向に同じ値で設定）</div>
          {CONTROLS.map((ctrl) => {
            // 全方向で最初に取れた値を代表値とする
            const repDir = DIRS.find((d) => local[d] !== undefined);
            const repVal = repDir !== undefined ? (local[repDir]?.[ctrl.field] ?? 0) : 0;
            return (
              <div key={ctrl.param} className="flex items-center gap-2">
                <span className="min-w-[9rem] text-xs text-base-content/70 shrink-0">{ctrl.label}</span>
                <input
                  type="number"
                  className="w-20 rounded border border-border bg-base-100 px-2 py-0.5 text-xs tabular-nums text-base-content focus:outline-none focus:ring-1 focus:ring-primary/50"
                  min={ctrl.min}
                  max={ctrl.max}
                  step={ctrl.step}
                  defaultValue={repVal}
                  onBlur={(e) => {
                    // 入力欄の値は確認ダイアログを開くまで保留。onBlur は値を正規化するだけ。
                    const v = Math.min(ctrl.max, Math.max(ctrl.min, Number(e.target.value)));
                    if (!isNaN(v)) (e.target as HTMLInputElement).value = String(v);
                  }}
                  id={`bulk-input-${ctrl.param}`}
                />
                <UiButton
                  variant="outline"
                  size="xs"
                  disabled={bulkBusy}
                  onClick={() => {
                    const el = document.getElementById(`bulk-input-${ctrl.param}`) as HTMLInputElement | null;
                    const v = el
                      ? Math.min(ctrl.max, Math.max(ctrl.min, Number(el.value)))
                      : repVal;
                    setPendingOp({ kind: "allDirs", param: ctrl.param, field: ctrl.field, value: isNaN(v) ? repVal : v });
                  }}
                >
                  全方向に適用
                </UiButton>
                <UiButton
                  variant="outline"
                  size="xs"
                  disabled={bulkBusy}
                  onClick={() => {
                    const el = document.getElementById(`bulk-input-${ctrl.param}`) as HTMLInputElement | null;
                    const v = el
                      ? Math.min(ctrl.max, Math.max(ctrl.min, Number(el.value)))
                      : repVal;
                    setPendingOp({ kind: "allLayers", param: ctrl.param, field: ctrl.field, value: isNaN(v) ? repVal : v });
                  }}
                >
                  全レイヤーに適用
                </UiButton>
              </div>
            );
          })}
        </div>
      )}

      {/* 確認ダイアログ (一括適用) */}
      <ConfirmDialog
        open={pendingOp !== null}
        title="一括適用の確認"
        message={pendingOp ? buildConfirmMessage(pendingOp) : ""}
        confirmLabel="適用する"
        cancelLabel="キャンセル"
        onConfirm={() => { if (pendingOp) executeBulk(pendingOp); }}
        onCancel={() => { if (!bulkBusy) setPendingOp(null); }}
        busy={bulkBusy}
      />
    </div>
  );
}

// デフォルト感度 (ローカル fallback)
function defaultSens(layer: number, dir: number): LayerSens {
  void layer;
  return { layer, dir, tick: 180, waitMs: dir === 2 ? 300 : 0, threshold: 1 };
}
