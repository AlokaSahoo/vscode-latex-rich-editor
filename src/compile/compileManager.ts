import * as vscode from "vscode";
import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { findRootFile, magicComment } from "../rootFile";
import { type Engine, resolveToolchain, type Toolchain } from "../toolchain";

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
export async function compileWithoutLatexmk(
  file: string,
  dir: string,
  tools: Toolchain,
  output: vscode.OutputChannel,
  engine: Engine = "pdflatex",
): Promise<RunResult> {
  const tex = tools[engine] ?? tools.pdflatex!;
  const args = ["-interaction=nonstopmode", "-synctex=1", path.basename(file)];
  const base = path.basename(file, ".tex");
  let result = await run(tex, args, dir, tools, output);
  if (result.error) return result;
  let log = result.log;

  const aux = path.join(dir, `${base}.aux`);
  const auxText = fs.existsSync(aux) ? fs.readFileSync(aux, "utf8") : "";
  if (tools.bibtex && /\\bibdata\{/.test(auxText)) {
    const bib = await run(tools.bibtex, [base], dir, tools, output);
    log += bib.log;
  }
  for (let pass = 0; pass < 3; pass++) {
    result = await run(tex, args, dir, tools, output);
    log += result.log;
    if (!/Rerun to get|Label\(s\) may have changed|Rerun LaTeX/.test(result.log)) break;
  }
  return { ...result, log };
}

/** The file that actually gets compiled for this document (see rootFile.ts). */
export function rootOf(document: vscode.TextDocument): string {
  return document.uri.scheme === "file" ? findRootFile(document.uri.fsPath, document.getText()) : document.uri.fsPath;
}

export function pdfOf(document: vscode.TextDocument): string {
  return rootOf(document).replace(/\.tex$/i, ".pdf");
}

// "% !TEX program = xelatex" wins; otherwise packages that only work with
// Unicode engines pick xelatex; otherwise the configured default.
function chooseEngine(rootText: string, configured: string): Engine {
  const magic = magicComment(rootText, "program")?.toLowerCase();
  if (magic === "xelatex" || magic === "lualatex" || magic === "pdflatex") return magic;
  if (configured === "pdflatex" || configured === "xelatex" || configured === "lualatex") return configured;
  return /\\usepackage\s*(\[[^\]]*\])?\s*\{[^}]*\b(fontspec|unicode-math|polyglossia)\b/.test(rootText) ? "xelatex" : "pdflatex";
}

const LATEXMK_ENGINE: Record<Engine, string> = { pdflatex: "-pdf", xelatex: "-pdfxe", lualatex: "-pdflua" };

export async function compileDocument(
  document: vscode.TextDocument,
  output: vscode.OutputChannel,
  diagnostics: vscode.DiagnosticCollection,
): Promise<CompileResult> {
  const file = rootOf(document);
  const dir = path.dirname(file);
  const pdfPath = file.replace(/\.tex$/i, ".pdf");
  const tools = resolveToolchain(true);
  const rootText = fs.readFileSync(file, "utf8");
  const engine = chooseEngine(rootText, vscode.workspace.getConfiguration("latexRich", document.uri).get("engine", "auto"));

  output.clear();
  output.appendLine(`Compiling ${file} with ${engine}${file !== document.uri.fsPath ? ` (main file of ${path.basename(document.uri.fsPath)})` : ""}`);
  if (tools.addedToPath) output.appendLine(`(TeX found in ${tools.addedToPath}, which isn't on VS Code's PATH — using it directly)`);
  output.appendLine("");

  if (!tools[engine] && !tools.latexmk) return { success: false, pdfPath, problem: "notInstalled" };

  let result: RunResult;
  const args = [LATEXMK_ENGINE[engine], "-interaction=nonstopmode", "-synctex=1", path.basename(file)];
  if (tools.latexmk) {
    result = await run(tools.latexmk, args, dir, tools, output);
    // latexmk is a Perl script; without Perl it can't run at all — fall back.
    const noPerl = result.error?.code === "ENOENT" || /perl.*(not found|not recognized)|could not find.*perl|script engine/i.test(result.log);
    if (noPerl && tools[engine]) {
      output.appendLine(`\nlatexmk couldn't run (Perl is missing); compiling with ${engine} and BibTeX directly.\n`);
      result = await compileWithoutLatexmk(file, dir, tools, output, engine);
    }
  } else {
    result = await compileWithoutLatexmk(file, dir, tools, output, engine);
  }

  if (result.error) {
    output.appendLine(`\nFailed to start: ${result.error.message}`);
    return { success: false, pdfPath, problem: toolchainProblem(result.error, result.log) ?? "notInstalled" };
  }
  updateDiagnostics(file, result.log, diagnostics);
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

// Errors are reported against the file TeX was reading at the time: the last
// "(./path.tex" opened in the log before the error.
export function parseErrors(rootFile: string, log: string): Map<string, Array<{ line: number; message: string }>> {
  const dir = path.dirname(rootFile);
  const byFile = new Map<string, Array<{ line: number; message: string }>>();
  for (const m of log.matchAll(/^! (.+)$/gm)) {
    const before = log.slice(0, m.index);
    const opened = [...before.matchAll(/\((\.?\.?\/?[^\s()]+\.tex)/g)].pop()?.[1];
    const file = opened ? path.resolve(dir, opened) : rootFile;
    const lineMatch = /\nl\.(\d+)/.exec(log.slice(m.index));
    const entry = { line: lineMatch ? Math.max(0, Number(lineMatch[1]) - 1) : 0, message: m[1] };
    byFile.set(file, [...(byFile.get(file) ?? []), entry]);
  }
  return byFile;
}

function updateDiagnostics(rootFile: string, log: string, diagnostics: vscode.DiagnosticCollection) {
  diagnostics.clear();
  for (const [file, errors] of parseErrors(rootFile, log)) {
    diagnostics.set(
      vscode.Uri.file(file),
      errors.map((e) => new vscode.Diagnostic(new vscode.Range(e.line, 0, e.line, 1000), e.message, vscode.DiagnosticSeverity.Error)),
    );
  }
}
