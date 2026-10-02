import { Annotation, EditorSelection, type EditorState, type Extension, Prec, type TransactionSpec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { REFERENCE_CALL } from "../shared/latexText";

// Small typing helpers for the rich view. Shortcuts use CodeMirror's "Mod",
// which is ⌘ on macOS and Ctrl on Windows/Linux.

const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

// --- Context ------------------------------------------------------------------

/** True inside $…$, \(…\), \[…\] or a math environment (by scanning the text before `pos`). */
function inMath(state: EditorState, pos: number): boolean {
  const before = state.doc.sliceString(Math.max(0, pos - 4000), pos);
  const dollars = (before.replace(/\\\$/g, "").match(/\$/g) ?? []).length;
  if (dollars % 2 === 1) return true;
  const opens = (before.match(/\\[[(]/g) ?? []).length;
  const closes = (before.match(/\\[\])]/g) ?? []).length;
  if (opens > closes) return true;
  const envs = [...before.matchAll(/\\(begin|end)\{(equation|align|gather|multline|eqnarray|flalign|alignat)\*?\}/g)];
  return envs.length > 0 && envs[envs.length - 1][1] === "begin";
}

const before = (state: EditorState, pos: number, n = 1) => state.doc.sliceString(Math.max(0, pos - n), pos);
const after = (state: EditorState, pos: number, n = 1) => state.doc.sliceString(pos, Math.min(state.doc.length, pos + n));

// --- Typed characters: surround, smart quotes, $ pairs, \[ \( pairs, ~ before \ref ---

const SURROUND: Record<string, [string, string]> = {
  $: ["$", "$"],
  "(": ["(", ")"],
  "[": ["[", "]"],
  "{": ["{", "}"],
  "`": ["``", "''"],
  '"': ["``", "''"],
};

const NBSP_BEFORE = /([\w.)])( )\\(ref|eqref|cref|Cref|autoref|pageref|cite|citep|citet|onlinecite)$/;

const typing = EditorView.inputHandler.of((view, from, to, text) => {
  const { state } = view;
  const ranges = state.selection.ranges;

  // 1. Surround a selection.
  if (SURROUND[text] && ranges.some((r) => !r.empty)) {
    const [open, close] = SURROUND[text];
    view.dispatch(
      state.changeByRange((range) =>
        range.empty
          ? { changes: { from: range.from, insert: text }, range: EditorSelection.cursor(range.from + text.length) }
          : {
              changes: [
                { from: range.from, insert: open },
                { from: range.to, insert: close },
              ],
              range: EditorSelection.range(range.from + open.length, range.to + open.length),
            },
      ),
    );
    return true;
  }
  if (from !== to || ranges.length > 1) return false;
  const prev = before(state, from);
  const next = after(state, from);

  // 2. Smart quotes: "  →  `` at a word start, '' at a word end.
  if (text === '"' && !inMath(state, from) && prev !== "\\") {
    const opening = from === 0 || /[\s([{~]/.test(prev);
    view.dispatch({ changes: { from, insert: opening ? "``" : "''" }, selection: { anchor: from + 2 } });
    return true;
  }

  // 3. $ pairs: $ → $|$; inside an empty pair → $$|$$ (display); before a $ → step over.
  if (text === "$" && prev !== "\\") {
    if (prev === "$" && next === "$") {
      view.dispatch({ changes: { from, insert: "$$" }, selection: { anchor: from + 1 } });
      return true;
    }
    if (next === "$" && inMath(state, from)) {
      view.dispatch({ selection: { anchor: from + 1 } });
      return true;
    }
    if (!inMath(state, from) && (next === "" || /[\s.,;:)\]}]/.test(next))) {
      view.dispatch({ changes: { from, insert: "$$" }, selection: { anchor: from + 1 } });
      return true;
    }
  }

  // 4. \[ → \[ | \]   and   \( → \( | \)
  if ((text === "[" || text === "(") && prev === "\\" && before(state, from, 2) !== "\\\\") {
    const close = text === "[" ? "\\]" : "\\)";
    view.dispatch({ changes: { from, insert: `${text}  ${close}` }, selection: { anchor: from + 2 } });
    return true;
  }

  // 5. "Fig. \ref{" → "Fig.~\ref{" (keeps the number on the same line). Let
  //    the "{" itself be typed normally (so bracket auto-closing still works).
  if (text === "{") {
    const line = state.doc.lineAt(from);
    const m = NBSP_BEFORE.exec(line.text.slice(0, from - line.from));
    if (m) {
      const space = line.from + m.index + m[1].length;
      view.dispatch({ changes: { from: space, to: space + 1, insert: "~" } });
    }
  }
  return false;
});

// --- Enter: \begin{…} → add \end{…}; continue \item lists ---------------------------

const LIST_ENV = /^(itemize|enumerate|description)$/;

