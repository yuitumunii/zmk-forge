// Native BLE transport (main process) for ZMK Forge.
//
// Web Bluetooth (Chromium) refuses ZMK keyboards because they are HID devices
// ("Unsupported device"). So we talk BLE natively via @stoprocent/noble in the
// main process and bridge raw RPC bytes to the renderer over IPC.
//
// Flow: connect to a ZMK Studio keyboard (by cached UUID if known — works even
// while it's connected to macOS as an HID keyboard, as long as it is bonded;
// otherwise scan for a ZMK keyboard advertising the HID service, connect, and
// confirm the ZMK Studio service exists in its GATT before caching its UUID),
// discover the ZMK Studio service + RPC characteristic, subscribe to
// notifications, and expose write.

import { ipcMain, type BrowserWindow } from "electron";

// noble UUIDs are lowercase, dashless.
const SERVICE_UUID = "0000000001966107c967c5cfb1c2482a";
const RPC_CHRC_UUID = "0000000101966107c967c5cfb1c2482a";

type Dbg = (...parts: unknown[]) => void;

interface BleDeps {
  getWindow: () => BrowserWindow | null;
  getCachedUuid: () => Promise<string | undefined>;
  setCachedUuid: (uuid: string) => Promise<void>;
  dbg: Dbg;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- noble is a dynamic native require, no public typedefs
let noble: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- return type matches the dynamic noble module
function loadNoble(dbg: Dbg): any {
  if (!noble) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require("@stoprocent/noble");
    noble = mod.default || mod;
    dbg("[ble] noble loaded, binding=", noble._bindings?.constructor?.name);
  }
  return noble;
}

// Scan for a ZMK keyboard, then connect to the one that actually exposes the
// ZMK Studio service.
//
// IMPORTANT: ZMK keyboards do NOT put the ZMK Studio service UUID in their BLE
// advertisement — the advertisement only carries the HID (0x1812) and Battery
// (0x180f) services; the Studio service appears only in the GATT table after
// connecting. So filtering the advertisement on the Studio UUID never matches a
// real keyboard. Instead we treat any device advertising the HID service (or,
// as a fast path, the Studio UUID itself) as a candidate, connect, and confirm
// the Studio service is present in the GATT. If it isn't, we disconnect and keep
// scanning. Matching on the HID service rather than a hardcoded name keeps this
// generic across ZMK keyboards.
const HID_SERVICE_UUID = "1812"; // 0x1812 Human Interface Device (noble short form)
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- noble peripheral is untyped native bridge
function scanAndConnect(n: any, dbg: Dbg, timeoutMs = 20000): Promise<any> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let busy = false; // connecting/verifying one candidate at a time
    const rejected = new Set<string>(); // device ids confirmed to NOT be ZMK Studio
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- noble peripheral event payload is untyped
    const onDiscover = async (p: any) => {
      if (settled || busy || rejected.has(p.id)) return;
      const uuids: string[] = (p.advertisement?.serviceUuids ?? []).map(
        (u: string) => u.toLowerCase().replace(/-/g, "")
      );
      const advertisesStudio = uuids.includes(SERVICE_UUID);
      const looksLikeKeyboard = uuids.includes(HID_SERVICE_UUID);
      if (!advertisesStudio && !looksLikeKeyboard) {
        dbg("[ble] skipping device (not a keyboard):", p.id, p.advertisement?.localName, uuids);
        return; // keep scanning
      }
      busy = true;
      try {
        dbg("[ble] candidate, connecting to verify ZMK Studio service…", p.id, p.advertisement?.localName);
        await p.connectAsync();
        const { services } =
          await p.discoverSomeServicesAndCharacteristicsAsync([SERVICE_UUID], []);
        if (services && services.length) {
          settled = true;
          n.removeListener("discover", onDiscover);
          await n.stopScanningAsync().catch(() => {});
          dbg("[ble] ZMK Studio service confirmed, connected", p.id, p.advertisement?.localName);
          resolve(p);
          return;
        }
        // Connected fine but no Studio service -> not a ZMK Studio device.
        rejected.add(p.id);
        dbg("[ble] no ZMK Studio service on", p.id, "— disconnecting, keep scanning");
        await p.disconnectAsync().catch(() => {});
      } catch (e) {
        // Transient connect/discover failure: do NOT blacklist; allow a retry.
        dbg("[ble] candidate connect/verify failed, keep scanning:", p.id, String(e));
        try {
          await p.disconnectAsync();
        } catch {
          /* ignore */
        }
      } finally {
        if (!settled) busy = false;
      }
    };
    n.on("discover", onDiscover);
    // allowDuplicates=true so a device we passed over while busy with another
    // candidate is reported again rather than missed.
    n.startScanningAsync([], true).catch(reject);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      n.removeListener("discover", onDiscover);
      n.stopScanning();
      reject(
        new Error(
          "ZMK Studio device not found. Turn the keyboard on and try again (put it in pairing mode for the first connection)."
        )
      );
    }, timeoutMs);
  });
}

