// Reusable slider + number input component.
// Used by TimingTuning, AmlTuning and similar live-tuning panels.

export interface ValueSliderProps {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  onChange: (v: number) => void;
}

export function ValueSlider({
  label,
  hint,
  value,
  min,
  max,
  step,
  unit,
  disabled,
  onChange,
}: ValueSliderProps) {
  function handleNumber(raw: string) {
    const n = parseFloat(raw);
    if (isNaN(n)) return;
    onChange(Math.min(max, Math.max(min, n)));
  }

  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-2 leading-tight">
        <span className="min-w-0 truncate text-sm font-medium text-base-content">
          {label}
        </span>
        <input
          type="number"
          className="w-24 rounded-md border border-base-content/25 bg-base-200 px-2 py-1 text-right text-base tabular-nums text-base-content focus:border-primary focus:outline-none"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => handleNumber(e.target.value)}
        />
        {unit && (
          <span className="shrink-0 text-[13px] text-base-content/60">{unit}</span>
        )}
      </span>
      <input
        type="range"
        className="w-full"
        style={{ accentColor: "light-dark(#2e8b67,#4fb08c)" }}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && (
        <span className="text-[13px] leading-snug text-base-content/60">{hint}</span>
      )}
    </label>
  );
}
