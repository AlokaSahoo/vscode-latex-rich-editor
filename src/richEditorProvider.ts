import * as vscode from "vscode";
import * as path from "path";
import { rootOf } from "./compile/compileManager";
import { placeFigures } from "./figures";
import { findDefinition, projectBibliography, projectLabels } from "./project";
import { revealSourceLine } from "./navigation";
import { readReferences } from "./references";
import type {
  CustomCommandStyle,
  HostToWebviewMessage,
  ImageKind,
  EditorDiagnostic,
  PageAlign,
  ProjectData,
  TextChange,
  WebviewToHostMessage,
} from "./webview-editor/protocol";

// Labels the rich view can't see itself (in \input'ed files) plus the bibliography.
async function projectData(document: vscode.TextDocument): Promise<ProjectData> {
  const key = document.uri.toString();
  const labels = await projectLabels(document);
  return {
    externalLabels: labels.filter((l) => l.uri.toString() !== key).map(({ uri: _uri, ...label }) => label),
    bibliography: await projectBibliography(document),
  };
}

interface OpenPanel {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  post: (message: HostToWebviewMessage) => Thenable<boolean>;
  ready: boolean;
}

const IMAGE_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".eps"];

export class RichEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "latexRich.richEditor";

  private static readonly panels = new Map<string, OpenPanel>();
  private static readonly pendingReveals = new Map<string, number>();
  private static readonly cursors = new Map<string, number>();

  /** 0-based line of the cursor in an open rich view (for forward search). */
  public static cursorLine(uri: vscode.Uri): number | undefined {
    return RichEditorProvider.cursors.get(uri.toString());
  }

  /** Pushes the current page width/alignment settings to every open rich view. */
  public static broadcastLayout() {
    for (const open of RichEditorProvider.panels.values()) {
      if (!open.ready) continue;
      const config = vscode.workspace.getConfiguration("latexRich", open.document.uri);
      open.post({
        type: "layout",
        pageWidth: config.get<number>("pageWidth", 880),
        pageAlign: config.get<PageAlign>("pageAlign", "center"),
      });
    }
  }

  /** Sends all of VS Code's diagnostics for a file (compile errors, spelling, grammar) to its rich view. */
  public static refreshDiagnostics(uri: vscode.Uri) {
    const open = RichEditorProvider.panels.get(uri.toString());
    if (!open?.ready) return;
    const severity = (s: vscode.DiagnosticSeverity) =>
      s === vscode.DiagnosticSeverity.Error ? "error" : s === vscode.DiagnosticSeverity.Warning ? "warning" : "info";
    const items: EditorDiagnostic[] = vscode.languages
      .getDiagnostics(uri)
      .filter((d) => d.severity !== vscode.DiagnosticSeverity.Hint)
      .map((d) => ({
        line: d.range.start.line,
        from: open.document.offsetAt(d.range.start),
        to: open.document.offsetAt(d.range.end),
        message: d.message,
        severity: severity(d.severity),
        source: d.source,
      }));
    open.post({ type: "diagnostics", items });
  }

  constructor(private readonly context: vscode.ExtensionContext) {}

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new RichEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(RichEditorProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    });
  }

  public static isOpen(uri: vscode.Uri): boolean {
    return RichEditorProvider.panels.has(uri.toString());
  }

  /** Scrolls an open rich view to a 0-based line, or remembers it for a view about to open. */
  public static revealLine(uri: vscode.Uri, line: number): void {
    const key = uri.toString();
    const open = RichEditorProvider.panels.get(key);
    if (open?.ready) {
      open.panel.reveal(open.panel.viewColumn, false);
      open.post({ type: "revealLine", line });
    } else {
      RichEditorProvider.pendingReveals.set(key, line);
    }
  }

  public static cancelPendingReveal(uri: vscode.Uri): void {
    RichEditorProvider.pendingReveals.delete(uri.toString());
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    const documentFolder = vscode.Uri.joinPath(document.uri, "..");
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
        documentFolder,
        ...(workspaceFolder ? [workspaceFolder] : []),
      ],
    };
    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

    // The text the webview currently holds. Edits flow both ways as small
    // change sets; if the two sides ever disagree, resend the whole text.
    let webviewText = document.getText();
    let applyingRemoteEdit = false;
    let queue: Promise<unknown> = Promise.resolve();

    const post = (message: HostToWebviewMessage) => webviewPanel.webview.postMessage(message);
    const key = document.uri.toString();
    const entry: OpenPanel = { document, panel: webviewPanel, post, ready: false };
    // Quick fixes offered on hover, kept until the next hover asks again.
    const offeredFixes = new Map<string, Array<vscode.CodeAction | vscode.Command>>();
    RichEditorProvider.panels.set(key, entry);

    // Label/citation numbers come from the .aux file; refresh them whenever a
    // compile rewrites it.
    // A chapter's numbers are in its main file's .aux.
    const root = vscode.Uri.file(rootOf(document));
    const auxName = root.path.slice(root.path.lastIndexOf("/") + 1).replace(/\.tex$/i, ".aux");
    const auxWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.joinPath(root, ".."), auxName),
    );
    const sendReferences = async () => post({ type: "references", references: await readReferences(document.uri) });
    auxWatcher.onDidChange(sendReferences);
    auxWatcher.onDidCreate(sendReferences);

    // Bibliography and \input'ed labels feed completion and hovers.
    const sendProject = async () => post({ type: "project", project: await projectData(document) });
    const sourceWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(documentFolder, "**/*.{bib,tex}"),
    );
    sourceWatcher.onDidChange(sendProject);
    sourceWatcher.onDidCreate(sendProject);
    sourceWatcher.onDidDelete(sendProject);

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== key || applyingRemoteEdit || e.contentChanges.length === 0) return;
      const text = document.getText();
      if (text === webviewText) return;
      const single = e.contentChanges.length === 1 ? e.contentChanges[0] : undefined;
      if (single && webviewText.length - single.rangeLength + single.text.length === text.length) {
        post({ type: "changes", changes: [{ from: single.rangeOffset, to: single.rangeOffset + single.rangeLength, text: single.text }] });
      } else {
        post({ type: "update", text });
      }
      webviewText = text;
    });

    const applyWebviewChanges = async (changes: TextChange[], baseLength: number) => {
      const current = document.getText();
      if (baseLength !== webviewText.length || current !== webviewText) {
        webviewText = current;
        post({ type: "update", text: current });
        return;
      }
      let next = webviewText;
      for (const c of [...changes].sort((a, b) => b.from - a.from)) next = next.slice(0, c.from) + c.text + next.slice(c.to);
      const edit = new vscode.WorkspaceEdit();
      for (const c of changes) {
        edit.replace(document.uri, new vscode.Range(document.positionAt(c.from), document.positionAt(c.to)), c.text);
      }
      webviewText = next;
      applyingRemoteEdit = true;
      try {
        await vscode.workspace.applyEdit(edit);
      } finally {
        applyingRemoteEdit = false;
      }
      if (document.getText() !== webviewText) {
        webviewText = document.getText();
        post({ type: "update", text: webviewText });
      }
    };

    webviewPanel.webview.onDidReceiveMessage(async (message: WebviewToHostMessage) => {
      switch (message.type) {
        case "ready": {
          webviewText = document.getText();
          const config = vscode.workspace.getConfiguration("latexRich", document.uri);
          post({
            type: "init",
            text: webviewText,
            customCommands: config.get<Record<string, CustomCommandStyle>>("customCommands", {}),
            pageWidth: config.get<number>("pageWidth", 880),
            pageAlign: config.get<PageAlign>("pageAlign", "center"),
            showToolbar: config.get<boolean>("showToolbar", true),
            pdfWorkerUrl: webviewPanel.webview
              .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "pdf.worker.min.mjs"))
              .toString(),
            references: await readReferences(document.uri),
            project: await projectData(document),
          });
          entry.ready = true;
          RichEditorProvider.refreshDiagnostics(document.uri);
          const pending = RichEditorProvider.pendingReveals.get(key);
          if (pending !== undefined) {
            RichEditorProvider.pendingReveals.delete(key);
            post({ type: "revealLine", line: pending });
          }
          break;
        }
        case "changes": {
          const { changes, baseLength } = message;
          queue = queue.then(() => applyWebviewChanges(changes, baseLength));
          break;
        }
        case "undo":
        case "redo":
          queue = queue.then(() => vscode.commands.executeCommand(message.type));
          break;
        case "requestFixes": {
          const range = new vscode.Range(document.positionAt(message.from), document.positionAt(message.to));
          const actions =
            (await vscode.commands.executeCommand<Array<vscode.CodeAction | vscode.Command>>(
              "vscode.executeCodeActionProvider",
              document.uri,
              range,
              vscode.CodeActionKind.QuickFix.value,
            )) ?? [];
          offeredFixes.clear();
          offeredFixes.set(message.requestId, actions);
          post({ type: "fixes", requestId: message.requestId, fixes: actions.map((a, index) => ({ index, title: a.title })) });
          break;
        }
        case "applyFix": {
          const action = offeredFixes.get(message.requestId)?.[message.index];
          if (!action) break;
          if ("edit" in action && action.edit) await vscode.workspace.applyEdit(action.edit);
          const command = "command" in action && typeof action.command === "object" ? action.command : (action as vscode.Command);
          if (command?.command) await vscode.commands.executeCommand(command.command, ...(command.arguments ?? []));
          break;
        }
        case "goToDefinition": {
          const location = await findDefinition(document, message.kind, message.key);
          if (!location) {
            vscode.window.setStatusBarMessage(`No definition found for "${message.key}"`, 3000);
          } else if (location.uri.toString() === key || /\.tex$/i.test(location.uri.path)) {
            await revealSourceLine(location.uri, location.range.start.line + 1);
          } else {
            await vscode.window.showTextDocument(location.uri, { selection: location.range, viewColumn: vscode.ViewColumn.Active });
          }
          break;
        }
        case "setLayout":
          await updateLayout(message.pageWidth, message.pageAlign);
          break;
        case "cursor":
          RichEditorProvider.cursors.set(key, message.line);
          break;
        case "addFigures": {
          try {
            const { paths, creates } = await placeFigures(document, [
              ...message.files.map((f) => ({ name: f.name, bytes: Buffer.from(f.data, "base64") })),
              ...message.uris.map((u) => {
                const uri = vscode.Uri.parse(u);
                return { uri, name: uri.path.slice(uri.path.lastIndexOf("/") + 1) };
              }),
            ]);
            for (const create of creates) await vscode.workspace.fs.writeFile(create.uri, create.bytes);
            post({ type: "figuresAdded", requestId: message.requestId, paths });
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Couldn't add the figure: ${error}`);
            post({ type: "figuresAdded", requestId: message.requestId, paths: [], error });
          }
          break;
        }
        case "resolveImage": {
          const found = await findImage(document, message.path);
          post({
            type: "imageResolved",
            requestId: message.requestId,
            url: found ? webviewPanel.webview.asWebviewUri(found.uri).toString() : null,
            kind: found?.kind ?? "image",
          });
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
      auxWatcher.dispose();
      sourceWatcher.dispose();
      if (RichEditorProvider.panels.get(key) === entry) RichEditorProvider.panels.delete(key);
    });
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview-editor.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview-editor.css"),
    );
    const nonce = getNonce();
    const csp = webview.cspSource;
    // pdf.js (used to draw PDF figures) runs its worker from a blob: wrapper
    // that imports the worker script from the extension's resource origin.
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; img-src ${csp} data: blob:; font-src ${csp}; connect-src ${csp}; worker-src ${csp} blob:; script-src 'nonce-${nonce}' ${csp};" />
  <link rel="stylesheet" href="${styleUri}" />
