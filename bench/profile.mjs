// CPU-profiles cursor moves + keystrokes in the rich view. usage: node bench/profile.mjs <file.tex> [visual|source]
const file = process.argv[2] ?? "bench/huge.tex";
const mode = process.argv[3] ?? "visual";
const port = 9333;
const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(tabs.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); pending.get(m.id)?.(m); };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;
await send("Page.enable");
await send("Page.navigate", { url: `http://localhost:8765/test/harness/index.html?file=${file}` });
for (let i = 0; i < 100 && !(await evaluate("!!window.__lrView")); i++) await new Promise((r) => setTimeout(r, 200));
await new Promise((r) => setTimeout(r, 2000));
await evaluate(`document.querySelector('.lv-mode-btn[data-mode=${mode}]').click(); new Promise(r => setTimeout(r, 1500))`);
await send("Profiler.enable");
await send("Profiler.setSamplingInterval", { interval: 200 });
await send("Profiler.start");
await evaluate(`(() => { const v = window.__lrView; const n = v.state.doc.length;
  for (let i = 0; i < 40; i++) v.dispatch({ selection: { anchor: Math.floor(((i * 37) % 100) / 100 * n) } });
  for (let i = 0; i < 40; i++) { const p = Math.floor(n / 2) + i; v.dispatch({ changes: { from: p, insert: "x" }, selection: { anchor: p + 1 } }); }
  return 1; })()`);
const { result } = await send("Profiler.stop");
const { nodes, samples, timeDeltas } = result.profile;
const byId = new Map(nodes.map((n) => [n.id, n]));
const self = new Map();
samples.forEach((s, i) => { const k = (timeDeltas[i] ?? 0); self.set(s, (self.get(s) ?? 0) + k); });
const agg = new Map();
for (const [nid, t] of self) {
  const f = byId.get(nid).callFrame;
  const key = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber + 1}`;
  agg.set(key, (agg.get(key) ?? 0) + t);
}
const total = [...agg.values()].reduce((a, b) => a + b, 0);
console.log(`${file} [${mode}] total ${(total / 1000).toFixed(0)} ms over 80 dispatches`);
[...agg].sort((a, b) => b[1] - a[1]).slice(0, 18).forEach(([k, t]) => console.log(`${((t / total) * 100).toFixed(1).padStart(5)}%  ${(t / 1000).toFixed(0).padStart(5)} ms  ${k}`));
ws.close(); process.exit(0);
