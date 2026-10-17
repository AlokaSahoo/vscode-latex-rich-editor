import { describe, expect, it } from "vitest";
import { classifyLines, commentStart, computeFolds } from "../src/shared/paragraphs";

const para = { paragraphs: true, showComments: true };
const hide = { paragraphs: false, showComments: false };
const both = { paragraphs: true, showComments: false };

/** Applies folds to the text the way the view displays it. */
function shown(text: string, options: Parameters<typeof computeFolds>[1]): string {
  const folds = computeFolds(text.split("\n"), options);
  let out = "";
  let at = 0;
  for (const fold of folds) {
    out += text.slice(at, fold.from) + fold.text;
    at = fold.to;
  }
  return out + text.slice(at);
}

describe("commentStart", () => {
  it("ignores escaped percent signs", () => {
    expect(commentStart("50\\% of it % note")).toBe(11);
    expect(commentStart("no comment")).toBe(-1);
  });
});

describe("classifyLines", () => {
  it("recognises the kinds of line", () => {
    expect(classifyLines(["", "% c", "\\section{A}", "\\item x", "plain", "\\textbf{x} y"])).toEqual([
      "blank", "comment", "hard", "start", "text", "text",
    ]);
  });
  it("treats math, tables and verbatim as lines that must not be joined", () => {
    const kinds = classifyLines(["\\begin{align}", "a &= b \\\\", "c &= d", "\\end{align}", "after", "\\[", "x", "\\]", "\\begin{verbatim}", "% not a comment", "\\end{verbatim}", "end"]);
    expect(kinds).toEqual(["hard", "structure", "structure", "structure", "text", "hard", "structure", "structure", "hard", "literal", "literal", "text"]);
  });
});

describe("paragraph folds", () => {
  it("joins consecutive text lines into one paragraph", () => {
    expect(shown("One sentence\nsplit over lines.\nAnd more.", para)).toBe("One sentence split over lines. And more.");
  });
  it("keeps paragraphs apart and collapses extra blank lines", () => {
    expect(shown("A\nB\n\nC\nD", para)).toBe("A B\n\nC D");
    expect(shown("A\n\n\n\nB", para)).toBe("A\n\nB");
  });
  it("does not join across commands or structure", () => {
    const text = "\\section{S}\nText one\ntext two\n\\begin{equation}\nx\ny\n\\end{equation}\nAfter\nmore";
    expect(shown(text, para)).toBe("\\section{S}\nText one text two\n\\begin{equation}\nx\ny\n\\end{equation}\nAfter more");
  });
  it("lets an \\item continue onto following lines but not onto the previous one", () => {
    expect(shown("\\item first\nsecond\n\\item third", para)).toBe("\\item first second\n\\item third");
  });
  it("does not join after a forced line break", () => {
    expect(shown("line one \\\\\nline two", para)).toBe("line one \\\\\nline two");
  });
  it("absorbs spaces around the break", () => {
    expect(shown("end   \n   start", para)).toBe("end start");
  });
  it("leaves lines alone in lines mode", () => {
    expect(computeFolds(["a", "b"], { paragraphs: false, showComments: true })).toEqual([]);
  });
});

describe("comment visibility", () => {
  it("hides comment-only lines and trailing comments", () => {
    expect(shown("text % note\n% whole line\nmore", hide)).toBe("text\nmore");
    expect(shown("50\\% kept % gone", hide)).toBe("50\\% kept");
  });
  it("hides a comment on the last line", () => {
    expect(shown("text\n% last", hide)).toBe("text");
  });
  it("joins text around a hidden comment line", () => {
    expect(shown("one\n% aside\ntwo", both)).toBe("one two");
  });
  it("keeps a visible comment between text from joining", () => {
    expect(shown("one\n% aside\ntwo", para)).toBe("one\n% aside\ntwo");
  });
  it("does not join after a visible trailing comment", () => {
    expect(shown("one % c\ntwo", para)).toBe("one % c\ntwo");
  });
  it("folds never overlap", () => {
    const folds = computeFolds("a % x\n% y\nb % z\n\n\nc".split("\n"), both);
    for (let i = 1; i < folds.length; i++) expect(folds[i].from).toBeGreaterThanOrEqual(folds[i - 1].to);
  });
});
