// Runs the browser benchmark in headless Edge/Chrome over the DevTools protocol.
// usage: node bench/cdp.mjs <file.tex> [port]   (needs the harness served on :8765 and a browser on the debug port)
const file = process.argv[2] ?? "bench/large.tex";
const port = process.argv[3] ?? 9333;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Page.enable");
await send("Page.navigate", { url: `http://localhost:8765/test/harness/index.html?file=${file}&bench=1` });
for (let i = 0; i < 240; i++) {
  await new Promise((r) => setTimeout(r, 500));
  const r = await evaluate("JSON.stringify(window.__benchResult || null)");
  if (r && r !== "null") { console.log(file, r); break; }
}
ws.close();
process.exit(0);
