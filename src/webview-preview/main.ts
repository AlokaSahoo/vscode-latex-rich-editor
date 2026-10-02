import * as pdfjsLib from "pdfjs-dist";
import type { HostToPreviewMessage, PreviewToHostMessage } from "../preview/protocol";

declare function acquireVsCodeApi(): {
  postMessage(message: PreviewToHostMessage): void;
  getState(): { dark?: boolean } | undefined;
  setState(state: { dark?: boolean }): void;
};

const vscode = acquireVsCodeApi();
const container = document.getElementById("pages")!;
let renderGeneration = 0;

// Dark pages: a CSS invert + hue rotation on the rendered canvases, so text
// turns light while colors keep roughly their hue. Remembered per panel.
const toggle = document.getElementById("dark-toggle")!;
function setDark(dark: boolean) {
  document.body.classList.toggle("dark-pages", dark);
  toggle.title = dark ? "Show pages in original colors" : "Show pages dark";
  vscode.setState({ dark });
}
setDark(vscode.getState()?.dark ?? false);
toggle.addEventListener("click", () => setDark(!document.body.classList.contains("dark-pages")));

async function renderPdf(url: string, workerUrl: string) {
  const generation = ++renderGeneration;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjsLib.getDocument(url).promise;
  if (generation !== renderGeneration) return;

  // Render off-screen, then swap in, so a recompile doesn't flash the
  // preview blank or jump the scroll position back to the top.
  const scrollTop = document.scrollingElement?.scrollTop ?? 0;
  const pages = document.createDocumentFragment();
  const availableWidth = (container.clientWidth || 800) - 24;
  const ratio = window.devicePixelRatio || 1;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: availableWidth / natural.width });

    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page";
    canvas.dataset.page = String(pageNumber);
    canvas.dataset.widthPt = String(natural.width);
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    pages.appendChild(canvas);

    await page.render({
      canvasContext: canvas.getContext("2d")!,
      viewport,
      transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
    }).promise;
    if (generation !== renderGeneration) return;
  }

  container.replaceChildren(pages);
  if (document.scrollingElement) document.scrollingElement.scrollTop = scrollTop;
}

// Double-click → source: convert the click to PDF points from the page's
// top-left corner (the coordinate system SyncTeX uses).
container.addEventListener("dblclick", (event) => {
  const canvas = (event.target as HTMLElement).closest<HTMLCanvasElement>("canvas.pdf-page");
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const pointsPerPixel = Number(canvas.dataset.widthPt) / rect.width;
  vscode.postMessage({
    type: "inverseSearch",
    page: Number(canvas.dataset.page),
    x: (event.clientX - rect.left) * pointsPerPixel,
    y: (event.clientY - rect.top) * pointsPerPixel,
  });
});

window.addEventListener("message", (event: MessageEvent<HostToPreviewMessage>) => {
  const message = event.data;
  if (message.type === "load") {
    renderPdf(message.url, message.workerUrl).catch((err) => {
      container.textContent = `Failed to load PDF: ${err instanceof Error ? err.message : String(err)}`;
    });
  }
});
