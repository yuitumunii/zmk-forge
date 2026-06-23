// Toast notification system — replaces window.alert throughout the app.
// Usage:
//   1. Wrap your app in <ToastProvider> (done in App.tsx)
//   2. In any component: const { toast } = useToast();
//      toast("Something happened", { variant: "error" });

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle, Info, XCircle, X } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ToastVariant = "info" | "success" | "error";

export interface ToastItem {
  id: number;
  message: string;
  variant: ToastVariant;
}

export interface ToastOptions {
  variant?: ToastVariant;
  /** Duration in ms before auto-dismiss. Default: 4000 */
  duration?: number;
}

interface ToastContextValue {
  toast: (message: string, options?: ToastOptions) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null);

// ---------------------------------------------------------------------------
// Icons & colors per variant
// ---------------------------------------------------------------------------

const VARIANT_META: Record<
  ToastVariant,
  { Icon: typeof Info; iconCls: string }
> = {
  info:    { Icon: Info,        iconCls: "text-primary" },
  success: { Icon: CheckCircle, iconCls: "text-success" },
  error:   { Icon: XCircle,     iconCls: "text-error" },
};

// ---------------------------------------------------------------------------
// ToastItem component (single notification)
// ---------------------------------------------------------------------------

function Toast({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: number) => void;
}) {
  const { Icon, iconCls } = VARIANT_META[item.variant];

  return (
    <div
      className={[
        "flex items-start gap-3",
        "rounded-lg border border-border bg-base-100 shadow-lg",
        "px-4 py-3 text-sm text-base-content",
        "transition-opacity duration-300",
        "max-w-sm w-full",
      ].join(" ")}
      role="alert"
      aria-live="polite"
    >
      <Icon className={`mt-0.5 size-4 shrink-0 ${iconCls}`} aria-hidden />
      <span className="flex-1 leading-snug">{item.message}</span>
      <button
        type="button"
        aria-label="閉じる"
        onClick={() => onDismiss(item.id)}
        className="shrink-0 text-muted hover:text-base-content transition-colors mt-0.5"
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ToastProvider
// ---------------------------------------------------------------------------

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (message: string, options: ToastOptions = {}) => {
      const { variant = "info", duration = 4000 } = options;
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, message, variant }]);
      setTimeout(() => dismiss(id), duration);
    },
    [dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Toast container — fixed bottom-right, stacks upward */}
      <div
        className="fixed bottom-4 right-4 z-[9999] flex flex-col-reverse gap-2 items-end pointer-events-none"
        aria-label="通知"
      >
        {toasts.map((item) => (
          <div key={item.id} className="pointer-events-auto">
            <Toast item={item} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// useToast hook
// ---------------------------------------------------------------------------

// eslint-disable-next-line react-refresh/only-export-components -- hook exported alongside component; fast-refresh hint not applicable to hooks
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used inside <ToastProvider>");
  }
  return ctx;
}
