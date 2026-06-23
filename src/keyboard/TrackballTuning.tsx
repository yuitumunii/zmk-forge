// Live trackball CPI tuning UI. Talks to the firmware's pyuron_cpi custom
// RPC (see ../transport/cpiRpc) so CPI can be dialed with a slider without
// reflashing. Also exposes cursor invert (X/Y) via cpiRpc.setInvert and
// scroll invert (V/H) via the separate pyuron_scroll subsystem (scrollRpc).
// Lives under the "トラボ" tab in ConfigPanel.
//
// Note: on a split keyboard, Studio RPC reaches the central (right) half only.
// Live CPI therefore affects trackball_R. Left trackball is a future task.

import { useContext, useEffect, useRef, useState } from "react";
import { ConnectionContext } from "../rpc/ConnectionContext";
import {
  connectCpi,
  type CpiClient,
  type CpiInfo,
} from "../transport/cpiRpc";
import {
  connectScroll,
  type ScrollClient,
  type ScrollInfo,
} from "../transport/scrollRpc";
import {
  connectSpeed,
  type SpeedClient,
  type SpeedInfo,
} from "../transport/speedRpc";
import { ValueSlider } from "./ValueSlider";
import { UndoRedoContext } from "../undoRedo";
import { ToggleSwitch, UiButton } from "../misc/ui";

// Strip trailing "@<digits>" added by Zephyr devicetree node names.
function prettyName(name: string): string {
  return name.replace(/@\d+$/, "");
}

