// Renders the three menu bar rasters (docs/DESIGN-WATCH.md section 5): black plus alpha, 36 x 36 px,
// the 2x raster for an 18 pt template item. macOS tints a template image itself, so no colour is chosen here.
// Run from apps/desktop: pnpm exec tsx scripts/gen-tray-icons.ts
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const SIZE = 36;
const outDir = resolve(import.meta.dirname, "../src-tauri/icons");

// The kit's check-up rings (brand/mineral/icons/check-up.svg), verbatim.
const RINGS = '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>';
// A 4 pt filled dot at lower right: 24 units map to 18 pt, so 4 pt is 5.33 units across.
const DOT_R = 2.67;
const DOT = `<circle cx="19.5" cy="19.5" r="${DOT_R}" fill="#000" stroke="none"/>`;
// The rings are cut away around the dot so the two shapes do not merge in a one-colour template.
const DOT_MASK = `<mask id="dot"><rect width="24" height="24" fill="#fff"/><circle cx="19.5" cy="19.5" r="${DOT_R + 1.5}" fill="#000"/></mask>`;
// An octagon with a horizontal bar in the kit's 1.5 px stroke (lucide's octagon-minus geometry).
const OCTAGON =
  '<path d="M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z"/><path d="M8 12h8"/>';

const ICONS: Record<string, string> = {
  "tray-calm": RINGS,
  "tray-look": `${DOT_MASK}<g mask="url(#dot)">${RINGS}</g>${DOT}`,
  "tray-act": OCTAGON,
};

function svg(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  for (const [name, body] of Object.entries(ICONS)) {
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg(body)}</body></html>`);
    const png = await page.screenshot({ type: "png", omitBackground: true, clip: { x: 0, y: 0, width: SIZE, height: SIZE } });
    writeFileSync(resolve(outDir, `${name}.png`), png);
  }
} finally {
  await browser.close();
}
console.log(`3 tray rasters written to ${outDir}`);
