// Pure LaTeX text helpers shared by the extension host and the rich view.
// No VS Code or DOM APIs here, so both bundles (and tests) can use them.

const VERBATIM = /^(verbatim\*?|lstlisting|minted|Verbatim|comment)$/;

/**
 * Blanks out comments while keeping every character's offset (and line
 * number) unchanged, so positions found in the result map back 1:1.
 * `\%` is kept; verbatim-like environments are left untouched.
 */
export function maskComments(text: string): string {
  const out = text.split("");
  let verbatim: string | null = null;
  for (let i = 0; i < text.length; i++) {
    if (verbatim) {
      const end = `\\end{${verbatim}}`;
      if (text.startsWith(end, i)) {
        verbatim = null;
        i += end.length - 1;
      }
      continue;
    }
    const c = text[i];
    if (c === "\\") {
      const begin = /^\\begin\{([^}]+)\}/.exec(text.slice(i, i + 40));
      if (begin && VERBATIM.test(begin[1])) {
        verbatim = begin[1];
        i += begin[0].length - 1;
        continue;
      }
      i++;
      continue;
    }
    if (c === "%") {
      while (i < text.length && text[i] !== "\n") out[i++] = " ";
      i--;
    }
  }
  return out.join("");
}

/**
 * Removes comments for publication (arXiv publishes sources). Whole-line
 * comments are dropped; an inline comment keeps its "%" since that suppresses
 * the line-end space. `\begin{comment}` blocks go too; verbatim stays intact.
 */
export function stripComments(text: string): string {
  const out: string[] = [];
  let verbatim: string | null = null;
  let commentBlock = false;
  for (const line of text.split("\n")) {
    if (commentBlock) {
      if (/\\end\s*\{comment\}/.test(line)) commentBlock = false;
      continue;
    }
    if (verbatim) {
      out.push(line);
      if (line.includes(`\\end{${verbatim}}`)) verbatim = null;
      continue;
    }
    if (/^\s*\\begin\s*\{comment\}/.test(line)) {
      commentBlock = !/\\end\s*\{comment\}/.test(line);
      continue;
    }
    const begin = /\\begin\s*\{(verbatim\*?|lstlisting|minted|Verbatim)\}/.exec(line);
    const cut = begin ? -1 : firstUnescapedPercent(line);
    if (begin && !line.includes(`\\end{${begin[1]}}`)) verbatim = begin[1];
    if (cut < 0) out.push(line);
    else if (line.slice(0, cut).trim()) out.push(line.slice(0, cut + 1));
  }
  return out.join("\n");
}

function firstUnescapedPercent(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "%") return i;
  }
  return -1;
}

/** Contents of the brace group whose "{" is at `open`, plus the index after its "}". */
export function readGroup(text: string, open: number): { content: string; end: number } | null {
  if (text[open] !== "{") return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return { content: text.slice(open + 1, i), end: i + 1 };
  }
  return null;
}

/** Same as `lineAt` for many offsets in one text: builds the line starts once, then binary-searches. */
export function lineIndex(text: string): (offset: number) => number {
  const starts: number[] = [];
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) starts.push(i);
  // starts[k] is the offset of the k-th newline; the line of an offset is the number of newlines before it.
  return (offset) => {
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
}

export function lineAt(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

// --- Environments ---------------------------------------------------------

export interface EnvironmentSpan {
  name: string;
  begin: number; // offset of "\begin"
  bodyFrom: number;
  bodyTo: number; // offset of "\end"
  end: number; // offset after "\end{name}"
}

export function environments(masked: string): EnvironmentSpan[] {
  const spans: EnvironmentSpan[] = [];
  const stack: Array<{ name: string; begin: number; bodyFrom: number }> = [];
  for (const m of masked.matchAll(/\\(begin|end)\s*\{([^}]+)\}/g)) {
    const name = m[2].trim();
    if (m[1] === "begin") {
      stack.push({ name, begin: m.index!, bodyFrom: m.index! + m[0].length });
    } else {
      const index = stack.map((s) => s.name).lastIndexOf(name);
      if (index < 0) continue;
      const open = stack[index];
      stack.splice(index);
      spans.push({ name, begin: open.begin, bodyFrom: open.bodyFrom, bodyTo: m.index!, end: m.index! + m[0].length });
    }
  }
  return spans.sort((a, b) => a.begin - b.begin);
}

/** Innermost environments containing `offset`, innermost last. */
export function enclosing(spans: EnvironmentSpan[], offset: number): EnvironmentSpan[] {
  return spans.filter((s) => s.begin < offset && offset < s.end).sort((a, b) => a.begin - b.begin);
}

