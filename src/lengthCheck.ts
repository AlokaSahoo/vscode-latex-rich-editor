import * as fs from "fs";
import * as path from "path";
import { environments, findInputs, graphicsPaths, readGroup, stripComments } from "./shared/latexText";

// APS length guide (journals.aps.org/authors/length-guide):
//   total = text words + displayed math + figures + tables
//   counted: body text, figure/table captions, footnotes
//   excluded: title, authors, affiliations, abstract, acknowledgments, references
//   displayed math: 16 words per row (32 when it spans both columns)
//   figure: 150/aspect + 20 (single column), 300/(0.5*aspect) + 40 (double column)
//   table: 13 + 6.5/line (single column), 26 + 13/line (double column)

export const LETTER_LIMIT = 3750;

export interface FigureCount {
  label: string;
  words: number;
  aspect: number;
  wide: boolean;
  estimated: boolean;
}

export interface LengthReport {
  textWords: number;
  captionWords: number;
  equations: { rows: number; words: number };
  figures: FigureCount[];
  tables: Array<{ label: string; lines: number; words: number; wide: boolean }>;
  total: number;
  limit: number;
}

const MATH_ENV = /^(equation|align|gather|multline|eqnarray|flalign|alignat)\*?$/;
const MATRIX_ENV = /^(matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|smallmatrix|cases|array|subarray)\*?$/;
const EXCLUDED_ENV = /^(abstract|acknowledgments|acknowledgements|thebibliography)$/;
const EXCLUDED_COMMANDS = [
  "title", "author", "affiliation", "altaffiliation", "email", "homepage", "date", "thanks",
  "keywords", "pacs", "collaboration", "noaffiliation", "bibliography", "bibliographystyle",
];

/** `mainText` lets callers count unsaved editor contents of the main file. */
export function countLength(mainFile: string, mainText?: string, limit = LETTER_LIMIT): LengthReport {
  const root = path.dirname(mainFile);
  const source = expandInputs(mainFile, root, new Set(), mainText);
  const begin = source.search(/\\begin\s*\{document\}/);
  const end = source.search(/\\end\s*\{document\}/);
  let body = source.slice(begin >= 0 ? begin + "\\begin{document}".length : 0, end >= 0 ? end : undefined);
  const folders = ["", ...graphicsPaths(source)];

  const figures: FigureCount[] = [];
  const tables: LengthReport["tables"] = [];
  const equations = { rows: 0, words: 0 };
  let captionWords = 0;

  // Work outermost-first so a figure's internals aren't counted twice.
  const spans = environments(body).filter((s, _i, all) => !all.some((o) => o !== s && o.begin < s.begin && s.end <= o.end && isCounted(o.name)));
  const cuts: Array<{ from: number; to: number }> = [];
  for (const span of spans) {
    const content = body.slice(span.bodyFrom, span.bodyTo);
    const wide = span.name.endsWith("*") || insideWidetext(body, span.begin);
    if (EXCLUDED_ENV.test(span.name)) {
      cuts.push({ from: span.begin, to: span.end });
    } else if (/^figure\*?$/.test(span.name)) {
      const caption = captionText(content);
      captionWords += words(caption);
      const { aspect, estimated } = figureAspect(content, root, folders);
      const count = span.name === "figure*" ? 300 / (0.5 * aspect) + 40 : 150 / aspect + 20;
      figures.push({ label: labelOf(content) ?? `Figure ${figures.length + 1}`, words: Math.round(count), aspect, wide: span.name === "figure*", estimated });
      cuts.push({ from: span.begin, to: span.end });
    } else if (/^table\*?$/.test(span.name)) {
      captionWords += words(captionText(content));
      const lines = tableLines(content);
      const count = span.name === "table*" ? 26 + 13 * lines : 13 + 6.5 * lines;
      tables.push({ label: labelOf(content) ?? `Table ${tables.length + 1}`, lines, words: Math.round(count), wide: span.name === "table*" });
      cuts.push({ from: span.begin, to: span.end });
    } else if (MATH_ENV.test(span.name)) {
      const rows = mathRows(content);
      equations.rows += rows;
      equations.words += rows * (wide ? 32 : 16);
      cuts.push({ from: span.begin, to: span.end });
    }
  }
  body = cutRanges(body, cuts);

  // \[ … \] and $$ … $$ display math.
  body = body.replace(/\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g, (match, a, b, offset) => {
    const rows = mathRows(a ?? b);
    equations.rows += rows;
    equations.words += rows * (insideWidetext(body, offset) ? 32 : 16);
    return " ";
  });

  const textWords = words(plainBody(body));
  const total = Math.round(
    textWords + captionWords + equations.words + figures.reduce((s, f) => s + f.words, 0) + tables.reduce((s, t) => s + t.words, 0),
  );
  return { textWords, captionWords, equations, figures, tables, total, limit };
}

