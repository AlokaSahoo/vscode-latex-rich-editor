type RGB = [number, number, number];

// xcolor's base colors (xcolor.sty). cyan/magenta/yellow are defined in CMYK,
// so in the PDF they show up as process inks; use the same on-screen values
// as the dvipsnames table below so the rich view matches the PDF preview.
const BASE: Record<string, RGB> = {
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  brown: [191, 128, 64],
  lime: [191, 255, 0],
  orange: [255, 128, 0],
  pink: [255, 191, 191],
  purple: [191, 0, 64],
  teal: [0, 128, 128],
  violet: [128, 0, 128],
  cyan: [0, 174, 239],
  magenta: [236, 0, 140],
  yellow: [255, 242, 0],
  olive: [128, 128, 0],
  black: [0, 0, 0],
  darkgray: [64, 64, 64],
  gray: [128, 128, 128],
  lightgray: [191, 191, 191],
  white: [255, 255, 255],
};

// xcolor's dvipsnames (CMYK in dvipsnam.def), as screen RGB — values from
// MathLive's table, which matches how PDF viewers render those CMYK inks.
const DVIPS: Record<string, string> = {
  Apricot: "#FBB982", Aquamarine: "#00B5BE", Bittersweet: "#C04F17", Black: "#221E1F",
  Blue: "#2D2F92", BlueGreen: "#00B3B8", BlueViolet: "#473992", BrickRed: "#B6321C",
  Brown: "#792500", BurntOrange: "#F7921D", CadetBlue: "#74729A", CarnationPink: "#F282B4",
  Cerulean: "#00A2E3", CornflowerBlue: "#41B0E4", Cyan: "#00AEEF", Dandelion: "#FDBC42",
  DarkOrchid: "#A4538A", Emerald: "#00A99D", ForestGreen: "#009B55", Fuchsia: "#8C368C",
  Goldenrod: "#FFDF42", Gray: "#949698", Green: "#00A64F", GreenYellow: "#DFE674",
  JungleGreen: "#00A99A", Lavender: "#F49EC4", LimeGreen: "#8DC73E", Magenta: "#EC008C",
  Mahogany: "#A9341F", Maroon: "#AF3235", Melon: "#F89E7B", MidnightBlue: "#006795",
  Mulberry: "#A93C93", NavyBlue: "#006EB8", OliveGreen: "#3C8031", Orange: "#F58137",
  OrangeRed: "#ED135A", Orchid: "#AF72B0", Peach: "#F7965A", Periwinkle: "#7977B8",
  PineGreen: "#008B72", Plum: "#92268F", ProcessBlue: "#00B0F0", Purple: "#99479B",
  RawSienna: "#974006", Red: "#ED1B23", RedOrange: "#F26035", RedViolet: "#A1246B",
  Rhodamine: "#EF559F", RoyalBlue: "#0071BC", RoyalPurple: "#613F99", RubineRed: "#ED017D",
  Salmon: "#F69289", SeaGreen: "#3FBC9D", Sepia: "#671800", SkyBlue: "#46C5DD",
  SpringGreen: "#C6DC67", Tan: "#DA9D76", TealBlue: "#00AEB3", Thistle: "#D883B7",
  Turquoise: "#00B4CE", Violet: "#58429B", VioletRed: "#EF58A0", White: "#FFFFFF",
  WildStrawberry: "#EE2967", Yellow: "#FFF200", YellowGreen: "#98CC70", YellowOrange: "#FAA21A",
};

export type ColorTable = Map<string, RGB>;