export const MATH_ENVIRONMENTS = new Set([
  "equation", "equation*", "align", "align*", "gather", "gather*", "multline", "multline*",
  "eqnarray", "eqnarray*", "flalign", "flalign*", "alignat", "alignat*",
]);
const FIGURE_ENVIRONMENTS = /^(figure\*?|wrapfigure\*?|subfigure)$/;
const TABLE_ENVIRONMENTS = /^(table\*?|subtable)$/;

// --- Reference commands -----------------------------------------------------

export const CITE_COMMANDS = new Set([
  "cite", "citep", "citet", "Citet", "Citep", "citealp", "citealt", "citeauthor", "citeyear",
  "onlinecite", "autocite", "parencite", "textcite", "footcite", "nocite",
]);
export const LABEL_COMMANDS = new Set(["ref", "eqref", "autoref", "cref", "Cref", "pageref", "nameref", "vref", "subref"]);

/** `\cmd[opt]{keys` immediately before the cursor, e.g. while typing a \cite key. */
export const OPEN_REFERENCE = /\\([A-Za-z]+)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^}]*)$/;

/** Every complete `\cmd[opt]{keys}` on a line, for hovers. */
export const REFERENCE_CALL = /\\([A-Za-z]+)\*?(?:\s*\[[^\]]*\]){0,2}\s*\{([^}]*)\}/g;

// --- Labels ---------------------------------------------------------------

export type LabelKind = "equation" | "figure" | "table" | "section" | "other";

export interface LabelInfo {
  key: string;
  line: number;
  kind: LabelKind;
  /** Caption, section title, or the equation's LaTeX. */
  context: string;
  /** For figures: the first \includegraphics file. */
  graphic?: string;
  /** For equations: environment name, to render multi-row math correctly. */
  environment?: string;
}

export function findLabels(text: string): LabelInfo[] {
  const masked = maskComments(text);
  const spans = environments(masked);
  const lineOf = lineIndex(text);
  const headings = headingsIn(text, masked);
  const labels: LabelInfo[] = [];
  for (const m of masked.matchAll(/\\label\s*\{([^}]+)\}/g)) {
    const at = m.index!;
    const stack = enclosing(spans, at);
    const math = [...stack].reverse().find((s) => MATH_ENVIRONMENTS.has(s.name));
    const figure = [...stack].reverse().find((s) => FIGURE_ENVIRONMENTS.test(s.name));
    const table = [...stack].reverse().find((s) => TABLE_ENVIRONMENTS.test(s.name));
    const info: LabelInfo = { key: m[1].trim(), line: lineOf(at), kind: "other", context: "" };
    if (math) {
      info.kind = "equation";
      info.environment = math.name;
      info.context = text.slice(math.bodyFrom, math.bodyTo).replace(/\\label\s*\{[^}]*\}/g, "").trim();
    } else if (figure || table) {
      const span = (figure ?? table)!;
      info.kind = figure ? "figure" : "table";
      info.context = captionIn(text, masked, span) ?? "";
      if (figure) info.graphic = /\\includegraphics\*?\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/.exec(masked.slice(span.bodyFrom, span.bodyTo))?.[1];
    } else {
      const heading = lastHeadingBefore(masked, headings, at);
      if (heading) {
        info.kind = "section";
        info.context = heading;
      }
    }
    labels.push(info);
  }
  return labels;
}

function captionIn(text: string, masked: string, span: EnvironmentSpan): string | undefined {
  const body = masked.slice(span.bodyFrom, span.bodyTo);
  const m = /\\caption\s*(?:\[[^\]]*\])?\s*\{/g;
  let last: string | undefined;
  for (const c of body.matchAll(m)) {
    const group = readGroup(text, span.bodyFrom + c.index! + c[0].length - 1);
    if (group) last = group.content;
  }
  return last ? plainText(last) : undefined;
}

