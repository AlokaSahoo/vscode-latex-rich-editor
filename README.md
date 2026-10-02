# LaTeX Rich Editor

Overleaf-style rich-text (WYSIWYM) editing for `.tex` files in VS Code, with compile, PDF preview and PDF→source jumping built in. The file on disk always stays plain LaTeX — the rich view is a decoration layer over a real `vscode.TextDocument`, so it's fully git-diffable and works alongside any other LaTeX tooling.

## Features

- **Rich-text editing** — headings, bold/italic, lists, tables, colors and figures render inline as you type. Put the cursor in any element to edit its raw LaTeX; move away to see it typeset again (as in Overleaf's visual editor).
- **Math** — inline (`$…$`, `\(…\)`) and display (`$$…$$`, `\[…\]`, `equation`/`align`/…) math renders as live equations via [MathLive](https://cortexjs.io/mathlive/). Your own `\newcommand`/`\DeclareMathOperator` macros are used when rendering, and common physics commands (`\ket`, `\bra`, `\braket`, `\expval`, `\abs`, `\norm`, `\dd`, `\vb`, `\bm`) work out of the box.
- **Cross-references** — after a compile, `\ref`, `\eqref`, `\cref`/`\autoref`, `\pageref` and `\cite`/`\citep`/`\onlinecite` show the numbers the PDF shows ("Fig. 1", "(3)", "[2, 5]"), read from the `.aux` file. Click one to edit it; unresolved keys stay visible as keys.
- **Colors** — `\textcolor`, `\colorbox`, `\fcolorbox` and `{\color{…} …}` scopes, with xcolor base colors, `dvipsnames` (ForestGreen, RoyalBlue, …), svgnames, mixes like `red!30!blue`, and your own `\definecolor`/`\colorlet` colors.
- **Figures, sized like the paper** — `figure`, `figure*`, `subfigure` panels and `\subfloat` render in place, including **PDF figures** (and EPS via pdflatex's converted PDF). Widths follow `\linewidth`, `\columnwidth`, `\textwidth`, `scale=` and physical units, using the document class's real layout — e.g. in a two-column REVTeX `reprint`, a `\linewidth` figure is one column wide and a `figure*` spans the page. `\graphicspath` and extension-less file names are resolved like LaTeX does.
- **REVTeX front matter** — `\title`, `\author`, `\affiliation`, `\email`, `\date{\today}`, the `abstract` and `acknowledgments` environments are styled like the journal layout.
- **Typography** — `~`, `\%`, `--`/`---`, ``` ``…'' ``` and `\ldots` show as the typeset characters; `\label` inside equations is hidden.
- **Autocomplete for keys** — type `\ref{`, `\eqref{` or `\cite{` and pick from your labels (shown as "Figure 2", "Equation (3)" with the caption or formula) and your bibliography (`.bib` files and `thebibliography`), in both the rich and the raw editor.
- **Hover previews** — hover a `\ref`/`\eqref` to see the equation rendered or the figure with its caption; hover a `\cite` to see the reference.
- **Paste or drop images** — paste a screenshot or drop a PNG/PDF (hold <kbd>Shift</kbd> while dropping, as VS Code requires) and it's saved under `figures/` with a complete `figure` environment inserted, cursor in the caption. Images already inside the paper's folder are referenced in place, not copied.
- **LaTeX Outline** in the Explorer — sections, figures, tables and equations with their labels; click to jump. The raw editor also gets the standard Outline view and breadcrumbs.
- **Prepare arXiv Submission** — one command builds `<paper>-arxiv.zip`: sources with comments removed, only the figures actually used, the `.bbl` (arXiv doesn't run BibTeX) and any local `.cls`/`.sty`/`.bst`, with warnings for anything missing.
- **PRL length check** — counts the way the [APS length guide](https://journals.aps.org/authors/length-guide) does: text, captions and footnotes, plus 16 words per displayed-equation row (32 if two-column), 150/aspect + 20 per figure (300/(0.5·aspect) + 40 for `figure*`, aspect read from the image file), and 13 + 6.5/line per table. Title, authors, abstract, acknowledgments and references are excluded. PRL documents show a live count in the status bar.
- **New REVTeX Paper** — starts a PRL, PRB, PRX or single-column preprint with a starter `references.bib` and a `figures/` folder.
- **Compile** with `latexmk`; errors appear as VS Code Problems at the offending line.
- **PDF preview** beside the editor (moon button for dark pages), crisp on high-DPI screens, keeping its scroll position across recompiles. **Double-click the PDF** to jump to the matching source line — in the rich view or the raw editor, whichever you're using.
- **Clean auxiliary files** in one click.

## Getting started

No configuration is needed — there are no build recipes or tool paths to set up. The extension finds TeX by itself:

- It looks on your `PATH` and in the standard MacTeX / TeX Live / TinyTeX / MiKTeX install folders, so it works even when VS Code was started from the Dock or Start menu and doesn't see your shell's `PATH`.
- If `latexmk` can't run (e.g. MiKTeX on Windows without Perl), it compiles with `pdflatex` and BibTeX directly.
- If TeX is missing it offers a **Download** button for your OS; on Apple Silicon with Intel-only TeX it offers **Install Rosetta**.
- If LaTeX Workshop is installed it offers, once, to turn off LaTeX Workshop's build-on-save so they don't both compile.

So after installing: open a `.tex` file (or **LaTeX: New REVTeX Paper…**) and click ▶ **Compile**. **LaTeX: Check Setup** shows what was found.

### Troubleshooting

| Problem | Fix |
|---|---|
| "No TeX installation was found" | Click **Download** in the message, install, then compile again. |
| "TeX binaries are built for a different CPU" (Apple Silicon) | Run `softwareupdate --install-rosetta --agree-to-license`, or switch to MacTeX, which is native. |
| Windows: MiKTeX asks to install packages | In MiKTeX Console → Settings, set "Install missing packages" to **Always**. |
| Compile errors | They appear in the Problems panel (`⌘⇧M` / `Ctrl+Shift+M`); the full log is in Output → **LaTeX Rich Editor**. |
| `\ref`/`\cite` show keys instead of numbers | Compile once — the numbers come from the `.aux` file the compile writes. |
| Double-clicking the PDF does nothing | Compile again after **Clean Auxiliary Files**; the jump needs the `.synctex.gz` file. |
| `.tex` files open in the plain editor | Click the **Open Rich View** button (eye icon) or press `⌘⇧V` / `Ctrl+Shift+V`. |

### Using it alongside LaTeX Workshop

Both can be installed. This extension opens `.tex` files in the rich view by default; LaTeX Workshop keeps working in the raw view. To avoid two tools compiling the same file at once, either use only one extension's compile button, or turn off LaTeX Workshop's automatic build in your settings:

```json
"latex-workshop.latex.autoBuild.run": "never"
```

## Controls

The buttons in the editor's title bar work like Markdown's preview buttons:

| Button | Command | Shortcut (macOS / Windows·Linux) | Shown in |
|---|---|---|---|
| preview (eye) | **LaTeX: Open Rich View** | `⌘⇧V` / `Ctrl+Shift+V` | raw editor |
| `</>` | **LaTeX: Reopen as Raw LaTeX** | `⌘⇧V` / `Ctrl+Shift+V` | rich view |
| ▶ | **LaTeX: Compile** | — | both |
| split preview | **LaTeX: Open PDF Preview to the Side** (compiles first if there's no PDF yet) | `⌘K V` / `Ctrl+K V` | both |
| `…` menu | **LaTeX: Clean Auxiliary Files** | — | both |
| `…` menu | **LaTeX: Check PRL Length** (also the status-bar word count) | — | both |
| `…` menu | **LaTeX: Prepare arXiv Submission** | — | both |
| Command Palette | **LaTeX: New REVTeX Paper…** | — | anywhere |

`.tex` files open in the rich view by default. To make the plain text editor the default instead (and use `⌘⇧V` to switch to rich), add to your settings:

```json
"workbench.editorAssociations": { "*.tex": "default" }
```

Switching between the rich and raw views saves the file first, so the swap never asks about unsaved changes.

**Clean Auxiliary Files** removes only `<document name>.<build extension>` files next to the `.tex` (`.aux`, `.log`, `.fls`, `.fdb_latexmk`, `.synctex.gz`, `.bbl`, `.blg`, `.out`, `.toc`, …) plus REVTeX's generated `…Notes.bib` — never your sources, bibliographies or the PDF. Double-click-to-source needs the `.synctex.gz`, so compile again after cleaning.

## Requirements

A TeX distribution with `latexmk` on your `PATH` (TeX Live, MacTeX or MiKTeX). Rich editing works without one — only **Compile** needs it. On Apple Silicon, make sure your TeX binaries are native or that Rosetta is installed; the extension tells you if they can't run.

## Installation

One `.vsix` file works on macOS, Windows and Linux — no Node or npm needed to install it.

1. Download `latex-rich-editor-v0.1.2.vsix` (or the latest) from the [Releases page](https://github.com/AlokaSahoo/vscode-latex-rich-editor/releases).
2. Install it, either:
   - **In VS Code:** Extensions view (`⌘⇧X` / `Ctrl+Shift+X`) → `…` menu at the top → **Install from VSIX…** → pick the file, or
   - **From a terminal:** `code --install-extension latex-rich-editor-v0.1.2.vsix`
3. Reload VS Code. `.tex` files now open in the rich view.
4. For compiling, install a TeX distribution with `latexmk`: [MacTeX](https://tug.org/mactex/) on macOS, [MiKTeX](https://miktex.org/) or [TeX Live](https://tug.org/texlive/) on Windows, TeX Live on Linux (e.g. `sudo apt install texlive-full latexmk`).

To update, install the newer `.vsix` the same way.

**Remote-SSH / WSL / containers:** the extension runs where your files are, so install it on the remote side too: copy the `.vsix` over and run `code --install-extension <file>.vsix` in the remote window's integrated terminal. The remote machine needs the TeX distribution.

**Building it yourself:**

```bash
git clone https://github.com/AlokaSahoo/vscode-latex-rich-editor.git
cd vscode-latex-rich-editor
npm install
npx vsce package
```

**Publishing a release** (maintainers): bump `version` in `package.json`, commit, then `git tag v0.1.0 && git push origin v0.1.0` — the Release workflow builds the `.vsix` and attaches it to a GitHub Release.

### Spelling and grammar

The rich view doesn't spell-check yet. In the raw editor (**Reopen as Raw LaTeX**), extensions such as [LTeX+](https://marketplace.visualstudio.com/items?itemName=ltex-plus.vscode-ltex-plus) (spelling and grammar) or Code Spell Checker work as usual.

## Settings

| Setting | Default | |
|---|---|---|
| `latexRich.customCommands` | `{}` | Style commands the rich view doesn't recognize. Map a name (no backslash) to `bold`, `italic`, `underline`, `reference` or `hidden`, e.g. `{ "keyterm": "bold", "todo": "hidden" }`. |
| `latexRich.showToolbar` | `true` | Show the formatting toolbar above the rich view. |
| `latexRich.pageWidth` | `880` | Max width (px) of the rich view's text column, which stands in for `\textwidth` when sizing figures. `0` = full editor width. |

Both apply the next time a file is opened in the rich view.

## Roadmap

Ideas for making the rich view closer to the PDF, roughly in priority order:

1. **Forward search** — "Show in PDF" from the editor cursor (inverse search already works).
2. **Jump from Problems/search results into the rich view** — VS Code can't move the cursor inside a webview editor yet, so this needs its own handling.
3. **Incremental editing sync** — send changes instead of the whole document, for one shared undo history and speed on thesis-sized files.
4. **Multi-file projects** — `% !TEX root`, `\input`/`\include`, compiling the main file from a chapter.
5. **Live settings and theme** — apply setting and light/dark theme changes without reopening.
6. **Tables** — `ruledtabular`/`booktabs` styling, `\multicolumn`, column alignment from the preamble.
7. **Theorem-like environments** (`theorem`, `proof`, `definition`) and `\footnote` as hover popups.
8. **Engine and options** — choose `pdflatex`/`xelatex`/`lualatex`, compile on save, an output directory.
9. **Spell-check inside the rich view**, and tests plus CI.

## Development

```bash
npm install       # also applies patches/ via postinstall (see below)
npm run build     # one-off build
npm run watch     # rebuild on change
npx vsce package  # produce an installable .vsix
```

Press `F5` with this folder open to launch an Extension Development Host with `sample/` pre-opened — `sample/revtex-sample.tex` exercises colors, figures, subfigures, macros and references.

### Third-party library patch

The rich-rendering engine is [`codemirror-visual-markup`](https://github.com/TeXlyre/codemirror-visual-markup), an experimental library. It shipped with a bug where display-math delimiters that start with a backslash (`\[…\]`, `\(…\)`) never matched, because its fence scanner treated the closing delimiter's own backslash as an escape and skipped past it. `patches/codemirror-visual-markup+0.2.0.patch` fixes this and is applied automatically by `npm install` via `patch-package`.

## License

AGPL-3.0-or-later (see [LICENSE](LICENSE)). This is required by [`codemirror-lang-latex`](https://github.com/TeXlyre/codemirror-lang-latex), which the rich editor depends on for LaTeX syntax support — as a result, this extension as a whole must stay source-available under AGPL-compatible terms.

## Credits

Toolbar icons: [VS Code Codicons](https://github.com/microsoft/vscode-codicons), © Microsoft, licensed CC BY 4.0.
