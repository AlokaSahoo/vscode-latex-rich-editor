import * as vscode from "vscode";
import { spawn } from "child_process";
import * as path from "path";

export interface CompileResult {
  success: boolean;
  pdfPath: string;
  /** Set when the TeX toolchain itself couldn't run, as opposed to a LaTeX error. */
  problem?: string;
}

const NOT_INSTALLED =
  "latexmk was not found on your PATH. Install a TeX distribution (TeX Live, MacTeX or MiKTeX) and restart VS Code.";
const WRONG_ARCHITECTURE =
  "Your TeX binaries are built for a different CPU (e.g. Intel builds on Apple Silicon without Rosetta). Install Rosetta (`softwareupdate --install-rosetta`) or a native TeX distribution such as MacTeX.";

function toolchainProblem(error: NodeJS.ErrnoException | undefined, log: string): string | undefined {
  if (error?.code === "ENOENT") return NOT_INSTALLED;
  // macOS reports a wrong-architecture binary as errno 86 (EBADARCH).
  if (error?.errno === -86 || /bad CPU type/i.test(log)) return WRONG_ARCHITECTURE;
  return undefined;
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

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn("latexmk", ["-pdf", "-interaction=nonstopmode", "-synctex=1", path.basename(filePath)], {
        cwd: dir,
      });
    } catch (err) {
      // Some failures (e.g. a wrong-architecture binary) throw synchronously
      // instead of emitting "error".
      const error = err as NodeJS.ErrnoException;
      outputChannel.appendLine(`Failed to start latexmk: ${error.message}`);
      resolve({ success: false, pdfPath, problem: toolchainProblem(error, "") ?? error.message });
      return;
    }

    let log = "";
    proc.stdout?.on("data", (data) => {
      const text = data.toString();
      log += text;
      outputChannel.append(text);
    });
    proc.stderr?.on("data", (data) => {
      const text = data.toString();
      log += text;
      outputChannel.append(text);
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      outputChannel.appendLine(`\nFailed to start latexmk: ${err.message}`);
      resolve({ success: false, pdfPath, problem: toolchainProblem(err, log) });
    });

    proc.on("close", (code) => {
      updateDiagnostics(document, log, diagnostics);
      outputChannel.appendLine(`\nlatexmk exited with code ${code}`);
      resolve({ success: code === 0, pdfPath, problem: code === 0 ? undefined : toolchainProblem(undefined, log) });
    });
  });
}

const AUXILIARY_EXTENSIONS = [
  ".aux", ".log", ".out", ".toc", ".lof", ".lot", ".loa", ".lol", ".fls", ".fdb_latexmk",
  ".bbl", ".blg", ".bcf", ".run.xml", ".synctex.gz", ".synctex", ".synctex(busy)",
  ".nav", ".snm", ".vrb", ".xdv", ".dvi", ".idx", ".ilg", ".ind", ".nlo", ".nls",
  ".glo", ".gls", ".glg", ".ist", ".acn", ".acr", ".alg", ".thm", ".spl",
];

// Only removes "<document name><known build extension>" next to the .tex
// file — never sources, bibliographies or the PDF.
export async function cleanAuxiliaryFiles(document: vscode.TextDocument): Promise<string[]> {
  const folder = vscode.Uri.joinPath(document.uri, "..");
  const base = path.posix.basename(document.uri.path).replace(/\.tex$/i, "");
  const removed: string[] = [];
  const remove = async (name: string) => {
    try {
      await vscode.workspace.fs.delete(vscode.Uri.joinPath(folder, name));
      removed.push(name);
    } catch {
      // not present
    }
  };
  for (const extension of AUXILIARY_EXTENSIONS) await remove(base + extension);

  // REVTeX regenerates "<name>Notes.bib" on every run; only delete it if it
  // really is REVTeX's generated file and not a bibliography someone wrote.
  const notes = vscode.Uri.joinPath(folder, `${base}Notes.bib`);
  try {
    const content = Buffer.from(await vscode.workspace.fs.readFile(notes)).toString("utf8");
    if (/REVTEX4\d*Control/.test(content)) await remove(`${base}Notes.bib`);
  } catch {
    // not present
  }
  return removed;
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
