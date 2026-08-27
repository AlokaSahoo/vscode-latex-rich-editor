# LaTeX Rich Editor

Overleaf-style rich-text (WYSIWYM) editing for `.tex` files in VS Code, with a compile pipeline and PDF preview built in. The file on disk always stays plain LaTeX source — the rich view is a decoration layer on top of a real `vscode.TextDocument`, not a separate format, so it's fully git-diffable and works with any other LaTeX tooling.

## Features

- **Rich-text editing** — headings, bold/italic, lists, tables, and figures render inline as you type, instead of showing raw LaTeX markup. Click into any element to edit its raw source; click away to see it typeset again.
- **Math rendering** — inline (`$...$`, `\(...\)`) and display (`$$...$$`, `\[...\]`, `equation`/`align`/etc. environments) math render as live, editable equations via [MathLive](https://cortexjs.io/mathlive/).
- **Figures and images** — `figure` environments and `\includegraphics` render the actual image, resolved relative to the `.tex` file.
- **Compile pipeline** — one-click compile via `latexmk`, with errors surfaced as VS Code Problems (Diagnostics) at the right line, and full log output in the "LaTeX Rich Editor" output channel.
- **PDF preview** — a side panel renders the compiled PDF (via `pdf.js`), refreshed after every successful compile.
- **Custom command styling** — map LaTeX commands the renderer doesn't know about by default (REVTeX's `\affiliation`, `\eqref`, your own macros, etc.) to a rendering style via settings — see [Custom command styling](#custom-command-styling) below.
- Opens as the **default editor** for `.tex` files — no extra menu step. You can still switch to VS Code's plain text editor any time via *Reopen Editor With... → Text Editor*.

## Requirements

A working TeX distribution with `latexmk`, `pdflatex`, and `synctex` available on your `PATH` (MacTeX, TeX Live, or MiKTeX all work). Rich-text editing itself doesn't need a TeX install — only **Compile** and **PDF Preview** do.

## Installation

This extension isn't published to a marketplace — install it from source as a `.vsix`:

```bash
git clone <this-repo-url>
cd vscode-latex-rich-editor
npm install
npm run build
npx vsce package
code --install-extension latex-rich-editor-0.0.1.vsix
```

Reload VS Code (or reopen it) afterward. To update later, pull the latest changes and repeat the last three commands.

## Usage

### Editing

Open any `.tex` file — it opens directly in the rich editor. A small mode bar sits above the text: **Source** / **Visual** toggles the whole document between raw LaTeX and the rich rendering; the toolbar next to it inserts headings, lists, tables, and colors.

Within visual mode, placing your cursor inside a rendered element (an equation, a heading, `\textbf{...}`) reveals its raw LaTeX for editing; moving the cursor away re-renders it. This matches Overleaf's own rich-text editor behavior.

### Compiling and previewing the PDF

Click the **▶ (Compile)** icon in the editor tab's title bar, or run **LaTeX Rich Editor: Compile** from the Command Palette (`⌘⇧P`). This runs `latexmk -pdf -synctex=1` in the document's folder:

- On success, a **PDF Preview** panel opens beside the editor.
- On failure, errors appear as red squiggles / Problems-panel entries at the offending line, and a notification points you at the output channel for the full `latexmk` log.

You can reopen the preview panel any time with **LaTeX Rich Editor: Show PDF Preview** (also available as a title-bar icon) without recompiling.

**Not yet implemented:** SyncTeX jump (click a spot in the editor or PDF and have the other side jump to match) is planned but not built. Multi-file projects (`\input`/`\include`) aren't specially handled yet either — each `.tex` file is treated independently.

### Custom command styling

The rich renderer recognizes common LaTeX commands (`\textbf`, `\section`, `\ref`, etc.) out of the box; anything else — REVTeX's `\affiliation`, `\eqref`, your own `\newcommand` macros — shows as plain, slightly muted raw markup rather than being specially styled. You can extend the recognized set via a VS Code setting:

```json
"latexRich.customCommands": {
  "eqref": "reference",
  "affiliation": "bold",
  "collaboration": "italic"
}
```

Valid styles: `bold`, `italic`, `underline`, `reference` (styled like `\ref`), `hidden` (concealed entirely). This is read once when a file is opened in the rich editor — changing the setting while a file is already open requires reopening it to take effect.

## Development

```bash
npm install       # also applies patches/ via postinstall (see below)
npm run build      # one-off build
npm run watch       # rebuild on change
npx vsce package     # produce an installable .vsix
```

Press `F5` in VS Code (with this folder open) to launch an Extension Development Host with `sample/` pre-opened, for iterating without repackaging each time.

### Third-party library patch

The rich-rendering engine is [`codemirror-visual-markup`](https://github.com/TeXlyre/codemirror-visual-markup), an experimental library. It shipped with a bug where display-math delimiters that start with a backslash (`\[...\]`, `\(...\)`) never matched, because its fence-scanner treated the closing delimiter's own leading backslash as a generic escape character and skipped past it. `patches/codemirror-visual-markup+0.2.0.patch` fixes this (checks for the close delimiter before the escape check) and is applied automatically by `npm install` via `patch-package`.

## License

AGPL-3.0-or-later (see [LICENSE](LICENSE)). This is required by [`codemirror-lang-latex`](https://github.com/TeXlyre/codemirror-lang-latex), which the rich editor depends on for LaTeX syntax support — as a result, this extension as a whole must stay source-available under AGPL-compatible terms.
