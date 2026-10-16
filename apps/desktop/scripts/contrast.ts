// Measures WCAG contrast for the token pairs the UI relies on and writes src/styles/CONTRAST.md.
// Run from apps/desktop: pnpm exec tsx scripts/contrast.ts
// Gradients are measured at their darkest and lightest stops; grain is composited from the real tile at --grain-opacity.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { inflateSync } from "node:zlib";

const root = resolve(import.meta.dirname, "..");
const css = readFileSync(resolve(root, "src/styles/tokens.css"), "utf8");

type Scheme = Record<string, string>;
type Numbers = Record<string, number>;

/** Every `:root { }` block in source order, tagged dark when it sits inside the dark media query. */
function rootBlocks(text: string): { body: string; dark: boolean }[] {
  const out: { body: string; dark: boolean }[] = [];
  const darkRanges: [number, number][] = [];
  for (const m of text.matchAll(/@media \(prefers-color-scheme: dark\)\s*\{/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < text.length && depth > 0) {
      if (text[i] === "{") depth += 1;
      else if (text[i] === "}") depth -= 1;
      i += 1;
    }
    darkRanges.push([m.index, i]);
  }
  for (const m of text.matchAll(/:root\s*\{([^}]*)\}/g)) {
    const dark = darkRanges.some(([a, b]) => m.index > a && m.index < b);
    out.push({ body: m[1]!, dark });
  }
  return out;
}

