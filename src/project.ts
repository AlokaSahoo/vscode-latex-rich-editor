import * as vscode from "vscode";
import { findRootFile } from "./rootFile";
import { type BibEntry, bibFiles, findBibitems, findInputs, findLabels, type LabelInfo, parseBib } from "./shared/latexText";

export interface ProjectLabel extends LabelInfo {
  uri: vscode.Uri;
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  const open = vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
  if (open) return open.getText();
  try {
    return Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
  } catch {
    return undefined;
  }
}

/** The document plus every file it pulls in with \input/\include, depth-first. */
export async function projectFiles(document: vscode.TextDocument): Promise<Array<{ uri: vscode.Uri; text: string }>> {
  // Start from the main file so a chapter sees the whole project's labels.
  const rootPath = document.uri.scheme === "file" ? findRootFile(document.uri.fsPath, document.getText()) : undefined;
  const root = rootPath && rootPath !== document.uri.fsPath ? vscode.Uri.file(rootPath) : document.uri;
  const folder = vscode.Uri.joinPath(root, "..");
  const files: Array<{ uri: vscode.Uri; text: string }> = [];
  const seen = new Set<string>();
  const visit = async (uri: vscode.Uri, text: string | undefined) => {
    if (text === undefined || seen.has(uri.toString())) return;
    seen.add(uri.toString());
    files.push({ uri, text });
    // LaTeX resolves \input paths relative to the main file's folder.
    for (const name of findInputs(text)) {
      const child = vscode.Uri.joinPath(folder, name);
      await visit(child, await readText(child));
    }
  };
  await visit(root, root === document.uri ? document.getText() : await readText(root));
  if (!seen.has(document.uri.toString())) await visit(document.uri, document.getText());
  return files;
}

export async function projectLabels(document: vscode.TextDocument): Promise<ProjectLabel[]> {
  const labels: ProjectLabel[] = [];
  for (const file of await projectFiles(document)) {
    for (const label of findLabels(file.text)) labels.push({ ...label, uri: file.uri });
  }
  return labels;
}

export async function projectBibliography(document: vscode.TextDocument): Promise<BibEntry[]> {
  const rootPath = document.uri.scheme === "file" ? findRootFile(document.uri.fsPath, document.getText()) : document.uri.fsPath;
  const folder = vscode.Uri.joinPath(vscode.Uri.file(rootPath), "..");
  const entries = new Map<string, BibEntry>();
  for (const file of await projectFiles(document)) {
    for (const item of findBibitems(file.text)) entries.set(item.key, item);
    for (const name of bibFiles(file.text)) {
      const text = await readText(vscode.Uri.joinPath(folder, name));
      if (text) for (const entry of parseBib(text)) if (!entries.has(entry.key)) entries.set(entry.key, entry);
    }
  }
  return [...entries.values()];
}

export function bibUris(document: vscode.TextDocument): vscode.Uri[] {
  const folder = vscode.Uri.joinPath(document.uri, "..");
  return bibFiles(document.getText()).map((name) => vscode.Uri.joinPath(folder, name));
}

export type DefinitionKind = "label" | "cite" | "file";

/** Where a \ref's label, a \cite's bibliography entry, or an \input'ed file is. */
export async function findDefinition(
  document: vscode.TextDocument,
  kind: DefinitionKind,
  key: string,
): Promise<vscode.Location | undefined> {
  const rootPath = document.uri.scheme === "file" ? findRootFile(document.uri.fsPath, document.getText()) : document.uri.fsPath;
  const folder = vscode.Uri.joinPath(vscode.Uri.file(rootPath), "..");
  const at = (uri: vscode.Uri, line: number) => new vscode.Location(uri, new vscode.Position(line, 0));

  if (kind === "file") {
    for (const name of [key, `${key}.tex`]) {
      const uri = vscode.Uri.joinPath(folder, name);
      if ((await readText(uri)) !== undefined) return at(uri, 0);
    }
    return undefined;
  }
  if (kind === "label") {
    const label = (await projectLabels(document)).find((l) => l.key === key);
    return label && at(label.uri, label.line);
  }
  // Citation: a \bibitem in one of the .tex files, else the entry in a .bib file.
  const files = await projectFiles(document);
  for (const file of files) {
    const index = file.text.search(new RegExp(`\\\\bibitem\\s*(\\[[^\\]]*\\])?\\s*\\{${escapeRegExp(key)}\\}`));
    if (index >= 0) return at(file.uri, file.text.slice(0, index).split("\n").length - 1);
  }
  for (const file of files) {
    for (const name of bibFiles(file.text)) {
      const uri = vscode.Uri.joinPath(folder, name);
      const text = await readText(uri);
      const index = text?.search(new RegExp(`@\\w+\\s*\\{\\s*${escapeRegExp(key)}\\s*,`)) ?? -1;
      if (text && index >= 0) return at(uri, text.slice(0, index).split("\n").length - 1);
    }
  }
  return undefined;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
