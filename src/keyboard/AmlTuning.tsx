// Live AutoMouse Layer (AML) tuning UI. Talks to the firmware's pyuron_aml
// custom RPC (see ../transport/amlRpc) so deactivation timeout, prior-idle
// guard, and excluded key positions can be dialed in without reflashing.

import { useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../rpc/ConnectionContext";
import {
  connectAml,
  type AmlClient,
  type AmlConfig,
} from "../transport/amlRpc";
import { PhysicalLayout, type KeyPosition } from "./PhysicalLayout";
import { ValueSlider } from "./ValueSlider";
import { UndoRedoContext } from "../undoRedo";
import { Chip, UiButton } from "../misc/ui";

const SLIDERS = [
  {
    key: "deactivationMs" as const,
    label: "滞在時間 (deactivation)",
    hint: "最後のトラボ動作からマウスレイヤーを抜けるまでの時間 (ms)",
    unit: "ms",
    min: 100,
    max: 5000,
    step: 50,
  },
  {
    key: "priorIdleMs" as const,
    label: "発火ガード (prior-idle)",
    hint: "直前にキー入力がこの時間なかったときだけ、トラボ操作でマウスレイヤーに入る。タイピング中・直後に手が当たって勝手に入るのを防ぐ (ms)。0 = ガードなし（いつでも入る）",
    unit: "ms",
    min: 0,
    max: 2000,
    step: 50,
  },
  {
    key: "extendMs" as const,
    label: "除外キーで延長 (extend)",
    hint: "マウスレイヤー中に除外キー（K・左クリック等）を押すたび、この時間だけ滞在を再延長 (ms)。連打中もレイヤーが切れない。0 = 延長しない",
    unit: "ms",
    min: 0,
    max: 5000,
    step: 50,
  },
];

type SliderField = "deactivationMs" | "priorIdleMs" | "extendMs";

export function AmlTuning({ positions }: { positions?: KeyPosition[] } = {}) {
  const { conn } = useContext(ConnectionContext);
  const undoRedo = useContext(UndoRedoContext);
  const [client, setClient] = useState<AmlClient | null | undefined>(undefined);
  const [config, setConfig] = useState<AmlConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const clientRef = useRef<AmlClient | null>(null);
  // Track the value at drag-start for undo (keyed by field name).
  const dragStartRef = useRef<Partial<Record<SliderField, number>>>({});
  // Snapshot of config taken at connection time — used for "接続時に戻す".
  const snapshotRef = useRef<AmlConfig | null>(null);

  useEffect(() => {
    clientRef.current = client ?? null;
  }, [client]);

  useEffect(() => {
    let ignore = false;
    setError(null);
    setClient(undefined);
    setConfig(null);
    snapshotRef.current = null;

    if (!conn) {
      setClient(null);
      return;
    }

    (async () => {
      try {
        const c = await connectAml(conn);
        if (ignore) return;
        setClient(c);
        if (c) {
          const initial = await c.get();
          if (!ignore) {
            snapshotRef.current = initial;
            setConfig(initial);
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

  useEffect(() => {
    const t = timers.current;
    return () => {
      Object.values(t).forEach(clearTimeout);
    };
  }, []);

  function onSlide(field: SliderField, value: number) {
    // Record drag-start value once per drag session.
    if (dragStartRef.current[field] === undefined && config != null) {
      dragStartRef.current[field] = config[field];
    }

    setConfig((c) => (c ? { ...c, [field]: value } : c));

    clearTimeout(timers.current[field]);
    timers.current[field] = setTimeout(() => {
      const c = clientRef.current;
      if (!c) return;

      const oldValue = dragStartRef.current[field];
      delete dragStartRef.current[field];

      const doSend = async (v: number) => {
        const call =
          field === "deactivationMs"
            ? c.setDeactivation(v)
            : field === "extendMs"
              ? c.setExtend(v)
              : c.setPriorIdle(v);
        const applied = await call;
        setError(null);
        setConfig(applied);
        return applied;
      };

      if (undoRedo != null && oldValue !== undefined && oldValue !== value) {
        undoRedo(async () => {
          await doSend(value);
          return async () => {
            await doSend(oldValue);
            setConfig((cfg) => (cfg ? { ...cfg, [field]: oldValue } : cfg));
          };
        }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
      } else {
        doSend(value).catch((e) => setError(e instanceof Error ? e.message : String(e)));
      }
    }, 150);
  }

  function onToggleExcluded(pos: number) {
    const c = clientRef.current;
    if (!c) return;

    const doToggle = async () => {
      const applied = await c.toggleExcluded(pos);
      setError(null);
      setConfig(applied);
      return applied;
    };

    if (undoRedo != null) {
      undoRedo(async () => {
        await doToggle();
        return async () => {
          // Second toggle reverts the first.
          await doToggle();
        };
      }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    } else {
      doToggle().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }
  }

  function onReset() {
    const c = clientRef.current;
    const snap = snapshotRef.current;
    if (!c || !snap) return;

    const oldConfig = config;

    const doRestoreToSnapshot = async () => {
      // Restore sliders.
      await c.setDeactivation(snap.deactivationMs);
      await c.setExtend(snap.extendMs);
      const restored = await c.setPriorIdle(snap.priorIdleMs);
      // Re-sync excluded positions: toggle symmetric difference.
      const current = restored.excludedPositions;
      const diff = [
        ...snap.excludedPositions.filter((p) => !current.includes(p)),
        ...current.filter((p) => !snap.excludedPositions.includes(p)),
      ];
      let final = restored;
      for (const p of diff) {
        final = await c.toggleExcluded(p);
      }
      setError(null);
      setConfig(final);
      return final;
    };

    if (undoRedo != null && oldConfig != null) {
      undoRedo(async () => {
        await doRestoreToSnapshot();
        return async () => {
          if (!oldConfig) return;
          await c.setDeactivation(oldConfig.deactivationMs);
          await c.setExtend(oldConfig.extendMs);
          const restored = await c.setPriorIdle(oldConfig.priorIdleMs);
          const current = restored.excludedPositions;
          const diff = [
            ...oldConfig.excludedPositions.filter((p) => !current.includes(p)),
            ...current.filter((p) => !oldConfig.excludedPositions.includes(p)),
          ];
          let final = restored;
          for (const p of diff) {
            final = await c.toggleExcluded(p);
          }
          setError(null);
          setConfig(final);
        };
      }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    } else {
      doRestoreToSnapshot().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }
  }

  if (client === undefined) return <Hint text="読み込み中…" />;

  if (client === null) {
    return (
      <Hint text="このファームは AML ライブ調整に未対応です。pyuron_aml RPC 対応ファームを焼くとここで調整できます。" />
    );
  }

  const hasLayout = positions && positions.length > 0;

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded bg-error/10 px-2 py-1 text-xs text-error">{error}</div>
      )}
      <p className="text-[13px] leading-snug text-base-content/70">
        マウスレイヤーの挙動をその場で変更できます（焼き直し不要）。値は再起動後も保持されます。
      </p>

      {/* Sliders */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-5 gap-y-3 rounded-lg border border-base-300 bg-base-100 p-3">
        {SLIDERS.map((s) => (
          <ValueSlider
            key={s.key}
            label={s.label}
            hint={s.hint}
            value={config?.[s.key] ?? s.min}
            min={s.min}
            max={s.max}
            step={s.step}
            unit={s.unit}
            disabled={config == null}
            onChange={(v) => onSlide(s.key, v)}
          />
        ))}
      </div>

      {/* Excluded positions */}
      <div className="flex flex-col gap-2 rounded-lg border border-base-300 bg-base-100 p-3">
        <div className="text-base font-medium text-base-content">
          除外キー（押してもマウスレイヤーを維持）
        </div>
        <p className="text-[13px] text-base-content/60">
          キーボード図のキーをクリックして追加/解除します。除外したキーはマウスレイヤー中に押してもレイヤーが解除されません（クリックキーやスクロールキー向け）。最大16個
        </p>

        {hasLayout ? (
          <>
            {/* Interactive key layout — wrapped in contrast container so bg-base-100 keys are visible */}
            <div className="rounded-lg bg-base-300 p-4 flex justify-center">
              <PhysicalLayout
                positions={positions}
                highlightedPositions={config?.excludedPositions ?? []}
                onPositionClicked={(pos) => onToggleExcluded(pos)}
                oneU={54}
              />
            </div>

            {/* Chip list of currently excluded positions */}
            {config != null && config.excludedPositions.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-1">
                {config.excludedPositions.map((pos) => (
                  <Chip
                    key={pos}
                    onRemove={() => onToggleExcluded(pos)}
                  >
                    {positions[pos]?.header ?? `pos${pos}`}
                  </Chip>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="rounded border border-base-300 bg-base-200 px-3 py-2 text-xs text-base-content/50">
            レイアウト未取得 — キーボードを接続するとここでキーをクリックして除外設定できます
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <UiButton
          variant="outline"
          size="sm"
          disabled={config == null || snapshotRef.current == null}
          onClick={onReset}
        >
          接続時に戻す
        </UiButton>
      </div>
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
