import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { type EditorState, type Extension, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import { MathfieldElement } from "mathlive";
import { getLanguage, setVisualState, type Token, type TokenStyle } from "codemirror-visual-markup";
import {
  CITE_COMMANDS,
  environments,
  findLabels,
  LABEL_COMMANDS,
  maskComments,
  MATH_ENVIRONMENTS,
} from "../shared/latexText";
import { collectDefinedColors, colorFromModel, type ColorTable, resolveColor, toCss } from "./colors";
import type { CustomCommandStyle, ReferenceTable, ViewPosition } from "./protocol";

// --- Document model -------------------------------------------------------

interface MacroDefinition {
  args: number;
  def: string;
  expand: false;
}

interface DocumentInfo {
  twoColumn: boolean;
  textwidthPt: number;
  columnwidthPt: number;
  textheightPt: number;
  colors: ColorTable;
  macros: Record<string, MacroDefinition>;
}

// Real REVTeX 4.2 / article dimensions, so in-place figure sizes match the
// PDF. REVTeX is one-column unless `reprint` or `twocolumn` is given.
function analyzeDocument(text: string): DocumentInfo {
  const match = /\\documentclass\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/.exec(text);
  const options = (match?.[1] ?? "").split(",").map((o) => o.trim());
  const cls = (match?.[2] ?? "article").trim();
  const revtex = /^revtex/.test(cls);
  const twoColumn =
    !options.includes("onecolumn") && (options.includes("twocolumn") || (revtex && options.includes("reprint")));

  let textwidthPt = 345;
  let columnwidthPt = 345;
  if (revtex) {
    textwidthPt = twoColumn ? 510 : 468;
    columnwidthPt = twoColumn ? 246 : textwidthPt;
  } else if (twoColumn) {
    textwidthPt = 469;
    columnwidthPt = 229.5;
  } else if (options.includes("12pt")) {
    textwidthPt = columnwidthPt = 390;
  } else if (options.includes("11pt")) {
    textwidthPt = columnwidthPt = 360;
  }

  return {
    twoColumn,
    textwidthPt,
    columnwidthPt,
    textheightPt: revtex ? 682 : 550,
    colors: collectDefinedColors(text),
    macros: { ...BUILTIN_MACROS, ...collectMacros(text) },
  };
}

// Common physics-package commands MathLive doesn't know, so equations in
// REVTeX papers render instead of showing red unknown-command errors.
const BUILTIN_MACROS: Record<string, MacroDefinition> = {
  ket: { args: 1, def: "\\left|#1\\right\\rangle", expand: false },
  bra: { args: 1, def: "\\left\\langle#1\\right|", expand: false },
  braket: { args: 2, def: "\\left\\langle#1\\middle|#2\\right\\rangle", expand: false },
  ketbra: { args: 2, def: "\\left|#1\\right\\rangle\\!\\left\\langle#2\\right|", expand: false },
  expval: { args: 1, def: "\\left\\langle#1\\right\\rangle", expand: false },
  abs: { args: 1, def: "\\left|#1\\right|", expand: false },
  norm: { args: 1, def: "\\left\\|#1\\right\\|", expand: false },
  dd: { args: 0, def: "\\mathrm{d}", expand: false },
  vb: { args: 1, def: "\\mathbf{#1}", expand: false },
  bm: { args: 1, def: "\\boldsymbol{#1}", expand: false },
  // Equation bookkeeping that has no visual form.
  label: { args: 1, def: "", expand: false },
  nonumber: { args: 0, def: "", expand: false },
  notag: { args: 0, def: "", expand: false },
};

function collectMacros(text: string): Record<string, MacroDefinition> {
  const macros: Record<string, MacroDefinition> = {};
  const head =
    /\\(?:re)?newcommand\*?\s*\{?\s*\\([A-Za-z]+)\s*\}?\s*(?:\[(\d)\])?\s*(\[[^\]]*\])?\s*\{|\\providecommand\*?\s*\{?\s*\\([A-Za-z]+)\s*\}?\s*(?:\[(\d)\])?\s*\{|\\def\s*\\([A-Za-z]+)\s*\{|\\DeclareMathOperator(\*?)\s*\{\s*\\([A-Za-z]+)\s*\}\s*\{/g;
  for (const m of text.matchAll(head)) {
    const bodyStart = m.index! + m[0].length;
    const body = readGroup(text, bodyStart);
    if (body === null) continue;
    if (m[8]) {
      macros[m[8]] = { args: 0, def: `\\operatorname${m[7] ? "*" : ""}{${body}}`, expand: false };
      continue;
    }
    const name = m[1] ?? m[4] ?? m[6];
    // An optional-argument default can't be expressed as a MathLive macro.
    if (m[3]) continue;
    macros[name] = { args: Number(m[2] ?? m[5] ?? 0), def: body, expand: false };
  }
  return macros;
}

// Returns the contents of a brace group whose opening brace has just been
// consumed, or null if unbalanced.
function readGroup(text: string, start: number): string | null {
  let depth = 1;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return text.slice(start, i);
  }
  return null;
}

let info: DocumentInfo = analyzeDocument("");
let currentText = "";

// Recomputed during each transaction (before the visual layer rebuilds its
// decorations), so the patched style hooks below always see current data.
const documentInfoField = StateField.define<DocumentInfo>({
  create(state) {
    currentText = state.doc.toString();
    info = analyzeDocument(currentText);
    return info;
  },
  update(value, tr) {
    if (!tr.docChanged) return value;
    currentText = tr.newDoc.toString();
    info = analyzeDocument(currentText);
    return info;
  },
});

// Forces our own plugins (and, via setVisualState, the renderer) to rebuild
// after data they depend on changes outside the document.
const refresh = StateEffect.define<null>();
let visualMode = true;

function requestRefresh(view: EditorView | undefined) {
  view?.dispatch({ effects: [refresh.of(null), setVisualState.of({})] });
}

export function setVisualMode(view: EditorView | undefined, visual: boolean) {
  visualMode = visual;
  requestRefresh(view);
}

// --- Patching the renderer's LaTeX language ----------------------------------

const CUSTOM_STYLE_CLASS: Record<CustomCommandStyle, string> = {
  bold: "cm-lv-bold",
  italic: "cm-lv-italic",
  underline: "cm-lv-underline",
  reference: "cm-lv-cmd",
  hidden: "cm-lv-cmd-unknown",
};

const BUILTIN_COMMANDS: Record<string, string> = {
  eqref: "cm-lv-cmd",
  cref: "cm-lv-cmd",
  Cref: "cm-lv-cmd",
  autoref: "cm-lv-cmd",
  pageref: "cm-lv-cmd",
  nameref: "cm-lv-cmd",
  onlinecite: "cm-lv-cmd",
  citet: "cm-lv-cmd",
  Citet: "cm-lv-cmd",
  citealp: "cm-lv-cmd",
  citealt: "cm-lv-cmd",
  citeauthor: "cm-lv-cmd",
  autocite: "cm-lv-cmd",
  parencite: "cm-lv-cmd",
  textcite: "cm-lv-cmd",
  title: "lr-doc-title",
  author: "lr-doc-author",
  affiliation: "lr-affiliation",
  altaffiliation: "lr-affiliation",
  thanks: "lr-affiliation",
  keywords: "lr-affiliation",
  email: "lr-email",
  homepage: "lr-email",
};

const BUILTIN_ENVIRONMENTS: Record<string, string> = {
  abstract: "lr-abstract",
  acknowledgments: "lr-acknowledgments",
  acknowledgements: "lr-acknowledgments",
};

let customCommands: Record<string, CustomCommandStyle> = {};
let patched = false;

export function configureEnhancements(commands: Record<string, CustomCommandStyle>) {
  customCommands = commands;
  if (patched) return;
  patched = true;
  const language = getLanguage("latex");

  const originalStyle = language.style;
  language.style = (token) => styleToken(token, originalStyle);

  language.imageStyle = (source, token) => imageStyle(source, token);

  const figure = language.figure;
  if (figure) {
    const originalParse = figure.parse;
    figure.parse = (source, token) => {
      const model = originalParse.call(figure, source, token);
      // Composite figures (subfigures/panels) in a two-column paper occupy
      // one column, not the full page width.
      if (model && token.name === "figure" && info.twoColumn && !model.wide && !model.width) {
        model.width = `${percent(info.columnwidthPt / info.textwidthPt)}`;
      }
      return model;
    };
  }
}

function styleToken(token: Token, original: (token: Token) => TokenStyle | null): TokenStyle | null {
  if (token.kind === "command" && token.name) {
    // Resolved references are drawn by referenceDecorations(); leave them
    // alone here so the two layers don't fight over the same range.
    if (REFERENCE_COMMANDS.has(token.name) && resolvedReference(currentText.slice(token.from, token.to))) {
      return null;
    }
    const user = customCommands[token.name];
    if (user === "hidden") return { hidden: true };
    if (user) return { class: CUSTOM_STYLE_CLASS[user] };

    switch (token.name) {
      case "textcolor":
      case "colorbox":
      case "fcolorbox":
        return colorStyle(token, original(token));
      case "color":
        // The text it colors is handled by colorScopes(); hide the switch.
        return { hidden: true };
      case "maketitle":
        return { hidden: true };
      case "today":
        return { replaceWith: todayText() };
    }
    const builtIn = BUILTIN_COMMANDS[token.name];
    if (builtIn) return { class: builtIn };
  }
  if (token.kind === "container" && token.name && BUILTIN_ENVIRONMENTS[token.name]) {
    return { class: `cm-lv-env ${BUILTIN_ENVIRONMENTS[token.name]}`, block: true };
  }
  return original(token);
}

function colorStyle(token: Token, base: TokenStyle | null): TokenStyle | null {
  const rgb = token.meta?.color ? resolveColor(token.meta.color, info.colors) : null;
  if (!base || !rgb) return base;
  const properties = [token.name === "textcolor" ? `color:${toCss(rgb)}` : `background-color:${toCss(rgb)}`];
  // Text on a colored box: black or white by the box's brightness, as on paper.
  if (token.name !== "textcolor") {
    const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    properties.push(`color:${luminance > 0.55 ? "#000" : "#fff"}`);
  }
  const border = token.meta?.borderColor ? resolveColor(token.meta.borderColor, info.colors) : null;
  if (border) properties.push(`box-shadow:inset 0 0 0 1px ${toCss(border)}`);
  return { ...base, attributes: { ...base.attributes, style: properties.join(";") } };
}

function todayText(): string {
  return new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// --- Figure sizing ---------------------------------------------------------

type LayoutContext = "panel" | "wide" | "column" | "text";

const PANEL_ENVIRONMENTS = new Set(["subfigure", "subtable", "minipage", "subcaptionblock", "wrapfigure", "wrapfigure*"]);
const PT_PER_UNIT: Record<string, number> = {
  pt: 1,
  bp: 1.00375,
  px: 1.00375,
  in: 72.27,
  cm: 28.4528,
  mm: 2.84528,
  pc: 12,
  dd: 1.07,
  em: 10,
  ex: 4.3,
};

function imageStyle(source: string, token: Token): string | null {
  const raw = source.slice(token.from, token.to);
  const options = parseKeyValues(/^\\includegraphics\*?\s*\[([\s\S]*?)\]/.exec(raw)?.[1] ?? "");
  const context = layoutContext(source, token.from);
  const style: string[] = [];

  const width = options.get("width") ? widthCss(options.get("width")!, context) : null;
  const height = options.get("height") ? heightCss(options.get("height")!) : null;
  if (width) style.push(`width:${width}`);
  if (height) style.push(`height:${height}`);
  if (width && height) style.push(options.has("keepaspectratio") ? "object-fit:contain" : "object-fit:fill");

  if (!width && !height) {
    // Natural size (times `scale`) — resolved once the image has loaded and
    // its intrinsic dimensions are known; see sizeNaturalImages().
    const scale = Number(options.get("scale") ?? 1);
    style.push(`--lr-scale:${Number.isFinite(scale) && scale > 0 ? scale : 1}`);
  }

  // LaTeX rotates counter-clockwise; CSS rotates clockwise.
  const angle = Number(options.get("angle"));
  if (Number.isFinite(angle) && angle !== 0) style.push(`rotate:${-angle}deg`);
  style.push("max-width:100%");
  return style.join(";");
}

function widthCss(value: string, context: LayoutContext): string | null {
  const relative = /^([+-]?\d*\.?\d+)?\s*\\(textwidth|linewidth|columnwidth|hsize|paperwidth)$/.exec(value.trim());
  if (relative) {
    const factor = relative[1] ? Number(relative[1]) : 1;
    const column = info.columnwidthPt / info.textwidthPt;
    let fraction = factor;
    switch (relative[2]) {
      case "linewidth":
      case "hsize":
        if (context === "column") fraction = factor * column;
        break;
      case "columnwidth":
        if (context !== "panel") fraction = factor * column;
        break;
      case "paperwidth":
        fraction = (factor * 612) / info.textwidthPt;
        break;
    }
    return percent(fraction);
  }
  return absoluteCss(value);
}

function heightCss(value: string): string | null {
  const relative = /^([+-]?\d*\.?\d+)?\s*\\(textheight|textwidth|linewidth|columnwidth)$/.exec(value.trim());
  if (relative) {
    const factor = relative[1] ? Number(relative[1]) : 1;
    const basis =
      relative[2] === "textheight"
        ? info.textheightPt
        : relative[2] === "textwidth"
          ? info.textwidthPt
          : info.columnwidthPt;
    return ptCss(factor * basis);
  }
  return absoluteCss(value);
}

function absoluteCss(value: string): string | null {
  const m = /^([+-]?\d*\.?\d+)\s*(pt|bp|px|in|cm|mm|pc|dd|em|ex)$/.exec(value.trim());
  return m ? ptCss(Number(m[1]) * PT_PER_UNIT[m[2]]) : null;
}

// --lr-pt is "CSS pixels per TeX point" for the current editor width; set by
// pageScale() so a physical length scales with the virtual page.
function ptCss(pt: number): string {
  return `calc(var(--lr-pt, 1.33px) * ${pt.toFixed(2)})`;
}

function percent(fraction: number): string {
  return `${Math.round(Math.max(0, Math.min(1, fraction)) * 10000) / 100}%`;
}

function parseKeyValues(text: string): Map<string, string> {
  const values = new Map<string, string>();
  for (const part of text.split(",")) {
    const [key, ...rest] = part.split("=");
    if (key.trim()) values.set(key.trim(), rest.join("=").trim());
  }
  return values;
}

let environmentSource = "";
let environmentEvents: Array<{ at: number; begin: boolean; name: string }> = [];
// Images are asked about in document order, so resume the environment walk
// where the previous call stopped instead of replaying it from the top.
let walk = { position: 0, index: 0, stack: [] as string[] };

function layoutContext(source: string, position: number): LayoutContext {
  if (source !== environmentSource) {
    environmentSource = source;
    environmentEvents = [...source.matchAll(/\\(begin|end)\s*\{([^}]+)\}/g)].map((m) => ({
      at: m.index!,
      begin: m[1] === "begin",
      name: m[2].trim(),
    }));
    walk = { position: 0, index: 0, stack: [] };
  }
  if (position < walk.position) walk = { position: 0, index: 0, stack: [] };
  const { stack } = walk;
  while (walk.index < environmentEvents.length && environmentEvents[walk.index].at < position) {
    const event = environmentEvents[walk.index++];
    if (event.begin) stack.push(event.name);
    else {
      const index = stack.lastIndexOf(event.name);
      if (index >= 0) stack.splice(index);
    }
  }
  walk.position = position;
  if (stack.some((name) => PANEL_ENVIRONMENTS.has(name))) return "panel";
  if (stack.some((name) => /^(figure|table)\*$/.test(name))) return "wide";
  return info.twoColumn ? "column" : "text";
}

// Sizes images that have no explicit width/height from their intrinsic size:
// pdflatex treats a bitmap pixel as 1bp; rasterized PDF figures carry their
// true width in points in the URL fragment.
function sizeNaturalImages(root: HTMLElement) {
  root.addEventListener(
    "load",
    (event) => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement)) return;
      const scale = parseFloat(image.style.getPropertyValue("--lr-scale"));
      if (!Number.isFinite(scale)) return;
      const fromPdf = /#lr-pt=([\d.]+)$/.exec(image.src);
      const widthPt = (fromPdf ? Number(fromPdf[1]) : image.naturalWidth * 1.00375) * scale;
      image.style.width = ptCss(widthPt);
    },
    true,
  );
}

