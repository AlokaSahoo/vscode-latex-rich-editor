import * as fs from "fs";
import * as path from "path";
import { bibFiles, findGraphics, findInputs, graphicsPaths, maskComments, stripComments } from "./shared/latexText";

export interface ArxivPackage {
  entries: Array<{ name: string; data: Buffer }>;
  warnings: string[];
  counts: { tex: number; figures: number; other: number };
}

const GRAPHIC_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".eps"];

/**
 * Collects what arXiv needs to rebuild the paper: the .tex sources (comments
 * removed), only the figures actually included, the .bbl (arXiv doesn't run
 * BibTeX), and any class/style files that live next to the paper.
 */
export function buildArxivPackage(mainFile: string): ArxivPackage {
  const root = path.dirname(mainFile);
  const base = path.basename(mainFile).replace(/\.tex$/i, "");
  const entries = new Map<string, Buffer>();
  const warnings: string[] = [];
  const counts = { tex: 0, figures: 0, other: 0 };

  const relative = (file: string) => path.relative(root, file).split(path.sep).join("/");
  const add = (file: string, data: Buffer, kind: keyof typeof counts) => {
    const name = relative(file);
    if (name.startsWith("../")) {
      warnings.push(`${name} is outside the paper's folder; arXiv needs every file inside it — move it and update the path.`);
      return;
    }
    if (!entries.has(name)) counts[kind]++;
    entries.set(name, data);
  };

  const sources: string[] = [];
  const visit = (file: string) => {
    if (sources.includes(file)) return;
    if (!fs.existsSync(file)) {
      warnings.push(`Missing input file ${relative(file)}.`);
      return;
    }
    sources.push(file);
    const text = fs.readFileSync(file, "utf8");
    add(file, Buffer.from(stripComments(text), "utf8"), "tex");
    for (const name of findInputs(text)) visit(path.join(root, name));
  };
  visit(mainFile);

  const allText = sources.map((file) => fs.readFileSync(file, "utf8")).join("\n");
  const searchFolders = ["", ...graphicsPaths(allText)];

  for (const graphic of findGraphics(allText)) {
    const found = findGraphic(root, searchFolders, graphic.path);
    if (found.length === 0) {
      warnings.push(`Figure "${graphic.path}" was not found.`);
      continue;
    }
    for (const file of found) add(file, fs.readFileSync(file), "figures");
  }

  if (bibFiles(allText).length > 0) {
    const bbl = path.join(root, `${base}.bbl`);
    if (fs.existsSync(bbl)) add(bbl, fs.readFileSync(bbl), "other");
    else warnings.push(`No ${base}.bbl found — compile the paper first; arXiv needs the .bbl because it doesn't run BibTeX.`);
  }

  for (const file of localSupportFiles(root, allText)) add(file, fs.readFileSync(file), "other");

  return {
    entries: [...entries].map(([name, data]) => ({ name, data })),
    warnings,
    counts,
  };
}

function findGraphic(root: string, folders: string[], requested: string): string[] {
  const hasExtension = GRAPHIC_EXTENSIONS.includes(path.extname(requested).toLowerCase());
  for (const folder of folders) {
    const candidates = hasExtension ? [requested] : GRAPHIC_EXTENSIONS.map((e) => requested + e);
    for (const candidate of candidates) {
      const file = path.join(root, folder, candidate);
      if (!fs.existsSync(file)) continue;
      // pdflatex can't read EPS directly; ship its converted PDF too if present.
      const converted = file.replace(/\.eps$/i, "-eps-converted-to.pdf");
      return file !== converted && fs.existsSync(converted) ? [file, converted] : [file];
    }
  }
  return [];
}

/** .cls/.sty/.bst files the paper uses that sit in its own folder (not in the TeX distribution). */
function localSupportFiles(root: string, text: string): string[] {
  const masked = maskComments(text);
  const names: string[] = [];
  const collect = (pattern: RegExp, extension: string) => {
    for (const m of masked.matchAll(pattern)) {
      for (const name of m[1].split(",")) if (name.trim()) names.push(name.trim() + extension);
    }
  };
  collect(/\\documentclass\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, ".cls");
  collect(/\\(?:usepackage|RequirePackage)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g, ".sty");
  collect(/\\bibliographystyle\s*\{([^}]+)\}/g, ".bst");
  return names.map((name) => path.join(root, name)).filter((file) => fs.existsSync(file));
}
