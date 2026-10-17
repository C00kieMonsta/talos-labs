import type { Page } from "playwright-core";
import { DESKTOP_DIR, ensureServer, launchChrome, parseArgs, settle } from "./harness";

/**
 * Motion smoke test (docs/DESIGN-PLAYFUL.md section 6). Runs the demo at pace 1 without the harness's unroll CSS,
 * reads each moment at its first frame and after its duration, then repeats it under reduced motion and expects the
 * resting frame at once. Exits 1 on any failure; progress goes to stderr.
 */

const STEP_TIMEOUT = 20_000;
const SIZE = { width: 1100, height: 760 } as const;
const DEV = "reset=1&fixture=dev-machine&onboarded=1&delay=0";
const PLAN_TITLE = "I found 3 things to fix.";
/** The only animations allowed to run on an idle screen (the caret, the spinner, the skeleton shimmer). */
const IDLE_ALLOWED = new Set(["caret-blink", "spin", "shimmer"]);

type Mode = "motion" | "reduced";

interface Moment {
  readonly name: string;
  run(page: Page, baseUrl: string, mode: Mode): Promise<void>;
}

const SKIPPED: readonly { name: string; reason: string }[] = [
  { name: "motion-breathe", reason: "needs the chat home (DESIGN-CHAT-UI), not built" },
  { name: "motion-reading", reason: "needs the daily reading (DESIGN-DAILY), not built" },
];

function log(line: string): void {
  console.error(`[motion] ${line}`);
}

function check(ok: boolean, what: string): void {
  if (!ok) throw new Error(what);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function goto(page: Page, baseUrl: string, query: string): Promise<void> {
  await page.goto(`${baseUrl}/?${query}`);
}

async function guidedTitle(page: Page, name: string): Promise<void> {
  await page.locator("h1.guided-title").filter({ hasText: name }).first().waitFor({ timeout: STEP_TIMEOUT });
}

async function primary(page: Page, name: string): Promise<void> {
  await page.locator(".guided .guided-primary").filter({ hasText: name }).first().click({ timeout: STEP_TIMEOUT });
}

async function link(page: Page, name: string): Promise<void> {
  await page.locator(".guided .guided-link").filter({ hasText: name }).first().click({ timeout: STEP_TIMEOUT });
}

/** A computed property of the first match, or its text when `prop` is "text". */
async function styleOf(page: Page, selector: string, prop: string, pseudo: string | null = null): Promise<string> {
  return page.evaluate(
    ({ selector, prop, pseudo }) => {
      const el = document.querySelector(selector);
      if (el === null) throw new Error(`no ${selector}`);
      if (prop === "text") return el.textContent ?? "";
      return getComputedStyle(el, pseudo ?? undefined).getPropertyValue(prop);
    },
    { selector, prop, pseudo },
  );
}

/** The same value, read inside the page on the first animation frame the element exists, so no round trip is lost. */
async function firstSight(page: Page, selector: string, prop: string, pseudo: string | null = null): Promise<string> {
  const handle = await page.waitForFunction(
    ({ selector, prop, pseudo }) => {
      const el = document.querySelector(selector);
      if (el === null) return null;
      if (prop === "text") return { value: el.textContent ?? "" };
      return { value: getComputedStyle(el, pseudo ?? undefined).getPropertyValue(prop) };
    },
    { selector, prop, pseudo },
    { polling: "raf", timeout: STEP_TIMEOUT },
  );
  const result = (await handle.jsonValue()) as { value: string } | null;
  return result === null ? "" : result.value;
}

async function token(page: Page, name: string): Promise<number> {
  return page.evaluate((n) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)), name);
}

/** Reduced motion either removes the animation or cuts it to 0.001 ms. */
function frozen(name: string, duration: string): boolean {
  return name === "none" || parseFloat(duration) < 0.01;
}

/** A transform at rest: none, or the identity that scale(1) computes to. */
function resting(transform: string): boolean {
  return transform === "none" || transform === "matrix(1, 0, 0, 1, 0, 0)";
}

