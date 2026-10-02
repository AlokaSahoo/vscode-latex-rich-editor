import * as vscode from "vscode";

// The "Actions" list in the LaTeX sidebar: one click for the main commands,
// so nobody has to remember the Command Palette names.

interface Action {
  label: string;
  command: string;
  icon: string;
  needsTex?: boolean;
}

const ACTIONS: Action[] = [
  { label: "Compile", command: "latexRich.compile", icon: "play", needsTex: true },
  { label: "Open PDF Preview", command: "latexRich.showPreview", icon: "open-preview", needsTex: true },
  { label: "Show Cursor Position in PDF", command: "latexRich.syncToPdf", icon: "target", needsTex: true },
  { label: "Open Rich View", command: "latexRich.openRich", icon: "preview", needsTex: true },
  { label: "Reopen as Raw LaTeX", command: "latexRich.openRaw", icon: "code", needsTex: true },
  { label: "Check APS Length (Word Count)", command: "latexRich.lengthCheck", icon: "book", needsTex: true },
  { label: "Prepare arXiv Submission", command: "latexRich.prepareArxiv", icon: "package", needsTex: true },
  { label: "Clean Auxiliary Files", command: "latexRich.clean", icon: "trash", needsTex: true },
  { label: "New REVTeX Paper…", command: "latexRich.newPaper", icon: "new-file" },
  { label: "Check Setup", command: "latexRich.checkSetup", icon: "tools" },
];

class ActionsProvider implements vscode.TreeDataProvider<Action> {
  getChildren(): Action[] {
    return ACTIONS;
  }
  getTreeItem(action: Action): vscode.TreeItem {
    const item = new vscode.TreeItem(action.label);
    item.iconPath = new vscode.ThemeIcon(action.icon);
    // Commands without an argument act on the .tex file in the active tab.
    item.command = { command: action.command, title: action.label };
    if (action.needsTex) item.tooltip = `${action.label} (for the .tex file in the active tab)`;
    return item;
  }
}

export function registerActionsView(context: vscode.ExtensionContext) {
  context.subscriptions.push(vscode.window.registerTreeDataProvider("latexRich.actions", new ActionsProvider()));
}
