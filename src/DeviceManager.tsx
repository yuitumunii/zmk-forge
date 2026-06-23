// src/DeviceManager.tsx
// デバイス管理ドロップダウン + モーダルエディタ
// AppHeaderのデバイス名ボタン部分に統合するためのコンポーネント群

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Pencil, Plus, Trash2, Folder, X } from "lucide-react";
import { desktop, DeviceProfile, DesktopSettingsV2 } from "./desktop";
import { UiButton, Input } from "./misc/ui";

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

export interface DeviceManagerButtonProps {
  connectedDeviceLabel?: string; // 現在の接続デバイス名 (RPCから取得)
  onReconnect?: () => void;      // デバイス切替後の再接続トリガー
  onDisconnect?: () => void;     // 接続切断
}

// フォームの内部状態
interface DeviceFormState {
  name: string;
  clonePath: string;
  keymapRelPath: string;
  remote: string;
  branch: string;
  token: string;
}

const EMPTY_FORM: DeviceFormState = {
  name: "",
  clonePath: "",
  keymapRelPath: "",
  remote: "origin",
  branch: "main",
  token: "",
};

// ---------------------------------------------------------------------------
// DeviceEditModal
// ---------------------------------------------------------------------------

interface DeviceEditModalProps {
  editingDevice: DeviceProfile | null; // null = 新規追加
  maskedToken: boolean;                // 既存トークンがある場合は true
  onSave: (form: DeviceFormState) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

function DeviceEditModal({
  editingDevice,
  maskedToken,
  onSave,
  onDelete,
  onClose,
}: DeviceEditModalProps) {
  const [form, setForm] = useState<DeviceFormState>(() => {
    if (editingDevice) {
      return {
        name: editingDevice.name,
        clonePath: editingDevice.clonePath ?? "",
        keymapRelPath: editingDevice.keymapRelPath ?? "",
        remote: editingDevice.remote ?? "origin",
        branch: editingDevice.branch ?? "main",
        token: maskedToken ? "********" : "",
      };
    }
    return EMPTY_FORM;
  });

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const set = (key: keyof DeviceFormState) => (
    e: React.ChangeEvent<HTMLInputElement>
  ) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const handlePickClonePath = async () => {
    const picked = await desktop()?.pickClonePath();
    if (picked) setForm((f) => ({ ...f, clonePath: picked }));
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError("デバイス名は必須です");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(form);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!onDelete) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await onDelete();
    } catch (e) {
      setError(e instanceof Error ? e.message : "削除に失敗しました");
      setDeleting(false);
    }
  };

  // Escape キーで閉じる
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const isEditing = !!editingDevice;

  return (
    /* オーバーレイ */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* パネル */}
      <div className="relative w-full max-w-md rounded-xl bg-base-100 text-base-content shadow-xl p-6 mx-4">
        {/* 閉じるボタン */}
        <button
          type="button"
          aria-label="閉じる"
          onClick={onClose}
          className="absolute top-4 right-4 text-muted hover:text-base-content transition-colors"
        >
          <X className="size-4" aria-hidden />
        </button>

        <h2 className="text-base font-semibold mb-4">
          {isEditing ? "デバイスを編集" : "デバイスを追加"}
        </h2>

        <div className="flex flex-col gap-3">
          {/* デバイス名 */}
          <Input
            label="デバイス名 *"
            value={form.name}
            onChange={set("name")}
            maxLength={100}
            placeholder="Pyuron"
          />

          {/* クローンパス */}
          <div className="flex flex-col gap-1">
            <span className="text-sm text-base-content">クローンパス</span>
            <div className="flex gap-1.5">
              <input
                value={form.clonePath}
                onChange={set("clonePath")}
                placeholder="/path/to/zmk-config-Pyuron"
                className="flex-1 rounded-md border border-border bg-base-100 px-2.5 py-1.5
                           text-sm text-base-content placeholder:text-muted
                           focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                type="button"
                onClick={handlePickClonePath}
                title="フォルダを選択"
                className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border
                           text-sm text-muted hover:bg-base-300 hover:text-base-content transition-colors"
              >
                <Folder className="size-3.5" aria-hidden />
              </button>
            </div>
          </div>

          {/* キーマップ相対パス */}
          <Input
            label="キーマップ相対パス"
            value={form.keymapRelPath}
            onChange={set("keymapRelPath")}
            placeholder="config/pyuron.keymap"
          />

          {/* remote / branch を横並び */}
          <div className="grid grid-cols-2 gap-2">
            <Input
              label="リモート"
              value={form.remote}
              onChange={set("remote")}
              placeholder="origin"
            />
            <Input
              label="ブランチ"
              value={form.branch}
              onChange={set("branch")}
              placeholder="main"
            />
          </div>

          {/* GitHub Token */}
          <div className="flex flex-col gap-1">
            <span className="text-sm text-base-content">GitHub Token</span>
            <input
              type="password"
              value={form.token}
              onChange={(e) => {
                const v = e.target.value;
                // "********"を消した場合はリセット
                setForm((f) => ({ ...f, token: v }));
              }}
              onFocus={() => {
                // マスク値にフォーカスが来たら消去して入力しやすくする
                if (form.token === "********") {
                  setForm((f) => ({ ...f, token: "" }));
                }
              }}
              placeholder={maskedToken ? "変更する場合のみ入力" : "ghp_..."}
              className="w-full rounded-md border border-border bg-base-100 px-2.5 py-1.5
                         text-sm text-base-content placeholder:text-muted
                         focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="text-xs text-muted">
              {maskedToken
                ? "既存のトークンが設定済みです。変更する場合のみ入力してください。"
                : "GitHub Personal Access Token (repo スコープ必要)"}
            </p>
          </div>
        </div>

        {/* エラー */}
        {error && (
          <p className="mt-3 text-sm text-red-500">{error}</p>
        )}

        {/* フッターボタン */}
        <div className="flex items-center justify-between mt-5">
          {/* 削除ボタン (編集時のみ) */}
          <div>
            {isEditing && onDelete && (
              confirmDelete ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-red-500">本当に削除しますか？</span>
                  <UiButton
                    variant="ghost"
                    size="xs"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >
                    キャンセル
                  </UiButton>
                  <UiButton
                    variant="ghost"
                    size="xs"
                    className="text-red-500 hover:bg-red-50"
                    onClick={handleDelete}
                    disabled={deleting}
                  >
                    {deleting ? "削除中…" : "削除する"}
                  </UiButton>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleDelete}
                  className="flex items-center gap-1 text-sm text-red-500 hover:text-red-600 transition-colors"
                >
                  <Trash2 className="size-3.5" aria-hidden />
                  削除
                </button>
              )
            )}
          </div>

          {/* 保存 / キャンセル */}
          <div className="flex gap-2">
            <UiButton variant="ghost" onClick={onClose} disabled={saving}>
              キャンセル
            </UiButton>
            <UiButton variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </UiButton>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DeviceManagerButton (デフォルトエクスポート)
