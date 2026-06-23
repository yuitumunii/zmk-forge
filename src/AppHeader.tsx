import { useConnectedDeviceData } from "./rpc/useConnectedDeviceData";
import { useSub } from "./usePubSub";
import { useContext, useEffect, useState } from "react";
import { useModalRef } from "./misc/useModalRef";
import { LockStateContext } from "./rpc/LockStateContext";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { ConnectionContext } from "./rpc/ConnectionContext";
import { Undo2, Redo2, Save, Trash2, UploadCloud, Settings } from "lucide-react";
import { Tooltip } from "./misc/Tooltip";
import { GenericModal } from "./GenericModal";
import { IconButton } from "./misc/ui";
import DeviceManagerButton from "./DeviceManager";

export interface AppHeaderProps {
  connectedDeviceLabel?: string;
  onSave?: () => void | Promise<void>;
  onDiscard?: () => void | Promise<void>;
  onUndo?: () => Promise<void>;
  onRedo?: () => Promise<void>;
  onResetSettings?: () => void | Promise<void>;
  onDisconnect?: () => void | Promise<void>;
  onReconnect?: () => void;
  onSync?: () => void | Promise<void>;
  onShowSettings?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
}

export const AppHeader = ({
  connectedDeviceLabel,
  canRedo,
  canUndo,
  onRedo,
  onUndo,
  onSave,
  onDiscard,
  onDisconnect,
  onReconnect,
  onResetSettings,
  onSync,
  onShowSettings,
}: AppHeaderProps) => {
  const [showSettingsReset, setShowSettingsReset] = useState(false);

  const lockState = useContext(LockStateContext);
  const connectionState = useContext(ConnectionContext);

  useEffect(() => {
    if (
      (!connectionState.conn ||
        lockState != LockState.ZMK_STUDIO_CORE_LOCK_STATE_UNLOCKED) &&
      showSettingsReset
    ) {
      setShowSettingsReset(false);
    }
  }, [lockState, connectionState.conn, showSettingsReset]);

  const showSettingsRef = useModalRef(showSettingsReset);
  const [unsaved, setUnsaved] = useConnectedDeviceData<boolean>(
    { keymap: { checkUnsavedChanges: true } },
    (r) => r.keymap?.checkUnsavedChanges
  );

  useSub("rpc_notification.keymap.unsavedChangesStatusChanged", (unsaved) =>
    setUnsaved(unsaved)
  );

  return (
    <header className="top-0 left-0 right-0 grid grid-cols-[1fr_auto_1fr] items-center py-1.5 px-2 max-w-full border-b border-border bg-base-200">
      {/* 左: ロゴ + アプリ名 */}
      <div className="flex items-center gap-1">
        <img
          src={`${import.meta.env.BASE_URL}zmk.svg`}
          alt="ZMK Logo"
          className="h-7 rounded"
        />
        <span className="text-sm font-semibold text-base-content select-none">
          ZMK Forge
        </span>
      </div>

      {/* 設定初期化確認モーダル */}
      <GenericModal ref={showSettingsRef} className="max-w-[50vw]">
        <h2 className="my-2 text-lg font-semibold text-base-content">
          設定を初期化
        </h2>
        <div>
          <p className="text-sm text-base-content">
            ZMK Forge でおこなったすべてのカスタマイズが削除され、
            出荷時のキーマップに戻ります。
          </p>
          <p className="mt-1 text-sm text-muted">この操作は取り消せません。</p>
          <div className="flex justify-end mt-4 gap-2">
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1 transition-colors
                         text-base-content/60 hover:bg-base-300 hover:text-base-content
                         px-3 py-1.5 text-sm rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => setShowSettingsReset(false)}
            >
              キャンセル
            </button>
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1 transition-colors
                         bg-danger text-white hover:opacity-90
                         px-3 py-1.5 text-sm rounded-md disabled:opacity-40 disabled:cursor-not-allowed"
              onClick={() => {
                setShowSettingsReset(false);
                onResetSettings?.();
              }}
            >
              初期化する
            </button>
          </div>
        </div>
      </GenericModal>

      {/* 中央: デバイス名メニュー + 接続状態ドット */}
      <DeviceManagerButton
        connectedDeviceLabel={connectedDeviceLabel}
        onReconnect={onReconnect}
        onDisconnect={onDisconnect}
      />

      {/* 右: アイコン群 */}
      <div className="flex justify-end items-center gap-0.5 px-1">
        {onUndo && (
          <Tooltip label="元に戻す">
            <IconButton
              icon={Undo2}
              label="元に戻す"
              disabled={!canUndo}
            />
          </Tooltip>
        )}
        {onRedo && (
          <Tooltip label="やり直す">
            <IconButton
              icon={Redo2}
              label="やり直す"
              disabled={!canRedo}
            />
          </Tooltip>
        )}

        {/* Undo/Redo と主操作群の仕切り線 */}
        {(onUndo || onRedo) && (
          <span className="h-4 w-px bg-border mx-1 shrink-0" aria-hidden />
        )}

        {/* 保存: 未保存時だけ目立つ */}
        <Tooltip label="保存">
          <div className="relative">
            <IconButton
              icon={Save}
              label="保存"
              className={unsaved ? "text-primary" : ""}
              disabled={!unsaved}
              onClick={onSave as React.MouseEventHandler<HTMLButtonElement>}
            />
            {unsaved && (
              <span
                className="absolute top-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-primary pointer-events-none"
                aria-hidden
              />
            )}
          </div>
        </Tooltip>

        <Tooltip label="変更を破棄">
          <IconButton
            icon={Trash2}
            label="変更を破棄"
            disabled={!unsaved}
            onClick={onDiscard as React.MouseEventHandler<HTMLButtonElement>}
          />
        </Tooltip>

        {onSync && (
          <>
            <span className="h-4 w-px bg-border mx-1 shrink-0" aria-hidden />
            <Tooltip label="GitHub に同期">
              <button
                type="button"
                disabled={!connectionState.conn}
                onClick={onSync as React.MouseEventHandler<HTMLButtonElement>}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-sm
                           text-muted hover:bg-base-300 hover:text-base-content
                           transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <UploadCloud className="size-4" aria-hidden />
                <span>同期</span>
              </button>
            </Tooltip>
          </>
        )}

        {onShowSettings && (
          <Tooltip label="設定">
            <IconButton
              icon={Settings}
              label="設定"
              onClick={onShowSettings}
            />
          </Tooltip>
        )}
      </div>
    </header>
  );
};
