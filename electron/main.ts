// Electron main process for ZMK Forge.
// - Loads the Vite app (dev URL or built dist).
// - Exposes settings + the real "Sync to GitHub" over IPC (uses gitSync.ts).
// Bundled to dist-electron/main.cjs by esbuild (see package.json build:electron).

import { app, BrowserWindow, ipcMain, dialog, shell, safeStorage } from "electron";
import { join, basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { appendFileSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";

// Debug log so failures are inspectable without seeing the GUI/DevTools.
// Fixed path so it can be tailed regardless of how Electron was launched.
const LOG = "/tmp/zmk-electron.log";
// Diagnostics are dev-only: a packaged release writes nothing, so renderer
// console output / keymaps never land in a world-readable /tmp file. Opt in
// with ZMK_DEBUG=1.
const DEBUG_LOG = !app.isPackaged || process.env.ZMK_DEBUG === "1";
function dbg(...parts: unknown[]): void {
  if (!DEBUG_LOG) return;
  const line = `[${new Date().toISOString()}] ${parts
    .map((p) => (typeof p === "string" ? p : JSON.stringify(p)))
    .join(" ")}\n`;
  try {
    appendFileSync(LOG, line);
  } catch {
    /* ignore */
  }
}

import {
  syncToGitHub,
  previewSync,
  commitPushSync,
  type SyncConfig,
} from "../src/sync/gitSync";
import type { Keymap } from "@zmkfirmware/zmk-studio-ts-client/keymap";
import type { BehaviorMap } from "../src/sync/serializeKeymap";
import { registerBleIpc, shutdownBle } from "./bleNative";

// 1台のデバイスプロファイル
interface DeviceProfile {
  id: string;
  name: string;
  clonePath?: string;
  keymapRelPath?: string;
  remote?: string;
  branch?: string;
  bleUuid?: string;
}

interface AppSettings {
  devices: DeviceProfile[];
  activeDeviceId?: string;
  token?: string; // 全デバイス共通(1 GitHubアカウント)
}

interface SyncPayload {
  keymap: Keymap;
  behaviors: BehaviorMap;
  message: string;
  push?: boolean;
}

const settingsFile = () => join(app.getPath("userData"), "settings.json");

// On-disk shape. The GitHub PAT is never stored in plaintext when the OS keychain
// is available: `tokenEnc` holds safeStorage.encryptString(token) as base64.
// `token` (plaintext) only survives as a legacy field — written by old builds, or
// as a fallback when encryption is unavailable. loadSettings() normalises both
// back into AppSettings.token (plaintext, in-memory only).
// StoredSettings: ディスク保存形式(新形式 + 旧形式マイグレーション用フラットフィールド)
interface StoredSettings {
  // 新形式
  devices?: DeviceProfile[];
  activeDeviceId?: string;
  // 旧形式(マイグレーション用に読むだけ)
  clonePath?: string;
  keymapRelPath?: string;
  remote?: string;
  branch?: string;
  bleUuid?: string;
  // token (暗号化/平文)
  token?: string;
  tokenEnc?: string;
}

async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = JSON.parse(await readFile(settingsFile(), "utf8")) as StoredSettings;

    // token復号 (従来通り)
    let token: string | undefined;
    if (raw.tokenEnc) {
      try {
        token = safeStorage.decryptString(Buffer.from(raw.tokenEnc, "base64"));
      } catch (e) {
        dbg("[settings] token decrypt failed — dropping", String(e));
        token = undefined;
      }
    } else {
      token = raw.token;
    }

    // マイグレーション: 旧平置き形式(devicesが無い)を検出
    if (!raw.devices) {
      const oldName = raw.keymapRelPath
        ? basename(raw.keymapRelPath, extname(raw.keymapRelPath))
        : "My Device";
      const migratedDevice: DeviceProfile = {
        id: randomUUID(),
        name: oldName,
        clonePath: raw.clonePath,
        keymapRelPath: raw.keymapRelPath,
        remote: raw.remote,
        branch: raw.branch,
        bleUuid: raw.bleUuid,
      };
      // マイグレーション結果を即座に保存
      const migrated: AppSettings = {
        devices: [migratedDevice],
        activeDeviceId: migratedDevice.id,
        token,
      };
      await saveSettings(migrated);
      return migrated;
    }

    return {
      devices: raw.devices ?? [],
      activeDeviceId: raw.activeDeviceId,
      token,
    };
  } catch {
    return { devices: [], activeDeviceId: undefined, token: undefined };
  }
}

