import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { SCHEMES, SIZES, WARNINGS, captureWholeScreen, ensureServer, launchChrome, parseArgs, parseOnly, walk, walkAccept, walkAi, walkGuided, walkWatch } from "./harness";
import type { Shot } from "./harness";

/**
 * Screenshots every screen of the demo build in light and dark at two window sizes.
 *   cd apps/desktop && pnpm exec tsx qa/snap.ts --port 1430 --out qa/screenshots/<name> [--only expert|guided|ai|watch|accept]
 */
async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2), { port: 1430, out: "qa/screenshots/latest" });
  const only = parseOnly(process.argv.slice(2));
  await mkdir(args.out, { recursive: true });
  const server = await ensureServer(args.port);
  const browser = await launchChrome();
  const written: string[] = [];
  try {
    const context = await browser.newContext({ viewport: SIZES[0] ?? null, colorScheme: "light" });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const visit = async (shot: Shot, reach: () => Promise<void>) => {
      let reached = false;
      // A shot with its own size (the watch window) is captured at that size only.
      const sizes = shot.size === undefined ? SIZES : [shot.size];
      for (const scheme of SCHEMES) {
        for (const size of sizes) {
          if (!reached || shot.volatile === true) {
            await reach();
            reached = true;
          }
          const file = join(args.out, `${shot.name}-${scheme}-${size.width}.png`);
          await captureWholeScreen(page, size, scheme, file, { fixed: shot.size !== undefined });
          written.push(file);
          console.log(relative(process.cwd(), file));
        }
      }
    };
    if (only === null || only === "expert") await walk(page, server.baseUrl, visit);
    if (only === null || only === "guided") await walkGuided(page, server.baseUrl, visit);
    if (only === null || only === "ai") await walkAi(page, server.baseUrl, visit);
    if (only === null || only === "watch") await walkWatch(page, server.baseUrl, visit);
    if (only === null || only === "accept") await walkAccept(page, server.baseUrl, visit);
    await context.close();
  } finally {
    await browser.close();
    await server.stop();
  }
  console.error(`[qa] ${written.length} screenshots in ${args.out}`);
  for (const warning of WARNINGS) console.error(`[qa] warning: ${warning}`);
  // Every screenshot is written either way; a layout warning (a fold or window-height miss) exits 2.
  if (WARNINGS.length > 0) console.error(`[qa] ${WARNINGS.length} layout warning(s)`);
  return WARNINGS.length > 0 ? 2 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
