import * as vscode from "vscode";
import type { ProblemKind } from "../compile/compileManager";
import { resolveToolchain, texDownload } from "../toolchain";

/** Explains a toolchain problem and offers the one-click fix. */
export async function offerFix(problem: ProblemKind) {
  if (problem === "wrongArchitecture") {
    const choice = await vscode.window.showErrorMessage(
      "Your TeX programs are built for Intel Macs and need Rosetta to run on this Mac.",
      "Install Rosetta",
      `Get ${texDownload().name} (native)`,
    );
    if (choice === "Install Rosetta") {
      // Put the command in a terminal for the user to confirm with Enter.
      const terminal = vscode.window.createTerminal("Install Rosetta");
      terminal.show();
      terminal.sendText("softwareupdate --install-rosetta --agree-to-license", false);
    } else if (choice) {
      vscode.env.openExternal(vscode.Uri.parse(texDownload().url));
    }
    return;
  }
  const { name, url } = texDownload();
  const choice = await vscode.window.showErrorMessage(
    `No TeX installation was found, so the document can't be compiled. Install ${name}, then compile again — no other setup is needed.`,
    `Download ${name}`,
  );
  if (choice) vscode.env.openExternal(vscode.Uri.parse(url));
}

export function registerSetup(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand("latexRich.checkSetup", async () => {
      const tools = resolveToolchain(true);
      const lines = [
        `pdflatex: ${tools.pdflatex ?? "not found"}`,
        `latexmk: ${tools.latexmk ?? "not found (compiling uses pdflatex + BibTeX directly)"}`,
        `bibtex: ${tools.bibtex ?? "not found"}`,
      ];
      if (tools.addedToPath) lines.push(`Found outside VS Code's PATH, in ${tools.addedToPath} — used automatically.`);
      if (!tools.pdflatex) {
        await offerFix("notInstalled");
        return;
      }
      vscode.window.showInformationMessage(`LaTeX setup looks good. ${lines.join(" · ")}`, { modal: true });
    }),
  );
  void checkLatexWorkshop(context);
}

// LaTeX Workshop builds on every save by default; with both extensions that
// means two compilers fighting over the same files. Ask once.
async function checkLatexWorkshop(context: vscode.ExtensionContext) {
  if (!vscode.extensions.getExtension("James-Yu.latex-workshop")) return;
  if (context.globalState.get("latexWorkshopAsked")) return;
  const setting = vscode.workspace.getConfiguration("latex-workshop").get<string>("latex.autoBuild.run");
  if (setting === "never") return;
  await context.globalState.update("latexWorkshopAsked", true);
  const choice = await vscode.window.showInformationMessage(
    "LaTeX Workshop is also installed and compiles on every save. Turn off its automatic build so the two don't compile the same file at once? (You can still use its commands.)",
    "Turn Off Its Auto-Build",
    "Keep Both",
  );
  if (choice === "Turn Off Its Auto-Build") {
    await vscode.workspace
      .getConfiguration("latex-workshop")
      .update("latex.autoBuild.run", "never", vscode.ConfigurationTarget.Global);
  }
}
