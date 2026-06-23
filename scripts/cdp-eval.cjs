// CDP(9222)で起動中アプリのrendererに任意式を評価(awaitPromise)。
// 使い方: node scripts/cdp-eval.cjs '<expression>'
const WebSocket = require("ws");
const http = require("http");

const expr = process.argv[2];
if (!expr) { console.error("usage: cdp-eval.cjs '<expr>'"); process.exit(2); }

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
      ws.send(JSON.stringify({
        id: 1, method: "Runtime.evaluate",
        params: { expression: expr, returnByValue: true, awaitPromise: true },
      }));
    });
    ws.on("message", (m) => {
      const msg = JSON.parse(m.toString());
      if (msg.id === 1) {
        clearTimeout(timer); ws.close();
        if (msg.result?.exceptionDetails) {
          console.error("EVAL-EXCEPTION:", JSON.stringify(msg.result.exceptionDetails.exception?.description ?? msg.result.exceptionDetails));
          process.exit(1);
        }
        console.log("EVAL:", JSON.stringify(msg.result?.result?.value));
        resolve();
      }
    });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
})().catch((e) => { console.error("EVAL-ERROR:", e.message); process.exit(1); });
