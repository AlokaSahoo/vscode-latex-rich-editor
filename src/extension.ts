import * as vscode from "vscode";
import { RichEditorProvider } from "./richEditorProvider";
import { compileDocument, createOutputChannel } from "./compile/compileManager";
import { PdfPreviewPanel } from "./preview/pdfPreviewPanel";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(RichEditorProvider.register(context));

  const outputChannel = createOutputChannel();
  const diagnostics = vscode.languages.createDiagnosticCollection("latexRich");
  context.subscriptions.push(outputChannel, diagnostics);

  context.subscriptions.push(
    vscode.commands.registerCommand("latexRich.compile", async () => {
      const document = getActiveTexDocument();
      if (!document) {
        vscode.window.showWarningMessage("No .tex file is active.");
        return;
      }
      await document.save();
      const result = await compileDocument(document, outputChannel, diagnostics);
      if (result.success) {
        PdfPreviewPanel.show(context, result.pdfPath);
      } else {
        vscode.window.showErrorMessage(
          "LaTeX compile failed. See the LaTeX Rich Editor output panel for details.",
        );
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("latexRich.showPreview", () => {
      const document = getActiveTexDocument();
      if (!document) {
        vscode.window.showWarningMessage("No .tex file is active.");
        return;
      }
      const pdfPath = document.uri.fsPath.replace(/\.tex$/, ".pdf");
      PdfPreviewPanel.show(context, pdfPath);
    }),
  );
}

function getActiveTexDocument(): vscode.TextDocument | undefined {
  const active = vscode.window.activeTextEditor?.document;
  if (active && active.uri.fsPath.endsWith(".tex")) return active;

  // Custom editors (our rich editor) don't populate activeTextEditor, so
  // fall back to inspecting the active tab directly.
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (
        tab.isActive &&
        tab.input instanceof vscode.TabInputCustom &&
        tab.input.uri.fsPath.endsWith(".tex")
      ) {
        return vscode.workspace.textDocuments.find(
          (d) => d.uri.toString() === (tab.input as vscode.TabInputCustom).uri.toString(),
        );
      }
    }
  }
  return undefined;
}

export function deactivate() {}