function enclosingEnvironment(state: EditorState, pos: number): string | undefined {
  const text = state.doc.sliceString(Math.max(0, pos - 20000), pos);
  const stack: string[] = [];
  for (const m of text.matchAll(/\\(begin|end)\{([^}]+)\}/g)) {
    if (m[1] === "begin") stack.push(m[2]);
    else {
      const i = stack.lastIndexOf(m[2]);
      if (i >= 0) stack.splice(i);
    }
  }
  return stack[stack.length - 1];
}

function enter(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(range.head);
  const head = line.text.slice(0, range.head - line.from);
  const tail = line.text.slice(range.head - line.from);
  const indent = /^\s*/.exec(line.text)![0];

  // \begin{name}[args]|  →  add a matching \end{name} if there isn't one yet.
  const begin = /\\begin\{([^}]+)\}(\[[^\]]*\]|\{[^}]*\})*\s*$/.exec(head);
  if (begin && tail.trim() === "") {
    const name = begin[1];
    const rest = state.doc.sliceString(range.head);
    const opens = (rest.match(new RegExp(`\\\\begin\\{${escape(name)}\\}`, "g")) ?? []).length;
    const closes = (rest.match(new RegExp(`\\\\end\\{${escape(name)}\\}`, "g")) ?? []).length;
    if (closes <= opens) {
      const inner = `\n${indent}  ${LIST_ENV.test(name) ? "\\item " : ""}`;
      view.dispatch({
        changes: { from: range.head, insert: `${inner}\n${indent}\\end{${name}}` },
        selection: { anchor: range.head + inner.length },
        scrollIntoView: true,
      });
      return true;
    }
  }

  // \item lists: Enter adds an \item; Enter on an empty \item ends the list items.
  if (LIST_ENV.test(enclosingEnvironment(state, range.head) ?? "") && /^\s*\\item\b/.test(line.text)) {
    if (/^\s*\\item\s*$/.test(line.text) && tail.trim() === "") {
      view.dispatch({ changes: { from: line.from, to: line.to, insert: "" }, selection: { anchor: line.from } });
      return true;
    }
    const insert = `\n${indent}\\item `;
    view.dispatch({ changes: { from: range.head, insert }, selection: { anchor: range.head + insert.length }, scrollIntoView: true });
    return true;
  }
  return false;
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// --- Renaming \begin{…} renames the matching \end{…} -------------------------------

const syncEnvironmentNames = EditorView.updateListener.of((update) => {
  if (!update.docChanged || update.transactions.some((tr) => tr.annotation(syncingNames))) return;
  if (!update.transactions.some((tr) => tr.isUserEvent("input") || tr.isUserEvent("delete"))) return;
  const { state, startState } = update;
  const pos = state.selection.main.head;
  const line = state.doc.lineAt(pos);
  const column = pos - line.from;
  for (const m of line.text.matchAll(/\\(begin|end)\{([^}]*)\}/g)) {
    const nameFrom = m.index! + m[1].length + 2;
    const nameTo = nameFrom + m[2].length;
    if (column < nameFrom || column > nameTo) continue;
    // What did this name say before the edit?
    const oldPos = update.changes.invertedDesc.mapPos(line.from + nameFrom);
    const oldLine = startState.doc.lineAt(oldPos);
    const oldMatch = /^\\(begin|end)\{([^}]*)\}/.exec(oldLine.text.slice(oldPos - oldLine.from - m[1].length - 2));
    const oldName = oldMatch?.[2];
    if (!oldName || oldName === m[2]) return;
    const partner = findPartner(state, line.from + m.index!, m[1] === "begin", oldName);
    if (partner === undefined) return;
    const spec: TransactionSpec = { changes: { from: partner, to: partner + oldName.length, insert: m[2] }, annotations: syncingNames.of(true) };
    queueMicrotask(() => update.view.dispatch(spec));
    return;
  }
});

const syncingNames = Annotation.define<boolean>();

/** Offset of the name inside the matching \end{oldName} (or \begin{oldName} when renaming an \end). */
function findPartner(state: EditorState, at: number, isBegin: boolean, oldName: string): number | undefined {
  const text = state.doc.toString();
  const pattern = new RegExp(`\\\\(begin|end)\\{${escape(oldName)}\\}`, "g");
  if (isBegin) {
    let depth = 0;
    pattern.lastIndex = text.indexOf("}", at) + 1;
    for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
      if (m[1] === "begin") depth++;
      else if (depth-- === 0) return m.index + "\\end{".length;
    }
  } else {
    const matches = [...text.slice(0, at).matchAll(pattern)].reverse();
    let depth = 0;
    for (const m of matches) {
      if (m[1] === "end") depth++;
      else if (depth-- === 0) return m.index! + "\\begin{".length;
    }
  }
  return undefined;
}

// --- Formatting keys ---------------------------------------------------------------

function wrapWith(open: string, close: string) {
  return (view: EditorView) => {
    view.dispatch(
      view.state.changeByRange((range) => ({
        changes: [
          { from: range.from, insert: open },
          { from: range.to, insert: close },
        ],
        range: range.empty
          ? EditorSelection.cursor(range.from + open.length)
          : EditorSelection.range(range.from + open.length, range.to + open.length),
      })),
    );
    return true;
  };
}

