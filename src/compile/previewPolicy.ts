export interface PreviewPolicyInput {
  /** The user asked for the PDF (the Open PDF Preview button). */
  requested: boolean;
  /** A preview panel is already open. */
  previewOpen: boolean;
  /** `latexRich.openPdfAfterCompile`. */
  autoOpen: boolean;
}

/** After a successful compile: whether to load the PDF into the preview, and whether it may take focus. */
export function previewAfterCompile({ requested, previewOpen, autoOpen }: PreviewPolicyInput): {
  show: boolean;
  quiet: boolean;
} {
  if (requested) return { show: true, quiet: false };
  if (previewOpen) return { show: true, quiet: true };
  return { show: autoOpen, quiet: false };
}

/** Compile status shown in the status bar. */
export type CompileState =
  | { kind: "idle" }
  | { kind: "compiling" }
  | { kind: "ok"; warnings: number }
  | { kind: "error"; errors: number };

export function statusText(state: CompileState): { text: string; tooltip: string } | undefined {
  switch (state.kind) {
    case "idle":
      return undefined;
    case "compiling":
      return { text: "$(sync~spin) LaTeX: compiling…", tooltip: "Compiling the paper" };
    case "ok":
      return {
        text: state.warnings > 0 ? `$(check) LaTeX: OK, ${state.warnings} warning${state.warnings === 1 ? "" : "s"}` : "$(check) LaTeX: OK",
        tooltip: "Compiled successfully — click to open the PDF preview",
      };
    case "error":
      return {
        text: `$(error) LaTeX: ${state.errors > 0 ? `${state.errors} error${state.errors === 1 ? "" : "s"}` : "failed"}`,
        tooltip: "Compile failed — click to show the Problems panel",
      };
  }
}