const HEADING = /\\(part|chapter|section|subsection|subsubsection|paragraph)\*?\s*(?:\[[^\]]*\])?\s*\{/g;

interface Heading {
  from: number;
  end: number;
  title: string;
}

function headingsIn(text: string, masked: string): Heading[] {
  const found: Heading[] = [];
  for (const m of masked.matchAll(HEADING)) {
    const group = readGroup(text, m.index! + m[0].length - 1);
    if (group) found.push({ from: m.index!, end: group.end, title: plainText(group.content) });
  }
  return found;
}

/** The title of the heading a label at `offset` directly follows (only whitespace between), if any. */
function lastHeadingBefore(masked: string, headings: Heading[], offset: number): string | undefined {
  // The last heading starting before the label; an earlier one can't qualify, as the later one would sit between.
  let lo = 0;
  let hi = headings.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (headings[mid].from < offset) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo - 1; i >= 0; i--) {
    const heading = headings[i];
    // A label inside the heading's own braces belongs to it, as does one that follows it directly.
    if (heading.end > offset || /^\s*$/.test(masked.slice(heading.end, offset))) return heading.title;
    return undefined;
  }
  return undefined;
}

/** Strips LaTeX markup down to readable text (for captions, titles, tooltips). */
export function plainText(latex: string): string {
  return latex
    .replace(/\\(?:label|ref|eqref|cite\w*)\s*\{[^}]*\}/g, "")
    .replace(/\\(La)?TeX\b\s*/g, (_m, la) => `${la ?? ""}TeX `)
    .replace(/\\([%&#_$])/g, "$1")
    .replace(/\\[A-Za-z]+\*?\s*(?:\[[^\]]*\])?/g, "")
    .replace(/[{}~]/g, (c) => (c === "~" ? " " : ""))
    .replace(/\s+/g, " ")
    .trim();
}

// --- Bibliography -----------------------------------------------------------

export interface BibEntry {
  key: string;
  type: string;
  author?: string;
  title?: string;
  year?: string;
  journal?: string;
  /** Full text for \bibitem entries in thebibliography. */
  text?: string;
}

export function parseBib(text: string): BibEntry[] {
  const entries: BibEntry[] = [];
  for (const m of text.matchAll(/@(\w+)\s*\{\s*([^,\s]+)\s*,/g)) {
    const type = m[1].toLowerCase();
    if (type === "comment" || type === "string" || type === "preamble") continue;
    const body = readGroup(text, m.index! + m[0].indexOf("{"))?.content ?? "";
    const entry: BibEntry = { key: m[2], type };
    for (const field of ["author", "title", "year", "journal", "booktitle"] as const) {
      const value = bibField(body, field);
      if (!value) continue;
      if (field === "booktitle") entry.journal ??= value;
      else entry[field] = value;
    }
    entries.push(entry);
  }
  return entries;
}

function bibField(body: string, field: string): string | undefined {
  const m = new RegExp(`(?:^|,)\\s*${field}\\s*=\\s*`, "i").exec(body);
  if (!m) return undefined;
  const at = m.index + m[0].length;
  let value: string | undefined;
  if (body[at] === "{") value = readGroup(body, at)?.content;
  else if (body[at] === '"') value = /^"([^"]*)"/.exec(body.slice(at))?.[1];
  else value = /^[^,}\s]+/.exec(body.slice(at))?.[0];
  return value ? plainText(value) : undefined;
}

/** Entries from an inline thebibliography environment. */
export function findBibitems(text: string): BibEntry[] {
  const masked = maskComments(text);
  const items: BibEntry[] = [];
  const pattern = /\\bibitem\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
  const matches = [...masked.matchAll(pattern)];
  matches.forEach((m, i) => {
    const from = m.index! + m[0].length;
    const to = i + 1 < matches.length ? matches[i + 1].index! : masked.search(/\\end\s*\{thebibliography\}/);
    items.push({ key: m[1].trim(), type: "bibitem", text: plainText(text.slice(from, to > from ? to : undefined)) });
  });
  return items;
}

/** .bib file names referenced by \bibliography / \addbibresource. */
export function bibFiles(text: string): string[] {
  const masked = maskComments(text);
  const names: string[] = [];
  for (const m of masked.matchAll(/\\(?:bibliography|addbibresource|addglobalbib)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g)) {
    for (const name of m[1].split(",")) {
      const trimmed = name.trim();
      if (trimmed) names.push(/\.bib$/i.test(trimmed) ? trimmed : `${trimmed}.bib`);
    }
  }
  return names;
}

export function describeBibEntry(entry: BibEntry): string {
  if (entry.text) return entry.text;
  const authors = entry.author?.split(/\s+and\s+/i) ?? [];
  const first = authors[0]?.includes(",") ? authors[0].split(",")[0] : authors[0]?.split(" ").pop();
  const who = first ? `${first}${authors.length > 1 ? " et al." : ""}` : "";
  return [who && `${who}${entry.year ? ` (${entry.year})` : ""}`, entry.title, entry.journal]
    .filter(Boolean)
    .join(". ");
}

