# Changelog

## 0.2.0

- **Equations:** clicking a display equation now opens its LaTeX source (`\begin{equation}…`) with a live rendered preview beneath it, instead of a math field. `align`/`gather`/`multline` render with proper rows, and display math is no longer rewritten when it loses focus.
- **View switching:** *Reopen as Raw LaTeX* / *Open Rich View* and the in-editor Source/Visual toggle keep your cursor position and scroll location.
- **Word count:** appendices, bibliography, acknowledgments and end matter are excluded, and everything after them is ignored. Unnumbered math environments (`gather*`, `eqnarray*`) are no longer charged as two-column. The status bar shows `~` when figure sizes are guessed.
- **Development:** unit tests (`npm test`), a browser harness for the webview, and the patched rendering library pinned to an exact commit.

## 0.1.6

Typing helpers (smart quotes, `$` and `\[` pairs, auto `\end`, `\item` continuation, formatting keys, paste cleanup), Cmd/Ctrl-click go to definition.