// Treat the editor's text column as the paper's text block: 100% width is
// \textwidth, which defines how many CSS pixels a TeX point is.
const pageScale = ViewPlugin.fromClass(
  class {
    private observer: ResizeObserver;
    constructor(private view: EditorView) {
      this.observer = new ResizeObserver(() => this.measure());
      this.observer.observe(view.contentDOM);
      this.measure();
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.measure();
    }
    measure() {
      const width = this.view.contentDOM.clientWidth;
      if (width > 0) this.view.dom.style.setProperty("--lr-pt", `${(width / info.textwidthPt).toFixed(4)}px`);
    }
    destroy() {
      this.observer.disconnect();
    }
  },
);

// --- \color{...} scopes ----------------------------------------------------

// `{\color{red} text}` colors everything until the enclosing group or
// environment ends, which the token-based renderer can't express, so these
// ranges are decorated here.
function colorScopeDecorations(view: EditorView): DecorationSet {
  const text = view.state.doc.toString();
  const ranges: Array<{ from: number; to: number; css: string }> = [];
  const pattern = /\\color\s*(?:\[([^\]]*)\])?\s*\{([^}]*)\}/g;
  for (const m of text.matchAll(pattern)) {
    if (m.index! > 0 && text[m.index! - 1] === "\\") continue;
    const rgb = m[1] ? colorFromModel(m[1], m[2], info.colors) : resolveColor(m[2], info.colors);
    if (!rgb) continue;
    const from = m.index! + m[0].length;
    const to = scopeEnd(text, from);
    if (to > from) ranges.push({ from, to, css: toCss(rgb) });
  }
  ranges.sort((a, b) => a.from - b.from || b.to - a.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of ranges) {
    builder.add(range.from, range.to, Decoration.mark({ class: "lr-color-scope", attributes: { style: `color:${range.css}` } }));
  }
  return builder.finish();
}

