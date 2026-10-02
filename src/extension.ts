import * as vscode from "vscode";
import * as fs from "fs";
import { activeTexDocument, commandTexDocument, tabUri } from "./activeDocument";
import { RichEditorProvider } from "./richEditorProvider";
import { cleanAuxiliaryFiles, compileDocument, createOutputChannel, pdfOf } from "./compile/compileManager";
import { registerLanguageFeatures } from "./features/languageFeatures";
import { registerOutlineView } from "./features/outlineView";
import { registerPaperTools } from "./features/paperTools";
import { offerFix, registerSetup } from "./features/setup";
import { PdfPreviewPanel } from "./preview/pdfPreviewPanel";
import { forwardSearch, loadSynctex } from "./synctex";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(RichEditorProvider.register(context));

  const outputChannel = createOutputChannel();
  const diagnostics = vscode.languages.createDiagnosticCollection("latexRich");
  context.subscriptions.push(outputChannel, diagnostics);

  registerLanguageFeatures(context);
  registerOutlineView(context);
  registerPaperTools(context, outputChannel);
  registerSetup(context);

  // Where the cursor is in this document, whichever view it's open in.
  const cursorLine = (document: vscode.TextDocument): number | undefined => {
    const editor = vscode.window.visibleTextEditors.find((e) => e.document === document);
    return editor?.selection.active.line ?? RichEditorProvider.cursorLine(document.uri);
  };

  // Forward search: show the PDF spot that corresponds to the cursor line.
  const syncToCursor = (document: vscode.TextDocument, pdfPath: string, quiet: boolean) => {
    const line = cursorLine(document);
    const data = line === undefined ? undefined : loadSynctex(pdfPath);
    const location = data && forwardSearch(data, document.uri.fsPath, line! + 1);
    if (location) PdfPreviewPanel.reveal(context, pdfPath, location);
    else if (!quiet) vscode.window.showInformationMessage("Compile the document first — there's no SyncTeX data for this line yet.");
  };

  let compiling = false;
  let compileAgain = false;
  const compileAndPreview = async (document: vscode.TextDocument, fromSave = false) => {
    if (compiling) {
      compileAgain = true;
      return;
    }
    compiling = true;
    try {
      // Save the whole project (a chapter may be compiled through its main file).
      for (const open of vscode.workspace.textDocuments) {
        if (open.isDirty && /\.(tex|bib|sty|cls)$/i.test(open.uri.path)) await open.save();
      }
      const result = await compileDocument(document, outputChannel, diagnostics);
      if (result.success) {
        // On save, refresh an open preview without pulling focus; otherwise open it.
        if (!fromSave || PdfPreviewPanel.isOpen()) PdfPreviewPanel.show(context, result.pdfPath, fromSave);
        if (vscode.workspace.getConfiguration("latexRich").get("syncAfterCompile", true)) {
          setTimeout(() => syncToCursor(document, result.pdfPath, true), 600);
        }
      } else if (result.problem) {
        await offerFix(result.problem);
      } else if (!fromSave) {
        const choice = await vscode.window.showErrorMessage(
          "LaTeX compile failed — the errors are listed in the Problems panel and underlined in the editor.",
          "Show Log",
        );
        if (choice) outputChannel.show(true);
      }
    } finally {
      compiling = false;
    }
    if (compileAgain) {
      compileAgain = false;
      await compileAndPreview(document, fromSave);
    }
  };

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((saved) => {
      if (compiling || !/\.(tex|bib)$/i.test(saved.uri.path)) return;
      if (!vscode.workspace.getConfiguration("latexRich", saved.uri).get("compileOnSave", false)) return;
      const target = /\.tex$/i.test(saved.uri.path) ? saved : activeTexDocument();
      if (target) void compileAndPreview(target, true);
    }),
    // Compile errors and spelling/grammar findings also appear in the rich view.
    vscode.languages.onDidChangeDiagnostics((e) => {
      for (const uri of e.uris) RichEditorProvider.refreshDiagnostics(uri);
    }),
    vscode.commands.registerCommand("latexRich.syncToPdf", async (uri?: unknown) => {
      const document = await commandTexDocument(uri);
      if (document) syncToCursor(document, pdfOf(document), false);
    }),
  );

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
      const pdfPath = pdfOf(document);
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
