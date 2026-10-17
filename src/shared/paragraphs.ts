// Paragraph view: LaTeX treats consecutive source lines as one paragraph and
// only a blank line ends it, so the rich view can show them flowed together.
// This works out which line breaks to hide, as ranges of the document.

export interface ViewOptions {
  /** Flow consecutive text lines into one paragraph and collapse blank-line runs. */
  paragraphs: boolean;
  /** Show `%` comments; when false, comment lines and trailing comments are hidden. */
  showComments: boolean;
}

/** A range of the document to hide, optionally leaving `text` (a single space) in its place. */
export interface Fold {
  from: number;
  to: number;
  text: "" | " ";
}

export type LineKind =
  /** Only whitespace. */
  | "blank"
  /** Only a `%` comment. */
  | "comment"
  /** Inside verbatim-like text: nothing is interpreted. */
  | "literal"
  /** Inside math, a table or similar, where line breaks matter. */
  | "structure"
  /** A command that stands alone on its line (\begin, \section, \label, …). */
  | "hard"
  /** Starts a paragraph-like unit that continues on the next lines (\item, \caption, \noindent). */
  | "start"
  /** Ordinary running text. */
  | "text";

const LITERAL_ENVS = new Set(["verbatim", "Verbatim", "lstlisting", "minted", "comment"]);
const STRUCTURE_ENVS = new Set([
  "equation", "equation*", "align", "align*", "alignat", "alignat*", "gather", "gather*", "multline", "multline*",
  "flalign", "flalign*", "eqnarray", "eqnarray*", "displaymath", "math", "split", "subequations", "array",
  "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "smallmatrix", "cases",
  "tabular", "tabular*", "tabularx", "longtable", "tabbing", "ruledtabular", "tikzpicture", "picture",
  "thebibliography",
]);

const HARD =
  /^\\(?:begin|end|section|subsection|subsubsection|paragraph|subparagraph|chapter|part|label|maketitle|title|author|affiliation|email|date|thanks|usepackage|documentclass|input|include|bibliography|bibliographystyle|newcommand|renewcommand|providecommand|DeclareMathOperator|def|let|newtheorem|newpage|clearpage|pagebreak|centering|includegraphics|hline|toprule|midrule|bottomrule|cline|vspace|vfill|appendix|tableofcontents|printbibliography|setlength|hypersetup|graphicspath|bibitem|keywords|pacs|preprint|setcounter)\b/;
const START = /^\\(?:item|caption|noindent|footnote)\b/;

/** Index in `line` where an unescaped `%` comment starts, or -1. */
export function commentStart(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") i++;
    else if (line[i] === "%") return i;
  }
  return -1;
}

/** Classifies every line, following \begin/\end nesting and display math. */
export function classifyLines(lines: string[]): LineKind[] {
  const kinds: LineKind[] = [];
  const stack: string[] = [];
  let displayMath = false;
  for (const line of lines) {
    const trimmed = line.trim();
    const literal = stack.some((env) => LITERAL_ENVS.has(env));
    const structure = stack.some((env) => STRUCTURE_ENVS.has(env)) || displayMath;
    const at = literal ? -1 : commentStart(line);
    const code = at === -1 ? line : line.slice(0, at);
    const codeTrimmed = code.trim();

    let kind: LineKind;
    if (trimmed === "") kind = "blank";
    else if (literal) kind = "literal";
    else if (codeTrimmed === "") kind = "comment";
    else if (structure) kind = "structure";
    else if (HARD.test(codeTrimmed) || /^\\\[|^\$\$/.test(codeTrimmed)) kind = "hard";
    else if (START.test(codeTrimmed)) kind = "start";
    else kind = "text";

    // A line that opens a structural environment is itself structural.
    const opensStructure = /\\begin\{([^}]*)\}/g;
    for (const match of code.matchAll(opensStructure)) {
      if (STRUCTURE_ENVS.has(match[1]) || LITERAL_ENVS.has(match[1])) {
        if (kind === "text" || kind === "start") kind = "structure";
      }
    }

    if (!literal) {
      for (const match of code.matchAll(/\\(begin|end)\{([^}]*)\}/g)) {
        if (match[1] === "begin") stack.push(match[2]);
        else {
          const at = stack.lastIndexOf(match[2]);
          if (at !== -1) stack.length = at;
        }
      }
      const opens = (code.match(/\\\[/g) ?? []).length;
      const closes = (code.match(/\\\]/g) ?? []).length;
      if (opens > closes) displayMath = true;
      else if (closes > opens) displayMath = false;
      if (((code.match(/\$\$/g) ?? []).length & 1) === 1) displayMath = !displayMath;
    } else {
      for (const match of line.matchAll(/\\end\{([^}]*)\}/g)) {
        const at = stack.lastIndexOf(match[1]);
        if (at !== -1 && LITERAL_ENVS.has(match[1])) stack.length = at;
      }
    }
    kinds.push(kind);
  }
  return kinds;
}