// --- Document structure -----------------------------------------------------

export interface OutlineItem {
  kind: "section" | "figure" | "table" | "equation";
  level: number; // 0 part … 5 paragraph; floats/equations nest under sections
  title: string;
  line: number;
  label?: string;
  children: OutlineItem[];
}

const LEVELS: Record<string, number> = {
  part: 0, chapter: 1, section: 2, subsection: 3, subsubsection: 4, paragraph: 5,
};

export function outline(text: string): OutlineItem[] {
  const masked = maskComments(text);
  const lineOf = lineIndex(text);
  const flat: Array<OutlineItem & { at: number }> = [];

  for (const m of masked.matchAll(HEADING)) {
    const group = readGroup(text, m.index! + m[0].length - 1);
    if (!group) continue;
    flat.push({ kind: "section", level: LEVELS[m[1]], title: plainText(group.content), line: lineOf(m.index!), at: m.index!, children: [] });
  }
  for (const span of environments(masked)) {
    const kind = FIGURE_ENVIRONMENTS.test(span.name) && span.name !== "subfigure"
      ? "figure"
      : TABLE_ENVIRONMENTS.test(span.name) && span.name !== "subtable"
        ? "table"
        : MATH_ENVIRONMENTS.has(span.name) && !span.name.endsWith("*")
          ? "equation"
          : null;
    if (!kind) continue;
    const body = masked.slice(span.bodyFrom, span.bodyTo);
    const label = /\\label\s*\{([^}]+)\}/.exec(body)?.[1];
    const caption = kind === "equation" ? undefined : captionIn(text, masked, span);
    const title = caption || (kind === "equation" ? plainEquation(text.slice(span.bodyFrom, span.bodyTo)) : span.name);
    flat.push({ kind, level: 9, title, line: lineOf(span.begin), at: span.begin, label, children: [] });
  }

  flat.sort((a, b) => a.at - b.at);
  const roots: OutlineItem[] = [];
  const stack: OutlineItem[] = [];
  for (const { at: _at, ...item } of flat) {
    while (stack.length && stack[stack.length - 1].level >= item.level) stack.pop();
    (stack.length ? stack[stack.length - 1].children : roots).push(item);
    if (item.kind === "section") stack.push(item);
  }
  return roots;
}

function plainEquation(body: string): string {
  const compact = body.replace(/\\label\s*\{[^}]*\}/g, "").replace(/\s+/g, " ").trim();
  return compact.length > 60 ? `${compact.slice(0, 57)}…` : compact;
}

/** A figure environment for an image path; as a VS Code snippet the caption is a tab stop. */
export function figureEnvironment(relativePath: string, asSnippet: boolean): string {
  const file = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  const name = file.replace(/\.[^.]+$/, "");
  const label = `fig:${name.replace(/[^A-Za-z0-9_-]+/g, "-")}`;
  const caption = asSnippet ? "${1:Caption}" : "";
  const escapedPath = asSnippet ? relativePath.replace(/[$}\\]/g, "\\$&") : relativePath;
  return [
    "\\begin{figure}",
    "  \\centering",
    `  \\includegraphics[width=\\linewidth]{${escapedPath}}`,
    `  \\caption{${caption}}`,
    `  \\label{${label}}`,
    "\\end{figure}",
    "",
  ].join("\n");
}

// --- Files the document depends on -----------------------------------------

export interface GraphicUse {
  path: string;
  options: string;
  offset: number;
}

export function findGraphics(text: string): GraphicUse[] {
  const masked = maskComments(text);
  return [...masked.matchAll(/\\includegraphics\*?\s*(?:\[([^\]]*)\])?\s*\{([^}]+)\}/g)].map((m) => ({
    path: m[2].trim(),
    options: m[1] ?? "",
    offset: m.index!,
  }));
}

export function graphicsPaths(text: string): string[] {
  const match = /\\graphicspath\s*\{((?:\s*\{[^}]*\})+)\s*\}/.exec(maskComments(text));
  if (!match) return [];
  return [...match[1].matchAll(/\{([^}]*)\}/g)].map((m) => m[1].trim()).filter(Boolean);
}

/** Files pulled in with \input / \include / \subfile (as written, ".tex" added if missing). */
export function findInputs(text: string): string[] {
  const masked = maskComments(text);
  return [...masked.matchAll(/\\(?:input|include|subfile)\s*\{([^}]+)\}/g)].map((m) => {
    const name = m[1].trim();
    return /\.\w+$/.test(name) ? name : `${name}.tex`;
  });
}
