import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import { fileURLToPath, URL } from "node:url";

// Use the vendored cormoran fork of the ZMK Studio client (adds custom-subsystem
// RPC support, needed for live gesture tuning) in place of the published one.
// Same package name/version/API, so existing imports are unchanged — only the
// resolution target moves to src/vendor. See src/transport/gestureRpc.ts.
const tsClient = fileURLToPath(
  new URL("./src/vendor/zmk-studio-ts-client", import.meta.url)
);

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: /^@zmkfirmware\/zmk-studio-ts-client\/(.*)$/,
        replacement: `${tsClient}/$1`,
      },
      {
        find: /^@zmkfirmware\/zmk-studio-ts-client$/,
        replacement: `${tsClient}/index.ts`,
      },
    ],
  },
  // Relative asset paths so the built app loads over file:// in the Electron
  // desktop shell (absolute "/assets/…" would resolve to the filesystem root).
  base: "./",
  // prevent vite from obscuring rust errors
  clearScreen: false,
  // Tauri expects a fixed port, fail if that port is not available
  server: {
    strictPort: true,
  },
  // to access the Tauri environment variables set by the CLI with information about the current target
  envPrefix: [
    "VITE_",
    "TAURI_PLATFORM",
    "TAURI_ARCH",
    "TAURI_FAMILY",
    "TAURI_PLATFORM_VERSION",
    "TAURI_PLATFORM_TYPE",
    "TAURI_DEBUG",
  ],
  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    target: process.env.TAURI_PLATFORM == "windows" ? "chrome105" : "safari13",
    // don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    // produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
    // Only the main app entry. The upstream zmk-studio "download" page
    // (download.html / DownloadPage.tsx) is web-only and unreachable in the
    // Electron desktop build, so it is excluded from the published artifact.
    rollupOptions: {
      input: {
        main: "./index.html",
      },
    }
  },
});
