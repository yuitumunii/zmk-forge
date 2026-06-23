// CDP(ポート9222)経由で起動中アプリから AML 診断値を読み出す検証スクリプト。
// 使い方: node scripts/cdp-aml-probe.cjs
const WebSocket = require("ws");
const http = require("http");

function getTargets() {
  return new Promise((resolve, reject) => {
    http
      .get("http://127.0.0.1:9222/json/list", (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(JSON.parse(d)));
      })
      .on("error", reject);
  });
}

async function evalInPage(wsUrl, expr) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { origin: "http://localhost:9222" });
    const timer = setTimeout(() => { ws.close(); reject(new Error("CDP timeout")); }, 8000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true } }));
    });
    ws.on("message", (m) => {
      const msg = JSON.parse(m.toString());
      if (msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        resolve(msg.result?.result?.value ?? msg.result);
      }
    });
    ws.on("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

(async () => {
  const targets = await getTargets();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("page target not found: " + JSON.stringify(targets.map(t => t.type)));
  const out = await evalInPage(
    page.webSocketDebuggerUrl,
    "JSON.stringify({ raw: globalThis.__amlRaw ?? null, diag: globalThis.__amlDiag ?? null, conn: !!(globalThis.__connDbg ?? true) })"
  );
  console.log("PROBE:", out);
})().catch((e) => { console.error("PROBE-ERROR:", e.message); process.exit(1); });
