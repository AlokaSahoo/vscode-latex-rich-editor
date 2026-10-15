import * as vscode from "vscode";
import * as fs from "fs";
import { activeTexDocument, commandTexDocument, tabUri } from "./activeDocument";
import { RichEditorProvider, updateLayout } from "./richEditorProvider";
import { cleanAuxiliaryFiles, compileDocument, createOutputChannel, pdfOf } from "./compile/compileManager";
import { registerLanguageFeatures } from "./features/languageFeatures";
import { registerActionsView } from "./features/actionsView";
import { registerOutlineView } from "./features/outlineView";
import { registerPaperTools } from "./features/paperTools";
import { offerFix, registerSetup } from "./features/setup";
import { previewAfterCompile, statusText, type CompileState } from "./compile/previewPolicy";
import { PdfPreviewPanel } from "./preview/pdfPreviewPanel";
import { forwardSearch, loadSynctex } from "./synctex";

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(RichEditorProvider.register(context));

  const outputChannel = createOutputChannel();
  const diagnostics = vscode.languages.createDiagnosticCollection("latexRich");
  context.subscriptions.push(outputChannel, diagnostics);

  registerLanguageFeatures(context);
  registerOutlineView(context);
  registerActionsView(context);
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

  // Compile status, since a finished compile no longer pops up the PDF.
  const compileStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  compileStatus.name = "LaTeX compile status";
  context.subscriptions.push(compileStatus);
  const setStatus = (state: CompileState) => {
    const view = statusText(state);
    if (!view) return compileStatus.hide();
    compileStatus.text = view.text;
    compileStatus.tooltip = view.tooltip;
    compileStatus.command = state.kind === "error" ? "workbench.actions.view.problems" : "latexRich.showPreview";
    compileStatus.show();
  };
  const countDiagnostics = (severity: vscode.DiagnosticSeverity) => {
    let n = 0;
    diagnostics.forEach((_uri, items) => {
      n += items.filter((d) => d.severity === severity).length;
    });
    return n;
  };

  let compiling = false;
  let compileAgain = false;
  let openAfterQueued = false;
  // The PDF opens only when asked for (`openPdf`); otherwise an already-open preview is just refreshed.
  const compileAndPreview = async (document: vscode.TextDocument, fromSave = false, openPdf = false) => {
    if (compiling) {
      compileAgain = true;
      openAfterQueued ||= openPdf;
      return;
    }
    compiling = true;
    setStatus({ kind: "compiling" });
    try {
      // Save the whole project (a chapter may be compiled through its main file).
      for (const open of vscode.workspace.textDocuments) {
        if (open.isDirty && /\.(tex|bib|sty|cls)$/i.test(open.uri.path)) await open.save();
      }
      const result = await compileDocument(document, outputChannel, diagnostics);
      if (result.success) {
        setStatus({ kind: "ok", warnings: countDiagnostics(vscode.DiagnosticSeverity.Warning) });
        const policy = previewAfterCompile({
          requested: openPdf,
          previewOpen: PdfPreviewPanel.isOpen(),
          autoOpen: vscode.workspace.getConfiguration("latexRich").get("openPdfAfterCompile", false),
        });
        if (policy.show) PdfPreviewPanel.show(context, result.pdfPath, policy.quiet);
        if (policy.show && vscode.workspace.getConfiguration("latexRich").get("syncAfterCompile", true)) {
          setTimeout(() => syncToCursor(document, result.pdfPath, true), 600);
        }
      } else if (result.problem) {
        setStatus({ kind: "error", errors: 0 });
        await offerFix(result.problem);
      } else {
        setStatus({ kind: "error", errors: countDiagnostics(vscode.DiagnosticSeverity.Error) });
      }
      if (!result.success && !result.problem && !fromSave) {
        const choice = await vscode.window.showErrorMessage(
          "LaTeX compile failed — the errors are listed in the Problems panel and underlined in the editor.",
          "Show Log",
        );
        if (choice) outputChannel.show(true);
      }
    } catch (err) {
      setStatus({ kind: "error", errors: 0 });
      throw err;
    } finally {
      compiling = false;
    }
    if (compileAgain) {
      compileAgain = false;
      const open = openPdf || openAfterQueued;
      openAfterQueued = false;
      await compileAndPreview(document, fromSave, open);
    }
  };

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((saved) => {
      // A save during a running compile still counts: compileAndPreview queues one more run.
      if (!/\.(tex|bib)$/i.test(saved.uri.path)) return;
      if (!vscode.workspace.getConfiguration("latexRich", saved.uri).get("compileOnSave", true)) return;
      const target = /\.tex$/i.test(saved.uri.path) ? saved : activeTexDocument();
      if (target) void compileAndPreview(target, true);
    }),
    // Compile errors and spelling/grammar findings also appear in the rich view.
    vscode.languages.onDidChangeDiagnostics((e) => {
      for (const uri of e.uris) RichEditorProvider.refreshDiagnostics(uri);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("latexRich.pageWidth") || e.affectsConfiguration("latexRich.pageAlign") || e.affectsConfiguration("latexRich.fontScale")) {
        RichEditorProvider.broadcastLayout();
      }
    }),
    // Page width/alignment of the rich view; the toolbar has buttons for these too.
    ...(() => {
      const width = () => vscode.workspace.getConfiguration("latexRich").get<number>("pageWidth", 880);
      const step = (delta: number) => () => updateLayout(Math.max(480, (width() || 1200) + delta));
      return [
        vscode.commands.registerCommand("latexRich.pageWider", step(80)),
        vscode.commands.registerCommand("latexRich.pageNarrower", step(-80)),
        vscode.commands.registerCommand("latexRich.pageFullWidth", () => updateLayout(width() === 0 ? 880 : 0)),
        vscode.commands.registerCommand("latexRich.pageAlign", () => {
          const align = vscode.workspace.getConfiguration("latexRich").get<string>("pageAlign", "center");
          return updateLayout(undefined, align === "left" ? "center" : "left");
        }),
      ];
    })(),
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
      else await compileAndPreview(document, false, true);
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

  // Remember where the user is so the other view opens at the same spot.
  const wantRich = viewType === RichEditorProvider.viewType;
  const raw = vscode.window.visibleTextEditors.find((e) => e.document === document);
  const position = wantRich
    ? raw && {
        line: raw.selection.active.line,
        character: raw.selection.active.character,
        topLine: raw.visibleRanges[0]?.start.line ?? raw.selection.active.line,
      }
    : RichEditorProvider.viewPosition(document.uri);
  if (wantRich && position) RichEditorProvider.restoreView(document.uri, position);

  await vscode.commands.executeCommand("vscode.openWith", document.uri, viewType, column);

  if (!wantRich && position) {
    const editor = vscode.window.visibleTextEditors.find((e) => e.document === document);
    if (editor) {
      const last = document.lineCount - 1;
      const cursor = new vscode.Position(Math.min(position.line, last), position.character);
      editor.selection = new vscode.Selection(cursor, cursor);
      const top = new vscode.Position(Math.min(position.topLine, last), 0);
      editor.revealRange(new vscode.Range(top, top), vscode.TextEditorRevealType.AtTop);
    }
  }

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
