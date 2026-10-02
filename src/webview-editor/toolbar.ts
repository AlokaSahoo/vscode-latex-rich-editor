import type { Extension } from "@codemirror/state";
import { DualVisualEditor } from "codemirror-visual-markup";
import "@vscode/codicons/dist/codicon.css";

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

function styleToolbar(root: HTMLElement) {
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