async function animationOf(page: Page, selector: string, pseudo: string | null = null): Promise<{ name: string; duration: string; delay: string }> {
  return {
    name: await styleOf(page, selector, "animation-name", pseudo),
    duration: await styleOf(page, selector, "animation-duration", pseudo),
    delay: await styleOf(page, selector, "animation-delay", pseudo),
  };
}

const welcomeDrift: Moment = {
  name: "motion-welcome-drift",
  async run(page, baseUrl, mode) {
    await goto(page, baseUrl, "reset=1&fixture=dev-machine&delay=0");
    const band = "[data-testid='hero-spiral']";
    const first = parseFloat(await firstSight(page, band, "opacity"));
    const want = await token(page, "--hero-spiral-opacity");
    if (mode === "motion") {
      check(first < want * 0.3, `spiral opacity ${first} at first sight, expected under ${want * 0.3}`);
      await sleep(950);
    } else {
      check(Math.abs(first - want) < 0.005, `spiral opacity ${first} at first sight under reduced motion, expected ${want}`);
      check((await animationOf(page, band)).name === "none", "the spiral drifts under reduced motion");
    }
    const after = parseFloat(await styleOf(page, band, "opacity"));
    check(Math.abs(after - want) < 0.005, `spiral opacity ${after} after the drift, expected ${want}`);
  },
};

const hello: Moment = {
  name: "motion-hello",
  async run(page, baseUrl, mode) {
    await goto(page, baseUrl, "reset=1&fixture=dev-machine&delay=0");
    const actions = ".guided-welcome-first .guided-actions";
    const first = parseFloat(await firstSight(page, actions, "opacity"));
    if (mode === "motion") {
      check(first < 1, `the hello's actions are at opacity ${first} on the first frame, expected under 1`);
      await sleep(650);
    } else {
      check(first === 1, `the hello's actions are at opacity ${first} under reduced motion, expected 1`);
      const anim = await animationOf(page, actions);
      check(frozen(anim.name, anim.duration), `the hello stagger runs under reduced motion (${anim.name} ${anim.duration})`);
    }
    check(parseFloat(await styleOf(page, actions, "opacity")) === 1, "the hello's actions did not reach opacity 1 by 600 ms");
    check((await page.locator(".guided .guided-primary").filter({ hasText: "Start" }).count()) === 1, "the welcome has no Start");
  },
};

const scanDot: Moment = {
  name: "motion-scan-dot",
  async run(page, baseUrl, mode) {
    await goto(page, baseUrl, DEV);
    const dot = ".scanning-guided .scan-dot-passed";
    const name = await firstSight(page, dot, "animation-name");
    check(name === "dot-settle", `the first passed dot animates with ${name}, expected dot-settle`);
    if (mode === "reduced") {
      const anim = await animationOf(page, dot);
      check(frozen(anim.name, anim.duration), `the dot pops under reduced motion (${anim.duration})`);
    }
    check(resting(await styleOf(page, dot, "transform")) || mode === "motion", "a passed dot is scaled under reduced motion");
  },
};

/** The expert home: "Start check-up" runs the paced scan, then the Overview draws the ring. */
async function reachRing(page: Page, baseUrl: string): Promise<number> {
  await goto(page, baseUrl, "reset=1&fixture=dev-machine&guided=0&delay=0");
  await page.getByRole("button", { name: "Start check-up" }).click({ timeout: STEP_TIMEOUT });
  await page.locator("[role='meter']").waitFor({ timeout: 40_000 });
  return Number(await page.locator("[role='meter']").getAttribute("aria-valuenow"));
}

const ringFill: Moment = {
  name: "motion-ring-fill",
  async run(page, baseUrl, mode) {
    const final = await reachRing(page, baseUrl);
    const first = Number(await firstSight(page, ".score-meter-figure", "text"));
    if (mode === "motion") {
      check(first < final, `the ring figure reads ${first} on the first frame, expected under ${final}`);
      await sleep(950);
    } else {
      check(first === final, `the ring figure reads ${first} under reduced motion, expected ${final}`);
    }
    check(Number(await styleOf(page, ".score-meter-figure", "text")) === final, "the ring figure did not reach the score by 950 ms");
    check(Number(await page.locator("[role='meter']").getAttribute("aria-valuenow")) === final, "aria-valuenow moved during the fill");
  },
};

