import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import type { Browser, Page } from "playwright-core";

/** Shared pieces of the QA scripts: CLI args, the demo server, Chrome, and the screen walk. */

export const DESKTOP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface CliArgs {
  readonly port: number;
  readonly out: string;
}

export function parseArgs(argv: readonly string[], defaults: CliArgs): CliArgs {
  let port = defaults.port;
  let out = defaults.out;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--port" && next !== undefined) {
      port = Number(next);
      i += 1;
    } else if (arg === "--out" && next !== undefined) {
      out = next;
      i += 1;
    } else if (arg?.startsWith("--port=")) {
      port = Number(arg.slice("--port=".length));
    } else if (arg?.startsWith("--out=")) {
      out = arg.slice("--out=".length);
    }
  }
  if (!Number.isInteger(port) || port <= 0) throw new Error(`bad --port: ${port}`);
  return { port, out: resolve(out) };
}

async function answers(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface DemoServer {
  readonly baseUrl: string;
  /** Kills the server only if this process started it. */
  stop(): Promise<void>;
}

/** Uses a server already answering on the port, otherwise starts the demo build and owns it. */
export async function ensureServer(port: number): Promise<DemoServer> {
  const baseUrl = `http://localhost:${port}`;
  if (await answers(baseUrl)) {
    console.error(`[qa] using the server already on ${baseUrl}`);
    return { baseUrl, stop: async () => undefined };
  }
  const viteBin = join(DESKTOP_DIR, "node_modules", "vite", "bin", "vite.js");
  const env: NodeJS.ProcessEnv = { ...process.env, VITE_TALOS_DEMO: "1" };
  delete env["TAURI_ENV_PLATFORM"];
  const child: ChildProcess = spawn(process.execPath, [viteBin, "--strictPort", "--port", String(port)], {
    cwd: DESKTOP_DIR,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  const stop = async (): Promise<void> => {
    if (exited || child.pid === undefined) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
    for (let i = 0; i < 40 && !exited; i += 1) await sleep(50);
    if (!exited) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
  };
  const onSignal = () => {
    void stop().finally(() => process.exit(130));
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (exited) break;
    if (await answers(baseUrl)) {
      console.error(`[qa] started the demo server on ${baseUrl} (pid ${child.pid})`);
      return { baseUrl, stop };
    }
    await sleep(250);
  }
  await stop();
  throw new Error(`the demo server did not answer on ${baseUrl}\n${output}`);
}

export async function launchChrome(): Promise<Browser> {
  return chromium.launch({ channel: "chrome", headless: true });
}

export interface Shot {
  readonly name: string;
  /** The screen changes with time; reach it again before every capture. */
  readonly volatile?: boolean;
}

/** Called once per screen. `reach` performs the steps that lead to it and may be called again when the shot is volatile. */
export type Visit = (shot: Shot, reach: () => Promise<void>) => Promise<void>;

const NAV = { name: "Main" } as const;
const STEP_TIMEOUT = 20_000;

async function nav(page: Page, label: string): Promise<void> {
  await page.getByRole("navigation", NAV).getByRole("button", { name: label, exact: true }).click();
}

async function heading(page: Page, name: string | RegExp, level: 1 | 2 | 3 = 1): Promise<void> {
  await page.getByRole("heading", { name, level }).first().waitFor({ timeout: STEP_TIMEOUT });
}

async function runCheckUp(page: Page): Promise<void> {
  await heading(page, "Overview");
  await page.getByRole("button", { name: "Run check-up" }).click();
  await page.getByText("Last check-up").waitFor({ timeout: STEP_TIMEOUT });
}

/** A card's name is its whole content (badge, category, headline, points), so match the headline anywhere in it. */
async function openCard(page: Page, headline: RegExp): Promise<void> {
  await page.locator("button.finding-card").filter({ hasText: headline }).first().click();
  await heading(page, headline);
}

/** Every screen the QA scripts cover, in order. The walk keeps SPA state between shots. */
export async function walk(page: Page, baseUrl: string, visit: Visit): Promise<void> {
  const url = (query: string) => `${baseUrl}/?${query}`;

  // Dev machine, unlicensed, browser hand-off.
  await visit({ name: "welcome-empty" }, async () => {
    await page.goto(url("reset=1&fixture=dev-machine"));
    await heading(page, "A calm check-up for your Mac");
  });
  await visit({ name: "welcome-filled" }, async () => {
    await page.getByRole("radio", { name: "As a freelancer" }).check();
    await page.getByRole("radio", { name: "Somewhat. I can follow steps." }).check();
    await page.getByRole("radio", { name: "Yes", exact: true }).check();
  });
  await visit({ name: "overview-dev-machine" }, async () => {
    await page.getByRole("button", { name: "Start check-up" }).click();
    await heading(page, "Overview");
    await heading(page, "Next three fixes", 2);
  });
  await visit({ name: "findings-dev-machine" }, async () => {
    await nav(page, "Findings");
    await heading(page, "Findings");
  });
  await visit({ name: "finding-free-dev-machine" }, async () => {
    await openCard(page, /Your disk is not encrypted/);
    await heading(page, "How to fix it", 2);
  });
  await visit({ name: "finding-locked-dev-machine" }, async () => {
    await page.getByRole("button", { name: "Back" }).click();
    await heading(page, "Findings");
    const cards = page.locator("section[aria-labelledby='group-needs-fixing'] button.finding-card");
    const count = await cards.count();
    for (let i = count - 1; i >= 0; i -= 1) {
      await cards.nth(i).click();
      const lock = page.getByRole("region", { name: "This fix is part of the full version" });
      if (await lock.isVisible({ timeout: 2000 }).catch(() => false)) return;
      await page.getByRole("button", { name: "Back" }).click();
      await heading(page, "Findings");
    }
    throw new Error("no locked finding on the dev machine");
  });
  await visit({ name: "settings-dev-off" }, async () => {
    await nav(page, "Settings");
    await heading(page, "Settings");
    await page.getByText("not granted").waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "settings-dev-on" }, async () => {
    await page.getByRole("switch", { name: "Developer mode" }).check();
    await page.getByRole("radio", { name: "Claude API key" }).waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "finding-dev-on-dev-machine" }, async () => {
    await nav(page, "Findings");
    await heading(page, "Findings");
    await openCard(page, /The firewall is off/);
    await page.getByText("If you prefer Terminal").waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "ask-claude-locked" }, async () => {
    await nav(page, "Settings");
    await page.getByRole("radio", { name: "Claude API key" }).check();
    await nav(page, "Ask");
    await heading(page, "Ask");
    await page.getByRole("region", { name: "Asking questions is part of the full version" }).waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "about-unlicensed" }, async () => {
    await nav(page, "About");
    await heading(page, "About");
  });

  // Dev machine, licensed, in-app Claude (fake).
  await visit({ name: "ask-claude-answered" }, async () => {
    await page.goto(url("reset=1&fixture=dev-machine&provider=claude&licensed=1&onboarded=1"));
    await runCheckUp(page);
    await nav(page, "Ask");
    await heading(page, "Ask");
    await page.getByLabel("Your question").fill("Which of these should I do first?");
    await page.locator("form.ask-form").getByRole("button", { name: "Ask" }).click();
    await page.getByText("AI, not verified").waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "finding-ai-explained" }, async () => {
    await nav(page, "Findings");
    await heading(page, "Findings");
    await openCard(page, /Your disk is not encrypted/);
    await page.getByRole("button", { name: "Explain this for me" }).click();
    await page.getByText("Why it matters for you").waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "findings-suggested-order" }, async () => {
    await page.getByRole("button", { name: "Back" }).click();
    await heading(page, "Findings");
    await page.getByRole("button", { name: "Suggest an order" }).click();
    await page.locator(".findings-aside").getByText("From the AI, not verified").waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "settings-licensed" }, async () => {
    await nav(page, "Settings");
    await page.getByText(/^Licensed: personal plan/).waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "about-licensed" }, async () => {
    await nav(page, "About");
    await page.getByText(/tag deadbeef/).waitFor({ timeout: STEP_TIMEOUT });
  });

  // Mid-scan. Slow enough to catch; reached afresh for every capture.
  await visit({ name: "scanning-mid-scan", volatile: true }, async () => {
    await page.goto(url("reset=1&fixture=dev-machine&onboarded=1&delay=400"));
    await heading(page, "Overview");
    await page.getByRole("button", { name: "Run check-up" }).click();
    await heading(page, "Checking your Mac");
    await page.getByText(/^[3-9] of \d+ areas done$/).waitFor({ timeout: STEP_TIMEOUT });
    // Cancel must be in view at the smallest window height without scrolling.
    const cancel = await page.getByRole("button", { name: "Cancel" }).boundingBox();
    if (cancel === null || cancel.y + cancel.height > MIN_HEIGHT) {
      throw new Error(`the Cancel button is below the ${MIN_HEIGHT}px fold: ${JSON.stringify(cancel)}`);
    }
  });

  // Other fixtures.
  await visit({ name: "overview-all-unavailable" }, async () => {
    await page.goto(url("reset=1&fixture=all-unavailable&onboarded=1"));
    await runCheckUp(page);
    await heading(page, "Nothing could be checked", 2);
    await heading(page, "Couldn't check", 2);
  });
  await visit({ name: "findings-all-unavailable" }, async () => {
    await nav(page, "Findings");
    await heading(page, "Findings");
    await page.locator("section[aria-labelledby='group-couldn-t-check'] button.finding-card").first().waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "finding-unknown-all-unavailable" }, async () => {
    await page.locator("section[aria-labelledby='group-couldn-t-check'] button.finding-card").first().click();
    await heading(page, /^Couldn't check whether/);
  });
  await visit({ name: "overview-hardened" }, async () => {
    await page.goto(url("reset=1&fixture=hardened&onboarded=1"));
    await runCheckUp(page);
    await heading(page, "Nothing needs fixing", 2);
  });
  await visit({ name: "overview-fresh-install" }, async () => {
    await page.goto(url("reset=1&fixture=fresh-install&onboarded=1"));
    await runCheckUp(page);
  });
  await visit({ name: "overview-windows-minimal" }, async () => {
    await page.goto(url("reset=1&fixture=windows-minimal&onboarded=1"));
    await runCheckUp(page);
  });
  await visit({ name: "findings-windows-minimal" }, async () => {
    await nav(page, "Findings");
    await heading(page, "Findings");
    await page.getByText(/checks do not apply to this Mac\.$/).waitFor({ timeout: STEP_TIMEOUT });
  });
}

/** Lets the scrolling content column grow so a full-page screenshot shows the whole screen, and keeps the shell at least one window tall. */
const UNROLL_CSS =
  "html, body, #root { height: auto !important; } #root, .shell { min-height: 100vh; } .shell { height: auto !important; } .content { overflow: visible !important; } .findings-aside { position: static !important; max-height: none !important; }";

export async function unrollPage(page: Page): Promise<void> {
  await page.evaluate((css) => {
    if (document.getElementById("qa-unroll") !== null) return;
    const style = document.createElement("style");
    style.id = "qa-unroll";
    style.textContent = css;
    document.head.appendChild(style);
  }, UNROLL_CSS);
}

/** Two animation frames, so the compositor has painted after a resize or a colour-scheme change. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}

/**
 * Captures the whole screen as a plain viewport screenshot: the viewport is grown to the document
 * height first. Chromium's beyond-viewport capture (fullPage: true) sometimes paints a stale band
 * of the page top at the bottom of the image; this path never uses it.
 */
export async function captureWholeScreen(page: Page, size: { width: number; height: number }, scheme: Scheme, file: string): Promise<void> {
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: scheme });
  await unrollPage(page);
  await settle(page);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  if (height > size.height) {
    await page.setViewportSize({ width: size.width, height });
    await settle(page);
  }
  await page.screenshot({ path: file, fullPage: false });
}

export type Scheme = "light" | "dark";
export const SCHEMES: readonly Scheme[] = ["light", "dark"];
export const SIZES: readonly { width: number; height: number }[] = [
  { width: 1100, height: 760 },
  { width: 900, height: 600 },
];
/** The smallest window the app allows (tauri.conf.json minHeight). */
const MIN_HEIGHT = 600;
