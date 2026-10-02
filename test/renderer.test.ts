// Guards the performance patches to codemirror-visual-markup: they must not change what is rendered.
import { describe, expect, it } from "vitest";
import * as fs from "fs";
import { execSync } from "child_process";
import { EditorState } from "@codemirror/state";
import { Tokenizer, buildDecorations, getLanguage } from "codemirror-visual-markup";

const docs = [
  ...["sample/revtex-sample.tex", "sample/sample.tex"].map((f) => [f, fs.readFileSync(f, "utf8")] as const),
  ["generated 100-section paper", execSync("node bench/gen.mjs 100", { encoding: "utf8" })] as const,
];

const tokenJson = (tokens: unknown) => JSON.stringify(tokens);

describe("tokenizer fast skip", () => {
  it.each(docs)("matches the character-by-character scan on %s", (_name, text) => {
    const latex = getLanguage("latex");
    const slow = Object.create(latex, { id: { value: "latex-slow" } });
    expect(tokenJson(new Tokenizer(latex).tokenize(text))).toBe(tokenJson(new Tokenizer(slow).tokenize(text)));
  });
  it("handles triggers at the very end and inside empty ranges", () => {
    const latex = getLanguage("latex");
    for (const text of ["", "$", "\\", "a%", "x \\", "plain", "$a$ \\emph{b}\\"]) {
      const slow = Object.create(latex, { id: { value: "latex-slow" } });
      expect(tokenJson(new Tokenizer(latex).tokenize(text))).toBe(tokenJson(new Tokenizer(slow).tokenize(text)));
    }
  });
});

describe("decoration cache", () => {
  const options = { language: getLanguage("latex"), showCommands: false };
  const summary = (state: EditorState) => {
    const result = buildDecorations(state, options);
    const ranges: string[] = [];
    result.decorations.between(0, state.doc.length, (from, to, value) => void ranges.push(`${from}-${to}:${(value.spec as { class?: string }).class ?? ""}:${value.spec.widget ? "w" : ""}`));
    return ranges.join("|");
  };

  it.each(docs)("gives the same decorations for cursor moves as a fresh build on %s", (_name, text) => {
    const base = EditorState.create({ doc: text });
    for (const frac of [0, 0.13, 0.5, 0.77, 1]) {
      const state = base.update({ selection: { anchor: Math.floor(text.length * frac) } }).state;
      const cached = summary(state); // reuses the previous tokenization
      // a different doc object forces a fresh tokenization
      const fresh = summary(EditorState.create({ doc: text, selection: state.selection }));
      expect(cached).toBe(fresh);
    }
  });

  it("does not leak table layout marks into later builds", () => {
    const text = "\\begin{tabular}{cc}$a$ & $b$\\\\ $c$ & $d$\\end{tabular}\n";
    const base = EditorState.create({ doc: text });
    const first = summary(base);
    summary(base.update({ selection: { anchor: 25 } }).state);
    expect(summary(base)).toBe(first);
  });
});
