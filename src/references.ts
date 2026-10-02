import * as vscode from "vscode";
import type { ReferenceTable } from "./webview-editor/protocol";

// Reads label numbers and citation labels from the .aux file(s) the last
// compile wrote, so the rich view can show "Fig. 1" / "(3)" / "[2]" like
// the PDF instead of raw keys. Follows \@input{...aux} for \include'd files.
export async function readReferences(texUri: vscode.Uri): Promise<ReferenceTable> {
  const table: ReferenceTable = { labels: {}, citations: {} };
  const folder = vscode.Uri.joinPath(texUri, "..");
  const base = texUri.path.slice(texUri.path.lastIndexOf("/") + 1).replace(/\.tex$/i, "");
  await readAux(vscode.Uri.joinPath(folder, `${base}.aux`), folder, table, new Set());
  return table;
}

async function readAux(uri: vscode.Uri, folder: vscode.Uri, table: ReferenceTable, seen: Set<string>) {
  if (seen.has(uri.toString())) return;
  seen.add(uri.toString());
  let text: string;
  try {
    text = Buffer.from(await vscode.workspace.fs.readFile(uri)).toString("utf8");
  } catch {
    return;
  }

  const crefTypes = new Map<string, string>();
  for (const m of text.matchAll(/\\newlabel\{([^}]*)\}\{/g)) {
    const groups = readGroups(text, m.index! + m[0].length - 1);
    if (!groups.length) continue;
    const key = m[1];
    const inner = readGroups(groups[0], 0);
    if (key.endsWith("@cref")) {
      // cleveref: \newlabel{key@cref}{{[figure][1][]1}{[1][1][]1}}
      const type = /^\[([^\]]+)\]/.exec(inner[0] ?? "")?.[1];
      if (type) crefTypes.set(key.slice(0, -"@cref".length), type);
      continue;
    }
    const number = clean(inner[0] ?? groups[0]);
    const page = clean(inner[1] ?? "");
    // hyperref's anchor ("figure.caption.1", "equation.2.3") names the type.
    const anchorType = inner[3] ? /^([a-z]+)/i.exec(inner[3])?.[1] : undefined;
    table.labels[key] = { number, page, type: anchorType };
  }
  for (const [key, type] of crefTypes) {
    if (table.labels[key]) table.labels[key].type = type;
  }

  for (const m of text.matchAll(/\\bibcite\{([^}]*)\}\{/g)) {
    const groups = readGroups(text, m.index! + m[0].length - 1);
    if (!groups.length) continue;
    // Plain: \bibcite{key}{1}; natbib: \bibcite{key}{{1}{2020}{{Author}}{{Full}}}
    const inner = readGroups(groups[0], 0);
    table.citations[m[1]] = clean(inner.length > 0 ? inner[0] : groups[0]);
  }

  for (const m of text.matchAll(/\\@input\{([^}]*)\}/g)) {
    await readAux(vscode.Uri.joinPath(folder, m[1]), folder, table, seen);
  }
}

// Reads consecutive {...} groups starting at `start` (which must be "{").
function readGroups(text: string, start: number): string[] {
  const groups: string[] = [];
  let i = start;
  while (text[i] === "{") {
    let depth = 0;
    let j = i;
    for (; j < text.length; j++) {
      if (text[j] === "\\") {
        j++;
        continue;
      }
      if (text[j] === "{") depth++;
      else if (text[j] === "}" && --depth === 0) break;
    }
    if (j >= text.length) break;
    groups.push(text.slice(i + 1, j));
    i = j + 1;
  }
  return groups;
}

function clean(value: string): string {
  return value
    .replace(/\\relax\s*/g, "")
    .replace(/\\[A-Za-z]+\s*/g, "")
    .replace(/[{}]/g, "")
    .trim();
}