// モジュールスコープで保持: アプリ終了時に shutdownBle() から後始末できるように。
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- noble peripheral object is untyped
let peripheral: any = null;

// アプリ終了時のBLE後始末(ベストエフォート)。CoreBluetoothのネイティブ接続が
// 残っていると app.quit() が完了せず「応答なし」ゾンビになるため、
// quit前にスキャン停止+切断を試みる。失敗しても main.ts 側の強制exitで必ず死ぬ。
export async function shutdownBle(): Promise<void> {
  try {
    noble?.stopScanning?.();
  } catch {
    /* best effort */
  }
  try {
    await peripheral?.disconnectAsync?.();
  } catch {
    /* best effort */
  }
  peripheral = null;
}

export function registerBleIpc(deps: BleDeps): void {
  const { getWindow, getCachedUuid, setCachedUuid, dbg } = deps;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- noble characteristic object is untyped
  let rpcChar: any = null;
  // Write type is chosen from the characteristic's advertised properties.
  // Some ZMK keyboards' RPC characteristic is ["read","write","indicate"] —
  // they only support *acknowledged* writes, so a write-without-response is
  // silently dropped (the controller still resolves "ok"), which is why the
  // device never indicated a reply. Default to with-response; only go
  // without-response when the property is actually present.
  let writeWithoutResponse = false;

  ipcMain.handle("ble:connect", async (): Promise<{ name: string }> => {
    const n = loadNoble(dbg);
    await n.waitForPoweredOnAsync();

    // 1) Try the cached UUID — direct connect works even while the keyboard is
    //    an active HID device, as long as it is bonded to this Mac.
    peripheral = null;
    const cached = await getCachedUuid();
    if (cached) {
      try {
        dbg("[ble] connect by cached uuid", cached);
        peripheral = await n.connectAsync(cached);
        dbg("[ble] cached connect ok, state=", peripheral.state);
      } catch (e) {
        dbg("[ble] cached connect failed, will scan:", String(e));
        peripheral = null;
      }
    }

    // 2) Otherwise scan for it advertising, then remember its UUID.
    if (!peripheral) {
      peripheral = await scanAndConnect(n, dbg);
      try {
        await setCachedUuid(peripheral.id);
      } catch {
        /* non-fatal */
      }
    }

    if (peripheral.state !== "connected") {
      await peripheral.connectAsync();
    }

    const { characteristics } =
      await peripheral.discoverSomeServicesAndCharacteristicsAsync(
        [SERVICE_UUID],
        [RPC_CHRC_UUID]
      );
    if (!characteristics.length) {
      throw new Error("ZMK Studio RPC characteristic not found on device");
    }
    rpcChar = characteristics[0];
    const props: string[] = rpcChar.properties || [];
    writeWithoutResponse = props.includes("writeWithoutResponse");
    dbg(
      "[ble] rpcChar discovered uuid=" + rpcChar.uuid,
      "props=" + JSON.stringify(props),
      "writeWithoutResponse=" + writeWithoutResponse
    );

    rpcChar.removeAllListeners?.("data");
    rpcChar.on("data", (data: Buffer) => {
      const win = getWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send("ble:data", new Uint8Array(data));
      }
    });
    await rpcChar.subscribeAsync();

    const name = peripheral.advertisement?.localName || "ZMK Keyboard";
    dbg("[ble] connected + subscribed:", name);
    return { name };
  });

  ipcMain.handle("ble:write", async (_e, bytes: number[] | Uint8Array) => {
    if (!rpcChar) throw new Error("BLE not connected");
    // Write type is dictated by the characteristic's properties (see connect):
    // some ZMK keyboards' RPC char only supports acknowledged writes.
    await rpcChar.writeAsync(Buffer.from(bytes as Uint8Array), writeWithoutResponse);
  });

  ipcMain.handle("ble:disconnect", async () => {
    try {
      await peripheral?.disconnectAsync?.();
    } catch {
      /* ignore */
    }
    peripheral = null;
    rpcChar = null;
  });
}
