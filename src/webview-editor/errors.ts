import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, hoverTooltip, keymap } from "@codemirror/view";
import type { EditorDiagnostic } from "./protocol";
import { revealLine } from "./latexEnhancements";

// VS Code can't move the cursor inside a webview editor when a Problems
// entry is clicked, so the rich view shows the compile errors itself and
// F8 / Shift+F8 step through them like in a text editor.

const setErrors = StateEffect.define<EditorDiagnostic[]>();

interface ErrorState {
  items: EditorDiagnostic[];
  decorations: DecorationSet;
}

const errorField = StateField.define<ErrorState>({
  create: () => ({ items: [], decorations: Decoration.none }),
  update(value, tr) {
    let { items, decorations } = value;
    decorations = decorations.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setErrors)) continue;
      items = effect.value;
      const doc = tr.state.doc;
      const ranges = items
        .filter((d) => d.line < doc.lines)
        .map((d) => doc.line(d.line + 1))
        .filter((line, i, all) => all.findIndex((l) => l.number === line.number) === i)
        .sort((a, b) => a.from - b.from)
        .flatMap((line) => [
          Decoration.line({ class: "lr-error-line" }).range(line.from),
          ...(line.to > line.from ? [Decoration.mark({ class: "lr-error-text" }).range(line.from, line.to)] : []),
        ]);
      decorations = Decoration.set(ranges, true);
    }
    return { items, decorations };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export function showErrors(view: EditorView, items: EditorDiagnostic[]) {
  view.dispatch({ effects: setErrors.of(items) });
}

const errorHover = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const here = view.state.field(errorField).items.filter((d) => d.line === line.number - 1);
  if (here.length === 0) return null;
  return {
    pos: line.from,
    end: line.to,
    above: true,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "lr-hover lr-error-hover";
      for (const d of here) {
        const row = document.createElement("div");
        row.textContent = d.message;
        dom.appendChild(row);
      }
      return { dom };
    },
  };
});

function jump(view: EditorView, direction: 1 | -1): boolean {
  const lines = [...new Set(view.state.field(errorField).items.map((d) => d.line))].sort((a, b) => a - b);
  if (lines.length === 0) return false;
  const current = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
  const next =
    direction === 1
      ? lines.find((l) => l > current) ?? lines[0]
      : [...lines].reverse().find((l) => l < current) ?? lines[lines.length - 1];
  revealLine(view, next);
  return true;
}

export function errorExtensions(): Extension[] {
  return [
    errorField,
    errorHover,
    keymap.of([
      { key: "F8", run: (view) => jump(view, 1) },
      { key: "Shift-F8", run: (view) => jump(view, -1) },
    ]),
  ];
}