/** The part of the line before any trailing `%` comment, with trailing space removed. */
function codeEnd(line: string): number {
  const at = commentStart(line);
  return (at === -1 ? line : line.slice(0, at)).trimEnd().length;
}

function leadingSpace(line: string): number {
  return line.length - line.trimStart().length;
}

/**
 * The ranges to hide for the given options. Ranges are sorted and never overlap.
 * In `lines` mode with comments shown there is nothing to hide.
 */
export function computeFolds(lines: string[], options: ViewOptions): Fold[] {
  if (options.showComments && !options.paragraphs) return [];
  const kinds = classifyLines(lines);
  const starts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    starts.push(offset);
    offset += line.length + 1;
  }

  const folds: Fold[] = [];
  const hideLine = (index: number) => {
    if (index < lines.length - 1) folds.push({ from: starts[index], to: starts[index] + lines[index].length + 1, text: "" });
    else if (index > 0) folds.push({ from: starts[index] - 1, to: starts[index] + lines[index].length, text: "" });
    else folds.push({ from: 0, to: lines[index].length, text: "" });
  };

  let previous = -1; // last visible, non-comment line
  let blankRun = false;
  for (let i = 0; i < lines.length; i++) {
    const kind = kinds[i];
    const hiddenComment = !options.showComments && kind === "comment";

    if (hiddenComment) {
      // Transparent: whatever surrounds it is joined (or not) as if it weren't there.
      // Dropped later if a join range already covers it.
      hideLine(i);
      continue;
    }

    if (kind === "blank") {
      if (options.paragraphs && blankRun) hideLine(i);
      blankRun = true;
      previous = i;
      continue;
    }
    blankRun = false;

    // A trailing comment on a text line.
    const at = kind === "literal" ? -1 : commentStart(lines[i]);
    const hasTrailing = at !== -1 && kind !== "comment";
    if (hasTrailing && !options.showComments) {
      folds.push({ from: starts[i] + codeEnd(lines[i]), to: starts[i] + lines[i].length, text: "" });
    }

    if (options.paragraphs && kind === "text" && previous !== -1) {
      const before = kinds[previous];
      const prevLine = lines[previous];
      const prevCode = prevLine.slice(0, codeEnd(prevLine));
      const prevHasTrailing = before !== "comment" && commentStart(prevLine) !== -1;
      const continues =
        (before === "text" || before === "start") &&
        !/\\\\\s*(\[[^\]]*\])?$/.test(prevCode) &&
        !(options.showComments && prevHasTrailing);
      if (continues) {
        folds.push({
          from: starts[previous] + codeEnd(prevLine),
          to: starts[i] + leadingSpace(lines[i]),
          text: " ",
        });
      }
    }
    previous = i;
  }

  // Sort, and drop folds already covered by a join (comment lines between joined text).
  folds.sort((a, b) => a.from - b.from || b.to - a.to);
  const result: Fold[] = [];
  for (const fold of folds) {
    const last = result[result.length - 1];
    if (last && fold.from < last.to) {
      if (fold.to <= last.to) continue;
      // Partial overlap: extend the earlier fold, keeping its replacement text.
      last.to = fold.to;
      continue;
    }
    result.push(fold);
  }
  return result;
}