function scopeEnd(text: string, from: number): number {
  let depth = 0;
  let environments = 0;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      if (text.startsWith("\\begin{", i)) environments++;
      else if (text.startsWith("\\end{", i)) {
        if (environments === 0 && depth === 0) return i;
        environments--;
      }
      i++;
      continue;
    }
    if (c === "%") {
      const newline = text.indexOf("\n", i);
      i = newline === -1 ? text.length : newline;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return text.length;
}

const colorScopes = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = colorScopeDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = colorScopeDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// --- \ref / \eqref / \cite → numbers from the last compile -----------------

let references: ReferenceTable = { labels: {}, citations: {} };

export function setReferences(view: EditorView | undefined, table: ReferenceTable) {
  references = table;
  requestRefresh(view);
}

export function currentReferences(): ReferenceTable {
  return references;
}

const REFERENCE_COMMANDS = new Set([...LABEL_COMMANDS, ...CITE_COMMANDS]);
const REFERENCE = /\\([A-Za-z]+)\*?\s*(?:\[[^\]]*\]\s*){0,2}\{([^}]*)\}/g;

const SHORT_NAMES: Record<string, string> = {
  figure: "Fig.",
  equation: "Eq.",
  section: "Sec.",
  subsection: "Sec.",
  subsubsection: "Sec.",
  table: "Table",
  appendix: "Appendix",
  chapter: "Chapter",
};
const LONG_NAMES: Record<string, string> = {
  figure: "Figure",
  equation: "Equation",
  section: "Section",
  subsection: "Section",
  subsubsection: "Section",
  table: "Table",
  appendix: "Appendix",
  chapter: "Chapter",
};

