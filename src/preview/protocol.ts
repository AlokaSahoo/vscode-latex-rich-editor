export type HostToPreviewMessage =
  | { type: "load"; url: string; workerUrl: string }
  | { type: "reveal"; page: number; x: number; y: number };

export type PreviewToHostMessage = { type: "inverseSearch"; page: number; x: number; y: number };
