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

export type WalkName = "expert" | "guided" | "ai" | "watch" | "accept";
const WALK_NAMES: readonly WalkName[] = ["expert", "guided", "ai", "watch", "accept"];

/** `--only expert|guided|ai|watch|accept` limits a script to one walk; absent, every walk runs. */
export function parseOnly(argv: readonly string[]): WalkName | null {
  const index = argv.indexOf("--only");
  const raw = index >= 0 ? argv[index + 1] : argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);
  if (raw === undefined) return null;
  if (!(WALK_NAMES as readonly string[]).includes(raw)) throw new Error(`bad --only: ${raw} (expected ${WALK_NAMES.join(", ")})`);
  return raw as WalkName;
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
  /** A fixed window size instead of the two app sizes: the 320 px watch window. */
  readonly size?: { readonly width: number; readonly height: number };
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
  await settleScore(page);
}

/** The score ring eases up over 900 ms; waits until its figure matches the meter value, or there is no ring. */
async function settleScore(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const meter = document.querySelector(".score-meter [role='meter']");
      if (meter === null) return true;
      const figure = meter.querySelector(".score-meter-figure")?.textContent?.trim();
      return figure === meter.getAttribute("aria-valuenow");
    },
    undefined,
    { timeout: STEP_TIMEOUT },
  );
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
  /** An id, a boolean (the licensed flag of watch_set_profile), a number or a list of ids; never a URL or machine text. */
  readonly arg?: string | number | boolean | readonly string[];
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
  // The v0.2 walk covers the expert home; guided=0 keeps it there (DESIGN-V03.md section 7, Harness).
  const url = (query: string, options: { paced?: boolean } = {}) => `${baseUrl}/?${query}&guided=0${options.paced === true ? "" : "&pace=0"}`;
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
  // The shot keeps its name from v0.2; the rows now carry no inline action, so it asserts the row shape instead.
  await visit({ name: "overview-inline-actions" }, async () => {
    const rows = page.locator("section[aria-labelledby='next-fixes'] article.finding-card");
    if ((await rows.count()) < 3) throw new Error("the next three fixes should be three rows");
    if ((await rows.locator("button").count()) > 0) throw new Error("a finding row carries no inline action; the row opens the finding");
    if ((await rows.locator(".finding-card-cost").count()) < 3) throw new Error("each row names how the fix is applied");
    if ((await rows.and(page.locator(".finding-fail.finding-sev-critical, .finding-fail.finding-sev-high")).count()) === 0) throw new Error("a critical or high row carries the severity cue class");
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
  // AI is free once connected (owner decision 2026-10-17): no licence, ChatGPT connected, the composer and an answer.
  const FREE_CONNECTED = "reset=1&fixture=dev-machine&onboarded=1&delay=0&provider=chatgpt&ai=available";
  await visit({ name: "ask-free-connected" }, async () => {
    await goto(FREE_CONNECTED);
    await runCheckUp(page);
    await nav(page, "Ask");
    await heading(page, "Ask about your report");
    if ((await page.getByPlaceholder("Paste your licence key").count()) !== 0) throw new Error("Ask draws a licence field for an unlicensed person");
    await page.getByLabel("Your question").fill("Which of these should I do first?");
    await page.locator("form.ask-form").getByRole("button", { name: "Ask" }).click();
    await page.locator(".chat-streaming").waitFor({ state: "detached", timeout: STEP_TIMEOUT });
    await page.locator(".chat-assistant").first().waitFor({ timeout: STEP_TIMEOUT });
    await page.getByText("Written by ChatGPT. Not verified.").first().waitFor({ timeout: STEP_TIMEOUT });
    if ((await page.getByPlaceholder("Paste your licence key").count()) !== 0) throw new Error("Ask draws a licence field for an unlicensed person");
  });
  // A non-free failing finding: the explanation is free, the fix stays behind its lock with the new body.
  await visit({ name: "explain-free" }, async () => {
    await goto(FREE_CONNECTED);
    await runCheckUp(page);
    await nav(page, "Findings");
    await heading(page, "Findings");
    await openCard(page, /Your Mac answers network probes/);
    const card = page.locator(".ai-card[data-ai-state='available_idle']");
    await card.waitFor({ timeout: STEP_TIMEOUT });
    await card.getByRole("button", { name: "Explain this for me" }).waitFor({ timeout: STEP_TIMEOUT });
    if ((await page.locator(".ai-card.ai-locked").count()) !== 0) throw new Error("the AI card is locked");
    const lock = page.getByRole("region", { name: "This fix is part of the full version" });
    await lock.waitFor({ timeout: STEP_TIMEOUT });
    await lock.getByText("The three most valuable fixes are free. A licence unlocks every fix, Check again and the menu bar watch.", { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    if ((await page.getByPlaceholder("Paste your licence key").count()) !== 1) throw new Error("one licence field, the fix lock's");
  });

  // Dev machine, licensed, on-device AI (fake).
  await visit({ name: "ask-streaming", volatile: true }, async () => {
    await goto(LICENSED);
    await runCheckUp(page);
    await nav(page, "Ask");
    await heading(page, "Ask about your report");
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
  "html, body, #root { height: auto !important; } #root, .shell { min-height: 100vh; } .shell { height: auto !important; } .content { overflow: visible !important; } .findings-aside { position: static !important; max-height: none !important; } *, *::before, *::after { transition: none !important; animation: none !important; }";

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
export async function captureWholeScreen(page: Page, size: { width: number; height: number }, scheme: Scheme, file: string, options: { fixed?: boolean } = {}): Promise<void> {
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: scheme });
  // Park the pointer so the row under the last click is not captured in its hover state.
  await page.mouse.move(0, 0);
  await unrollPage(page);
  await settle(page);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  // A fixed window (the watch) is captured at its own size, clipping and all.
  if (options.fixed !== true && height > size.height) {
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

/** The pasted demo key, for the paywall step. */
const GUIDED_KEY = DEMO_LICENSE_KEY_PASTED;
/** copy.ts PAYWALL.body: the one sentence the free version reads about the watch on the guided path. */
const PAYWALL_BODY = "The full version does them all and keeps an eye on your Mac from the menu bar.";
/** Settings.tsx FREE_LINE and PAID_LINE: the Licence section's two lines while unlicensed. */
const SETTINGS_FREE_LINE = "Free: the check-up, your AI and the three most valuable fixes";
const SETTINGS_PAID_LINE = "A licence adds every fix, Check again and the menu bar watch, which starts when you paste a key.";
const DEV = "reset=1&fixture=dev-machine&onboarded=1&delay=0";
const DEV_LICENSED = `${DEV}&licensed=1`;

/** A synthetic blur pauses the guide's auto-advance and stale timers, so a done line can be captured. */
async function blur(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
}
async function focus(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
}

/** Every guided shot: exactly one primary and at most one link, both above the 600 px fold at 900x600. The end screens keep "Check again" under the groups, so `foldLink: false` lets it scroll. */
export async function assertGuidedScreen(page: Page, options: { primaries?: number; foldLink?: boolean; fold?: boolean } = {}): Promise<void> {
  const want = options.primaries ?? 1;
  const primaries = await page.locator(".guided .button-primary").count();
  if (primaries !== want) throw new Error(`expected ${want} primary button(s), found ${primaries}`);
  const links = await page.locator(".guided .guided-link").count();
  if (links > 1) throw new Error(`expected at most one guided link, found ${links}`);
  const size = page.viewportSize();
  if (options.fold !== false && size !== null && size.height <= MIN_HEIGHT) {
    if (primaries > 0) await assertAboveFold(page.locator(".guided .button-primary").first(), "the primary button");
    if (links > 0 && options.foldLink !== false) await assertAboveFold(page.locator(".guided .guided-link").first(), "the link");
  }
}

/** The end screen's "Do this next" card: the one primary, the cue class, and the spiral and horizon bands around it. */
async function assertEndScreen(page: Page, next: { label: string; cue: "critical" | "high" | null } | null): Promise<void> {
  await assertGuidedScreen(page, { primaries: next === null ? 0 : 1, foldLink: false });
  // The bands are asked for in an effect, so they land a frame after the headline.
  await page.locator(".guided-content > .hero-spiral").waitFor({ timeout: STEP_TIMEOUT });
  await page.locator(".guided-content > .hero-horizon").waitFor({ timeout: STEP_TIMEOUT });
  const cards = await page.locator(".guided-next-card").count();
  if (next === null) {
    if (cards !== 0) throw new Error("the end screen shows a next card with nothing to do");
    return;
  }
  if (cards !== 1) throw new Error(`expected one next card, found ${cards}`);
  const label = (await page.locator(".guided-next-card .button-primary").textContent())?.trim();
  if (label !== next.label) throw new Error(`the next button reads "${label}", expected "${next.label}"`);
  const className = (await page.locator(".guided-next-card").getAttribute("class")) ?? "";
  const cue = className.includes("guided-next-critical") ? "critical" : className.includes("guided-next-high") ? "high" : null;
  if (cue !== next.cue) throw new Error(`the next card cue is ${cue}, expected ${next.cue}`);
  const rows = page.locator(".guided-end-row");
  if ((await rows.count()) > 0) {
    const box = await rows.first().boundingBox();
    if (box !== null && box.height < 40) throw new Error(`the first end row is ${box.height} px tall, under 44`);
  }
}

async function guidedTitle(page: Page, name: string | RegExp): Promise<void> {
  await page.locator(".guided h1").filter({ hasText: name }).first().waitFor({ timeout: STEP_TIMEOUT });
}

async function primary(page: Page, name: string | RegExp): Promise<void> {
  await page.locator(".guided .button-primary").filter({ hasText: name }).first().click();
}

async function link(page: Page, name: string | RegExp): Promise<void> {
  await page.locator(".guided .guided-link").filter({ hasText: name }).first().click();
}

async function progressTotal(page: Page): Promise<number> {
  const text = await page.locator(".guided-progress .guided-meta").first().textContent();
  const match = /of (\d+)/.exec(text ?? "");
  return match === null ? 0 : Number(match[1]);
}

/** The guided screens, light and dark, both sizes. */
export async function walkGuided(page: Page, baseUrl: string, visit: Visit): Promise<void> {
  // The progress total may only grow within one walk; every goto starts a new one.
  let lastTotal = 0;
  const goto = async (query: string, options: { paced?: boolean; reducedMotion?: boolean } = {}) => {
    await page.emulateMedia({ reducedMotion: options.reducedMotion === true ? "reduce" : "no-preference" });
    await page.goto(`${baseUrl}/?${query}${options.paced === true ? "" : "&pace=0"}`);
    lastTotal = 0;
  };
  const totalNeverDrops = async () => {
    const total = await progressTotal(page);
    if (total < lastTotal) throw new Error(`the progress total went down from ${lastTotal} to ${total}`);
    lastTotal = total;
  };

  await visit({ name: "guided-welcome" }, async () => {
    await goto("reset=1&fixture=dev-machine&delay=0");
    await guidedTitle(page, "Let's check your Mac.");
    await page.locator(".guided-content > .hero-spiral").waitFor({ timeout: STEP_TIMEOUT });
    await assertGuidedScreen(page);
    if ((await page.getByRole("button", { name: "Skip" }).count()) !== 0) throw new Error("the guided welcome has no Skip");
  });
  await visit({ name: "guided-scanning", volatile: true }, async () => {
    await goto("reset=1&fixture=dev-machine&delay=0", { paced: true });
    await primary(page, "Start");
    await page.locator(".guided-strip-title").filter({ hasText: "Checking your Mac" }).waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".scanning-subline").filter({ hasText: /of 17 areas$/ }).waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "guided-stopped" }, async () => {
    await page.getByRole("button", { name: "Cancel" }).click();
    await guidedTitle(page, "I stopped before finishing.");
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-plan" }, async () => {
    const started = Date.now();
    await goto(DEV, { paced: true });
    await guidedTitle(page, "I found 3 things to fix.");
    await page.locator(".guided-urgent").filter({ hasText: "One of these is urgent." }).waitFor({ timeout: STEP_TIMEOUT });
    const took = Date.now() - started;
    if (took < 6000) throw new Error(`the plan was reached after ${took} ms, before the 6000 ms floor`);
    await assertGuidedScreen(page);
    lastTotal = 0;
    await totalNeverDrops();
  });
  await visit({ name: "guided-plan-list" }, async () => {
    await link(page, "Show me the list");
    await page.locator(".guided-list").waitFor({ timeout: STEP_TIMEOUT });
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-since" }, async () => {
    await goto(`${DEV}&since=1`);
    await guidedTitle(page, "Since last time.");
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-batch-confirm" }, async () => {
    await goto(`${DEV_LICENSED}&fix_delay=0`);
    await guidedTitle(page, "I found 7 things to fix.");
    await primary(page, "Let's go");
    await guidedTitle(page, "I can fix 3 things for you now.");
    await assertGuidedScreen(page);
    await totalNeverDrops();
  });
  await visit({ name: "guided-batch-working", volatile: true }, async () => {
    await goto(`${DEV_LICENSED}&fix_delay=4000`);
    await primary(page, "Let's go");
    await blur(page);
    await primary(page, "Fix these for me");
    // One idea while it runs: the password sentence is headline and body, the activity rows name the password step, the list is gone.
    await guidedTitle(page, "Your Mac is asking for your password.");
    await page.locator(".guided .guided-activity .activity-word").filter({ hasText: "your password" }).first().waitFor({ timeout: STEP_TIMEOUT });
    if ((await page.locator(".guided .guided-list").count()) !== 0) throw new Error("the working batch shows no list");
    await assertGuidedScreen(page, { primaries: 0 });
    if ((await page.locator(".guided .guided-link").count()) !== 0) throw new Error("the batch exposes no cancel while it runs");
  });
  await visit({ name: "guided-batch-done" }, async () => {
    await goto(`${DEV_LICENSED}&batch=ok&fix_delay=0`);
    await primary(page, "Let's go");
    await blur(page);
    await primary(page, "Fix these for me");
    await guidedTitle(page, "Done. 3 things fixed.");
    await page.locator(".guided [role='status']").filter({ hasText: "Done. 3 things fixed." }).waitFor({ timeout: STEP_TIMEOUT });
    await assertGuidedScreen(page, { primaries: 0 });
    const calls = await demoCalls(page);
    const preview = calls.find((c) => c.kind === "fixPreviewBatch");
    if (preview === undefined || JSON.stringify(preview.arg) !== JSON.stringify(["TL-MAC-002", "TL-MAC-003", "TL-MAC-011"])) throw new Error(`no fixPreviewBatch for the three rules: ${JSON.stringify(calls)}`);
    if (calls.filter((c) => c.kind === "fixApplyBatch").length !== 1) throw new Error(`expected one fixApplyBatch: ${JSON.stringify(calls)}`);
    await assertNoUrlRecorded(page);
  });
  await visit({ name: "guided-batch-partial" }, async () => {
    await goto(`${DEV_LICENSED}&batch=partial&fix_delay=0`);
    await primary(page, "Let's go");
    const before = await progressTotal(page);
    await blur(page);
    await primary(page, "Fix these for me");
    await guidedTitle(page, "2 of 3 fixed.");
    await assertGuidedScreen(page);
    const after = await progressTotal(page);
    if (after < before) throw new Error(`the total went from ${before} to ${after} on a partial batch`);
  });
  for (const outcome of ["cancelled", "wrong_password"] as const) {
    await visit({ name: `guided-batch-${outcome.replace(/_/g, "-")}` }, async () => {
      await goto(`${DEV_LICENSED}&batch=${outcome}&fix_delay=0`);
      await primary(page, "Let's go");
      await primary(page, "Fix these for me");
      await guidedTitle(page, outcome === "cancelled" ? "You closed the password box." : "That password did not work.");
      await assertGuidedScreen(page);
    });
  }
  await visit({ name: "guided-fix-single" }, async () => {
    await goto(`${DEV}&fix_delay=0`);
    await primary(page, "Let's go");
    await guidedTitle(page, "The firewall is off");
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-fix-done" }, async () => {
    await blur(page);
    await primary(page, "Turn it on");
    await guidedTitle(page, "Done. The firewall is on.");
    await assertGuidedScreen(page, { primaries: 0 });
    const calls = await demoCalls(page);
    if (calls.filter((c) => c.kind === "fixPreview").length !== 1 || calls.filter((c) => c.kind === "fixApply").length !== 1) throw new Error(`expected one fixPreview and one fixApply: ${JSON.stringify(calls)}`);
    await assertNoUrlRecorded(page);
  });
  await visit({ name: "guided-fix-failed" }, async () => {
    await goto(`${DEV}&fix=command_failed&fix_delay=0`);
    await primary(page, "Let's go");
    await primary(page, "Turn it on");
    await guidedTitle(page, "That did not work.");
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-fix-still-failing" }, async () => {
    await goto(`${DEV}&fix=still_failing&fix_delay=0`);
    await primary(page, "Let's go");
    await primary(page, "Turn it on");
    await guidedTitle(page, "It ran, but the setting has not changed yet.");
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-show" }, async () => {
    await goto(DEV);
    await primary(page, "Let's go");
    await link(page, "Do this later");
    await guidedTitle(page, "Your disk is not locked");
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-show-watching" }, async () => {
    await blur(page);
    await primary(page, "Show me where");
    await guidedTitle(page, "I've opened the right page.");
    await page.locator(".guided-watch").waitFor({ timeout: STEP_TIMEOUT });
    await assertGuidedScreen(page, { primaries: 0 });
    await assertNoUrlRecorded(page);
  });
  await visit({ name: "guided-show-stale" }, async () => {
    await focus(page);
    await guidedTitle(page, "It doesn't look changed yet.");
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-show-passed" }, async () => {
    await goto(`${DEV}&poll_after=1`);
    await primary(page, "Let's go");
    await link(page, "Do this later");
    await blur(page);
    await primary(page, "Show me where");
    await guidedTitle(page, "Done. Your disk is locked.");
    await assertGuidedScreen(page, { primaries: 0 });
  });
  await visit({ name: "guided-later-notice" }, async () => {
    await goto(`${DEV}&memory=${encodeURIComponent(JSON.stringify({ version: 1, snoozed: {}, laterCount: {}, waiting: {}, pendingRestart: [], paywallSnoozedUntil: null, permissionAskedAt: {} }))}`);
    await primary(page, "Let's go");
    await link(page, "Do this later");
    await guidedTitle(page, "Your disk is not locked");
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-question-backup" }, async () => {
    await goto(`${DEV_LICENSED}&batch=ok&fix=ok&fix_delay=0`);
    await primary(page, "Let's go");
    await primary(page, "Fix these for me");
    await guidedTitle(page, "A shared folder has no password");
    await primary(page, "Stop sharing it");
    await guidedTitle(page, "Your Mac has no backup");
    await page.getByText("Do you have a disk for backups?").waitFor({ timeout: STEP_TIMEOUT });
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-permission" }, async () => {
    await goto("reset=1&fixture=all-unavailable&onboarded=1&delay=0");
    await primary(page, "Let's go");
    await guidedTitle(page, "Can I check your web browser too?");
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-permission-watching" }, async () => {
    await blur(page);
    await primary(page, "Show me where");
    await guidedTitle(page, "I've opened the right page.");
    await assertGuidedScreen(page, { primaries: 0 });
    const note = await page.evaluate(() => localStorage.getItem("talos.continue"));
    if (note !== JSON.stringify({ kind: "guided" })) throw new Error(`talos.continue was not written before the pane opened: ${note}`);
  });
  await visit({ name: "guided-permission-reopen" }, async () => {
    await focus(page);
    await guidedTitle(page, "Nearly there.");
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-paywall" }, async () => {
    await goto(DEV);
    await primary(page, "Let's go");
    for (let i = 0; i < 3; i += 1) await link(page, "Do this later");
    await link(page, "Not now");
    await guidedTitle(page, "There are 4 more things to fix.");
    await assertGuidedScreen(page);
    await totalNeverDrops();
  });
  await visit({ name: "guided-paywall-pasted", volatile: true }, async () => {
    await goto(DEV);
    await primary(page, "Let's go");
    for (let i = 0; i < 3; i += 1) await link(page, "Do this later");
    await link(page, "Not now");
    await guidedTitle(page, "There are 4 more things to fix.");
    await page.getByPlaceholder("Paste your licence key").fill(GUIDED_KEY);
    await page.locator(".licence-valid").waitFor({ timeout: STEP_TIMEOUT });
    await assertNoUrlRecorded(page);
  });
  await visit({ name: "guided-explain", volatile: true }, async () => {
    await goto(`${DEV_LICENSED}&fix_delay=0`);
    await primary(page, "Let's go");
    await page.locator(".guided-explain summary").click();
    await page.locator(".guided-explain-body").waitFor({ timeout: STEP_TIMEOUT });
    // The fold check covers the streamed state, so wait for the "Writing" line to go.
    await page.locator(".guided-explain-body [role='status']").waitFor({ state: "detached", timeout: STEP_TIMEOUT });
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-failed" }, async () => {
    await goto(`${DEV}&scan_error=collector_crashed`);
    await guidedTitle(page, "I couldn't finish checking.");
    await assertGuidedScreen(page);
    await primary(page, "Try again");
    await guidedTitle(page, "I found 3 things to fix.");
  });
  await visit({ name: "guided-end-all-done" }, async () => {
    await goto(`${DEV_LICENSED}&batch=ok&fix=ok&poll_after=1&fda_after=1&fix_delay=0`);
    await primary(page, "Let's go");
    await primary(page, "Fix these for me");
    await guidedTitle(page, "A shared folder has no password");
    await primary(page, "Stop sharing it");
    await guidedTitle(page, "Your Mac has no backup");
    await primary(page, "Yes, show me where");
    await guidedTitle(page, "Your disk is not locked");
    await primary(page, "Show me where");
    // The batch's recheck of the updates area clears 010 on this fixture, so the update step may already be gone.
    await guidedTitle(page, /An update is waiting|Can I check your web browser too\?/);
    if ((await page.locator(".guided h1").filter({ hasText: "An update is waiting" }).count()) > 0) {
      await primary(page, "Show me where");
      await guidedTitle(page, "Can I check your web browser too?");
    }
    await primary(page, "Show me where");
    await guidedTitle(page, "Your Mac is in good shape.");
    // 014 (automatic login, low) is left alone on this fixture; a low rule left alone is not raised again.
    await assertEndScreen(page, null);
  });
  await visit({ name: "guided-end-partial" }, async () => {
    await goto(`${DEV}&fix=ok&fix_delay=0`);
    await primary(page, "Let's go");
    await primary(page, "Turn it on");
    await guidedTitle(page, "Your disk is not locked");
    await link(page, "Do this later");
    await link(page, "Do this later");
    await link(page, "Not now");
    await link(page, "Not now");
    await guidedTitle(page, "Your Mac is safer than it was.");
    await page.getByText(/^Your disk is not locked\. That is the biggest risk left\.$/).waitFor({ timeout: STEP_TIMEOUT });
    await assertEndScreen(page, { label: "Show me where", cue: "critical" });
  });
  await visit({ name: "guided-end-nothing" }, async () => {
    await goto("reset=1&fixture=hardened&onboarded=1&delay=0");
    await guidedTitle(page, "Nothing needs fixing.");
    await assertEndScreen(page, null);
  });
  await visit({ name: "guided-end-unreadable" }, async () => {
    await goto("reset=1&fixture=all-unavailable&onboarded=1&delay=0");
    await primary(page, "Let's go");
    await link(page, "Not now");
    await guidedTitle(page, "I couldn't check your Mac.");
    await page.getByText(/^I couldn't check \d+ areas\./).waitFor({ timeout: STEP_TIMEOUT });
    await assertEndScreen(page, null);
  });
  await visit({ name: "guided-reduced-motion" }, async () => {
    const started = Date.now();
    await goto(DEV, { paced: true, reducedMotion: true });
    await guidedTitle(page, "I found 3 things to fix.");
    const took = Date.now() - started;
    if (took < 4500) throw new Error(`the plan was reached after ${took} ms, before the 4500 ms reduced-motion floor`);
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-dev-what-will-run", volatile: true }, async () => {
    await goto(`${DEV_LICENSED}&dev=1&fix_delay=4000`);
    await primary(page, "Let's go");
    await blur(page);
    await primary(page, "Fix these for me");
    await page.locator(".guided-dev").waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "overview-with-checkup-row" }, async () => {
    await goto(DEV);
    await guidedTitle(page, "I found 3 things to fix.");
    await page.locator(".guided-strip-link").filter({ hasText: "Details" }).click();
    await heading(page, "Overview");
    await page.locator("aside.sidebar").getByRole("button", { name: "Check-up", exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    await page.locator("button.toolbar-back").filter({ hasText: "Check-up" }).waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "settings-checkup" }, async () => {
    await nav(page, "Settings");
    await heading(page, "Settings");
    await page.getByRole("switch", { name: "Start on the guided check-up" }).waitFor({ timeout: STEP_TIMEOUT });
  });
}

/** The Settings pill and the Disconnect button per seeded ChatGPT state (DESIGN-AI.md section 5). */
const SETTINGS_AI_STATES = [
  { name: "connected", ai: "available", pill: "Connected", disconnect: true },
  { name: "not-connected", ai: "not_connected", pill: "Not connected", disconnect: false },
  { name: "needs-sign-in", ai: "needs_sign_in", pill: "Needs sign-in", disconnect: true },
  { name: "limit-reached", ai: "limit_reached", pill: "Limit reached", disconnect: true },
  { name: "not-offered", ai: "not_offered", pill: "Not available yet", disconnect: false },
] as const;

/** The Overview card line and action per provider state (DESIGN-AI.md section 4, "Overview AiCard"), ChatGPT seeded. */
const OVERVIEW_AI_STATES = [
  { ai: "not_connected", text: "Get the order explained by the AI you already use.", action: "Connect my AI" },
  { ai: "connecting", text: "Waiting for you to sign in to ChatGPT in your browser.", action: "Cancel" },
  { ai: "needs_sign_in", text: "ChatGPT signed me out.", action: "Sign in again" },
  { ai: "limit_reached", text: /^Your ChatGPT allowance is used up for now\. It comes back at \d{2}:\d{2}\.$/, action: null },
  { ai: "plan_not_eligible", text: "That ChatGPT account's plan doesn't include this. Plus or Pro is needed.", action: "Choose another" },
  { ai: "provider_unavailable", text: "ChatGPT didn't answer.", action: "Try again" },
  { ai: "not_offered", text: "ChatGPT isn't available in this version yet.", action: "Choose another" },
] as const;

/** The connect failures: the demo outcome, the headline and sentence, the primary (DESIGN-AI.md section 4, "Connect failures"). */
const CONNECT_FAILURES = [
  { name: "closed", connect: "closed", provider: "chatgpt", title: "You stopped before signing in.", body: "Nothing was connected.", primary: "Try again" },
  { name: "plan", connect: "plan_not_eligible", provider: "chatgpt", title: "That account's plan doesn't include this.", body: "ChatGPT Plus or Pro is needed.", primary: "Choose another" },
  { name: "unavailable", connect: "unavailable", provider: "chatgpt", title: "ChatGPT didn't answer.", body: "Nothing was connected. Try again in a little while.", primary: "Try again" },
  { name: "timeout", connect: "timeout", provider: "chatgpt", title: "I stopped waiting.", body: "Nothing was connected.", primary: "Try again" },
  { name: "fetch", connect: "fetch_failed", provider: "claude_plan", title: "I couldn't fetch Claude's helper.", body: "Check your internet connection and try again.", primary: "Try again" },
] as const;

/** Today at 18:00 local time, the `until` of a limit_reached shot; the card prints it as "It comes back at 18:00." */
function limitUntil(): string {
  const date = new Date();
  date.setHours(18, 0, 0, 0);
  return date.toISOString();
}

/** The AI-layer shots (DESIGN-AI.md section 11): the Connect screen, the Explain disclosure, the end-screen row, Settings, Ask and the Overview card. */
export async function walkAi(page: Page, baseUrl: string, visit: Visit): Promise<void> {
  // Base G: a dev-machine check-up with the Welcome skipped and every timer collapsed; the provider is seeded as not connected.
  const G = "reset=1&onboarded=1&delay=0";
  const CHATGPT = `${G}&provider=chatgpt&ai=not_connected`;
  const CLAUDE = `${G}&provider=claude_plan&ai=not_connected`;
  const EXPERT = `${G}&guided=0&provider=chatgpt`;
  const AI_UNTIL = encodeURIComponent(limitUntil());
  let lastTotal = 0;
  // pace=0 collapses the guided timers; the done tick needs a pace so it stays long enough to capture.
  const goto = async (query: string, options: { pace?: number } = {}) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(`${baseUrl}/?${query}&pace=${options.pace ?? 0}`);
    lastTotal = 0;
  };
  const totalNeverDrops = async () => {
    const total = await progressTotal(page);
    if (total < lastTotal) throw new Error(`the progress total went down from ${lastTotal} to ${total}`);
    lastTotal = total;
  };
  const radio = (value: "chatgpt" | "claude_plan" | "apple") => page.locator(`.guided-choice input[name='ai-provider'][value='${value}']`);

  /** The first fix step with its disclosure open on the not-connected body. */
  const openExplainNotConnected = async (query: string, options: { pace?: number } = {}) => {
    await goto(query, options);
    await primary(page, "Let's go");
    await guidedTitle(page, "The firewall is off");
    await page.locator(".guided-explain summary").click();
    await page.locator(".guided-explain-connect").waitFor({ timeout: STEP_TIMEOUT });
    await totalNeverDrops();
  };
  /** The Connect screen, reached from the disclosure's "Connect my AI". */
  const openConnect = async (query: string, options: { pace?: number } = {}) => {
    await openExplainNotConnected(query, options);
    await page.locator(".guided-explain-connect").getByRole("button", { name: "Connect my AI" }).click();
    await guidedTitle(page, "Which AI do you use?");
    await page.getByRole("radiogroup", { name: "Which AI do you use?" }).waitFor({ timeout: STEP_TIMEOUT });
  };
  /** A connecting screen: no primary, a live status line, and Cancel as the one link on the browser screen (none on the Claude fetch). */
  const assertConnecting = async ({ cancel = true }: { cancel?: boolean } = {}) => {
    await assertGuidedScreen(page, { primaries: 0 });
    const links = page.locator(".guided .guided-link");
    if (cancel) {
      if ((await links.count()) !== 1 || (await links.first().textContent())?.trim() !== "Cancel") throw new Error("Cancel is the only link while connecting");
    } else if ((await links.count()) !== 0) throw new Error("the fetch screen has no link");
    await page.locator(".guided-connect-status[role='status']").waitFor({ timeout: STEP_TIMEOUT });
  };
  /** The demo recorded the start for `provider` and, as everywhere, never a URL. */
  const assertConnectStarted = async (provider: "chatgpt" | "claude_plan") => {
    const calls = await demoCalls(page);
    if (!calls.some((c) => c.kind === "aiConnectStart" && c.arg === provider)) throw new Error(`no aiConnectStart for ${provider}: ${JSON.stringify(calls)}`);
    await assertNoUrlRecorded(page);
  };
  const primaryLabel = async (): Promise<string> => ((await page.locator(".guided .button-primary").first().textContent()) ?? "").trim();

  await visit({ name: "guided-explain-not-connected" }, async () => {
    await openExplainNotConnected(CHATGPT);
    const body = page.locator(".guided-explain-connect");
    await body.getByText(/^Talos Labs can explain each of these using the AI you already pay for, .*Nothing to install and no extra cost\.$/).waitFor({ timeout: STEP_TIMEOUT });
    await body.getByRole("button", { name: "Connect my AI" }).waitFor({ timeout: STEP_TIMEOUT });
    await body.getByRole("button", { name: "Not now" }).waitFor({ timeout: STEP_TIMEOUT });
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-connect" }, async () => {
    await page.locator(".guided-explain-connect").getByRole("button", { name: "Connect my AI" }).click();
    await guidedTitle(page, "Which AI do you use?");
    await page.getByRole("radiogroup", { name: "Which AI do you use?" }).waitFor({ timeout: STEP_TIMEOUT });
    // The rows are native radios; the demo offers all three, ChatGPT first and selected.
    if ((await page.locator(".guided-choice input[type='radio'][name='ai-provider']").count()) !== 3) throw new Error("the Connect screen lists three radios");
    if (!(await radio("chatgpt").isChecked())) throw new Error("ChatGPT is the default row");
    if ((await primaryLabel()) !== "Connect ChatGPT") throw new Error(`the primary reads "${await primaryLabel()}", expected "Connect ChatGPT"`);
    // No progress line: the screen is not a step.
    if ((await page.locator(".guided-progress").count()) !== 0) throw new Error("the Connect screen shows no progress line");
    await page.locator(".guided .guided-link").filter({ hasText: "Not now" }).waitFor({ timeout: STEP_TIMEOUT });
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-connect-claude-selected" }, async () => {
    await radio("claude_plan").check();
    if ((await primaryLabel()) !== "Connect Claude") throw new Error(`the primary reads "${await primaryLabel()}", expected "Connect Claude"`);
    await radio("apple").check();
    if ((await primaryLabel()) !== "Use this Mac") throw new Error(`the primary reads "${await primaryLabel()}", expected "Use this Mac"`);
    await radio("claude_plan").check();
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-connect-not-offered" }, async () => {
    await openConnect(`${G}&provider=chatgpt&ai=not_offered`);
    if (!(await radio("chatgpt").isDisabled())) throw new Error("the ChatGPT row is disabled when the build cannot offer it");
    const row = page.locator(".guided-choice-row[aria-disabled='true']");
    if ((await row.count()) !== 1) throw new Error("one row is marked aria-disabled");
    await row.getByText("Not available yet").waitFor({ timeout: STEP_TIMEOUT });
    if ((await primaryLabel()) !== "Connect Claude") throw new Error(`the primary reads "${await primaryLabel()}", expected "Connect Claude"`);
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-connect-chatgpt-waiting", volatile: true }, async () => {
    await openConnect(`${CHATGPT}&connect=ok&connect_delay=60000`);
    await primary(page, "Connect ChatGPT");
    await guidedTitle(page, "I've opened ChatGPT in your browser.");
    await page.getByText("Sign in there and say yes when it asks. Then come back here.").waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".guided-connect-status").filter({ hasText: "I'll notice when you're done." }).waitFor({ timeout: STEP_TIMEOUT });
    await assertConnecting();
    await assertConnectStarted("chatgpt");
  });
  await visit({ name: "guided-connect-cancelled" }, async () => {
    await link(page, "Cancel");
    await guidedTitle(page, "You stopped before signing in.");
    await page.getByText("Nothing was connected.").waitFor({ timeout: STEP_TIMEOUT });
    await assertGuidedScreen(page);
    const calls = await demoCalls(page);
    if (!calls.some((c) => c.kind === "aiConnectCancel" && c.arg === "chatgpt")) throw new Error(`no aiConnectCancel recorded: ${JSON.stringify(calls)}`);
  });
  await visit({ name: "guided-connect-claude-fetching", volatile: true }, async () => {
    await openConnect(`${CLAUDE}&claude_fetch=1&connect_delay=60000`);
    await radio("claude_plan").check();
    await primary(page, "Connect Claude");
    await guidedTitle(page, "Getting Claude ready.");
    await page.getByText("I'm fetching Claude's own helper from Anthropic. This happens once.").waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".guided-connect-status").filter({ hasText: "About a minute." }).waitFor({ timeout: STEP_TIMEOUT });
    await assertConnecting({ cancel: false });
    await assertConnectStarted("claude_plan");
  });
  await visit({ name: "guided-connect-claude-waiting", volatile: true }, async () => {
    await openConnect(`${CLAUDE}&connect=ok&connect_delay=60000`);
    await radio("claude_plan").check();
    await primary(page, "Connect Claude");
    await guidedTitle(page, "I've opened Claude in your browser.");
    await assertConnecting();
  });
  // The tick shows for paced(1400) ms; pace=2 keeps it 2800 ms so the capture lands on it.
  await visit({ name: "guided-connect-done", volatile: true }, async () => {
    await openConnect(`${CHATGPT}&connect=ok&connect_delay=0`, { pace: 2 });
    await primary(page, "Connect ChatGPT");
    await guidedTitle(page, "Done. ChatGPT is connected.");
    await page.locator(".guided-step[data-guided-done='true']").waitFor({ timeout: STEP_TIMEOUT });
    await assertGuidedScreen(page, { primaries: 0 });
    if ((await page.locator(".guided .guided-link").count()) !== 0) throw new Error("the done screen has no link");
    await assertConnectStarted("chatgpt");
  });
  await visit({ name: "guided-explain-after-connect" }, async () => {
    // Back on the step: the disclosure that asked to connect is open and the explanation streams, then the badge names the provider.
    await guidedTitle(page, "The firewall is off");
    await page.locator(".guided-explain[open] .guided-explain-body").waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".guided-explain-body [role='status']").waitFor({ state: "detached", timeout: STEP_TIMEOUT });
    await page.locator(".guided-explain-badge").filter({ hasText: "Written by ChatGPT. Not verified." }).waitFor({ timeout: STEP_TIMEOUT });
    await assertGuidedScreen(page);
    await totalNeverDrops();
  });
  for (const failure of CONNECT_FAILURES) {
    await visit({ name: `guided-connect-failed-${failure.name}` }, async () => {
      const seeded = failure.provider === "claude_plan" ? `${CLAUDE}&claude_fetch=1` : CHATGPT;
      await openConnect(`${seeded}&connect=${failure.connect}&connect_delay=0`);
      await radio(failure.provider).check();
      await primary(page, failure.provider === "claude_plan" ? "Connect Claude" : "Connect ChatGPT");
      await guidedTitle(page, failure.title);
      await page.locator(".guided-step").getByText(failure.body, { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
      if ((await primaryLabel()) !== failure.primary) throw new Error(`the primary reads "${await primaryLabel()}", expected "${failure.primary}"`);
      await page.locator(".guided .guided-link").filter({ hasText: "Not now" }).waitFor({ timeout: STEP_TIMEOUT });
      await assertGuidedScreen(page);
      await assertConnectStarted(failure.provider);
    });
  }
  await visit({ name: "guided-connect-choose-another" }, async () => {
    // "Choose another" returns to the rows with the failed one still selectable.
    await openConnect(`${CHATGPT}&connect=plan_not_eligible&connect_delay=0`);
    await primary(page, "Connect ChatGPT");
    await guidedTitle(page, "That account's plan doesn't include this.");
    await primary(page, "Choose another");
    await guidedTitle(page, "Which AI do you use?");
    if (await radio("chatgpt").isDisabled()) throw new Error("the failed row stays selectable");
    if (!(await radio("chatgpt").isChecked())) throw new Error("the failed row is still selected");
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-connect-not-now" }, async () => {
    // "Not now" goes back to the step with the disclosure closed and writes aiAskedAt.
    await link(page, "Not now");
    await guidedTitle(page, "The firewall is off");
    if ((await page.locator(".guided-explain[open]").count()) !== 0) throw new Error("the disclosure is closed after Not now");
    const memory = await page.evaluate(() => localStorage.getItem("talos.guided"));
    if (!/"aiAskedAt":"\d{4}-/.test(memory ?? "")) throw new Error(`aiAskedAt was not written: ${memory}`);
    await assertGuidedScreen(page);
    await totalNeverDrops();
  });

  const walkToPartialEnd = async (query: string) => {
    await goto(query);
    await primary(page, "Let's go");
    await primary(page, "Turn it on");
    await guidedTitle(page, "Your disk is not locked");
    await link(page, "Do this later");
    await link(page, "Do this later");
    await link(page, "Not now");
    await link(page, "Not now");
    await guidedTitle(page, "Your Mac is safer than it was.");
  };
  await visit({ name: "guided-end-connect-row" }, async () => {
    await walkToPartialEnd(`${CHATGPT}&fix=ok&fix_delay=0`);
    const row = page.locator(".guided-end-row-connect");
    await row.waitFor({ timeout: STEP_TIMEOUT });
    if ((await row.count()) !== 1) throw new Error("one connect row on the end screen");
    if ((await row.getAttribute("aria-label")) !== "Get things explained. Connect the AI you already use") throw new Error(`the row's aria-label is ${await row.getAttribute("aria-label")}`);
    const text = (await row.textContent()) ?? "";
    if (/[·›]/.test(text)) throw new Error(`the row carries a literal separator: ${text}`);
    if (!text.includes("Get things explained") || !text.includes("Connect the AI you already use")) throw new Error(`the row text is "${text}"`);
    const box = await row.boundingBox();
    if (box === null || box.height < 44) throw new Error(`the connect row is ${box?.height} px tall, under 44`);
    if ((await page.locator(".guided-next-card .guided-end-row-connect").count()) !== 0) throw new Error("the connect row is never the next card");
    await assertEndScreen(page, { label: "Show me where", cue: "critical" });
  });
  await visit({ name: "guided-connect-from-end" }, async () => {
    await page.locator(".guided-end-row-connect").click();
    await guidedTitle(page, "Which AI do you use?");
    await assertGuidedScreen(page);
  });
  await visit({ name: "guided-end-after-not-now" }, async () => {
    // Not now returns to the end screen; the row is gone for 14 days.
    await link(page, "Not now");
    await guidedTitle(page, "Your Mac is safer than it was.");
    await page.locator(".guided-next-card").waitFor({ timeout: STEP_TIMEOUT });
    if ((await page.locator(".guided-end-row-connect").count()) !== 0) throw new Error("the row is gone after Not now");
    await assertEndScreen(page, { label: "Show me where", cue: "critical" });
  });
  await visit({ name: "guided-end-connect-row-asked" }, async () => {
    const memory = encodeURIComponent(JSON.stringify({ version: 1, aiAskedAt: new Date().toISOString() }));
    await walkToPartialEnd(`${CHATGPT}&fix=ok&fix_delay=0&memory=${memory}`);
    await page.locator(".guided-next-card").waitFor({ timeout: STEP_TIMEOUT });
    if ((await page.locator(".guided-end-row-connect").count()) !== 0) throw new Error("the connect row is skipped for 14 days after Not now");
    await assertEndScreen(page, { label: "Show me where", cue: "critical" });
  });
  await visit({ name: "guided-paywall-yearly" }, async () => {
    await goto(CHATGPT);
    await primary(page, "Let's go");
    for (let i = 0; i < 3; i += 1) await link(page, "Do this later");
    await link(page, "Not now");
    await guidedTitle(page, "There are 4 more things to fix.");
    await page.getByText(PAYWALL_BODY, { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    if ((await primaryLabel()) !== "Buy the full version, €24 a year") throw new Error(`the buy button reads "${await primaryLabel()}"`);
    if ((await page.getByText("One payment, yours to keep.").count()) !== 0) throw new Error("the one-payment sentence is gone under the yearly price");
    await assertGuidedScreen(page);
  });
  // The paywall with the AI connected: the sentence names the watch, not the AI; one primary, one link.
  await visit({ name: "paywall-with-watch" }, async () => {
    await goto(`${CHATGPT.replace("ai=not_connected", "ai=available")}`);
    await primary(page, "Let's go");
    for (let i = 0; i < 3; i += 1) await link(page, "Do this later");
    await link(page, "Not now");
    await guidedTitle(page, "There are 4 more things to fix.");
    await page.getByText(PAYWALL_BODY, { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    const body = (await page.locator(".guided-body").textContent()) ?? "";
    if (/\bAI\b|ChatGPT|Claude|explain/i.test(body)) throw new Error(`the paywall body mentions the AI: ${body}`);
    if ((await page.locator(".button-primary").count()) !== 1 || (await primaryLabel()) !== "Buy the full version, €24 a year") throw new Error("one primary, the buy button");
    const links = page.locator(".guided-link");
    if ((await links.count()) !== 1 || (await links.first().textContent())?.trim() !== "Not now") throw new Error("one link, Not now");
    await assertGuidedScreen(page);
  });

  // Expert shell: Settings, Ask and the Overview card, ChatGPT seeded in each state.
  for (const row of SETTINGS_AI_STATES) {
    await visit({ name: `settings-your-ai-${row.name}` }, async () => {
      await goto(`${EXPERT}&ai=${row.ai}${row.ai === "limit_reached" ? `&ai_until=${AI_UNTIL}` : ""}`);
      await nav(page, "Settings");
      await heading(page, "Settings");
      await heading(page, "Your AI", 2);
      const section = page.locator("section[aria-labelledby='ai-heading']");
      await section.locator(".your-ai-name").filter({ hasText: "ChatGPT" }).waitFor({ timeout: STEP_TIMEOUT });
      await section.locator(".your-ai-pill").filter({ hasText: row.pill }).waitFor({ timeout: STEP_TIMEOUT });
      await section.getByRole("button", { name: "Change" }).waitFor({ timeout: STEP_TIMEOUT });
      const disconnect = await section.getByRole("button", { name: "Disconnect" }).count();
      if (disconnect !== (row.disconnect ? 1 : 0)) throw new Error(`Disconnect ${row.disconnect ? "missing" : "shown"} for ${row.ai}`);
      await section.getByRole("switch", { name: "Explain things with my AI" }).waitFor({ timeout: STEP_TIMEOUT });
      await section.getByText("Talos Labs sends your AI a short summary of the check-up: which things passed or failed, and how you use your Mac. Never file names, paths, passwords or your computer's name.").waitFor({ timeout: STEP_TIMEOUT });
      // No password or key field outside Developer mode.
      if ((await page.locator("input[type='password']").count()) !== 0) throw new Error("a password field is drawn outside Developer mode");
    });
  }
  await visit({ name: "settings-your-ai-disconnected" }, async () => {
    await goto(`${EXPERT}&ai=available`);
    await nav(page, "Settings");
    await heading(page, "Your AI", 2);
    const section = page.locator("section[aria-labelledby='ai-heading']");
    await section.getByRole("button", { name: "Disconnect" }).click();
    await section.locator(".your-ai-pill").filter({ hasText: "Not connected" }).waitFor({ timeout: STEP_TIMEOUT });
    if ((await section.getByRole("button", { name: "Disconnect" }).count()) !== 0) throw new Error("Disconnect is gone once nothing is connected");
    const calls = await demoCalls(page);
    if (!calls.some((c) => c.kind === "aiDisconnect" && c.arg === "chatgpt")) throw new Error(`no aiDisconnect recorded: ${JSON.stringify(calls)}`);
    await assertNoUrlRecorded(page);
  });
  await visit({ name: "connect-from-settings" }, async () => {
    // Change opens the Connect screen in the guided shell; Not now returns to Settings.
    await page.locator("section[aria-labelledby='ai-heading']").getByRole("button", { name: "Change" }).click();
    await guidedTitle(page, "Which AI do you use?");
    await assertGuidedScreen(page);
    await link(page, "Not now");
    await heading(page, "Settings");
    await page.locator("section[aria-labelledby='ai-heading']").getByRole("button", { name: "Change" }).click();
    await guidedTitle(page, "Which AI do you use?");
  });
  await visit({ name: "ask-not-connected" }, async () => {
    await goto(`${EXPERT}&ai=not_connected`);
    await runCheckUp(page);
    await nav(page, "Ask");
    await heading(page, "Ask about your report");
    await page.getByText("Questions are answered from this report only. Answered by ChatGPT. Not verified.").waitFor({ timeout: STEP_TIMEOUT });
    const row = page.locator(".ask-connect-row");
    await row.getByText("Connect your AI to ask questions.").waitFor({ timeout: STEP_TIMEOUT });
    await row.locator("button.button").filter({ hasText: /^Connect$/ }).waitFor({ timeout: STEP_TIMEOUT });
    if (!(await page.getByLabel("Your question").isDisabled())) throw new Error("the composer is disabled until an AI is connected");
    await page.locator("form.ask-form.ask-form-disabled[aria-disabled='true']").waitFor({ timeout: STEP_TIMEOUT });
  });
  await visit({ name: "connect-from-ask" }, async () => {
    // The row's Connect opens the guided Connect screen; Not now lands back on Ask.
    await page.locator(".ask-connect-row").getByRole("button", { name: "Connect" }).click();
    await guidedTitle(page, "Which AI do you use?");
    await assertGuidedScreen(page);
    await link(page, "Not now");
    await heading(page, "Ask about your report");
    await page.locator(".ask-connect-row").getByRole("button", { name: "Connect" }).click();
    await guidedTitle(page, "Which AI do you use?");
  });
  await visit({ name: "ask-connected" }, async () => {
    await goto(`${EXPERT}&ai=available&licensed=1`);
    await runCheckUp(page);
    await nav(page, "Ask");
    await heading(page, "Ask about your report");
    await page.getByLabel("Your question").fill("Which of these should I do first?");
    await page.locator("form.ask-form").getByRole("button", { name: "Ask" }).click();
    await page.locator(".chat-streaming").waitFor({ state: "detached", timeout: STEP_TIMEOUT });
    await page.locator(".chat-assistant").first().waitFor({ timeout: STEP_TIMEOUT });
    await page.getByText("Written by ChatGPT. Not verified.").first().waitFor({ timeout: STEP_TIMEOUT });
  });
  for (const row of OVERVIEW_AI_STATES) {
    await visit({ name: `overview-ai-${row.ai.replace(/_/g, "-")}` }, async () => {
      await goto(`${EXPERT}&ai=${row.ai}${row.ai === "limit_reached" ? `&ai_until=${AI_UNTIL}` : ""}`);
      await runCheckUp(page);
      const card = page.locator(`.ai-card[data-ai-state="${row.ai}"]`);
      await card.waitFor({ timeout: STEP_TIMEOUT });
      await card.locator(".ai-card-head p").filter({ hasText: row.text }).waitFor({ timeout: STEP_TIMEOUT });
      const buttons = card.locator(".ai-card-head button");
      if (row.action === null) {
        if ((await buttons.count()) !== 0) throw new Error(`the ${row.ai} card has no action`);
      } else {
        if ((await buttons.count()) !== 1) throw new Error(`the ${row.ai} card has one action`);
        await buttons.filter({ hasText: row.action }).waitFor({ timeout: STEP_TIMEOUT });
      }
      if (row.ai === "limit_reached") await card.locator(".ai-card-until").waitFor({ timeout: STEP_TIMEOUT });
      if (row.ai === "not_connected") {
        // Connect my AI opens the Connect screen and returns to the Overview.
        await buttons.first().click();
        await guidedTitle(page, "Which AI do you use?");
        await link(page, "Not now");
        await heading(page, "Overview");
        await card.waitFor({ timeout: STEP_TIMEOUT });
        await settleScore(page);
      }
    });
  }
  await visit({ name: "overview-ai-connected" }, async () => {
    await goto(`${EXPERT}&ai=available&licensed=1`);
    await runCheckUp(page);
    await page.getByRole("button", { name: "Suggest an order" }).click();
    await page.locator(".ai-card[data-ai-state='ready']").waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".ai-card-foot").filter({ hasText: "Written by ChatGPT. Not verified." }).waitFor({ timeout: STEP_TIMEOUT });
    await assertNoUrlRecorded(page);
  });
  // The same card without a licence: the order is free once the AI is connected.
  await visit({ name: "overview-ai-free" }, async () => {
    await goto(`${EXPERT}&ai=available`);
    await runCheckUp(page);
    if ((await page.getByPlaceholder("Paste your licence key").count()) !== 0) throw new Error("the Overview card draws a licence field");
    await page.locator(".ai-card[data-ai-state='available_idle']").waitFor({ timeout: STEP_TIMEOUT });
    await page.getByRole("button", { name: "Suggest an order" }).click();
    await page.locator(".ai-card[data-ai-state='ready']").waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".ai-card-foot").filter({ hasText: "Written by ChatGPT. Not verified." }).waitFor({ timeout: STEP_TIMEOUT });
    await assertNoUrlRecorded(page);
  });
}

/** The watch window is 320 px wide and at most 360 px tall (DESIGN-WATCH.md section 5). */
export const WATCH_WINDOW_SIZE = { width: 320, height: 360 } as const;
/** Height to content per state, as tray.rs `window_height` sizes the real window: 170 first run, 150 calm, 280 look, 360 act. */
const WATCH_WINDOW_HEIGHTS = { calm: 150, look: 280, act: 360, unreadable: 150, "first-run": 170 } as const;

/** The window states the demo serves, the status word and the one primary each shows (DESIGN-WATCH.md section 5). */
const WATCH_WINDOW_STATES = [
  { state: "calm", status: "Nothing changed", primary: null },
  { state: "look", status: "One thing to look at", primary: "Show me" },
  { state: "act", status: "Act now", primary: "See what to do" },
  { state: "unreadable", status: "Nothing changed", primary: null },
  { state: "first-run", status: null, primary: null },
] as const;

/** Screen 1's headline per kind (DESIGN-WATCH.md section 6). */
const FISHY_HEADLINES = {
  persistence: "A new program started running on its own",
  listener: "A new program is waiting for calls from the network",
  guard: "A built-in safety guard was switched off",
  remote: "Remote access to your Mac was turned on",
  admin: "A new admin account was added",
  dns: "The way your Mac finds websites changed",
  backup: "Your backups were switched off",
} as const;

const NOT_ANTIVIRUS = "I'm not antivirus. I read your Mac's settings and the list of programs that start on their own, then tell you when something changed. I never read your files. macOS's own virus checks do that part.";
const EVIDENCE = "I have not deleted anything. The file is still there for an expert to look at.";
const NOTICED_SOURCE = "SANS calls this identification, the step after preparation.";
const ADMIN_PASSWORD_LINE = "Your Mac will ask for your password.";

/** Layout facts the walk reports without stopping; snap and axe print them, and the QA report lists them. */
export const WARNINGS: string[] = [];

function warn(message: string): void {
  WARNINGS.push(message);
  console.error(`[qa] warning: ${message}`);
}

/** The recorded calls of one kind. */
async function callsOf(page: Page, kind: string): Promise<DemoCall[]> {
  return (await demoCalls(page)).filter((c) => c.kind === kind);
}

/** The demo recorded `kind`, with `arg` when given. */
async function assertRecorded(page: Page, kind: string, arg?: string | boolean | number): Promise<void> {
  const calls = await demoCalls(page);
  if (!calls.some((c) => c.kind === kind && (arg === undefined || c.arg === arg))) throw new Error(`no ${kind}${arg === undefined ? "" : ` with ${String(arg)}`} recorded: ${JSON.stringify(calls)}`);
}

/** The demo never recorded `kind`: the permission alert is asked for only after a button press. */
async function assertNotRecorded(page: Page, kind: string): Promise<void> {
  if ((await callsOf(page, kind)).length !== 0) throw new Error(`${kind} was recorded: ${JSON.stringify(await demoCalls(page))}`);
}

/** The watch memory in localStorage, parsed; null when nothing was written. */
async function watchMemory(page: Page): Promise<Record<string, unknown> | null> {
  const raw = await page.evaluate(() => localStorage.getItem("talos.watch"));
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

/**
 * Every fishy screen: one primary with the given label, the one link or none, no progress line,
 * the given number of source lines, Details closed unless asked, and never a password field.
 */
async function assertFishyScreen(page: Page, want: { primary: string; link: string | null; sources: number; detailsOpen?: boolean; fold?: boolean }): Promise<void> {
  // The 600 px fold rule is checked here as a collected warning, so the whole walk still runs and snap exits 2 at the end.
  // Screen 5 is a list whose "Done" closes it, like the end screen's "Check again", so it passes fold: false.
  await assertGuidedScreen(page, { primaries: 1, fold: false });
  const size = page.viewportSize();
  if (want.fold !== false && size !== null && size.height <= MIN_HEIGHT) {
    const where = `${want.detailsOpen === true ? "with Details open " : ""}at ${size.width}x${size.height}`;
    const primaryBox = await page.locator(".guided .button-primary").first().boundingBox();
    if (primaryBox !== null && primaryBox.y + primaryBox.height > MIN_HEIGHT) warn(`${where}, the primary "${want.primary}" ends ${Math.round(primaryBox.y + primaryBox.height - MIN_HEIGHT)} px under the fold`);
    if (want.link !== null) {
      const box = await page.locator(".guided .guided-link").first().boundingBox();
      if (box !== null && box.y + box.height > MIN_HEIGHT) warn(`${where}, the link "${want.link}" ends ${Math.round(box.y + box.height - MIN_HEIGHT)} px under the fold`);
    }
  }
  const primary = (await page.locator(".guided .button-primary").first().textContent())?.trim();
  if (primary !== want.primary) throw new Error(`the primary reads "${primary}", expected "${want.primary}"`);
  const links = page.locator(".guided .guided-link");
  const linkCount = await links.count();
  if (want.link === null) {
    if (linkCount !== 0) throw new Error(`expected no link, found ${linkCount}`);
  } else {
    const label = (await links.first().textContent())?.trim();
    if (linkCount !== 1 || label !== want.link) throw new Error(`the link reads "${label}" (${linkCount} links), expected "${want.link}"`);
  }
  if ((await page.locator(".guided-progress").count()) !== 0) throw new Error("a fishy screen shows no progress line");
  const sources = await page.locator(".guided .guided-source").count();
  if (sources !== want.sources) throw new Error(`expected ${want.sources} source line(s), found ${sources}`);
  const open = await page.locator(".guided .fishy-details[open]").count();
  if (open !== (want.detailsOpen === true ? 1 : 0)) throw new Error(`expected Details ${want.detailsOpen === true ? "open" : "closed"}, found ${open} open`);
  if ((await page.locator("input[type='password']").count()) !== 0) throw new Error("a fishy screen never draws a password field");
}

/** The source rows of an open Details: the phase line and the source button that opens the URL from Rust by action id. */
async function assertDetailsSource(page: Page, step: RegExp): Promise<void> {
  const details = page.locator(".guided .fishy-details[open]").first();
  await details.locator(".fishy-phase").waitFor({ timeout: STEP_TIMEOUT });
  const button = details.locator("button.fishy-source-button");
  await button.waitFor({ timeout: STEP_TIMEOUT });
  const text = (await button.textContent()) ?? "";
  if (!step.test(text)) throw new Error(`the source button reads "${text}", expected ${step}`);
  if ((await details.locator("a").count()) !== 0) throw new Error("Details carries no inline link; the URL opens from Rust");
}

/** The watch window and the "something seems fishy" flow (DESIGN-WATCH.md section 9). */
export async function walkWatch(page: Page, baseUrl: string, visit: Visit): Promise<void> {
  // Base G: a hardened check-up, which lands on the end screen at once; the watch's act-now card sits there.
  // The watch is part of the full version, so G carries the demo licence; G_FREE is the same Mac without it.
  const G_FREE = "reset=1&fixture=hardened&onboarded=1&delay=0";
  const G = `${G_FREE}&licensed=1`;
  const goto = async (query: string) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(`${baseUrl}/?${query}&pace=0`);
  };
  const actNowCard = () => page.locator(".guided-next-card.guided-next-watch");
  /** The end screen with the act-now card (its title is the watch's "Act now"), then its one primary into the flow. */
  const openFishy = async (query: string) => {
    await goto(`${G}&${query}`);
    await guidedTitle(page, "Act now");
    await actNowCard().locator(".button-primary").click();
  };
  /** The main expert list's rows; the Lockdown row under "More experts suggest" is a second list. */
  const expertRows = () => page.locator(".guided-fishy-experts .guided-end-list").first().locator(":scope > li > button.guided-end-row");
  /** Runs the screen's catalogue row and waits for the next screen; the demo records the preview and the apply. */
  const runPrimary = async (label: string, actionId: string, nextTitle: string | RegExp) => {
    await primary(page, label);
    await guidedTitle(page, nextTitle);
    await assertRecorded(page, "watch_action_preview", actionId);
    await assertRecorded(page, "watch_action_apply", actionId);
    await assertNoUrlRecorded(page);
  };

  // The 320 px window, one shot per state, at the height Rust gives that state.
  for (const row of WATCH_WINDOW_STATES) {
    const size = { width: WATCH_WINDOW_SIZE.width, height: WATCH_WINDOW_HEIGHTS[row.state] };
    await visit({ name: `watch-window-${row.state}`, size }, async () => {
      await page.setViewportSize(size);
      await page.goto(`${baseUrl}/watch.html?watch=${row.state}&pace=0`);
      const main = page.locator("main.watch:not([aria-busy])");
      await main.waitFor({ timeout: STEP_TIMEOUT });
      await assertNotRecorded(page, "watch_request_notify_permission");
      const box = await main.boundingBox();
      if (box === null || Math.round(box.width) !== WATCH_WINDOW_SIZE.width) throw new Error(`the window is ${box?.width} px wide, expected ${WATCH_WINDOW_SIZE.width}`);
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      if (scrollWidth > WATCH_WINDOW_SIZE.width) throw new Error(`the window overflows sideways: ${scrollWidth} px`);
      // Rust sizes the window per state (tray.rs window_height), so content taller than that height is clipped; the shot shows it as the window does.
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      if (height > size.height) warn(`the ${row.state} window content is ${height} px tall, over the ${size.height} px window; the bottom ${height - size.height} px is clipped`);
      // Row 1 and the primary.
      const primaries = page.locator(".watch .button-primary");
      if ((await primaries.count()) !== (row.primary === null ? 0 : 1)) throw new Error(`${row.state} shows ${await primaries.count()} primary button(s)`);
      if (row.primary !== null) await primaries.filter({ hasText: row.primary }).waitFor({ timeout: STEP_TIMEOUT });
      if (row.status === null) {
        if ((await page.locator(".watch-status").count()) !== 0) throw new Error("the first-run window has no status line");
        await page.locator(".watch-first-run-text").filter({ hasText: "I'll check your settings on a timer and tell you when something changed." }).waitFor({ timeout: STEP_TIMEOUT });
        await page.locator(".watch-first-run .watch-link").filter({ hasText: "Start me when you log in" }).waitFor({ timeout: STEP_TIMEOUT });
        if ((await page.locator(".watch-meta").count()) !== 0) throw new Error("the first-run window has no checked line before the first tick");
      } else {
        await page.locator(".watch-status[role='status']").filter({ hasText: row.status }).waitFor({ timeout: STEP_TIMEOUT });
        if ((await page.locator(".watch-status .watch-status-icon").count()) !== 1) throw new Error("the status line carries its icon");
        await page.locator(".watch-meta").filter({ hasText: /^Checked (just now|\d+ minutes ago|\d+ hours ago)/ }).waitFor({ timeout: STEP_TIMEOUT });
      }
      // Row 5: the two footer links.
      const footer = page.locator(".watch-footer .watch-link");
      if ((await footer.count()) !== 2) throw new Error("the footer holds two links");
      await footer.filter({ hasText: "Open Talos Labs" }).waitFor({ timeout: STEP_TIMEOUT });
      await footer.filter({ hasText: "Check now" }).waitFor({ timeout: STEP_TIMEOUT });
      // Per state.
      if (row.state === "act") {
        await page.locator(".watch-status-act").waitFor({ timeout: STEP_TIMEOUT });
        await page.locator(".watch-item-headline").filter({ hasText: FISHY_HEADLINES.persistence }).waitFor({ timeout: STEP_TIMEOUT });
        await page.locator(".watch-item-source").filter({ hasText: "Experts would cut it off first. CISA's ransomware checklist, step 1." }).waitFor({ timeout: STEP_TIMEOUT });
        await page.locator(".watch-item-evidence").filter({ hasText: EVIDENCE }).waitFor({ timeout: STEP_TIMEOUT });
        await assertRecorded(page, "watch:notified", "sig.persistence_new");
      } else {
        await assertNotRecorded(page, "watch:notified");
        if ((await page.locator(".watch-item-source").count()) !== 0) throw new Error("only act now carries the source line");
      }
      if (row.state === "look") {
        await page.locator(".watch-item-headline").filter({ hasText: FISHY_HEADLINES.persistence }).waitFor({ timeout: STEP_TIMEOUT });
        await page.locator(".watch-item-why").filter({ hasText: "Bad software often starts this way." }).waitFor({ timeout: STEP_TIMEOUT });
        // "Check now" runs a demo tick: the spinner line, then "Checked just now".
        await footer.filter({ hasText: "Check now" }).click();
        await page.locator(".watch-meta-checking").filter({ hasText: "Checking now" }).waitFor({ timeout: STEP_TIMEOUT });
        await page.locator(".watch-meta-checking").waitFor({ state: "detached", timeout: STEP_TIMEOUT });
        await page.locator(".watch-meta").filter({ hasText: "Checked just now" }).waitFor({ timeout: STEP_TIMEOUT });
        await assertRecorded(page, "watch_check_now");
      }
      if (row.state === "calm" || row.state === "unreadable") {
        if ((await page.locator(".watch-item").count()) !== 0) throw new Error(`${row.state} lists no item`);
      }
      if (row.state === "unreadable") {
        const line = page.locator(".watch-meta-unavailable").filter({ hasText: "I couldn't check 3 areas" });
        await line.waitFor({ timeout: STEP_TIMEOUT });
        const title = (await line.getAttribute("title")) ?? "";
        if (title.split("\n").length !== 3 || !/network services/.test(title)) throw new Error(`the hover title names the three areas and their reason: "${title}"`);
      } else if ((await page.locator(".watch-meta-unavailable").count()) !== 0) throw new Error(`${row.state} reads nothing as unavailable`);
      await assertNoUrlRecorded(page);
      await page.setViewportSize(SIZES[0] ?? WATCH_WINDOW_SIZE);
    });
  }

  // The main window's end screen: the act-now card holds the one primary, and nothing above it reads calm.
  await visit({ name: "guided-end-act-now" }, async () => {
    await goto(`${G}&watch=act`);
    await guidedTitle(page, "Act now");
    await page.locator(".guided-body").getByText(`${FISHY_HEADLINES.persistence}.`, { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    if ((await page.locator(".guided h1").filter({ hasText: "Nothing needs fixing." }).count()) !== 0) throw new Error("the calm title sits above the act-now card");
    if ((await page.getByText("I'll keep checking from the menu bar.", { exact: true }).count()) !== 0) throw new Error("the calm sentence sits above the act-now card");
    const card = actNowCard();
    await card.waitFor({ timeout: STEP_TIMEOUT });
    if ((await page.locator(".guided-next-card").count()) !== 1) throw new Error("one next card, the watch's");
    if (!((await card.getAttribute("class")) ?? "").includes("guided-next-critical")) throw new Error("the act-now card carries the critical cue");
    await card.locator(".guided-next-headline").filter({ hasText: FISHY_HEADLINES.persistence }).waitFor({ timeout: STEP_TIMEOUT });
    await card.locator(".guided-next-why").filter({ hasText: EVIDENCE }).waitFor({ timeout: STEP_TIMEOUT });
    await card.locator(".button-primary").filter({ hasText: "See what to do" }).waitFor({ timeout: STEP_TIMEOUT });
    await assertGuidedScreen(page, { primaries: 1, foldLink: false });
    await assertRecorded(page, "watch:notified", "sig.persistence_new");
    await assertNotRecorded(page, "watch_request_notify_permission");
    await assertRecorded(page, "watch_set_profile", true);
  });

  // The same Mac without a licence: the webview pushes licensed false, the demo settles like Rust does, and the end screen is calm.
  await visit({ name: "guided-end-unlicensed-watch" }, async () => {
    await goto(`${G_FREE}&watch=act`);
    await page.locator(".guided h1").filter({ hasText: "Nothing needs fixing." }).waitFor({ timeout: STEP_TIMEOUT });
    await assertRecorded(page, "watch_set_profile", false);
    if ((await callsOf(page, "watch_set_profile")).some((c) => c.arg === true)) throw new Error("an unlicensed Mac pushed licensed true");
    if ((await actNowCard().count()) !== 0) throw new Error("the act-now card is drawn for an unlicensed person");
    if ((await page.locator(".guided-next-card").count()) !== 0) throw new Error("a next card is drawn on the calm hardened end screen");
    if ((await page.getByText("I'll keep checking from the menu bar.", { exact: true }).count()) !== 0) throw new Error("the watch's calm sentence is drawn while the watch is locked");
    await page.getByText("I'll check again next time you open me.", { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    await assertNotRecorded(page, "watch_request_notify_permission");
    // An unlicensed demo starts without the licence, so no act-now transition ever notified.
    await assertNotRecorded(page, "watch:notified");
    await assertGuidedScreen(page, { primaries: 0, foldLink: false });
    await assertNoUrlRecorded(page);
  });

  // Screen 0, the gate. A gated flip never notifies.
  await visit({ name: "guided-fishy-gate" }, async () => {
    await openFishy("watch=act&fishy=remote&fishyGate=1");
    await guidedTitle(page, "Did you just change this?");
    await page.locator(".guided-body").getByText(/^Remote access to your Mac was turned on at \d{2}:\d{2}\.$/).waitFor({ timeout: STEP_TIMEOUT });
    await assertFishyScreen(page, { primary: "No, I didn't", link: "Yes, that was me", sources: 0 });
    await assertNotRecorded(page, "watch:notified");
  });
  // Screen 1, one per headline. remote is reached through the gate's "No, I didn't".
  for (const kind of Object.keys(FISHY_HEADLINES) as (keyof typeof FISHY_HEADLINES)[]) {
    await visit({ name: `guided-fishy-noticed-${kind}` }, async () => {
      if (kind === "remote") {
        await openFishy("watch=act&fishy=remote&fishyGate=1");
        await guidedTitle(page, "Did you just change this?");
        await primary(page, "No, I didn't");
        await assertRecorded(page, "watch_answer_gate", "sig.remote_access_on");
      } else {
        await openFishy(`watch=act&fishy=${kind}`);
        await assertRecorded(page, "watch:notified");
      }
      await guidedTitle(page, FISHY_HEADLINES[kind]);
      await page.locator(".guided-body").getByText(/^I noticed this at \d{2}:\d{2}\. It was not there at the last check\. I have not deleted anything\.$/).waitFor({ timeout: STEP_TIMEOUT });
      await page.locator(".guided-source").filter({ hasText: NOTICED_SOURCE }).waitFor({ timeout: STEP_TIMEOUT });
      await assertFishyScreen(page, { primary: "See what to do", link: "This is fine, I know it", sources: 1 });
      // The program's name and folder sit under Details only, so the headline never carries them.
      const h1 = (await page.locator(".guided h1").first().textContent()) ?? "";
      if (/[/.]/.test(h1)) throw new Error(`the headline carries machine text: ${h1}`);
    });
  }
  await visit({ name: "guided-fishy-noticed-details" }, async () => {
    await openFishy("watch=act&fishy=persistence");
    await guidedTitle(page, FISHY_HEADLINES.persistence);
    await page.locator(".fishy-details > summary").click();
    const lines = page.locator(".fishy-details[open] .fishy-detail-lines li");
    if ((await lines.count()) !== 3) throw new Error(`Details lists the label, the file and the program: ${await lines.count()} lines`);
    await page.locator(".fishy-details[open] .fishy-evidence").filter({ hasText: EVIDENCE }).waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".fishy-details[open] .fishy-ransom input[type='checkbox']").waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".fishy-details[open] .fishy-reveal").waitFor({ timeout: STEP_TIMEOUT });
    await assertDetailsSource(page, /^NIST SP 800-61/);
    await page.locator(".fishy-details[open] button.fishy-source-button").click();
    await assertRecorded(page, "watch_open_source", "act.note_what_you_saw");
    await assertNoUrlRecorded(page);
    await assertFishyScreen(page, { primary: "See what to do", link: "This is fine, I know it", sources: 1, detailsOpen: true });
  });
  await visit({ name: "guided-end-after-fine" }, async () => {
    // "This is fine, I know it" re-baselines the top signal and goes back; the memory holds the id and the date.
    // The demo's act state carries a second, corroborating signal, so its card stays for that one (demo-watch.test.ts pins it).
    await link(page, "This is fine, I know it");
    await guidedTitle(page, "Nothing needs fixing.");
    await assertRecorded(page, "watch_acknowledge", "sig.persistence_new");
    const memory = await watchMemory(page);
    const normal = (memory?.["normalForMe"] ?? {}) as Record<string, string>;
    if (!/^\d{4}-/.test(normal["sig.persistence_new"] ?? "")) throw new Error(`normalForMe was not written: ${JSON.stringify(memory)}`);
    if ((memory?.["acknowledgeCount"] as Record<string, number> | undefined)?.["sig.persistence_new"] !== 1) throw new Error(`acknowledgeCount was not written: ${JSON.stringify(memory)}`);
    await assertGuidedScreen(page, { primaries: (await actNowCard().count()) === 0 ? 0 : 1, foldLink: false });
  });

  // Screens 2 to 6 on the persistence item: disconnect, stop, keep it from starting again, experts, back to normal.
  await visit({ name: "guided-fishy-disconnect" }, async () => {
    await openFishy("watch=act&fishy=persistence");
    await primary(page, "See what to do");
    await guidedTitle(page, "First, cut it off from the internet");
    await page.locator(".guided-body").getByText("I'll turn Wi-Fi off. Nothing else changes, and you can turn it back on from here. This may not stop everything, but experts say do it first and do not wait.", { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".guided-source").filter({ hasText: "CISA's ransomware checklist, step 1. NIST SP 800-61 (2012 edition), section 3.3.1." }).waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".guided-body").getByText("Do not switch the Mac off. Experts keep it running so the trace is not lost.", { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".guided-source").filter({ hasText: "CISA's ransomware checklist, step 2." }).waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".guided-meta-line").filter({ hasText: ADMIN_PASSWORD_LINE }).waitFor({ timeout: STEP_TIMEOUT });
    await assertFishyScreen(page, { primary: "Turn Wi-Fi off", link: "Not now", sources: 2 });
    await assertNotRecorded(page, "watch_action_preview");
  });
  await visit({ name: "guided-fishy-stop" }, async () => {
    await runPrimary("Turn Wi-Fi off", "watch.wifi_off", "Stop the program");
    await page.locator(".guided-body").getByText("I'll stop it from running. I won't delete anything, so an expert can still look at it.", { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".guided-source").filter({ hasText: "CISA's ransomware checklist, step 11. NIST SP 800-61 (2012 edition), section 3.3.2." }).waitFor({ timeout: STEP_TIMEOUT });
    // A user-level row: no password line.
    if ((await page.locator(".guided-meta-line").filter({ hasText: ADMIN_PASSWORD_LINE }).count()) !== 0) throw new Error("stopping a user agent needs no password");
    await assertFishyScreen(page, { primary: "Stop it", link: "Not now", sources: 1 });
  });
  await visit({ name: "guided-fishy-eradicate" }, async () => {
    await runPrimary("Stop it", "watch.stop_user_agent", "Keep it from starting again");
    await page.locator(".guided-body").getByText('Under "Allow in the Background", switch off the item you do not recognise. I\'ll show you which one.', { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".guided-source").filter({ hasText: "NIST SP 800-61 (2025), RS.MI-02. Apple's Personal Safety checklist, step 6." }).waitFor({ timeout: STEP_TIMEOUT });
    await assertFishyScreen(page, { primary: "Show me where", link: "I'll do it later", sources: 1 });
  });
  await visit({ name: "guided-fishy-experts" }, async () => {
    await primary(page, "Show me where");
    await guidedTitle(page, "What experts do next");
    await assertRecorded(page, "openSettingsPane", "login_items");
    await assertRecorded(page, "watch_check_now");
    await assertNoUrlRecorded(page);
    await assertFishyScreen(page, { primary: "Done", link: null, sources: 0, fold: false });
    // Seven rows for a person who handles no client data; Lockdown Mode waits under the disclosure; no inline link or button beyond the rows.
    const rows = expertRows();
    if ((await rows.count()) !== 7) throw new Error(`expected 7 expert rows, found ${await rows.count()}`);
    if ((await page.locator(".guided-fishy-experts .guided-end-list a").count()) !== 0) throw new Error("the expert list holds no inline link");
    const buttons = page.locator(".guided-fishy-experts .guided-end-list button");
    for (let i = 0; i < (await buttons.count()); i += 1) {
      const className = (await buttons.nth(i).getAttribute("class")) ?? "";
      if (!className.includes("guided-end-row")) throw new Error(`an inline button sits in the expert list: ${className}`);
    }
    if ((await rows.filter({ hasText: "If a message asks for money, do not pay." }).count()) !== 0) throw new Error("the do-not-pay row waits for the ransom box");
    await page.locator(".fishy-more > summary").filter({ hasText: "More experts suggest" }).waitFor({ timeout: STEP_TIMEOUT });
    // The shared end-row component: the same 40 px floor assertEndScreen applies.
    for (const row of await rows.all()) {
      const box = await row.boundingBox();
      if (box !== null && box.height < 40) throw new Error(`an expert row is ${box.height} px tall, under 40`);
    }
  });
  await visit({ name: "guided-fishy-experts-details" }, async () => {
    // A row opens its Details under itself: the source line, the badge, and the source button; the URL opens from Rust by id.
    const first = expertRows().first();
    await first.click();
    if ((await first.getAttribute("aria-expanded")) !== "true") throw new Error("the row reports aria-expanded");
    const details = page.locator(".guided-fishy-experts .fishy-details[open]");
    await details.getByText("CISA's ransomware checklist, step 17, and Apple's Apple Account guidance. Doing it from another device is our advice, not a quote.", { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    await details.locator(".guided-explain-badge").filter({ hasText: "Decided by the app itself" }).waitFor({ timeout: STEP_TIMEOUT });
    if ((await details.locator(".fishy-model").count()) !== 0) throw new Error("no model sentence with AI off");
    await assertDetailsSource(page, /^CISA #StopRansomware v3\.0, Part 2, step 17$/);
    await details.locator("button.fishy-source-button").click();
    await assertRecorded(page, "watch_open_source", "act.change_passwords");
    await assertNoUrlRecorded(page);
    await assertFishyScreen(page, { primary: "Done", link: null, sources: 0, detailsOpen: true, fold: false });
  });
  await visit({ name: "guided-fishy-recover" }, async () => {
    await primary(page, "Done");
    await guidedTitle(page, "When you're done, turn Wi-Fi back on");
    await page.locator(".guided-body").getByText("I'll keep watching more closely for a day.", { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".guided-source").filter({ hasText: "NIST SP 800-61 (2025), RC.RP-04. SANS says the same." }).waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".guided-meta-line").filter({ hasText: ADMIN_PASSWORD_LINE }).waitFor({ timeout: STEP_TIMEOUT });
    await assertFishyScreen(page, { primary: "Turn Wi-Fi on", link: "Not now", sources: 1 });
  });
  await visit({ name: "guided-end-after-fishy" }, async () => {
    // Wi-Fi back on ends the flow: the memory records that it ran, and the end screen is back. The
    // demo's item is still there (no step removed it), so the screen still reads "Act now" above the card.
    await runPrimary("Turn Wi-Fi on", "watch.wifi_on", "Act now");
    const memory = await watchMemory(page);
    if (!/^\d{4}-/.test(String(memory?.["fishyRanAt"] ?? ""))) throw new Error(`fishyRanAt was not written: ${JSON.stringify(memory)}`);
    await assertGuidedScreen(page, { primaries: 1, foldLink: false });
  });

  // The variants: a wired Mac, a listener with no start-up entry, the ransom row, a model sentence, "Not now".
  await visit({ name: "guided-fishy-disconnect-wired" }, async () => {
    await openFishy("watch=act&fishy=persistence&fishyWired=1");
    await primary(page, "See what to do");
    await guidedTitle(page, "First, cut it off from the internet");
    await page.locator(".guided-body").getByText("Unplug the network cable. Then I'll block all incoming connections. Some things you use may stop working until you allow them again.", { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    await assertFishyScreen(page, { primary: "Block incoming connections", link: "Not now", sources: 2 });
  });
  await visit({ name: "guided-fishy-recover-wired" }, async () => {
    await runPrimary("Block incoming connections", "watch.block_incoming", "Stop the program");
    await runPrimary("Stop it", "watch.stop_user_agent", "Keep it from starting again");
    await primary(page, "Show me where");
    await guidedTitle(page, "What experts do next");
    await primary(page, "Done");
    await guidedTitle(page, "When you're done, turn Wi-Fi back on");
    await assertFishyScreen(page, { primary: "Allow incoming again", link: "Not now", sources: 1 });
  });
  await visit({ name: "guided-fishy-stop-no-entry" }, async () => {
    await openFishy("watch=act&fishy=listener");
    await guidedTitle(page, FISHY_HEADLINES.listener);
    await page.locator(".fishy-details > summary").click();
    const lines = page.locator(".fishy-details[open] .fishy-detail-lines li");
    if ((await lines.count()) !== 2) throw new Error(`Details lists the port and the process: ${await lines.count()} lines`);
    await lines.filter({ hasText: /^Port \d+$/ }).waitFor({ timeout: STEP_TIMEOUT });
    if ((await page.locator(".fishy-details[open] .fishy-reveal").count()) !== 0) throw new Error("no start-up entry, so nothing to reveal");
    await primary(page, "See what to do");
    await guidedTitle(page, "First, cut it off from the internet");
    await runPrimary("Turn Wi-Fi off", "watch.wifi_off", "Stop the program");
    await page.locator(".guided-body").getByText("Quit the program named in Details. I can't stop it for you, because it has no start-up entry I can switch off.", { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    await assertFishyScreen(page, { primary: "Block incoming connections", link: "Not now", sources: 1 });
  });
  await visit({ name: "guided-fishy-experts-ransom" }, async () => {
    // A flip with no start-up entry goes straight from disconnect to the experts; the ransom box adds the do-not-pay row.
    await openFishy("watch=act&fishy=dns&ransomNote=1");
    await guidedTitle(page, FISHY_HEADLINES.dns);
    await page.locator(".fishy-details > summary").click();
    if (!(await page.locator(".fishy-details[open] .fishy-ransom input[type='checkbox']").isChecked())) throw new Error("ransomNote=1 ticks the box");
    await primary(page, "See what to do");
    await guidedTitle(page, "First, cut it off from the internet");
    await runPrimary("Turn Wi-Fi off", "watch.wifi_off", "What experts do next");
    const rows = expertRows();
    if ((await rows.count()) !== 8) throw new Error(`expected 8 expert rows with the ransom row, found ${await rows.count()}`);
    await rows.filter({ hasText: "If a message asks for money, do not pay." }).waitFor({ timeout: STEP_TIMEOUT });
    await assertFishyScreen(page, { primary: "Done", link: null, sources: 0, fold: false });
  });
  await visit({ name: "guided-fishy-experts-model" }, async () => {
    // With ChatGPT connected the chosen Advise row carries the model's sentence under its badge; the sentence is never above a fix button.
    await openFishy("watch=act&fishy=dns&watchAi=chatgpt");
    await primary(page, "See what to do");
    await runPrimary("Turn Wi-Fi off", "watch.wifi_off", "What experts do next");
    await expertRows().first().click();
    const details = page.locator(".guided-fishy-experts .fishy-details[open]");
    await details.locator(".fishy-model").waitFor({ timeout: STEP_TIMEOUT });
    await details.locator(".guided-explain-badge").filter({ hasText: "Written by ChatGPT. Not verified." }).waitFor({ timeout: STEP_TIMEOUT });
    await assertFishyScreen(page, { primary: "Done", link: null, sources: 0, detailsOpen: true, fold: false });
  });
  await visit({ name: "guided-end-after-fishy-not-now" }, async () => {
    // "Not now" on the disconnect screen snoozes the item for 14 days: the state drops to look and the card goes.
    await openFishy("watch=act&fishy=persistence");
    await primary(page, "See what to do");
    await guidedTitle(page, "First, cut it off from the internet");
    await link(page, "Not now");
    await guidedTitle(page, "Nothing needs fixing.");
    await assertRecorded(page, "watch_snooze", "sig.persistence_new");
    await assertNotRecorded(page, "watch_action_preview");
    const memory = await watchMemory(page);
    const notNow = (memory?.["actionNotNow"] ?? {}) as Record<string, string>;
    if (!/^\d{4}-/.test(notNow["act.disconnect_network"] ?? "")) throw new Error(`actionNotNow was not written: ${JSON.stringify(memory)}`);
    const snoozed = (memory?.["snoozedSignals"] ?? {}) as Record<string, string>;
    if (!/^\d{4}-/.test(snoozed["sig.persistence_new"] ?? "")) throw new Error(`snoozedSignals was not written: ${JSON.stringify(memory)}`);
    // DESIGN-WATCH section 5: no act-now state survives a "Not now". The demo's act state holds a second item, which the controller snoozes with the first.
    await assertRecorded(page, "watch_snooze", "sig.listener_new_ports");
    if (!/^\d{4}-/.test(snoozed["sig.listener_new_ports"] ?? "")) throw new Error(`the second act-now item was not snoozed: ${JSON.stringify(memory)}`);
    if ((await actNowCard().count()) !== 0) throw new Error('after "Not now", the act-now card is still on the end screen');
    await assertGuidedScreen(page, { primaries: 0, foldLink: false });
  });

  // Settings without a licence: no Watch section, no lock card; the Licence section names the watch in one line.
  await visit({ name: "settings-watch-locked" }, async () => {
    await goto(`${G_FREE}&guided=0`);
    await nav(page, "Settings");
    await heading(page, "Settings");
    await assertRecorded(page, "watch_set_profile", false);
    await assertNotRecorded(page, "watch_request_notify_permission");
    if ((await page.locator("section[aria-labelledby='watch-heading']").count()) !== 0) throw new Error("the Watch section is drawn without a licence");
    if ((await page.getByRole("switch", { name: "Keep an eye on my Mac from the menu bar" }).count()) !== 0) throw new Error("the watch switch is drawn without a licence");
    const first = page.locator(".settings section.settings-section").first();
    if ((await first.getAttribute("aria-labelledby")) !== "checkup-heading") throw new Error("Check-up comes first without a licence");
    const licence = page.locator("section[aria-labelledby='licence-heading']");
    await licence.getByText(SETTINGS_FREE_LINE, { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    await licence.getByText(SETTINGS_PAID_LINE, { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    await licence.getByPlaceholder("Paste your licence key").waitFor({ timeout: STEP_TIMEOUT });
    if ((await page.getByPlaceholder("Paste your licence key").count()) !== 1) throw new Error("one licence field in Settings");
    if ((await page.getByText(/part of the full version/).count()) !== 0) throw new Error("a lock card is drawn in Settings");
  });
  // Pasting a key swaps the sections live: the Watch section appears first with its defaults, and the paste asks for the permission once.
  await visit({ name: "settings-watch-unlock" }, async () => {
    await goto(`${G_FREE}&guided=0`);
    await nav(page, "Settings");
    await heading(page, "Settings");
    await assertRecorded(page, "watch_set_profile", false);
    await page.getByPlaceholder("Paste your licence key").fill(GUIDED_KEY);
    await page.locator("section[aria-labelledby='watch-heading']").waitFor({ timeout: STEP_TIMEOUT });
    const first = page.locator(".settings section.settings-section").first();
    if ((await first.getAttribute("aria-labelledby")) !== "watch-heading") throw new Error("the Watch section comes first once licensed");
    const section = page.locator("section[aria-labelledby='watch-heading']");
    if (!(await section.getByRole("switch", { name: "Keep an eye on my Mac from the menu bar" }).isChecked())) throw new Error("the watch is on once licensed");
    if (await section.getByRole("switch", { name: "Start when I log in" }).isChecked()) throw new Error("start at login is off");
    if (!(await section.getByRole("radio", { name: "Every hour" }).isChecked())) throw new Error("every hour is the default interval");
    if (!(await section.getByRole("switch", { name: "Tell me when something needs doing now" }).isChecked())) throw new Error("notify is on by default");
    await assertRecorded(page, "watch_set_profile", true);
    await page.waitForFunction(() => ((window as unknown as { __talosDemoCalls?: { kind: string }[] }).__talosDemoCalls ?? []).filter((c) => c.kind === "watch_request_notify_permission").length === 1, undefined, { timeout: STEP_TIMEOUT });
    if ((await callsOf(page, "watch_request_notify_permission")).length !== 1) throw new Error("the paste that activates the watch asks for the permission exactly once");
    await assertNotRecorded(page, "autostart_enable");
    const memory = await watchMemory(page);
    if (typeof memory?.["notifyAskedAt"] !== "string") throw new Error("the paste records notifyAskedAt in talos.watch");
    await assertNoUrlRecorded(page);
  });

  // Settings: the Watch section first, two switches, the interval radios, the notify switch, the not-antivirus sentence.
  await visit({ name: "settings-watch" }, async () => {
    await goto(`${G}&guided=0`);
    await nav(page, "Settings");
    await heading(page, "Settings");
    await assertNotRecorded(page, "watch_request_notify_permission");
    await assertRecorded(page, "watch_set_profile", true);
    const first = page.locator(".settings section.settings-section").first();
    if ((await first.getAttribute("aria-labelledby")) !== "watch-heading") throw new Error("the Watch section comes first in Settings");
    const section = page.locator("section[aria-labelledby='watch-heading']");
    await section.getByRole("heading", { name: "Watch", level: 2 }).waitFor({ timeout: STEP_TIMEOUT });
    const enabled = section.getByRole("switch", { name: "Keep an eye on my Mac from the menu bar" });
    const login = section.getByRole("switch", { name: "Start when I log in" });
    const notify = section.getByRole("switch", { name: "Tell me when something needs doing now" });
    if (!(await enabled.isChecked())) throw new Error("the watch is on by default");
    if (await login.isChecked()) throw new Error("start at login is off by default");
    if (!(await notify.isChecked())) throw new Error("notify is on by default");
    await section.getByText("With this off, Talos Labs only checks when you open it.").waitFor({ timeout: STEP_TIMEOUT });
    await section.getByText("Adds Talos Labs under Allow in the Background in System Settings. You can switch it off there too.").waitFor({ timeout: STEP_TIMEOUT });
    await section.getByText("Only for things that need doing now. Never about the full version or AI.").waitFor({ timeout: STEP_TIMEOUT });
    const radios = section.getByRole("radio");
    if ((await radios.count()) !== 3) throw new Error("three interval radios");
    for (const label of ["Every 15 minutes", "Every hour", "Every 4 hours"]) await section.getByRole("radio", { name: label }).waitFor({ timeout: STEP_TIMEOUT });
    if (!(await section.getByRole("radio", { name: "Every hour" }).isChecked())) throw new Error("every hour is the default interval");
    await section.getByText(NOT_ANTIVIRUS, { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    if ((await page.locator("input[type='password']").count()) !== 0) throw new Error("a password field is drawn in Settings");
    // The switches reach the port: start at login on and off again, notify off and on again (the on asks for the permission once).
    await login.check();
    await assertRecorded(page, "autostart_enable");
    await login.uncheck();
    await assertRecorded(page, "autostart_disable");
    await notify.uncheck();
    await assertRecorded(page, "watch_set_notify", false);
    await assertNotRecorded(page, "watch_request_notify_permission");
    await notify.check();
    await assertRecorded(page, "watch_set_notify", true);
    if ((await callsOf(page, "watch_request_notify_permission")).length !== 1) throw new Error("the permission is asked for once, when the notify switch turns on");
    await section.getByRole("radio", { name: "Every 15 minutes" }).check();
    await assertRecorded(page, "watch_set_interval", 15);
    await section.getByRole("radio", { name: "Every hour" }).check();
    await assertRecorded(page, "watch_set_interval", 60);
    await assertNoUrlRecorded(page);
  });

  // Welcome without a licence: nothing about the watch, the two read lists, no not-antivirus block and no permission button.
  await visit({ name: "guided-welcome-free" }, async () => {
    await goto("reset=1&fixture=dev-machine&delay=0");
    await guidedTitle(page, "Let's check your Mac.");
    await page.locator(".guided-body").getByText(/Nothing leaves your Mac\.$/).waitFor({ timeout: STEP_TIMEOUT });
    if ((await page.locator(".guided-body").getByText(/menu bar/).count()) !== 0) throw new Error("the welcome mentions the menu bar without a licence");
    await link(page, "What do you look at?");
    await page.locator(".guided-reads").getByRole("heading", { name: "Reads", level: 2, exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".guided-reads").getByRole("heading", { name: "Never reads", level: 2 }).waitFor({ timeout: STEP_TIMEOUT });
    if ((await page.locator(".fishy-welcome-watch").count()) !== 0) throw new Error("the not-antivirus block is drawn without a licence");
    await assertNotRecorded(page, "watch_request_notify_permission");
    await assertGuidedScreen(page, { foldLink: false });
  });
  // Welcome with a licence: the one foreground button that asks for the notification permission.
  await visit({ name: "guided-welcome-watch" }, async () => {
    await goto("reset=1&fixture=dev-machine&delay=0&licensed=1");
    await guidedTitle(page, "Let's check your Mac.");
    await page.locator(".guided-body").getByText(/Nothing leaves your Mac\.$/).waitFor({ timeout: STEP_TIMEOUT });
    await assertNotRecorded(page, "watch_request_notify_permission");
    await link(page, "What do you look at?");
    const block = page.locator(".fishy-welcome-watch");
    await block.getByText(NOT_ANTIVIRUS, { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    await block.getByRole("button", { name: "Tell me when something needs doing now" }).click();
    await assertRecorded(page, "watch_request_notify_permission");
    await assertRecorded(page, "watch_set_notify", true);
    await assertGuidedScreen(page, { foldLink: false });
    await assertNoUrlRecorded(page);
  });
}

/** DESIGN-ACCEPT.md section 4: the strings the accept walk reads. */
const ACCEPT_TITLE = "Shall I stop asking about this?";
const ACCEPT_TITLE_MANY = "Shall I stop asking about these?";
const ACCEPT_BODY = "I've asked about this a few times. I can stop asking, but your Mac stays at risk until it's done.";
const ACCEPT_PRIMARY = "No, keep asking";
const ACCEPT_LINK = "Leave it alone, I know the risk";
const ACCEPT_LINK_MANY = "Leave them alone, I know the risks";
const ACCEPT_FLASH = "OK, I'll leave it alone.";
const ACCEPT_OFFER = "Don't want to do this? I'll stop proposing it. It still counts against the score.";
const ACCEPT_STRIP = "You chose to leave this on 10 October. It still counts against the score.";
const ACCEPT_UNDO = "Ask me again";
const ACCEPT_PILL = "Left alone";
const END_CHOSEN = "Things you chose to leave";
const END_NOTHING_LEFT = "Nothing left for me to do.";
const END_PARTIAL = "Your Mac is safer than it was.";
const END_NEXT_TIME = "I'll check again next time you open me.";
const CHOSEN_LINE_ONE = "1 thing you chose to leave still counts.";
const DISK_HEADLINE = "Your disk is not locked";
const DISK_FINDING = /Your disk is not encrypted/;
/** `memory=` with 001 left alone on 10 October. */
const ACCEPTED_001 = encodeURIComponent(JSON.stringify({ version: 1, accepted: { "TL-MAC-001": "2026-10-10T09:00:00.000Z" } }));
const FIX_CALLS = ["fixPreview", "fixApply", "fixPreviewBatch", "fixApplyBatch"];

async function guidedMemory(page: Page): Promise<Record<string, unknown> | null> {
  const raw = await page.evaluate(() => localStorage.getItem("talos.guided"));
  return raw === null ? null : (JSON.parse(raw) as Record<string, unknown>);
}

/** The ask screen: the given title, one primary "No, keep asking", one link, a progress line, never the word accept. */
async function assertAskScreen(page: Page, title: string, linkLabel: string): Promise<void> {
  await guidedTitle(page, title);
  await assertGuidedScreen(page);
  const primaryLabel = (await page.locator(".guided .button-primary").textContent())?.trim();
  if (primaryLabel !== ACCEPT_PRIMARY) throw new Error(`the ask primary reads "${primaryLabel}"`);
  const linkText = (await page.locator(".guided .guided-link").textContent())?.trim();
  if (linkText !== linkLabel) throw new Error(`the ask link reads "${linkText}"`);
  await page.locator(".guided-progress .guided-meta").first().waitFor({ timeout: STEP_TIMEOUT });
  if ((await page.locator(".guided-ask-accept").count()) !== 1) throw new Error("the ask screen lacks its class");
  const text = (await page.locator(".guided").textContent()) ?? "";
  if (/accept/i.test(text)) throw new Error("the word accept reached the screen");
}

/** The end screen must never read calm over a rule the person chose to leave. */
async function assertNoCalmTitle(page: Page): Promise<void> {
  const text = (await page.locator(".guided").textContent()) ?? "";
  for (const calm of ["in good shape", "Nothing needs fixing"]) if (text.includes(calm)) throw new Error(`the end screen reads "${calm}" over a rule left alone`);
}

/** "Leave it alone, I know the risk" (DESIGN-ACCEPT.md section 7), light and dark, both sizes, axe on all. */
export async function walkAccept(page: Page, baseUrl: string, visit: Visit): Promise<void> {
  const goto = async (query: string, options: { paced?: boolean } = {}) => {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto(`${baseUrl}/?${query}${options.paced === true ? "" : "&pace=0"}`);
  };
  const askAbout001 = async (options: { paced?: boolean } = {}) => {
    await goto(`${DEV}&memory=${encodeURIComponent(JSON.stringify({ version: 1, laterCount: { "TL-MAC-001": 2 } }))}`, options);
    await primary(page, "Let's go");
    await guidedTitle(page, "The firewall is off");
    await link(page, "Do this later");
    await guidedTitle(page, DISK_HEADLINE);
    await link(page, "Do this later");
  };

  await visit({ name: "guided-ask-accept" }, async () => {
    await askAbout001();
    await assertAskScreen(page, ACCEPT_TITLE, ACCEPT_LINK);
    await page.locator(".guided-body").getByText(ACCEPT_BODY, { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    if ((await page.locator(".guided details").count()) === 0) throw new Error("the single-rule ask keeps the Explain disclosure");
    if ((await page.locator(".guided .guided-list").count()) !== 0) throw new Error("a single-rule ask lists nothing");
    const memory = await guidedMemory(page);
    const counts = (memory?.["laterCount"] ?? {}) as Record<string, number>;
    if (counts["TL-MAC-001"] !== 3) throw new Error(`the third Later wrote a count of ${counts["TL-MAC-001"]}`);
    if (((memory?.["snoozed"] ?? {}) as Record<string, string>)["TL-MAC-001"] === undefined) throw new Error("the third Later did not snooze");
  });
  await visit({ name: "guided-ask-accept-batch" }, async () => {
    await goto(`${DEV_LICENSED}&memory=${encodeURIComponent(JSON.stringify({ version: 1, laterCount: { "TL-MAC-002": 2, "TL-MAC-003": 2, "TL-MAC-011": 0 } }))}`);
    await primary(page, "Let's go");
    await guidedTitle(page, "I can fix 3 things for you now.");
    await link(page, "Do these later");
    await assertAskScreen(page, ACCEPT_TITLE_MANY, ACCEPT_LINK_MANY);
    const rows = await page.locator(".guided .guided-list .guided-row-text").allTextContents();
    const want = ["The firewall is off", "Your Mac answers strangers on the network"];
    if (JSON.stringify(rows.map((r) => r.trim())) !== JSON.stringify(want)) throw new Error(`the batch ask lists ${JSON.stringify(rows)}`);
  });
  await visit({ name: "guided-accept-flash", volatile: true }, async () => {
    await askAbout001({ paced: true });
    await guidedTitle(page, ACCEPT_TITLE);
    const before = (await demoCalls(page)).length;
    await link(page, ACCEPT_LINK);
    await guidedTitle(page, ACCEPT_FLASH);
    await assertGuidedScreen(page, { primaries: 0 });
    if ((await page.locator(".guided .guided-link").count()) !== 0) throw new Error("the flash shows a link");
    const memory = await guidedMemory(page);
    const accepted = (memory?.["accepted"] ?? {}) as Record<string, string>;
    if (accepted["TL-MAC-001"] === undefined) throw new Error("Leave it alone did not write accepted");
    if (((memory?.["snoozed"] ?? {}) as Record<string, string>)["TL-MAC-001"] !== undefined) throw new Error("the snooze survived the acceptance");
    if (((memory?.["laterCount"] ?? {}) as Record<string, number>)["TL-MAC-001"] !== undefined) throw new Error("the count survived the acceptance");
    const after = (await demoCalls(page)).slice(before);
    if (after.some((c) => FIX_CALLS.includes(c.kind))) throw new Error(`a fix call followed the acceptance: ${JSON.stringify(after)}`);
    await assertNoUrlRecorded(page);
  });
  await visit({ name: "guided-end-chosen" }, async () => {
    await goto(`${DEV}&fix=ok&fix_delay=0&memory=${ACCEPTED_001}`);
    await primary(page, "Let's go");
    await primary(page, "Turn it on");
    await guidedTitle(page, "An update is waiting");
    await link(page, "Do this later");
    await link(page, "Not now");
    await link(page, "Not now");
    await guidedTitle(page, END_PARTIAL);
    await assertNoCalmTitle(page);
    const labels = (await page.locator(".guided-end-group:not(.guided-next) .guided-end-label").allTextContents()).map((t) => t.trim());
    const at = labels.indexOf(END_CHOSEN);
    if (at < 0) throw new Error(`no "${END_CHOSEN}" group: ${JSON.stringify(labels)}`);
    if (labels.indexOf("In the full version") > at) throw new Error(`the chosen group comes before the locked one: ${JSON.stringify(labels)}`);
    const leftAloneAt = labels.indexOf("Things I left alone");
    if (leftAloneAt >= 0 && leftAloneAt < at) throw new Error(`the chosen group comes after the left-alone one: ${JSON.stringify(labels)}`);
    const group = page.locator("section[aria-labelledby='guided-end-accepted']");
    await group.getByRole("button", { name: `${DISK_HEADLINE} Details` }).waitFor({ timeout: STEP_TIMEOUT });
    const nextHeadline = (await page.locator(".guided-next-headline").textContent())?.trim();
    if (nextHeadline === DISK_HEADLINE) throw new Error("the rule left alone became the next card");
    await assertEndScreen(page, { label: "Show me where", cue: "high" });
  });
  await visit({ name: "guided-end-nothing-left" }, async () => {
    await goto(`reset=1&fixture=hardened&fail=001&onboarded=1&delay=0&memory=${ACCEPTED_001}`);
    await guidedTitle(page, END_NOTHING_LEFT);
    await assertNoCalmTitle(page);
    await page.getByText(END_NEXT_TIME, { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    const group = page.locator("section[aria-labelledby='guided-end-accepted']");
    if ((await group.locator(".guided-end-row").count()) !== 1) throw new Error("the chosen group holds one row");
    await assertEndScreen(page, null);
  });
  await visit({ name: "finding-detail-offer" }, async () => {
    await goto(`${DEV}&guided=0`);
    await runCheckUp(page);
    await openCard(page, DISK_FINDING);
    await heading(page, "How to fix it", 2);
    const offer = page.locator(".accept-offer");
    await offer.getByText(ACCEPT_OFFER, { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    await offer.getByRole("button", { name: ACCEPT_LINK }).waitFor({ timeout: STEP_TIMEOUT });
    if ((await page.locator(".accept-strip").count()) !== 0) throw new Error("the strip is drawn before any choice");
    const fix = await page.locator("section").filter({ has: page.getByRole("heading", { name: "How to fix it" }) }).first().boundingBox();
    const box = await offer.boundingBox();
    if (fix === null || box === null || box.y < fix.y + fix.height) throw new Error("the offer sits under the fix card");
  });
  await visit({ name: "finding-detail-left-alone" }, async () => {
    await goto(`${DEV}&guided=0&memory=${ACCEPTED_001}`);
    await runCheckUp(page);
    await nav(page, "Findings");
    await openCard(page, DISK_FINDING);
    const strip = page.locator(".accept-strip[role='status']");
    await strip.getByText(ACCEPT_STRIP, { exact: true }).waitFor({ timeout: STEP_TIMEOUT });
    await strip.getByRole("button", { name: ACCEPT_UNDO }).waitFor({ timeout: STEP_TIMEOUT });
    const pill = (await page.locator(".detail-meta .status-left-alone").textContent())?.trim();
    if (pill !== ACCEPT_PILL) throw new Error(`the pill reads "${pill}"`);
    if ((await page.getByRole("heading", { name: "How to fix it" }).count()) !== 0) throw new Error("the fix card is drawn while left alone");
    if ((await page.locator(".lock").count()) !== 0) throw new Error("the lock is drawn while left alone");
    await page.locator(".ai-card").waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".recheck").waitFor({ timeout: STEP_TIMEOUT });
    if ((await page.locator(".accept-offer").count()) !== 0) throw new Error("the offer is drawn while left alone");
    await assertNoUrlRecorded(page);
  });
  // The shot above keeps the strip; the undo gets its own visit so the capture shows the state it asserts.
  await visit({ name: "finding-detail-ask-again" }, async () => {
    await goto(`${DEV}&guided=0&memory=${ACCEPTED_001}`);
    await runCheckUp(page);
    await nav(page, "Findings");
    await openCard(page, DISK_FINDING);
    const strip = page.locator(".accept-strip[role='status']");
    await strip.getByRole("button", { name: ACCEPT_UNDO }).click();
    await heading(page, "How to fix it", 2);
    if ((await page.locator(".accept-strip").count()) !== 0) throw new Error("the strip stayed after Ask me again");
    await page.locator(".accept-offer").waitFor({ timeout: STEP_TIMEOUT });
    const memory = await guidedMemory(page);
    if (((memory?.["accepted"] ?? {}) as Record<string, string>)["TL-MAC-001"] !== undefined) throw new Error("Ask me again did not clear the entry");
    await assertNoUrlRecorded(page);
  });
  await visit({ name: "findings-left-alone-pill" }, async () => {
    await goto(`${DEV}&guided=0&memory=${ACCEPTED_001}`);
    await runCheckUp(page);
    const tile = (await page.locator(".grid-stats li").filter({ hasText: "Needs fixing" }).locator("b").textContent())?.trim();
    await nav(page, "Findings");
    const group = page.locator("section[aria-labelledby='group-needs-fixing']");
    await group.waitFor({ timeout: STEP_TIMEOUT });
    const cards = group.locator(".finding-card");
    const last = cards.last();
    if ((await last.getAttribute("data-rule-id")) !== "TL-MAC-001") throw new Error("the rule left alone is not last in Needs fixing");
    const pill = (await last.locator(".badge-left-alone").textContent())?.trim();
    if (pill !== ACCEPT_PILL) throw new Error(`the card pill reads "${pill}"`);
    if ((await last.locator(".badge-rank").count()) !== 0) throw new Error("the rule left alone carries an AI rank");
    const count = (await group.locator(".count-inline").textContent())?.trim();
    if (count !== String(await cards.count())) throw new Error(`the group count reads ${count} over ${await cards.count()} cards`);
    if (count !== tile) throw new Error(`Findings counts ${count} and the Overview tile ${tile}`);
    const text = (await page.locator(".findings").textContent()) ?? "";
    if (/accept/i.test(text)) throw new Error("the word accept reached the Findings screen");
  });
  await visit({ name: "overview-chosen-line" }, async () => {
    await goto(`${DEV}&guided=0&provider=chatgpt&ai=available&memory=${ACCEPTED_001}`);
    await runCheckUp(page);
    const line = (await page.locator(".score-chosen").textContent())?.trim();
    if (line !== CHOSEN_LINE_ONE) throw new Error(`the score line reads "${line}"`);
    const next = page.locator("section[aria-labelledby='next-fixes']");
    await next.waitFor({ timeout: STEP_TIMEOUT });
    if ((await next.locator('[data-rule-id="TL-MAC-001"]').count()) !== 0) throw new Error("Next three fixes proposes the rule left alone");
    await page.getByRole("button", { name: "Suggest an order" }).click();
    await page.locator(".ai-card[data-ai-state='ready']").waitFor({ timeout: STEP_TIMEOUT });
    const body = page.locator(".suggested-order");
    await body.waitFor({ timeout: STEP_TIMEOUT });
    if ((await body.locator('[data-rule-id="TL-MAC-001"]').count()) !== 0) throw new Error("the suggested order lists the rule left alone");
    if ((await body.locator("[data-rule-id]").count()) === 0) throw new Error("the suggested order is empty");
    await assertNoUrlRecorded(page);
  });
}