function isCounted(name: string): boolean {
  return EXCLUDED_ENV.test(name) || /^(figure|table)\*?$/.test(name) || MATH_ENV.test(name);
}

function expandInputs(file: string, root: string, seen: Set<string>, override?: string): string {
  if (seen.has(file) || (override === undefined && !fs.existsSync(file))) return "";
  seen.add(file);
  let text = stripComments(override ?? fs.readFileSync(file, "utf8"));
  for (const name of findInputs(text)) {
    const child = expandInputs(path.join(root, name), root, seen);
    text = text.replace(new RegExp(`\\\\(?:input|include|subfile)\\s*\\{${escapeRegExp(name.replace(/\.tex$/, ""))}(?:\\.tex)?\\}`), () => child);
  }
  return text;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cutRanges(text: string, cuts: Array<{ from: number; to: number }>): string {
  let result = "";
  let at = 0;
  for (const cut of [...cuts].sort((a, b) => a.from - b.from)) {
    if (cut.from < at) continue;
    result += `${text.slice(at, cut.from)} `;
    at = cut.to;
  }
  return result + text.slice(at);
}

function insideWidetext(text: string, offset: number): boolean {
  return environments(text).some((s) => s.name === "widetext" && s.begin < offset && offset < s.end);
}

function captionText(content: string): string {
  let text = "";
  for (const m of content.matchAll(/\\(?:sub)?caption\*?\s*(?:\[[^\]]*\])?\s*\{/g)) {
    const group = readGroup(content, m.index! + m[0].length - 1);
    if (group) text += ` ${group.content}`;
  }
  return plainBody(text);
}

function labelOf(content: string): string | undefined {
  return /\\label\s*\{([^}]+)\}/.exec(content)?.[1];
}

/** Rows of displayed math: line breaks at the top level (not inside matrices or cases). */
function mathRows(content: string): number {
  let flat = content;
  for (const span of environments(content).filter((s) => MATRIX_ENV.test(s.name)).reverse()) {
    flat = flat.slice(0, span.begin) + " ".repeat(span.end - span.begin) + flat.slice(span.end);
  }
  const breaks = (flat.replace(/\\\\\s*$/, "").match(/\\\\/g) ?? []).length;
  return breaks + 1;
}

function tableLines(content: string): number {
  let lines = 0;
  for (const span of environments(content).filter((s) => /^(tabular\*?|tabularx|longtable)$/.test(s.name))) {
    const inner = content.slice(span.bodyFrom, span.bodyTo).replace(/\\\\\s*(\\hline|\\toprule|\\midrule|\\bottomrule|\s)*$/, "");
    lines += (inner.match(/\\\\/g) ?? []).length + 1;
  }
  return Math.max(lines, 1);
}

