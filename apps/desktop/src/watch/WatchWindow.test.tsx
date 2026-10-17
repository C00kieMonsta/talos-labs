import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WatchItem, WatchJudge, WatchState } from "@talos/core";
import { askWhyQuestion } from "@talos/core";
import { formatTime, WATCH_PROBE_LABELS } from "../app/labels";
import { FISHY, WATCH } from "../guided/copy";
import { guidedFor } from "../guided/plan";
import { connectOffer } from "./connect-offer";
import { AI_BADGES_SHORT, WATCH_WINDOW } from "./copy";
import { calmLine, lookEmptyLine, unavailableIsMixed, unavailableLine, WatchWindow } from "./WatchWindow";
import type { WatchWindowPort } from "./WatchWindow";

afterEach(cleanup);

const NOW = "2026-10-16T12:00:00.000Z";
const now = () => new Date(NOW);

function ago(minutes: number): string {
  return new Date(new Date(NOW).getTime() - minutes * 60_000).toISOString();
}

const REPORT = { reportId: "r-1", scannedAt: ago(120), score: 72, grade: "fair" } as const;
const NEXT = { reportId: "r-1", ruleId: "TL-MAC-001", kind: "fix" } as const;

const CALM: WatchState = {
  enabled: true,
  licensed: true,
  firstRun: false,
  hiddenLaunch: false,
  rating: "calm",
  since: ago(120),
  lastCheckAt: ago(12),
  checking: false,
  cycleIndex: 3,
  everyMinutes: 60,
  notify: true,
  pausedUntil: null,
  closeWatchUntil: null,
  unavailable: [],
  gated: [],
  items: [],
  nextCheckAt: ago(-48),
  lastChangeAt: ago(3 * 24 * 60),
  ai: { enabled: true, provider: "chatgpt" },
  judge: null,
  recentCount: 0,
  rulesSince: null,
  report: REPORT,
  next: NEXT,
};

function judge(rating: WatchState["rating"], overrides: Partial<WatchJudge> = {}): WatchJudge {
  return { provider: "chatgpt", at: ago(12), rating, reason: "The one thing still open is your unlocked disk, and it matters most on a laptop that leaves the house.", ...overrides };
}

function item(overrides: Partial<WatchItem> = {}): WatchItem {
  return {
    signalId: "sig.persistence_new",
    kind: "persistence",
    severity: "high",
    points: 6,
    change: "appeared",
    changedAt: ago(9),
    gated: false,
    snoozedUntil: null,
    hasStartupEntry: true,
    isListener: false,
    actionIds: ["act.stop_background_program"],
    modelSentence: null,
    modelProvider: null,
    ...overrides,
  };
}

const LOOK: WatchState = { ...CALM, rating: "keep_an_eye", items: [item({ signalId: "sig.dns_manual", kind: "dns", severity: "medium", points: 3, change: "changed" })], recentCount: 1 };
const ACT: WatchState = { ...CALM, rating: "act_now", items: [item(), item({ signalId: "sig.listener_new_ports", kind: "listener", isListener: true }), item({ signalId: "sig.firewall", kind: "guard" })], recentCount: 3 };
const UNREADABLE: WatchState = {
  ...CALM,
  unavailable: [
    { probeId: "probe.listeners", reason: "unsigned_build" },
    { probeId: "probe.remote_access", reason: "unsigned_build" },
    { probeId: "probe.file_sharing", reason: "unsigned_build" },
  ],
};
const FIRST_RUN: WatchState = { ...CALM, firstRun: true, since: null, lastCheckAt: null, cycleIndex: 0, nextCheckAt: null, lastChangeAt: null, report: null, next: null };
const PAUSED: WatchState = { ...CALM, pausedUntil: ago(-48) };

interface Fake {
  readonly port: WatchWindowPort;
  readonly openMain: ReturnType<typeof vi.fn>;
  readonly checkNow: ReturnType<typeof vi.fn>;
  push(state: WatchState): void;
}

function fakePort(state: WatchState): Fake {
  const listeners = new Set<(state: WatchState) => void>();
  const openMain = vi.fn(() => Promise.resolve());
  const checkNow = vi.fn(() => Promise.resolve());
  const port: WatchWindowPort = {
    status: () => Promise.resolve(state),
    onState: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    checkNow,
    openMain,
  };
  return { port, openMain, checkNow, push: (next) => listeners.forEach((l) => l(next)) };
}

async function renderWindow(state: WatchState, offer?: () => boolean) {
  const fake = fakePort(state);
  render(<WatchWindow port={fake.port} now={now} connectOffer={offer} />);
  await screen.findByText(WATCH.openApp);
  await act(async () => {});
  return fake;
}

function primaries(): string[] {
  return Array.from(document.querySelectorAll(".button-primary")).map((b) => b.textContent ?? "");
}

function text(selector: string): string | null {
  return document.querySelector(selector)?.textContent ?? null;
}

function count(selector: string): number {
  return document.querySelectorAll(selector).length;
}

/** The DOM order of the window's rows, by class, for the row-order assertions. */
function rows(): string[] {
  const main = document.querySelector("main.watch");
  return Array.from(main?.children ?? []).map((el) => el.className.split(" ")[0] ?? "");
}

