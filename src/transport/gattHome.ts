// Web Bluetooth transport for ZMK Forge.
//
// This is a fork of @zmkfirmware/zmk-studio-ts-client/transport/gatt that
// changes ONLY the device filter. The upstream transport filters by the ZMK
// Studio *service UUID*, which requires the keyboard to advertise that service
// in its BLE advertisement packet. Some keyboards do NOT include the Studio
// service UUID in their advertisement packet, so the upstream filter never
// surfaces them (requestDevice returns 0 devices and the scan hangs forever).
//
// Fix: use only the service UUID filter so the browser's device picker shows
// any ZMK Studio-capable keyboard. The service is still listed in
// optionalServices so GATT access works once connected.
// Everything after requestDevice is identical to upstream.

import { UserCancelledError } from "@zmkfirmware/zmk-studio-ts-client/transport/errors";
import type { RpcTransport } from "@zmkfirmware/zmk-studio-ts-client/transport/index";

const SERVICE_UUID = "00000000-0196-6107-c967-c5cfb1c2482a";
const RPC_CHRC_UUID = "00000001-0196-6107-c967-c5cfb1c2482a";

export async function connect(): Promise<RpcTransport> {
  const dev = await navigator.bluetooth
    .requestDevice({
      // Filter by the ZMK Studio service UUID so any compliant ZMK keyboard
      // appears in the browser's device picker. optionalServices grants GATT
      // access after the user selects the device.
      filters: [{ services: [SERVICE_UUID] }],
      optionalServices: [SERVICE_UUID],
    })
    .catch((e) => {
      if (e instanceof DOMException && e.name === "NotFoundError") {
        throw new UserCancelledError("User cancelled the connection attempt", {
          cause: e,
        });
      }
      throw e;
    });

  if (!dev.gatt) {
    throw "No GATT service!";
  }

  const abortController = new AbortController();
  const label = dev.name || "Unknown";

  if (!dev.gatt.connected) {
    await dev.gatt.connect();
  }

  const svc = await dev.gatt.getPrimaryService(SERVICE_UUID);
  const char = await svc.getCharacteristic(RPC_CHRC_UUID);

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Reconnecting to the same device loses notifications unless we stop
      // first before starting again.
      await char.stopNotifications();
      await char.startNotifications();
      const vc = (ev: Event) => {
        const buf = (ev.target as unknown as { value?: DataView })?.value
          ?.buffer;
        if (!buf) {
          return;
        }
        controller.enqueue(new Uint8Array(buf));
      };
      char.addEventListener("characteristicvaluechanged", vc);
      const cb = async () => {
        char.removeEventListener("characteristicvaluechanged", vc);
        dev.removeEventListener("gattserverdisconnected", cb);
        controller.close();
      };
      dev.addEventListener("gattserverdisconnected", cb);
    },
  });

  const writable = new WritableStream<Uint8Array>({
    write(chunk) {
      return char.writeValueWithoutResponse(chunk);
    },
  });

  const sig = abortController.signal;
  const abort_cb = async () => {
    sig.removeEventListener("abort", abort_cb);
    dev.gatt?.disconnect();
  };
  sig.addEventListener("abort", abort_cb);

  return { label, abortController, readable, writable };
}
