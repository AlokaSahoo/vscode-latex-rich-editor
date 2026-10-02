import * as vscode from "vscode";
import * as path from "path";
import { placeFigures } from "./figures";
import { projectBibliography, projectLabels } from "./project";
import { readReferences } from "./references";
import type {
  CustomCommandStyle,
  HostToWebviewMessage,
  ImageKind,
  ProjectData,
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
  panel: vscode.WebviewPanel;
  post: (message: HostToWebviewMessage) => Thenable<boolean>;
  ready: boolean;
}

const IMAGE_EXTENSIONS = [".pdf", ".png", ".jpg", ".jpeg", ".eps"];

export class RichEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "latexRich.richEditor";

  private static readonly panels = new Map<string, OpenPanel>();
  private static readonly pendingReveals = new Map<string, number>();

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

    // Tracks the last text we know the webview holds, so we can skip
    // redundant "update" posts when a document change originated from the
    // webview itself (avoids cursor-jumping feedback loops).
    let lastKnownWebviewText = document.getText();
    let applyingRemoteEdit = false;

    const post = (message: HostToWebviewMessage) => webviewPanel.webview.postMessage(message);
    const key = document.uri.toString();
    const entry: OpenPanel = { panel: webviewPanel, post, ready: false };
    RichEditorProvider.panels.set(key, entry);

    // Label/citation numbers come from the .aux file; refresh them whenever a
    // compile rewrites it.
    const auxName = document.uri.path.slice(document.uri.path.lastIndexOf("/") + 1).replace(/\.tex$/i, ".aux");
    const auxWatcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(documentFolder, auxName));
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
      if (e.document.uri.toString() !== key) return;
      if (applyingRemoteEdit) return;
      const text = document.getText();
      if (text === lastKnownWebviewText) return;
      lastKnownWebviewText = text;
      post({ type: "update", text });
    });

    webviewPanel.webview.onDidReceiveMessage(async (message: WebviewToHostMessage) => {
      switch (message.type) {
        case "ready": {
          lastKnownWebviewText = document.getText();
          const config = vscode.workspace.getConfiguration("latexRich", document.uri);
          post({
            type: "init",
            text: lastKnownWebviewText,
            customCommands: config.get<Record<string, CustomCommandStyle>>("customCommands", {}),
            pageWidth: config.get<number>("pageWidth", 880),
            showToolbar: config.get<boolean>("showToolbar", true),
            pdfWorkerUrl: webviewPanel.webview
              .asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, "dist", "pdf.worker.min.mjs"))
              .toString(),
            references: await readReferences(document.uri),
            project: await projectData(document),
          });
          entry.ready = true;
          const pending = RichEditorProvider.pendingReveals.get(key);
          if (pending !== undefined) {
            RichEditorProvider.pendingReveals.delete(key);
            post({ type: "revealLine", line: pending });
          }
          break;
        }
        case "edit": {
          if (message.text === document.getText()) return;
          lastKnownWebviewText = message.text;
          const edit = new vscode.WorkspaceEdit();
          const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(document.getText().length),
          );
          edit.replace(document.uri, fullRange, message.text);
          applyingRemoteEdit = true;
          try {
            await vscode.workspace.applyEdit(edit);
          } finally {
            applyingRemoteEdit = false;
          }
          break;
        }
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