const ringReplay: Moment = {
  name: "motion-ring-replay",
  async run(page, baseUrl, mode) {
    const final = await reachRing(page, baseUrl);
    await sleep(1000);
    const gradeAnim = await animationOf(page, ".score-meter-grade");
    // Click inside the page and read the figure two frames later, before the round trip can hide the restart.
    const { after, sameGrade, gradeOpacity } = await page.evaluate(
      () =>
        new Promise<{ after: string; sameGrade: boolean; gradeOpacity: string }>((resolve) => {
          const grade = document.querySelector(".score-meter-grade");
          (document.querySelector("[role='meter']") as HTMLElement).click();
          requestAnimationFrame(() =>
            requestAnimationFrame(() => {
              const now = document.querySelector(".score-meter-grade");
              resolve({ after: document.querySelector(".score-meter-figure")?.textContent ?? "", sameGrade: now === grade, gradeOpacity: now === null ? "" : getComputedStyle(now).opacity });
            }),
          );
        }),
    );
    if (mode === "motion") {
      check(Number(after) < final, `the ring figure reads ${after} after a click, expected under ${final}`);
      // The grade word stays (DESIGN-PLAYFUL 3.11): same node, visible, its fade-in not restarted.
      check(sameGrade, "the grade word was remounted by the replay");
      check(gradeOpacity === "1", `the grade word reads opacity ${gradeOpacity} after a click, expected 1`);
      const gradeAfter = await animationOf(page, ".score-meter-grade");
      check(gradeAfter.name === gradeAnim.name && gradeAfter.delay === gradeAnim.delay, "the grade word's animation changed on replay");
      await sleep(950);
    } else {
      check(Number(after) === final, `a click moved the ring figure to ${after} under reduced motion`);
    }
    check(Number(await styleOf(page, ".score-meter-figure", "text")) === final, "the replay did not reach the score by 950 ms");
    check(Number(await page.locator("[role='meter']").getAttribute("aria-valuenow")) === final, "aria-valuenow moved during the replay");
  },
};

const doneDisc: Moment = {
  name: "motion-done-disc",
  async run(page, baseUrl, mode) {
    await goto(page, baseUrl, `${DEV}&fix=ok&fix_delay=0`);
    await guidedTitle(page, PLAN_TITLE);
    await primary(page, "Let's go");
    await guidedTitle(page, "The firewall is off");
    await primary(page, "Turn it on");
    const disc = await firstSight(page, ".guided-status-disc", "animation-name");
    const tick = await animationOf(page, ".guided-status-mark > .guided-tick");
    if (mode === "motion") {
      check(disc === "disc-in", `the done disc animates with ${disc}, expected disc-in`);
      check(tick.name === "guided-tick" && tick.delay === "0.15s", `the tick runs ${tick.name} after ${tick.delay}, expected guided-tick after 0.15s`);
    } else {
      check(disc === "none", `the done disc animates under reduced motion (${disc})`);
      check(tick.name === "none", `the tick draws under reduced motion (${tick.name})`);
    }
  },
};

async function expectCueBar(page: Page, mode: Mode): Promise<void> {
  const first = await firstSight(page, ".guided-next-card", "transform", "::before");
  if (mode === "motion") {
    check(first === "matrix(1, 0, 0, 0, 0, 0)", `the cue bar's first frame is ${first}, expected scaleY(0)`);
    await sleep(600);
  } else {
    check(resting(first), `the cue bar starts at ${first} under reduced motion`);
  }
  const after = await styleOf(page, ".guided-next-card", "transform", "::before");
  check(resting(after), `the cue bar rests at ${after}, expected none`);
}

/** The dev-machine walk with one fix and the rest put off, landing on the partial end screen with its next card. */
async function reachPartialEnd(page: Page, baseUrl: string): Promise<void> {
  await goto(page, baseUrl, `${DEV}&fix=ok&fix_delay=0`);
  await guidedTitle(page, PLAN_TITLE);
  await primary(page, "Let's go");
  await primary(page, "Turn it on");
  await guidedTitle(page, "Your disk is not locked");
  await link(page, "Do this later");
  await link(page, "Do this later");
  await link(page, "Not now");
  await link(page, "Not now");
}

