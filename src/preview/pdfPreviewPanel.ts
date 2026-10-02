import * as vscode from "vscode";
import * as path from "path";
import { revealSourceLine } from "../navigation";
import { inverseSearch, loadSynctex } from "../synctex";
import type { HostToPreviewMessage, PreviewToHostMessage } from "./protocol";

export class PdfPreviewPanel {
  private static current: PdfPreviewPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private pdfPath: string | undefined;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    column: vscode.ViewColumn,
  ) {
    this.panel = vscode.window.createWebviewPanel("latexRich.pdfPreview", "LaTeX PDF Preview", column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
    });
    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage((message: PreviewToHostMessage) => {
      if (message.type === "inverseSearch") void this.inverseSearch(message.page, message.x, message.y);
    });
    this.panel.onDidDispose(() => {
      if (PdfPreviewPanel.current === this) {
        PdfPreviewPanel.current = undefined;
      }
    });
  }

  public static show(context: vscode.ExtensionContext, pdfPath: string): void {
    if (!PdfPreviewPanel.current) {
      PdfPreviewPanel.current = new PdfPreviewPanel(context, vscode.ViewColumn.Beside);
    } else {
      PdfPreviewPanel.current.panel.reveal(vscode.ViewColumn.Beside, true);
    }
    PdfPreviewPanel.current.load(pdfPath);
  }

  private async inverseSearch(page: number, x: number, y: number) {
    if (!this.pdfPath) return;
    const data = loadSynctex(this.pdfPath);
    if (!data) {
      vscode.window.showInformationMessage(
        "No SyncTeX data next to this PDF — compile the document to enable jumping to the source.",
      );
      return;
    }
    const location = inverseSearch(data, page, x, y);
    if (!location) return;
    await revealSourceLine(vscode.Uri.file(location.file), location.line);
  }

  private load(pdfPath: string) {
    this.pdfPath = pdfPath;
    // The PDF lives next to the .tex file, which is outside the extension's
    // own resource root, so it must be allow-listed explicitly per document.
    this.panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
        vscode.Uri.file(path.dirname(pdfPath)),
      ],
    };
    // Cache-bust: the file content changes on recompile but the URI is
    // stable, so a plain reload could otherwise serve a cached response.
    // Appended after stringifying (rather than via Uri.with) to avoid
    // Uri's query-component percent-encoding mangling the "=".
    const pdfUri = this.panel.webview.asWebviewUri(vscode.Uri.file(pdfPath));
    const workerUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "pdf.worker.min.mjs"),
    );
    const message: HostToPreviewMessage = {
      type: "load",
      url: `${pdfUri.toString()}?t=${Date.now()}`,
      workerUrl: workerUri.toString(),
    };
    this.panel.webview.postMessage(message);
  }

  private getHtml(): string {
    const webview = this.panel.webview;
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "dist", "webview-preview.js"),
    );
    const nonce = getNonce();
    const csp = webview.cspSource;
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${csp} data: blob:; script-src 'nonce-${nonce}' ${csp}; worker-src ${csp} blob:; connect-src ${csp}; style-src 'unsafe-inline';" />
  <style>
    html, body { min-height: 100%; margin: 0; padding: 0; background: #525659; }
    #pages { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 12px; color: #eee; }
    .pdf-page { max-width: 100%; height: auto; box-shadow: 0 1px 4px rgba(0,0,0,0.5); cursor: text; }
    body.dark-pages { background: #1e1e1e; }
    body.dark-pages .pdf-page { filter: invert(0.88) hue-rotate(180deg); }
    #dark-toggle {
      position: fixed; top: 10px; right: 14px; z-index: 10;
      width: 30px; height: 30px; border: none; border-radius: 15px; cursor: pointer;
      background: rgba(30,30,30,0.7); color: #eee; font-size: 15px; line-height: 30px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.4); opacity: 0.75;
    }
    #dark-toggle:hover { opacity: 1; }
    body.dark-pages #dark-toggle { background: rgba(240,240,240,0.85); color: #222; }
  </style>
</head>
<body>
  <button id="dark-toggle" aria-label="Toggle dark pages">&#9790;</button>
  <div id="pages"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
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