export function TrackballTuning() {
  const { conn } = useContext(ConnectionContext);
  const undoRedo = useContext(UndoRedoContext);
  const [client, setClient] = useState<CpiClient | null | undefined>(undefined);
  const [sensors, setSensors] = useState<CpiInfo[]>([]);
  const [scrollClient, setScrollClient] = useState<ScrollClient | null | undefined>(undefined);
  const [scrollInfo, setScrollInfo] = useState<ScrollInfo | null>(null);
  const [speedClient, setSpeedClient] = useState<SpeedClient | null | undefined>(undefined);
  const [speedInfo, setSpeedInfo] = useState<SpeedInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Per-sensor debounce timers so dragging a slider coalesces into one send.
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});
  // Live client handle read at fire-time to avoid stale closure issues.
  const clientRef = useRef<CpiClient | null>(null);
  const scrollClientRef = useRef<ScrollClient | null>(null);
  const speedClientRef = useRef<SpeedClient | null>(null);
  const speedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const speedDragStart = useRef<number | undefined>(undefined);
  // Per-sensor "value before this drag started" – captured when the timer is
  // absent (i.e. at drag-start) and cleared after the debounce fires.
  const prevCpiRef = useRef<Record<number, number>>({});

  // ---- connection-time snapshots (for "接続時に戻す") -------------------------
  // Captured once per conn on the first successful list()/get() call.
  const initSensorsRef = useRef<CpiInfo[] | null>(null);
  const initScrollRef = useRef<ScrollInfo | null>(null);
  const initSpeedRef = useRef<SpeedInfo | null>(null);

  useEffect(() => {
    clientRef.current = client ?? null;
  }, [client]);

  useEffect(() => {
    scrollClientRef.current = scrollClient ?? null;
  }, [scrollClient]);

  useEffect(() => {
    speedClientRef.current = speedClient ?? null;
  }, [speedClient]);

  useEffect(() => {
    let ignore = false;
    setError(null);
    setClient(undefined);
    setSensors([]);
    setScrollClient(undefined);
    setScrollInfo(null);
    setSpeedClient(undefined);
    setSpeedInfo(null);
    // Reset snapshots on each new connection.
    initSensorsRef.current = null;
    initScrollRef.current = null;
    initSpeedRef.current = null;

    if (!conn) {
      setClient(null);
      setScrollClient(null);
      setSpeedClient(null);
      return;
    }

    (async () => {
      try {
        const c = await connectCpi(conn);
        if (ignore) return;
        setClient(c);
        if (c) {
          const list = await c.list();
          if (!ignore) {
            setSensors(list);
            // Capture initial snapshot (deep copy).
            initSensorsRef.current = list.map((s) => ({ ...s }));
          }
        }
      } catch (e) {
        if (!ignore) setError(e instanceof Error ? e.message : String(e));
      }
    })();

    (async () => {
      try {
        const sc = await connectScroll(conn);
        if (ignore) return;
        setScrollClient(sc);
        if (sc) {
          const info = await sc.get();
          if (!ignore) {
            setScrollInfo(info);
            // Capture initial scroll snapshot.
            initScrollRef.current = { ...info };
          }
        }
      } catch {
        // scroll subsystem is optional — silently mark as unsupported
        if (!ignore) setScrollClient(null);
      }
    })();

    (async () => {
      try {
        const sp = await connectSpeed(conn);
        if (ignore) return;
        setSpeedClient(sp);
        if (sp) {
          const info = await sp.get();
          if (!ignore) {
            setSpeedInfo(info);
            initSpeedRef.current = { ...info };
          }
        }
      } catch {
        if (!ignore) setSpeedClient(null);
      }
    })();

    return () => {
      ignore = true;
    };
  }, [conn]);

  // Flush pending debounce timers on unmount (tab switch etc.).
  useEffect(() => {
    const t = timers.current;
    return () => {
      Object.values(t).forEach(clearTimeout);
      clearTimeout(speedTimer.current);
    };
  }, []);

  function onSlide(id: number, value: number) {
    // Optimistic local update so the slider feels instant.
    setSensors((ss) => ss.map((s) => (s.id === id ? { ...s, cpi: value } : s)));

    // Capture the pre-drag value the first time this drag starts (timer absent).
    if (timers.current[id] === undefined) {
      const current = sensors.find((s) => s.id === id);
      if (current !== undefined) {
        prevCpiRef.current[id] = current.cpi;
      }
    }

    clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(() => {
      delete timers.current[id];
      const c = clientRef.current;
      if (!c) return;

      const newValue = value;
      const oldValue = prevCpiRef.current[id] ?? value;
      delete prevCpiRef.current[id];

      const doSet = async () => {
        const applied = await c.set(id, newValue);
        setError(null);
        setSensors((ss) =>
          ss.map((s) => (s.id === id ? { ...s, cpi: applied.cpi } : s))
        );
        return async () => {
          const restored = await c.set(id, oldValue);
          setError(null);
          setSensors((ss) =>
            ss.map((s) => (s.id === id ? { ...s, cpi: restored.cpi } : s))
          );
        };
      };

      if (undoRedo) {
        undoRedo(doSet).catch((e) =>
          setError(e instanceof Error ? e.message : String(e))
        );
      } else {
        doSet().catch((e) =>
          setError(e instanceof Error ? e.message : String(e))
        );
      }
    }, 120);
  }

  // ---- "接続時に戻す" for CPI + cursor invert (per-sensor) ------------------
  function onResetSensor(id: number) {
    const c = clientRef.current;
    if (!c) return;

    const init = initSensorsRef.current?.find((s) => s.id === id);
    if (!init) return;

    // Capture current state for undo.
    const current = sensors.find((s) => s.id === id);
    const oldCpi = current?.cpi;
    const oldInvertX = current?.invertX ?? false;
    const oldInvertY = current?.invertY ?? false;

    const doReset = async () => {
      // Restore CPI.
      const appliedCpi = await c.set(id, init.cpi);
      setError(null);
      setSensors((ss) =>
        ss.map((s) => (s.id === id ? { ...s, cpi: appliedCpi.cpi } : s))
      );
      // Restore cursor invert.
      const appliedInvert = await c.setInvert(id, init.invertX, init.invertY);
      setError(null);
      setSensors((ss) =>
        ss.map((s) =>
          s.id === id
            ? { ...s, invertX: appliedInvert.invertX, invertY: appliedInvert.invertY }
            : s
        )
      );
      return async () => {
        // Undo: re-apply the values that were active before reset.
        if (oldCpi !== undefined) {
          const res = await c.set(id, oldCpi);
          setSensors((ss) =>
            ss.map((s) => (s.id === id ? { ...s, cpi: res.cpi } : s))
          );
        }
        const res2 = await c.setInvert(id, oldInvertX, oldInvertY);
        setSensors((ss) =>
          ss.map((s) =>
            s.id === id
              ? { ...s, invertX: res2.invertX, invertY: res2.invertY }
              : s
          )
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

  // ---- cursor invert (per-sensor) ------------------------------------------

  function onCursorInvert(id: number, axis: "invertX" | "invertY", value: boolean) {
    const c = clientRef.current;
    if (!c) return;

    const current = sensors.find((s) => s.id === id);
    if (!current) return;
    const oldX = current.invertX;
    const oldY = current.invertY;
    const newX = axis === "invertX" ? value : oldX;
    const newY = axis === "invertY" ? value : oldY;

    // Optimistic local update.
    setSensors((ss) =>
      ss.map((s) => (s.id === id ? { ...s, invertX: newX, invertY: newY } : s))
    );

    const doSet = async (ix: boolean, iy: boolean) => {
      const applied = await c.setInvert(id, ix, iy);
      setError(null);
      setSensors((ss) =>
        ss.map((s) =>
          s.id === id
            ? { ...s, invertX: applied.invertX, invertY: applied.invertY }
            : s
        )
      );
    };

    if (undoRedo) {
      undoRedo(async () => {
        await doSet(newX, newY);
        return async () => {
          await doSet(oldX, oldY);
          setSensors((ss) =>
            ss.map((s) =>
              s.id === id ? { ...s, invertX: oldX, invertY: oldY } : s
            )
          );
        };
      }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    } else {
      doSet(newX, newY).catch((e) =>
        setError(e instanceof Error ? e.message : String(e))
      );
    }
  }

  // ---- scroll invert (device-wide) -----------------------------------------

  function onScrollInvert(axis: "invertV" | "invertH", value: boolean) {
    const sc = scrollClientRef.current;
    if (!sc || !scrollInfo) return;

    const oldV = scrollInfo.invertV;
    const oldH = scrollInfo.invertH;
    const newV = axis === "invertV" ? value : oldV;
    const newH = axis === "invertH" ? value : oldH;

    // Optimistic local update.
    setScrollInfo({ invertV: newV, invertH: newH });

    const doSet = async (iv: boolean, ih: boolean) => {
      const applied = await sc.set(iv, ih);
      setError(null);
      setScrollInfo({ invertV: applied.invertV, invertH: applied.invertH });
    };

    if (undoRedo) {
      undoRedo(async () => {
        await doSet(newV, newH);
        return async () => {
          await doSet(oldV, oldH);
          setScrollInfo({ invertV: oldV, invertH: oldH });
        };
      }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    } else {
      doSet(newV, newH).catch((e) =>
        setError(e instanceof Error ? e.message : String(e))
      );
    }
  }

  // ---- "接続時に戻す" for scroll invert (device-wide) -----------------------
  function onResetScroll() {
    const sc = scrollClientRef.current;
    if (!sc || !scrollInfo) return;

    const init = initScrollRef.current;
    if (!init) return;

    const oldV = scrollInfo.invertV;
    const oldH = scrollInfo.invertH;

    const doReset = async () => {
      const applied = await sc.set(init.invertV, init.invertH);
      setError(null);
      setScrollInfo({ invertV: applied.invertV, invertH: applied.invertH });
      return async () => {
        const res = await sc.set(oldV, oldH);
        setError(null);
        setScrollInfo({ invertV: res.invertV, invertH: res.invertH });
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

  // ---- 速度微調整 (×%) ------------------------------------------------------
  function onSpeedSlide(value: number) {
    if (speedDragStart.current === undefined && speedInfo) {
      speedDragStart.current = speedInfo.percent;
    }
    setSpeedInfo({ percent: value });

    clearTimeout(speedTimer.current);
    speedTimer.current = setTimeout(() => {
      const sp = speedClientRef.current;
      if (!sp) return;
      const oldValue = speedDragStart.current;
      speedDragStart.current = undefined;

      const doSend = async (v: number) => {
        const applied = await sp.set(v);
        setError(null);
        setSpeedInfo(applied);
        return applied;
      };

      if (undoRedo != null && oldValue !== undefined && oldValue !== value) {
        undoRedo(async () => {
          await doSend(value);
          return async () => {
            await doSend(oldValue);
          };
        }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
      } else {
        doSend(value).catch((e) => setError(e instanceof Error ? e.message : String(e)));
      }
    }, 150);
  }

  if (client === undefined) {
    return <Hint text="読み込み中…" />;
  }

  if (client === null) {
    return (
      <Hint text="このファームはトラボ CPI のライブ調整に未対応です。CPI 対応ファーム (live-cpi) を焼くと、ここで速度を変えられます。" />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <div className="rounded bg-error/10 px-2 py-1 text-[13px] text-error">{error}</div>
      )}
      <p className="text-[13px] leading-snug text-base-content/70">
        トラックボールの CPI（カーソル速度）と反転設定をその場で変更できます（焼き直し不要・再起動後も保持）。
      </p>

      {sensors.length === 0 && <Hint text="pmw3610 センサーが見つかりません。" />}

      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-3 items-start">
      {sensors.map((s) => {
        const min = s.min || 200;
        const max = s.max || 3200;
        const step = s.step || 200;
        return (
          <div
            key={s.id}
            className="flex flex-col gap-3 rounded-lg border border-base-300 bg-base-100 p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-base font-semibold text-base-content">
                {prettyName(s.name)}
              </span>
              <UiButton
                variant="ghost"
                size="sm"
                onClick={() => onResetSensor(s.id)}
              >
                接続時に戻す
              </UiButton>
            </div>

            <ValueSlider
              label="CPI（カーソル速度）"
              hint={`大きいほどボール移動量あたり速くなる（${min}〜${max}・${step} 刻み）`}
              value={s.cpi}
              min={min}
              max={max}
              step={step}
              onChange={(v) => onSlide(s.id, v)}
            />

            {/* Cursor invert toggle switches */}
            <div className="flex flex-col gap-2">
              <span className="text-[13px] font-medium leading-tight text-base-content/80">
                カーソル反転
              </span>
              <div className="flex flex-col gap-2 pl-1">
                <ToggleSwitch
                  label="X 反転（左右）"
                  checked={s.invertX}
                  onChange={(v) => onCursorInvert(s.id, "invertX", v)}
                />
                <ToggleSwitch
                  label="Y 反転（上下）"
                  checked={s.invertY}
                  onChange={(v) => onCursorInvert(s.id, "invertY", v)}
                />
              </div>
            </div>
          </div>
        );
      })}

      {/* 速度微調整 (×%) — CPI の200刻みの間を埋める滑らかな速度調整 */}
      {speedClient !== undefined && speedClient !== null && speedInfo !== null && (
        <div className="flex flex-col gap-2 rounded-lg border border-base-300 bg-base-100 p-3">
          <span className="text-base font-semibold text-base-content">
            速度の微調整（倍率）
          </span>
          <p className="text-[13px] leading-snug text-base-content/60">
            CPI はセンサーの仕様で200刻みですが、ここで倍率（％）をかけて間を滑らかに調整できます（100% = 等倍・カーソルのみ／ジェスチャーには影響しません）。
          </p>
          <ValueSlider
            label="速度 (×%)"
            hint="100 を基準に、小さいほど遅く・大きいほど速く"
            value={speedInfo.percent}
            min={10}
            max={300}
            step={5}
            unit="%"
            onChange={(v) => onSpeedSlide(v)}
          />
        </div>
      )}

      {/* Scroll invert section (device-wide, separate subsystem) */}
      {scrollClient !== undefined && scrollClient !== null && scrollInfo !== null && (
        <div className="flex flex-col gap-3 rounded-lg border border-base-300 bg-base-100 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-base font-semibold text-base-content">
              スクロール反転
            </span>
            <UiButton
              variant="ghost"
              size="sm"
              onClick={onResetScroll}
            >
              接続時に戻す
            </UiButton>
          </div>

          <div className="flex flex-col gap-2 pl-1">
            <ToggleSwitch
              label="横スクロール反転"
              checked={scrollInfo.invertH}
              onChange={(v) => onScrollInvert("invertH", v)}
            />
            <ToggleSwitch
              label="縦スクロール反転"
              checked={scrollInfo.invertV}
              onChange={(v) => onScrollInvert("invertV", v)}
            />
          </div>
        </div>
      )}
      </div>

      {/* Show unsupported hint when scroll subsystem is absent */}
      {scrollClient === null && (
        <p className="text-[13px] text-base-content/40">
          ※ スクロール反転はこのファームに未対応です（scroll-rpc 対応ファームで有効になります）。
        </p>
      )}
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