async function saveSettings(settings: AppSettings): Promise<void> {
  await mkdir(app.getPath("userData"), { recursive: true });
  const out: StoredSettings = {
    devices: settings.devices,
    activeDeviceId: settings.activeDeviceId,
  };
  if (settings.token) {
    if (safeStorage.isEncryptionAvailable()) {
      out.tokenEnc = safeStorage.encryptString(settings.token).toString("base64");
    } else {
      dbg("[settings] encryption unavailable — storing token in plaintext");
      out.token = settings.token;
    }
  }
  await writeFile(settingsFile(), JSON.stringify(out, null, 2), "utf8");
}

function getActiveDevice(settings: AppSettings): DeviceProfile | undefined {
  if (!settings.activeDeviceId) return settings.devices[0];
  return settings.devices.find(d => d.id === settings.activeDeviceId) ?? settings.devices[0];
}

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: "ZMK Forge",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep the BLE RPC pump and timers running at full speed even when the
      // window is unfocused/occluded. Chromium otherwise throttles background
      // renderer timers, which stalls the (latency-sensitive) ZMK handshake
      // over write-with-response BLE and trips its connect timeout.
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  // --- Web Serial (USB connect to ZMK device) -----------------------------
  win.webContents.on(
    "select-serial-port",
    (event, portList, _webContents, callback) => {
      event.preventDefault();
      dbg("[select-serial-port] count=" + portList.length,
        portList.map((p) => p.portId));
      if (portList.length > 0) {
        callback(portList[0].portId);
      } else {
        // No USB device plugged in -> tell Chromium so requestPort() rejects
        // promptly instead of hanging with no chooser UI.
        callback("");
      }
    }
  );

  // --- Web Bluetooth (BLE connect to ZMK device) --------------------------
  // ペアリング自動承認は pairingKind で制限する。
  // NOTE: Electron の BluetoothPairingHandlerDetails にはサービス UUID が
  // 含まれないため deviceId での ZMK 照合は不可能。
  // requestDevice フィルタ側で ZMK Studio サービス UUID 絞り込み済みのため、
  // ここに到達するのは ZMK デバイスのみのはず。
  // PIN 入力が不要なペアリング (confirm / display) のみ自動承認する。
  win.webContents.session.setBluetoothPairingHandler((details, cb) => {
    const safePairingKinds = ["confirm", "display"];
    if (safePairingKinds.includes(details.pairingKind)) {
      dbg("[ble-pair] auto-confirmed", details.deviceId, details.pairingKind);
      cb({ confirmed: true });
    } else {
      // PIN 入力等の予期しないペアリング要求は自動承認しない
      dbg("[ble-pair] unexpected pairingKind — rejected", details.deviceId, details.pairingKind);
      cb({ confirmed: false });
    }
  });
  // デバイス権限は bluetooth/serial のみ、かつ要求元が本番のローカル画面
  // (file:// または dist/) である場合のみ許可する。外部 URL からの要求は拒否。
  win.webContents.session.setDevicePermissionHandler((details) => {
    const origin = details.requestingUrl ?? "";
    const isLocalOrigin =
      origin.startsWith("file://") ||
      origin.startsWith("http://localhost:");
    const isAllowedType =
      details.deviceType === "bluetooth" || details.deviceType === "serial";
    const allowed = isLocalOrigin && isAllowedType;
    if (!allowed) {
      dbg(
        "[device-permission] denied",
        "deviceType:", details.deviceType,
        "requestingUrl:", origin
      );
    }
    return allowed;
  });
  win.webContents.on(
    "select-bluetooth-device",
    (event, deviceList, callback) => {
      event.preventDefault();
      // requestDevice already filtered by the ZMK Studio service UUID, so
      // every entry here is a ZMK keyboard. Log richly so a hardware test is
      // diagnosable from /tmp/zmk-electron.log, then auto-pick the first.
      dbg(
        "[select-bluetooth-device] count=" + deviceList.length,
        deviceList.map((d) => ({ name: d.deviceName, id: d.deviceId }))
      );
      // Diagnostic scan mode (flag file, since `open -n` can't pass env):
      // observe ALL nearby BLE devices without picking, to learn whether the
      // keyboard is visible to Web Bluetooth at all.
      if (existsSync("/tmp/zmk-ble-scan")) {
        return; // never callback; keep scanning + logging
      }
      if (deviceList.length > 0) {
        dbg("[select-bluetooth-device] picking", deviceList[0].deviceName);
        callback(deviceList[0].deviceId);
      }
      // Empty list = still scanning; don't call back, wait for next fire.
    }
  );

  // --- Diagnostics: capture everything to /tmp/zmk-electron.log -----------
  win.webContents.on(
    "console-message",
    (_e, level, message, line, sourceId) => {
      dbg("[renderer console]", `lvl=${level}`, `${sourceId}:${line}`, message);
    }
  );
  win.webContents.on(
    "did-fail-load",
    (_e, errorCode, errorDescription, validatedURL) => {
      dbg("[did-fail-load]", `code=${errorCode}`, errorDescription, validatedURL);
    }
  );
  win.webContents.on("did-finish-load", () => {
    dbg("[did-finish-load]", win.webContents.getURL());
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    dbg("[render-process-gone]", details);
  });
  win.webContents.on("preload-error", (_e, preloadPath, error) => {
    dbg("[preload-error]", preloadPath, String(error));
  });
  win.webContents.on("unresponsive", () => dbg("[unresponsive]"));

  // Security: keep the renderer pinned to the local app. External links
  // (target=_blank / window.open) open in the system browser, never an in-app
  // window, and the main frame can't be navigated to an arbitrary URL.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const sameApp =
      url.startsWith("file://") || url.startsWith("http://localhost:");
    if (!sameApp) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  // 本番ビルド (app.isPackaged === true) では dist/index.html を直接読み込む。
  // dev サーバー (localhost:5173) へのアクセスは開発時のみ行う。
  // ZMK_DEV_URL は npm run electron:dev が設定する; 本番では参照しない。
  if (app.isPackaged) {
    // 本番: パッケージ済み Electron は必ず dist/index.html を読む。
    // dev server を試みると外部ネットワークへのアクセスが発生するためNG。
    const distPath = join(__dirname, "..", "dist", "index.html");
    dbg("[createWindow] packaged — loading dist", distPath);
    win.loadFile(distPath).then(
      () => dbg("[loadFile] resolved dist"),
      (e) => dbg("[loadFile] rejected", String(e))
    );
  } else {
    // 開発: Vite dev server を優先し、失敗時は dist へフォールバック。
    const devUrl = process.env.ZMK_DEV_URL ?? "http://localhost:5173";
    dbg("[createWindow] dev — loading", devUrl, "preload=", join(__dirname, "preload.cjs"));
    win.loadURL(devUrl).then(
      () => dbg("[loadURL] resolved", devUrl),
      (err) => {
        dbg("[loadURL] rejected", String(err), "-> falling back to dist");
        win
          .loadFile(join(__dirname, "..", "dist", "index.html"))
          .then(
            () => dbg("[loadFile] resolved dist"),
            (e) => dbg("[loadFile] rejected", String(e))
          );
      }
    );
  }

  // DevTools is noisy for normal use; open only when explicitly requested.
  if (process.env.ZMK_DEVTOOLS === "1") {
    win.webContents.openDevTools({ mode: "detach" });
  }
}

