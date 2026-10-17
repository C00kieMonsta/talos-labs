import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WatchItem, WatchState } from "@talos/core";
import { UNKNOWN_REASON_LABELS, WATCH_PROBE_LABELS } from "../app/labels";
import { FISHY, WATCH } from "../guided/copy";
import { WatchWindow, unavailableTitle } from "./WatchWindow";
import type { WatchWindowPort } from "./WatchWindow";

afterEach(cleanup);

const NOW = "2026-10-16T12:00:00.000Z";
const now = () => new Date(NOW);

function ago(minutes: number): string {
  return new Date(new Date(NOW).getTime() - minutes * 60_000).toISOString();
}

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
};

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

const LOOK: WatchState = { ...CALM, rating: "keep_an_eye", items: [item({ signalId: "sig.dns_manual", kind: "dns", severity: "medium", points: 3, change: "changed" })] };
const ACT: WatchState = { ...CALM, rating: "act_now", items: [item(), item({ signalId: "sig.listener_new_ports", kind: "listener", isListener: true }), item({ signalId: "sig.firewall", kind: "guard" })] };
const UNREADABLE: WatchState = {
  ...CALM,
  unavailable: [
    { probeId: "probe.listeners", reason: "permission_denied" },
    { probeId: "probe.sudo_config", reason: "needs_admin" },
    { probeId: "probe.persistence_signatures", reason: "timeout" },
  ],
};
const FIRST_RUN: WatchState = { ...CALM, firstRun: true, since: null, lastCheckAt: null, cycleIndex: 0 };

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

async function renderWindow(state: WatchState) {
  const fake = fakePort(state);
  render(<WatchWindow port={fake.port} now={now} />);
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

describe("WatchWindow, the four states", () => {
  it("calm: the check-up icon, the word, the rounded time, no item, no primary", async () => {
    await renderWindow(CALM);
    expect(text(".watch-status-word")).toBe(WATCH.calm);
    expect(document.querySelector(".watch-status-act")).toBeNull();
    expect(document.querySelector(".watch-status svg")?.getAttribute("width")).toBe("20");
    expect(text(".watch-meta")).toBe("Checked 10 minutes ago");
    expect(document.querySelector(".watch-item")).toBeNull();
    expect(primaries()).toEqual([]);
    expect(document.querySelector(".watch-first-run")).toBeNull();
    expect(document.querySelector(".guided-link")).toBeNull();
    expect(document.querySelector("[role='progressbar']")).toBeNull();
  });

  it("calm with a stray item shows neither the headline nor a primary", async () => {
    await renderWindow({ ...CALM, items: [item()] });
    expect(text(".watch-status-word")).toBe(WATCH.calm);
    expect(document.querySelector(".watch-item")).toBeNull();
    expect(primaries()).toEqual([]);
  });

  it("look: the info word with the count, the top headline and why line, and one Show me primary", async () => {
    await renderWindow(LOOK);
    expect(text(".watch-status-word")).toBe(WATCH.lookOne);
    expect(text(".watch-item-headline")).toBe(FISHY.noticed.headline.dns);
    expect(text(".watch-item-why")).toBe(WATCH.why.dns);
    expect(document.querySelector(".watch-item-more")).toBeNull();
    expect(document.querySelector(".watch-item-source")).toBeNull();
    expect(document.querySelector(".watch-item-evidence")).toBeNull();
    expect(primaries()).toEqual([WATCH.showMe]);
  });

  it("look with no item carries no count, like the tray tooltip, with no headline and no primary", async () => {
    await renderWindow({ ...CALM, rating: "keep_an_eye" });
    expect(text(".watch-status-word")).toBe(WATCH.look);
    expect(WATCH.look).not.toMatch(/\b(one|\d+)\b/i);
    expect(document.querySelector(".watch-item")).toBeNull();
    expect(primaries()).toEqual([]);
  });

  it("look with several items: the plural word and the more line", async () => {
    await renderWindow({ ...LOOK, items: [LOOK.items[0] as WatchItem, item({ signalId: "sig.backup_auto", kind: "backup" })] });
    expect(text(".watch-status-word")).toBe("2 things to look at");
    expect(text(".watch-item-more")).toBe(WATCH.moreOne);
  });

  it("act: the critical octagon in the critical colour, the top item, the more line, the source and evidence lines, one See what to do primary", async () => {
    await renderWindow(ACT);
    const status = document.querySelector(".watch-status");
    expect(status?.classList.contains("watch-status-act")).toBe(true);
    expect(status?.querySelector("svg")).not.toBeNull();
    expect(text(".watch-status-word")).toBe(WATCH.act);
    expect(text(".watch-item-headline")).toBe(FISHY.noticed.headline.persistence);
    expect(text(".watch-item-why")).toBe(WATCH.why.persistence);
    expect(text(".watch-item-more")).toBe("and 2 more things");
    expect(text(".watch-item-source")).toBe(WATCH.sourceAct);
    expect(text(".watch-item-evidence")).toBe(FISHY.evidence);
    expect(primaries()).toEqual([WATCH.seeWhatToDo]);
  });

  it("act with no item is capped to no primary, so one primary or none always holds", async () => {
    await renderWindow({ ...CALM, rating: "act_now" });
    expect(primaries()).toEqual([]);
    expect(document.querySelector(".watch-item")).toBeNull();
  });

  it("unreadable: the count of areas with a hover title naming each area and reason", async () => {
    await renderWindow(UNREADABLE);
    const line = document.querySelector(".watch-meta-unavailable");
    expect(line?.textContent).toBe("I couldn't check 3 areas");
    expect(line?.getAttribute("title")).toBe(
      [
        `${WATCH_PROBE_LABELS["probe.listeners"]}: ${UNKNOWN_REASON_LABELS.permission_denied}`,
        `${WATCH_PROBE_LABELS["probe.sudo_config"]}: ${UNKNOWN_REASON_LABELS.needs_admin}`,
        `${WATCH_PROBE_LABELS["probe.persistence_signatures"]}: ${UNKNOWN_REASON_LABELS.timeout}`,
      ].join("\n"),
    );
    expect(text(".watch-meta")).toContain("Checked 10 minutes ago");
    expect(primaries()).toEqual([]);
  });

  it("unreadable with one area uses the singular", async () => {
    await renderWindow({ ...CALM, unavailable: [{ probeId: "probe.firewall", reason: "needs_admin" }] });
    expect(text(".watch-meta-unavailable")).toBe(WATCH.couldNotCheckOne);
    expect(unavailableTitle({ ...CALM, unavailable: [{ probeId: "probe.firewall", reason: "needs_admin" }] })).toBe(`${WATCH_PROBE_LABELS["probe.firewall"]}: ${UNKNOWN_REASON_LABELS.needs_admin}`);
  });

  it("first run: the sentence, the start-at-login link opening the Watch settings, no status word, no primary", async () => {
    const fake = await renderWindow(FIRST_RUN);
    expect(text(".watch-first-run-text")).toBe(WATCH.firstRun);
    expect(document.querySelector(".watch-status")).toBeNull();
    expect(document.querySelector(".watch-meta")).toBeNull();
    expect(primaries()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: WATCH.startAtLogin }));
    expect(fake.openMain).toHaveBeenCalledWith("settings_watch");
    expect(fake.openMain).toHaveBeenCalledTimes(1);
  });
});

