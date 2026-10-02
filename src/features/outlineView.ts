import * as vscode from "vscode";
import { activeTexDocument } from "../activeDocument";
import { revealSourceLine } from "../navigation";
import { outline, type OutlineItem } from "../shared/latexText";

const ICONS: Record<OutlineItem["kind"], vscode.ThemeIcon> = {
  section: new vscode.ThemeIcon("symbol-namespace"),
  figure: new vscode.ThemeIcon("file-media"),
  table: new vscode.ThemeIcon("table"),
  equation: new vscode.ThemeIcon("symbol-operator"),
};

class OutlineProvider implements vscode.TreeDataProvider<OutlineItem> {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;
  document: vscode.TextDocument | undefined;
  private items: OutlineItem[] = [];

  setDocument(document: vscode.TextDocument | undefined) {
    this.document = document;
    this.refresh();
  }

  refresh() {
    this.items = this.document ? outline(this.document.getText()) : [];
    this.changed.fire();
  }

  getChildren(element?: OutlineItem): OutlineItem[] {
    return element ? element.children : this.items;
  }

  getTreeItem(item: OutlineItem): vscode.TreeItem {
    const tree = new vscode.TreeItem(
      item.title || item.kind,
      item.children.length > 0 ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
    );
    tree.iconPath = ICONS[item.kind];
    tree.description = item.label;
    tree.tooltip = `${item.title}${item.label ? `\n\\label{${item.label}}` : ""}\nLine ${item.line + 1}`;
    if (this.document) {
      tree.command = {
        command: "latexRich.revealLine",
        title: "Go to",
        arguments: [this.document.uri, item.line + 1],
      };
    }
    return tree;
  }
}

export function registerOutlineView(context: vscode.ExtensionContext) {
  const provider = new OutlineProvider();
  const view = vscode.window.createTreeView("latexRich.outline", { treeDataProvider: provider, showCollapseAll: true });

  const follow = () => {
    const document = activeTexDocument();
    // Keep showing the last .tex outline while e.g. the PDF preview has focus.
    if (document && document !== provider.document) provider.setDocument(document);
    vscode.commands.executeCommand("setContext", "latexRich.hasTexDocument", !!provider.document);
    view.description = provider.document ? provider.document.uri.path.split("/").pop() : undefined;
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  context.subscriptions.push(
    view,
    vscode.window.tabGroups.onDidChangeTabs(follow),
    vscode.window.tabGroups.onDidChangeTabGroups(follow),
    vscode.window.onDidChangeActiveTextEditor(follow),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document !== provider.document) return;
      clearTimeout(timer);
      timer = setTimeout(() => provider.refresh(), 300);
    }),
    vscode.workspace.onDidCloseTextDocument((d) => {
      if (d === provider.document) provider.setDocument(undefined);
    }),
    vscode.commands.registerCommand("latexRich.revealLine", (uri: vscode.Uri, line: number) =>
      revealSourceLine(uri, line),
    ),
  );
  follow();
}
