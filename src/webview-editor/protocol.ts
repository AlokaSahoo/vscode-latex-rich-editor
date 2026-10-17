import type { BibEntry, LabelInfo } from "../shared/latexText";

export type CustomCommandStyle = "bold" | "italic" | "underline" | "reference" | "hidden";

/** Labels from \input'ed files and bibliography entries, for completion and hovers. */
export interface ProjectData {
  externalLabels: LabelInfo[];
  bibliography: BibEntry[];
}

export type ImageKind = "image" | "pdf";

/** A replacement in offsets of the text *before* the whole change set. */
export interface TextChange {
  from: number;
  to: number;
  text: string;
}

export interface EditorDiagnostic {
  line: number; // 0-based
  /** Offsets of the flagged text; equal when the whole line is meant. */
  from: number;
  to: number;
  message: string;
  severity: "error" | "warning" | "info";
  source?: string;
}

/** Where the user is in a document, so the other view can open at the same spot. */
export interface ViewPosition {
  /** 0-based cursor line and column. */
  line: number;
  character: number;
  /** 0-based first line visible at the top of the view. */
  topLine: number;
}

export type PageAlign = "center" | "left";
/** "lines": every source line is a line; "paragraphs": lines flow together until a blank line, as when compiled. */
export type ViewMode = "lines" | "paragraphs";

export interface LayoutSettings {
  pageWidth: number;
  pageAlign: PageAlign;
  fontScale: number;
  viewMode: ViewMode;
  showComments: boolean;
}

export interface FixOption {
  index: number;
  title: string;
}

export interface ReferenceTable {
  labels: Record<string, { number: string; page: string; type?: string }>;
  citations: Record<string, string>;
}

export type HostToWebviewMessage =
  | {
      type: "init";
      text: string;
      customCommands: Record<string, CustomCommandStyle>;
      pageWidth: number;
      pageAlign: PageAlign;
      fontScale: number;
      viewMode: ViewMode;
      showComments: boolean;
      showToolbar: boolean;
      pdfWorkerUrl: string;
      references: ReferenceTable;
      project: ProjectData;
    }
  | { type: "update"; text: string }
  | { type: "changes"; changes: TextChange[] }
  | { type: "diagnostics"; items: EditorDiagnostic[] }
  | { type: "references"; references: ReferenceTable }
  | { type: "project"; project: ProjectData }
  | { type: "imageResolved"; requestId: string; url: string | null; kind: ImageKind }
  | { type: "figuresAdded"; requestId: string; paths: string[]; error?: string }
  | { type: "revealLine"; line: number }
  | { type: "restoreView"; position: ViewPosition }
  | ({ type: "layout" } & LayoutSettings)
  | { type: "fixes"; requestId: string; fixes: FixOption[] };

export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "changes"; changes: TextChange[]; baseLength: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "cursor"; position: ViewPosition }
  | ({ type: "setLayout" } & Partial<LayoutSettings>)
  | { type: "goToDefinition"; kind: "label" | "cite" | "file"; key: string }
  | { type: "requestFixes"; requestId: string; from: number; to: number }
  | { type: "applyFix"; requestId: string; index: number }
  | { type: "resolveImage"; requestId: string; path: string }
  | {
      type: "addFigures";
      requestId: string;
      /** Pasted or dropped file contents, base64-encoded. */
      files: Array<{ name: string; data: string }>;
      /** Dropped file URIs (e.g. from the Explorer). */
      uris: string[];
    };
