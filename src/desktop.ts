// Bridge to the Electron main process (exposed as window.zmkHome by the
// preload). In the browser this is undefined, so the app falls back to the
// browser demo behavior. Keep this file free of node imports.

export interface DeviceProfile {
  id: string;
  name: string;
  clonePath?: string;
  keymapRelPath?: string;
  remote?: string;
  branch?: string;
  bleUuid?: string;
}

export interface DesktopSettingsV2 {
  devices: DeviceProfile[];
  activeDeviceId?: string;
  token?: string; // "********" でマスク済み
}

export interface SyncResult {
  sha: string | null;
  merge: { layersReplaced: number; deviceLayers: number };
  pushed: boolean;
}

export interface SyncPreviewResult {
  /** False when the device already matches the repo's latest (safe no-op). */
  changed: boolean;
  /** Unified diff of the device keymap vs the repo's latest. */
  diff: string;
  merge: { layersReplaced: number; deviceLayers: number };
}

export interface SyncPayload {
  keymap: unknown;
  behaviors: unknown;
  message: string;
  push?: boolean;
}

export interface ZmkHomeBridge {
  getSettings(): Promise<DesktopSettingsV2>;
  setToken(token: string): Promise<boolean>;
  setActiveDevice(id: string): Promise<boolean>;
  addDevice(profile: Omit<DeviceProfile, "id">): Promise<{ id: string } | { error: string }>;
  updateDevice(id: string, partial: Partial<Omit<DeviceProfile, "id">>): Promise<boolean>;
  removeDevice(id: string): Promise<boolean>;
  pickClonePath(): Promise<string | null>;
  sync(payload: SyncPayload): Promise<SyncResult>;
  /** Preview the diff against the repo's latest without pushing. */
  syncPreview(payload: SyncPayload): Promise<SyncPreviewResult>;
  /** Commit + push the device keymap. Triggers a firmware build. */
  syncCommit(payload: SyncPayload): Promise<SyncResult>;
}

declare global {
  interface Window {
    zmkHome?: ZmkHomeBridge;
  }
}

export function isDesktop(): boolean {
  return typeof window !== "undefined" && !!window.zmkHome;
}

export function desktop(): ZmkHomeBridge | undefined {
  return typeof window !== "undefined" ? window.zmkHome : undefined;
}
