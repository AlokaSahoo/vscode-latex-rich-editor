import { describe, expect, it } from "vitest";
import {
  bibFiles,
  describeBibEntry,
  environments,
  figureEnvironment,
  findBibitems,
  findGraphics,
  findInputs,
  findLabels,
  graphicsPaths,
  maskComments,
  outline,
  parseBib,
  plainText,
  readGroup,
  stripComments,
} from "../src/shared/latexText";

describe("maskComments", () => {
  it("blanks comments but keeps offsets", () => {
    const text = "a % hidden\nb";
    const masked = maskComments(text);
    expect(masked).toHaveLength(text.length);
    expect(masked.trim().split("\n").map((l) => l.trim())).toEqual(["a", "b"]);
  });
  it("keeps \\% and verbatim content", () => {
    expect(maskComments("50\\% done")).toBe("50\\% done");
    const verb = "\\begin{verbatim}% not a comment\\end{verbatim}";
    expect(maskComments(verb)).toBe(verb);
  });
});

describe("stripComments", () => {
  it("drops whole-line comments and keeps the % of inline ones", () => {
    expect(stripComments("% gone\nkeep % note\nend")).toBe("keep %\nend");
  });
  it("removes comment environments", () => {
    expect(stripComments("a\n\\begin{comment}\nx\n\\end{comment}\nb")).toBe("a\nb");
  });
  it("leaves escaped percent alone", () => {
    expect(stripComments("100\\% sure")).toBe("100\\% sure");
  });
});

describe("readGroup", () => {
  it("reads nested braces and skips escapes", () => {
    expect(readGroup("{a{b}\\}c}d", 0)).toEqual({ content: "a{b}\\}c", end: 9 });
  });
  it("returns null when unbalanced or not at a brace", () => {
    expect(readGroup("{abc", 0)).toBeNull();
    expect(readGroup("abc", 0)).toBeNull();
  });
});

describe("environments", () => {
  it("finds nested spans with body ranges", () => {
    const text = "\\begin{a}x\\begin{b}y\\end{b}z\\end{a}";
    const spans = environments(text);
    expect(spans.map((s) => s.name)).toEqual(["a", "b"]);
    expect(text.slice(spans[0].bodyFrom, spans[0].bodyTo)).toBe("x\\begin{b}y\\end{b}z");
  });
  it("ignores an unmatched \\end", () => {
    expect(environments("\\end{a}")).toEqual([]);
  });
});

describe("findLabels", () => {
  const text = [
    "\\section{Intro}\\label{sec:i}",
    "\\begin{equation}a=b\\label{eq:a}\\end{equation}",
    "\\begin{figure}\\includegraphics{pic}\\caption{A \\emph{fig}}\\label{fig:p}\\end{figure}",
    "\\begin{table}\\caption{Tab}\\label{tab:t}\\end{table}",
  ].join("\n");
  const labels = Object.fromEntries(findLabels(text).map((l) => [l.key, l]));

  it("classifies labels", () => {
    expect(labels["sec:i"]).toMatchObject({ kind: "section", context: "Intro" });
    expect(labels["eq:a"]).toMatchObject({ kind: "equation", context: "a=b", environment: "equation" });
    expect(labels["fig:p"]).toMatchObject({ kind: "figure", context: "A fig", graphic: "pic" });
    expect(labels["tab:t"]).toMatchObject({ kind: "table", context: "Tab" });
  });
  it("records the line", () => {
    expect(labels["eq:a"].line).toBe(1);
  });
  it("ignores commented labels", () => {
    expect(findLabels("% \\label{x}")).toEqual([]);
  });
});

describe("bibliography", () => {
  const bib = `@article{smith2020, author = {Smith, Jo and Lee, Al}, title = {A {Title}}, journal = {PRL}, year = 2020}
@comment{ignored}
@book{b, title="Quoted", year={1999}}`;
  it("parses entries and skips @comment", () => {
    const entries = parseBib(bib);
    expect(entries.map((e) => e.key)).toEqual(["smith2020", "b"]);
    expect(entries[0]).toMatchObject({ type: "article", title: "A Title", journal: "PRL", year: "2020" });
    expect(entries[1].title).toBe("Quoted");
  });
  it("describes entries", () => {
    expect(describeBibEntry(parseBib(bib)[0])).toBe("Smith et al. (2020). A Title. PRL");
  });
  it("reads \\bibitem entries", () => {
    const items = findBibitems("\\begin{thebibliography}{9}\\bibitem{k1} First ref.\\bibitem[x]{k2} Second.\\end{thebibliography}");
    expect(items.map((i) => [i.key, i.text])).toEqual([["k1", "First ref."], ["k2", "Second."]]);
  });
  it("lists .bib files", () => {
    expect(bibFiles("\\bibliography{a,b.bib}\\addbibresource{c.bib}")).toEqual(["a.bib", "b.bib", "c.bib"]);
  });
});

describe("outline", () => {
  const items = outline(
    "\\section{One}\n\\begin{equation}x\\end{equation}\n\\subsection{Sub}\n\\begin{figure}\\caption{Cap}\\end{figure}\n\\section{Two}",
  );
  it("nests floats and equations under sections", () => {
    expect(items.map((i) => i.title)).toEqual(["One", "Two"]);
    expect(items[0].children.map((c) => [c.kind, c.title])).toEqual([["equation", "x"], ["section", "Sub"]]);
    expect(items[0].children[1].children[0]).toMatchObject({ kind: "figure", title: "Cap" });
  });
  it("skips unnumbered equations", () => {
    expect(outline("\\begin{equation*}x\\end{equation*}")).toEqual([]);
  });
});

describe("misc helpers", () => {
  it("plainText strips markup", () => {
    expect(plainText("A \\emph{bold}~claim\\% \\cite{x}")).toBe("A bold claim%");
  });
  it("finds graphics, graphicspath and inputs", () => {
    expect(findGraphics("\\includegraphics[width=3cm]{figs/a}")[0]).toMatchObject({ path: "figs/a", options: "width=3cm" });
    expect(graphicsPaths("\\graphicspath{{figs/}{other/}}")).toEqual(["figs/", "other/"]);
    expect(findInputs("\\input{a}\\include{b.tex}\\subfile{c}")).toEqual(["a.tex", "b.tex", "c.tex"]);
  });
  it("builds a figure environment", () => {
    const text = figureEnvironment("figures/a.png", false);
    expect(text).toContain("\\includegraphics");
    expect(text).toContain("figures/a");
  });
});
