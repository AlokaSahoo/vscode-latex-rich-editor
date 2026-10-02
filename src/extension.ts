import * as vscode from "vscode";
import * as fs from "fs";
import { commandTexDocument, tabUri } from "./activeDocument";
import { RichEditorProvider } from "./richEditorProvider";
import { cleanAuxiliaryFiles, compileDocument, createOutputChannel } from "./compile/compileManager";
import { registerLanguageFeatures } from "./features/languageFeatures";
import { registerOutlineView } from "./features/outlineView";
import { registerPaperTools } from "./features/paperTools";
import { offerFix, registerSetup } from "./features/setup";
import { PdfPreviewPanel } from "./preview/pdfPreviewPanel";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(RichEditorProvider.register(context));

  const outputChannel = createOutputChannel();
  const diagnostics = vscode.languages.createDiagnosticCollection("latexRich");
  context.subscriptions.push(outputChannel, diagnostics);

  registerLanguageFeatures(context);
  registerOutlineView(context);
  registerPaperTools(context, outputChannel);
  registerSetup(context);

  const compileAndPreview = async (document: vscode.TextDocument) => {
    await document.save();
    const result = await compileDocument(document, outputChannel, diagnostics);
    if (result.success) {
      PdfPreviewPanel.show(context, result.pdfPath);
    } else if (result.problem) {
      await offerFix(result.problem);
    } else {
      const choice = await vscode.window.showErrorMessage(
        "LaTeX compile failed — the errors are listed in the Problems panel.",
        "Show Log",
      );
      if (choice) outputChannel.show(true);
    }
  };

  // Editor title-bar buttons pass the clicked editor's URI; keybindings and
  // the Command Palette don't, so fall back to the active tab.
  context.subscriptions.push(
    vscode.commands.registerCommand("latexRich.compile", async (uri?: unknown) => {
      const document = await commandTexDocument(uri);
      if (document) await compileAndPreview(document);
    }),

    vscode.commands.registerCommand("latexRich.showPreview", async (uri?: unknown) => {
      const document = await commandTexDocument(uri);
      if (!document) return;
      const pdfPath = document.uri.fsPath.replace(/\.tex$/i, ".pdf");
      if (fs.existsSync(pdfPath)) PdfPreviewPanel.show(context, pdfPath);
      else await compileAndPreview(document);
    }),

    vscode.commands.registerCommand("latexRich.openRich", (uri?: unknown) =>
      reopenTexFile(uri, RichEditorProvider.viewType),
    ),
    vscode.commands.registerCommand("latexRich.openRaw", (uri?: unknown) => reopenTexFile(uri, "default")),

    vscode.commands.registerCommand("latexRich.clean", async (uri?: unknown) => {
      const document = await commandTexDocument(uri);
      if (!document) return;
      const removed = await cleanAuxiliaryFiles(document);
      vscode.window.setStatusBarMessage(
        removed.length > 0
          ? `$(trash) Removed ${removed.length} auxiliary file${removed.length === 1 ? "" : "s"}`
          : "No auxiliary files to remove",
        4000,
      );
    }),
  );
}

// Switches the active .tex tab between the rich view and VS Code's plain
// text editor in place, like toggling Markdown's preview.
async function reopenTexFile(uri: unknown, viewType: string) {
  const document = await commandTexDocument(uri);
  if (!document) return;
  const key = document.uri.toString();
  const column = (
    vscode.window.tabGroups.all.find((g) => tabUri(g.activeTab)?.toString() === key) ??
    vscode.window.tabGroups.activeTabGroup
  ).viewColumn;
  // Both views share one document; saving first means closing the old tab
  // can never prompt about unsaved changes.
  if (document.isDirty) await document.save();
  await vscode.commands.executeCommand("vscode.openWith", document.uri, viewType, column);

  const wantRich = viewType === RichEditorProvider.viewType;
  const group = vscode.window.tabGroups.all.find((g) => g.viewColumn === column);
  const stale = group?.tabs.find((tab) =>
    wantRich
      ? tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === key
      : tab.input instanceof vscode.TabInputCustom &&
        tab.input.viewType === RichEditorProvider.viewType &&
        tab.input.uri.toString() === key,
  );
  if (stale) await vscode.window.tabGroups.close(stale, true);
}

export function deactivate() {}
