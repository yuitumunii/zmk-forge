// CDP(9222)で起動中アプリのスクリーンショットを撮る。
// 使い方: node scripts/cdp-screenshot.cjs /tmp/shot.png
const WebSocket = require("ws");
const http = require("http");
const fs = require("fs");

const outPath = process.argv[2] || "/tmp/zmk-shot.png";

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get("http://127.0.0.1:9222/json/list", (res) => {
      let d = ""; res.on("data", (c) => (d += c));
      res.on("end", () => resolve(JSON.parse(d)));
    }).on("error", reject);
  });
}

(async () => {
  const targets = await getTargets();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("page target not found");
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(page.webSocketDebuggerUrl, { origin: "http://localhost:9222" });
    const timer = setTimeout(() => { ws.close(); reject(new Error("CDP timeout")); }, 15000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: { format: "png" } }));
    });
    ws.on("message", (m) => {
      const msg = JSON.parse(m.toString());
      if (msg.id === 1) {
        clearTimeout(timer); ws.close();
        if (!msg.result?.data) { reject(new Error("no data: " + m)); return; }
        fs.writeFileSync(outPath, Buffer.from(msg.result.data, "base64"));
        console.log("SAVED:", outPath);
        resolve();
      }
    });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
})().catch((e) => { console.error("SHOT-ERROR:", e.message); process.exit(1); });