const cueBar: Moment = {
  name: "motion-cue-bar",
  async run(page, baseUrl, mode) {
    await reachPartialEnd(page, baseUrl);
    await expectCueBar(page, mode);
    await guidedTitle(page, "Your Mac is safer than it was.");
  },
};

/** The dev-machine walk fixes fewer than ten, so the figure is drawn whole in both modes: the hidden copy final throughout, the visible one equal on the first frame. */
const fixedCount: Moment = {
  name: "motion-fixed-count",
  async run(page, baseUrl) {
    await reachPartialEnd(page, baseUrl);
    const line = ".guided-end .guided-body p";
    const hidden = await firstSight(page, `${line} span.visually-hidden`, "text");
    const visible = await styleOf(page, `${line} span[aria-hidden='true']`, "text");
    check(hidden === "1", `the hidden fixed figure reads "${hidden}", expected 1`);
    check(visible === hidden, `the visible fixed figure reads "${visible}" on its first frame, expected ${hidden}`);
    await guidedTitle(page, "Your Mac is safer than it was.");
    await sleep(700);
    check((await styleOf(page, `${line} span.visually-hidden`, "text")) === "1", "the hidden fixed figure moved");
    check((await styleOf(page, `${line} span[aria-hidden='true']`, "text")) === "1", "the visible fixed figure did not stay at 1");
    const text = await styleOf(page, line, "text");
    check(text.endsWith(" thing fixed today."), `the fixed line reads "${text}"`);
  },
};

const cueBarAct: Moment = {
  name: "motion-cue-bar-act",
  async run(page, baseUrl, mode) {
    await goto(page, baseUrl, "reset=1&fixture=hardened&onboarded=1&delay=0&licensed=1&watch=act");
    await expectCueBar(page, mode);
    await guidedTitle(page, "Act now");
    const headline = await animationOf(page, "h1.guided-title");
    check(headline.name === "none", `the act-now headline animates with ${headline.name}`);
  },
};

const press: Moment = {
  name: "motion-press",
  async run(page, baseUrl, mode) {
    await goto(page, baseUrl, DEV);
    await guidedTitle(page, PLAN_TITLE);
    const button = page.locator(".guided .guided-primary").first();
    const box = await button.boundingBox();
    check(box !== null, "the plan screen has no primary to press");
    if (box === null) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await sleep(250);
    const down = await styleOf(page, ".guided .guided-primary", "transform");
    await page.mouse.up();
    await sleep(250);
    await settle(page);
    const up = await styleOf(page, ".guided .guided-primary", "transform");
    if (mode === "motion") check(down.startsWith("matrix(0.98, 0, 0, 0.98"), `the pressed primary reads ${down}, expected scale(0.98)`);
    else check(resting(down), `the pressed primary scales under reduced motion (${down})`);
    check(resting(up), `the released primary reads ${up}, expected none`);
  },
};

const horizon: Moment = {
  name: "motion-horizon",
  async run(page, baseUrl, mode) {
    await goto(page, baseUrl, "reset=1&fixture=hardened&onboarded=1&delay=0");
    const band = "[data-testid='hero-horizon']";
    const first = parseFloat(await firstSight(page, band, "opacity"));
    if (mode === "motion") {
      check(first < 1, `the horizon is at opacity ${first} on its first frame, expected under 1`);
      await sleep(400);
    } else {
      check(first === 1, `the horizon is at opacity ${first} under reduced motion, expected 1`);
      check((await animationOf(page, band)).name === "none", "the horizon rises under reduced motion");
    }
    check(parseFloat(await styleOf(page, band, "opacity")) === 1, "the horizon did not reach opacity 1 by 300 ms");
  },
};

const caret: Moment = {
  name: "motion-caret",
  async run(page, baseUrl, mode) {
    await goto(page, baseUrl, `${DEV}&licensed=1&fix_delay=0`);
    await guidedTitle(page, "I found 7 things to fix.");
    await primary(page, "Let's go");
    await page.locator(".guided-explain summary").click({ timeout: STEP_TIMEOUT });
    await page.locator(".caret").waitFor({ timeout: 5000 });
    const anim = await animationOf(page, ".caret");
    if (mode === "motion") check(anim.name === "caret-blink" && anim.duration === "1s", `the caret runs ${anim.name} over ${anim.duration}, expected caret-blink over 1s`);
    else check(anim.name === "none", `the caret blinks under reduced motion (${anim.name})`);
  },
};

