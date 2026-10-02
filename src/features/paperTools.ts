import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import { activeTexDocument, commandTexDocument } from "../activeDocument";
import { buildArxivPackage } from "../arxivPackage";
import { rootOf } from "../compile/compileManager";
import { countLength, type LengthReport } from "../lengthCheck";
import { createZip } from "../zip";
import { paperSource, STARTER_BIB, TEMPLATES } from "../templates";

export function registerPaperTools(context: vscode.ExtensionContext, output: vscode.OutputChannel) {
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  status.command = "latexRich.lengthCheck";
  context.subscriptions.push(status);

  context.subscriptions.push(
    vscode.commands.registerCommand("latexRich.prepareArxiv", async (uri?: unknown) => {
      const document = await commandTexDocument(uri);
      if (document) await prepareArxiv(document);
    }),
    vscode.commands.registerCommand("latexRich.lengthCheck", async (uri?: unknown) => {
      const document = await commandTexDocument(uri);
      if (document) await showLengthReport(document, output);
    }),
    vscode.commands.registerCommand("latexRich.newPaper", newPaper),
  );

  // Live count in the status bar for PRL documents (the 3750-word Letters).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const update = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const document = activeTexDocument();
      if (!document || document.uri.scheme !== "file") {
        status.hide();
        return;
      }
      // Count the whole paper, also when a chapter file is the one open.
      const root = rootOf(document);
      const rootText = root === document.uri.fsPath ? document.getText() : readFile(root);
      if (rootText === undefined || !showsWordCount(rootText, document.uri)) {
        status.hide();
        return;
      }
      const report = countLength(root, root === document.uri.fsPath ? document.getText() : undefined, wordLimit(document.uri));
      const estimated = report.figures.some((f) => f.estimated);
      status.text = `$(book) ${estimated ? "~" : ""}${report.total.toLocaleString()} / ${report.limit.toLocaleString()} words`;
      status.tooltip =
        "APS length estimate: text + captions + equations + figures + tables. Title, authors, abstract, acknowledgments, references, appendices and end matter are not counted." +
        (estimated ? " Some figure sizes are guessed because the image file couldn't be read." : "") +
        " Click for the breakdown.";
      status.backgroundColor = report.total > report.limit ? new vscode.ThemeColor("statusBarItem.errorBackground") : undefined;
      status.show();
    }, 800);
  };
  context.subscriptions.push(
    vscode.window.tabGroups.onDidChangeTabs(update),
    vscode.workspace.onDidChangeTextDocument(update),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("latexRich.wordCount") || e.affectsConfiguration("latexRich.wordLimit")) update();
    }),
  );
  update();
}

function readFile(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return undefined;
  }
}

function wordLimit(uri: vscode.Uri): number {
  return vscode.workspace.getConfiguration("latexRich", uri).get<number>("wordLimit", 3750);
}

// REVTeX can't tell a Letter from a regular article (PRB Letters and PRB
// articles both use "prb"), so by default every REVTeX paper gets the count.
function showsWordCount(rootText: string, uri: vscode.Uri): boolean {
  const mode = vscode.workspace.getConfiguration("latexRich", uri).get<string>("wordCount", "revtex");
  if (mode === "off") return false;
  if (mode === "always") return true;
  if (mode === "prl") return /\\documentclass\s*\[[^\]]*\bprl\b[^\]]*\]\s*\{revtex/.test(rootText);
  return /\\documentclass\s*(\[[^\]]*\])?\s*\{revtex/.test(rootText);
}

// --- arXiv -----------------------------------------------------------------

