// TuningModal — 調整セクションを中央に覆いかぶさるフローティングパネルとして表示する。
//
// あえて <dialog> を使わない理由:
//   <dialog>.showModal() は背後を inert 化しバックドロップで覆うため、右端の
//   TuningRail がクリック不能になり「レールでセクション切替」が成立しない
//   (レールを押すと外側クリック扱いで閉じるだけ)。さらに dialog への display 系
//   クラス付与で閉じても残る地雷もある。よってバックドロップ無しの固定配置
//   パネルにして、開いている間も右レールをそのまま使えるようにする。
//
// 高さは固定(h-[80vh])。読み込み前後でパネルがリサイズしてチラつくのを防ぐ。
// 常時マウントし visited+hidden で keep-alive(各セクションの RPC 状態を保持)。

import { useState, useEffect, useRef, useContext, useCallback } from "react";
import { X, Undo2, Redo2 } from "lucide-react";
import { UndoControlsContext } from "../undoRedo";
import { GestureTuning } from "./GestureTuning";
import { GestureBindings, type ApplyGlobalFn } from "./GestureBindings";
import { AmlTuning } from "./AmlTuning";
import { TrackballTuning } from "./TrackballTuning";
import { TimingTuning } from "./TimingTuning";
import type { GetBehaviorDetailsResponse } from "@zmkfirmware/zmk-studio-ts-client/behaviors";
import type { Keymap } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { KeyPosition } from "./PhysicalLayout";

export type Section = "gesture" | "aml" | "cpi" | "timing";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "gesture", label: "ジェスチャー" },
  { id: "aml",     label: "AML" },
  { id: "cpi",     label: "トラボ" },
  { id: "timing",  label: "タイミング" },
];

export interface TuningModalProps {
  open: boolean;
  activeSection: Section;
  onClose: () => void;
  behaviors: GetBehaviorDetailsResponse[];
  layers: { id: number; name: string }[];
  positions: KeyPosition[];
  keymap?: Keymap | null;
}

export function TuningModal({
  open,
  activeSection,
  onClose,
  behaviors,
  layers,
  positions,
  keymap,
}: TuningModalProps) {
  const undoControls = useContext(UndoControlsContext);
  // Keep-alive: 一度訪問したセクションは mounted のまま hidden で保持する
  const [visited, setVisited] = useState<Set<Section>>(new Set<Section>());

  // GestureBindings から登録される "全レイヤー一括適用" コールバック。
  // GestureTuning の「適用」ボタンが押されたときに呼ばれる。
  const [applyGlobalFn, setApplyGlobalFn] = useState<ApplyGlobalFn | null>(null);
  const handleRegisterApplyGlobal = useCallback((fn: ApplyGlobalFn | null) => {
    setApplyGlobalFn(() => fn); // fn が関数なので setState には () => fn 形式で渡す
  }, []);

  useEffect(() => {
    if (!open) return;
    setVisited((prev) => {
      if (prev.has(activeSection)) return prev;
      const next = new Set(prev);
      next.add(activeSection);
      return next;
    });
  }, [activeSection, open]);

  const cardRef = useRef<HTMLDivElement>(null);

  // Esc で閉じる + パネル/レール以外の外側クリックで閉じる。
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onDown(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (!t) return;
      // パネル内、または右レール(data-tuning-rail)へのクリックは閉じない
      if (cardRef.current?.contains(t)) return;
      if (t.closest("[data-tuning-rail]")) return;
      onClose();
    }
    document.addEventListener("keydown", onKey);
    // キャプチャ段階で拾い、背後要素(キーマップ等)が反応する前に閉じる
    document.addEventListener("mousedown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [open, onClose]);

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="false"
      className={`fixed left-1/2 top-1/2 z-50 flex max-h-[92vh] w-[78vw] -translate-x-1/2 -translate-y-1/2 flex-col overflow-x-hidden rounded-xl border border-border bg-base-100 p-5 shadow-2xl${
        open ? "" : " hidden"
      }`}
    >
      {/* ヘッダ行: セクション名タイトル + ×（切替は右レールで行う） */}
      <div className="flex items-center justify-between border-b border-border pb-2 mb-3 shrink-0">
        <h2 className="text-base font-semibold text-base-content">
          {SECTIONS.find((s) => s.id === activeSection)?.label}
        </h2>
        <div className="flex items-center gap-1">
          {undoControls && (
            <>
              <button
                type="button"
                onClick={() => undoControls.undo().catch(() => {})}
                disabled={!undoControls.canUndo}
                className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-base-300 hover:text-base-content disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                title="元に戻す (⌘Z)"
                aria-label="元に戻す"
              >
                <Undo2 className="size-4" />
                戻す
              </button>
              <button
                type="button"
                onClick={() => undoControls.redo().catch(() => {})}
                disabled={!undoControls.canRedo}
                className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted hover:bg-base-300 hover:text-base-content disabled:opacity-40 disabled:hover:bg-transparent transition-colors"
                title="やり直し (⌘⇧Z)"
                aria-label="やり直し"
              >
                <Redo2 className="size-4" />
                やり直し
              </button>
              <div className="mx-1 h-5 w-px bg-border" />
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-base-300 hover:text-base-content transition-colors"
            aria-label="閉じる"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* 本体: visited+hidden で keep-alive */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {/* ジェスチャー */}
        {visited.has("gesture") && (
          <div className={activeSection === "gesture" ? "" : "hidden"}>
            <div className="flex flex-col gap-5 text-sm">
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-base-content/50">
                  感度
                </h3>
                <GestureTuning onApplyGlobal={applyGlobalFn} />
              </section>
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-base-content/50">
                  方向ごとの割当
                </h3>
                <GestureBindings
                  behaviors={behaviors}
                  layers={layers}
                  keymap={keymap}
                  onRegisterApplyGlobal={handleRegisterApplyGlobal}
                />
              </section>
              <section className="flex flex-col gap-1.5">
                <p className="text-[13px] leading-snug text-base-content/60">
                  ジェスチャーを呼び出すキーは「Key Config」で変更できます。
                </p>
                <p className="text-[13px] leading-snug text-base-content/60">
                  レイヤー名はレイヤー一覧でダブルクリック編集→Sync で .keymap に反映。
                </p>
              </section>
            </div>
          </div>
        )}

        {/* AML */}
        {visited.has("aml") && (
          <div className={activeSection === "aml" ? "" : "hidden"}>
            <AmlTuning positions={positions} />
          </div>
        )}

        {/* トラボ (CPI) */}
        {visited.has("cpi") && (
          <div className={activeSection === "cpi" ? "" : "hidden"}>
            <TrackballTuning />
          </div>
        )}

        {/* タイミング */}
        {visited.has("timing") && (
          <div className={activeSection === "timing" ? "" : "hidden"}>
            <TimingTuning />
          </div>
        )}
      </div>
    </div>
  );
}
