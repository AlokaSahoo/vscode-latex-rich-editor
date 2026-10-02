import * as vscode from "vscode";
import { IMAGE_FILE, placeFigures } from "../figures";
import { findDefinition, projectBibliography, projectLabels, type ProjectLabel } from "../project";
import { readReferences } from "../references";
import {
  CITE_COMMANDS,
  describeBibEntry,
  figureEnvironment,
  LABEL_COMMANDS,
  OPEN_REFERENCE,
  outline,
  type OutlineItem,
  REFERENCE_CALL,
} from "../shared/latexText";
import type { ReferenceTable } from "../webview-editor/protocol";

const TEX: vscode.DocumentSelector = [{ language: "latex" }, { pattern: "**/*.tex" }];
const KIND_NAMES: Record<string, string> = {
  equation: "Equation",
  figure: "Figure",
  table: "Table",
  section: "Section",
  other: "Label",
};

export function registerLanguageFeatures(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(TEX, { provideCompletionItems }, "{", ","),
    vscode.languages.registerHoverProvider(TEX, { provideHover }),
    vscode.languages.registerDocumentSymbolProvider(TEX, { provideDocumentSymbols }),
    // ⌘/Ctrl-click (and F12) in the raw editor: \ref → \label, \cite → entry, \input → file.
    vscode.languages.registerDefinitionProvider(TEX, {
      async provideDefinition(document, position) {
        const line = document.lineAt(position).text;
        for (const m of line.matchAll(REFERENCE_CALL)) {
          if (position.character < m.index! || position.character > m.index! + m[0].length) continue;
          const command = m[1];
          const kind = /^(input|include|subfile)$/.test(command) ? "file" : /cite/.test(command) ? "cite" : /ref$/.test(command) ? "label" : undefined;
          if (!kind) return undefined;
          let offset = m.index! + m[0].lastIndexOf("{") + 1;
          const key = m[2].split(",").find((part) => {
            const hit = position.character >= offset && position.character <= offset + part.length;
            offset += part.length + 1;
            return hit;
          })?.trim() ?? m[2].trim();
          return findDefinition(document, kind, key);
        }
        return undefined;
      },
    }),
    vscode.languages.registerDocumentDropEditProvider(TEX, { provideDocumentDropEdits }, {
      providedDropEditKinds: [FIGURE_EDIT],
      dropMimeTypes: ["text/uri-list", "image/*", "files"],
    }),
    vscode.languages.registerDocumentPasteEditProvider(TEX, { provideDocumentPasteEdits }, {
      providedPasteEditKinds: [FIGURE_EDIT],
      pasteMimeTypes: ["image/*", "files", "text/uri-list"],
    }),
  );
}

// --- Completion -------------------------------------------------------------

export function labelDetail(label: ProjectLabel | { kind: string; key: string }, refs: ReferenceTable): string {
  const number = refs.labels[label.key]?.number;
  return `${KIND_NAMES[label.kind] ?? "Label"}${number ? ` ${label.kind === "equation" ? `(${number})` : number}` : ""}`;
}

async function provideCompletionItems(document: vscode.TextDocument, position: vscode.Position) {
  const before = document.lineAt(position).text.slice(0, position.character);
  const open = OPEN_REFERENCE.exec(before);
  if (!open) return undefined;
  const command = open[1];
  const typed = open[2];
  const segment = typed.slice(typed.lastIndexOf(",") + 1).replace(/^\s+/, "");
  const range = new vscode.Range(position.translate(0, -segment.length), position);

  if (CITE_COMMANDS.has(command)) {
    const references = await readReferences(document.uri);
    return (await projectBibliography(document)).map((entry) => {
      const item = new vscode.CompletionItem(entry.key, vscode.CompletionItemKind.Reference);
      const number = references.citations[entry.key];
      item.detail = number ? `[${number}]` : entry.type;
      item.documentation = describeBibEntry(entry);
      item.range = range;
      item.filterText = `${entry.key} ${entry.author ?? ""} ${entry.title ?? ""}`;
      return item;
    });
  }
  if (LABEL_COMMANDS.has(command)) {
    const references = await readReferences(document.uri);
    return (await projectLabels(document)).map((label) => {
      const item = new vscode.CompletionItem(label.key, vscode.CompletionItemKind.Reference);
      item.detail = labelDetail(label, references);
      item.documentation = label.kind === "equation" ? new vscode.MarkdownString().appendCodeblock(label.context, "latex") : label.context;
      item.range = range;
      // \eqref almost always targets an equation; list those first.
      item.sortText = `${command === "eqref" && label.kind !== "equation" ? "1" : "0"}${label.key}`;
      return item;
    });
  }
  return undefined;
}

// --- Hover -------------------------------------------------------------------

