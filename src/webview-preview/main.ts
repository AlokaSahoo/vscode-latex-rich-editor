import * as pdfjsLib from "pdfjs-dist";
import type { HostToPreviewMessage, PreviewToHostMessage } from "../preview/protocol";

interface PanelState {
  dark?: boolean;
  zoom?: number;
  fit?: "width" | "page";
}

declare function acquireVsCodeApi(): {
  postMessage(message: PreviewToHostMessage): void;
  getState(): PanelState | undefined;
  setState(state: PanelState): void;
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
  vscode.setState({ ...vscode.getState(), dark });
}
setDark(vscode.getState()?.dark ?? false);
toggle.addEventListener("click", () => setDark(!document.body.classList.contains("dark-pages")));

// Zoom: 1 = fit the panel's width. +/- buttons, the keyboard, or Ctrl/Cmd + wheel.
// "page" fits a whole page into the panel instead.
let zoom = vscode.getState()?.zoom ?? 1;
let fit: "width" | "page" | undefined = vscode.getState()?.fit;
let lastLoad: { url: string; workerUrl: string } | undefined;
const zoomLabel = document.getElementById("zoom-level")!;
const fitPage = document.getElementById("fit-page")!;
function showZoom() {
  zoomLabel.textContent = fit === "page" ? "Page" : `${Math.round(zoom * 100)}%`;
  fitPage.classList.toggle("on", fit === "page");
}
function setZoom(next: number, mode?: "width" | "page") {
  fit = mode;
  zoom = Math.min(4, Math.max(0.3, Math.round(next * 100) / 100));
  showZoom();
  vscode.setState({ ...vscode.getState(), zoom, fit });
  if (lastLoad) void renderPdf(lastLoad.url, lastLoad.workerUrl);
}
document.getElementById("zoom-in")!.addEventListener("click", () => setZoom(zoom * 1.15));
document.getElementById("zoom-out")!.addEventListener("click", () => setZoom(zoom / 1.15));
zoomLabel.addEventListener("click", () => setZoom(1, "width"));
fitPage.addEventListener("click", () => setZoom(zoom, fit === "page" ? undefined : "page"));
window.addEventListener(
  "wheel",
  (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom(event.deltaY < 0 ? zoom * 1.1 : zoom / 1.1);
  },
  { passive: false },
);
window.addEventListener("keydown", (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key === "=" || event.key === "+") setZoom(zoom * 1.15);
  else if (event.key === "-") setZoom(zoom / 1.15);
  else if (event.key === "0") setZoom(1, "width");
  else return;
  event.preventDefault();
});
showZoom();

// Pages are laid out as placeholders of the right size straight away and only
// drawn when they're near the viewport, so a long PDF shows its first page
// quickly instead of after every page has been rendered. Pages far from view
// release their bitmap again to keep memory flat.
const PAGE_GAP = 12;
let observer: IntersectionObserver | undefined;

interface PageSlot {
  canvas: HTMLCanvasElement;
  page: pdfjsLib.PDFPageProxy;
  viewport: pdfjsLib.PageViewport;
  state: "empty" | "queued" | "drawn";
}

