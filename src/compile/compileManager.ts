import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";

export interface CompileResult {
  success: boolean;
  pdfPath: string;
}

export function createOutputChannel(): vscode.OutputChannel {
  return vscode.window.createOutputChannel("LaTeX Rich Editor");
}

export function compileDocument(
  document: vscode.TextDocument,
  outputChannel: vscode.OutputChannel,
  diagnostics: vscode.DiagnosticCollection,
): Promise<CompileResult> {
  return new Promise((resolve) => {
    const filePath = document.uri.fsPath;
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, ".tex");
    const pdfPath = path.join(dir, `${base}.pdf`);

    outputChannel.clear();
    outputChannel.appendLine(`Compiling ${filePath}...\n`);

    const proc = spawn(
      "latexmk",
      ["-pdf", "-interaction=nonstopmode", "-synctex=1", path.basename(filePath)],
      { cwd: dir },
    );

    let log = "";
    proc.stdout.on("data", (data) => {
      const text = data.toString();
      log += text;
      outputChannel.append(text);
    });
    proc.stderr.on("data", (data) => {
      const text = data.toString();
      log += text;
      outputChannel.append(text);
    });

    proc.on("error", (err) => {
      outputChannel.appendLine(`\nFailed to start latexmk: ${err.message}`);
      resolve({ success: false, pdfPath });
    });

    proc.on("close", (code) => {
      updateDiagnostics(document, log, diagnostics);
      outputChannel.appendLine(`\nlatexmk exited with code ${code}`);
      resolve({ success: code === 0, pdfPath });
    });
  });
}

function updateDiagnostics(
  document: vscode.TextDocument,
  log: string,
  diagnostics: vscode.DiagnosticCollection,
) {
  const diags: vscode.Diagnostic[] = [];
  // Standard LaTeX error format:
  //   ! <message>
  //   ...
  //   l.<line> <context>
  const errorPattern = /^! (.+)$/gm;
  let match: RegExpExecArray | null;
  while ((match = errorPattern.exec(log))) {
    const message = match[1];
    const rest = log.slice(match.index);
    const lineMatch = /\nl\.(\d+)/.exec(rest);
    const lineNumber = lineMatch
      ? Math.min(document.lineCount - 1, Math.max(0, parseInt(lineMatch[1], 10) - 1))
      : 0;
    diags.push(
      new vscode.Diagnostic(document.lineAt(lineNumber).range, message, vscode.DiagnosticSeverity.Error),
    );
  }
  diagnostics.set(document.uri, diags);
}
