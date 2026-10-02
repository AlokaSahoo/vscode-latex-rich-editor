import { afterAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { countLength, endOfMainText, imageSize } from "../src/lengthCheck";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "length-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

function count(body: string) {
  const file = path.join(dir, "main.tex");
  fs.writeFileSync(file, `\\documentclass{revtex4-2}\n\\begin{document}\n${body}\n\\end{document}\n`);
  return countLength(file);
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("endOfMainText", () => {
  it.each([
    ["appendix", "\\appendix\nmore"],
    ["appendices env", "\\begin{appendices}x\\end{appendices}"],
    ["acknowledgments", "\\begin{acknowledgments}thanks\\end{acknowledgments}"],
    ["bibliography", "\\bibliography{refs}"],
    ["thebibliography", "\\begin{thebibliography}{9}\\end{thebibliography}"],
    ["biblatex", "\\printbibliography"],
    ["end matter heading", "\\section*{End Matter}"],
    ["supplemental heading", "\\section{Supplemental Material}"],
  ])("stops at %s", (_name, marker) => {
    const body = `text before ${marker}`;
    expect(body.slice(0, endOfMainText(body))).toBe("text before ");
  });

  it("keeps everything when there is no end matter", () => {
    expect(endOfMainText("just text")).toBe(9);
  });

  it("stops at the earliest marker", () => {
    const body = "a \\bibliography{r} b \\appendix c";
    expect(body.slice(0, endOfMainText(body))).toBe("a ");
  });

  it("does not stop at words that merely start like a marker", () => {
    expect(endOfMainText("\\appendixed text")).toBe("\\appendixed text".length);
  });
});

describe("countLength", () => {
  it("counts running text", () => {
    expect(count(words(10)).textWords).toBe(10);
  });

  it("ignores the appendix, acknowledgments and bibliography", () => {
    const report = count(
      `${words(10)}\n\\begin{acknowledgments}${words(7)}\\end{acknowledgments}\n\\bibliography{refs}\n\\appendix\n\\section{A}${words(50)}`,
    );
    expect(report.textWords).toBe(10);
    expect(report.total).toBe(10);
  });

  it("does not count figures, tables or equations that sit in the appendix", () => {
    const report = count(
      `${words(5)}\n\\appendix\n\\begin{equation}x=1\\end{equation}\n\\begin{figure}\\caption{${words(30)}}\\end{figure}\n\\begin{table}\\caption{c}\\begin{tabular}{c}a\\\\b\\end{tabular}\\end{table}`,
    );
    expect(report.total).toBe(5);
    expect(report.figures).toHaveLength(0);
    expect(report.tables).toHaveLength(0);
    expect(report.equations.rows).toBe(0);
  });

  it("charges 16 words per displayed equation row", () => {
    expect(count("\\begin{align}a&=b\\\\c&=d\\end{align}").equations).toEqual({ rows: 2, words: 32 });
  });

  it("charges 32 words per row inside widetext", () => {
    expect(count("\\begin{widetext}\\begin{equation}a=b\\end{equation}\\end{widetext}").equations.words).toBe(32);
  });

  it("does not treat unnumbered (starred) math environments as two-column", () => {
    expect(count("\\begin{gather*}a\\\\b\\end{gather*}").equations.words).toBe(32);
    expect(count("\\begin{eqnarray*}a&=&b\\end{eqnarray*}").equations.words).toBe(16);
  });

  it("does not count rows inside matrices", () => {
    expect(count("\\begin{equation}\\begin{pmatrix}a\\\\b\\end{pmatrix}\\end{equation}").equations.rows).toBe(1);
  });

  it("counts display math written with \\[ \\] and $$", () => {
    expect(count("\\[a=b\\] and $$c=d$$").equations.rows).toBe(2);
  });

  it("counts captions as text and adds a figure allowance", () => {
    const report = count(`\\begin{figure}\\includegraphics{missing}\\caption{${words(12)}}\\end{figure}`);
    expect(report.captionWords).toBe(12);
    expect(report.figures).toHaveLength(1);
    expect(report.figures[0].estimated).toBe(true);
    expect(report.figures[0].words).toBe(120); // 150 / 1.5 + 20
  });

  it("uses a larger allowance for figure*", () => {
    const report = count("\\begin{figure*}\\includegraphics{missing}\\caption{c}\\end{figure*}");
    expect(report.figures[0].wide).toBe(true);
    expect(report.figures[0].words).toBe(Math.round(300 / (0.5 * 1.5) + 40));
  });

  it("reads the aspect ratio from the image file", () => {
    const png = Buffer.alloc(32);
    png.writeUInt32BE(200, 16);
    png.writeUInt32BE(100, 20);
    fs.writeFileSync(path.join(dir, "wide.png"), png);
    const report = count("\\begin{figure}\\includegraphics{wide}\\caption{c}\\end{figure}");
    expect(report.figures[0].estimated).toBe(false);
    expect(report.figures[0].aspect).toBeCloseTo(2);
    expect(report.figures[0].words).toBe(95);
  });

  it("charges tables by line count", () => {
    const report = count("\\begin{table}\\caption{c}\\begin{tabular}{cc}a&b\\\\c&d\\\\e&f\\end{tabular}\\end{table}");
    expect(report.tables[0].lines).toBe(3);
    expect(report.tables[0].words).toBe(Math.round(13 + 6.5 * 3));
  });

  it("excludes title, author and abstract", () => {
    const report = count(`\\title{${words(9)}}\\author{${words(4)}}\\begin{abstract}${words(20)}\\end{abstract}${words(3)}`);
    expect(report.textWords).toBe(3);
  });

  it("ignores comments", () => {
    expect(count(`${words(4)}\n% ${words(40)}`).textWords).toBe(4);
  });

  it("follows \\input files", () => {
    fs.writeFileSync(path.join(dir, "part.tex"), words(6));
    expect(count("\\input{part}").textWords).toBe(6);
  });

  it("counts unsaved text passed in for the main file", () => {
    const file = path.join(dir, "main.tex");
    fs.writeFileSync(file, "\\begin{document}old\\end{document}");
    expect(countLength(file, `\\begin{document}${words(8)}\\end{document}`).textWords).toBe(8);
  });
});

describe("imageSize", () => {
  it("reads PDF media boxes", () => {
    expect(imageSize(Buffer.from("/MediaBox [0 0 300 150]"), ".pdf")).toEqual({ width: 300, height: 150 });
  });
  it("returns undefined for unknown data", () => {
    expect(imageSize(Buffer.from("nope"), ".pdf")).toBeUndefined();
  });
});
