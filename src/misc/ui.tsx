// Shared UI primitives — pure Tailwind utilities only (no daisyUI).
// These are the canonical building blocks for all modal/panel UIs in this app.

import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// UiButton
// ---------------------------------------------------------------------------

export interface UiButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "xs";
  children: ReactNode;
}

export function UiButton({
  variant = "ghost",
  size = "sm",
  className = "",
  children,
  ...rest
}: UiButtonProps) {
  const variantCls =
    variant === "primary"
      ? "bg-primary text-primary-content hover:opacity-90 cursor-pointer"
      : variant === "outline"
      ? "border border-base-content/25 text-base-content hover:border-primary hover:text-primary hover:bg-base-200 cursor-pointer"
      : /* ghost */
        "text-base-content/60 hover:bg-base-300 hover:text-base-content cursor-pointer";

  const sizeCls =
    size === "sm"
      ? "px-3 py-1.5 text-sm rounded-md"
      : "px-2 py-1 text-xs rounded";

  return (
    <button
      type="button"
      className={[
        "inline-flex items-center justify-center gap-1 transition-colors",
        "disabled:opacity-40 disabled:cursor-not-allowed",
        variantCls,
        sizeCls,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// ToggleSwitch
// ---------------------------------------------------------------------------

export interface ToggleSwitchProps {
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}

export function ToggleSwitch({
  label,
  checked,
  disabled = false,
  onChange,
}: ToggleSwitchProps) {
  return (
    <label
      className={[
        "flex items-center justify-between gap-3 cursor-pointer",
        disabled ? "opacity-40 cursor-not-allowed" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="text-sm text-base-content select-none">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={[
          "relative inline-flex shrink-0 w-11 h-6 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary",
          checked
            ? "bg-primary"
            : "bg-base-300 border border-border",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-5" : "translate-x-0",
          ].join(" ")}
        />
      </button>
    </label>
  );
}

// ---------------------------------------------------------------------------
// OptionCards
// ---------------------------------------------------------------------------

export interface OptionCardOption {
  value: number;
  label: string;
  description: string;
}

export interface OptionCardsProps {
  options: OptionCardOption[];
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
  columns?: number;
}

export function OptionCards({
  options,
  value,
  onChange,
  disabled = false,
  columns = 2,
}: OptionCardsProps) {
  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => !disabled && onChange(opt.value)}
            className={[
              "text-left rounded-lg border-2 p-2.5 transition-colors",
              "disabled:opacity-40 disabled:cursor-not-allowed",
              selected
                ? "border-primary bg-primary/10"
                : "border-base-300 cursor-pointer hover:border-primary/50 hover:bg-base-200",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            <div className="flex items-start gap-1">
              <span
                className={[
                  "text-sm font-semibold",
                  selected ? "text-primary" : "text-base-content",
                ].join(" ")}
              >
                {opt.label}
              </span>
              {selected && (
                <span className="ml-auto shrink-0 text-primary text-sm leading-none">
                  ✓
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs leading-snug text-base-content/60">
              {opt.description}
            </p>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chip
// ---------------------------------------------------------------------------

export interface ChipProps {
  children: ReactNode;
  onRemove?: () => void;
}

export function Chip({ children, onRemove }: ChipProps) {
  return (
    <span className="rounded-full bg-base-300 px-2.5 py-1 text-sm inline-flex items-center gap-1.5">
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="leading-none text-base-content/60 hover:text-error transition-colors"
          aria-label="削除"
        >
          ×
        </button>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className = "", ...rest }: InputProps) {
  const inputEl = (
    <input
      className={[
        "w-full rounded-md border border-border bg-base-100 px-2.5 py-1.5",
        "text-sm text-base-content placeholder:text-muted",
        "focus:outline-none focus:ring-2 focus:ring-primary/50",
        "disabled:opacity-40",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    />
  );

  if (!label) return inputEl;

  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-base-content">{label}</span>
      {inputEl}
    </label>
  );
}

// ---------------------------------------------------------------------------
// UiSelect
// ---------------------------------------------------------------------------

export interface UiSelectProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  children: ReactNode;
}

export function UiSelect({
  label,
  className = "",
  children,
  ...rest
}: UiSelectProps) {
  const selectEl = (
    <div className="relative">
      <select
        className={[
          "w-full appearance-none rounded-md border border-border bg-base-100 px-2.5 py-1.5 pr-8",
          "text-sm text-base-content",
          "focus:outline-none focus:ring-2 focus:ring-primary/50",
          "disabled:opacity-40",
          className,
        ]
          .filter(Boolean)
          .join(" ")}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 size-4 text-muted"
        aria-hidden
      />
    </div>
  );

  if (!label) return selectEl;

  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm text-base-content">{label}</span>
      {selectEl}
    </label>
  );
}

// ---------------------------------------------------------------------------
// IconButton
// ---------------------------------------------------------------------------

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  size?: "md" | "sm";
  label: string;
}

export function IconButton({
  icon: Icon,
  size = "md",
  label,
  className = "",
  ...rest
}: IconButtonProps) {
  const sizeCls =
    size === "sm"
      ? "h-6 w-6"
      : "h-8 w-8";
  const iconSize = size === "sm" ? "size-3.5" : "size-4";

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={[
        "flex items-center justify-center rounded-md",
        "text-muted hover:bg-base-300 hover:text-base-content",
        "transition-colors disabled:opacity-40",
        sizeCls,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      <Icon className={iconSize} aria-hidden />
    </button>
  );
}

// ---------------------------------------------------------------------------
// EmptyState
// ---------------------------------------------------------------------------

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  className?: string;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={[
        "flex flex-col items-center justify-center gap-2 py-10 text-center",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Icon className="size-8 text-muted opacity-40" aria-hidden />
      <p className="text-sm font-medium text-base-content">{title}</p>
      {description && (
        <p className="text-xs text-muted max-w-xs">{description}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

export interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return (
    <div
      className={["animate-pulse rounded-md bg-base-300", className]
        .filter(Boolean)
        .join(" ")}
    />
  );
}
