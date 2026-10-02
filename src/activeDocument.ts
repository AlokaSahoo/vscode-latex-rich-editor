import * as vscode from "vscode";

export function tabUri(tab: vscode.Tab | undefined): vscode.Uri | undefined {
  const input = tab?.input;
  return input instanceof vscode.TabInputText || input instanceof vscode.TabInputCustom ? input.uri : undefined;
}

/** The .tex document in the active tab, shown raw or in the rich view (custom editors don't set activeTextEditor). */
export function activeTexDocument(): vscode.TextDocument | undefined {
  const uri = tabUri(vscode.window.tabGroups.activeTabGroup.activeTab);
  if (!uri || !/\.tex$/i.test(uri.path)) return undefined;
  return vscode.workspace.textDocuments.find((d) => d.uri.toString() === uri.toString());
}

/** For commands: the clicked editor's URI if given, else the active tab; warns if there's no .tex file. */
export async function commandTexDocument(uri: unknown): Promise<vscode.TextDocument | undefined> {
  if (uri instanceof vscode.Uri && /\.tex$/i.test(uri.path)) return vscode.workspace.openTextDocument(uri);
  const active = vscode.window.activeTextEditor?.document;
  if (active && /\.tex$/i.test(active.uri.path)) return active;
  const tabResource = tabUri(vscode.window.tabGroups.activeTabGroup.activeTab);
  if (tabResource && /\.tex$/i.test(tabResource.path)) return vscode.workspace.openTextDocument(tabResource);
  vscode.window.showWarningMessage("Open a .tex file first.");
  return undefined;
}