describe("WatchWindow, the calm window", () => {
  it("calm: the check-up icon, the word, the two meta lines, the authored line, the score, Up next, the field, no item, no primary", async () => {
    await renderWindow(CALM);
    expect(text(".watch-status-word")).toBe(WATCH.calm);
    expect(document.querySelector(".watch-status-act")).toBeNull();
    expect(document.querySelector(".watch-status svg")?.getAttribute("width")).toBe("20");
    expect(text(".watch-meta-checked")).toBe("Checked 10 minutes ago");
    expect(text(".watch-meta-next")).toBe("Next check in about an hour");
    expect(text(".watch-calm-line")).toBe("No change in 3 days.");
    expect(document.querySelector(".guided-model-line")).toBeNull();
    expect(text(".watch-checkup-score")).toBe("Last check-up: 72, Fair.");
    expect(text(".watch-up-next")).toBe(`Up next: ${guidedFor("TL-MAC-001").headline} ›`);
    expect(document.querySelector(".watch-ask-input")).not.toBeNull();
    expect(document.querySelector(".watch-item")).toBeNull();
    expect(document.querySelector(".watch-unreadable")).toBeNull();
    expect(document.querySelector(".watch-connect")).toBeNull();
    expect(primaries()).toEqual([]);
    expect(document.querySelector(".watch-first-run")).toBeNull();
    expect(document.querySelector(".guided-link")).toBeNull();
    expect(document.querySelector("[role='progressbar']")).toBeNull();
    expect(rows()).toEqual(["watch-status", "watch-meta", "watch-calm-line", "watch-checkup", "watch-ask", "watch-footer"]);
  });

  it("calm with a stray item shows neither the headline nor a primary", async () => {
    await renderWindow({ ...CALM, items: [item()] });
    expect(text(".watch-status-word")).toBe(WATCH.calm);
    expect(document.querySelector(".watch-item")).toBeNull();
    expect(primaries()).toEqual([]);
  });

  it("draws the judge's reason with the short badge in place of the authored line, as text nodes", async () => {
    await renderWindow({ ...CALM, judge: judge("calm") });
    const line = document.querySelector(".guided-model-line.watch-model-line");
    expect(line?.tagName).toBe("P");
    expect(line?.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(line?.textContent).toBe(`${judge("calm").reason} ${AI_BADGES_SHORT.chatgpt}`);
    expect(line?.querySelector(".guided-model-badge")?.textContent).toBe(AI_BADGES_SHORT.chatgpt);
    expect(line?.querySelector("button, a, input")).toBeNull();
    expect(document.querySelector(".watch-calm-line")).toBeNull();
    expect(rows()).toEqual(["watch-status", "watch-meta", "guided-model-line", "watch-checkup", "watch-ask", "watch-footer"]);
  });

  it("never draws a judge whose rating differs from the state's", async () => {
    await renderWindow({ ...CALM, judge: judge("keep_an_eye") });
    expect(document.querySelector(".guided-model-line")).toBeNull();
    expect(text(".watch-calm-line")).toBe("No change in 3 days.");
  });

  it("badges Claude and Apple Intelligence with their short names", async () => {
    await renderWindow({ ...CALM, judge: judge("calm", { provider: "claude_plan" }) });
    expect(text(".guided-model-badge")).toBe("Claude, not verified");
    cleanup();
    await renderWindow({ ...CALM, rating: "keep_an_eye", items: [item()], judge: judge("keep_an_eye", { provider: "apple" }) });
    expect(text(".guided-model-badge")).toBe("Apple Intelligence on this Mac, not verified");
  });

  it("hides an On this Mac line on calm and shows the authored line instead", async () => {
    await renderWindow({ ...CALM, ai: { enabled: true, provider: "apple" }, judge: judge("calm", { provider: "apple" }) });
    expect(document.querySelector(".guided-model-line")).toBeNull();
    expect(document.querySelector(".guided-model-badge")).toBeNull();
    expect(text(".watch-calm-line")).toBe("No change in 3 days.");
  });

  it("the authored line follows the date of the last change", async () => {
    expect(calmLine(null, now())).toBe(WATCH_WINDOW.calmStart);
    expect(calmLine("not a date", now())).toBe(WATCH_WINDOW.calmStart);
    expect(calmLine(ago(30), now())).toBe(WATCH_WINDOW.calmRecent);
    expect(calmLine(ago(60), now())).toBe(WATCH_WINDOW.calmHour);
    expect(calmLine(ago(5 * 60 + 20), now())).toBe("No change in 5 hours.");
    expect(calmLine(ago(24 * 60), now())).toBe(WATCH_WINDOW.calmDay);
    expect(calmLine(ago(3 * 24 * 60 + 7 * 60), now())).toBe("No change in 3 days.");
    await renderWindow({ ...CALM, lastChangeAt: null });
    expect(text(".watch-calm-line")).toBe(WATCH_WINDOW.calmStart);
  });

  it("the check-up row: not scored, waiting for the first check-up, and Up next only when the report ids match", async () => {
    await renderWindow({ ...CALM, report: { ...REPORT, score: null, grade: null } });
    expect(text(".watch-checkup-score")).toBe(WATCH_WINDOW.checkupUnscored);
    expect(document.querySelector(".watch-up-next")).not.toBeNull();
    cleanup();
    await renderWindow({ ...CALM, report: null, next: null });
    expect(text(".watch-checkup-score")).toBe(WATCH_WINDOW.checkupNone);
    expect(document.querySelector(".watch-up-next")).toBeNull();
    cleanup();
    await renderWindow({ ...CALM, next: { ...NEXT, reportId: "r-0" } });
    expect(text(".watch-checkup-score")).toBe("Last check-up: 72, Fair.");
    expect(document.querySelector(".watch-up-next")).toBeNull();
    cleanup();
    await renderWindow({ ...CALM, next: null });
    expect(document.querySelector(".watch-up-next")).toBeNull();
  });

  it("Up next is a watch link with an aria-hidden chevron that opens the main window on home", async () => {
    const fake = await renderWindow(CALM);
    const link = document.querySelector<HTMLButtonElement>("button.watch-link.watch-up-next");
    expect(link).not.toBeNull();
    expect(link?.querySelector("span[aria-hidden='true']")?.textContent).toBe("›");
    fireEvent.click(link as HTMLButtonElement);
    expect(fake.openMain).toHaveBeenCalledWith("home");
    expect(fake.openMain).toHaveBeenCalledTimes(1);
  });

  it("Up next keeps a long headline in its own span so the ellipsis cuts the text and never the chevron", async () => {
    // TL-MAC-024 is the widest headline: 416 px at the window's font against a 288 px row.
    await renderWindow({ ...CALM, next: { ...NEXT, ruleId: "TL-MAC-024" } });
    const link = document.querySelector<HTMLButtonElement>("button.watch-link.watch-up-next");
    expect(link).not.toBeNull();
    const parts = Array.from(link?.children ?? []);
    expect(parts.map((part) => part.className)).toEqual(["watch-up-next-text", ""]);
    expect(parts[0]?.textContent).toBe(`Up next: ${guidedFor("TL-MAC-024").headline}`);
    expect(parts[1]?.getAttribute("aria-hidden")).toBe("true");
    expect(parts[1]?.textContent).toBe("›");
    expect(link?.lastElementChild).toBe(parts[1]);
    expect(link?.textContent).toBe(`Up next: ${guidedFor("TL-MAC-024").headline} ›`);
  });

  it("a past, null or unreadable next check reads soon, and the closer watch wins", async () => {
    await renderWindow({ ...CALM, nextCheckAt: ago(5) });
    expect(text(".watch-meta-next")).toBe(WATCH_WINDOW.nextCheckSoon);
    cleanup();
    await renderWindow({ ...CALM, nextCheckAt: null });
    expect(text(".watch-meta-next")).toBe(WATCH_WINDOW.nextCheckSoon);
    cleanup();
    await renderWindow({ ...CALM, nextCheckAt: ago(-20) });
    expect(text(".watch-meta-next")).toBe("Next check in 20 minutes");
    cleanup();
    await renderWindow({ ...CALM, closeWatchUntil: ago(-40) });
    expect(text(".watch-meta-next")).toBe(`Checking every 15 minutes until ${formatTime(ago(-40))}`);
  });

  it("the unreadable row is visible text under the meta line, with no title anywhere", async () => {
    await renderWindow(UNREADABLE);
    expect(text(".watch-unreadable")).toBe("I couldn't check network services, remote access and file sharing. Not available in this build.");
    expect(document.querySelector(".watch-meta-unavailable")).toBeNull();
    expect(document.querySelector("main.watch [title]")).toBeNull();
    expect(rows()).toEqual(["watch-status", "watch-meta", "watch-unreadable", "watch-calm-line", "watch-checkup", "watch-ask", "watch-footer"]);
    expect(primaries()).toEqual([]);
  });

  it("composes the unreadable line for one probe, several with one reason, and several reasons", () => {
    expect(unavailableLine(CALM)).toBe("");
    expect(unavailableLine({ ...CALM, unavailable: [{ probeId: "probe.firewall", reason: "needs_admin" }] })).toBe(`I couldn't check ${WATCH_PROBE_LABELS["probe.firewall"]}. Needs an administrator account.`);
    expect(unavailableLine({ ...CALM, unavailable: [{ probeId: "probe.listeners", reason: "unsigned_build" }] })).toBe("I couldn't check network services. Not available in this build.");
    expect(unavailableLine({ ...CALM, unavailable: [{ probeId: "probe.listeners", reason: "needs_full_disk_access" }, { probeId: "probe.file_sharing", reason: "needs_full_disk_access" }] })).toBe("I couldn't check network services and file sharing. Needs Full Disk Access.");
    expect(
      unavailableLine({
        ...CALM,
        unavailable: [
          { probeId: "probe.listeners", reason: "permission_denied" },
          { probeId: "probe.sudo_config", reason: "needs_admin" },
          { probeId: "probe.persistence_signatures", reason: "timeout" },
        ],
      }),
    ).toBe("I couldn't check 3 areas. Open Talos Labs to see why.");
  });

  it("leaves a spotlight_off row out of the line and the count, and draws no row for it alone", async () => {
    const spotlight = { probeId: "probe.library_apps", reason: "spotlight_off" } as const;
    expect(unavailableLine({ ...CALM, unavailable: [spotlight] })).toBe("");
    expect(unavailableLine({ ...CALM, unavailable: [spotlight, { probeId: "probe.listeners", reason: "unsigned_build" }] })).toBe("I couldn't check network services. Not available in this build.");
    expect(unavailableIsMixed({ ...CALM, unavailable: [spotlight] })).toBe(false);
    await renderWindow({ ...CALM, unavailable: [spotlight] });
    expect(document.querySelector(".watch-unreadable")).toBeNull();
    expect(document.querySelector(".watch-meta-unavailable")).toBeNull();
    cleanup();
    await renderWindow({ ...LOOK, unavailable: [spotlight, { probeId: "probe.firewall", reason: "needs_admin" }] });
    expect(text(".watch-meta-unavailable")).toBe(WATCH.couldNotCheckOne);
  });

  it("the mixed fallback is a watch link that opens the main window on What I watch; the one-area and one-reason rows stay text", async () => {
    const mixed = [
      { probeId: "probe.listeners", reason: "permission_denied" },
      { probeId: "probe.sudo_config", reason: "needs_admin" },
      { probeId: "probe.persistence_signatures", reason: "timeout" },
    ] as const;
    expect(unavailableIsMixed({ ...CALM, unavailable: mixed })).toBe(true);
    expect(unavailableIsMixed(UNREADABLE)).toBe(false);
    const fake = await renderWindow({ ...CALM, unavailable: mixed });
    const button = document.querySelector("button.watch-link.watch-unreadable") as HTMLButtonElement;
    expect(button.textContent).toBe("I couldn't check 3 areas. Open Talos Labs to see why.");
    expect(button.getAttribute("type")).toBe("button");
    expect(document.querySelector("p.watch-unreadable")).toBeNull();
    expect(rows()).toEqual(["watch-status", "watch-meta", "watch-link", "watch-calm-line", "watch-checkup", "watch-ask", "watch-footer"]);
    fireEvent.click(button);
    expect(fake.openMain).toHaveBeenCalledWith("coverage");
    expect(document.querySelector("main.watch [title]")).toBeNull();
    cleanup();
    await renderWindow(UNREADABLE);
    expect(document.querySelector("p.watch-unreadable")).not.toBeNull();
    expect(document.querySelector("button.watch-unreadable")).toBeNull();
  });

  it("falls back to the count when the areas sentence would pass three lines: more than three areas, or over 110 characters", () => {
    const timedOut = (["probe.firewall", "probe.remote_access", "probe.file_sharing", "probe.accounts", "probe.hosts", "probe.backup"] as const).map((probeId) => ({ probeId, reason: "timeout" as const }));
    expect(unavailableLine({ ...CALM, unavailable: timedOut })).toBe("I couldn't check 6 areas. Open Talos Labs to see why.");
    expect(unavailableLine({ ...CALM, unavailable: timedOut.slice(0, 4) })).toBe("I couldn't check 4 areas. Open Talos Labs to see why.");
    const longLabels = (["probe.persistence_signatures", "probe.hosts", "probe.malware_protection"] as const).map((probeId) => ({ probeId, reason: "needs_automation_permission" as const }));
    expect(unavailableLine({ ...CALM, unavailable: longLabels })).toBe("I couldn't check 3 areas. Open Talos Labs to see why.");
    const shortLabels = (["probe.firewall", "probe.hosts", "probe.backup"] as const).map((probeId) => ({ probeId, reason: "timeout" as const }));
    const line = unavailableLine({ ...CALM, unavailable: shortLabels });
    expect(line).toBe("I couldn't check the firewall, website address overrides and backups. Took too long to read.");
    expect(line.length).toBeLessThanOrEqual(110);
  });
});

describe("WatchWindow, the ask field and the Connect line", () => {
  it("draws the field only with ai.enabled: never in act now, first run or paused, nor with the switch off", async () => {
    await renderWindow(ACT);
    expect(document.querySelector(".watch-ask")).toBeNull();
    cleanup();
    await renderWindow(FIRST_RUN);
    expect(document.querySelector(".watch-ask")).toBeNull();
    cleanup();
    await renderWindow(PAUSED);
    expect(document.querySelector(".watch-ask")).toBeNull();
    cleanup();
    await renderWindow({ ...CALM, ai: { enabled: false, provider: "chatgpt" } });
    expect(document.querySelector(".watch-ask")).toBeNull();
    expect(document.querySelector(".watch-connect")).toBeNull();
    cleanup();
    await renderWindow(LOOK);
    expect(document.querySelector(".watch-ask")).toBeNull();
  });

  it("the field is a 500-character text input with the placeholder as its name and an icon Send button", async () => {
    await renderWindow(CALM);
    const input = document.querySelector<HTMLInputElement>("form.watch-ask > input.watch-ask-input");
    expect(input?.type).toBe("text");
    expect(input?.maxLength).toBe(500);
    expect(input?.placeholder).toBe(WATCH_WINDOW.askPlaceholder);
    expect(input?.getAttribute("aria-label")).toBe(WATCH_WINDOW.askPlaceholder);
    const send = document.querySelector<HTMLButtonElement>("form.watch-ask > button.watch-ask-send");
    expect(send?.getAttribute("aria-label")).toBe(WATCH_WINDOW.send);
    expect(send?.querySelector("svg")?.getAttribute("width")).toBe("20");
    expect(send?.classList.contains("button-primary")).toBe(false);
    expect(send?.textContent).toBe("");
  });

  it("Enter sends the trimmed draft as a chat open and clears the field; the button does the same", async () => {
    const fake = await renderWindow(CALM);
    const input = document.querySelector<HTMLInputElement>(".watch-ask-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "  What changed?  " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(fake.openMain).toHaveBeenCalledWith("chat", "What changed?");
    expect(fake.openMain).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("");
    fireEvent.change(input, { target: { value: "Is my disk locked?" } });
    fireEvent.click(screen.getByRole("button", { name: WATCH_WINDOW.send }));
    expect(fake.openMain).toHaveBeenLastCalledWith("chat", "Is my disk locked?");
    expect(fake.openMain).toHaveBeenCalledTimes(2);
    expect(input.value).toBe("");
  });

  it("an empty or whitespace draft does nothing, and Escape leaves the draft alone", async () => {
    const fake = await renderWindow(CALM);
    const input = document.querySelector<HTMLInputElement>(".watch-ask-input") as HTMLInputElement;
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    expect(fake.openMain).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "Why?" } });
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.keyUp(input, { key: "Escape" });
    expect(input.value).toBe("Why?");
    expect(fake.openMain).not.toHaveBeenCalled();
  });

  it("the Connect line is absent by default and with the switch off, and drawn only when the reader says so and ai.enabled is false", async () => {
    await renderWindow({ ...CALM, ai: { enabled: false, provider: null } });
    expect(document.querySelector(".watch-connect")).toBeNull();
    cleanup();
    await renderWindow({ ...CALM, ai: { enabled: false, provider: null } }, () => true);
    const line = document.querySelector("p.watch-connect");
    expect(line?.textContent).toBe(`${WATCH_WINDOW.connectLine} ${WATCH_WINDOW.connectLink} ›`);
    expect(line?.querySelector("button.watch-link")?.textContent).toContain(WATCH_WINDOW.connectLink);
    expect(line?.querySelector("span[aria-hidden='true']")?.textContent).toBe("›");
    expect(document.querySelector(".watch-ask")).toBeNull();
    cleanup();
    // With the switch on the field wins and the reader is not consulted for the line.
    await renderWindow(CALM, () => true);
    expect(document.querySelector(".watch-connect")).toBeNull();
    expect(document.querySelector(".watch-ask")).not.toBeNull();
  });

  it("Connect my AI opens the main window on connect", async () => {
    const fake = await renderWindow({ ...CALM, ai: { enabled: false, provider: null } }, () => true);
    fireEvent.click(screen.getByRole("button", { name: WATCH_WINDOW.connectLink }));
    expect(fake.openMain).toHaveBeenCalledWith("connect");
    expect(fake.openMain).toHaveBeenCalledTimes(1);
  });

  it("a reader that throws hides the line", async () => {
    await renderWindow({ ...CALM, ai: { enabled: false, provider: null } }, () => {
      throw new Error("SecurityError");
    });
    expect(document.querySelector(".watch-connect")).toBeNull();
    expect(document.querySelector("main.watch")).not.toBeNull();
  });

  it("the Connect line disappears on the next state after Not now is written to storage, without a remount, and on a window focus", async () => {
    const values = new Map<string, string>([
      ["talos.settings", JSON.stringify({ explainer: { provider: "chatgpt", aiEnabled: true } })],
      ["talos.guided", JSON.stringify({ version: 1, aiAskedAt: null })],
    ]);
    const storage: Pick<Storage, "getItem"> = { getItem: (key) => values.get(key) ?? null };
    const notConnected = { ...CALM, ai: { enabled: false, provider: null } } as const;
    const fake = await renderWindow(notConnected, () => connectOffer(storage, NOW));
    expect(document.querySelector(".watch-connect")).not.toBeNull();
    values.set("talos.guided", JSON.stringify({ version: 1, aiAskedAt: NOW }));
    act(() => fake.push({ ...notConnected, cycleIndex: 4 }));
    expect(document.querySelector(".watch-connect")).toBeNull();
    values.set("talos.guided", JSON.stringify({ version: 1, aiAskedAt: null }));
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(document.querySelector(".watch-connect")).not.toBeNull();
  });
});

