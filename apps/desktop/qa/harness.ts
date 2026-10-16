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

/** Sidebar rows: the main nav holds the screens; Settings is the foot row outside it. */
async function nav(page: Page, label: string): Promise<void> {
  const sidebar = page.locator("aside.sidebar");
  const row = label === "Settings" ? sidebar.locator(".sidebar-foot") : sidebar.getByRole("navigation", NAV);
  await row.getByRole("button", { name: label, exact: true }).click();
}

/** The toolbar's "‹ Findings" button on a finding. */
async function back(page: Page): Promise<void> {
  await page.locator("button.toolbar-back").click();
}

async function heading(page: Page, name: string | RegExp, level: 1 | 2 | 3 = 1): Promise<void> {
  await page.getByRole("heading", { name, level }).first().waitFor({ timeout: STEP_TIMEOUT });
}

async function runCheckUp(page: Page): Promise<void> {
  await heading(page, "Overview");
  await page.getByRole("button", { name: "Run check-up" }).click();
  await page.getByText("Last check-up").waitFor({ timeout: STEP_TIMEOUT });
}

/** A card is an article whose headline link opens the finding. */
async function openCard(page: Page, headline: RegExp): Promise<void> {
  await page.locator("article.finding-card").filter({ hasText: headline }).first().locator("a.finding-card-title").click();
  await heading(page, headline);
}

/** The pasted demo key: matches the LicenceField paste regex, so it verifies without a button press. */
const DEMO_LICENSE_KEY_PASTED = `TL1.${"DEMO".repeat(5)}.${"D".repeat(64)}`;

interface DemoCall {
  readonly kind: string;
  readonly arg?: string;
}

async function demoCalls(page: Page): Promise<DemoCall[]> {
  return page.evaluate(() => (window as unknown as { __talosDemoCalls?: DemoCall[] }).__talosDemoCalls ?? []);
}

/** Fails when the demo recorded anything that looks like a URL: the app never hands one to the browser. */
async function assertNoUrlRecorded(page: Page): Promise<void> {
  const calls = await demoCalls(page);
  if (/https?:/.test(JSON.stringify(calls))) throw new Error(`a URL was recorded: ${JSON.stringify(calls)}`);
}

/** The element must sit above the 600 px fold at the smallest window height. */
async function assertAboveFold(locator: ReturnType<Page["locator"]>, what: string): Promise<void> {
  const box = await locator.boundingBox();
  if (box === null || box.y + box.height > MIN_HEIGHT) throw new Error(`${what} is below the ${MIN_HEIGHT}px fold: ${JSON.stringify(box)}`);
}

/** Runs a paced check-up and asserts the Overview is not reached before the floor. */
async function pacedCheckUp(page: Page, floorMs: number): Promise<void> {
  const started = Date.now();
  await page.getByRole("button", { name: "Run check-up" }).click();
  await heading(page, "Checking your Mac");
  await page.getByText("Last check-up").waitFor({ timeout: STEP_TIMEOUT });
  const took = Date.now() - started;
  if (took < floorMs) throw new Error(`the Overview was reached after ${took} ms, before the ${floorMs} ms floor`);
}

/** Opens the fix sheet for a finding's in-app fix. */
async function openFixSheet(page: Page, headline: RegExp, verb: RegExp): Promise<void> {
  await openCard(page, headline);
  await page.locator(".fix-action-row").getByRole("button", { name: verb }).click();
  await page.getByRole("dialog").waitFor({ timeout: STEP_TIMEOUT });
}

