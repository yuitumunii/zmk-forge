// ジェスチャー方向割当 UI — 動的レイヤー方式。
// レイヤーが主: listConfiguredLayers() でファームから直接取得し、
// localStorage 推測(guessLayerId)は不要化。
// 未設定レイヤーを UiSelect で選んで [追加] → enableLayer(id) で行追加。
// 各行アコーディオン: ヘッダ=レイヤー名+発動キーChip+enable/disableトグル。
// 展開で GestureCrossPad → getLayerBinding(4方向) / setLayerBinding を呼ぶ。

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import { ConnectionContext } from "../rpc/ConnectionContext";
import {
  connectGestures,
  type GestureClient,
  type LayerBinding,
  GestureParam,
} from "../transport/gestureRpc";
import { GestureCrossPad } from "./GestureCrossPad";
import { GestureSensPanel, type DirSensMap } from "./GestureSensPanel";
import { Chip, UiButton, UiSelect } from "../misc/ui";
import { findActivationKey, type BehaviorMap } from "./gestureLayerMap";
import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import type { BehaviorBinding, Keymap } from "@zmkfirmware/zmk-studio-ts-client/keymap";

// dir: 0=右, 1=左, 2=下, 3=上 (firmware spec)
const DIRS = [3, 2, 1, 0] as const;

// レイヤー別バインディングキャッシュ: layerId → dir → LayerBinding
type LayerBindingMap = Record<number, Record<number, LayerBinding>>;

/** グローバル感度を全レイヤー×全方向に一括適用するコールバックの型。
 *  GestureTuning → TuningModal → GestureBindings.applyGlobalToAllLayers の呼び出しに使う。 */
export type ApplyGlobalFn = (tick: number, waitMs: number, threshold: number) => Promise<void>;

export interface GestureBindingsProps {
  behaviors: GetBehaviorDetailsResponse[];
  layers: { id: number; name: string }[];
  keymap?: Keymap | null;
  /** GestureTuning から呼ばれる一括適用コールバックを登録するための setter */
  onRegisterApplyGlobal?: (fn: ApplyGlobalFn | null) => void;
}

