import { Compartment, type Extension, Prec, StateField, type EditorState, type Range } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, keymap, WidgetType } from "@codemirror/view";
import { classifyLines, computeFolds, type Fold, type ViewOptions } from "../shared/paragraphs";

// Paragraph view and comment visibility. Both only hide parts of the document
// (line breaks, comments) with replace decorations; the text itself, and so
// the file on disk, never changes.

class SpaceWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.textContent = " ";
    return span;
  }
  eq(other: WidgetType) {
    return other instanceof SpaceWidget;
  }
}
const SPACE = Decoration.replace({ widget: new SpaceWidget() });
const NOTHING = Decoration.replace({});

interface FoldState {
  folds: Fold[];
  decorations: DecorationSet;
}

function documentLines(state: EditorState): string[] {
  const lines: string[] = [];
  for (const line of state.doc.iterLines()) lines.push(line);
  return lines;
}

/** Decorations for the folds, leaving the line the cursor is on untouched so it can be edited. */
function build(state: EditorState, folds: Fold[]): DecorationSet {
  const head = state.selection.main.head;
  const ranges: Range<Decoration>[] = [];
  for (const fold of folds) {
    // Extra blank lines and comments are shown while the cursor is in them.
    if (fold.text === "" && head > fold.from && head < fold.to) continue;
    ranges.push((fold.text === " " ? SPACE : NOTHING).range(fold.from, fold.to));
  }
  return Decoration.set(ranges);
}

function foldField(options: ViewOptions) {
  return StateField.define<FoldState>({
    create(state) {
      const folds = computeFolds(documentLines(state), options);
      return { folds, decorations: build(state, folds) };
    },
    update(value, tr) {
      if (tr.docChanged) {
        const folds = computeFolds(documentLines(tr.state), options);
        return { folds, decorations: build(tr.state, folds) };
      }
      if (tr.selection) return { folds: value.folds, decorations: build(tr.state, value.folds) };
      return value;
    },
    provide: (field) => [
      EditorView.decorations.from(field, (value) => value.decorations),
      EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
    ],
  });
}

// In paragraph view Enter on a line of running text starts a new paragraph
// (a blank line), since a single line break would be invisible.
const newParagraph = keymap.of([
  {
    key: "Enter",
    run(view) {
      const { state } = view;
      const selection = state.selection.main;
      if (!selection.empty) return false;
      const line = state.doc.lineAt(selection.head);
      const kinds = classifyLines(documentLines(state));
      if (kinds[line.number - 1] !== "text") return false;
      view.dispatch({
        changes: { from: selection.head, insert: "\n\n" },
        selection: { anchor: selection.head + 2 },
        scrollIntoView: true,
        userEvent: "input",
      });
      return true;
    },
  },
]);

const compartment = new Compartment();
let wanted: ViewOptions = { paragraphs: false, showComments: true };
let visual = true;

function extensionFor(options: ViewOptions): Extension {
  if (options.showComments && !options.paragraphs) return [];
  return [foldField(options), options.paragraphs ? Prec.high(newParagraph) : []];
}

/** Part of the editor's extensions; starts as plain line view. */
export function viewModeExtension(): Extension {
  return compartment.of([]);
}

/** Applies the user's choice. Source mode always shows every line and comment. */
export function setViewOptions(view: EditorView | undefined, options: ViewOptions, isVisual = visual) {
  wanted = options;
  visual = isVisual;
  if (!view) return;
  const effective: ViewOptions = visual ? wanted : { paragraphs: false, showComments: true };
  document.documentElement.classList.toggle("lr-paragraphs", effective.paragraphs);
  view.dispatch({ effects: compartment.reconfigure(extensionFor(effective)) });
}

export function setSourceMode(view: EditorView | undefined, isVisual: boolean) {
  setViewOptions(view, wanted, isVisual);
}