describe("WatchWindow, look", () => {
  it("look: the info word with the count, the top headline and why line, one Show me primary, the ask link, no source", async () => {
    await renderWindow(LOOK);
    expect(text(".watch-status-word")).toBe(WATCH.lookOne);
    expect(text(".watch-item-headline")).toBe(FISHY.noticed.headline.dns);
    expect(text(".watch-item-why")).toBe(WATCH.why.dns);
    expect(document.querySelector(".watch-item-more")).toBeNull();
    expect(document.querySelector(".watch-item-source")).toBeNull();
    expect(document.querySelector(".watch-item-evidence")).toBeNull();
    expect(document.querySelector(".watch-meta-next")).toBeNull();
    expect(text(".watch-meta")).toBe("Checked 10 minutes ago");
    expect(primaries()).toEqual([WATCH.showMe]);
    expect(text("button.watch-link.watch-ask-why")).toBe(WATCH_WINDOW.askLink);
    expect(document.querySelector(".watch-ask")).toBeNull();
    expect(document.querySelector(".watch-checkup")).toBeNull();
    expect(rows()).toEqual(["watch-status", "watch-meta", "watch-item", "button", "watch-link", "watch-footer"]);
  });

  it("the reason line sits after the why and before the more line, with the badge", async () => {
    await renderWindow({ ...LOOK, items: [LOOK.items[0] as WatchItem, item({ signalId: "sig.backup_auto", kind: "backup" })], judge: judge("keep_an_eye", { reason: "Two start-up changes in a day is more than this Mac usually sees." }) });
    const children = Array.from(document.querySelector(".watch-item")?.children ?? []).map((el) => el.className);
    expect(children).toEqual(["watch-item-headline", "watch-item-why", "guided-model-line watch-model-line", "watch-item-more"]);
    expect(text(".guided-model-line")).toBe(`Two start-up changes in a day is more than this Mac usually sees. ${AI_BADGES_SHORT.chatgpt}`);
    expect(text(".watch-item-more")).toBe(WATCH.moreOne);
    expect(text(".watch-status-word")).toBe("2 things to look at");
  });

  it("a calm judge is not drawn in look", async () => {
    await renderWindow({ ...LOOK, judge: judge("calm") });
    expect(document.querySelector(".guided-model-line")).toBeNull();
  });

  it("Ask why this matters sends exactly askWhyQuestion of the top headline as a chat open", async () => {
    const fake = await renderWindow(LOOK);
    fireEvent.click(screen.getByRole("button", { name: WATCH_WINDOW.askLink }));
    expect(fake.openMain).toHaveBeenCalledWith("chat", askWhyQuestion(FISHY.noticed.headline.dns));
    expect(fake.openMain).toHaveBeenCalledWith("chat", "Why does the way your Mac finds websites changed matter?");
    expect(fake.openMain).toHaveBeenCalledTimes(1);
  });

  it("no ask link with the switch off", async () => {
    await renderWindow({ ...LOOK, ai: { enabled: false, provider: "chatgpt" } });
    expect(document.querySelector(".watch-ask-why")).toBeNull();
    expect(primaries()).toEqual([WATCH.showMe]);
  });

  it("the primary opens the noticed screen", async () => {
    const fake = await renderWindow(LOOK);
    fireEvent.click(screen.getByRole("button", { name: WATCH.showMe }));
    expect(fake.openMain).toHaveBeenCalledWith("noticed");
  });

  it("look with no item: the appeared count, else the changes of the last day, a Show me opening home, the reason line and the link", async () => {
    const empty: WatchState = { ...CALM, rating: "keep_an_eye", items: [], recentCount: 1, judge: judge("keep_an_eye") };
    const fake = await renderWindow({ ...empty, rulesSince: { reportId: "r-1", appeared: 1 } });
    expect(text(".watch-status-word")).toBe(WATCH.look);
    expect(WATCH.look).not.toMatch(/\b(one|\d+)\b/i);
    expect(document.querySelector(".watch-item")).toBeNull();
    expect(text(".watch-look-empty")).toBe("At your last check-up, 1 new thing to fix.");
    expect(text(".guided-model-line")).toContain(judge("keep_an_eye").reason);
    expect(primaries()).toEqual([WATCH.showMe]);
    expect(rows()).toEqual(["watch-status", "watch-meta", "watch-look-empty", "guided-model-line", "button", "watch-link", "watch-footer"]);
    fireEvent.click(screen.getByRole("button", { name: WATCH.showMe }));
    expect(fake.openMain).toHaveBeenCalledWith("home");
    // With no item there is no "this" to ask why about: the link's label matches the draft it carries.
    expect(screen.queryByRole("button", { name: WATCH_WINDOW.askLink })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: WATCH_WINDOW.askWhatChangedLink }));
    expect(fake.openMain).toHaveBeenLastCalledWith("chat", WATCH_WINDOW.askWhatChanged);
    expect(lookEmptyLine({ ...empty, rulesSince: { reportId: "r-1", appeared: 3 } })).toBe("At your last check-up, 3 new things to fix.");
    expect(lookEmptyLine({ ...empty, rulesSince: { reportId: "r-1", appeared: 0 } })).toBe("1 change in the last day.");
    expect(lookEmptyLine({ ...empty, recentCount: 4 })).toBe("4 changes in the last day.");
  });

  it("look and act keep the unreadable count on the meta line as text, with no title and no unreadable row", async () => {
    await renderWindow({ ...LOOK, unavailable: UNREADABLE.unavailable });
    expect(text(".watch-meta-unavailable")).toBe("I couldn't check 3 areas");
    expect(document.querySelector(".watch-meta-unavailable")?.getAttribute("title")).toBeNull();
    expect(document.querySelector(".watch-unreadable")).toBeNull();
    cleanup();
    await renderWindow({ ...ACT, unavailable: [{ probeId: "probe.firewall", reason: "needs_admin" }] });
    expect(text(".watch-meta-unavailable")).toBe(WATCH.couldNotCheckOne);
    expect(document.querySelector("main.watch [title]")).toBeNull();
  });
});

