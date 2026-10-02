import * as vscode from "vscode";
import * as path from "path";

export const IMAGE_FILE = /\.(png|jpe?g|pdf|eps|gif|svg|webp)$/i;

/** "figures/<name>" next to the document, made unique so nothing is overwritten. */
export async function figureTarget(
  document: vscode.TextDocument,
  fileName: string,
  taken: ReadonlySet<string> = new Set(),
): Promise<vscode.Uri> {
  const folder = vscode.Uri.joinPath(document.uri, "..", "figures");
  const extension = (path.posix.extname(fileName) || ".png").toLowerCase();
  let base = path.posix
    .basename(fileName, path.posix.extname(fileName))
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  // Clipboard screenshots arrive as "image.png"; give them a dated name.
  if (!base || /^(image|screenshot|clipboard|pasted)/.test(base)) base = `figure-${timestamp()}`;

  for (let n = 1; ; n++) {
    const candidate = vscode.Uri.joinPath(folder, `${base}${n > 1 ? `-${n}` : ""}${extension}`);
    if (taken.has(candidate.toString())) continue;
    try {
      await vscode.workspace.fs.stat(candidate);
    } catch {
      return candidate;
    }
  }
}

function timestamp(): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}

/** Path to use in \includegraphics, relative to the document's folder (POSIX separators). */
export function relativeToDocument(document: vscode.TextDocument, file: vscode.Uri): string | undefined {
  const folder = vscode.Uri.joinPath(document.uri, "..").path;
  if (!file.path.startsWith(`${folder}/`)) return undefined;
  return file.path.slice(folder.length + 1);
}

/**
 * Turns dropped/pasted files into figure paths: images already inside the
 * document's folder are referenced where they are; anything else is copied
 * into figures/. Returns the edit that creates the copies alongside paths.
 */
export async function placeFigures(
  document: vscode.TextDocument,
  sources: Array<{ uri?: vscode.Uri; name: string; bytes?: Uint8Array }>,
): Promise<{ paths: string[]; creates: Array<{ uri: vscode.Uri; bytes: Uint8Array }> }> {
  const paths: string[] = [];
  const creates: Array<{ uri: vscode.Uri; bytes: Uint8Array }> = [];
  for (const source of sources) {
    if (!IMAGE_FILE.test(source.name) && !source.bytes) continue;
    const existing = source.uri && relativeToDocument(document, source.uri);
    if (existing) {
      paths.push(existing);
      continue;
    }
    const bytes = source.bytes ?? (source.uri ? await vscode.workspace.fs.readFile(source.uri) : undefined);
    if (!bytes) continue;
    const target = await figureTarget(document, source.name, new Set(creates.map((c) => c.uri.toString())));
    creates.push({ uri: target, bytes });
    paths.push(relativeToDocument(document, target)!);
  }
  return { paths, creates };
}