describe("WatchWindow, the meta line", () => {
  it("shows Checking now with the static spinner while a check runs, in place of the time", async () => {
    await renderWindow({ ...CALM, checking: true });
    const checking = document.querySelector(".watch-meta-checking");
    expect(checking?.textContent).toBe(WATCH.checking);
    expect(checking?.getAttribute("role")).toBe("status");
    expect(checking?.querySelector("svg")).not.toBeNull();
    expect(checking?.querySelector("svg.spin")).toBeNull();
    expect(text(".watch-meta")).not.toContain("Checked");
  });

  it("rounds to five minutes, then hours, and reads just now under the first step", async () => {
    await renderWindow({ ...CALM, lastCheckAt: ago(1) });
    expect(text(".watch-meta")).toBe(WATCH.checkedJustNow);
    cleanup();
    await renderWindow({ ...CALM, lastCheckAt: ago(33) });
    expect(text(".watch-meta")).toBe("Checked 35 minutes ago");
    cleanup();
    await renderWindow({ ...CALM, lastCheckAt: ago(60 * 5 + 10) });
    expect(text(".watch-meta")).toBe("Checked 5 hours ago");
  });

  it("has no meta line with no check yet and nothing unavailable", async () => {
    await renderWindow({ ...CALM, lastCheckAt: null });
    expect(document.querySelector(".watch-meta")).toBeNull();
  });
});

describe("WatchWindow, the buttons", () => {
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
  });

  it("renders nothing for an unlicensed state", async () => {
    await renderWindow({ ...ACT, licensed: false });
    expect(document.querySelector("main.watch")).toBeNull();
    expect(primaries()).toEqual([]);
  });

  it("never draws more than one primary across every state", async () => {
    for (const state of [CALM, LOOK, ACT, UNREADABLE, FIRST_RUN, { ...ACT, firstRun: true }]) {
      await renderWindow(state);
      expect(document.querySelectorAll(".button-primary").length).toBeLessThanOrEqual(1);
      cleanup();
    }
  });
});
