export type HostToPreviewMessage = { type: "load"; url: string; workerUrl: string };

export type PreviewToHostMessage = { type: "inverseSearch"; page: number; x: number; y: number };