/** Aspect ratio (width / height) of the figure as laid out, from the image files. */
function figureAspect(content: string, root: string, folders: string[]): { aspect: number; estimated: boolean } {
  const panels: Array<{ width: number; aspect: number }> = [];
  let estimated = false;
  const graphics = [...content.matchAll(/\\includegraphics\*?\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/g)];
  const panelWidths = [...content.matchAll(/\\begin\s*\{(?:subfigure|minipage)\}\s*(?:\[[^\]]*\])?\s*\{\s*([\d.]*)\s*\\(?:linewidth|columnwidth|textwidth)/g)].map((m) => Number(m[1] || 1));

  graphics.forEach((g, i) => {
    const option = /width\s*=\s*([\d.]*)\s*\\(?:linewidth|columnwidth|textwidth|hsize)/.exec(g[1] ?? "");
    let width = option ? Number(option[1] || 1) : 1;
    // Inside a subfigure/minipage the image width is relative to the panel.
    if (panelWidths[i] !== undefined) width *= panelWidths[i];
    const measured = imageAspect(root, folders, g[2].trim());
    if (measured === undefined) estimated = true;
    panels.push({ width, aspect: measured ?? 1.5 });
  });
  if (panels.length === 0) return { aspect: 1.5, estimated: true };

  // Lay panels out in rows that fit the line width, stacking rows vertically.
  let height = 0;
  let maxRowWidth = 0;
  let rowWidth = 0;
  let rowHeight = 0;
  for (const panel of panels) {
    if (rowWidth > 0 && rowWidth + panel.width > 1.02) {
      height += rowHeight;
      maxRowWidth = Math.max(maxRowWidth, rowWidth);
      rowWidth = 0;
      rowHeight = 0;
    }
    rowWidth += panel.width;
    rowHeight = Math.max(rowHeight, panel.width / panel.aspect);
  }
  height += rowHeight;
  maxRowWidth = Math.max(maxRowWidth, rowWidth);
  return { aspect: maxRowWidth / height, estimated };
}

function imageAspect(root: string, folders: string[], requested: string): number | undefined {
  const extensions = /\.\w+$/.test(requested) ? [""] : [".pdf", ".png", ".jpg", ".jpeg"];
  for (const folder of folders) {
    for (const extension of extensions) {
      const file = path.join(root, folder, requested + extension);
      if (!fs.existsSync(file)) continue;
      const size = imageSize(fs.readFileSync(file), path.extname(file).toLowerCase());
      return size && size.height > 0 ? size.width / size.height : undefined;
    }
  }
  return undefined;
}

export function imageSize(data: Buffer, extension: string): { width: number; height: number } | undefined {
  if (extension === ".png" && data.length > 24) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if ((extension === ".jpg" || extension === ".jpeg") && data[0] === 0xff && data[1] === 0xd8) {
    let at = 2;
    while (at + 9 < data.length) {
      if (data[at] !== 0xff) return undefined;
      const marker = data[at + 1];
      const length = data.readUInt16BE(at + 2);
      // SOF0..SOF15 except DHT/JPG/DAC carry the frame size.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: data.readUInt16BE(at + 5), width: data.readUInt16BE(at + 7) };
      }
      at += 2 + length;
    }
    return undefined;
  }
  if (extension === ".pdf") {
    const head = data.toString("latin1");
    const box = /\/(?:CropBox|MediaBox)\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/.exec(head);
    if (box) {
      const [x0, y0, x1, y1] = box.slice(1).map(Number);
      return { width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
    }
  }
  return undefined;
}

/** Plain words of running text: markup removed, inline math and \ref as one word each, citations dropped. */
function plainBody(text: string): string {
  let t = text;
  for (const command of EXCLUDED_COMMANDS) {
    const pattern = new RegExp(`\\\\${command}\\*?\\s*(?:\\[[^\\]]*\\])?\\s*\\{`, "g");
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(t))) {
      const group = readGroup(t, m.index + m[0].length - 1);
      t = t.slice(0, m.index) + " " + (group ? t.slice(group.end) : t.slice(m.index + m[0].length));
      pattern.lastIndex = m.index;
    }
  }
  return t
    .replace(/\\(?:cite\w*|onlinecite|nocite|label|vspace|hspace)\*?\s*(?:\[[^\]]*\])*\s*\{[^}]*\}/g, " ")
    // Color names are arguments, not words; the colored text itself stays.
    .replace(/\\fcolorbox\s*\{[^}]*\}\s*\{[^}]*\}/g, " ")
    .replace(/\\(?:textcolor|colorbox|color)\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/g, " ")
    .replace(/\\(?:eq|auto|c|C|page|name)?ref\*?\s*\{[^}]*\}/g, " X ")
    .replace(/\$[^$]+\$|\\\([\s\S]*?\\\)/g, " X ")
    .replace(/\\(?:begin|end)\s*\{[^}]*\}(?:\s*\[[^\]]*\])?/g, " ")
    .replace(/\\(?:maketitle|centering|noindent|newpage|clearpage|item|par|hfill|vfill|smallskip|medskip|bigskip)\b/g, " ")
    .replace(/\\[A-Za-z]+\*?/g, " ")
    .replace(/[{}~\\]/g, " ");
}

function words(text: string): number {
  return text.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
}