describe("WatchWindow, act now", () => {
  it("act: the critical octagon in the critical colour, the top item, the more line, the source line, no evidence, one See what to do primary, no field, no link", async () => {
    await renderWindow(ACT);
    const status = document.querySelector(".watch-status");
    expect(status?.classList.contains("watch-status-act")).toBe(true);
    expect(status?.querySelector("svg")).not.toBeNull();
    expect(text(".watch-status-word")).toBe(WATCH.act);
    expect(text(".watch-item-headline")).toBe(FISHY.noticed.headline.persistence);
    expect(text(".watch-item-why")).toBe(WATCH.why.persistence);
    expect(text(".watch-item-more")).toBe("and 2 more things");
    expect(text(".watch-item-source")).toBe(WATCH.sourceAct);
    expect(document.querySelector(".watch-item-evidence")).toBeNull();
    expect(document.body.textContent).not.toContain(FISHY.evidence);
    expect(primaries()).toEqual([WATCH.seeWhatToDo]);
    expect(document.querySelector(".watch-ask")).toBeNull();
    expect(document.querySelector(".watch-ask-why")).toBeNull();
    expect(document.querySelector(".watch-checkup")).toBeNull();
    expect(rows()).toEqual(["watch-status", "watch-meta", "watch-item", "button", "watch-footer"]);
  });

  it("the reason line sits under the primary in act now, and only for an act_now judge", async () => {
    await renderWindow({ ...ACT, judge: judge("act_now", { reason: "A new start-up program and a new open port appeared within the same hour." }) });
    expect(rows()).toEqual(["watch-status", "watch-meta", "watch-item", "button", "guided-model-line", "watch-footer"]);
    expect(text(".guided-model-line")).toBe(`A new start-up program and a new open port appeared within the same hour. ${AI_BADGES_SHORT.chatgpt}`);
    expect(document.querySelector(".watch-item .guided-model-line")).toBeNull();
    cleanup();
    await renderWindow({ ...ACT, judge: judge("keep_an_eye") });
    expect(document.querySelector(".guided-model-line")).toBeNull();
  });

  it("act with no item is capped to no primary, so one primary or none always holds; the look-empty line and the reason line show", async () => {
    await renderWindow({ ...CALM, rating: "act_now", recentCount: 2, judge: judge("act_now") });
    expect(primaries()).toEqual([]);
    expect(document.querySelector(".watch-item")).toBeNull();
    expect(text(".watch-look-empty")).toBe("2 changes in the last day.");
    expect(count(".guided-model-line")).toBe(1);
    expect(document.querySelector(".watch-ask-why")).toBeNull();
  });
});

