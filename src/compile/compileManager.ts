import * as vscode from "vscode";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { resolveToolchain, type Toolchain } from "../toolchain";

export type ProblemKind = "notInstalled" | "wrongArchitecture";

export interface CompileResult {
  success: boolean;
  pdfPath: string;
  /** Set when the TeX toolchain itself couldn't run, as opposed to a LaTeX error. */
  problem?: ProblemKind;
}

function toolchainProblem(error: NodeJS.ErrnoException | undefined, log: string): ProblemKind | undefined {
  if (error?.code === "ENOENT") return "notInstalled";
  // macOS reports a wrong-architecture binary as errno 86 (EBADARCH).
  if (error?.errno === -86 || /bad CPU type/i.test(log)) return "wrongArchitecture";
  return undefined;
}

export function createOutputChannel(): vscode.OutputChannel {
  return vscode.window.createOutputChannel("LaTeX Rich Editor");
}

interface RunResult {
  code: number | null;
  log: string;
  error?: NodeJS.ErrnoException;
}

function run(command: string, args: string[], cwd: string, tools: Toolchain, output: vscode.OutputChannel): Promise<RunResult> {
  return new Promise((resolve) => {
    output.appendLine(`$ ${path.basename(command)} ${args.join(" ")}`);
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(command, args, { cwd, env: tools.env, shell: /\.(bat|cmd)$/i.test(command) });
    } catch (err) {
      // Some failures (e.g. a wrong-architecture binary) throw synchronously.
      resolve({ code: null, log: "", error: err as NodeJS.ErrnoException });
      return;
    }
    let log = "";
    const collect = (data: Buffer) => {
      const text = data.toString();
      log += text;
      output.append(text);
    };
    proc.stdout?.on("data", collect);
    proc.stderr?.on("data", collect);
    proc.on("error", (error: NodeJS.ErrnoException) => resolve({ code: null, log, error }));
    proc.on("close", (code) => resolve({ code, log }));
  });
}

// latexmk needs Perl, which MiKTeX on Windows doesn't ship; this does what it
// does for a typical paper: pdflatex, BibTeX if the paper cites a .bib, then
// pdflatex until cross-references stop changing.
export async function compileWithoutLatexmk(file: string, dir: string, tools: Toolchain, output: vscode.OutputChannel): Promise<RunResult> {
  const args = ["-interaction=nonstopmode", "-synctex=1", path.basename(file)];
  const base = path.basename(file, ".tex");
  let result = await run(tools.pdflatex!, args, dir, tools, output);
  if (result.error) return result;
  let log = result.log;

  const aux = path.join(dir, `${base}.aux`);
  const auxText = fs.existsSync(aux) ? fs.readFileSync(aux, "utf8") : "";
  if (tools.bibtex && /\\bibdata\{/.test(auxText)) {
    const bib = await run(tools.bibtex, [base], dir, tools, output);
    log += bib.log;
  }
  for (let pass = 0; pass < 3; pass++) {
    result = await run(tools.pdflatex!, args, dir, tools, output);
    log += result.log;
    if (!/Rerun to get|Label\(s\) may have changed|Rerun LaTeX/.test(result.log)) break;
  }
  return { ...result, log };
}

export async function compileDocument(
  document: vscode.TextDocument,
  output: vscode.OutputChannel,
  diagnostics: vscode.DiagnosticCollection,
): Promise<CompileResult> {
  const file = document.uri.fsPath;
  const dir = path.dirname(file);
  const pdfPath = path.join(dir, `${path.basename(file, ".tex")}.pdf`);
  const tools = resolveToolchain(true);

  output.clear();
  output.appendLine(`Compiling ${file}`);
  if (tools.addedToPath) output.appendLine(`(TeX found in ${tools.addedToPath}, which isn't on VS Code's PATH — using it directly)`);
  output.appendLine("");

  if (!tools.pdflatex && !tools.latexmk) return { success: false, pdfPath, problem: "notInstalled" };

  let result: RunResult;
  if (tools.latexmk) {
    result = await run(tools.latexmk, ["-pdf", "-interaction=nonstopmode", "-synctex=1", path.basename(file)], dir, tools, output);
    // latexmk is a Perl script; without Perl it can't run at all — fall back.
    const noPerl = result.error?.code === "ENOENT" || /perl.*(not found|not recognized)|could not find.*perl|script engine/i.test(result.log);
    if (noPerl && tools.pdflatex) {
      output.appendLine("\nlatexmk couldn't run (Perl is missing); compiling with pdflatex and BibTeX directly.\n");
      result = await compileWithoutLatexmk(file, dir, tools, output);
    }
  } else {
    result = await compileWithoutLatexmk(file, dir, tools, output);
  }

  if (result.error) {
    output.appendLine(`\nFailed to start: ${result.error.message}`);
    return { success: false, pdfPath, problem: toolchainProblem(result.error, result.log) ?? "notInstalled" };
  }
  updateDiagnostics(document, result.log, diagnostics);
  output.appendLine(`\nFinished with exit code ${result.code}`);
  return {
    success: result.code === 0 && fs.existsSync(pdfPath),
    pdfPath,
    problem: result.code === 0 ? undefined : toolchainProblem(undefined, result.log),
  };
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
