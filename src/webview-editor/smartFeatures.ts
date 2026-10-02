import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import type { Extension } from "@codemirror/state";
import { EditorView, hoverTooltip } from "@codemirror/view";
import { latexCompletionSource } from "codemirror-lang-latex";
import { resolveImagePath } from "codemirror-visual-markup";
import { MathfieldElement } from "mathlive";
import {
  type BibEntry,
  CITE_COMMANDS,
  describeBibEntry,
  figureEnvironment,
  findLabels,
  LABEL_COMMANDS,
  type LabelInfo,
  OPEN_REFERENCE,
  REFERENCE_CALL,
} from "../shared/latexText";
import { currentReferences } from "./latexEnhancements";
import type { ProjectData } from "./protocol";

let project: ProjectData = { externalLabels: [], bibliography: [] };
let loadImage: (src: string) => Promise<string | null> = async () => null;

export function setProjectData(data: ProjectData) {
  project = data;
}

export function setImageLoader(loader: (resolvedPath: string, src: string) => Promise<string | null>) {
  loadImage = (src) => loader(resolveImagePath("/document", src), src);
}

const KIND_NAMES: Record<string, string> = {
  equation: "Equation",
  figure: "Figure",
  table: "Table",
  section: "Section",
  other: "Label",
};

function allLabels(view: EditorView | { state: EditorView["state"] }): LabelInfo[] {
  return [...findLabels(view.state.doc.toString()), ...project.externalLabels];
}

function labelHeading(label: LabelInfo): string {
  const number = currentReferences().labels[label.key]?.number;
  const name = KIND_NAMES[label.kind] ?? "Label";
  if (!number) return label.kind === "section" && label.context ? `Section: ${label.context}` : name;
  return label.kind === "equation" ? `${name} (${number})` : `${name} ${number}`;
}

// --- Completion of \ref / \eqref / \cite keys ----------------------------------

function referenceCompletions(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const open = OPEN_REFERENCE.exec(line.text.slice(0, context.pos - line.from));
  if (!open) return null;
  const [, command, typed] = open;
  const segment = typed.slice(typed.lastIndexOf(",") + 1).replace(/^\s+/, "");
  const from = context.pos - segment.length;

  if (CITE_COMMANDS.has(command)) {
    const numbers = currentReferences().citations;
    return {
      from,
      validFor: /^[^,}\s]*$/,
      options: project.bibliography.map((entry: BibEntry) => ({
        label: entry.key,
        detail: numbers[entry.key] ? `[${numbers[entry.key]}]` : entry.type,
        info: describeBibEntry(entry),
        type: "text",
      })),
    };
  }
  if (LABEL_COMMANDS.has(command)) {
    return {
      from,
      validFor: /^[^,}\s]*$/,
      options: allLabels(context).map((label) => ({
        label: label.key,
        detail: labelHeading(label),
        info: label.context || undefined,
        type: "variable",
        // \eqref almost always targets an equation; list those first.
        boost: command === "eqref" && label.kind === "equation" ? 10 : 0,
      })),
    };
  }
  return null;
}

// --- Hover previews -------------------------------------------------------------

const referenceHover = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos);
  for (const m of line.text.matchAll(REFERENCE_CALL)) {
    const start = line.from + m.index!;
    const end = start + m[0].length;
    if (pos < start || pos > end) continue;
    const command = m[1];
    if (!CITE_COMMANDS.has(command) && !LABEL_COMMANDS.has(command)) return null;
    const keys = m[2].split(",").map((k) => k.trim()).filter(Boolean);
    return {
      pos: start,
      end,
      above: true,
      create: () => ({ dom: CITE_COMMANDS.has(command) ? citeCard(keys) : labelCard(view, keys) }),
    };
  }
  return null;
});

function card(): HTMLElement {
  const dom = document.createElement("div");
  dom.className = "lr-hover";
  return dom;
}

function citeCard(keys: string[]): HTMLElement {
  const dom = card();
  const numbers = currentReferences().citations;
  for (const key of keys) {
    const entry = project.bibliography.find((e) => e.key === key);
    const row = document.createElement("div");
    row.className = "lr-hover-cite";
    const tag = document.createElement("strong");
    tag.textContent = numbers[key] ? `[${numbers[key]}] ` : `${key} `;
    row.append(tag, entry ? describeBibEntry(entry) : "Not found in the bibliography.");
    dom.appendChild(row);
  }
  return dom;
}

const MULTI_ROW = /^(align|flalign|alignat|eqnarray)\*?$/;
const GATHERED = /^(gather|multline)\*?$/;

