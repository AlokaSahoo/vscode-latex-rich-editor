# Changelog

## 0.2.1

- **Speed (large documents):** moving the cursor in the rich view no longer re-parses the whole file, symbol and reference layers are cached per document, and the tokenizer skips straight to the next LaTeX trigger. On a 7,800-line paper a cursor move went from ~120 ms to ~19 ms and a keystroke from ~120 ms to ~30 ms (2,000 lines: ~20 ms to ~7 ms).
- **Speed (word count, outline, labels):** removed quadratic scans; on the same 7,800-line paper the outline went from ~350 ms to ~6 ms and the word count from ~320 ms to ~16 ms.
- Benchmarks and a CPU profiler live in `bench/` (see its README).

## 0.2.0

- **Equations:** clicking a display equation now opens its LaTeX source (`\begin{equation}…`) with a live rendered preview beneath it, instead of a math field. `align`/`gather`/`multline` render with proper rows, and display math is no longer rewritten when it loses focus.
- **View switching:** *Reopen as Raw LaTeX* / *Open Rich View* and the in-editor Source/Visual toggle keep your cursor position and scroll location.
- **Word count:** appendices, bibliography, acknowledgments and end matter are excluded, and everything after them is ignored. Unnumbered math environments (`gather*`, `eqnarray*`) are no longer charged as two-column. The status bar shows `~` when figure sizes are guessed.
- **Development:** unit tests (`npm test`), a browser harness for the webview, and the patched rendering library pinned to an exact commit.

## 0.1.6

Typing helpers (smart quotes, `$` and `\[` pairs, auto `\end`, `\item` continuation, formatting keys, paste cleanup), Cmd/Ctrl-click go to definition.
