// CDPでページをリロードし、例外/console.errorを10秒間採取する診断スクリプト。
const WebSocket = require("ws");
const http = require("http");

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
  const ws = new WebSocket(page.webSocketDebuggerUrl, { origin: "http://localhost:9222" });
  let id = 0;
  const send = (method, params = {}) => ws.send(JSON.stringify({ id: ++id, method, params }));
  ws.on("open", () => {
    send("Runtime.enable");
    send("Log.enable");
    send("Page.enable");
    setTimeout(() => send("Page.reload", { ignoreCache: true }), 300);
    setTimeout(() => { ws.close(); process.exit(0); }, 10000);
  });
  ws.on("message", (m) => {
    const msg = JSON.parse(m.toString());
    if (msg.method === "Runtime.exceptionThrown") {
      const d = msg.params.exceptionDetails;
      console.log("EXCEPTION:", d.text, d.exception?.description?.split("\n").slice(0, 6).join(" | ") ?? "");
    }
    if (msg.method === "Runtime.consoleAPICalled" && (msg.params.type === "error" || msg.params.type === "warning")) {
      const args = msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ");
      console.log(msg.params.type.toUpperCase() + ":", args.split("\n").slice(0, 4).join(" | "));
    }
    if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") {
      console.log("LOG:", msg.params.entry.text.slice(0, 300));
    }
  });
  ws.on("error", (e) => { console.error("WS-ERROR:", e.message); process.exit(1); });
})().catch((e) => { console.error("ERR:", e.message); process.exit(1); });