/** Every screen the QA scripts cover, in order. The walk keeps SPA state between shots. */
export async function walk(page: Page, baseUrl: string, visit: Visit): Promise<void> {
  // Every shot that is not about pacing collapses the scan schedule.
  const url = (query: string, options: { paced?: boolean } = {}) => `${baseUrl}/?${query}${options.paced === true ? "" : "&pace=0"}`;
  const goto = async (query: string, options: { paced?: boolean; reducedMotion?: boolean } = {}) => {
    await page.emulateMedia({ reducedMotion: options.reducedMotion === true ? "reduce" : "no-preference" });
    await page.goto(url(query, options));
  };
  const LICENSED = "reset=1&fixture=dev-machine&licensed=1&onboarded=1&delay=0";

  // Dev machine, unlicensed, on-device AI.
  await visit({ name: "welcome-single" }, async () => {
    await goto("reset=1&fixture=dev-machine");
    await heading(page, "A calm check-up for your Mac");
  });
  await visit({ name: "welcome-filled" }, async () => {
    await page.getByRole("radio", { name: "As a freelancer" }).check();
    await page.getByRole("radio", { name: "Somewhat" }).check();
    await page.getByRole("switch", { name: /other people's data/ }).check();
  });
  await visit({ name: "overview-dev-machine" }, async () => {
    await page.getByRole("button", { name: "Start check-up" }).click();
    await heading(page, "Overview");
    await heading(page, "Next three fixes", 2);
  });
  await visit({ name: "overview-inline-actions" }, async () => {
    const actions = page.locator("section[aria-labelledby='next-fixes'] .finding-card-action");
    if ((await actions.count()) < 3) throw new Error("the next three fixes should each carry an inline action");
  });
  await visit({ name: "findings-dev-machine" }, async () => {
    await nav(page, "Findings");
    await heading(page, "Findings");
  });
  await visit({ name: "findings-cost-words" }, async () => {
    for (const word of ["Fix in app", "Open Settings", "Steps"]) await page.locator(".finding-card-cost").filter({ hasText: word }).first().waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "finding-free-dev-machine" }, async () => {
    await openCard(page, /The firewall is off/);
    await heading(page, "How to fix it", 2);
  });
  await visit({ name: "finding-locked-dev-machine" }, async () => {
    await back(page);
    await heading(page, "Findings");
    await openCard(page, /A shared folder is open to Everyone/);
    await page.getByRole("region", { name: "This fix is part of the full version" }).waitFor({ timeout: STEP_TIMEOUT });
  });
  // The valid line shows for 800 ms before the lock gives way, so every capture pastes afresh.
  await visit({ name: "lock-licence-pasted", volatile: true }, async () => {
    await goto("reset=1&fixture=dev-machine&onboarded=1&delay=0");
    await runCheckUp(page);
    await nav(page, "Findings");
    await heading(page, "Findings");
    await openCard(page, /A shared folder is open to Everyone/);
    const lock = page.getByRole("region", { name: "This fix is part of the full version" });
    await lock.getByPlaceholder("Paste your licence key").fill(DEMO_LICENSE_KEY_PASTED);
    await lock.locator(".licence-valid").waitFor({ timeout: STEP_TIMEOUT });
    await assertNoUrlRecorded(page);
  });
  await visit({ name: "settings-reduced" }, async () => {
    await goto("reset=1&fixture=dev-machine&onboarded=1&delay=0");
    await nav(page, "Settings");
    await heading(page, "Settings");
    await page.getByText("Not granted").first().waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "settings-dev-on" }, async () => {
    await page.getByRole("switch", { name: "Developer mode" }).check();
    await page.getByRole("radio", { name: "Claude API key" }).waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "window-inactive" }, async () => {
    await page.evaluate(() => document.querySelector(".shell")?.classList.add("window-inactive"));
  });
  await visit({ name: "ask-locked" }, async () => {
    await goto("reset=1&fixture=dev-machine&onboarded=1&delay=0");
    await runCheckUp(page);
    await nav(page, "Ask");
    await heading(page, "Ask");
    await page.getByText("AI explanations are part of the full version.").waitFor({ timeout: STEP_TIMEOUT });
  });

  // Dev machine, licensed, on-device AI (fake).
  await visit({ name: "ask-streaming", volatile: true }, async () => {
    await goto(LICENSED);
    await runCheckUp(page);
    await nav(page, "Ask");
    await heading(page, "Ask");
    await page.getByLabel("Your question").fill("Which of these should I do first?");
    await page.locator("form.ask-form").getByRole("button", { name: "Ask" }).click();
    await page.locator(".chat-streaming").getByRole("button", { name: "Stop" }).waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "ask-answered" }, async () => {
    await page.locator(".chat-streaming").waitFor({ state: "detached", timeout: STEP_TIMEOUT });
    await page.locator(".chat-assistant").first().waitFor({ timeout: STEP_TIMEOUT });
  });
  // The explanation is cached once it lands, so every capture starts from a fresh report.
  await visit({ name: "ai-streaming", volatile: true }, async () => {
    await goto(LICENSED);
    await runCheckUp(page);
    await nav(page, "Findings");
    await heading(page, "Findings");
    await openCard(page, /Your disk is not encrypted/);
    await page.getByRole("button", { name: "Explain this for me" }).click();
    await page.locator(".ai-card").getByRole("button", { name: "Stop" }).waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "ai-ready" }, async () => {
    await page.getByText("Written on this Mac by Apple Intelligence. Not verified.").waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "findings-suggested-order" }, async () => {
    await back(page);
    await heading(page, "Findings");
    await page.locator(".findings-aside").getByRole("button", { name: "Suggest an order" }).click();
    await page.locator(".findings-aside").getByText("Start with").waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "settings-licensed" }, async () => {
    await nav(page, "Settings");
    await page.getByText(/^Licensed, personal plan/).waitFor({ timeout: STEP_TIMEOUT });
  });
  for (const state of ["device_not_eligible", "apple_intelligence_not_enabled", "model_not_ready", "helper_unavailable"] as const) {
    await visit({ name: `ai-${state.replace(/_/g, "-")}` }, async () => {
      await goto(`${LICENSED}&ai=${state}`);
      await runCheckUp(page);
      await page.locator(`.ai-card[data-ai-state="${state}"]`).waitFor({ timeout: STEP_TIMEOUT });
    });
  }
  await visit({ name: "ai-failed" }, async () => {
    await goto(`${LICENSED}&explainer=network`);
    await runCheckUp(page);
    await page.getByRole("button", { name: "Suggest an order" }).click();
    await page.locator(".ai-card[data-ai-state='failed']").waitFor({ timeout: STEP_TIMEOUT });
  });

  // Fix sheet. Rule 002 is an admin fix; 013 (forced to fail) needs no password; 029 takes a passphrase.
  await visit({ name: "fix-confirm-admin" }, async () => {
    await goto(LICENSED);
    await runCheckUp(page);
    await nav(page, "Findings");
    await heading(page, "Findings");
    await openFixSheet(page, /The firewall is off/, /^Turn on/);
    await page.getByText("macOS will ask for your administrator password", { exact: false }).waitFor({ timeout: STEP_TIMEOUT });
    await assertAboveFold(page.getByRole("dialog").locator(".sheet-actions .button-primary"), "the sheet's primary button");
    const calls = await demoCalls(page);
    if (!calls.some((c) => c.kind === "fixPreview" && c.arg === "TL-MAC-002")) throw new Error(`no fixPreview recorded: ${JSON.stringify(calls)}`);
  });
  await visit({ name: "fix-confirm-user" }, async () => {
    await goto(`${LICENSED}&fail=013`);
    await runCheckUp(page);
    await nav(page, "Findings");
    await heading(page, "Findings");
    await openFixSheet(page, /The screen does not lock itself/, /./);
    await page.getByRole("dialog").getByText("No password is needed.").waitFor({ timeout: STEP_TIMEOUT });
    await page.getByRole("dialog").getByText(/^Currently /).waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "fix-waiting-password", volatile: true }, async () => {
    await goto(`${LICENSED}&fix_delay=4000`);
    await runCheckUp(page);
    await nav(page, "Findings");
    await heading(page, "Findings");
    await openFixSheet(page, /The firewall is off/, /^Turn on/);
    await page.getByRole("dialog").getByRole("button", { name: /^Turn on/ }).click();
    await page.getByText("Waiting for macOS to check your password").waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "fix-running", volatile: true }, async () => {
    await page.getByText(/^Running \(1 of/).waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "fix-done" }, async () => {
    await page.getByText(/^Done\./).waitFor({ timeout: STEP_TIMEOUT });
    const calls = await demoCalls(page);
    if (!calls.some((c) => c.kind === "fixApply")) throw new Error(`no fixApply recorded: ${JSON.stringify(calls)}`);
    await assertNoUrlRecorded(page);
  });
  const ERRORS = ["cancelled", "wrong_password", "command_failed", "timeout", "precondition_changed", "plan_expired", "invalid_choice", "invalid_input", "not_in_catalog", "busy"] as const;
  for (const error of ERRORS) {
    await visit({ name: `fix-${error.replace(/_/g, "-")}` }, async () => {
      await goto(`${LICENSED}&fix=${error}&fix_delay=0`);
      await runCheckUp(page);
      await nav(page, "Findings");
      await heading(page, "Findings");
      await openFixSheet(page, /The firewall is off/, /^Turn on/);
      await page.getByRole("dialog").getByRole("button", { name: /^Turn on/ }).click();
      await page.getByRole("dialog").getByRole("alert").waitFor({ timeout: STEP_TIMEOUT });
    });
  }
  await visit({ name: "fix-still-failing" }, async () => {
    await goto(`${LICENSED}&fix=still_failing&fix_delay=0`);
    await runCheckUp(page);
    await nav(page, "Findings");
    await heading(page, "Findings");
    await openFixSheet(page, /The firewall is off/, /^Turn on/);
    await page.getByRole("dialog").getByRole("button", { name: /^Turn on/ }).click();
    await page.getByText(/the check still fails/).waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "fix-passphrase" }, async () => {
    await goto(LICENSED);
    await runCheckUp(page);
    await nav(page, "Findings");
    await heading(page, "Findings");
    await openFixSheet(page, /An SSH key has no passphrase/, /./);
    await page.getByLabel("New passphrase").waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "fix-watching" }, async () => {
    await goto(LICENSED);
    await runCheckUp(page);
    await nav(page, "Findings");
    await heading(page, "Findings");
    await openCard(page, /Your disk is not encrypted/);
    await page.locator(".fix-action-row").getByRole("button", { name: "Open System Settings" }).click();
    await page.getByText(/Watching for the change/).waitFor({ timeout: STEP_TIMEOUT });
    await assertNoUrlRecorded(page);
  });
  await visit({ name: "fix-passed" }, async () => {
    await goto(`${LICENSED}&poll_after=1`);
    await runCheckUp(page);
    await nav(page, "Findings");
    await heading(page, "Findings");
    await openCard(page, /Your disk is not encrypted/);
    await page.locator(".fix-action-row").getByRole("button", { name: "Open System Settings" }).click();
    await page.locator(".status-strip-passed").waitFor({ timeout: STEP_TIMEOUT });
  });

  // Permissions, on the fixture where nothing could be read.
  await visit({ name: "permission-watching" }, async () => {
    await goto("reset=1&fixture=all-unavailable&onboarded=1&delay=0");
    await runCheckUp(page);
    await page.getByRole("button", { name: "Open Full Disk Access" }).click();
    await page.locator("[data-permission-state='watching']").waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "permission-granted" }, async () => {
    await goto("reset=1&fixture=all-unavailable&onboarded=1&delay=0&fda_after=1");
    await runCheckUp(page);
    await page.getByRole("button", { name: "Open Full Disk Access" }).click();
    await page.locator("[data-permission-state='granted']").waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "permission-reopen" }, async () => {
    await goto("reset=1&fixture=all-unavailable&onboarded=1&delay=0");
    await runCheckUp(page);
    await page.getByRole("button", { name: "Open Full Disk Access" }).click();
    await page.locator("[data-permission-state='reopen_needed']").waitFor({ timeout: 25_000 });
  });
  await visit({ name: "permission-prompting" }, async () => {
    await goto("reset=1&fixture=all-unavailable&onboarded=1&delay=0&automation=not_determined");
    await runCheckUp(page);
    await page.getByRole("button", { name: "Allow" }).click();
    await page.locator("[data-permission-state='prompting']").waitFor({ timeout: STEP_TIMEOUT });
  });

  // Scanning pacing. Reached afresh for every capture.
  await visit({ name: "scanning-paced-2s", volatile: true }, async () => {
    await goto("reset=1&fixture=dev-machine&onboarded=1&delay=0", { paced: true });
    await heading(page, "Overview");
    await page.getByRole("button", { name: "Run check-up" }).click();
    await heading(page, "Checking your Mac");
    await page.locator(".scanning-subline").filter({ hasText: /^[4-7] of 17 areas$/ }).waitFor({ timeout: STEP_TIMEOUT });
    await assertAboveFold(page.getByRole("button", { name: "Cancel" }), "the Cancel button");
  });
  await visit({ name: "scanning-paced-5s", volatile: true }, async () => {
    await goto("reset=1&fixture=dev-machine&onboarded=1&delay=0", { paced: true });
    await heading(page, "Overview");
    await page.getByRole("button", { name: "Run check-up" }).click();
    await page.locator(".scanning-subline").filter({ hasText: /^1[4-7] of 17 areas$/ }).waitFor({ timeout: STEP_TIMEOUT });
    await page.getByText(/^\d+ found so far/).waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "scanning-preparing", volatile: true }, async () => {
    await goto("reset=1&fixture=dev-machine&onboarded=1&delay=0", { paced: true });
    await heading(page, "Overview");
    await page.getByRole("button", { name: "Run check-up" }).click();
    await page.getByText("Preparing your report").first().waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "overview-transition", volatile: true }, async () => {
    await goto("reset=1&fixture=dev-machine&onboarded=1&delay=0", { paced: true });
    await heading(page, "Overview");
    await pacedCheckUp(page, 6000);
    await sleep(100);
  });
  await visit({ name: "scanning-prompting", volatile: true }, async () => {
    await goto("reset=1&fixture=dev-machine&onboarded=1&delay=0&automation=not_determined", { paced: true });
    await heading(page, "Overview");
    await page.getByRole("button", { name: "Run check-up" }).click();
    await page.getByText("macOS is asking whether Talos Labs may read your login items").waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "scanning-reduced-motion", volatile: true }, async () => {
    await goto("reset=1&fixture=dev-machine&onboarded=1&delay=0", { paced: true, reducedMotion: true });
    await heading(page, "Overview");
    await page.getByRole("button", { name: "Run check-up" }).click();
    await page.locator(".scanning-subline").filter({ hasText: /^[6-9] of 17 areas$/ }).waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "overview-after-reduced-motion" }, async () => {
    await goto("reset=1&fixture=dev-machine&onboarded=1&delay=0", { paced: true, reducedMotion: true });
    await heading(page, "Overview");
    await pacedCheckUp(page, 4500);
  });

  // Other fixtures.
  await visit({ name: "overview-all-unavailable" }, async () => {
    await goto("reset=1&fixture=all-unavailable&onboarded=1");
    await runCheckUp(page);
    await heading(page, "Nothing could be checked", 2);
    await heading(page, "Couldn't check", 2);
  });
  await visit({ name: "findings-all-unavailable" }, async () => {
    await nav(page, "Findings");
    await heading(page, "Findings");
    await page.locator("section[aria-labelledby='group-couldn-t-check'] article.finding-card").first().waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "finding-unknown-all-unavailable" }, async () => {
    await page.locator("section[aria-labelledby='group-couldn-t-check'] article.finding-card a.finding-card-title").first().click();
    await heading(page, /^Couldn't check whether/);
  });
  await visit({ name: "overview-hardened" }, async () => {
    await goto("reset=1&fixture=hardened&onboarded=1");
    await runCheckUp(page);
    await heading(page, "Nothing needs fixing", 2);
  });
  await visit({ name: "overview-fresh-install" }, async () => {
    await goto("reset=1&fixture=fresh-install&onboarded=1");
    await runCheckUp(page);
  });
  await visit({ name: "overview-windows-minimal" }, async () => {
    await goto("reset=1&fixture=windows-minimal&onboarded=1");
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