function registerIpc(): void {
  ipcMain.handle("zmk:getSettings", async () => {
    const s = await loadSettings();
    return {
      devices: s.devices.map(d => ({ ...d })),
      activeDeviceId: s.activeDeviceId,
      token: s.token ? "********" : undefined,
    };
  });

  // zmk:setSettings は後方互換のため残すが token 更新専用に縮小。
  // device フィールドの更新は zmk:updateDevice / zmk:addDevice で行う。
  ipcMain.handle(
    "zmk:setSettings",
    async (_e, incoming: { token?: string }): Promise<boolean> => {
      if (incoming === null || typeof incoming !== "object") {
        throw new Error("Invalid settings: expected object");
      }
      const MAX_STR = 256;
      if (incoming.token !== undefined && incoming.token !== "********") {
        if (typeof incoming.token !== "string" || incoming.token.length > MAX_STR) {
          throw new Error("Invalid settings: token");
        }
      }
      const current = await loadSettings();
      const token =
        !incoming.token || incoming.token === "********"
          ? current.token
          : incoming.token;
      await saveSettings({ ...current, token });
      return true;
    }
  );

  ipcMain.handle("zmk:pickClonePath", async (): Promise<string | null> => {
    const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
  });

  // --- デバイスプロファイル管理 IPC -------------------------------------------

  // アクティブデバイス切り替え
  ipcMain.handle("zmk:setActiveDevice", async (_e, id: string) => {
    const s = await loadSettings();
    if (!s.devices.find(d => d.id === id)) return false;
    s.activeDeviceId = id;
    await saveSettings(s);
    return true;
  });

  // デバイス追加
  ipcMain.handle("zmk:addDevice", async (_e, profile: Omit<DeviceProfile, "id">) => {
    const s = await loadSettings();
    if (!profile.name || profile.name.length > 100) return { error: "nameが不正です" };
    if (profile.remote && !/^[a-zA-Z0-9._\-/]+$/.test(profile.remote)) return { error: "remoteが不正です" };
    if (profile.branch && !/^[a-zA-Z0-9._\-/]+$/.test(profile.branch)) return { error: "branchが不正です" };
    const newDevice: DeviceProfile = { id: randomUUID(), ...profile };
    s.devices.push(newDevice);
    s.activeDeviceId = newDevice.id;
    await saveSettings(s);
    return { id: newDevice.id };
  });

  // デバイス更新
  ipcMain.handle("zmk:updateDevice", async (_e, id: string, partial: Partial<Omit<DeviceProfile, "id">>) => {
    const s = await loadSettings();
    const idx = s.devices.findIndex(d => d.id === id);
    if (idx === -1) return false;
    if (partial.remote && !/^[a-zA-Z0-9._\-/]+$/.test(partial.remote)) return false;
    if (partial.branch && !/^[a-zA-Z0-9._\-/]+$/.test(partial.branch)) return false;
    if (partial.name !== undefined && (partial.name.length === 0 || partial.name.length > 100)) return false;
    s.devices[idx] = { ...s.devices[idx], ...partial };
    await saveSettings(s);
    return true;
  });

  // デバイス削除
  ipcMain.handle("zmk:removeDevice", async (_e, id: string) => {
    const s = await loadSettings();
    const before = s.devices.length;
    s.devices = s.devices.filter(d => d.id !== id);
    if (s.devices.length === before) return false;
    if (s.activeDeviceId === id) {
      s.activeDeviceId = s.devices[0]?.id;
    }
    await saveSettings(s);
    return true;
  });

  // token 単独更新
  ipcMain.handle("zmk:setToken", async (_e, token: string) => {
    const s = await loadSettings();
    s.token = token || undefined;
    await saveSettings(s);
    return true;
  });

  async function syncConfig(): Promise<{ config: SyncConfig; token?: string }> {
    const s = await loadSettings();
    const dev = getActiveDevice(s);
    if (!dev?.clonePath || !dev?.keymapRelPath) {
      throw new Error(
        "アクティブデバイスの clonePath / keymapRelPath が未設定です。設定画面でデバイスを登録してください。"
      );
    }
    return {
      config: {
        clonePath: dev.clonePath,
        keymapRelPath: dev.keymapRelPath,
        remote: dev.remote,
        branch: dev.branch,
      } satisfies SyncConfig,
      token: s.token,
    };
  }

  ipcMain.handle("zmk:sync", async (_e, payload: SyncPayload) => {
    const { config, token } = await syncConfig();
    return syncToGitHub(
      config,
      payload.keymap,
      payload.behaviors,
      payload.message,
      { push: payload.push ?? false },
      token
    );
  });

  // Two-step sync: preview the diff against the repo's latest first, then push
  // only after the user confirms (a push triggers a firmware build).
  ipcMain.handle("zmk:syncPreview", async (_e, payload: SyncPayload) => {
    const { config } = await syncConfig();
    return previewSync(config, payload.keymap, payload.behaviors);
  });

  ipcMain.handle("zmk:syncCommit", async (_e, payload: SyncPayload) => {
    const { config, token } = await syncConfig();
    return commitPushSync(
      config,
      payload.keymap,
      payload.behaviors,
      payload.message,
      token
    );
  });
}

