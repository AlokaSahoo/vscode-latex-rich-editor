import * as pdfjsLib from "pdfjs-dist";
import type { HostToPreviewMessage } from "../preview/protocol";

const container = document.getElementById("pages")!;

async function renderPdf(url: string, workerUrl: string) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  container.innerHTML = "";
  const loadingTask = pdfjsLib.getDocument(url);
  const pdf = await loadingTask.promise;
  const containerWidth = container.clientWidth || 800;

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const unscaledViewport = page.getViewport({ scale: 1 });
    const scale = containerWidth / unscaledViewport.width;
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page";
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    container.appendChild(canvas);

    const context = canvas.getContext("2d")!;
    await page.render({ canvasContext: context, viewport }).promise;
  }
}

window.addEventListener("message", (event: MessageEvent<HostToPreviewMessage>) => {
  const message = event.data;
  if (message.type === "load") {
    renderPdf(message.url, message.workerUrl).catch((err) => {
      container.textContent = `Failed to load PDF: ${err instanceof Error ? err.message : String(err)}`;
    });
  }
});
