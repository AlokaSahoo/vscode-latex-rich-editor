import * as fs from "fs";
import * as path from "path";
import { findInputs, maskComments } from "./shared/latexText";

// Which .tex file to compile when the user is editing one: itself if it has
// \documentclass, the file named by a "% !TEX root = main.tex" magic comment,
// or else the file in this folder (or its parent) that \input's / \include's it.

export function magicComment(text: string, key: "root" | "program"): string | undefined {
  // Magic comments only count in the first lines of the file.
  const head = text.split("\n", 40).join("\n");
  return new RegExp(`^\\s*%\\s*!\\s*T[eE]X\\s+(?:TS-)?${key}\\s*=\\s*(.+?)\\s*$`, "mi").exec(head)?.[1];
}

export function isRoot(text: string): boolean {
  return /\\documentclass/.test(maskComments(text));
}

export function findRootFile(file: string, text: string): string {
  const magic = magicComment(text, "root");
  if (magic) {
    const target = path.resolve(path.dirname(file), magic);
    if (fs.existsSync(target)) return target;
  }
  if (isRoot(text)) return file;

  const resolved = path.resolve(file);
  for (const folder of [path.dirname(file), path.dirname(path.dirname(file))]) {
    let names: string[];
    try {
      names = fs.readdirSync(folder).filter((n) => n.toLowerCase().endsWith(".tex"));
    } catch {
      continue;
    }
    for (const name of names) {
      const candidate = path.join(folder, name);
      if (path.resolve(candidate) === resolved) continue;
      let candidateText: string;
      try {
        candidateText = fs.readFileSync(candidate, "utf8");
      } catch {
        continue;
      }
      if (!isRoot(candidateText)) continue;
      // \input paths are relative to the root's folder.
      const includes = findInputs(candidateText).map((p) => path.resolve(folder, p));
      if (includes.includes(resolved)) return candidate;
    }
  }
  return file;
}
