import * as vscode from "vscode";
import type {
  CustomCommandStyle,
  HostToWebviewMessage,
  WebviewToHostMessage,
} from "./webview-editor/protocol";

export class RichEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = "latexRich.richEditor";

  constructor(private readonly context: vscode.ExtensionContext) {}

  public static register(context: vscode.ExtensionContext): vscode.Disposable {
    const provider = new RichEditorProvider(context);
    return vscode.window.registerCustomEditorProvider(RichEditorProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    });
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, "dist"),
        vscode.Uri.joinPath(document.uri, ".."),
      ],
    };
    webviewPanel.webview.html = this.getHtml(webviewPanel.webview);

    // Tracks the last text we know the webview holds, so we can skip
    // redundant "update" posts when a document change originated from the
    // webview itself (avoids cursor-jumping feedback loops).
    let lastKnownWebviewText = document.getText();
    let applyingRemoteEdit = false;

    const post = (message: HostToWebviewMessage) => webviewPanel.webview.postMessage(message);

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() !== document.uri.toString()) return;
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
          const customCommands = vscode.workspace
            .getConfiguration("latexRich", document.uri)
            .get<Record<string, CustomCommandStyle>>("customCommands", {});
          post({ type: "init", text: lastKnownWebviewText, customCommands });
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
        case "resolveImage": {
          const relative = message.path.replace(/^\/+/, "");
          const fileUri = vscode.Uri.joinPath(document.uri, "..", relative);
          const url = webviewPanel.webview.asWebviewUri(fileUri).toString();
          post({ type: "imageResolved", requestId: message.requestId, url });
          break;
        }
      }
    });

    webviewPanel.onDidDispose(() => {
      changeSub.dispose();
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
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; connect-src ${webview.cspSource}; script-src 'nonce-${nonce}';" />
  <link rel="stylesheet" href="${styleUri}" />
  <style>
    html, body { height: 100%; margin: 0; padding: 0; }
    #editor { height: 100vh; display: flex; flex-direction: column; }
    .lv-dual-editor { flex: 1; min-height: 0; display: flex; flex-direction: column; }
    .lv-editor-host { flex: 1; min-height: 0; overflow: auto; }
    .cm-editor { height: 100%; }
    math-field::part(menu-toggle),
    math-field::part(virtual-keyboard-toggle) { display: none; }
  </style>
</head>
<body>
  <div id="editor"></div>
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
