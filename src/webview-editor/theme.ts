import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

// CodeMirror's default highlighting is tuned for light backgrounds; in dark
// themes use VS Code's Dark+ token colors for the raw LaTeX parts.
const darkHighlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.heading], color: "#569cd6" },
    { tag: t.heading, fontWeight: "bold" },
    { tag: t.className, color: "#4ec9b0" },
    { tag: [t.string, t.meta], color: "#ce9178" },
    { tag: [t.number, t.atom, t.bool], color: "#b5cea8" },
    { tag: t.comment, color: "#6a9955", fontStyle: "italic" },
    { tag: [t.variableName, t.propertyName], color: "#9cdcfe" },
    { tag: [t.operator, t.processingInstruction], color: "#c586c0" },
    { tag: t.bracket, color: "#d4d4d4" },
    { tag: t.invalid, color: "#f44747" },
  ]),
);

const highlighting = new Compartment();

export function isDarkTheme(): boolean {
  return document.body.classList.contains("vscode-dark") || document.body.classList.contains("vscode-high-contrast");
}

export function themeExtension(): Extension {
  return highlighting.of(isDarkTheme() ? darkHighlighting : []);
}

/** VS Code swaps the body's theme class when the user changes theme; follow it live. */
export function followThemeChanges(view: EditorView, onChange: (dark: boolean) => void) {
  let dark = isDarkTheme();
  new MutationObserver(() => {
    if (isDarkTheme() === dark) return;
    dark = isDarkTheme();
    view.dispatch({ effects: highlighting.reconfigure(dark ? darkHighlighting : []) });
    onChange(dark);
  }).observe(document.body, { attributes: true, attributeFilter: ["class"] });
}