/**
 * The inner span fades in and the live region stays one node. The demo's "Check now" keeps the rating, so the remount
 * on a rating change is pinned by WatchWindow.test.tsx; here the first paint's fade and the node's identity are measured.
 */
const watchStatus: Moment = {
  name: "motion-watch-status",
  async run(page, baseUrl, mode) {
    await page.goto(`${baseUrl}/watch.html?watch=calm`);
    const inner = ".watch-status[role='status'] > .watch-status-inner";
    const first = await firstSight(page, inner, "animation-name");
    const anim = await animationOf(page, inner);
    if (mode === "motion") check(first === "fade-in" && anim.duration === "0.2s", `the status span runs ${first} over ${anim.duration}, expected fade-in over 0.2s`);
    else check(frozen(anim.name, anim.duration), `the status span fades under reduced motion (${anim.name} ${anim.duration})`);
    check((await styleOf(page, `${inner} .watch-status-word`, "text")) === "Nothing changed", "the calm word is not in the span");
    await page.evaluate(() => {
      (document.querySelector(".watch-status[role='status']") as HTMLElement).dataset.motionProbe = "same";
    });
    await page.locator(".watch-footer .watch-link").filter({ hasText: "Check now" }).click({ timeout: STEP_TIMEOUT });
    await page.locator(".watch-meta-checking").waitFor({ timeout: STEP_TIMEOUT });
    await page.locator(".watch-meta-checking").waitFor({ state: "detached", timeout: STEP_TIMEOUT });
    const same = await page.evaluate(() => (document.querySelector(".watch-status[role='status']") as HTMLElement | null)?.dataset.motionProbe === "same");
    check(same, "the status live region was remounted by a check");
    check((await page.locator(inner).count()) === 1, "the status line holds one inner span");
  },
};

const MOMENTS: readonly Moment[] = [welcomeDrift, hello, scanDot, ringFill, ringReplay, doneDisc, cueBar, cueBarAct, press, horizon, caret, fixedCount, watchStatus];

/** After 5 s idle on the plan screen only the caret, the spinner and the shimmer may still run; finished `both` animations stay listed but are not running. */
async function idle(page: Page, baseUrl: string): Promise<void> {
  await goto(page, baseUrl, DEV);
  await guidedTitle(page, PLAN_TITLE);
  await sleep(5000);
  const running = await page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => ("animationName" in a ? (a as { animationName: string }).animationName : "transitionProperty" in a ? `transition:${(a as { transitionProperty: string }).transitionProperty}` : a.id)),
  );
  const stray = running.filter((name) => !IDLE_ALLOWED.has(name));
  check(stray.length === 0, `animations still running on the idle plan screen: ${stray.join(", ")}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), { port: 1430, out: `${DESKTOP_DIR}/qa/scratch` });
  const server = await ensureServer(args.port);
  const browser = await launchChrome();
  const failed: string[] = [];
  try {
    const context = await browser.newContext({ viewport: SIZE, colorScheme: "light", reducedMotion: "no-preference" });
    const page = await context.newPage();
    for (const moment of MOMENTS) {
      for (const mode of ["motion", "reduced"] as const) {
        await page.emulateMedia({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
        try {
          await moment.run(page, server.baseUrl, mode);
          log(`ok   ${moment.name} (${mode})`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failed.push(`${moment.name} (${mode}): ${message}`);
          log(`FAIL ${moment.name} (${mode}): ${message}`);
        }
      }
    }
    await page.emulateMedia({ reducedMotion: "no-preference" });
    try {
      await idle(page, server.baseUrl);
      log("ok   idle plan screen");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push(`idle: ${message}`);
      log(`FAIL idle: ${message}`);
    }
    for (const skip of SKIPPED) log(`skip ${skip.name}: ${skip.reason}`);
  } finally {
    await browser.close();
    await server.stop();
  }
  if (failed.length > 0) {
    log(`${failed.length} failure(s)`);
    process.exit(1);
  }
  log("every moment measured");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
