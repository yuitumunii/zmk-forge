#!/usr/bin/env node
// Dev harness: drive the running Electron renderer over Chrome DevTools
// Protocol (port 9222, opened by main.ts in dev). Lets the dev loop read the
// DOM and click buttons without a visible screen.
//
// Usage:
//   node scripts/cdp.mjs eval '<js expression>'   # evaluate, print JSON result
//   node scripts/cdp.mjs text                      # print document.body.innerText
//   node scripts/cdp.mjs buttons                   # list all button labels
//   node scripts/cdp.mjs click '<label regex>'     # click first matching button
//
// Requires Node 22+ (global WebSocket).

const PORT = process.env.ZMK_CDP_PORT || "9222";
const HOST = "127.0.0.1"; // CDP binds IPv4 only; avoid localhost->::1 mismatch.

async function getPageTarget() {
  const res = await fetch(`http://${HOST}:${PORT}/json`);
  const targets = await res.json();
  // Match the app page whether served by Vite (localhost:5173) or loaded from
  // the built dist (file://…/index.html). Exclude DevTools/chrome targets.
  const page = targets.find(
    (t) =>
      t.type === "page" &&
      (/localhost:5173/.test(t.url) || /index\.html/.test(t.url)) &&
      !/^devtools:|^chrome:/.test(t.url)
  );
  if (!page) {
    throw new Error(
      "No app page target. Targets: " +
        JSON.stringify(targets.map((t) => ({ type: t.type, url: t.url })))
    );
  }
  return page.webSocketDebuggerUrl.replace("localhost", HOST);
}

function rpc(ws, id, method, params) {
  return new Promise((resolve, reject) => {
    const onMsg = (event) => {
      const msg = JSON.parse(
        typeof event.data === "string" ? event.data : event.data.toString()
      );
      if (msg.id === id) {
        ws.removeEventListener("message", onMsg);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(ws, expression) {
  const result = await rpc(ws, Date.now() % 100000, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    // Treat as a user gesture so APIs gated on user activation
    // (navigator.bluetooth.requestDevice, serial.requestPort) can run.
    userGesture: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      "Renderer exception: " +
        (result.exceptionDetails.exception?.description ||
          result.exceptionDetails.text)
    );
  }
  return result.result.value;
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const wsUrl = await getPageTarget();
  const ws = new WebSocket(wsUrl);
  await new Promise((r, j) => {
    ws.addEventListener("open", r, { once: true });
    ws.addEventListener("error", j, { once: true });
  });
  await rpc(ws, 1, "Runtime.enable", {});

  let expr;
  switch (cmd) {
    case "eval":
      expr = arg;
      break;
    case "text":
      expr = "document.body.innerText";
      break;
    case "buttons":
      expr =
        "JSON.stringify([...document.querySelectorAll('button')].map(b => (b.textContent||'').trim() || b.getAttribute('aria-label') || '(icon)'))";
      break;
    case "click":
      expr = `(() => { const re = new RegExp(${JSON.stringify(
        arg
      )}, 'i'); const b = [...document.querySelectorAll('button')].find(x => re.test((x.textContent||'') + ' ' + (x.getAttribute('aria-label')||''))); if (!b) return 'NO MATCH for ' + ${JSON.stringify(
        arg
      )} + ' :: ' + JSON.stringify([...document.querySelectorAll('button')].map(x=>(x.textContent||'').trim())); b.click(); return 'clicked: ' + ((b.textContent||'').trim() || b.getAttribute('aria-label')); })()`;
      break;
    default:
      console.error("Unknown command: " + cmd);
      process.exit(2);
  }

  const value = await evaluate(ws, expr);
  console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
  ws.close();
}

main().catch((e) => {
  console.error("CDP ERROR:", e.message);
  process.exit(1);
});