async function prepareArxiv(document: vscode.TextDocument) {
  if (document.uri.scheme !== "file") {
    vscode.window.showErrorMessage("arXiv packaging needs a file on disk.");
    return;
  }
  await document.save();
  const mainFile = rootOf(document);
  const pkg = buildArxivPackage(mainFile);
  const zipPath = mainFile.replace(/\.tex$/i, "-arxiv.zip");
  const zipUri = vscode.Uri.file(zipPath);

  try {
    await vscode.workspace.fs.stat(zipUri);
    const choice = await vscode.window.showWarningMessage(
      `${path.basename(zipPath)} already exists. Replace it?`,
      { modal: true },
      "Replace",
    );
    if (choice !== "Replace") return;
  } catch {
    // doesn't exist yet
  }

  await vscode.workspace.fs.writeFile(zipUri, createZip(pkg.entries));
  const summary = `${path.basename(zipPath)}: ${pkg.counts.tex} .tex, ${pkg.counts.figures} figure${pkg.counts.figures === 1 ? "" : "s"}, ${pkg.counts.other} other file${pkg.counts.other === 1 ? "" : "s"}, comments removed.`;
  const actions = ["Reveal in Folder"];
  if (pkg.warnings.length > 0) {
    const choice = await vscode.window.showWarningMessage(`${summary} ${pkg.warnings.join(" ")}`, ...actions);
    if (choice) await vscode.commands.executeCommand("revealFileInOS", zipUri);
  } else {
    const choice = await vscode.window.showInformationMessage(summary, ...actions);
    if (choice) await vscode.commands.executeCommand("revealFileInOS", zipUri);
  }
}

// --- PRL length ---------------------------------------------------------------

async function showLengthReport(document: vscode.TextDocument, output: vscode.OutputChannel) {
  if (document.uri.scheme !== "file") return;
  const root = rootOf(document);
  const report = countLength(root, root === document.uri.fsPath ? document.getText() : undefined, wordLimit(document.uri));
  output.clear();
  output.appendLine(formatReport(path.basename(document.uri.fsPath), report));
  const percent = Math.round((report.total / report.limit) * 100);
  const message = `APS length: ${report.total.toLocaleString()} of ${report.limit.toLocaleString()} words (${percent}%).`;
  const show = report.total > report.limit ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
  if ((await show(message, "Show Breakdown")) === "Show Breakdown") output.show(true);
}

function formatReport(file: string, r: LengthReport): string {
  const lines = [
    `APS length estimate for ${file} — limit ${r.limit} words (latexRich.wordLimit)`,
    "(rules: journals.aps.org/authors/length-guide; title, authors, abstract, acknowledgments, references, appendices and end matter excluded)",
    "",
    `  Text                         ${r.textWords}`,
    `  Captions                     ${r.captionWords}`,
    `  Displayed math  ${String(r.equations.rows).padStart(3)} rows      ${r.equations.words}`,
  ];
  for (const f of r.figures) {
    lines.push(
      `  ${f.wide ? "Figure*" : "Figure "} ${f.label.padEnd(20).slice(0, 20)} ${String(f.words).padStart(4)}   (aspect ${f.aspect.toFixed(2)}${f.estimated ? ", estimated — image size unknown" : ""})`,
    );
  }
  for (const t of r.tables) {
    lines.push(`  ${t.wide ? "Table* " : "Table  "} ${t.label.padEnd(20).slice(0, 20)} ${String(t.words).padStart(4)}   (${t.lines} lines)`);
  }
  lines.push("", `  Total                        ${r.total}  (${r.total <= r.limit ? `${r.limit - r.total} under` : `${r.total - r.limit} OVER`} the limit)`);
  return lines.join("\n");
}

// --- New paper ----------------------------------------------------------------

async function newPaper() {
  const template = await vscode.window.showQuickPick(
    TEMPLATES.map((t) => ({ label: t.label, detail: t.detail, template: t })),
    { title: "New REVTeX paper", placeHolder: "Choose the journal" },
  );
  if (!template) return;

  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const target = await vscode.window.showSaveDialog({
    title: "Save the new paper",
    defaultUri: folder ? vscode.Uri.joinPath(folder, "paper.tex") : undefined,
    filters: { LaTeX: ["tex"] },
  });
  if (!target) return;

  const directory = vscode.Uri.joinPath(target, "..");
  const bib = vscode.Uri.joinPath(directory, "references.bib");
  await vscode.workspace.fs.writeFile(target, Buffer.from(paperSource(template.template, "references.bib"), "utf8"));
  try {
    await vscode.workspace.fs.stat(bib);
  } catch {
    await vscode.workspace.fs.writeFile(bib, Buffer.from(STARTER_BIB, "utf8"));
  }
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(directory, "figures"));
  await vscode.commands.executeCommand("vscode.open", target);
}