describe("WatchWindow, first run and paused", () => {
  it("first run: the sentence, the start-at-login link opening the Watch settings, no status word, no meta, no field, no primary", async () => {
    const fake = await renderWindow(FIRST_RUN);
    expect(text(".watch-first-run-text")).toBe(WATCH.firstRun);
    expect(document.querySelector(".watch-status")).toBeNull();
    expect(document.querySelector(".watch-meta")).toBeNull();
    expect(document.querySelector(".watch-ask")).toBeNull();
    expect(document.querySelector(".watch-checkup")).toBeNull();
    expect(primaries()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: WATCH.startAtLogin }));
    expect(fake.openMain).toHaveBeenCalledWith("settings_watch");
    expect(fake.openMain).toHaveBeenCalledTimes(1);
  });

  it("paused: the pause icon with the time, the meta line, the one authored line, the footer, nothing else", async () => {
    await renderWindow(PAUSED);
    expect(text(".watch-status-word")).toBe(`Paused until ${formatTime(PAUSED.pausedUntil as string)}`);
    expect(document.querySelector(".watch-status-act")).toBeNull();
    expect(document.querySelector(".watch-status svg")).not.toBeNull();
    expect(text(".watch-meta")).toBe("Checked 10 minutes ago");
    expect(document.querySelector(".watch-meta-next")).toBeNull();
    expect(text(".watch-paused-line")).toBe(WATCH_WINDOW.pausedLine);
    expect(document.querySelector(".watch-calm-line")).toBeNull();
    expect(document.querySelector(".guided-model-line")).toBeNull();
    expect(document.querySelector(".watch-checkup")).toBeNull();
    expect(document.querySelector(".watch-ask")).toBeNull();
    expect(primaries()).toEqual([]);
    expect(rows()).toEqual(["watch-status", "watch-meta", "watch-paused-line", "watch-footer"]);
  });

  it("paused with an unreadable area keeps the count on the meta line, as look and act do", async () => {
    await renderWindow({ ...PAUSED, unavailable: [{ probeId: "probe.listeners", reason: "unsigned_build" }] });
    expect(text(".watch-meta-checked")).toBe("Checked 10 minutes ago");
    expect(text(".watch-meta-unavailable")).toBe(WATCH.couldNotCheckOne);
    expect(document.querySelector(".watch-unreadable")).toBeNull();
    expect(rows()).toEqual(["watch-status", "watch-meta", "watch-paused-line", "watch-footer"]);
  });

  it("paused with items and a judge still draws only the pause", async () => {
    await renderWindow({ ...ACT, pausedUntil: ago(-30), judge: judge("act_now") });
    expect(document.querySelector(".watch-item")).toBeNull();
    expect(document.querySelector(".guided-model-line")).toBeNull();
    expect(primaries()).toEqual([]);
    expect(text(".watch-status-word")).toContain("Paused until");
  });

  it("a pause during act now drops the critical colour with the act-now word", async () => {
    const until = ago(-48);
    await renderWindow({ ...ACT, pausedUntil: until });
    const status = document.querySelector(".watch-status");
    expect(status).not.toBeNull();
    expect(status?.classList.contains("watch-status-act")).toBe(false);
    expect(text(".watch-status-word")).toBe(`Paused until ${formatTime(until)}`);
  });
});

