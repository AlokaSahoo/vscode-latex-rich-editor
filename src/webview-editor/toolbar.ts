import type { Extension } from "@codemirror/state";
import { DualVisualEditor } from "codemirror-visual-markup";
import "@vscode/codicons/dist/codicon.css";
import type { PageAlign } from "./protocol";

// The renderer's mode bar (Source / Visual / Show source / Math hover) is
// replaced by the extension's own raw ↔ rich toggle, so its shortcuts go too
// (they would also swallow VS Code keys like ⌘⇧M). Must run before the
// editor is constructed, since the keymap is installed in the constructor.
(DualVisualEditor.prototype as unknown as { keymap: () => Extension }).keymap = () => [];

interface ButtonLook {
  icon?: string;
  text?: string;
  className?: string;
  title: string;
}

const LOOKS: Record<string, ButtonLook> = {
  "latex-bold": { icon: "bold", title: "Bold — \\textbf" },
  "latex-italic": { icon: "italic", title: "Italic — \\textit" },
  "latex-underline": { text: "U", className: "lr-tb-underline", title: "Underline — \\underline" },
  "latex-mono": { icon: "code", title: "Monospace — \\texttt" },
  "latex-smallcaps": { text: "Sc", className: "lr-tb-smallcaps", title: "Small caps — \\textsc" },
  "latex-heading1": { text: "H1", className: "lr-tb-heading", title: "Section" },
  "latex-heading2": { text: "H2", className: "lr-tb-heading", title: "Subsection" },
  "latex-heading3": { text: "H3", className: "lr-tb-heading", title: "Subsubsection" },
  "latex-inlineMath": { text: "x", className: "lr-tb-math", title: "Inline math" },
  "latex-displayMath": { text: "Σ", className: "lr-tb-math", title: "Display math" },
  "latex-quote": { icon: "quote", title: "Quotation" },
  "latex-bullet-list": { icon: "list-unordered", title: "Bulleted list" },
  "latex-number-list": { icon: "list-ordered", title: "Numbered list" },
  "latex-table": { icon: "table", title: "Insert table" },
  "table-picker": { icon: "chevron-down", className: "lr-tb-picker", title: "Insert table of a chosen size" },
};

function styleButton(button: HTMLButtonElement) {
  const look = LOOKS[button.dataset.item ?? ""];
  if (!look || button.dataset.lrStyled) return;
  button.dataset.lrStyled = "1";
  button.title = look.title;
  button.setAttribute("aria-label", look.title);
  button.textContent = "";
  if (look.icon) {
    const icon = document.createElement("span");
    icon.className = `codicon codicon-${look.icon}`;
    button.appendChild(icon);
  } else {
    button.textContent = look.text ?? "";
  }
  if (look.className) button.classList.add(look.className);
}

// Color inputs become a letter (text color) or highlighter (background) with
// a bar showing the current color; the native picker stays on top, invisible.
function styleColorInput(input: HTMLInputElement) {
  if (input.dataset.lrStyled) return;
  input.dataset.lrStyled = "1";
  const text = input.dataset.color === "text";
  const wrapper = document.createElement("label");
  wrapper.className = "lr-tb-color";
  wrapper.title = text ? "Text color — \\textcolor" : "Highlight — \\colorbox";
  const glyph = document.createElement("span");
  glyph.className = text ? "lr-tb-color-glyph" : "codicon codicon-symbol-color";
  if (text) glyph.textContent = "A";
  const bar = document.createElement("span");
  bar.className = "lr-tb-color-bar";
  bar.style.background = input.value;
  input.addEventListener("input", () => (bar.style.background = input.value));
  input.replaceWith(wrapper);
  wrapper.append(glyph, bar, input);
}

// --- Page width / alignment controls (right end of the toolbar) ---------------

let layout = { pageWidth: 880, pageAlign: "center" as PageAlign };
let sendLayout: (change: { pageWidth?: number; pageAlign?: PageAlign }) => void = () => {};

