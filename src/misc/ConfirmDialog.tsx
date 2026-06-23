/**
 * ConfirmDialog — window.confirm / window.alert を使わない確認ダイアログ。
 *
 * 使い方:
 *   const [open, setOpen] = useState(false);
 *   <ConfirmDialog
 *     open={open}
 *     title="確認"
 *     message="本当に実行しますか？"
 *     confirmLabel="適用する"
 *     onConfirm={() => { ... }}
 *     onCancel={() => setOpen(false)}
 *   />
 *
 * - Esc / 外側クリック / × → キャンセル（onCancel 呼び出し）
 * - [適用する] → onConfirm 呼び出し
 * - message に改行を含めたい場合は "\n" を使う（whitespace-pre-line で表示される）
 */

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { UiButton } from "./ui";

export interface ConfirmDialogProps {
  open: boolean;
  /** ダイアログタイトル */
  title: string;
  /** 本文（文字列 or ReactNode）。文字列の場合 \n で改行可 */
  message: string | ReactNode;
  /** 確認ボタンのラベル（デフォルト: "適用する"）*/
  confirmLabel?: string;
  /** キャンセルボタンのラベル（デフォルト: "キャンセル"）*/
  cancelLabel?: string;
  /** 確認ボタンを押したとき */
  onConfirm: () => void;
  /** キャンセルしたとき（Esc/外側クリック/×/キャンセルボタン）*/
  onCancel: () => void;
  /** 確認ボタンの処理中フラグ（true のときボタンをローディング表示）*/
  busy?: boolean;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "適用する",
  cancelLabel = "キャンセル",
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement | null>(null);

  // ---- ダイアログ開閉 --------------------------------------------------------
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) {
      if (!el.open) el.showModal();
    } else {
      if (el.open) el.close();
    }
  }, [open]);

  // ---- 外側クリックでキャンセル -----------------------------------------------
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    function handleClick(e: MouseEvent) {
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (!inside) onCancel();
    }

    if (open) {
      el.addEventListener("mousedown", handleClick);
    }
    return () => {
      el.removeEventListener("mousedown", handleClick);
    };
  }, [open, onCancel]);

  // ---- Esc → onCancel -------------------------------------------------------
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    function handleCancel(e: Event) {
      e.preventDefault(); // デフォルトの close を抑えて onCancel に委ねる
      onCancel();
    }
    el.addEventListener("cancel", handleCancel);
    return () => el.removeEventListener("cancel", handleCancel);
  }, [onCancel]);

  return (
    <dialog
      ref={ref}
      className={[
        "rounded-xl border border-border bg-base-100 text-base-content shadow-xl",
        "w-full max-w-md p-0",
        "backdrop:bg-black/40",
      ].join(" ")}
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      {/* ヘッダ */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
        <h2
          id="confirm-dialog-title"
          className="text-sm font-semibold text-base-content"
        >
          {title}
        </h2>
        <button
          type="button"
          aria-label="閉じる"
          onClick={onCancel}
          className="text-muted hover:text-base-content transition-colors"
          disabled={busy}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      {/* 本文 */}
      <div className="px-5 py-4">
        {typeof message === "string" ? (
          <p className="text-sm leading-relaxed text-base-content/80 whitespace-pre-line">
            {message}
          </p>
        ) : (
          <div className="text-sm leading-relaxed text-base-content/80">
            {message}
          </div>
        )}
      </div>

      {/* フッタ */}
      <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
        <UiButton
          variant="ghost"
          size="sm"
          onClick={onCancel}
          disabled={busy}
        >
          {cancelLabel}
        </UiButton>
        <UiButton
          variant="primary"
          size="sm"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "処理中…" : confirmLabel}
        </UiButton>
      </div>
    </dialog>
  );
}
