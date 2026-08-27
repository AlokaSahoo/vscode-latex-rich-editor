import { EditorView, basicSetup } from "codemirror";
import { EditorState } from "@codemirror/state";
import { latex } from "codemirror-lang-latex";
import {
  DualLatexEditor,
  createImageResolver,
  imageResolver,
  getLanguage,
} from "codemirror-visual-markup";
import "codemirror-visual-markup/dist/styles.css";
import type { CustomCommandStyle, HostToWebviewMessage, WebviewToHostMessage } from "./protocol";

const CUSTOM_STYLE_CLASS: Record<CustomCommandStyle, string> = {
  bold: "cm-lv-bold",
  italic: "cm-lv-italic",
  underline: "cm-lv-underline",
  reference: "cm-lv-cmd",
  hidden: "cm-lv-cmd-unknown",
};

// The library's LaTeX Language object is a shared singleton keyed by id
// ("latex"), retrieved internally by DualLatexEditor via getLanguage().
// There's no public hook to extend its command styling, so we patch its
// style() function once, before it's used, to check user config first.
function applyCustomCommandStyles(customCommands: Record<string, CustomCommandStyle>) {
  const language = getLanguage("latex");
  const originalStyle = language.style;
  language.style = (token) => {
    if (token.kind === "command" && token.name) {
      const category = customCommands[token.name];
      if (category === "hidden") return { hidden: true };
      if (category) return { class: CUSTOM_STYLE_CLASS[category] };
    }
    return originalStyle(token);
  };
}

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewToHostMessage): void;
};

const vscode = acquireVsCodeApi();

let applyingRemoteUpdate = false;
let view: EditorView;
let dualEditor: DualLatexEditor;

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
// which converts the relative path into a webview-loadable resource URI.
let resolveRequestId = 0;
const pendingImageResolves = new Map<string, (url: string | null) => void>();

const resolver = createImageResolver(
  () => "/document",
  (resolvedPath) =>
    new Promise<string | null>((resolve) => {
      const id = String(resolveRequestId++);
      pendingImageResolves.set(id, resolve);
      post({ type: "resolveImage", requestId: id, path: resolvedPath });
    }),
);

const updateListener = EditorView.updateListener.of((update) => {
  if (!update.docChanged || applyingRemoteUpdate) return;
  scheduleEditPost(update.state.doc.toString());
});

function isDarkTheme(): boolean {
  return (
    document.body.classList.contains("vscode-dark") ||
    document.body.classList.contains("vscode-high-contrast")
  );
}

function createEditor(initialText: string, customCommands: Record<string, CustomCommandStyle>) {
  applyCustomCommandStyles(customCommands);
  const state = EditorState.create({
    doc: initialText,
    extensions: [
      basicSetup,
      latex(),
      updateListener,
      imageResolver.of(resolver),
      EditorView.lineWrapping,
    ],
  });
  view = new EditorView({ state });
  const container = document.getElementById("editor")!;
  dualEditor = new DualLatexEditor(container, view, {
    initialMode: "visual",
    showToolbar: true,
    theme: isDarkTheme() ? "dark" : "light",
  });
}

function applyRemoteText(text: string) {
  if (!view) {
    createEditor(text, {});
    return;
  }
  if (view.state.doc.toString() === text) return;
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
      createEditor(message.text, message.customCommands);
      break;
    case "update":
      applyRemoteText(message.text);
      break;
    case "imageResolved":
      pendingImageResolves.get(message.requestId)?.(message.url);
      pendingImageResolves.delete(message.requestId);
      break;
  }
});

post({ type: "ready" });
