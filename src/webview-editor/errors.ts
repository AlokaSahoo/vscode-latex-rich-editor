import { type Extension, StateEffect, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, hoverTooltip, keymap } from "@codemirror/view";
import type { EditorDiagnostic, FixOption } from "./protocol";
import { revealLine } from "./latexEnhancements";

// Everything VS Code reports for this document — compile errors, and
// spelling/grammar from checkers like LTeX+ or Code Spell Checker — shown in
// the rich view: squiggles on the flagged text, a hover with the message and
// the checker's quick fixes, and F8 / Shift+F8 to step through them.

const setDiagnostics = StateEffect.define<EditorDiagnostic[]>();

interface DiagnosticState {
  items: EditorDiagnostic[];
  decorations: DecorationSet;
}

function build(doc: EditorView["state"]["doc"], items: EditorDiagnostic[]): DecorationSet {
  const ranges = [];
  for (const d of items) {
    if (d.line >= doc.lines) continue;
    const line = doc.line(d.line + 1);
    const from = Math.min(Math.max(d.from, 0), doc.length);
    const to = Math.min(Math.max(d.to, from), doc.length);
    const [a, b] = to > from ? [from, to] : [line.from, line.to];
    if (d.severity === "error") ranges.push(Decoration.line({ class: "lr-error-line" }).range(line.from));
    if (b > a) ranges.push(Decoration.mark({ class: `lr-diag lr-diag-${d.severity}` }).range(a, b));
  }
  return Decoration.set(ranges, true);
}

const diagnosticField = StateField.define<DiagnosticState>({
  create: () => ({ items: [], decorations: Decoration.none }),
  update(value, tr) {
    let { items, decorations } = value;
    if (tr.docChanged) {
      decorations = decorations.map(tr.changes);
      items = items.map((d) => ({ ...d, from: tr.changes.mapPos(d.from), to: tr.changes.mapPos(d.to, 1) }));
    }
    for (const effect of tr.effects) {
      if (!effect.is(setDiagnostics)) continue;
      items = effect.value;
      decorations = build(tr.state.doc, items);
    }
    return { items, decorations };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

export function showErrors(view: EditorView, items: EditorDiagnostic[]) {
  view.dispatch({ effects: setDiagnostics.of(items) });
}

// --- Quick fixes, fetched from the host on hover ---------------------------------

let fixRequest = 0;
const pendingFixes = new Map<string, (fixes: FixOption[]) => void>();
let requestFixes: (requestId: string, from: number, to: number) => void = () => {};
let applyFix: (requestId: string, index: number) => void = () => {};

export function setFixChannel(request: typeof requestFixes, apply: typeof applyFix) {
  requestFixes = request;
  applyFix = apply;
}

export function resolveFixes(requestId: string, fixes: FixOption[]) {
  pendingFixes.get(requestId)?.(fixes);
  pendingFixes.delete(requestId);
}

const diagnosticHover = hoverTooltip(async (view, pos) => {
  const line = view.state.doc.lineAt(pos);
  const here = view.state.field(diagnosticField).items.filter((d) =>
    d.to > d.from ? pos >= d.from && pos <= d.to : d.line === line.number - 1,
  );
  if (here.length === 0) return null;
  const from = Math.min(...here.map((d) => (d.to > d.from ? d.from : line.from)));
  const to = Math.max(...here.map((d) => (d.to > d.from ? d.to : line.to)));

  const requestId = String(fixRequest++);
  const fixes = await Promise.race([
    new Promise<FixOption[]>((resolve) => {
      pendingFixes.set(requestId, resolve);
      requestFixes(requestId, from, to);
    }),
    new Promise<FixOption[]>((resolve) => setTimeout(() => resolve([]), 1500)),
  ]);

  return {
    pos: from,
    end: to,
    above: true,
    create: () => {
      const dom = document.createElement("div");
      dom.className = "lr-hover lr-diag-hover";
      for (const d of here) {
        const row = document.createElement("div");
        row.className = `lr-diag-message lr-diag-message-${d.severity}`;
        row.textContent = d.source ? `${d.message}  (${d.source})` : d.message;
        dom.appendChild(row);
      }
      if (fixes.length > 0) {
        const actions = document.createElement("div");
        actions.className = "lr-diag-fixes";
        for (const fix of fixes.slice(0, 6)) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = fix.title;
          button.addEventListener("mousedown", (event) => {
            event.preventDefault();
            applyFix(requestId, fix.index);
          });
          actions.appendChild(button);
        }
        dom.appendChild(actions);
      }
      return { dom };
    },
  };
});

function jump(view: EditorView, direction: 1 | -1): boolean {
  const lines = [...new Set(view.state.field(diagnosticField).items.map((d) => d.line))].sort((a, b) => a - b);
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
    diagnosticField,
    diagnosticHover,
    keymap.of([
      { key: "F8", run: (view) => jump(view, 1) },
      { key: "Shift-F8", run: (view) => jump(view, -1) },
    ]),
  ];
}