async function provideHover(document: vscode.TextDocument, position: vscode.Position) {
  const line = document.lineAt(position).text;
  for (const m of line.matchAll(REFERENCE_CALL)) {
    const start = m.index!;
    const end = start + m[0].length;
    if (position.character < start || position.character > end) continue;
    const command = m[1];
    const keysStart = start + m[0].lastIndexOf("{") + 1;
    const keys = m[2].split(",").map((k) => k.trim()).filter(Boolean);
    // Hovering one key of \cite{a,b,c} shows just that key.
    let offset = keysStart;
    const hovered = m[2].split(",").find((part) => {
      const inPart = position.character >= offset && position.character <= offset + part.length;
      offset += part.length + 1;
      return inPart;
    });
    const shown = hovered?.trim() ? [hovered.trim()] : keys;
    const range = new vscode.Range(position.line, start, position.line, end);
    const references = await readReferences(document.uri);

    if (CITE_COMMANDS.has(command)) {
      const bibliography = await projectBibliography(document);
      const markdown = new vscode.MarkdownString();
      for (const key of shown) {
        const entry = bibliography.find((e) => e.key === key);
        const number = references.citations[key];
        markdown.appendMarkdown(`**${number ? `[${number}]` : key}** ${entry ? escape(describeBibEntry(entry)) : "_not found in the bibliography_"}\n\n`);
      }
      return new vscode.Hover(markdown, range);
    }
    if (LABEL_COMMANDS.has(command)) {
      const labels = await projectLabels(document);
      const markdown = new vscode.MarkdownString();
      for (const key of shown) {
        const label = labels.find((l) => l.key === key);
        if (!label) {
          markdown.appendMarkdown(`**${escape(key)}** — _no \\label with this key_\n\n`);
          continue;
        }
        markdown.appendMarkdown(`**${labelDetail(label, references)}**`);
        if (label.kind === "equation") markdown.appendCodeblock(label.context, "latex");
        else if (label.context) markdown.appendMarkdown(` — ${escape(label.context)}\n\n`);
        if (label.graphic && /\.(png|jpe?g|gif|svg|webp)$/i.test(label.graphic)) {
          const image = vscode.Uri.joinPath(label.uri, "..", label.graphic);
          markdown.appendMarkdown(`\n\n![${escape(label.graphic)}](${image.toString()}|width=320)\n\n`);
        }
      }
      return new vscode.Hover(markdown, range);
    }
  }
  return undefined;
}

function escape(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+!|<>]/g, "\\$&");
}

// --- Outline / breadcrumbs -----------------------------------------------------

const SYMBOL_KINDS: Record<OutlineItem["kind"], vscode.SymbolKind> = {
  section: vscode.SymbolKind.Namespace,
  figure: vscode.SymbolKind.Object,
  table: vscode.SymbolKind.Struct,
  equation: vscode.SymbolKind.Operator,
};

function provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
  const convert = (item: OutlineItem): vscode.DocumentSymbol => {
    const range = document.lineAt(Math.min(item.line, document.lineCount - 1)).range;
    const symbol = new vscode.DocumentSymbol(item.title || item.kind, item.label ?? "", SYMBOL_KINDS[item.kind], range, range);
    symbol.children = item.children.map(convert);
    return symbol;
  };
  return outline(document.getText()).map(convert);
}

// --- Dropping / pasting images into the text editor ----------------------------

export const FIGURE_EDIT = vscode.DocumentDropOrPasteEditKind.Empty.append("latex", "figure");

async function figureEdit(document: vscode.TextDocument, dataTransfer: vscode.DataTransfer) {
  const sources: Array<{ uri?: vscode.Uri; name: string; bytes?: Uint8Array }> = [];
  const uriList = await dataTransfer.get("text/uri-list")?.asString();
  for (const line of uriList?.split(/\r?\n/) ?? []) {
    if (!line.trim() || line.startsWith("#")) continue;
    const uri = vscode.Uri.parse(line.trim());
    if (IMAGE_FILE.test(uri.path)) sources.push({ uri, name: uri.path.slice(uri.path.lastIndexOf("/") + 1) });
  }
  if (sources.length === 0) {
    for (const [mime, item] of dataTransfer) {
      const file = item.asFile();
      if (!file || !(mime.startsWith("image/") || IMAGE_FILE.test(file.name))) continue;
      const extension = mime.startsWith("image/") ? `.${mime.slice(6).replace("jpeg", "jpg").replace("svg+xml", "svg")}` : "";
      sources.push({ uri: file.uri, name: IMAGE_FILE.test(file.name) ? file.name : `${file.name || "image"}${extension}`, bytes: await file.data() });
    }
  }
  if (sources.length === 0) return undefined;

  const { paths, creates } = await placeFigures(document, sources);
  if (paths.length === 0) return undefined;
  const additionalEdit = new vscode.WorkspaceEdit();
  for (const create of creates) additionalEdit.createFile(create.uri, { contents: create.bytes, ignoreIfExists: true });
  const snippet = new vscode.SnippetString(paths.map((p) => figureEnvironment(p, true)).join("\n"));
  return { snippet, additionalEdit, title: paths.length > 1 ? "Insert LaTeX figures" : "Insert LaTeX figure" };
}

async function provideDocumentDropEdits(
  document: vscode.TextDocument,
  _position: vscode.Position,
  dataTransfer: vscode.DataTransfer,
) {
  const result = await figureEdit(document, dataTransfer);
  if (!result) return undefined;
  const edit = new vscode.DocumentDropEdit(result.snippet, result.title, FIGURE_EDIT);
  edit.additionalEdit = result.additionalEdit;
  return edit;
}

async function provideDocumentPasteEdits(
  document: vscode.TextDocument,
  _ranges: readonly vscode.Range[],
  dataTransfer: vscode.DataTransfer,
) {
  const result = await figureEdit(document, dataTransfer);
  if (!result) return undefined;
  const edit = new vscode.DocumentPasteEdit(result.snippet, result.title, FIGURE_EDIT);
  edit.additionalEdit = result.additionalEdit;
  return [edit];
}