async function renderPdf(url: string, workerUrl: string) {
  const generation = ++renderGeneration;
  // The spot at the top of the view, as a page and a fraction of its height,
  // so a zoom or recompile keeps reading position rather than a pixel offset.
  const anchor = captureAnchor();
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjsLib.getDocument(url).promise;
  if (generation !== renderGeneration) return;

  const ratio = window.devicePixelRatio || 1;
  const pages = await Promise.all(Array.from({ length: pdf.numPages }, (_, i) => pdf.getPage(i + 1)));
  if (generation !== renderGeneration) return;

  const fitWidth = (document.documentElement.clientWidth || 800) - 24;
  let scale = zoom;
  if (fit === "page") {
    const first = pages[0].getViewport({ scale: 1 });
    scale = Math.min(fitWidth / first.width, ((window.innerHeight || 800) - 24) / first.height) / (fitWidth / first.width);
  }
  const availableWidth = fitWidth * scale;

  const slots: PageSlot[] = pages.map((page, index) => {
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: availableWidth / natural.width });
    const canvas = document.createElement("canvas");
    canvas.className = "pdf-page";
    canvas.dataset.page = String(index + 1);
    canvas.dataset.widthPt = String(natural.width);
    // Size comes from CSS until the page is drawn, so thousands of pixels aren't allocated for pages nobody sees.
    canvas.width = 1;
    canvas.height = 1;
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
    canvas.style.height = "auto";
    canvas.style.maxWidth = "none";
    return { canvas, page, viewport, state: "empty" };
  });

  async function draw(slot: PageSlot) {
    if (slot.state === "drawn") return;
    const { canvas, page, viewport } = slot;
    // Draw into a fresh canvas so a half-finished render is never visible, then swap it in.
    const scratch = document.createElement("canvas");
    scratch.width = Math.floor(viewport.width * ratio);
    scratch.height = Math.floor(viewport.height * ratio);
    await page.render({
      canvasContext: scratch.getContext("2d")!,
      viewport,
      transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined,
    }).promise;
    if (generation !== renderGeneration || slot.state === "empty") return;
    canvas.width = scratch.width;
    canvas.height = scratch.height;
    canvas.getContext("2d")!.drawImage(scratch, 0, 0);
    slot.state = "drawn";
  }

  // One page at a time, nearest the viewport first as they get queued.
  const queue: PageSlot[] = [];
  let drawing = false;
  async function pump() {
    if (drawing) return;
    drawing = true;
    while (queue.length > 0 && generation === renderGeneration) {
      const slot = queue.shift()!;
      if (slot.state === "queued") await draw(slot).catch(() => (slot.state = "empty"));
    }
    drawing = false;
  }

  // Which pages the viewport shows, from the placeholder geometry (before they're in the page).
  const viewportHeight = window.innerHeight || 800;
  let scrollTop = document.scrollingElement?.scrollTop ?? 0;
  if (anchor && slots[anchor.page]) {
    let offset = PAGE_GAP;
    for (let i = 0; i < anchor.page; i++) offset += slots[i].viewport.height + PAGE_GAP;
    scrollTop = offset + anchor.fraction * slots[anchor.page].viewport.height;
  }
  let top = PAGE_GAP;
  const initial = slots.filter((slot) => {
    const height = slot.viewport.height;
    const visible = top + height > scrollTop - viewportHeight && top < scrollTop + 2 * viewportHeight;
    top += height + PAGE_GAP;
    return visible;
  });
  // Show those before swapping, so a recompile neither flashes blank nor jumps.
  for (const slot of initial) {
    slot.state = "queued";
    await draw(slot);
    if (generation !== renderGeneration) return;
  }

  observer?.disconnect();
  container.replaceChildren(...slots.map((slot) => slot.canvas));
  if (document.scrollingElement) document.scrollingElement.scrollTop = scrollTop;

  const bySlot = new Map(slots.map((slot) => [slot.canvas, slot]));
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const slot = bySlot.get(entry.target as HTMLCanvasElement)!;
        if (entry.isIntersecting) {
          if (slot.state === "empty") {
            slot.state = "queued";
            queue.push(slot);
          }
        } else if (slot.state === "drawn") {
          // Far from view: give the bitmap back.
          slot.canvas.width = 1;
          slot.canvas.height = 1;
          slot.state = "empty";
        } else if (slot.state === "queued") {
          slot.state = "empty";
        }
      }
      void pump();
    },
    { rootMargin: `${viewportHeight}px 0px` },
  );
  slots.forEach((slot) => observer!.observe(slot.canvas));

  if (pendingReveal) {
    const target = pendingReveal;
    pendingReveal = undefined;
    reveal(target);
  }
}

function captureAnchor(): { page: number; fraction: number } | undefined {
  const canvases = Array.from(container.querySelectorAll<HTMLCanvasElement>("canvas.pdf-page"));
  for (let i = 0; i < canvases.length; i++) {
    const rect = canvases[i].getBoundingClientRect();
    if (rect.bottom > 0) return { page: i, fraction: Math.min(1, Math.max(0, -rect.top / rect.height)) };
  }
  return undefined;
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

// Forward search: scroll the spot into view and flash a marker there.
let pendingReveal: { page: number; x: number; y: number } | undefined;
function reveal(target: { page: number; x: number; y: number }) {
  const canvas = container.querySelector<HTMLCanvasElement>(`canvas.pdf-page[data-page="${target.page}"]`);
  if (!canvas) {
    pendingReveal = target;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const scale = rect.width / Number(canvas.dataset.widthPt);
  const top = window.scrollY + rect.top + target.y * scale;
  window.scrollTo({ top: top - window.innerHeight / 3, behavior: "smooth" });
  const marker = document.createElement("div");
  marker.className = "sync-marker";
  marker.style.top = `${top - 14 * scale}px`;
  marker.style.left = `${window.scrollX + rect.left}px`;
  marker.style.width = `${rect.width}px`;
  marker.style.height = `${18 * scale}px`;
  document.body.appendChild(marker);
  setTimeout(() => marker.remove(), 1600);
}

window.addEventListener("message", (event: MessageEvent<HostToPreviewMessage>) => {
  const message = event.data;
  if (message.type === "reveal") {
    reveal(message);
    return;
  }
  if (message.type === "load") {
    lastLoad = { url: message.url, workerUrl: message.workerUrl };
    renderPdf(message.url, message.workerUrl).catch((err) => {
      container.textContent = `Failed to load PDF: ${err instanceof Error ? err.message : String(err)}`;
    });
  }
});

// "Fit page" and a resized panel: refit when the panel's size settles.
let resizeTimer: ReturnType<typeof setTimeout> | undefined;
let lastWidth = window.innerWidth;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    if (!lastLoad || window.innerWidth === lastWidth && fit !== "page") return;
    lastWidth = window.innerWidth;
    void renderPdf(lastLoad.url, lastLoad.workerUrl);
  }, 250);
});
