import { useCallback, useEffect, useState } from "react";
import { Button } from "react-aria-components";
import { GenericModal } from "../GenericModal";
import { useModalRef } from "../misc/useModalRef";
import { desktop } from "../desktop";

export interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
}

const FIELD =
  "w-full rounded bg-base-200 px-2 py-1.5 outline-none focus:ring-2 ring-primary";

export const SettingsModal = ({ open, onClose }: SettingsModalProps) => {
  const ref = useModalRef(open, true, true);
  const [token, setToken] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      desktop()
        ?.getSettings()
        .then((loaded) => setToken(loaded?.token || ""))
        .catch((e) => {
          console.error("Failed to load settings", e);
        });
      setSaved(false);
    }
  }, [open]);

  const onSave = useCallback(async () => {
    await desktop()?.setToken(token);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [token]);

  return (
    <GenericModal ref={ref} onClose={onClose} className="max-w-lg w-[34rem]">
      <h2 className="text-lg mb-1">Settings</h2>
      <p className="text-sm opacity-70 mb-3">
        GitHub token for pushing your keymap. Clone folder and branch are
        configured per-device in the device manager.
      </p>

      <div className="flex flex-col gap-3 text-sm">
        <label className="flex flex-col gap-1">
          <span className="opacity-80">
            GitHub token (fine-grained: contents:write)
          </span>
          <input
            className={FIELD}
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="leave as •••••••• to keep current"
          />
          <span className="text-xs opacity-60">
            Stored locally on this machine only. Used to push; never committed.
          </span>
        </label>
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <Button
          className="rounded bg-base-200 hover:bg-base-300 px-3 py-1.5"
          onPress={onClose}
        >
          Close
        </Button>
        <Button
          className="rounded bg-primary text-primary-content px-3 py-1.5"
          onPress={onSave}
        >
          {saved ? "Saved ✓" : "Save"}
        </Button>
      </div>
    </GenericModal>
  );
};