function parseHex(text: string): Scheme {
  const out: Scheme = {};
  for (const m of text.matchAll(/--([a-z0-9_-]+):\s*(#[0-9a-f]{6})\s*;/gi)) out[m[1]!] = m[2]!.toLowerCase();
  return out;
}

function parseNumbers(text: string): Numbers {
  const out: Numbers = {};
  for (const m of text.matchAll(/--([a-z0-9_-]+):\s*(-?\d*\.?\d+)\s*;/g)) out[m[1]!] = Number(m[2]);
  return out;
}

const light: Scheme = {};
const dark: Scheme = {};
const lightNumbers: Numbers = {};
const darkNumbers: Numbers = {};
// Source order is the cascade: an unscoped :root block applies to both schemes and overrides any dark block above it.
for (const block of rootBlocks(css)) {
  const hex = parseHex(block.body);
  const numbers = parseNumbers(block.body);
  if (!block.dark) {
    Object.assign(light, hex);
    Object.assign(lightNumbers, numbers);
  }
  Object.assign(dark, hex);
  Object.assign(darkNumbers, numbers);
}

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
}

function hex(c: readonly number[]): string {
  return `#${c.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** `fg` over `bg` at alpha, normal blending. */
function over(bg: string, fg: string, alpha: number): string {
  const b = rgb(bg);
  const f = rgb(fg);
  return hex(b.map((v, i) => v * (1 - alpha) + f[i]! * alpha));
}

/** A grey grain pixel (0..1) at alpha over `bg` with the given blend mode. */
function grain(bg: string, grey: number, alpha: number, blend: "multiply" | "screen"): string {
  const b = rgb(bg);
  return hex(b.map((v) => v * (1 - alpha) + (blend === "multiply" ? v * grey : 1 - (1 - v) * (1 - grey)) * alpha));
}

/** Decodes an 8-bit RGBA or RGB PNG (non-interlaced) and returns the grey range and the peak alpha, 0..1. */
function tileStats(path: string): { darkest: number; lightest: number; peakAlpha: number } {
  const data = readFileSync(path);
  let pos = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat: Buffer[] = [];
  while (pos < data.length) {
    const len = data.readUInt32BE(pos);
    const type = data.toString("ascii", pos + 4, pos + 8);
    const body = data.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[12] !== 0) throw new Error(`${path}: expected 8-bit non-interlaced PNG`);
      channels = body[9] === 6 ? 4 : body[9] === 2 ? 3 : 0;
      if (channels === 0) throw new Error(`${path}: expected RGB or RGBA`);
    } else if (type === "IDAT") idat.push(body);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  let prev = Buffer.alloc(stride);
  let darkest = 1;
  let lightest = 0;
  let peakAlpha = channels === 4 ? 0 : 1;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]!;
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? line[x - channels]! : 0;
      const b = prev[x]!;
      const c = x >= channels ? prev[x - channels]! : 0;
      let p = 0;
      if (filter === 1) p = a;
      else if (filter === 2) p = b;
      else if (filter === 3) p = (a + b) >> 1;
      else if (filter === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a);
        const pb = Math.abs(q - b);
        const pc = Math.abs(q - c);
        p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = (line[x]! + p) & 255;
    }
    for (let x = 0; x < stride; x += channels) {
      const grey = line[x]! / 255;
      darkest = Math.min(darkest, grey);
      lightest = Math.max(lightest, grey);
      if (channels === 4) peakAlpha = Math.max(peakAlpha, line[x + 3]! / 255);
    }
    prev = line;
  }
  return { darkest, lightest, peakAlpha };
}

const tile = tileStats(resolve(root, "brand/mineral/grain/grain-overlay.png"));

/** Composited colours the table measures against, per scheme: the gradient stops with the worst grain pixel, a spiral line, the front dune. */
function derived(scheme: Scheme, numbers: Numbers, blend: "multiply" | "screen"): Scheme {
  const alpha = tile.peakAlpha * (numbers["grain-opacity"] ?? 0);
  const stops = [scheme["gradient-canvas-start"]!, scheme["gradient-canvas-end"]!];
  const darkestStop = stops.sort((a, b) => luminance(a) - luminance(b))[0]!;
  const lightestStop = stops[1]!;
  return {
    "canvas-darkest": grain(darkestStop, tile.darkest, alpha, blend),
    "canvas-lightest": grain(lightestStop, tile.lightest, alpha, blend),
    "canvas-spiral": over(darkestStop, scheme["hero-spiral-stroke"]!, numbers["hero-spiral-opacity"] ?? 0),
    "horizon-front": over(scheme["horizon-1"]!, scheme["horizon-2"]!, 0.5),
  };
}
Object.assign(light, derived(light, lightNumbers, "multiply"));
Object.assign(dark, derived(dark, darkNumbers, "screen"));

/** [foreground, background, minimum] with the AA floor for the use: 4.5 text, 3 icons, meters, rings, borders. */
const PAIRS: readonly (readonly [string, string, number])[] = [
  ["fg", "bg-canvas", 4.5], ["fg", "bg-elevated", 4.5], ["fg", "bg-inset", 4.5], ["fg", "bg-sidebar", 4.5], ["fg", "bg-hover", 4.5], ["fg", "bg-pressed", 4.5],
  ["fg-secondary", "bg-canvas", 4.5], ["fg-secondary", "bg-elevated", 4.5], ["fg-secondary", "bg-inset", 4.5], ["fg-secondary", "bg-sidebar", 4.5], ["fg-secondary", "bg-hover", 4.5],
  ["fg-tertiary", "bg-canvas", 3], ["fg-tertiary", "bg-elevated", 3],
  ["accent", "bg-canvas", 4.5], ["accent", "bg-elevated", 4.5], ["accent-hover", "bg-canvas", 4.5],
  ["accent-fg", "accent", 4.5], ["accent-fg", "accent-hover", 4.5],
  ["accent", "bg-canvas", 3], ["accent", "bg-elevated", 3],
  ["focus", "bg-canvas", 3], ["focus", "bg-elevated", 3], ["focus", "bg-sidebar", 3], ["focus", "bg-inset", 3],
  ["border-strong", "bg-canvas", 3], ["border-strong", "bg-elevated", 3],
  ["brand-mark", "bg-canvas", 3], ["brand-mark", "bg-sidebar", 3],
  ["success-fg", "bg-canvas", 4.5], ["success-fg", "bg-elevated", 4.5], ["success-fg", "bg-inset", 4.5],
  ["notice-fg", "notice-bg", 4.5], ["notice-fg", "bg-canvas", 4.5], ["notice-fg", "bg-elevated", 4.5],
  ["danger", "bg-canvas", 4.5], ["danger", "bg-elevated", 4.5], ["danger-fg", "danger", 4.5],
  ["sev-critical-fg", "sev-critical-bg", 4.5], ["sev-critical-fg", "bg-elevated", 4.5], ["sev-critical-fg", "bg-canvas", 4.5],
  ["sev-high-fg", "sev-high-bg", 4.5], ["sev-high-fg", "bg-elevated", 4.5], ["sev-high-fg", "bg-canvas", 4.5],
  ["sev-medium-fg", "sev-medium-bg", 4.5], ["sev-medium-fg", "bg-elevated", 4.5], ["sev-medium-fg", "bg-canvas", 4.5],
  ["sev-low-fg", "sev-low-bg", 4.5], ["sev-low-fg", "bg-elevated", 4.5], ["sev-low-fg", "bg-canvas", 4.5],
  ["sev-info-fg", "sev-info-bg", 4.5], ["sev-info-fg", "bg-elevated", 4.5], ["sev-info-fg", "bg-canvas", 4.5],
  ["grade-good", "bg-elevated", 4.5], ["grade-fair", "bg-elevated", 4.5], ["grade-poor", "bg-elevated", 4.5], ["grade-at_risk", "bg-elevated", 4.5],
  ["grade-good", "grade-good-track", 3], ["grade-fair", "grade-fair-track", 3], ["grade-poor", "grade-poor-track", 3], ["grade-at_risk", "grade-at_risk-track", 3],
  ["grade-good", "bg-canvas", 3], ["grade-fair", "bg-canvas", 3], ["grade-poor", "bg-canvas", 3], ["grade-at_risk", "bg-canvas", 3],
  ["grade-good", "bg-elevated", 3], ["grade-fair", "bg-elevated", 3], ["grade-poor", "bg-elevated", 3], ["grade-at_risk", "bg-elevated", 3],
  // Warmth pass: text on the canvas gradient at both stops, with the worst grain pixel composited at --grain-opacity.
  ["fg", "canvas-darkest", 4.5], ["fg", "canvas-lightest", 4.5],
  ["fg-secondary", "canvas-darkest", 4.5], ["fg-secondary", "canvas-lightest", 4.5],
  ["fg-tertiary", "canvas-darkest", 3], ["fg-tertiary", "canvas-lightest", 3],
  ["accent", "canvas-darkest", 4.5], ["accent", "canvas-lightest", 4.5], ["accent-hover", "canvas-darkest", 4.5],
  ["success-fg", "canvas-darkest", 4.5], ["notice-fg", "canvas-darkest", 4.5], ["danger", "canvas-darkest", 4.5],
  ["sev-critical-fg", "canvas-darkest", 4.5], ["sev-high-fg", "canvas-darkest", 4.5], ["sev-medium-fg", "canvas-darkest", 4.5],
  ["sev-low-fg", "canvas-darkest", 4.5], ["sev-info-fg", "canvas-darkest", 4.5],
  ["grade-good", "canvas-darkest", 3], ["grade-fair", "canvas-darkest", 3], ["grade-poor", "canvas-darkest", 3], ["grade-at_risk", "canvas-darkest", 3],
  ["focus", "canvas-darkest", 3], ["focus", "canvas-lightest", 3], ["border-strong", "canvas-darkest", 3], ["brand-mark", "canvas-darkest", 3],
  // Text over a spiral line at --hero-spiral-opacity on the darkest canvas stop.
  ["fg", "canvas-spiral", 4.5], ["fg-secondary", "canvas-spiral", 4.5], ["accent", "canvas-spiral", 4.5],
  // Accent gradient: button text at both stops, and the hover stops.
  ["accent-fg", "gradient-accent-start", 4.5], ["accent-fg", "gradient-accent-end", 4.5],
  ["accent-fg", "gradient-accent-hover-start", 4.5], ["accent-fg", "gradient-accent-hover-end", 4.5],
  ["gradient-accent-end", "bg-canvas", 3], ["gradient-accent-end", "bg-elevated", 3], ["gradient-accent-end", "canvas-darkest", 3],
  // Score ring: every stop against the card, the canvas and the track.
  ["gradient-ring-start", "bg-elevated", 3], ["gradient-ring-mid", "bg-elevated", 3], ["gradient-ring-end", "bg-elevated", 3],
  ["gradient-ring-start", "ring-track", 3], ["gradient-ring-mid", "ring-track", 3], ["gradient-ring-end", "ring-track", 3],
  ["gradient-ring-start", "canvas-darkest", 3], ["gradient-ring-mid", "canvas-darkest", 3], ["gradient-ring-end", "canvas-darkest", 3],
  // Severity cue bars on paper and on the row hover fill.
  ["sev-cue-critical", "bg-elevated", 3], ["sev-cue-high", "bg-elevated", 3], ["sev-cue-critical", "bg-inset", 3], ["sev-cue-high", "bg-inset", 3],
  // Horizon: only --fg and the accent link may sit on it; secondary text may not.
  ["fg", "horizon-1", 4.5], ["fg", "horizon-front", 4.5], ["accent", "horizon-1", 4.5], ["accent", "horizon-front", 4.5],
];

let failures = 0;
const lines: string[] = [
  "# Token contrast",
  "",
  "Generated by `pnpm exec tsx scripts/contrast.ts` from `tokens.css`. WCAG 2.x relative luminance. Text pairs must clear 4.5:1; icons, meter fills, rings and strong borders 3:1.",
  "",
  `Derived backgrounds: \`canvas-darkest\` and \`canvas-lightest\` are the canvas gradient stops with the grain tile's darkest (${(tile.darkest * 255).toFixed(0)}) and lightest (${(tile.lightest * 255).toFixed(0)}) grey composited at its peak alpha (${(tile.peakAlpha * 255).toFixed(0)}/255) times \`--grain-opacity\`; \`canvas-spiral\` is the darkest stop under a spiral line at \`--hero-spiral-opacity\`; \`horizon-front\` is \`--horizon-2\` at 50 % over \`--horizon-1\`.`,
  "",
];
for (const [name, scheme] of [["Light", light], ["Dark", dark]] as const) {
  lines.push(`## ${name}`, "", "| Foreground | Background | Ratio | Minimum | Result |", "|---|---|---|---|---|");
  for (const [fg, bg, min] of PAIRS) {
    const a = scheme[fg];
    const b = scheme[bg];
    if (a === undefined || b === undefined) throw new Error(`missing token ${a === undefined ? fg : bg}`);
    const r = ratio(a, b);
    const ok = r >= min;
    if (!ok) failures += 1;
    lines.push(`| --${fg} ${a} | --${bg} ${b} | ${r.toFixed(2)}:1 | ${min}:1 | ${ok ? "pass" : "FAIL"} |`);
  }
  lines.push("");
}
writeFileSync(resolve(root, "src/styles/CONTRAST.md"), lines.join("\n"));
console.log(failures === 0 ? "all pairs pass" : `${failures} pair(s) fail`);
process.exit(failures === 0 ? 0 : 1);
