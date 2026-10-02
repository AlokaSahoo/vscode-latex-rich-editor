import * as vscode from "vscode";
import { RichEditorProvider } from "./richEditorProvider";

// Jumps to a source line in whichever view of the file is in use: the raw
// text editor if that's what's showing, otherwise the rich view. If the file
// isn't open at all it opens with the user's default editor for .tex files.
export async function revealSourceLine(uri: vscode.Uri, line: number): Promise<void> {
  const zeroBased = Math.max(0, line - 1);
  const key = uri.toString();
  const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
  const richTab = tabs.find(
    (t) =>
      t.input instanceof vscode.TabInputCustom &&
      t.input.viewType === RichEditorProvider.viewType &&
      t.input.uri.toString() === key,
  );
  const rawTab = tabs.find((t) => t.input instanceof vscode.TabInputText && t.input.uri.toString() === key);

  if (rawTab && (!richTab || (rawTab.isActive && !richTab.isActive))) {
    await revealInTextEditor(uri, zeroBased, rawTab.group.viewColumn);
    return;
  }
  if (richTab) {
    RichEditorProvider.revealLine(uri, zeroBased);
    return;
  }

  RichEditorProvider.revealLine(uri, zeroBased);
  await vscode.commands.executeCommand("vscode.open", uri, { viewColumn: vscode.ViewColumn.One });
  // The user's default for .tex may be the plain text editor.
  if (vscode.window.activeTextEditor?.document.uri.toString() === key) {
    RichEditorProvider.cancelPendingReveal(uri);
    await revealInTextEditor(uri, zeroBased, vscode.window.activeTextEditor.viewColumn);
  }
}

async function revealInTextEditor(uri: vscode.Uri, line: number, column: vscode.ViewColumn | undefined) {
  const editor = await vscode.window.showTextDocument(uri, { viewColumn: column, preserveFocus: false });
  const position = new vscode.Position(Math.min(line, editor.document.lineCount - 1), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}