export function toCss([r, g, b]: RGB): string {
  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

// Resolves an xcolor expression: a name (document-defined, base, dvipsnames,
// or any CSS/svgnames name) optionally followed by `!pct!name` mixes, e.g.
// `red!30` (30% red in white) or `red!30!blue!50` (chained left to right).
export function resolveColor(expression: string, defined: ColorTable): RGB | null {
  const parts = expression.trim().split("!").map((p) => p.trim());
  let color = resolveName(parts[0], defined);
  if (!color) return null;
  for (let i = 1; i < parts.length; i += 2) {
    const pct = Number(parts[i]);
    if (!Number.isFinite(pct)) return null;
    const other = i + 1 < parts.length && parts[i + 1] ? resolveName(parts[i + 1], defined) : BASE.white;
    if (!other) return null;
    const t = Math.min(100, Math.max(0, pct)) / 100;
    color = [0, 1, 2].map((k) => color![k] * t + other[k] * (1 - t)) as RGB;
  }
  return color;
}

function resolveName(name: string, defined: ColorTable): RGB | null {
  if (!name) return null;
  if (name.startsWith("-")) {
    const base = resolveName(name.slice(1), defined);
    return base ? (base.map((v) => 255 - v) as RGB) : null;
  }
  const own = defined.get(name);
  if (own) return own;
  if (BASE[name]) return BASE[name];
  if (DVIPS[name]) return hex(DVIPS[name]);
  return cssNamed(name);
}

// svgnames/x11names are the CSS named colors (case-insensitive), so let the
// browser resolve anything we don't know rather than guessing.
let probe: HTMLElement | undefined;
const cssCache = new Map<string, RGB | null>();
function cssNamed(name: string): RGB | null {
  if (!/^[A-Za-z]+$/.test(name)) return null;
  const key = name.toLowerCase();
  if (cssCache.has(key)) return cssCache.get(key)!;
  probe ??= document.createElement("span");
  probe.style.color = "";
  probe.style.color = key;
  let result: RGB | null = null;
  if (probe.style.color) {
    document.body.appendChild(probe);
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(getComputedStyle(probe).color);
    probe.remove();
    if (m) result = [Number(m[1]), Number(m[2]), Number(m[3])];
  }
  cssCache.set(key, result);
  return result;
}

function hex(value: string): RGB {
  const v = value.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

// Converts an explicit model/spec pair, as used by \definecolor{name}{model}{spec}
// and \color[model]{spec}.
export function colorFromModel(model: string, spec: string, defined: ColorTable): RGB | null {
  const nums = spec.split(",").map((s) => Number(s.trim()));
  const ok = (n: number) => nums.length === n && nums.every(Number.isFinite);
  switch (model.trim()) {
    case "rgb":
      return ok(3) ? (nums.map((v) => v * 255) as RGB) : null;
    case "RGB":
      return ok(3) ? (nums as RGB) : null;
    case "HTML":
      return /^[0-9A-Fa-f]{6}$/.test(spec.trim()) ? hex(spec.trim()) : null;
    case "gray":
      return ok(1) ? [nums[0] * 255, nums[0] * 255, nums[0] * 255] : null;
    case "Gray":
      return ok(1) ? [(nums[0] * 255) / 15, (nums[0] * 255) / 15, (nums[0] * 255) / 15] : null;
    case "cmyk":
      return ok(4)
        ? ([0, 1, 2].map((i) => 255 * (1 - Math.min(1, nums[i] + nums[3]))) as RGB)
        : null;
    case "named":
      return resolveColor(spec, defined);
    default:
      return null;
  }
}

// Collects \definecolor / \colorlet definitions in document order.
export function collectDefinedColors(text: string): ColorTable {
  const defined: ColorTable = new Map();
  const pattern =
    /\\(?:definecolor|providecolor)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}\s*\{([^}]+)\}\s*\{([^}]+)\}|\\colorlet\s*\{([^}]+)\}\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g;
  for (const m of text.matchAll(pattern)) {
    if (m[1]) {
      const rgb = colorFromModel(m[2], m[3], defined);
      if (rgb) defined.set(m[1].trim(), rgb);
    } else if (m[4]) {
      const rgb = resolveColor(m[5], defined);
      if (rgb) defined.set(m[4].trim(), rgb);
    }
  }
  return defined;
}
