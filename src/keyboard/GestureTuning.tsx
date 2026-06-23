// Live trackball-gesture tuning UI. Talks to the firmware's pyuron_gesture
// custom RPC (see ../transport/gestureRpc) so tick / wait-ms / threshold can be
// dialed in with sliders without reflashing. Lives under the "ジェスチャー" tab.
//
// 動作仕様(改訂):
//   - スライダー変更はローカル状態(pending)だけを更新。即 RPC 送信しない。
//   - 元値から変わっていたら「適用」ボタンが活性化される。
//   - 「適用」ボタン押下 → 確認ダイアログ → OK で以下を実行:
//       1. setParam で zip_keybind グローバル値(tick/waitMs/threshold)を送信
//       2. onApplyGlobal コールバック経由で全レイヤー×4方向の感度を上書き
//          (GestureBindings が持つロジックを TuningModal 経由で受け取る)
//   - 「接続時に戻す」は即送信(確認なし: 各自の好みに戻す操作なので危険度低)。

import { useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../rpc/ConnectionContext";
import {
  connectGestures,
  type GestureClient,
  type GestureInfo,
  GestureParam,
} from "../transport/gestureRpc";
import { ValueSlider } from "./ValueSlider";
import { UndoRedoContext } from "../undoRedo";
import { UiButton } from "../misc/ui";
import { ConfirmDialog } from "../misc/ConfirmDialog";
import { useToast } from "../misc/toast";
import type { ApplyGlobalFn } from "./GestureBindings";

type Field = "tick" | "waitMs" | "threshold";

// Friendly, slider-able view of each tunable parameter.
const CONTROLS: {
  field: Field;
  param: GestureParam;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
}[] = [
  {
    field: "tick",
    param: GestureParam.Tick,
    label: "感度 (tick)",
    hint: "大きいほど大きく弾く必要。誤爆が減るが鈍くなる",
    min: 10,
    max: 300,
    step: 5,
  },
  {
    field: "waitMs",
    param: GestureParam.WaitMs,
    label: "クールダウン (wait-ms)",
    hint: "1回発火したあと次まで待つ時間 (ms)",
    min: 0,
    max: 1000,
    step: 25,
  },
  {
    field: "threshold",
    param: GestureParam.Threshold,
    label: "しきい値 (threshold)",
    hint: "これ未満の微小な動きは無視する",
    min: 0,
    max: 50,
    step: 1,
  },
];

// The dynamic processor is the single global default; label it plainly so it's
// clear this affects everything (not a device named "dynamic").
function prettyName(name: string): string {
  if (name === "dynamic") return "全体（グローバル）の感度";
  return name.replace(/^zip_keybind_/, "");
}

export interface GestureTuningProps {
  /**
   * GestureBindings が登録する "全レイヤー×全方向一括上書き" 関数。
   * TuningModal 経由で受け取る。null = まだ GestureBindings が client を取得していない。
   */
  onApplyGlobal?: ApplyGlobalFn | null;
}

export function GestureTuning({ onApplyGlobal }: GestureTuningProps) {
  const { conn } = useContext(ConnectionContext);
  const undoRedo = useContext(UndoRedoContext);
  const { toast } = useToast();
  const [client, setClient] = useState<GestureClient | null | undefined>(undefined);

  // ファームから取得した現在値（適用済みの「ground truth」）
  const [gestures, setGestures] = useState<GestureInfo[]>([]);
  // ローカルで編集中の pending 値。スライダーはここを表示する。
  const [pending, setPending] = useState<GestureInfo[]>([]);

  const [error, setError] = useState<string | null>(null);

  // 確認ダイアログ表示中かどうか
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 確認ダイアログを表示するときの対象ジェスチャー id
  const [confirmTargetId, setConfirmTargetId] = useState<number | null>(null);
  // 適用中フラグ（ボタンローディング）
  const [applying, setApplying] = useState(false);

  // Live client handle read at fire-time (reconnect 対応)
  const clientRef = useRef<GestureClient | null>(null);
  // ---- connection-time snapshot (for "接続時に戻す") -----------------------
  const initGesturesRef = useRef<Map<number, GestureInfo> | null>(null);

  useEffect(() => {
    clientRef.current = client ?? null;
  }, [client]);

  useEffect(() => {
    let ignore = false;
    setError(null);
    setClient(undefined);
    setGestures([]);
    setPending([]);
    initGesturesRef.current = null;

    if (!conn) {
      setClient(null);
      return;
    }

    (async () => {
      try {
        const c = await connectGestures(conn);
        if (ignore) return;
        setClient(c);
        if (c) {
          const list = await c.list();
          if (!ignore) {
            setGestures(list);
            setPending(list.map((g) => ({ ...g })));
            // Capture initial snapshot (deep copy).
            const map = new Map<number, GestureInfo>();
            list.forEach((g) => map.set(g.id, { ...g }));
            initGesturesRef.current = map;
          }
        }
      } catch (e) {
        if (!ignore) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => {
      ignore = true;
    };
  }, [conn]);

  // ---- スライダー変更: ローカル pending のみ更新（即 RPC 送信しない）----------

  function onSlide(id: number, field: Field, value: number) {
    setPending((gs) => gs.map((g) => (g.id === id ? { ...g, [field]: value } : g)));
  }

  // ---- pending が ground truth と異なるか判定 ----------------------------------

  function hasPendingChanges(id: number): boolean {
    const g = gestures.find((x) => x.id === id);
    const p = pending.find((x) => x.id === id);
    if (!g || !p) return false;
    return CONTROLS.some((c) => g[c.field] !== p[c.field]);
  }

  // ---- 「適用」ボタン → 確認ダイアログを開く ----------------------------------

  function openConfirm(id: number) {
    setConfirmTargetId(id);
    setConfirmOpen(true);
  }

  // ---- 確認 OK → 実際に適用 ---------------------------------------------------

  async function handleApply() {
    const id = confirmTargetId;
    if (id === null) return;
    const c = clientRef.current;
    if (!c) return;
    const p = pending.find((x) => x.id === id);
    if (!p) return;

    setApplying(true);
    setError(null);
    try {
      // 1. グローバル値(zip_keybind の RAM 値)を setParam で送信
      const applied = await applyGlobalParams(c, id, p);
      // ground truth を更新
      setGestures((gs) =>
        gs.map((g) => (g.id === id ? { ...applied } : g))
      );
      setPending((gs) =>
        gs.map((g) => (g.id === id ? { ...applied } : g))
      );

      // 2. 全レイヤー×全方向にグローバル値を上書き
      if (onApplyGlobal) {
        await onApplyGlobal(p.tick, p.waitMs, p.threshold);
      }

      toast("全レイヤー・全方向の感度を更新しました", { variant: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
      setConfirmOpen(false);
      setConfirmTargetId(null);
    }
  }

  // グローバルパラメータを setParam で送信し、echo された GestureInfo を返す。
  async function applyGlobalParams(
    c: GestureClient,
    id: number,
    p: GestureInfo
  ): Promise<GestureInfo> {
    // undo/redo 対応
    const oldValues = gestures.find((g) => g.id === id);
    const doSet = async () => {
      for (const ctrl of CONTROLS) {
        await c.setParam(id, ctrl.param, p[ctrl.field]);
      }
      setError(null);
      // 返り値はループ最後の echo 値（3パラメータすべて反映済み）
      return async () => {
        if (!oldValues) return;
        for (const ctrl of CONTROLS) {
          const restored = await c.setParam(id, ctrl.param, oldValues[ctrl.field]);
          setGestures((gs) =>
            gs.map((g) => (g.id === id ? { ...g, [ctrl.field]: restored[ctrl.field] } : g))
          );
          setPending((gs) =>
            gs.map((g) => (g.id === id ? { ...g, [ctrl.field]: restored[ctrl.field] } : g))
          );
        }
        setError(null);
      };
    };

    if (undoRedo) {
      // undoRedo は doSet を実行してから undo 関数を保持する高階関数
      // ここでは戻り値を使わず、別途 applied 取得が必要なのでループで取得
      const undoFn = await new Promise<Awaited<ReturnType<typeof doSet>>>((resolve, reject) => {
        undoRedo(async () => {
          const undo = await doSet();
          resolve(undo);
          return undo;
        }).catch(reject);
      });
      void undoFn; // undoRedo 側で管理される
    } else {
      await doSet();
    }

    // 最後に確認取得
    const latest = await c.list();
    const found = latest.find((g) => g.id === id);
    return found ?? p;
  }

  // ---- 「接続時に戻す」 (snapshot restore) — 即送信。確認なし。 ---------------
  function onReset(id: number) {
    const c = clientRef.current;
    if (!c) return;

    const init = initGesturesRef.current?.get(id);
    if (!init) return;

    const current = gestures.find((g) => g.id === id);
    const oldValues = current
      ? { tick: current.tick, waitMs: current.waitMs, threshold: current.threshold }
      : undefined;

    const doReset = async () => {
      await Promise.all(
        CONTROLS.map(async (ctrl) => {
          const initVal = init[ctrl.field];
          const applied = await c.setParam(id, ctrl.param, initVal);
          setGestures((gs) =>
            gs.map((g) =>
              g.id === id ? { ...g, [ctrl.field]: applied[ctrl.field] } : g
            )
          );
          setPending((gs) =>
            gs.map((g) =>
              g.id === id ? { ...g, [ctrl.field]: applied[ctrl.field] } : g
            )
          );
        })
      );
      setError(null);

      return async () => {
        if (!oldValues) return;
        await Promise.all(
          CONTROLS.map(async (ctrl) => {
            const ov = oldValues[ctrl.field];
            const restored = await c.setParam(id, ctrl.param, ov);
            setGestures((gs) =>
              gs.map((g) =>
                g.id === id ? { ...g, [ctrl.field]: restored[ctrl.field] } : g
              )
            );
            setPending((gs) =>
              gs.map((g) =>
                g.id === id ? { ...g, [ctrl.field]: restored[ctrl.field] } : g
              )
            );
          })
        );
        setError(null);
      };
    };

    if (undoRedo) {
      undoRedo(doReset).catch((e) =>
        setError(e instanceof Error ? e.message : String(e))
      );
    } else {
      doReset().catch((e) =>
        setError(e instanceof Error ? e.message : String(e))
      );
    }
  }

  // ---- 確認ダイアログの本文を組み立てる ----------------------------------------

  function buildConfirmMessage(id: number): string {
    const p = pending.find((x) => x.id === id);
    if (!p) return "";
    return (
      `全レイヤー・全方向のジェスチャー感度を次の値で上書きします：\n` +
      `  感度(tick) = ${p.tick}\n` +
      `  クールダウン(wait-ms) = ${p.waitMs} ms\n` +
      `  しきい値(threshold) = ${p.threshold}\n\n` +
      `方向別に個別設定した値もすべて上書きされます。よろしいですか？`
    );
  }

  // ---- rendering -------------------------------------------------------------

  if (client === undefined) {
    return <Hint text="読み込み中…" />;
  }

  if (client === null) {
    return (
      <Hint text="このファームはジェスチャーのライブ調整に未対応です。トラボ調整対応ファーム (live-rpc) を焼くと、ここで感度を変えられます。" />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded bg-error/10 px-2 py-1 text-[13px] text-error">{error}</div>
      )}
      <p className="text-[13px] leading-snug text-base-content/70">
        ここは<strong>マスター値</strong>です。「適用」を押すと<strong>全レイヤー・全方向</strong>の感度をこの値で一括上書きします（焼き直し不要・再起動後も保持）。
      </p>

      {gestures.length === 0 && <Hint text="ジェスチャー処理が見つかりません。" />}

      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3">
        {pending.map((g) => {
          const dirty = hasPendingChanges(g.id);
          return (
            <div
              key={g.id}
              className="flex flex-col gap-3 rounded-lg border border-base-300 bg-base-100 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-base font-semibold text-base-content">
                  {prettyName(g.name)}
                </span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <UiButton
                    variant="ghost"
                    size="sm"
                    onClick={() => onReset(g.id)}
                  >
                    接続時に戻す
                  </UiButton>
                  <UiButton
                    variant="primary"
                    size="sm"
                    onClick={() => openConfirm(g.id)}
                    disabled={!dirty || applying}
                    className={dirty ? "" : "opacity-40"}
                  >
                    {dirty ? "適用" : "適用済み"}
                  </UiButton>
                </div>
              </div>

              {CONTROLS.map((c) => (
                <ValueSlider
                  key={c.param}
                  label={c.label}
                  hint={c.hint}
                  value={g[c.field]}
                  min={c.min}
                  max={c.max}
                  step={c.step}
                  onChange={(v) => onSlide(g.id, c.field, v)}
                />
              ))}
            </div>
          );
        })}
      </div>

      {/* 確認ダイアログ */}
      <ConfirmDialog
        open={confirmOpen}
        title="感度を全レイヤーに適用"
        message={confirmTargetId !== null ? buildConfirmMessage(confirmTargetId) : ""}
        confirmLabel="適用する"
        cancelLabel="キャンセル"
        onConfirm={handleApply}
        onCancel={() => {
          if (!applying) {
            setConfirmOpen(false);
            setConfirmTargetId(null);
          }
        }}
        busy={applying}
      />
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-3 text-center text-sm text-base-content/60">
      {text}
    </div>
  );
}
