import { AppHeader } from "./AppHeader";

import { create_rpc_connection } from "@zmkfirmware/zmk-studio-ts-client";
import { call_rpc } from "./rpc/logging";
import { createMockConnection } from "./rpc/mockConnection";

import type { Notification } from "@zmkfirmware/zmk-studio-ts-client/studio";
import { ConnectionState, ConnectionContext } from "./rpc/ConnectionContext";
import { Dispatch, useCallback, useEffect, useRef, useState } from "react";
import type { Section } from "./keyboard/TuningModal";
import { ConnectModal, TransportFactory } from "./ConnectModal";

import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";
// Linux-browser BLE (name-tolerant fork of the upstream gatt transport).
import { connect as gatt_connect } from "./transport/gattHome";
// Desktop BLE goes through the main process (noble), since Chromium Web
// Bluetooth refuses HID keyboards.
import {
  connect as ble_native_connect,
  isNativeBleAvailable,
} from "./transport/bleIpc";
import { connect as serial_connect } from "@zmkfirmware/zmk-studio-ts-client/transport/serial";
import Keyboard from "./keyboard/Keyboard";
import { UndoRedoContext, UndoControlsContext, useUndoRedo } from "./undoRedo";
import { publish, useSub } from "./usePubSub";
import { LockState } from "@zmkfirmware/zmk-studio-ts-client/core";
import { LockStateContext } from "./rpc/LockStateContext";
import { UnlockModal } from "./UnlockModal";
import { valueAfter } from "./misc/async";
import { AppFooter } from "./AppFooter";
import { AboutModal } from "./AboutModal";
import { LicenseNoticeModal } from "./misc/LicenseNoticeModal";
import { useToast } from "./misc/toast";
import {
  serializeKeymapToDevicetree,
  type BehaviorMap,
} from "./sync/serializeKeymap";
import { SyncModal } from "./sync/SyncModal";
import { SettingsModal } from "./sync/SettingsModal";
import { isDesktop, desktop } from "./desktop";

const TRANSPORTS: TransportFactory[] = [
  navigator.serial && { label: "USB", connect: serial_connect },
  // BLE: on the Electron desktop, go native (main process / noble) because
  // Chromium Web Bluetooth refuses HID keyboards. On a Linux browser, fall
  // back to Web Bluetooth via the name-tolerant gatt fork.
  ...(isNativeBleAvailable()
    ? [{ label: "BLE", isWireless: true, connect: ble_native_connect }]
    : navigator.bluetooth && navigator.userAgent.indexOf("Linux") >= 0
      ? [{ label: "BLE", isWireless: true, connect: gatt_connect }]
      : []),
].filter((t) => t !== undefined).filter((t) => t.label !== "USB");

// publish はモジュールスコープ emitter を直接使う純粋関数。
// Hook ではないので async 関数内でも安全に呼べる。

async function listen_for_notifications(
  notification_stream: ReadableStream<Notification>,
  signal: AbortSignal
): Promise<void> {
  const reader = notification_stream.getReader();
  const onAbort = () => {
    reader.cancel();
    reader.releaseLock();
  };
  signal.addEventListener("abort", onAbort, { once: true });
  do {
    try {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      console.log("Notification", value);
      publish("rpc_notification", value);

      const subsystem = Object.entries(value).find(
        ([, v]) => v !== undefined
      );
      if (!subsystem) {
        continue;
      }

      const [subId, subData] = subsystem;
      const event = Object.entries(subData).find(([, v]) => v !== undefined);

      if (!event) {
        continue;
      }

      const [eventName, eventData] = event;
      const topic = ["rpc_notification", subId, eventName].join(".");

      publish(topic, eventData);
    } catch (e) {
      signal.removeEventListener("abort", onAbort);
      reader.releaseLock();
      throw e;
    }
  } while (true); // eslint-disable-line no-constant-condition

  signal.removeEventListener("abort", onAbort);
  reader.releaseLock();
  notification_stream.cancel();
}