function labelCard(view: EditorView, keys: string[]): HTMLElement {
  const dom = card();
  const labels = allLabels(view);
  for (const key of keys) {
    const label = labels.find((l) => l.key === key);
    const heading = document.createElement("div");
    heading.className = "lr-hover-heading";
    heading.textContent = label ? labelHeading(label) : `${key} — no \\label with this key`;
    dom.appendChild(heading);
    if (!label) continue;

    if (label.kind === "equation" && label.context) {
      const field = new MathfieldElement();
      field.readOnly = true;
      const env = label.environment ?? "equation";
      field.value = MULTI_ROW.test(env)
        ? `\\begin{aligned}${label.context}\\end{aligned}`
        : GATHERED.test(env)
          ? `\\begin{gathered}${label.context}\\end{gathered}`
          : label.context;
      field.className = "lr-hover-math";
      dom.appendChild(field);
    } else if (label.graphic) {
      const image = document.createElement("img");
      image.className = "lr-hover-image";
      image.alt = label.graphic;
      loadImage(label.graphic).then((url) => {
        if (url) image.src = url.replace(/#lr-pt=.*$/, "");
        else image.remove();
      });
      dom.appendChild(image);
    }
    if (label.context && label.kind !== "equation" && label.kind !== "section") {
      const caption = document.createElement("div");
      caption.className = "lr-hover-caption";
      caption.textContent = label.context;
      dom.appendChild(caption);
    }
  }
  return dom;
}

// --- Paste / drop images as figures --------------------------------------------

let figureRequestId = 0;
const pendingFigures = new Map<string, (paths: string[]) => void>();
let postFigures: (requestId: string, files: Array<{ name: string; data: string }>, uris: string[]) => void = () => {};

export function setFigureUploader(post: typeof postFigures) {
  postFigures = post;
}

export function resolveFigures(requestId: string, paths: string[]) {
  pendingFigures.get(requestId)?.(paths);
  pendingFigures.delete(requestId);
}

const IMAGE_NAME = /\.(png|jpe?g|pdf|eps|gif|svg|webp)$/i;

async function toBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function insertFigures(view: EditorView, files: File[], uris: string[], at: number) {
  const encoded = await Promise.all(
    files.map(async (file) => ({
      name: IMAGE_NAME.test(file.name) ? file.name : `image.${(file.type.split("/")[1] ?? "png").replace("jpeg", "jpg")}`,
      data: await toBase64(file),
    })),
  );
  const requestId = String(figureRequestId++);
  const paths = await new Promise<string[]>((resolve) => {
    pendingFigures.set(requestId, resolve);
    postFigures(requestId, encoded, uris);
  });
  if (paths.length === 0) return;

  // Put the figure on its own lines after the line where it was dropped.
  const line = view.state.doc.lineAt(Math.min(at, view.state.doc.length));
  const insertAt = line.text.trim() ? line.to : line.from;
  const prefix = line.text.trim() ? "\n" : "";
  const text = prefix + paths.map((p) => figureEnvironment(p, false)).join("\n");
  const captionAt = insertAt + text.indexOf("\\caption{") + "\\caption{".length;
  view.dispatch({ changes: { from: insertAt, insert: text }, selection: { anchor: captionAt } });
  view.focus();
}

const figureDrops = EditorView.domEventHandlers({
  paste(event, view) {
    const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith("image/") || IMAGE_NAME.test(f.name));
    if (files.length === 0) return false;
    event.preventDefault();
    void insertFigures(view, files, [], view.state.selection.main.head);
    return true;
  },
  dragover(event) {
    if (event.dataTransfer?.types.some((t) => t === "Files" || t === "text/uri-list" || t === "application/vnd.code.uri-list")) {
      event.preventDefault();
      return true;
    }
    return false;
  },
  drop(event, view) {
    const transfer = event.dataTransfer;
    if (!transfer) return false;
    const files = Array.from(transfer.files).filter((f) => f.type.startsWith("image/") || IMAGE_NAME.test(f.name));
    const uriText = transfer.getData("application/vnd.code.uri-list") || transfer.getData("text/uri-list");
    const uris = uriText.split(/\r?\n/).map((u) => u.trim()).filter((u) => u && !u.startsWith("#") && IMAGE_NAME.test(u));
    if (files.length === 0 && uris.length === 0) return false;
    event.preventDefault();
    const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
    // Prefer URIs: a file dragged from the Explorer can be referenced in place.
    void insertFigures(view, uris.length > 0 ? [] : files, uris, at);
    return true;
  },
});

// codemirror-lang-latex installs its completion with `override`, which hides
// every other source; so latex() is created with enableAutocomplete: false
// and both sources are registered together here instead.
export function smartExtensions(): Extension[] {
  return [
    autocompletion({ override: [referenceCompletions, latexCompletionSource(true)], activateOnTyping: true }),
    referenceHover,
    figureDrops,
  ];
}
