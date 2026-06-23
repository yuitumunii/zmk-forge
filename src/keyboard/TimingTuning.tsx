// Live &mt/&lt timing tuning UI. Talks to the firmware's pyuron_timing
// custom RPC (see ../transport/timingRpc) so tapping-term / quick-tap / flavor
// can be dialed in without reflashing. Lives under the "Timing" tab.

import { useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../rpc/ConnectionContext";
import {
  connectTiming,
  type TimingClient,
  type HoldTapInfo,
  TimingParam,
} from "../transport/timingRpc";
import { ValueSlider } from "./ValueSlider";
import { UndoRedoContext } from "../undoRedo";
import { OptionCards, UiButton, type OptionCardOption } from "../misc/ui";

type Field = "tappingTermMs" | "quickTapMs";

// Friendly, slider-able view of each tunable parameter.
const CONTROLS: {
  field: Field;
  param: TimingParam;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
}[] = [
  {
    field: "tappingTermMs",
    param: TimingParam.TappingTermMs,
    label: "判定時間 (tapping-term)",
    hint: "短いほどホールド判定が早い。長いと文字が出やすい(ms)",
    min: 80,
    max: 400,
    step: 10,
  },
  {
    field: "quickTapMs",
    param: TimingParam.QuickTapMs,
    label: "連打タップ (quick-tap)",
    hint: "直前タップ後この時間内は必ずタップ扱い(ms)。0=無効",
    min: 0,
    max: 500,
    step: 10,
  },
];

const FLAVOR_OPTIONS: OptionCardOption[] = [
  {
    value: 0,
    label: "ホールド優先",
    description:
      "判定時間が切れる前でも、他のキーを押した瞬間にホールド確定。修飾キー用途向き",
  },
  {
    value: 1,
    label: "バランス",
    description:
      "判定時間内に他のキーを「押して離した」らホールド。迷ったらこれ（標準）",
  },
  {
    value: 2,
    label: "タップ優先",
    description:
      "判定時間が切れるまでは常にタップ。他のキーを押してもタップのまま",
  },
  {
    value: 3,
    label: "割込なしタップ",
    description:
      "判定時間内に他のキーが押された時だけホールド。それ以外はタップ",
  },
];

export function TimingTuning() {
  const { conn } = useContext(ConnectionContext);
  const undoRedo = useContext(UndoRedoContext);
  const [client, setClient] = useState<TimingClient | null | undefined>(undefined);
  const [holdTaps, setHoldTaps] = useState<HoldTapInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Per (id:param) debounce timers so dragging a slider coalesces into one send.
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Live client handle read at fire-time.
  const clientRef = useRef<TimingClient | null>(null);
  // Track drag-start value keyed by `${id}:${field}`.
  const dragStartRef = useRef<Record<string, number>>({});
  // Snapshot of holdTaps taken at connection time — used for "接続時に戻す".
  const snapshotRef = useRef<HoldTapInfo[]>([]);

  useEffect(() => {
    clientRef.current = client ?? null;
  }, [client]);

  useEffect(() => {
    let ignore = false;
    setError(null);
    setClient(undefined);
    setHoldTaps([]);
    snapshotRef.current = [];

    if (!conn) {
      setClient(null);
      return;
    }

    (async () => {
      try {
        const c = await connectTiming(conn);
        if (ignore) return;
        setClient(c);
        if (c) {
          const initial = await c.list();
          if (!ignore) {
            snapshotRef.current = initial;
            setHoldTaps(initial);
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

  // Flush any pending debounce timers on unmount.
  useEffect(() => {
    const t = timers.current;
    return () => {
      Object.values(t).forEach(clearTimeout);
    };
  }, []);

  function onSlide(id: number, field: Field, param: TimingParam, value: number) {
    const dragKey = `${id}:${field}`;

    // Record the value at drag-start once per drag session.
    if (dragStartRef.current[dragKey] === undefined) {
      const current = holdTaps.find((h) => h.id === id);
      if (current != null) {
        dragStartRef.current[dragKey] = current[field];
      }
    }

    // Optimistic local update so the slider feels instant.
    setHoldTaps((hs) => hs.map((h) => (h.id === id ? { ...h, [field]: value } : h)));

    const timerKey = `${id}:${param}`;
    clearTimeout(timers.current[timerKey]);
    timers.current[timerKey] = setTimeout(() => {
      const c = clientRef.current;
      if (!c) return;

      const oldValue = dragStartRef.current[dragKey];
      delete dragStartRef.current[dragKey];

      const doSend = async (v: number) => {
        const applied = await c.setParam(id, param, v);
        setError(null);
        setHoldTaps((hs) =>
          hs.map((h) => (h.id === id ? { ...h, [field]: applied[field] } : h))
        );
        return applied;
      };

      if (undoRedo != null && oldValue !== undefined && oldValue !== value) {
        undoRedo(async () => {
          await doSend(value);
          return async () => {
            await doSend(oldValue);
            setHoldTaps((hs) =>
              hs.map((h) => (h.id === id ? { ...h, [field]: oldValue } : h))
            );
          };
        }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
      } else {
        doSend(value).catch((e) => setError(e instanceof Error ? e.message : String(e)));
      }
    }, 120);
  }

  function onFlavor(id: number, value: number) {
    const current = holdTaps.find((h) => h.id === id);
    const oldFlavor = current?.flavor;

    // Optimistic local update.
    setHoldTaps((hs) => hs.map((h) => (h.id === id ? { ...h, flavor: value } : h)));

    const c = clientRef.current;
    if (!c) return;

    const doSet = async (v: number) => {
      const applied = await c.setParam(id, TimingParam.Flavor, v);
      setError(null);
      setHoldTaps((hs) =>
        hs.map((h) => (h.id === id ? { ...h, flavor: applied.flavor } : h))
      );
      return applied;
    };

    if (undoRedo != null && oldFlavor !== undefined && oldFlavor !== value) {
      undoRedo(async () => {
        await doSet(value);
        return async () => {
          await doSet(oldFlavor);
          setHoldTaps((hs) =>
            hs.map((h) => (h.id === id ? { ...h, flavor: oldFlavor } : h))
          );
        };
      }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    } else {
      doSet(value).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }
  }

  function onReset(id: number) {
    const c = clientRef.current;
    if (!c) return;

    const snap = snapshotRef.current.find((h) => h.id === id);
    const oldState = holdTaps.find((h) => h.id === id);

    // If no snapshot exists, fall back to firmware reset.
    if (!snap) {
      const doReset = async () => {
        const applied = await c.reset(id);
        setError(null);
        setHoldTaps((hs) => hs.map((h) => (h.id === id ? applied : h)));
        return applied;
      };
      doReset().catch((e) => setError(e instanceof Error ? e.message : String(e)));
      return;
    }

    const doRestoreToSnapshot = async () => {
      await c.setParam(id, TimingParam.TappingTermMs, snap.tappingTermMs);
      await c.setParam(id, TimingParam.QuickTapMs, snap.quickTapMs);
      const applied = await c.setParam(id, TimingParam.Flavor, snap.flavor);
      setError(null);
      setHoldTaps((hs) => hs.map((h) => (h.id === id ? { ...h, ...snap } : h)));
      return applied;
    };

    if (undoRedo != null && oldState != null) {
      undoRedo(async () => {
        await doRestoreToSnapshot();
        return async () => {
          await c.setParam(id, TimingParam.TappingTermMs, oldState.tappingTermMs);
          await c.setParam(id, TimingParam.QuickTapMs, oldState.quickTapMs);
          await c.setParam(id, TimingParam.Flavor, oldState.flavor);
          setError(null);
          setHoldTaps((hs) => hs.map((h) => (h.id === id ? oldState : h)));
        };
      }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    } else {
      doRestoreToSnapshot().catch((e) => setError(e instanceof Error ? e.message : String(e)));
    }
  }

  if (client === undefined) {
    return <Hint text="読み込み中…" />;
  }

  if (client === null) {
    return (
      <Hint text="このファームはタイミングのライブ調整に未対応です。タイミング調整対応ファーム (timing-rpc) を焼くと、ここで二役キーの押し分けを変えられます。" />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded bg-error/10 px-2 py-1 text-xs text-error">{error}</div>
      )}
      <p className="text-[13px] leading-snug text-base-content/70">
        二役キー（Mod-Tap / Layer-Tap）の押し分けをその場で変更できます（焼き直し不要）。値は再起動後も保持されます。
      </p>

      {holdTaps.length === 0 && <Hint text="ホールドタップ処理が見つかりません。" />}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-3 items-start">
      {holdTaps.map((h) => (
        <div
          key={h.id}
          className="flex flex-col gap-3 rounded-lg border border-base-300 bg-base-100 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-base font-semibold text-base-content">
              {h.name}
            </span>
            <UiButton
              variant="outline"
              size="xs"
              onClick={() => onReset(h.id)}
            >
              接続時に戻す
            </UiButton>
          </div>

          {CONTROLS.map((c) => (
            <ValueSlider
              key={c.param}
              label={c.label}
              hint={c.hint}
              value={h[c.field]}
              min={c.min}
              max={c.max}
              step={c.step}
              onChange={(v) => onSlide(h.id, c.field, c.param, v)}
            />
          ))}

          {/* Flavor selection with description cards */}
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium leading-tight text-base-content/80">
              フレーバー (flavor)
            </span>
            <OptionCards
              options={FLAVOR_OPTIONS}
              value={h.flavor}
              columns={2}
              onChange={(v) => onFlavor(h.id, v)}
            />
          </div>
        </div>
      ))}
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
