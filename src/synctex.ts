import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";

// Parses the .synctex(.gz) file written next to the PDF. Done in JS rather
// than shelling out to the `synctex` CLI so it works wherever the PDF does,
// even if the TeX binaries themselves aren't runnable on this machine.

type RecordType = "[" | "(" | "v" | "h" | "x" | "k" | "g" | "$";

interface SyncRecord {
  type: RecordType;
  input: number;
  line: number;
  // Big points (1/72 in), origin at the page's top-left corner, y downward.
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
}

export interface SyncData {
  inputs: Map<number, string>;
  pages: Map<number, SyncRecord[]>;
}

export interface SourceLocation {
  file: string;
  line: number;
}

const SP_PER_BP = 65781.76;
const RECORD = /^([[(vhxkg$])(\d+),(\d+):(-?\d+),(-?\d+)(?::(-?\d+)(?:,(-?\d+),(-?\d+))?)?/;

export function parseSynctex(content: string, baseDir: string): SyncData {
  const inputs = new Map<number, string>();
  const pages = new Map<number, SyncRecord[]>();
  let unit = 1;
  let magnification = 1000;
  let xOffset = 0;
  let yOffset = 0;
  let current: SyncRecord[] | undefined;

  for (const raw of content.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line.startsWith("Input:")) {
      const rest = line.slice("Input:".length);
      const sep = rest.indexOf(":");
      const tag = Number(rest.slice(0, sep));
      inputs.set(tag, path.resolve(baseDir, rest.slice(sep + 1)));
      continue;
    }
    if (!current) {
      if (line.startsWith("Unit:")) unit = Number(line.slice(5)) || 1;
      else if (line.startsWith("Magnification:")) magnification = Number(line.slice(14)) || 1000;
      else if (line.startsWith("X Offset:")) xOffset = Number(line.slice(9)) || 0;
      else if (line.startsWith("Y Offset:")) yOffset = Number(line.slice(9)) || 0;
    }
    if (line.startsWith("{")) {
      current = [];
      pages.set(Number(line.slice(1)), current);
      continue;
    }
    if (line.startsWith("}")) {
      current = undefined;
      continue;
    }
    if (!current) continue;
    const match = RECORD.exec(line);
    if (!match) continue;
    const scale = (unit * magnification) / 1000 / SP_PER_BP;
    current.push({
      type: match[1] as RecordType,
      input: Number(match[2]),
      line: Number(match[3]),
      x: (Number(match[4]) + xOffset) * scale,
      y: (Number(match[5]) + yOffset) * scale,
      width: match[6] !== undefined ? Number(match[6]) * scale : 0,
      height: match[7] !== undefined ? Number(match[7]) * scale : 0,
      depth: match[8] !== undefined ? Number(match[8]) * scale : 0,
    });
  }
  return { inputs, pages };
}

const cache = new Map<string, { mtimeMs: number; data: SyncData }>();

export function loadSynctex(pdfPath: string): SyncData | undefined {
  const base = pdfPath.replace(/\.pdf$/i, "");
  for (const candidate of [`${base}.synctex.gz`, `${base}.synctex`]) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(candidate);
    } catch {
      continue;
    }
    const cached = cache.get(candidate);
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.data;
    const buffer = fs.readFileSync(candidate);
    const text = candidate.endsWith(".gz") ? zlib.gunzipSync(buffer).toString("utf8") : buffer.toString("utf8");
    const data = parseSynctex(text, path.dirname(pdfPath));
    cache.set(candidate, { mtimeMs: stat.mtimeMs, data });
    return data;
  }
  return undefined;
}

// Maps a point on a PDF page back to a source line. Box records report the
// line where TeX finished the whole paragraph, and the first "x" record on a
// typeset line inherits that too; the inter-word glue/kern records ("g"/"k")
// carry the true source line of the word just before them. So: find the
// innermost box under the point, then take the nearest glue/kern at or to
// the right of the click on that baseline.
export function inverseSearch(data: SyncData, page: number, x: number, y: number): SourceLocation | undefined {
  const records = (data.pages.get(page) ?? []).filter((r) => r.line > 0 && isSourceFile(data.inputs.get(r.input)));
  if (records.length === 0) return undefined;

  const boxes = records.filter(
    (r) =>
      (r.type === "(" || r.type === "h") &&
      r.width > 0 &&
      x >= r.x &&
      x <= r.x + r.width &&
      y >= r.y - r.height - 2 &&
      y <= r.y + r.depth + 2,
  );
  boxes.sort((a, b) => a.width * (a.height + a.depth) - b.width * (b.height + b.depth));
  const box = boxes[0];

  let best: SyncRecord | undefined;
  if (box) {
    const onBaseline = records.filter(
      (r) => Math.abs(r.y - box.y) < 1 && r.x >= box.x - 1 && r.x <= box.x + box.width + 1,
    );
    const spacing = onBaseline.filter((r) => r.type === "g" || r.type === "k" || r.type === "$");
    best =
      nearest(spacing.filter((r) => r.x >= x), (r) => r.x - x) ??
      nearest(spacing, (r) => Math.abs(r.x - x)) ??
      nearest(onBaseline.filter((r) => r.type === "x"), (r) => Math.abs(r.x - x)) ??
      box;
  } else {
    // Vertical distance dominates: clicking beside a line should stay on it.
    best = nearest(records, (r) => Math.hypot(x - r.x, (y - r.y) * 4));
  }
  if (!best) return undefined;
  return { file: data.inputs.get(best.input)!, line: best.line };
}

function nearest(records: SyncRecord[], distance: (r: SyncRecord) => number): SyncRecord | undefined {
  let best: SyncRecord | undefined;
  let bestDistance = Infinity;
  for (const r of records) {
    const d = distance(r);
    if (d < bestDistance) {
      bestDistance = d;
      best = r;
    }
  }
  return best;
}

function isSourceFile(file: string | undefined): boolean {
  return !!file && /\.(tex|ltx|latex)$/i.test(file);
}
