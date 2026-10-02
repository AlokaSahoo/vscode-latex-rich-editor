import { EditorState } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { defaultKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { latex } from "codemirror-lang-latex";
import { DualLatexEditor, createImageResolver, imageResolver } from "codemirror-visual-markup";
import * as pdfjsLib from "pdfjs-dist";
import "codemirror-visual-markup/dist/styles.css";
// Math fonts declared in CSS (and MathLive told so) instead of MathLive
// fetching them at runtime relative to its script URL, which fails in VS Code
// webviews and left \mathcal, \mathbb, \mathfrak… as plain letters.
import "mathlive/fonts.css";
import "./editor.css";
import { applyLayout, modernizeToolbar, setLayoutSender } from "./toolbar";
import { followThemeChanges, isDarkTheme, themeExtension } from "./theme";
import {
  attachEnhancementsToDom,
  configureEnhancements,
  enhancementExtensions,
  restoreView,
  revealEquationSource,
  revealLine,
  setReferences,
  setVisualMode,
} from "./latexEnhancements";
import { editingHelpers, setDefinitionHandler } from "./editingHelpers";
import { errorExtensions, resolveFixes, setFixChannel, showErrors } from "./errors";
import type { HostToWebviewMessage, ImageKind, TextChange, ViewPosition, WebviewToHostMessage } from "./protocol";
import { resolveFigures, setFigureUploader, setImageLoader, setProjectData, smartExtensions } from "./smartFeatures";

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewToHostMessage): void;
};

const vscode = acquireVsCodeApi();

let applyingRemoteUpdate = false;
let view: EditorView | undefined;

function post(message: WebviewToHostMessage) {
  vscode.postMessage(message);
}

// CodeMirror's basicSetup minus its own undo history: the rich and raw views
// share one VS Code document, so undo/redo go to VS Code's undo stack.
const editorSetup = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    { key: "Mod-z", run: () => (post({ type: "undo" }), true), preventDefault: true },
    { key: "Mod-Shift-z", run: () => (post({ type: "redo" }), true), preventDefault: true },
    { key: "Mod-y", run: () => (post({ type: "redo" }), true), preventDefault: true },
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...foldKeymap,
    ...completionKeymap,
    indentWithTab,
  ]),
];

// Images are relative to the .tex file's own folder; the webview has no
// filesystem access, so path resolution is offloaded to the extension host,
// which also finds the file when the extension is omitted and reports
// whether it's a PDF (which an <img> can't show, so it's rasterized here).
let resolveRequestId = 0;
const pendingImageResolves = new Map<string, (result: { url: string | null; kind: ImageKind }) => void>();

const resolver = createImageResolver(
  () => "/document",
  async (resolvedPath) => {
    const { url, kind } = await new Promise<{ url: string | null; kind: ImageKind }>((resolve) => {
      const id = String(resolveRequestId++);
      pendingImageResolves.set(id, resolve);
      post({ type: "resolveImage", requestId: id, path: resolvedPath });
    });
    if (!url) return null;
    return kind === "pdf" ? rasterizePdf(url) : url;
  },
);

async function rasterizePdf(url: string): Promise<string | null> {
  try {
    const pdf = await pdfjsLib.getDocument(url).promise;
    const page = await pdf.getPage(1);
    const natural = page.getViewport({ scale: 1 });
    const scale = Math.min(4, Math.max(2, 1400 / natural.width));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d")!;
    // Figures are drawn on white paper; keep that in dark themes too.
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    await pdf.destroy();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    return blob ? `${URL.createObjectURL(blob)}#lr-pt=${natural.width.toFixed(2)}` : null;
  } catch {
    return null;
  }
}

// Send only what changed (in pre-change offsets), immediately, so the host
// applies small edits instead of replacing the whole document.
let cursorTimer: ReturnType<typeof setTimeout> | undefined;

function currentPosition(target: EditorView): ViewPosition {
  const head = target.state.selection.main.head;
  const line = target.state.doc.lineAt(head);
  const top = target.lineBlockAtHeight(target.scrollDOM.scrollTop);
  return {
    line: line.number - 1,
    character: head - line.from,
    topLine: target.state.doc.lineAt(Math.min(top.from, target.state.doc.length)).number - 1,
  };
}

function reportPosition(target: EditorView) {
  clearTimeout(cursorTimer);
  cursorTimer = setTimeout(() => post({ type: "cursor", position: currentPosition(target) }), 200);
}

