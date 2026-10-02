import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Finds the TeX tools without any configuration: first on PATH, then in the
// standard install locations of MacTeX/TeX Live, TinyTeX and MiKTeX — VS Code
// launched from the Dock or Start menu often doesn't inherit the shell PATH.

export interface Toolchain {
  latexmk?: string;
  pdflatex?: string;
  bibtex?: string;
  /** Environment with the TeX bin folder on PATH, for spawning. */
  env: NodeJS.ProcessEnv;
  /** Folder the tools were found in when it isn't on PATH already. */
  addedToPath?: string;
}

const WINDOWS = process.platform === "win32";
const EXTENSIONS = WINDOWS ? [".exe", ".bat", ".cmd", ""] : [""];

function executable(dir: string, name: string): string | undefined {
  for (const extension of EXTENSIONS) {
    const file = path.join(dir, name + extension);
    try {
      if (fs.statSync(file).isFile()) return file;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

function subfolders(dir: string): string[] {
  try {
    return fs.readdirSync(dir).map((name) => path.join(dir, name)).sort().reverse(); // newest year first
  } catch {
    return [];
  }
}

function knownTexFolders(): string[] {
  const home = os.homedir();
  const texlive = (root: string) => subfolders(root).flatMap((year) => subfolders(path.join(year, "bin")));
  if (process.platform === "darwin") {
    return [
      "/Library/TeX/texbin",
      ...texlive("/usr/local/texlive"),
      ...subfolders(path.join(home, "Library/TinyTeX/bin")),
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/Applications/MiKTeX Console.app/Contents/bin",
    ];
  }
  if (WINDOWS) {
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    const programs = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean) as string[];
    return [
      path.join(local, "Programs", "MiKTeX", "miktex", "bin", "x64"),
      ...programs.map((p) => path.join(p, "MiKTeX", "miktex", "bin", "x64")),
      ...texlive("C:\\texlive"),
      ...subfolders(path.join(process.env.APPDATA ?? "", "TinyTeX", "bin")),
    ];
  }
  return ["/usr/bin", "/usr/local/bin", ...texlive("/usr/local/texlive"), ...subfolders(path.join(home, ".TinyTeX", "bin"))];
}

let cached: Toolchain | undefined;

export function resolveToolchain(refresh = false): Toolchain {
  if (cached && !refresh) return cached;
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
  const current = (process.env[pathKey] ?? "").split(path.delimiter).filter(Boolean);
  const env: NodeJS.ProcessEnv = { ...process.env };

  const find = (name: string) => {
    for (const dir of current) {
      const hit = executable(dir, name);
      if (hit) return { file: hit, dir, onPath: true };
    }
    for (const dir of knownTexFolders()) {
      const hit = executable(dir, name);
      if (hit) return { file: hit, dir, onPath: false };
    }
    return undefined;
  };

  const pdflatex = find("pdflatex");
  // Prefer tools from the same installation as pdflatex.
  const sibling = (name: string) => (pdflatex && executable(pdflatex.dir, name)) || find(name)?.file;
  const toolchain: Toolchain = { pdflatex: pdflatex?.file, latexmk: sibling("latexmk"), bibtex: sibling("bibtex"), env };
  if (pdflatex && !pdflatex.onPath) {
    env[pathKey] = [pdflatex.dir, ...current].join(path.delimiter);
    toolchain.addedToPath = pdflatex.dir;
  }
  cached = toolchain;
  return toolchain;
}

export function texDownload(): { name: string; url: string } {
  if (process.platform === "darwin") return { name: "MacTeX", url: "https://tug.org/mactex/" };
  if (WINDOWS) return { name: "MiKTeX", url: "https://miktex.org/download" };
  return { name: "TeX Live", url: "https://tug.org/texlive/" };
}
