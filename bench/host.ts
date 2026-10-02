import * as fs from "fs";
import { countLength } from "../src/lengthCheck";
import { environments, findLabels, maskComments, outline, findGraphics } from "../src/shared/latexText";

const time = (name: string, fn: () => unknown, runs = 20) => {
  fn();
  const t = performance.now();
  for (let i = 0; i < runs; i++) fn();
  console.log(name.padEnd(34), ((performance.now() - t) / runs).toFixed(2).padStart(8), "ms");
};
for (const file of ["bench/large.tex", "bench/huge.tex"]) {
  const text = fs.readFileSync(file, "utf8");
  console.log(`\n${file}: ${text.split("\n").length} lines, ${(text.length / 1024).toFixed(0)} KB`);
  time("maskComments", () => maskComments(text));
  time("environments", () => environments(maskComments(text)));
  time("outline", () => outline(text));
  time("findLabels", () => findLabels(text));
  time("findGraphics", () => findGraphics(text));
  time("countLength (word count)", () => countLength(file));
  // Host sync: what applyWebviewChanges does per keystroke (string compare + splice).
  let webviewText = text;
  time("per-keystroke string sync", () => { const cur = text; if (cur !== webviewText) webviewText = cur; webviewText = webviewText.slice(0, 5000) + "x" + webviewText.slice(5000); webviewText = text; }, 200);
}
