import * as vscode from "vscode";
import * as path from "path";
import type { HostToPreviewMessage } from "./protocol";

export class PdfPreviewPanel {
  private static current: PdfPreviewPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private pdfPath: string | undefined;

  private constructor(
    private readonly context: vscode.ExtensionContext,
    column: vscode.ViewColumn,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      "latexRich.pdfPreview",
      "LaTeX PDF Preview",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "dist")],
      },
    );
    this.panel.webview.html = this.getHtml();
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

  public static reloadIfShowing(context: vscode.ExtensionContext, pdfPath: string): void {
    if (PdfPreviewPanel.current?.pdfPath === pdfPath) {
      PdfPreviewPanel.current.load(pdfPath);
    }
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
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; script-src 'nonce-${nonce}' ${webview.cspSource}; worker-src ${webview.cspSource}; connect-src ${webview.cspSource}; style-src 'unsafe-inline';" />
  <style>
    html, body { height: 100%; margin: 0; padding: 0; background: #525659; }
    #pages { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 12px; }
    .pdf-page { box-shadow: 0 1px 4px rgba(0,0,0,0.5); }
  </style>
</head>
<body>
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
