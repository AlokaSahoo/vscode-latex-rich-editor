export type CustomCommandStyle = "bold" | "italic" | "underline" | "reference" | "hidden";

export type HostToWebviewMessage =
  | { type: "init"; text: string; customCommands: Record<string, CustomCommandStyle> }
  | { type: "update"; text: string }
  | { type: "imageResolved"; requestId: string; url: string | null };

export type WebviewToHostMessage =
  | { type: "ready" }
  | { type: "edit"; text: string }
  | { type: "resolveImage"; requestId: string; path: string };