describe("WatchWindow, the meta line", () => {
  it("shows Checking now with the static spinner while a check runs, in place of the time, and in calm the next line is omitted", async () => {
    await renderWindow({ ...CALM, checking: true });
    const checking = document.querySelector(".watch-meta-checking");
    expect(checking?.textContent).toBe(WATCH.checking);
    expect(checking?.getAttribute("role")).toBe("status");
    expect(checking?.querySelector("svg")).not.toBeNull();
    expect(checking?.querySelector("svg.spin")).toBeNull();
    expect(text(".watch-meta")).not.toContain("Checked");
    expect(document.querySelector(".watch-meta-next")).toBeNull();
    cleanup();
    await renderWindow({ ...LOOK, checking: true, unavailable: [{ probeId: "probe.firewall", reason: "needs_admin" }] });
    expect(text(".watch-meta-checking")).toBe(WATCH.checking);
    expect(text(".watch-meta-unavailable")).toBe(WATCH.couldNotCheckOne);
  });

  it("rounds to five minutes, then hours, and reads just now under the first step", async () => {
    await renderWindow({ ...CALM, lastCheckAt: ago(1) });
    expect(text(".watch-meta-checked")).toBe(WATCH.checkedJustNow);
    cleanup();
    await renderWindow({ ...CALM, lastCheckAt: ago(33) });
    expect(text(".watch-meta-checked")).toBe("Checked 35 minutes ago");
    cleanup();
    await renderWindow({ ...CALM, lastCheckAt: ago(60 * 5 + 10) });
    expect(text(".watch-meta-checked")).toBe("Checked 5 hours ago");
  });

  it("calm with no check yet keeps the next-check line alone; look with no check yet has no meta line", async () => {
    await renderWindow({ ...CALM, lastCheckAt: null });
    expect(document.querySelector(".watch-meta-checked")).toBeNull();
    expect(text(".watch-meta")).toBe("Next check in about an hour");
    cleanup();
    await renderWindow({ ...LOOK, lastCheckAt: null });
    expect(document.querySelector(".watch-meta")).toBeNull();
  });
});

