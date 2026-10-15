import { createRequire } from "node:module";
import type { Page } from "playwright-core";
import { SCHEMES, SIZES, ensureServer, launchChrome, parseArgs, walk } from "./harness";

/**
 * Runs axe-core on every screen of the demo build and prints the violations as JSON.
 * Exits 1 when any violation is serious or critical.
 *   cd apps/desktop && pnpm exec tsx qa/axe.ts --port 1430
 */

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve("axe-core/axe.min.js");

interface Violation {
  readonly screen: string;
  readonly id: string;
  readonly impact: string | null;
  readonly help: string;
  readonly target: string;
}

interface AxeNode {
  readonly target: readonly (string | readonly string[])[];
}

interface AxeViolation {
  readonly id: string;
  readonly impact?: string | null;
  readonly help: string;
  readonly nodes: readonly AxeNode[];
}

async function runAxe(page: Page, screen: string): Promise<Violation[]> {
  const loaded = await page.evaluate(() => typeof (window as unknown as { axe?: unknown }).axe !== "undefined");
  if (!loaded) await page.addScriptTag({ path: AXE_PATH });
  const raw = await page.evaluate(async () => {
    const axe = (window as unknown as { axe: { run(ctx: Document, opts: object): Promise<{ violations: unknown[] }> } }).axe;
    const result = await axe.run(document, { resultTypes: ["violations"] });
    return result.violations;
  });
  return (raw as AxeViolation[]).map((v) => ({
    screen,
    id: v.id,
    impact: v.impact ?? null,
    help: v.help,
    target: v.nodes[0]?.target.map((t) => (Array.isArray(t) ? t.join(" >>> ") : String(t))).join(" ") ?? "",
  }));
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2), { port: 1430, out: "qa/scratch" });
  const server = await ensureServer(args.port);
  const browser = await launchChrome();
  const violations: Violation[] = [];
  try {
    const context = await browser.newContext({ viewport: SIZES[0] ?? null, colorScheme: "light" });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    await walk(page, server.baseUrl, async (shot, reach) => {
      let reached = false;
      for (const scheme of SCHEMES) {
        if (!reached || shot.volatile === true) {
          await reach();
          reached = true;
        }
        await page.emulateMedia({ colorScheme: scheme });
        violations.push(...(await runAxe(page, `${shot.name} (${scheme})`)));
      }
    });
    await context.close();
  } finally {
    await browser.close();
    await server.stop();
  }
  console.log(JSON.stringify(violations, null, 2));
  const blocking = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  console.error(`[qa] ${violations.length} violations, ${blocking.length} serious or critical`);
  return blocking.length > 0 ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
