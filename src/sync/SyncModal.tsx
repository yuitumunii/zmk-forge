import { useCallback, useState } from "react";
import { Button } from "react-aria-components";
import { Copy, Download, Check } from "lucide-react";
import { GenericModal } from "../GenericModal";
import { useModalRef } from "../misc/useModalRef";

export interface SyncModalProps {
  open: boolean;
  content?: string;
  fileName?: string;
  title?: string;
  note?: string;
  /** When set, show a confirm button (e.g. "Push to GitHub") that calls this. */
  onConfirm?: () => void;
  confirmLabel?: string;
  /** Disable actions while a push is in flight. */
  busy?: boolean;
  /** Render the note as a warning (device differs from the repo's latest). */
  warning?: boolean;
  onClose: () => void;
}

export const SyncModal = ({
  open,
  content,
  fileName = "keymap.keymap",
  title = "Sync to GitHub — generated keymap",
  note,
  onConfirm,
  confirmLabel = "Push to GitHub",
  busy = false,
  warning = false,
  onClose,
}: SyncModalProps) => {
  const ref = useModalRef(open, true, true);
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(() => {
    if (!content) return;
    navigator.clipboard?.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [content]);

  const onDownload = useCallback(() => {
    if (!content) return;
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, [content, fileName]);

  return (
    <GenericModal ref={ref} onClose={onClose} className="max-w-3xl w-[48rem]">
      <div className="flex items-center justify-between gap-4 mb-2">
        <h2 className="text-lg">{title}</h2>
        <div className="flex gap-2">
          <Button
            className="flex items-center gap-1 rounded bg-base-200 hover:bg-base-300 px-3 py-1.5"
            onPress={onCopy}
          >
            {copied ? <Check className="w-4" /> : <Copy className="w-4" />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button
            className="flex items-center gap-1 rounded bg-base-200 hover:bg-base-300 px-3 py-1.5"
            onPress={onDownload}
          >
            <Download className="w-4" />
            Download
          </Button>
        </div>
      </div>
      <p
        className={`text-sm mb-2 ${
          warning
            ? "text-amber-600 dark:text-amber-400 font-medium"
            : "opacity-70"
        }`}
      >
        {warning ? "⚠️ " : ""}
        {note ??
          "This is the .keymap source generated from the current on-device keymap. In the desktop app, Sync writes this into your zmk-config clone and pushes; in the browser you can copy or download it."}
      </p>
      {content && (
        <pre className="text-xs bg-base-200 rounded p-3 overflow-auto max-h-[60vh] whitespace-pre">
          {content}
        </pre>
      )}
      <div className="flex justify-end gap-2 mt-3">
        <Button
          className="rounded bg-base-200 hover:bg-base-300 px-3 py-1.5"
          onPress={onClose}
          isDisabled={busy}
        >
          {onConfirm ? "Cancel" : "Close"}
        </Button>
        {onConfirm && (
          <Button
            className="rounded bg-primary text-primary-content hover:opacity-90 px-3 py-1.5 disabled:opacity-50"
            onPress={onConfirm}
            isDisabled={busy}
          >
            {busy ? "Pushing…" : confirmLabel}
          </Button>
        )}
      </div>
    </GenericModal>
  );
};
