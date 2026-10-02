import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { latex } from "codemirror-lang-latex";
import { DualLatexEditor, createImageResolver, imageResolver } from "codemirror-visual-markup";
import * as pdfjsLib from "pdfjs-dist";
import "codemirror-visual-markup/dist/styles.css";
import "./editor.css";
import { modernizeToolbar } from "./toolbar";
import { followThemeChanges, isDarkTheme, themeExtension } from "./theme";
import {
  attachEnhancementsToDom,
  configureEnhancements,
  enhancementExtensions,
  revealLine,
  setReferences,
  setVisualMode,
} from "./latexEnhancements";
import type { HostToWebviewMessage, ImageKind, WebviewToHostMessage } from "./protocol";
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

let editTimer: ReturnType<typeof setTimeout> | undefined;
function scheduleEditPost(text: string) {
  clearTimeout(editTimer);
  editTimer = setTimeout(() => post({ type: "edit", text }), 150);
}

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

const updateListener = EditorView.updateListener.of((update) => {
  if (!update.docChanged || applyingRemoteUpdate) return;
  scheduleEditPost(update.state.doc.toString());
});


function createEditor(message: Extract<HostToWebviewMessage, { type: "init" }>) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = message.pdfWorkerUrl;
  configureEnhancements(message.customCommands);
  setReferences(undefined, message.references);
  setProjectData(message.project);
  setImageLoader((resolvedPath, src) => resolver.resolve(resolvedPath, src));
  setFigureUploader((requestId, files, uris) => post({ type: "addFigures", requestId, files, uris }));
  if (message.pageWidth > 0) {
    document.documentElement.style.setProperty("--lr-page-width", `${message.pageWidth}px`);
  }

  const state = EditorState.create({
    doc: message.text,
    extensions: [
      basicSetup,
      latex({ enableAutocomplete: false }),
      updateListener,
      imageResolver.of(resolver),
      EditorView.lineWrapping,
      ...enhancementExtensions(),
      ...smartExtensions(),
      themeExtension(),
    ],
  });
  view = new EditorView({ state });
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
  modernizeToolbar(container);
  followThemeChanges(view, (dark) => editor.setTheme(dark ? "dark" : "light"));
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
    case "imageResolved":
      pendingImageResolves.get(message.requestId)?.({ url: message.url, kind: message.kind });
      pendingImageResolves.delete(message.requestId);
      break;
    case "revealLine":
      if (view) revealLine(view, message.line);
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
