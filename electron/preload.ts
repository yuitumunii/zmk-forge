// Preload: exposes a minimal, typed bridge to the renderer as window.zmkHome.
// Bundled to dist-electron/preload.cjs by esbuild.

import { contextBridge, ipcRenderer } from "electron";

const api = {
  getSettings: () => ipcRenderer.invoke("zmk:getSettings"),
  setToken: (token: string) => ipcRenderer.invoke("zmk:setToken", token),
  setActiveDevice: (id: string) => ipcRenderer.invoke("zmk:setActiveDevice", id),
  addDevice: (profile: unknown) => ipcRenderer.invoke("zmk:addDevice", profile),
  updateDevice: (id: string, partial: unknown) => ipcRenderer.invoke("zmk:updateDevice", id, partial),
  removeDevice: (id: string) => ipcRenderer.invoke("zmk:removeDevice", id),
  pickClonePath: () => ipcRenderer.invoke("zmk:pickClonePath"),
  sync: (payload: unknown) => ipcRenderer.invoke("zmk:sync", payload),
  syncPreview: (payload: unknown) =>
    ipcRenderer.invoke("zmk:syncPreview", payload),
  syncCommit: (payload: unknown) =>
    ipcRenderer.invoke("zmk:syncCommit", payload),
};

contextBridge.exposeInMainWorld("zmkHome", api);

// Native BLE bridge: the main process owns the noble connection; the renderer
// pumps raw ZMK RPC bytes through here as a transport.
const ble = {
  connect: (): Promise<{ name: string }> => ipcRenderer.invoke("ble:connect"),
  write: (bytes: number[]): Promise<void> =>
    ipcRenderer.invoke("ble:write", bytes),
  disconnect: (): Promise<void> => ipcRenderer.invoke("ble:disconnect"),
  onData: (cb: (bytes: Uint8Array) => void): (() => void) => {
    const handler = (_e: unknown, bytes: Uint8Array) => cb(bytes);
    ipcRenderer.on("ble:data", handler);
    return () => ipcRenderer.removeListener("ble:data", handler);
  },
};

contextBridge.exposeInMainWorld("zmkBle", ble);