function resolvedReference(source: string): string | null {
  REFERENCE.lastIndex = 0;
  const m = REFERENCE.exec(source);
  return m && m.index === 0 ? formatReference(m[1], m[2]) : null;
}

// Mirrors what the PDF shows; returns null if any key isn't in the .aux yet
// (the raw key then stays visible, like LaTeX's "??").
function formatReference(command: string, keyText: string): string | null {
  const keys = keyText.split(",").map((k) => k.trim()).filter(Boolean);
  if (!REFERENCE_COMMANDS.has(command) || keys.length === 0) return null;

  if (CITE_COMMANDS.has(command)) {
    const numbers = keys.map((k) => references.citations[k]);
    if (numbers.some((n) => !n)) return null;
    return command === "onlinecite" ? numbers.join(", ") : `[${numbers.join(", ")}]`;
  }

  // REVTeX's .aux doesn't record what a label points to; fall back to the
  // environment the \label sits in.
  const labels = keys.map((k) => {
    const label = references.labels[k];
    return label && !label.type ? { ...label, type: sourceLabelKinds().get(k) } : label;
  });
  if (labels.some((l) => !l)) return null;
  const numbers = labels.map((l) => (l.type === "equation" ? `(${l.number})` : l.number)).join(", ");
  switch (command) {
    case "eqref":
      return labels.map((l) => `(${l.number})`).join(", ");
    case "pageref":
      return labels.map((l) => l.page).join(", ");
    case "cref":
    case "Cref":
    case "autoref": {
      const names = command === "autoref" ? LONG_NAMES : SHORT_NAMES;
      const name = names[labels[0].type ?? ""];
      return name ? `${name} ${numbers}` : numbers;
    }
    default:
      return labels.map((l) => l.number).join(", ");
  }
}

