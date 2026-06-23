// TuningRail — 右端縦タブレール。各項目クリックで TuningModal を開く。

import type { Section } from "./TuningModal";

const RAIL_ITEMS: { id: Section; label: string }[] = [
  { id: "gesture", label: "ジェスチャー" },
  { id: "aml",     label: "AML" },
  { id: "cpi",     label: "トラボ" },
  { id: "timing",  label: "タイミング" },
];

export interface TuningRailProps {
  activeSection: Section | null;
  onSectionChange: (s: Section) => void;
  disabled?: boolean;
}

export function TuningRail({ activeSection, onSectionChange, disabled }: TuningRailProps) {
  return (
    <div
      data-tuning-rail
      className="w-40 shrink-0 h-full bg-base-200 border-l border-border p-2 flex flex-col gap-1"
    >
      <p className="text-2xs font-semibold tracking-wide text-muted px-1 pb-1">
        デバイス調整
      </p>
      {RAIL_ITEMS.map((item) => {
        const isActive = activeSection === item.id;
        return (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            onClick={() => onSectionChange(item.id)}
            className={`relative w-full text-left rounded-md px-2 py-1.5 text-sm transition-colors disabled:opacity-40 ${
              isActive
                ? "bg-base-300 font-medium text-base-content"
                : "text-base-content/70 enabled:hover:bg-base-300 enabled:hover:text-base-content"
            }`}
          >
            {/* アクティブ時の左バー */}
            {isActive && (
              <span
                className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary"
                aria-hidden="true"
              />
            )}
            <span className="pl-1">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}