/** Wraps the selected lines in \begin{env}…\end{env} with both names selected, so typing names both. */
function wrapInEnvironment(view: EditorView): boolean {
  const { state } = view;
  const range = state.selection.main;
  const first = state.doc.lineAt(range.from);
  const last = state.doc.lineAt(range.to);
  const indent = /^\s*/.exec(first.text)![0];
  const body = state.doc.sliceString(first.from, last.to);
  const placeholder = "env";
  const open = `${indent}\\begin{${placeholder}}\n`;
  const inner = body.split("\n").map((l) => (l ? `  ${l}` : l)).join("\n");
  const insert = `${open}${inner}\n${indent}\\end{${placeholder}}`;
  const beginName = first.from + indent.length + "\\begin{".length;
  const endName = first.from + open.length + inner.length + 1 + indent.length + "\\end{".length;
  view.dispatch({
    changes: { from: first.from, to: last.to, insert },
    selection: EditorSelection.create([
      EditorSelection.range(beginName, beginName + placeholder.length),
      EditorSelection.range(endName, endName + placeholder.length),
    ]),
  });
  return true;
}

// --- Paste from PDF / Word: make it LaTeX-safe ----------------------------------------

export function cleanPastedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/(\w)-\n(\w)/g, "$1$2") // hyphenation at line ends
    .replace(/([^\n])\n(?=[^\n])/g, "$1 ") // PDF line wraps inside a paragraph
    .replace(/[“„]/g, "``")
    .replace(/”/g, "''")
    .replace(/‘/g, "`")
    .replace(/’/g, "'")
    .replace(/—/g, "---")
    .replace(/–/g, "--")
    .replace(/…/g, "\\ldots{}")
    .replace(/ /g, "~")
    .replace(/ﬁ/g, "fi")
    .replace(/ﬂ/g, "fl")
    .replace(/ﬀ/g, "ff")
    .replace(/(^|[^\\])([%&#_])/g, "$1\\$2")
    .replace(/(^|[^\\])([%&#_])/g, "$1\\$2"); // twice: adjacent specials like "%&"
}

const smartPaste = EditorView.domEventHandlers({
  paste(event, view) {
    const text = event.clipboardData?.getData("text/plain");
    // Only plain prose; anything that already looks like LaTeX is pasted as is.
    if (!text || event.clipboardData?.files.length || /\\[A-Za-z]|\$/.test(text) || inMath(view.state, view.state.selection.main.from)) return false;
    const cleaned = cleanPastedText(text);
    if (cleaned === text) return false;
    event.preventDefault();
    view.dispatch(view.state.replaceSelection(cleaned), { userEvent: "input.paste", scrollIntoView: true });
    return true;
  },
});

// --- ⌘/Ctrl-click: \ref → \label, \cite → bibliography entry, \input → file -------------

let goTo: (target: { kind: "label" | "cite" | "file"; key: string }) => void = () => {};
export function setDefinitionHandler(handler: typeof goTo) {
  goTo = handler;
}

const definitionClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!(IS_MAC ? event.metaKey : event.ctrlKey) || event.button !== 0) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos === null) return false;
    const line = view.state.doc.lineAt(pos);
    for (const m of line.text.matchAll(REFERENCE_CALL)) {
      const start = line.from + m.index!;
      if (pos < start || pos > start + m[0].length) continue;
      const command = m[1];
      // The key under the pointer when several are listed: \cite{a,b,c}.
      let offset = start + m[0].lastIndexOf("{") + 1;
      const key = m[2].split(",").find((part) => {
        const hit = pos >= offset && pos <= offset + part.length;
        offset += part.length + 1;
        return hit;
      })?.trim() ?? m[2].split(",")[0].trim();
      const kind = /^(input|include|subfile|includegraphics)$/.test(command)
        ? "file"
        : /cite/.test(command)
          ? "cite"
          : /ref$/.test(command)
            ? "label"
            : undefined;
      if (!kind) return false;
      event.preventDefault();
      goTo({ kind, key });
      return true;
    }
    return false;
  },
});

export function editingHelpers(): Extension[] {
  return [
    // Ahead of CodeMirror's bracket auto-closing, which would otherwise claim " [ { first.
    Prec.highest(typing),
    Prec.high(
      keymap.of([
        { key: "Enter", run: enter },
        { key: "Mod-b", run: wrapWith("\\textbf{", "}"), preventDefault: true },
        { key: "Mod-i", run: wrapWith("\\emph{", "}"), preventDefault: true },
        { key: "Mod-u", run: wrapWith("\\underline{", "}"), preventDefault: true },
        { key: "Mod-m", run: wrapWith("$", "$"), preventDefault: true },
        { key: "Mod-Alt-e", run: wrapInEnvironment, preventDefault: true },
      ]),
    ),
    syncEnvironmentNames,
    Prec.highest(smartPaste),
    // Before the renderer's own click handling (which places the cursor).
    Prec.highest(definitionClick),
  ];
}