let kindsFor = "";
let kinds = new Map<string, string>();
function sourceLabelKinds(): Map<string, string> {
  if (kindsFor !== currentText) {
    kindsFor = currentText;
    kinds = new Map(findLabels(currentText).map((l) => [l.key, l.kind]));
  }
  return kinds;
}

class ReferenceWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly source: string,
  ) {
    super();
  }
  eq(other: ReferenceWidget) {
    return other.label === this.label && other.source === this.source;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "lr-ref";
    span.textContent = this.label;
    return span;
  }
  // Let clicks reach the editor so they place the cursor (revealing the source).
  ignoreEvent() {
    return false;
  }
}

interface ResolvedReference {
  from: number;
  to: number;
  label: string;
  source: string;
}

// Resolving every \ref/\cite is the expensive part and doesn't depend on the
// cursor, so it's redone only when the text or the .aux numbers change.
let resolvedFor: { doc: unknown; table: ReferenceTable } | undefined;
let resolved: ResolvedReference[] = [];

function resolvedReferences(view: EditorView): ResolvedReference[] {
  const doc = view.state.doc;
  if (resolvedFor?.doc === doc && resolvedFor.table === references) return resolved;
  resolvedFor = { doc, table: references };
  resolved = [];
  for (const m of doc.toString().matchAll(REFERENCE)) {
    const label = formatReference(m[1], m[2]);
    if (label) resolved.push({ from: m.index!, to: m.index! + m[0].length, label, source: m[0] });
  }
  return resolved;
}

