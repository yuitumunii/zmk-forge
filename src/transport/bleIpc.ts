// Renderer-side BLE transport for the Electron desktop. The actual Bluetooth
// connection lives in the main process (electron/bleNative.ts via noble),
// because Chromium's Web Bluetooth refuses HID keyboards. Here we just adapt
// the IPC bridge (window.zmkBle) into the RpcTransport the ZMK client expects.

import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";

interface ZmkBleBridge {
  connect(): Promise<{ name: string }>;
  write(bytes: number[]): Promise<void>;
  disconnect(): Promise<void>;
  onData(cb: (bytes: Uint8Array) => void): () => void;
}

declare global {
  interface Window {
    zmkBle?: ZmkBleBridge;
  }
}

export function isNativeBleAvailable(): boolean {
  return typeof window !== "undefined" && !!window.zmkBle;
}

export async function connect(): Promise<RpcTransport> {
  const ble = window.zmkBle;
  if (!ble) {
    throw new Error("Native BLE bridge unavailable");
  }

  // Opens the noble connection in the main process (may scan on first use).
  const { name } = await ble.connect();

  const abortController = new AbortController();
  let unsubscribe: (() => void) | undefined;

  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      unsubscribe = ble.onData((bytes) => {
        controller.enqueue(new Uint8Array(bytes));
      });
      abortController.signal.addEventListener(
        "abort",
        () => {
          unsubscribe?.();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
          ble.disconnect().catch(() => {});
        },
        { once: true }
      );
    },
    cancel() {
      unsubscribe?.();
      ble.disconnect().catch(() => {});
    },
  });

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      // IPC structured-clone is happiest with a plain array.
      return ble.write(Array.from(chunk));
    },
  });

  return { label: name || "ZMK Keyboard (BLE)", abortController, readable, writable };
}