// ---------------------------------------------------------------------------

export default function DeviceManagerButton({
  connectedDeviceLabel,
  onReconnect,
  onDisconnect,
}: DeviceManagerButtonProps) {
  const [settings, setSettings] = useState<DesktopSettingsV2 | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [editingDevice, setEditingDevice] = useState<DeviceProfile | null>(null);
  const [showModal, setShowModal] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // 設定読み込み
  const loadSettings = useCallback(async () => {
    const s = await desktop()?.getSettings();
    if (s) {
      setSettings(s);
      // デバイスが空ならオンボーディングモーダルを自動表示
      if (s.devices.length === 0) {
        setEditingDevice(null);
        setShowModal(true);
      }
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // ドロップダウン外クリックで閉じる
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [isOpen]);

  // デバイス切替
  const handleSelectDevice = async (id: string) => {
    await desktop()?.setActiveDevice(id);
    await loadSettings();
    setIsOpen(false);
    onReconnect?.();
  };

  // 保存処理
  const handleSave = async (form: DeviceFormState) => {
    const profile = {
      name: form.name.trim(),
      clonePath: form.clonePath.trim() || undefined,
      keymapRelPath: form.keymapRelPath.trim() || undefined,
      remote: form.remote.trim() || undefined,
      branch: form.branch.trim() || undefined,
    };

    if (editingDevice) {
      // 編集
      await desktop()?.updateDevice(editingDevice.id, profile);
    } else {
      // 追加
      const result = await desktop()?.addDevice(profile);
      if (result && "error" in result) {
        throw new Error(result.error);
      }
    }

    // トークン更新(変更があれば)
    const tokenChanged =
      form.token.trim() !== "" && form.token !== "********";
    if (tokenChanged) {
      await desktop()?.setToken(form.token.trim());
    }

    await loadSettings();
    setShowModal(false);
    setEditingDevice(null);
  };

  // 削除処理
  const handleDelete = async () => {
    if (!editingDevice) return;
    await desktop()?.removeDevice(editingDevice.id);
    await loadSettings();
    setShowModal(false);
    setEditingDevice(null);
  };

  const openAddModal = () => {
    setEditingDevice(null);
    setShowModal(true);
    setIsOpen(false);
  };

  const openEditModal = (device: DeviceProfile) => {
    setEditingDevice(device);
    setShowModal(true);
    setIsOpen(false);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingDevice(null);
  };

  const maskedToken = !!(settings?.token);

  return (
    <>
      {/* トリガーボタン + ドロップダウン */}
      <div ref={dropdownRef} className="relative">
        <button
          type="button"
          disabled={!connectedDeviceLabel}
          onClick={() => connectedDeviceLabel && setIsOpen((v) => !v)}
          className="flex items-center gap-1.5 text-center disabled:opacity-0
                     hover:bg-base-300 transition-colors p-1 pl-2 rounded-lg text-sm"
        >
          <span
            className={`h-1.5 w-1.5 rounded-full shrink-0 ${
              connectedDeviceLabel ? "bg-success" : "bg-muted"
            }`}
          />
          {connectedDeviceLabel}
          <ChevronDown className="inline-block w-4" />
        </button>

        {/* ドロップダウンパネル */}
        {isOpen && (
          <div
            className="absolute left-1/2 -translate-x-1/2 top-full mt-1 z-10
                       min-w-[12rem] rounded-lg bg-base-100 border border-border
                       shadow-md text-sm text-base-content overflow-hidden"
          >
            {/* デバイス一覧 */}
            {settings && settings.devices.length > 0 ? (
              <div className="py-1">
                {settings.devices.map((d) => {
                  const isActive = d.id === settings.activeDeviceId;
                  return (
                    <div
                      key={d.id}
                      className="flex items-center group"
                    >
                      <button
                        type="button"
                        onClick={() => handleSelectDevice(d.id)}
                        className="flex-1 flex items-center gap-2 px-3 py-2
                                   hover:bg-base-300 transition-colors text-left"
                      >
                        <span
                          className={`text-xs shrink-0 w-3 ${
                            isActive ? "text-primary" : "opacity-0"
                          }`}
                          aria-hidden
                        >
                          ✓
                        </span>
                        <span
                          className={isActive ? "font-medium text-primary" : ""}
                        >
                          {d.name}
                        </span>
                      </button>
                      {/* 編集ボタン */}
                      <button
                        type="button"
                        onClick={() => openEditModal(d)}
                        title="編集"
                        aria-label={`${d.name} を編集`}
                        className="flex items-center justify-center px-2 py-2
                                   text-muted hover:bg-base-300 hover:text-base-content
                                   transition-colors opacity-0 group-hover:opacity-100"
                      >
                        <Pencil className="size-3.5" aria-hidden />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="px-3 py-2 text-muted text-xs">
                デバイスがありません
              </p>
            )}

            {/* デバイスを追加 */}
            <div className="border-t border-border">
              <button
                type="button"
                onClick={openAddModal}
                className="w-full flex items-center gap-2 px-3 py-2
                           hover:bg-base-300 transition-colors text-left"
              >
                <Plus className="size-3.5 shrink-0" aria-hidden />
                デバイスを追加
              </button>
            </div>

            {/* 接続を切断 */}
            <div className="border-t border-border">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  onDisconnect?.();
                }}
                className="w-full flex items-center px-3 py-2
                           hover:bg-base-300 transition-colors text-left"
              >
                接続を切断
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 追加/編集モーダル */}
      {showModal && (
        <DeviceEditModal
          editingDevice={editingDevice}
          maskedToken={maskedToken}
          onSave={handleSave}
          onDelete={editingDevice ? handleDelete : undefined}
          onClose={closeModal}
        />
      )}
    </>
  );
}