function referenceDecorations(view: EditorView): DecorationSet {
  if (!visualMode) return Decoration.none;
  const selection = view.state.selection.ranges;
  const builder = new RangeSetBuilder<Decoration>();
  for (const ref of resolvedReferences(view)) {
    if (selection.some((range) => range.from <= ref.to && range.to >= ref.from)) continue;
    builder.add(ref.from, ref.to, Decoration.replace({ widget: new ReferenceWidget(ref.label, ref.source) }));
  }
  return builder.finish();
}

const referencePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = referenceDecorations(view);
    }
    update(update: ViewUpdate) {
      const refreshed = update.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)));
      if (update.docChanged || update.selectionSet || refreshed) {
        this.decorations = referenceDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// --- Typographic symbols: ~ \% -- `` '' \ldots, and {\color …} braces -----------

const SYMBOL = /\\([%&#_$])|\\(?:ldots|dots|textellipsis)\b|\\,|---|--|``|''|~/g;
const SYMBOL_TEXT: Record<string, string> = {
  "~": " ",
  "---": "—",
  "--": "–",
  "``": "“",
  "''": "”",
  "\\,": " ",
  "\\ldots": "…",
  "\\dots": "…",
  "\\textellipsis": "…",
};

class SymbolWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  eq(other: SymbolWidget) {
    return other.text === this.text;
  }
  toDOM() {
    const span = document.createElement("span");
    span.textContent = this.text;
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

/** Ranges the symbol layer must leave alone: math (rendered by MathLive) and verbatim. */
function protectedRanges(masked: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const m of masked.matchAll(/\$\$[\s\S]*?\$\$|(?<!\\)\$(?:[^$\\]|\\.)*\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g)) {
    ranges.push([m.index!, m.index! + m[0].length]);
  }
  for (const span of environments(masked)) {
    if (MATH_ENVIRONMENTS.has(span.name) || /^(verbatim\*?|lstlisting|minted|Verbatim|comment)$/.test(span.name)) {
      ranges.push([span.begin, span.end]);
    }
  }
  return ranges;
}

interface SymbolCandidate {
  from: number;
  to: number;
  text: string;
  /** The cursor revealing the source: anything touching this range shows raw LaTeX. */
  guardFrom: number;
  guardTo: number;
}

/** Whether [from, to) overlaps any of the sorted, disjoint ranges. */
function overlapsAny(ranges: Array<[number, number]>, from: number, to: number): boolean {
  let lo = 0;
  let hi = ranges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (ranges[mid][1] <= from) lo = mid + 1;
    else hi = mid;
  }
  return lo < ranges.length && ranges[lo][0] < to;
}

function mergeRanges(ranges: Array<[number, number]>): Array<[number, number]> {
  const merged: Array<[number, number]> = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = merged[merged.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  return merged;
}

let symbolsFor: unknown;
let symbolCandidates: SymbolCandidate[] = [];

// Finding the symbols is the expensive part and doesn't depend on the cursor;
// only which of them are revealed does, so that is filtered per selection.
function symbolsOf(view: EditorView): SymbolCandidate[] {
  const doc = view.state.doc;
  if (symbolsFor === doc) return symbolCandidates;
  symbolsFor = doc;
  const masked = maskComments(doc.toString());
  const skip = mergeRanges(protectedRanges(masked));

  const found: SymbolCandidate[] = [];
  for (const m of masked.matchAll(SYMBOL)) {
    const from = m.index!;
    const to = from + m[0].length;
    if (m[0] === "~" && masked[from - 1] === "\\") continue; // \~ accent
    if (overlapsAny(skip, from, to)) continue;
    found.push({ from, to, text: m[1] ?? SYMBOL_TEXT[m[0]], guardFrom: from, guardTo: to });
  }
  // Hide the braces that only delimit a \color scope: {\color{red} text}.
  for (const m of masked.matchAll(/\{\s*\\color\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/g)) {
    const open = m.index!;
    const close = scopeEnd(masked, open + m[0].length);
    if (masked[close] !== "}" || overlapsAny(skip, open, close + 1)) continue;
    found.push(
      { from: open, to: open + 1, text: "", guardFrom: open, guardTo: close + 1 },
      { from: close, to: close + 1, text: "", guardFrom: open, guardTo: close + 1 },
    );
  }
  found.sort((a, b) => a.from - b.from);
  symbolCandidates = found;
  return found;
}

function symbolDecorations(view: EditorView): DecorationSet {
  if (!visualMode) return Decoration.none;
  const selection = view.state.selection.ranges;
  const builder = new RangeSetBuilder<Decoration>();
  let last = -1;
  for (const f of symbolsOf(view)) {
    if (selection.some((r) => r.from <= f.guardTo && r.to >= f.guardFrom)) continue;
    if (f.from < last) continue;
    builder.add(f.from, f.to, f.text ? Decoration.replace({ widget: new SymbolWidget(f.text) }) : Decoration.replace({}));
    last = f.to;
  }
  return builder.finish();
}

const symbolPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = symbolDecorations(view);
    }
    update(update: ViewUpdate) {
      const refreshed = update.transactions.some((tr) => tr.effects.some((e) => e.is(refresh)));
      if (update.docChanged || update.selectionSet || refreshed) this.decorations = symbolDecorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

// --- Reveal + flash a line (used by PDF → source jumps) --------------------

const flashLine = StateEffect.define<number | null>();

const flashField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(flashLine)) continue;
      value =
        effect.value === null
          ? Decoration.none
          : Decoration.set([Decoration.line({ class: "lr-flash-line" }).range(effect.value)]);
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function revealLine(view: EditorView, zeroBasedLine: number) {
  const line = view.state.doc.line(Math.min(view.state.doc.lines, Math.max(1, zeroBasedLine + 1)));
  view.dispatch({
    selection: { anchor: line.from },
    effects: [EditorView.scrollIntoView(line.from, { y: "center" }), flashLine.of(line.from)],
  });
  view.focus();
  setTimeout(() => view.dispatch({ effects: flashLine.of(null) }), 1500);
}

/** Clicking a rendered display equation drops the cursor into its source so the raw LaTeX shows. */
export function revealEquationSource(view: EditorView, event: MouseEvent) {
  const widget = (event.target as HTMLElement | null)?.closest<HTMLElement>(".cm-lv-math-display");
  if (!widget || !view.dom.contains(widget)) return;
  const from = view.posAtDOM(widget);
  const to = Math.min(view.state.doc.length, from + 4000);
  const head = /^\\begin\s*\{[^}]*\}\s*|^\\\[\s*|^\$\$\s*/.exec(view.state.doc.sliceString(from, to));
  event.stopPropagation();
  event.preventDefault();
  view.dispatch({ selection: { anchor: from + (head?.[0].length ?? 0) } });
  view.focus();
}

/** Puts the cursor and scroll position back where another view of the file had them. */
export function restoreView(view: EditorView, position: ViewPosition) {
  const doc = view.state.doc;
  const clampLine = (zeroBased: number) => doc.line(Math.min(doc.lines, Math.max(1, zeroBased + 1)));
  const cursorLine = clampLine(position.line);
  const head = Math.min(cursorLine.to, cursorLine.from + position.character);
  const top = clampLine(position.topLine).from;
  view.dispatch({ selection: { anchor: head } });
  // Heights settle as widgets render, so scroll again once they have.
  const scroll = () => view.dispatch({ effects: EditorView.scrollIntoView(top, { y: "start" }) });
  scroll();
  requestAnimationFrame(() => {
    scroll();
    setTimeout(scroll, 150);
  });
  view.focus();
}

// --- MathLive macros -----------------------------------------------------

// The renderer creates MathLive fields internally with no hook for options,
// so document macros are applied to each field as it appears.
function syncMathMacros(root: HTMLElement) {
  const apply = (field: Element) => {
    const mathField = field as HTMLElement & { macros?: Record<string, unknown> };
    if (mathField.macros) mathField.macros = { ...mathField.macros, ...info.macros };
  };
  new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (!(node instanceof Element)) continue;
        if (node.tagName === "MATH-FIELD") apply(node);
        node.querySelectorAll("math-field").forEach(apply);
      }
    }
  }).observe(root, { childList: true, subtree: true });
}

