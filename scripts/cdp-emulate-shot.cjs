// CDP(9222)でビューポートを任意サイズにエミュレートし、式評価→スクショを1セッションで行う。
// 使い方: node scripts/cdp-emulate-shot.cjs <width> <height> <outPng> ['<click-expr>']
const WebSocket = require("ws");
const http = require("http");
const fs = require("fs");

const W = Number(process.argv[2] || 3840);
const H = Number(process.argv[3] || 2098);
const out = process.argv[4] || "/tmp/zmk-emu.png";
const clickExpr = process.argv[5]; // optional JS to run before measuring

function targets() {
  return new Promise((res, rej) => {
    http.get("http://127.0.0.1:9222/json/list", (r) => {
      let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => res(JSON.parse(d)));
    }).on("error", rej);
  });
}

(async () => {
  const t = await targets();
  const page = t.find((x) => x.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl, { origin: "http://localhost:9222" });
  let id = 0;
  const send = (m, p = {}) =>
    new Promise((r) => {
      const myid = ++id;
      const h = (msg) => {
        const j = JSON.parse(msg.toString());
        if (j.id === myid) { ws.off("message", h); r(j.result); }
      };
      ws.on("message", h);
      ws.send(JSON.stringify({ id: myid, method: m, params: p }));
    });

  await new Promise((r) => ws.on("open", r));
  await send("Emulation.setDeviceMetricsOverride", {
    width: W, height: H, deviceScaleFactor: 1, mobile: false,
  });
  // give layout a tick
  await new Promise((r) => setTimeout(r, 400));

  if (clickExpr) {
    await send("Runtime.evaluate", { expression: clickExpr, awaitPromise: true });
    await new Promise((r) => setTimeout(r, 1200));
  }

  const measure = await send("Runtime.evaluate", {
    expression: `(function(){var m=document.querySelector("[role=dialog]");var r=m?m.getBoundingClientRect():null;return JSON.stringify({win:{w:window.innerWidth,h:window.innerHeight},modal:r?{w:Math.round(r.width),h:Math.round(r.height),leftPad:Math.round(r.left),rightPad:Math.round(window.innerWidth-r.right)}:null});})()`,
    returnByValue: true,
  });
  console.log("MEASURE:", measure.result.value);

  const shot = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(out, Buffer.from(shot.data, "base64"));
  console.log("SHOT:", out);

  await send("Emulation.clearDeviceMetricsOverride");
  ws.close();
})();
