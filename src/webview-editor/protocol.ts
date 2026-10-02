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
  message: string;
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
  | { type: "revealLine"; line: number };

export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "changes"; changes: TextChange[]; baseLength: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "cursor"; line: number }
  | { type: "resolveImage"; requestId: string; path: string }
  | {
      type: "addFigures";
      requestId: string;
      /** Pasted or dropped file contents, base64-encoded. */
      files: Array<{ name: string; data: string }>;
      /** Dropped file URIs (e.g. from the Explorer). */
      uris: string[];
    };