/** Applies width/alignment to the page and remembers it for the buttons. */
export function applyLayout(pageWidth: number, pageAlign: PageAlign) {
  layout = { pageWidth, pageAlign };
  const root = document.documentElement;
  if (pageWidth > 0) root.style.setProperty("--lr-page-width", `${pageWidth}px`);
  else root.style.removeProperty("--lr-page-width");
  root.classList.toggle("lr-align-left", pageAlign === "left");
  document.querySelectorAll<HTMLElement>(".lr-layout-group button").forEach(updateLayoutButton);
}

export function setLayoutSender(send: typeof sendLayout) {
  sendLayout = send;
}

const LAYOUT_BUTTONS: Array<{ key: string; run: () => void }> = [
  { key: "align", run: () => sendLayout({ pageAlign: layout.pageAlign === "left" ? "center" : "left" }) },
  { key: "narrower", run: () => sendLayout({ pageWidth: Math.max(480, (layout.pageWidth || window.innerWidth) - 80) }) },
  { key: "wider", run: () => sendLayout({ pageWidth: Math.max(480, (layout.pageWidth || window.innerWidth) + 80) }) },
  { key: "full", run: () => sendLayout({ pageWidth: layout.pageWidth === 0 ? 880 : 0 }) },
];

function updateLayoutButton(button: HTMLElement) {
  const icon = button.firstElementChild as HTMLElement;
  switch (button.dataset.layout) {
    case "align":
      icon.className = "codicon codicon-layout-sidebar-left";
      button.title = layout.pageAlign === "left" ? "Center the page" : "Align the page to the left";
      button.classList.toggle("lr-tb-on", layout.pageAlign === "left");
      break;
    case "narrower":
      icon.className = "codicon codicon-remove";
      button.title = "Narrower page";
      break;
    case "wider":
      icon.className = "codicon codicon-add";
      button.title = "Wider page";
      break;
    case "full":
      icon.className = `codicon codicon-${layout.pageWidth === 0 ? "screen-normal" : "screen-full"}`;
      button.title = layout.pageWidth === 0 ? "Fixed page width" : "Use the full editor width";
      button.classList.toggle("lr-tb-on", layout.pageWidth === 0);
      break;
  }
  button.setAttribute("aria-label", button.title);
}

function addLayoutGroup(root: HTMLElement) {
  const items = root.querySelector(".lv-toolbar-items");
  if (!items || items.querySelector(".lr-layout-group")) return;
  const group = document.createElement("div");
  group.className = "lv-toolbar-group lr-layout-group";
  for (const spec of LAYOUT_BUTTONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.layout = spec.key;
    button.appendChild(document.createElement("span"));
    // Keep editor focus/selection; these don't edit the document.
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      spec.run();
    });
    updateLayoutButton(button);
    group.appendChild(button);
  }
  items.appendChild(group);
}

function styleToolbar(root: HTMLElement) {
  addLayoutGroup(root);
  root.querySelectorAll<HTMLButtonElement>(".lv-toolbar button[data-item]").forEach(styleButton);
  root.querySelectorAll<HTMLInputElement>(".lv-toolbar input[type=color]").forEach(styleColorInput);
  // Pair the size-picker chevron with the table button, like a split button.
  // (Clicks are handled by delegation on the toolbar, so moving it is safe.)
  const table = root.querySelector<HTMLElement>('.lv-toolbar button[data-item="latex-table"]');
  const picker = root.querySelector<HTMLElement>('.lv-toolbar button[data-item="table-picker"]');
  if (table && picker && table.nextElementSibling !== picker) table.after(picker);
}

/** Restyles the toolbar now and whenever it re-renders (e.g. entering a table adds row/column buttons). */
export function modernizeToolbar(root: HTMLElement) {
  styleToolbar(root);
  const host = root.querySelector(".lv-toolbar-host");
  if (host) new MutationObserver(() => styleToolbar(root)).observe(host, { childList: true, subtree: true });
}