export function GestureBindings({ behaviors, layers, keymap, onRegisterApplyGlobal }: GestureBindingsProps) {
  const { conn } = useContext(ConnectionContext);
  const [client, setClient] = useState<GestureClient | null | undefined>(undefined);

  // ファームに設定済みのレイヤー一覧 { layer, enabled }[]
  const [configuredLayers, setConfiguredLayers] = useState<{ layer: number; enabled: boolean }[]>([]);

  // レイヤー別バインディングキャッシュ
  const [layerBindings, setLayerBindings] = useState<LayerBindingMap>({});

  // レイヤー別感度キャッシュ: layerId → dir → LayerSens
  const [layerSensCache, setLayerSensCache] = useState<Record<number, DirSensMap>>({});

  // 展開中レイヤーid
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // レイヤーごとに「十字で選択中の方向」(null=未選択)。選んだ方向の感度だけ右に出す。
  const [selectedDirByLayer, setSelectedDirByLayer] = useState<Record<number, number | null>>({});

  // 追加UI: 未設定レイヤーから選択
  const [addLayerId, setAddLayerId] = useState<number | "">("");

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const clientRef = useRef<GestureClient | null>(null);
  useEffect(() => { clientRef.current = client ?? null; }, [client]);

  // ---- configuredLayers の最新値を ref で保持 (コールバック内で使うため) ------
  const configuredLayersRef = useRef<{ layer: number; enabled: boolean }[]>([]);
  useEffect(() => { configuredLayersRef.current = configuredLayers; }, [configuredLayers]);

  // ---- グローバル感度一括適用 --------------------------------------------------
  // GestureTuning から呼ばれる。全レイヤー × 4方向 × 3パラメータを setLayerSens で上書き。
  // 適用後はレイヤー感度キャッシュを全クリアし、次回展開時に再取得させる。
  async function applyGlobalToAllLayers(tick: number, waitMs: number, threshold: number): Promise<void> {
    const c = clientRef.current;
    if (!c) return;
    const layers = configuredLayersRef.current;
    for (const { layer } of layers) {
      for (const dir of DIRS) {
        try { await c.setLayerSens(layer, dir, GestureParam.Tick, tick); } catch { /* noop */ }
        try { await c.setLayerSens(layer, dir, GestureParam.WaitMs, waitMs); } catch { /* noop */ }
        try { await c.setLayerSens(layer, dir, GestureParam.Threshold, threshold); } catch { /* noop */ }
      }
    }
    // キャッシュを全クリア → 展開中のパネルが次回 sensByDir=undefined で再取得する
    setLayerSensCache({});
  }

  // ---- onRegisterApplyGlobal: 接続時に登録、切断時に解除 ----------------------
  useEffect(() => {
    if (!onRegisterApplyGlobal) return;
    if (client === undefined) return; // まだ初期化中
    if (client === null) {
      // 非対応ファームまたは切断: コールバック解除
      onRegisterApplyGlobal(null);
      return;
    }
    // client 準備完了: applyGlobalToAllLayers を登録
    onRegisterApplyGlobal(applyGlobalToAllLayers);
    return () => {
      onRegisterApplyGlobal(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client]);

  // behaviors(配列) → BehaviorMap(id→details)
  const behaviorMap: BehaviorMap = useMemo(
    () => Object.fromEntries(behaviors.map((b) => [b.id, b])),
    [behaviors]
  );

  // ---- 接続時の初期取得 ------------------------------------------------------
  useEffect(() => {
    let ignore = false;
    setError(null);
    setClient(undefined);
    setConfiguredLayers([]);
    setLayerBindings({});
    setLayerSensCache({});

    if (!conn) { setClient(null); return; }

    (async () => {
      try {
        const c = await connectGestures(conn);
        if (ignore) return;
        setClient(c);
        if (!c) return;

        // 旧ファームは listConfiguredLayers が新tagでエラーを返すことがある
        try {
          const ls = await c.listConfiguredLayers();
          if (ignore) return;
          setConfiguredLayers(ls);
        } catch {
          // 未対応ファームではレイヤー一覧が空 → 追加ボタンだけ表示
          if (!ignore) setConfiguredLayers([]);
        }
      } catch (e) {
        if (!ignore) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    return () => { ignore = true; };
  }, [conn]);

  // ---- デバウンスタイマー後処理 ------------------------------------------------
  useEffect(() => {
    const t = timers.current;
    return () => { Object.values(t).forEach(clearTimeout); };
  }, []);

  // ---- レイヤー展開時にバインディングを取得 ------------------------------------
  async function fetchLayerBindings(layerId: number) {
    const c = clientRef.current;
    if (!c) return;
    const map: Record<number, LayerBinding> = {};
    for (const dir of DIRS) {
      try {
        const b = await c.getLayerBinding(layerId, dir);
        map[dir] = b;
      } catch {
        // 未実装方向は欠落のまま
      }
    }
    setLayerBindings((prev) => ({ ...prev, [layerId]: map }));
  }

  function toggleExpand(layerId: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(layerId)) {
        next.delete(layerId);
      } else {
        next.add(layerId);
        // まだキャッシュがなければ取得
        if (!layerBindings[layerId]) {
          fetchLayerBindings(layerId);
        }
      }
      return next;
    });
  }

  // ---- レイヤー追加 -----------------------------------------------------------
  async function handleAddLayer() {
    if (addLayerId === "") return;
    const c = clientRef.current;
    if (!c) return;
    setBusy(true);
    setError(null);
    try {
      const result = await c.enableLayer(Number(addLayerId));
      setConfiguredLayers((prev) => {
        // 既存なら更新、なければ追加
        const exists = prev.find((x) => x.layer === result.layer);
        if (exists) return prev.map((x) => x.layer === result.layer ? result : x);
        return [...prev, result];
      });
      setAddLayerId("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  // ---- レイヤー有効/無効トグル -----------------------------------------------
  async function handleToggleLayer(layerId: number, currentEnabled: boolean) {
    const c = clientRef.current;
    if (!c) return;
    setError(null);
    try {
      const result = currentEnabled
        ? await c.disableLayer(layerId)
        : await c.enableLayer(layerId);
      setConfiguredLayers((prev) =>
        prev.map((x) => x.layer === result.layer ? result : x)
      );
      // disabled になったレイヤーは折りたたむ
      if (!result.enabled) {
        setExpanded((prev) => { const n = new Set(prev); n.delete(layerId); return n; });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // ---- バインディング変更(デバウンス) ----------------------------------------
  function onPick(layerId: number, dir: number, b: BehaviorBinding) {
    // 楽観的 UI 更新
    setLayerBindings((prev) => ({
      ...prev,
      [layerId]: {
        ...prev[layerId],
        [dir]: {
          layer: layerId,
          dir,
          behaviorId: b.behaviorId,
          param1: b.param1 ?? 0,
          param2: b.param2 ?? 0,
          enabled: true,
        },
      },
    }));

    const key = `${layerId}:${dir}`;
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => {
      const c = clientRef.current;
      if (!c) return;
      c.setLayerBinding(layerId, dir, b.behaviorId, b.param1 ?? 0, b.param2 ?? 0)
        .then((applied) => {
          setError(null);
          setLayerBindings((prev) => ({
            ...prev,
            [applied.layer]: { ...prev[applied.layer], [applied.dir]: applied },
          }));
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }, 120);
  }

  // ---- 感度キャッシュ更新 (GestureSensPanel コールバック) ----------------------
  function onSensFetched(layerId: number, map: DirSensMap) {
    if (Object.keys(map).length === 0) {
      // キャッシュ無効化 (一括適用後に他レイヤーを再取得させる)
      setLayerSensCache((prev) => { const n = { ...prev }; delete n[layerId]; return n; });
    } else {
      setLayerSensCache((prev) => ({ ...prev, [layerId]: map }));
    }
  }

  // ---- 未設定レイヤー一覧 (追加UI用) ------------------------------------------
  const configuredLayerIds = new Set(configuredLayers.map((x) => x.layer));
  const availableLayers = layers.filter((l) => !configuredLayerIds.has(l.id));

  // =========================================================================
  // ローディング / 未接続ガード
  // =========================================================================

  if (client === undefined) return <Hint text="読み込み中…" />;
  if (client === null) {
    return (
      <Hint text="このファームはジェスチャー割当の変更に未対応です（割当対応ファームを焼くと使えます）。" />
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="rounded bg-error/10 px-2 py-1 text-xs text-error">{error}</div>
      )}

      {/* ---- 設定済みレイヤー一覧 ---- */}
      {configuredLayers.length === 0 && (
        <Hint text="ジェスチャーを設定したいレイヤーを下から追加してください。" />
      )}

      {configuredLayers.map(({ layer: layerId, enabled }) => {
        const layerInfo = layers.find((l) => l.id === layerId);
        const layerName = layerInfo?.name ?? `Layer ${layerId}`;
        const isOpen = expanded.has(layerId);
        const actKey = findActivationKey(keymap, behaviorMap, layerId);
        const bindings = layerBindings[layerId];

        return (
          <div
            key={layerId}
            className="rounded-lg border border-border bg-base-100 overflow-hidden"
          >
            {/* ヘッダ */}
            <div className="flex items-center gap-2 px-3 py-2.5">
              <button
                type="button"
                onClick={() => enabled && toggleExpand(layerId)}
                className="flex flex-1 items-center gap-2 text-left hover:opacity-80 transition-opacity disabled:opacity-40"
                disabled={!enabled}
              >
                {isOpen ? (
                  <ChevronDown className="size-4 shrink-0 text-muted" aria-hidden />
                ) : (
                  <ChevronRight className="size-4 shrink-0 text-muted" aria-hidden />
                )}
                <span className={["text-sm font-semibold", enabled ? "text-base-content" : "text-muted line-through"].join(" ")}>
                  {layerName}
                </span>
                <div className="ml-1 flex items-center gap-2">
                  {actKey ? (
                    <Chip>{actKey.label} で起動</Chip>
                  ) : (
                    <span className="text-xs text-muted">起動キー未特定</span>
                  )}
                </div>
              </button>

              {/* enable/disable トグル */}
              <button
                type="button"
                onClick={() => handleToggleLayer(layerId, enabled)}
                className={[
                  "shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                  enabled
                    ? "bg-primary/15 text-primary hover:bg-error/15 hover:text-error"
                    : "bg-base-300 text-muted hover:bg-primary/15 hover:text-primary",
                ].join(" ")}
                title={enabled ? "ジェスチャーを無効化" : "ジェスチャーを有効化"}
              >
                {enabled ? "有効" : "無効"}
              </button>
            </div>

            {/* 展開部: 広い画面では「割当」と「方向別感度」を横並び2カラムに */}
            {isOpen && enabled && (
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start border-t border-border px-3 py-3">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-base-content/50">
                    方向ごとの割当
                  </div>
                  {bindings ? (
                    <GestureCrossPad
                      bindings={bindings}
                      behaviors={behaviorMap}
                      behaviorsArray={behaviors}
                      layers={layers}
                      onPick={(dir, b) => onPick(layerId, dir, b)}
                      onSelectDir={(dir) =>
                        setSelectedDirByLayer((prev) => ({ ...prev, [layerId]: dir }))
                      }
                    />
                  ) : (
                    <div className="text-xs text-muted py-2">バインディングを読み込み中…</div>
                  )}
                </div>
                <GestureSensPanel
                  layerId={layerId}
                  allLayerIds={configuredLayers.map((x) => x.layer)}
                  client={client}
                  sensByDir={layerSensCache[layerId]}
                  onFetched={onSensFetched}
                  selectedDir={selectedDirByLayer[layerId] ?? null}
                />
              </div>
            )}
          </div>
        );
      })}

      {/* ---- レイヤー追加 UI ---- */}
      {availableLayers.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5">
          <Plus className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="text-sm text-muted shrink-0">ジェスチャーを追加するレイヤー:</span>
          <UiSelect
            className="flex-1 min-w-0"
            value={addLayerId}
            onChange={(e) => setAddLayerId(
              (e.target as HTMLSelectElement).value === "" ? "" : Number((e.target as HTMLSelectElement).value)
            )}
          >
            <option value="" disabled>選択…</option>
            {availableLayers.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </UiSelect>
          <UiButton
            variant="primary"
            size="sm"
            onClick={handleAddLayer}
            disabled={addLayerId === "" || busy}
          >
            追加
          </UiButton>
        </div>
      )}
    </div>
  );
}

function Hint({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center px-3 py-4 text-center text-sm text-base-content/60">
      {text}
    </div>
  );
}