describe("WatchWindow, the buttons and focus", () => {
  it("the primary opens the main window on the noticed screen", async () => {
    const fake = await renderWindow(ACT);
    fireEvent.click(screen.getByRole("button", { name: WATCH.seeWhatToDo }));
    expect(fake.openMain).toHaveBeenCalledWith("noticed");
    expect(fake.openMain).toHaveBeenCalledTimes(1);
    expect(fake.checkNow).not.toHaveBeenCalled();
  });

  it("the footer links open the main window on home and ask for a check, and are not guided links", async () => {
    const fake = await renderWindow(CALM);
    const footer = document.querySelector(".watch-footer");
    const links = Array.from(footer?.querySelectorAll("button") ?? []).map((b) => b.textContent);
    expect(links).toEqual([WATCH.openApp, WATCH.checkNow]);
    expect(footer?.querySelector(".guided-link")).toBeNull();
    expect(footer?.querySelector(".button-primary")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: WATCH.openApp }));
    expect(fake.openMain).toHaveBeenCalledWith("home");
    fireEvent.click(screen.getByRole("button", { name: WATCH.checkNow }));
    expect(fake.checkNow).toHaveBeenCalledTimes(1);
    expect(fake.openMain).toHaveBeenCalledTimes(1);
  });

  it("follows a pushed state change from calm to act", async () => {
    const fake = await renderWindow(CALM);
    expect(primaries()).toEqual([]);
    act(() => fake.push(ACT));
    expect(text(".watch-status-word")).toBe(WATCH.act);
    expect(primaries()).toEqual([WATCH.seeWhatToDo]);
    expect(document.querySelector(".watch-ask")).toBeNull();
  });

  it("keeps the status live region as one node across a rating change and remounts only the inner span", async () => {
    const fake = await renderWindow(CALM);
    const status = document.querySelector(".watch-status[role='status']");
    const inner = status?.querySelector(".watch-status-inner");
    expect(inner?.querySelector(".watch-status-icon")).not.toBeNull();
    expect(inner?.querySelector(".watch-status-word")?.textContent).toBe(WATCH.calm);
    act(() => fake.push(ACT));
    const after = document.querySelector(".watch-status[role='status']");
    expect(after).toBe(status);
    expect(after?.classList.contains("watch-status-act")).toBe(true);
    const innerAfter = after?.querySelector(".watch-status-inner");
    expect(innerAfter).not.toBe(inner);
    expect(innerAfter?.querySelector(".watch-status-word")?.textContent).toBe(WATCH.act);
    expect(after?.querySelectorAll(".watch-status-inner").length).toBe(1);
    // A check with the same rating keeps the span too: only the rating keys it.
    act(() => fake.push({ ...ACT, checking: true }));
    expect(document.querySelector(".watch-status-inner")).toBe(innerAfter);
  });

  it("renders nothing for an unlicensed state", async () => {
    await renderWindow({ ...ACT, licensed: false });
    expect(document.querySelector("main.watch")).toBeNull();
    expect(primaries()).toEqual([]);
  });

  it("is busy until the first state", () => {
    const listeners = new Set<(state: WatchState) => void>();
    const port: WatchWindowPort = {
      status: () => new Promise(() => undefined),
      onState: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      checkNow: vi.fn(() => Promise.resolve()),
      openMain: vi.fn(() => Promise.resolve()),
    };
    render(<WatchWindow port={port} now={now} />);
    expect(document.querySelector("main.watch")?.getAttribute("aria-busy")).toBe("true");
    act(() => listeners.forEach((l) => l(CALM)));
    expect(document.querySelector("main.watch")?.getAttribute("aria-busy")).toBeNull();
  });

  it("focus lands on the field, else the primary, else Open Talos Labs, on the first state and on every window focus", async () => {
    await renderWindow(CALM);
    expect(document.activeElement?.classList.contains("watch-ask-input")).toBe(true);
    (document.activeElement as HTMLElement).blur();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(document.activeElement?.classList.contains("watch-ask-input")).toBe(true);
    cleanup();
    await renderWindow(LOOK);
    expect(document.activeElement?.classList.contains("watch-primary")).toBe(true);
    cleanup();
    await renderWindow({ ...CALM, ai: { enabled: false, provider: "chatgpt" } });
    expect(document.activeElement?.textContent).toBe(WATCH.openApp);
    cleanup();
    await renderWindow(FIRST_RUN);
    expect(document.activeElement?.textContent).toBe(WATCH.openApp);
  });

  it("never draws more than one primary, a title or the evidence sentence across every state", async () => {
    const states = [CALM, LOOK, ACT, UNREADABLE, FIRST_RUN, PAUSED, { ...ACT, firstRun: true }, { ...CALM, judge: judge("calm") }, { ...LOOK, judge: judge("keep_an_eye") }, { ...ACT, judge: judge("act_now") }, { ...CALM, rating: "keep_an_eye" as const }];
    for (const state of states) {
      await renderWindow(state, () => true);
      expect(document.querySelectorAll(".button-primary").length).toBeLessThanOrEqual(1);
      expect(document.querySelector("main.watch [title]")).toBeNull();
      expect(document.querySelector(".watch-item-evidence")).toBeNull();
      for (const line of Array.from(document.querySelectorAll(".guided-model-line"))) expect(line.querySelector(".guided-model-badge")).not.toBeNull();
      cleanup();
    }
  });
});
