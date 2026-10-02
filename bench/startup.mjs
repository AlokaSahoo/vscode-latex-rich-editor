// Time from navigation start until the editor shows its first line. usage: node bench/startup.mjs <file.tex>
const file = process.argv[2] ?? "bench/large.tex";
const tabs = await (await fetch("http://127.0.0.1:9333/json")).json();
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, returnByValue: true })).result?.result?.value;
const runs = [];
for (let n = 0; n < 5; n++) {
  await send("Page.navigate", { url: `http://localhost:8765/test/harness/index.html?file=${file}&n=${n}` });
  await new Promise((r) => setTimeout(r, 300));
  for (let i = 0; i < 500; i++) {
    const t = await evaluate("document.querySelector('.cm-line') ? performance.now() : null");
    if (t) { runs.push(t); break; }
    await new Promise((r) => setTimeout(r, 10));
  }
  await new Promise((r) => setTimeout(r, 500));
}
runs.sort((a, b) => a - b);
console.log(file, "first line at", runs[Math.floor(runs.length / 2)].toFixed(0), "ms (median of", runs.length + ")");
const heap = await evaluate("performance.memory.usedJSHeapSize/1048576");
console.log("heap after load:", heap.toFixed(0), "MB");
ws.close(); process.exit(0);
