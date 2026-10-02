// Paste into the harness page's console (or run via the browser tool) after loading
// test/harness/index.html?file=bench/large.tex. Reports median ms per operation.
(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  while (!window.__lrView) await wait(50);
  await wait(1500);
  const view = window.__lrView;
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
  // dispatch + the layout/paint work it triggers
  // Returns the synchronous dispatch cost (state + decorations + DOM update); the layout after it is added separately.
  const timed = async (fn) => { const t = performance.now(); fn(); const sync = performance.now() - t; view.requestMeasure(); void document.body.offsetHeight; await frame(); (timed.sync ??= []).push(sync); return performance.now() - t; };
  const doc = () => view.state.doc;
  const result = { lines: doc().lines, chars: doc().length };
  const mode = (m) => { document.querySelector(`.lv-mode-btn[data-mode=${m}]`).click(); return wait(1500); };

  for (const m of ["visual", "source"]) {
    await mode(m);
    const cursor = [], typing = [], scroll = [];
    const syncOf = (from) => +median(timed.sync.slice(from)).toFixed(1);
    timed.sync = [];
    for (let i = 0; i < 25; i++) {
      const pos = Math.floor(((i * 37) % 100) / 100 * doc().length);
      cursor.push(await timed(() => view.dispatch({ selection: { anchor: pos } })));
    }
    for (let i = 0; i < 25; i++) {
      const pos = Math.floor(doc().length * 0.5) + i;
      typing.push(await timed(() => view.dispatch({ changes: { from: pos, insert: "x" }, selection: { anchor: pos + 1 } })));
    }
    for (let i = 0; i < 15; i++) {
      scroll.push(await timed(() => { view.scrollDOM.scrollTop = (i * 997) % Math.max(1, view.scrollDOM.scrollHeight - 700); }));
    }
    result[m] = { cursorMove: +median(cursor).toFixed(1), cursorSync: syncOf(0), keystroke: +median(typing).toFixed(1), keystrokeSync: syncOf(25), scroll: +median(scroll).toFixed(1) };
  }
  await mode("visual");
  result.heapMB = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  result.domNodes = document.getElementsByTagName("*").length;
  window.__benchResult = result;
  window.__benchResult = result;
  return result;
})();
