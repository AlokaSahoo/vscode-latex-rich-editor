import * as vscode from "vscode";
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
  const folder = vscode.Uri.joinPath(document.uri, "..");
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
  await visit(document.uri, document.getText());
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
  const folder = vscode.Uri.joinPath(document.uri, "..");
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