process.on("uncaughtException", (err) => dbg("[uncaughtException]", String(err), err.stack ?? ""));
process.on("unhandledRejection", (reason) => dbg("[unhandledRejection]", String(reason)));

// Debug-only: expose Chrome DevTools Protocol so the automated verification
// harness can drive the renderer headlessly. OFF by default in every build —
// opt in explicitly with ZMK_CDP=1. A packaged release therefore never opens
// the port unless the user deliberately sets the flag.
if (!app.isPackaged || process.env.ZMK_CDP === "1") {
  app.commandLine.appendSwitch("remote-debugging-port", "9222");
  app.commandLine.appendSwitch("remote-allow-origins", "http://localhost:9222");
}

dbg("=== main.cjs start ===", "argv=", process.argv, "cwd=", process.cwd());

// Single-instance lock. Running two copies makes them fight over the Bluetooth
// adapter (CoreBluetooth serves one central well at a time), so the second one
// discovers/connects nothing. `open -n` forces a fresh process each launch, so
// the duplicate must bow out here: it fails to get the lock and quits, while
// the already-running copy gets a `second-instance` event and focuses itself.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  dbg("[single-instance] another copy is already running — quitting");
  app.quit();
}

app.on("second-instance", () => {
  dbg("[single-instance] second launch attempted");
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  } else {
    // The previous window was closed/crashed but this process kept the lock —
    // re-create the window so a fresh launch actually shows something instead
    // of silently doing nothing (the "stuck, won't respond" ghost).
    dbg("[single-instance] no live window — recreating");
    createWindow();
  }
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  dbg("[app ready]");
  registerIpc();
  registerBleIpc({
    getWindow: () => mainWindow,
    getCachedUuid: async () => {
      const s = await loadSettings();
      return getActiveDevice(s)?.bleUuid;
    },
    setCachedUuid: async (uuid: string) => {
      const s = await loadSettings();
      const dev = getActiveDevice(s);
      if (!dev) return;
      dev.bleUuid = uuid;
      await saveSettings(s);
    },
    dbg,
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // Quit fully even on macOS. This is a single-window tool, not a document app;
  // keeping a windowless process alive would hold the single-instance lock and
  // leave a "stuck" ghost that swallows the next launch.
  app.quit();
});

// --- 終了の確実化 -----------------------------------------------------------
// noble(CoreBluetooth)のNAPIファイナライザが Node 環境の後始末
// (Environment::RunCleanup → CleanupHandles)で永久ブロックし、本体+GPU/Network
// ヘルパーが「応答なし」ゾンビとして残る(2026-06-12 sampleで実測特定)。
// この段階ではイベントループが死んでいるため、JSのsetTimeoutもprocess.exitも
// 同じ後始末に入って固まり役に立たない。
// 唯一確実な対策＝外部ウォッチドッグ: quit開始時に切り離した子プロセスを放ち、
// 2秒後にカーネルレベルで SIGKILL。凍ったループの影響を受けず必ず死ぬ。
// (helperプロセスは親の死を検知して自動退出する)
let quitBackstopArmed = false;
app.on("before-quit", () => {
  if (quitBackstopArmed) return;
  quitBackstopArmed = true;
  dbg("[quit] before-quit — BLE shutdown + external 2s SIGKILL watchdog armed");
  void shutdownBle();
  try {
    const watchdog = spawn(
      "/bin/sh",
      ["-c", `sleep 2; kill -9 ${process.pid} 2>/dev/null || true`],
      { detached: true, stdio: "ignore" }
    );
    watchdog.unref();
  } catch {
    /* ignore */
  }
  // ループがまだ生きていれば1秒で先に正規退出を試みる(ダメでも上のwatchdogが殺す)
  setTimeout(() => process.exit(0), 1000);
});
app.on("quit", () => {
  process.exit(0);
});