// --- Live preview while editing an equation's LaTeX ---------------------------

const ROWS_ALIGNED = /^(align|flalign|alignat|eqnarray)\*?$/;
const ROWS_GATHERED = /^(gather|multline)\*?$/;

class EquationPreviewWidget extends WidgetType {
  constructor(private readonly latex: string) {
    super();
  }
  eq(other: EquationPreviewWidget) {
    return other.latex === this.latex;
  }
  toDOM() {
    const wrap = document.createElement("div");
    wrap.className = "lr-eq-preview";
    const field = new MathfieldElement();
    field.readOnly = true;
    field.value = this.latex;
    wrap.appendChild(field);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

/** The display equation whose source contains `head`, with LaTeX MathLive can render. */
function equationAt(state: EditorState, head: number): { end: number; latex: string } | undefined {
  const base = Math.max(0, head - 4000);
  const window = maskComments(state.doc.sliceString(base, Math.min(state.doc.length, head + 4000)));
  const at = head - base;
  const clean = (body: string) => body.replace(/\\(?:label|tag)\s*\{[^}]*\}|\\nonumber|\\notag/g, "").trim();

  for (const span of environments(window)) {
    if (!MATH_ENVIRONMENTS.has(span.name) || at < span.begin || at > span.end) continue;
    const body = clean(window.slice(span.bodyFrom, span.bodyTo));
    const latex = ROWS_ALIGNED.test(span.name)
      ? `\\begin{aligned}${body}\\end{aligned}`
      : ROWS_GATHERED.test(span.name)
        ? `\\begin{gathered}${body}\\end{gathered}`
        : body;
    return body ? { end: base + span.end, latex } : undefined;
  }
  for (const m of window.matchAll(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g)) {
    const from = m.index!;
    const to = from + m[0].length;
    if (at >= from && at <= to) {
      const body = clean(m[1] ?? m[2]);
      return body ? { end: base + to, latex: body } : undefined;
    }
  }
  return undefined;
}

const equationPreview = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    if (!visualMode) return Decoration.none;
    if (!tr.docChanged && !tr.selection && !tr.effects.some((e) => e.is(refresh))) return value;
    const found = equationAt(tr.state, tr.state.selection.main.head);
    if (!found) return Decoration.none;
    return Decoration.set([Decoration.widget({ widget: new EquationPreviewWidget(found.latex), block: true, side: 1 }).range(found.end)]);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function enhancementExtensions(): Extension[] {
  return [documentInfoField, pageScale, colorScopes, referencePlugin, symbolPlugin, flashField, equationPreview];
}

export function attachEnhancementsToDom(root: HTMLElement) {
  sizeNaturalImages(root);
  syncMathMacros(root);
}