async function connect(
  transport: RpcTransport,
  setConn: Dispatch<ConnectionState>,
  setConnectedDeviceName: Dispatch<string | undefined>,
  signal: AbortSignal,
): Promise<boolean> {
  const conn = await create_rpc_connection(transport, { signal });

  const details = await Promise.race([
    call_rpc(conn, { core: { getDeviceInfo: true } })
      .then((r) => r?.core?.getDeviceInfo)
      .catch((e) => {
        console.error("Failed first RPC call", e);
        return undefined;
      }),
    // BLE with acknowledged writes (3 ATT round-trips per RPC frame) is slower
    // than USB; upstream's 1s budget is too tight and trips a false "failed to
    // connect" before the first getDeviceInfo reply lands. Give it 5s.
    valueAfter(undefined, 5000),
  ]);

  if (!details) {
    return false;
  }

  listen_for_notifications(conn.notification_readable, signal)
    .then(() => {
      setConnectedDeviceName(undefined);
      setConn({ conn: null });
    })
    .catch(() => {
      setConnectedDeviceName(undefined);
      setConn({ conn: null });
    });

  setConnectedDeviceName(details.name);
  setConn({ conn });
  return true;
}


function App() {
  const { toast } = useToast();
  const [conn, setConn] = useState<ConnectionState>({ conn: null });
  // 自動接続の競合チェック用: ステールクロージャを防ぐため ref で最新値を保持する
  const connRef = useRef<ConnectionState>({ conn: null });
  useEffect(() => { connRef.current = conn; }, [conn]);
  const [connectedDeviceName, setConnectedDeviceName] = useState<
    string | undefined
  >(undefined);
  const [doIt, undo, redo, canUndo, canRedo, reset] = useUndoRedo();
  const [showAbout, setShowAbout] = useState(false);
  const [showLicenseNotice, setShowLicenseNotice] = useState(false);
  const [connectionAbort, setConnectionAbort] = useState(new AbortController());
  const [showSync, setShowSync] = useState(false);
  const [syncContent, setSyncContent] = useState<string | undefined>(undefined);
  const [syncTitle, setSyncTitle] = useState<string | undefined>(undefined);
  const [syncNote, setSyncNote] = useState<string | undefined>(undefined);
  const [syncWarning, setSyncWarning] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  // When a desktop preview shows changes, hold the payload so the confirm
  // button can commit+push exactly what was previewed.
  const [syncPending, setSyncPending] = useState<{
    keymap: unknown;
    behaviors: BehaviorMap;
    message: string;
  } | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [tuningSection, setTuningSection] = useState<Section | null>(null);

  const [lockState, setLockState] = useState<LockState>(
    LockState.ZMK_STUDIO_CORE_LOCK_STATE_LOCKED
  );

  useSub("rpc_notification.core.lockStateChanged", (ls) => {
    setLockState(ls);
  });

  useEffect(() => {
    if (!conn.conn) {
      reset();
      setLockState(LockState.ZMK_STUDIO_CORE_LOCK_STATE_LOCKED);
    }

    async function updateLockState() {
      if (!conn.conn) {
        return;
      }

      const locked_resp = await call_rpc(conn.conn, {
        core: { getLockState: true },
      });

      setLockState(
        locked_resp.core?.getLockState ||
          LockState.ZMK_STUDIO_CORE_LOCK_STATE_LOCKED
      );
    }

    updateLockState().catch((e) => {
      console.error("updateLockState failed", e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn, setLockState]);

  // Global Cmd+Z / Cmd+Shift+Z undo/redo — skips text inputs so typing is unaffected.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "z") return;

      // Don't intercept while the user is typing.
      const el = document.activeElement;
      if (
        el &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          (el as HTMLElement).isContentEditable)
      ) {
        return;
      }

      e.preventDefault();

      if (e.shiftKey) {
        if (canRedo) redo();
      } else {
        if (canUndo) undo();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [canUndo, canRedo, undo, redo]);

  const save = useCallback(() => {
    async function doSave() {
      if (!conn.conn) {
        return;
      }

      const resp = await call_rpc(conn.conn, { keymap: { saveChanges: true } });
      if (!resp.keymap?.saveChanges || resp.keymap?.saveChanges.err) {
        console.error("Failed to save changes", resp.keymap?.saveChanges);
      }
    }

    doSave().catch((e) => {
      console.error("doSave failed", e);
    });
  }, [conn]);

  const discard = useCallback(() => {
    async function doDiscard() {
      if (!conn.conn) {
        return;
      }

      const resp = await call_rpc(conn.conn, {
        keymap: { discardChanges: true },
      });
      if (!resp.keymap?.discardChanges) {
        console.error("Failed to discard changes", resp);
      }

      reset();
      setConn({ conn: conn.conn });
    }

    doDiscard().catch((e) => {
      console.error("doDiscard failed", e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn]);

  const resetSettings = useCallback(() => {
    async function doReset() {
      if (!conn.conn) {
        return;
      }

      const resp = await call_rpc(conn.conn, {
        core: { resetSettings: true },
      });
      if (!resp.core?.resetSettings) {
        console.error("Failed to settings reset", resp);
      }

      reset();
      setConn({ conn: conn.conn });
    }

    doReset().catch((e) => {
      console.error("doReset failed", e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn]);

  const disconnect = useCallback(() => {
    async function doDisconnect() {
      if (!conn.conn) {
        return;
      }

      await conn.conn.request_writable.close();
      connectionAbort.abort("User disconnected");
      setConnectionAbort(new AbortController());
    }

    doDisconnect().catch((e) => {
      console.error("doDisconnect failed", e);
    });
  }, [conn, connectionAbort]);

  const onConnect = useCallback(
    (t: RpcTransport) => {
      const ac = new AbortController();
      setConnectionAbort(ac);
      connect(t, setConn, setConnectedDeviceName, ac.signal).then((ok) => {
        if (!ok) {
          toast("デバイスへの接続に失敗しました", { variant: "error" });
        }
      }).catch((e) => {
        console.error("connect error", e);
        toast(e instanceof Error ? e.message : "接続エラーが発生しました", { variant: "error" });
      });
    },
    [setConn, setConnectedDeviceName, toast]
  );

  // デモ接続: 実機なしでUI全体を確認する（モックRPCを直接ぶら下げる）。
  const onDemo = useCallback(() => {
    setConnectedDeviceName("ZMK Keyboard (Demo)");
    setConn({ conn: createMockConnection() });
  }, [setConn, setConnectedDeviceName]);

  // デバイス切替後の再接続: ble_native_connect でトランスポートを取得して onConnect へ渡す。
  const handleReconnect = useCallback(() => {
    if (!isNativeBleAvailable()) return;
    ble_native_connect()
      .then((t) => onConnect(t))
      .catch((e) => {
        console.error("reconnect failed", e);
        toast(e instanceof Error ? e.message : "再接続に失敗しました", { variant: "error" });
      });
  }, [onConnect, toast]);

  // 機能B: 起動時BLE自動接続
  const [autoConnecting, setAutoConnecting] = useState(false);
  const autoTriedRef = useRef(false);

  useEffect(() => {
    if (autoTriedRef.current) return;
    autoTriedRef.current = true;
    if (!isNativeBleAvailable()) return;
    let cancelled = false;
    (async () => {
      setAutoConnecting(true);
      try {
        const transport = await ble_native_connect();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (cancelled || connRef.current.conn) { (transport as any).abortController?.abort?.("superseded"); return; }
        const ac = new AbortController();
        setConnectionAbort(ac);
        // 自動接続失敗はサイレント（従来モーダルへフォールバック）
        await connect(transport, setConn, setConnectedDeviceName, ac.signal);
      } catch (_e) {
        // 電源OFF/タイムアウト → 静かに諦めて従来モーダルへ
      } finally {
        if (!cancelled) setAutoConnecting(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Read the current keymap + behaviors from the device and serialize to a
  // `.keymap`. In the browser this shows/downloads the result; the desktop
  // (Electron) build additionally commits & pushes to the zmk-config repo
  // (manual button).
  const sync = useCallback(() => {
    async function doSync() {
      if (!conn.conn) {
        return;
      }

      const kmResp = await call_rpc(conn.conn, { keymap: { getKeymap: true } });
      const km = kmResp.keymap?.getKeymap;
      if (!km) {
        return;
      }

      const list = await call_rpc(conn.conn, {
        behaviors: { listAllBehaviors: true },
      });
      const ids = list.behaviors?.listAllBehaviors?.behaviors || [];
      const behaviorMap: BehaviorMap = {};
      for (const id of ids) {
        const d = await call_rpc(conn.conn, {
          behaviors: { getBehaviorDetails: { behaviorId: id } },
        });
        const det = d.behaviors?.getBehaviorDetails;
        if (det) {
          behaviorMap[det.id] = det;
        }
      }

      const message = `keymap: sync from ZMK Forge ${new Date().toISOString()}`;

      if (isDesktop()) {
        // Step 1: preview against the repo's latest. Never pushes here.
        setSyncWarning(false);
        setSyncPending(null);
        try {
          const preview = await desktop()!.syncPreview({
            keymap: km,
            behaviors: behaviorMap,
            message,
          });
          if (!preview.changed) {
            setSyncTitle("Sync to GitHub — already up to date");
            setSyncNote(
              `The device keymap already matches GitHub (${preview.merge.layersReplaced}/${preview.merge.deviceLayers} layers). Nothing to push.`
            );
            setSyncContent(undefined);
          } else {
            setSyncTitle("Review changes before pushing");
            setSyncNote(
              "The device keymap differs from the latest on GitHub. Pushing overwrites GitHub with the device's keymap and starts a firmware build. Review the diff, then confirm."
            );
            setSyncWarning(true);
            setSyncContent(preview.diff);
            setSyncPending({ keymap: km, behaviors: behaviorMap, message });
          }
        } catch (e) {
          setSyncTitle("Sync failed");
          setSyncNote(String(e instanceof Error ? e.message : e));
          setSyncContent(undefined);
        }
        setShowSync(true);
        return;
      }

      setSyncTitle(undefined);
      setSyncNote(undefined);
      setSyncWarning(false);
      setSyncContent(serializeKeymapToDevicetree(km, behaviorMap));
      setShowSync(true);
    }

    doSync().catch((e) => {
      setSyncTitle("Sync failed");
      setSyncNote(String(e instanceof Error ? e.message : e));
      setSyncContent(undefined);
      setShowSync(true);
    });
  }, [conn]);

  // Step 2 (desktop): commit + push the previewed keymap. Triggers a build.
  const confirmSync = useCallback(() => {
    async function doCommit() {
      if (!syncPending) return;
      setSyncBusy(true);
      try {
        const res = await desktop()!.syncCommit(syncPending);
        setSyncTitle("Sync to GitHub — done");
        setSyncNote(
          res.sha
            ? `Committed ${res.sha.slice(0, 7)} (${res.merge.layersReplaced}/${res.merge.deviceLayers} layers) and pushed. A firmware build has started on GitHub.`
            : "No changes — keymap already up to date."
        );
        setSyncContent(undefined);
        setSyncWarning(false);
        setSyncPending(null);
      } catch (e) {
        setSyncTitle("Sync failed");
        setSyncNote(String(e instanceof Error ? e.message : e));
      } finally {
        setSyncBusy(false);
      }
    }
    doCommit();
  }, [syncPending]);

  return (
    <ConnectionContext.Provider value={conn}>
      <LockStateContext.Provider value={lockState}>
        <UndoRedoContext.Provider value={doIt}>
         <UndoControlsContext.Provider value={{ undo, redo, canUndo, canRedo }}>
          <UnlockModal />
          <ConnectModal
            open={!conn.conn}
            transports={TRANSPORTS}
            onTransportCreated={onConnect}
            autoConnecting={autoConnecting}
            onDemo={onDemo}
          />
          <SyncModal
            open={showSync}
            content={syncContent}
            title={syncTitle}
            note={syncNote}
            warning={syncWarning}
            busy={syncBusy}
            onConfirm={syncPending ? confirmSync : undefined}
            confirmLabel="Push to GitHub"
            fileName="keyboard.keymap"
            onClose={() => {
              if (!syncBusy) {
                setShowSync(false);
                setSyncPending(null);
              }
            }}
          />
          <SettingsModal
            open={showSettings}
            onClose={() => setShowSettings(false)}
          />
          <AboutModal open={showAbout} onClose={() => setShowAbout(false)} />
          <LicenseNoticeModal
            open={showLicenseNotice}
            onClose={() => setShowLicenseNotice(false)}
          />
          <div className="bg-base-100 text-base-content h-full max-h-[100vh] w-full max-w-[100vw] inline-grid grid-cols-[auto] grid-rows-[auto_1fr_auto] overflow-hidden">
            <AppHeader
              connectedDeviceLabel={connectedDeviceName}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={undo}
              onRedo={redo}
              onSave={save}
              onDiscard={discard}
              onDisconnect={disconnect}
              onReconnect={isNativeBleAvailable() ? handleReconnect : undefined}
              onResetSettings={resetSettings}
              onSync={sync}
              onShowSettings={isDesktop() ? () => setShowSettings(true) : undefined}
            />
            <Keyboard
              tuningSection={tuningSection}
              onCloseTuning={() => setTuningSection(null)}
              onTuningSectionChange={(s) => setTuningSection(s)}
            />
            <AppFooter
              onShowAbout={() => setShowAbout(true)}
              onShowLicenseNotice={() => setShowLicenseNotice(true)}
            />
          </div>
         </UndoControlsContext.Provider>
        </UndoRedoContext.Provider>
      </LockStateContext.Provider>
    </ConnectionContext.Provider>
  );
}

export default App;