const updateListener = EditorView.updateListener.of((update) => {
  if (update.docChanged && !applyingRemoteUpdate) {
    const changes: TextChange[] = [];
    update.changes.iterChanges((from, to, _fromB, _toB, inserted) => changes.push({ from, to, text: inserted.toString() }));
    post({ type: "changes", changes, baseLength: update.startState.doc.length });
  }
  if (update.selectionSet || update.docChanged) reportPosition(update.view);
});


function createEditor(message: Extract<HostToWebviewMessage, { type: "init" }>) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = message.pdfWorkerUrl;
  configureEnhancements(message.customCommands);
  setReferences(undefined, message.references);
  setProjectData(message.project);
  setImageLoader((resolvedPath, src) => resolver.resolve(resolvedPath, src));
  setFigureUploader((requestId, files, uris) => post({ type: "addFigures", requestId, files, uris }));
  setDefinitionHandler((target) => post({ type: "goToDefinition", ...target }));
  setFixChannel(
    (requestId, from, to) => post({ type: "requestFixes", requestId, from, to }),
    (requestId, index) => post({ type: "applyFix", requestId, index }),
  );
  applyLayout(message.pageWidth, message.pageAlign);
  // Apply immediately, then save as settings (which updates other open views).
  setLayoutSender((change) => {
    message = { ...message, ...change };
    applyLayout(message.pageWidth, message.pageAlign);
    post({ type: "setLayout", ...change });
  });

  const state = EditorState.create({
    doc: message.text,
    extensions: [
      editorSetup,
      latex({ enableAutocomplete: false }),
      updateListener,
      imageResolver.of(resolver),
      EditorView.lineWrapping,
      ...enhancementExtensions(),
      ...smartExtensions(),
      themeExtension(),
      errorExtensions(),
      ...editingHelpers(),
    ],
  });
  view = new EditorView({ state });
  // Keep the host's idea of the scroll position current for view switches.
  view.scrollDOM.addEventListener("scroll", () => view && reportPosition(view), { passive: true });
  const container = document.getElementById("editor")!;
  attachEnhancementsToDom(container);
  const editor = new DualLatexEditor(container, view, {
    initialMode: "visual",
    showToolbar: message.showToolbar,
    theme: isDarkTheme() ? "dark" : "light",
    onModeChange: (mode) => {
      container.classList.toggle("lr-source-mode", mode === "source");
      setVisualMode(view, mode === "visual");
    },
  });
  // Clicking a display equation edits its LaTeX (the \begin{equation} source)
  // rather than a math-field, which is how a LaTeX user expects to work.
  view.dom.addEventListener("click", (event) => revealEquationSource(view!, event), true);
  // Source and Visual lay the same text out at different heights; keep the
  // user at the same place across the switch.
  const switchMode = editor.setMode.bind(editor);
  editor.setMode = (mode) => {
    const position = currentPosition(view!);
    switchMode(mode);
    restoreView(view!, position);
  };
  modernizeToolbar(container);
  followThemeChanges(view, (dark) => editor.setTheme(dark ? "dark" : "light"));
}

function applyRemoteChanges(changes: TextChange[]) {
  if (!view) return;
  applyingRemoteUpdate = true;
  view.dispatch({ changes: changes.map((c) => ({ from: c.from, to: c.to, insert: c.text })) });
  applyingRemoteUpdate = false;
}

function applyRemoteText(text: string) {
  if (!view || view.state.doc.toString() === text) return;
  applyingRemoteUpdate = true;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
  applyingRemoteUpdate = false;
}

window.addEventListener("message", (event: MessageEvent<HostToWebviewMessage>) => {
  const message = event.data;
  switch (message.type) {
    case "init":
      createEditor(message);
      break;
    case "update":
      applyRemoteText(message.text);
      break;
    case "changes":
      applyRemoteChanges(message.changes);
      break;
    case "layout":
      applyLayout(message.pageWidth, message.pageAlign);
      break;
    case "fixes":
      resolveFixes(message.requestId, message.fixes);
      break;
    case "diagnostics":
      if (view) showErrors(view, message.items);
      break;
    case "imageResolved":
      pendingImageResolves.get(message.requestId)?.({ url: message.url, kind: message.kind });
      pendingImageResolves.delete(message.requestId);
      break;
    case "revealLine":
      if (view) revealLine(view, message.line);
      break;
    case "restoreView":
      if (view) restoreView(view, message.position);
      break;
    case "references":
      setReferences(view, message.references);
      break;
    case "project":
      setProjectData(message.project);
      break;
    case "figuresAdded":
      resolveFigures(message.requestId, message.paths);
      break;
  }
});

post({ type: "ready" });