</head>
<body>
  <div id="editor"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

// Mirrors how LaTeX finds graphics: the path as written (relative to the
// document), then each \graphicspath folder, trying the usual extensions when
// none is given. EPS can't be drawn directly, but pdflatex leaves a converted
// "<name>-eps-converted-to.pdf" next to it, which can.
async function findImage(
  document: vscode.TextDocument,
  requested: string,
): Promise<{ uri: vscode.Uri; kind: ImageKind } | undefined> {
  const relative = requested.replace(/^\/+/, "");
  const folder = vscode.Uri.joinPath(document.uri, "..");
  const extension = path.posix.extname(relative).toLowerCase();
  const names = IMAGE_EXTENSIONS.includes(extension) ? [relative] : IMAGE_EXTENSIONS.map((e) => relative + e);

  for (const directory of ["", ...graphicsPaths(document.getText())]) {
    for (const name of names) {
      const candidates =
        path.posix.extname(name).toLowerCase() === ".eps"
          ? [name.replace(/\.eps$/i, "-eps-converted-to.pdf")]
          : [name];
      for (const candidate of candidates) {
        const uri = vscode.Uri.joinPath(folder, directory, candidate);
        if (await exists(uri)) {
          return { uri, kind: candidate.toLowerCase().endsWith(".pdf") ? "pdf" : "image" };
        }
      }
    }
  }
  return undefined;
}

function graphicsPaths(text: string): string[] {
  const match = /\\graphicspath\s*\{((?:\s*\{[^}]*\})+)\s*\}/.exec(text);
  if (!match) return [];
  return [...match[1].matchAll(/\{([^}]*)\}/g)].map((m) => m[1].trim()).filter(Boolean);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

function getNonce(): string {
  let text = "";
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/** Saves page width/alignment as user settings; the config listener then updates every open view. */
export async function updateLayout(pageWidth?: number, pageAlign?: PageAlign) {
  const config = vscode.workspace.getConfiguration("latexRich");
  if (pageWidth !== undefined) await config.update("pageWidth", Math.max(0, Math.round(pageWidth)), vscode.ConfigurationTarget.Global);
  if (pageAlign !== undefined) await config.update("pageAlign", pageAlign, vscode.ConfigurationTarget.Global);
}
