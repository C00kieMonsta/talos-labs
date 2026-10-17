import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { SCHEMES, SIZES, captureWholeScreen, ensureServer, launchChrome, parseArgs, parseOnly, walk, walkAi, walkGuided } from "./harness";

/**
 * Screenshots every screen of the demo build in light and dark at two window sizes.
 *   cd apps/desktop && pnpm exec tsx qa/snap.ts --port 1430 --out qa/screenshots/<name> [--only expert|guided|ai]
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
    const visit = async (shot: { name: string; volatile?: boolean }, reach: () => Promise<void>) => {
      let reached = false;
      for (const scheme of SCHEMES) {
        for (const size of SIZES) {
          if (!reached || shot.volatile === true) {
            await reach();
            reached = true;
          }
          const file = join(args.out, `${shot.name}-${scheme}-${size.width}.png`);
          await captureWholeScreen(page, size, scheme, file);
          written.push(file);
          console.log(relative(process.cwd(), file));
        }
      }
    };
    if (only === null || only === "expert") await walk(page, server.baseUrl, visit);
    if (only === null || only === "guided") await walkGuided(page, server.baseUrl, visit);
    if (only === null || only === "ai") await walkAi(page, server.baseUrl, visit);
    await context.close();
  } finally {
    await browser.close();
    await server.stop();
  }
  console.error(`[qa] ${written.length} screenshots in ${args.out}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
