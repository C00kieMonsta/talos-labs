import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRequire } from "node:module";
import type { WatchDetails, WatchItem } from "@talos/core";
import { FISHY_KINDS, playbookRow } from "@talos/core";
import { AI_BADGES, DECIDED_BY_APP, formatTime } from "../app/labels";
import { StatefulProvider, fakeAdapters, fakeContextValue } from "../app/testing";
import { REVEAL_LABEL } from "../components/FixCard";
import { DEFAULT_SETTINGS } from "../settings";
import type { AppSettings } from "../settings";
import { INERT_WATCH, WatchControllerContext } from "../watch/watch-controller";
import { FishyFlow } from "./FishyFlow";
import { FISHY, FIX, NEXT, STATUS, WATCH, failureCopy } from "./copy";
import { EXPERT_ROWS, expertRows } from "./fishy/ExpertsScreen";
import type { FishyController, FishyStage } from "./fishy/controller";
import { FishyContext, INERT_FISHY } from "./fishy/controller";

const require = createRequire(import.meta.url);
const axe = require("axe-core") as { run(ctx: Element, opts: object): Promise<{ violations: { id: string }[] }> };

afterEach(cleanup);

const gate = { licensed: false, freeFixes: [], has: () => false, fixLocked: () => true, explainLocked: () => false, watchLocked: true };
const CHANGED_AT = "2026-10-17T13:32:00.000Z";

const ITEM: WatchItem = {
  signalId: "sig.persistence_new",
  kind: "persistence",
  severity: "high",
  points: 6,
  change: "appeared",
  changedAt: CHANGED_AT,
  gated: false,
  snoozedUntil: null,
  hasStartupEntry: true,
  isListener: false,
  actionIds: ["act.disconnect_network", "act.change_passwords"],
  modelSentence: "A program you did not install now starts by itself.",
  modelProvider: "chatgpt",
};

const DETAILS: WatchDetails = {
  items: [{ signalId: "sig.persistence_new", plistPath: "/Users/me/Library/LaunchAgents/com.example.helper.plist", label: "com.example.helper", programPath: "/tmp/.helper", scope: "user_agent" }],
  wifiAvailable: true,
};

function fakeFishy(overrides: Partial<FishyController>): FishyController {
  return {
    ...INERT_FISHY,
    item: ITEM,
    details: DETAILS,
    setRansomNote: vi.fn(),
    open: vi.fn(),
    next: vi.fn(),
    notNow: vi.fn(),
    thisIsFine: vi.fn(),
    answerGate: vi.fn(),
    runAction: vi.fn(async () => undefined),
    showPane: vi.fn(),
    reveal: vi.fn(),
    openSource: vi.fn(),
    done: vi.fn(),
    ...overrides,
  };
}

function renderFlow(stage: FishyStage, overrides: Partial<FishyController> = {}, settings: Partial<AppSettings> = {}) {
  const value = fakeContextValue({ adapters: fakeAdapters(), license: { status: "none" }, gate, scanState: { kind: "idle", last: null }, settings: { ...DEFAULT_SETTINGS, onboarded: true, ...settings } });
  const fishy = fakeFishy({ stage, ...overrides });
  render(createElement(StatefulProvider, { value }, createElement(WatchControllerContext.Provider, { value: INERT_WATCH }, createElement(FishyContext.Provider, { value: fishy }, createElement(FishyFlow)))));
  return { fishy, value };
}

function primaries(): string[] {
  return Array.from(document.querySelectorAll(".button-primary")).map((b) => b.textContent ?? "");
}

function links(): string[] {
  return Array.from(document.querySelectorAll(".guided-link")).map((b) => b.textContent ?? "");
}

function sources(): string[] {
  return Array.from(document.querySelectorAll(".guided-body .guided-source")).map((p) => p.textContent ?? "");
}

function openDetails(): HTMLDetailsElement {
  const details = document.querySelector("details.fishy-details") as HTMLDetailsElement;
  details.open = true;
  return details;
}

describe("FishyFlow, every screen", () => {
  const stages: FishyStage[] = ["gate", "noticed", "disconnect", "stop", "eradicate", "experts", "recover"];
  it.each(stages)("%s draws one primary, at most one link, no progress line and the fishy class", (stage) => {
    renderFlow(stage, { item: { ...ITEM, kind: "remote", signalId: "sig.remote_access_on", gated: true } });
    expect(primaries().length).toBe(1);
    expect(links().length).toBeLessThanOrEqual(1);
    expect(document.querySelector("[role='progressbar']")).toBeNull();
    expect(document.querySelector(".guided-step")?.className).toContain("guided-fishy");
    expect(document.body.textContent).not.toContain("{time}");
  });

  it("opened with no item it shows the calm word and Done", () => {
    const { fishy } = renderFlow("noticed", { item: null, details: null });
    expect(screen.getByRole("heading", { level: 1, name: WATCH.calm })).toBeTruthy();
    expect(primaries()).toEqual([FISHY.experts.primary]);
    fireEvent.click(screen.getByRole("button", { name: FISHY.experts.primary }));
    expect(fishy.done).toHaveBeenCalledTimes(1);
  });
});

describe("FishyFlow, the gate", () => {
  it("asks whether the person made the flip, with the time, and answers through the controller", () => {
    const { fishy } = renderFlow("gate", { item: { ...ITEM, kind: "remote", signalId: "sig.remote_access_on", gated: true } });
    expect(screen.getByRole("heading", { level: 1, name: FISHY.gate.title })).toBeTruthy();
    expect(screen.getByText(FISHY.gate.body.remote.replace("{time}", formatTime(CHANGED_AT)))).toBeTruthy();
    expect(primaries()).toEqual([FISHY.gate.primary]);
    expect(links()).toEqual([FISHY.gate.link]);
    expect(document.querySelector("details")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: FISHY.gate.primary }));
    expect(fishy.answerGate).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: FISHY.gate.link }));
    expect(fishy.answerGate).toHaveBeenCalledWith(true);
  });

  it("falls back to the noticed screen for a gated item whose kind has no gate sentence", () => {
    renderFlow("gate", { item: { ...ITEM, gated: true } });
    expect(screen.getByRole("heading", { level: 1, name: FISHY.noticed.headline.persistence })).toBeTruthy();
  });
});

describe("FishyFlow, what I noticed", () => {
  it.each(FISHY_KINDS)("headlines %s from the fixed set, with the time and the source line", (kind) => {
    renderFlow("noticed", { item: { ...ITEM, kind } });
    expect(screen.getByRole("heading", { level: 1, name: FISHY.noticed.headline[kind] })).toBeTruthy();
    expect(screen.getByText(FISHY.noticed.body.replace("{time}", formatTime(CHANGED_AT)))).toBeTruthy();
    expect(sources()).toEqual([FISHY.noticed.source]);
    expect(primaries()).toEqual([FISHY.noticed.primary]);
    expect(links()).toEqual([FISHY.noticed.link]);
  });

  it("keeps the program's name and folder under Details only, with the ransom box, Reveal and the source button", async () => {
    const { fishy } = renderFlow("noticed");
    const body = document.querySelector(".guided-body") as HTMLElement;
    expect(body.textContent).not.toContain("com.example.helper");
    const details = openDetails();
    expect(details.className).toBe("guided-explain fishy-details");
    expect(details.querySelector("summary")?.textContent).toBe(FISHY.noticed.details);
    const lines = Array.from(details.querySelectorAll(".fishy-detail-lines li")).map((li) => li.textContent);
    expect(lines).toEqual(["com.example.helper", "/Users/me/Library/LaunchAgents/com.example.helper.plist", "/tmp/.helper"]);
    // The evidence sentence sits under Details, next to the file it is about, and nowhere else on the screen.
    expect(details.querySelector(".fishy-evidence")?.textContent).toBe(FISHY.evidence);
    expect(screen.getAllByText(FISHY.evidence).length).toBe(1);
    const row = playbookRow("act.note_what_you_saw");
    expect(details.querySelector(".fishy-experts-do")?.textContent).toBe(row?.whatExpertsDo);
    expect(details.querySelector(".fishy-phase")?.textContent).toBe(`${row?.phase}, ${row?.outcome}`);
    const source = details.querySelector(".fishy-source-button") as HTMLButtonElement;
    expect(source.tagName).toBe("BUTTON");
    expect(source.className).not.toContain("guided-link");
    expect(source.textContent).toBe(row?.step);
    expect(details.querySelector("a")).toBeNull();
    fireEvent.click(source);
    expect(fishy.openSource).toHaveBeenCalledWith("act.note_what_you_saw");
    const box = screen.getByLabelText(FISHY.noticed.ransom) as HTMLInputElement;
    expect(box.checked).toBe(false);
    fireEvent.click(box);
    expect(fishy.setRansomNote).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: REVEAL_LABEL }));
    expect(fishy.reveal).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: FISHY.noticed.primary }));
    expect(fishy.next).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: FISHY.noticed.link }));
    expect(fishy.thisIsFine).toHaveBeenCalledTimes(1);
    const result = await axe.run(document.body, { runOnly: ["button-name", "label", "nested-interactive", "heading-order"] });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });

  it("hides Reveal when the item has no start-up entry path and lists a port or process as plain text", () => {
    renderFlow("noticed", { item: { ...ITEM, kind: "listener", signalId: "sig.listener_new_ports", hasStartupEntry: false, isListener: true }, details: { items: [{ signalId: "sig.listener_new_ports", port: 4444, processName: "helper" }], wifiAvailable: true } });
    openDetails();
    expect(screen.queryByRole("button", { name: REVEAL_LABEL })).toBeNull();
    expect(Array.from(document.querySelectorAll(".fishy-detail-lines li")).map((li) => li.textContent)).toEqual(["Port 4444", "helper"]);
  });
});

describe("FishyFlow, disconnect", () => {
  it("turns Wi-Fi off after the password line, with both source lines and the keep-it-running sentence", () => {
    const { fishy } = renderFlow("disconnect");
    expect(screen.getByRole("heading", { level: 1, name: FISHY.disconnect.title })).toBeTruthy();
    expect(screen.getByText(FISHY.disconnect.body)).toBeTruthy();
    expect(screen.getByText(FISHY.disconnect.keepOn)).toBeTruthy();
    expect(sources()).toEqual([FISHY.disconnect.source, FISHY.disconnect.keepOnSource]);
    expect(screen.getByText(FIX.password).className).toBe("guided-meta-line");
    expect(primaries()).toEqual([FISHY.disconnect.primary]);
    expect(links()).toEqual([FISHY.disconnect.link]);
    fireEvent.click(screen.getByRole("button", { name: FISHY.disconnect.primary }));
    expect(fishy.runAction).toHaveBeenCalledWith("watch.wifi_off");
    fireEvent.click(screen.getByRole("button", { name: FISHY.disconnect.link }));
    expect(fishy.notNow).toHaveBeenCalledWith("act.disconnect_network");
    const details = openDetails();
    fireEvent.click(details.querySelector(".fishy-source-button") as HTMLButtonElement);
    expect(fishy.openSource).toHaveBeenCalledWith("act.disconnect_network");
  });

  it("on a wired Mac says unplug the cable and blocks incoming connections instead", () => {
    const { fishy } = renderFlow("disconnect", { wired: true });
    expect(screen.getByText(FISHY.disconnect.bodyWired)).toBeTruthy();
    expect(screen.queryByText(FISHY.disconnect.body)).toBeNull();
    expect(screen.getByText(FISHY.disconnect.keepOn)).toBeTruthy();
    expect(primaries()).toEqual([FISHY.disconnect.primaryWired]);
    fireEvent.click(screen.getByRole("button", { name: FISHY.disconnect.primaryWired }));
    expect(fishy.runAction).toHaveBeenCalledWith("watch.block_incoming");
    fireEvent.click(screen.getByRole("button", { name: FISHY.disconnect.link }));
    expect(fishy.notNow).toHaveBeenCalledWith("act.block_incoming");
  });

  it("shows the status line and disables both controls while the row runs, the password sentence while macOS asks", () => {
    renderFlow("disconnect", { busy: "password" });
    expect(document.querySelector(".guided-status[role='status']")?.textContent).toBe(STATUS.password);
    expect((document.querySelector(".button-primary") as HTMLButtonElement).disabled).toBe(true);
    expect((document.querySelector(".guided-link") as HTMLButtonElement).disabled).toBe(true);
    cleanup();
    renderFlow("disconnect", { busy: "working" });
    expect(document.querySelector(".guided-status[role='status']")?.textContent).toBe(STATUS.working);
  });

  it("shows the failure table on error: Try again runs the same row, Not now stays the link", () => {
    const { fishy } = renderFlow("disconnect", { error: "cancelled" });
    const copy = failureCopy("cancelled", false, false, true);
    expect(screen.getByRole("heading", { level: 1, name: copy.title })).toBeTruthy();
    expect(screen.getByText(copy.body as string)).toBeTruthy();
    expect(primaries()).toEqual([FIX.tryAgain]);
    expect(links()).toEqual([FISHY.disconnect.link]);
    fireEvent.click(screen.getByRole("button", { name: FIX.tryAgain }));
    expect(fishy.runAction).toHaveBeenCalledWith("watch.wifi_off");
    fireEvent.click(screen.getByRole("button", { name: FISHY.disconnect.link }));
    expect(fishy.notNow).toHaveBeenCalledWith("act.disconnect_network");
    cleanup();
    // A row that cannot run from here hands over with Next; a stop row hands over to the "Show me where" screen.
    const failed = renderFlow("disconnect", { error: "command_failed" });
    expect(primaries()).toEqual([FIX.next]);
    expect(links()).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: FIX.next }));
    expect(failed.fishy.next).toHaveBeenCalledTimes(1);
    cleanup();
    const stop = renderFlow("stop", { error: "command_failed" });
    expect(primaries()).toEqual([FIX.showWhere]);
    fireEvent.click(screen.getByRole("button", { name: FIX.showWhere }));
    expect(stop.fishy.next).toHaveBeenCalledTimes(1);
  });
});

describe("FishyFlow, stop the program", () => {
  it("stops a user start-up entry with no password, a system daemon with the password line", () => {
    const { fishy } = renderFlow("stop");
    expect(screen.getByRole("heading", { level: 1, name: FISHY.stop.title })).toBeTruthy();
    expect(screen.getByText(FISHY.stop.body)).toBeTruthy();
    expect(sources()).toEqual([FISHY.stop.source]);
    expect(screen.queryByText(FIX.password)).toBeNull();
    expect(primaries()).toEqual([FISHY.stop.primary]);
    fireEvent.click(screen.getByRole("button", { name: FISHY.stop.primary }));
    expect(fishy.runAction).toHaveBeenCalledWith("watch.stop_user_agent");
    fireEvent.click(screen.getByRole("button", { name: FISHY.stop.link }));
    expect(fishy.notNow).toHaveBeenCalledWith("act.stop_background_program");
    cleanup();
    const daemon = renderFlow("stop", { details: { items: [{ signalId: "sig.persistence_new", plistPath: "/Library/LaunchDaemons/com.example.plist", scope: "system_daemon" }], wifiAvailable: true } });
    expect(screen.getByText(FIX.password)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: FISHY.stop.primary }));
    expect(daemon.fishy.runAction).toHaveBeenCalledWith("watch.stop_daemon");
  });

  it("for a listener with no start-up entry asks the person to quit it and blocks incoming connections", () => {
    const { fishy } = renderFlow("stop", { item: { ...ITEM, kind: "listener", signalId: "sig.listener_new_ports", hasStartupEntry: false, isListener: true }, details: { items: [{ signalId: "sig.listener_new_ports", port: 4444, processName: "helper" }], wifiAvailable: true } });
    expect(screen.getByText(FISHY.stop.bodyNoEntry)).toBeTruthy();
    expect(screen.queryByText(FISHY.stop.body)).toBeNull();
    expect(screen.getByText(FIX.password)).toBeTruthy();
    expect(primaries()).toEqual([FISHY.stop.primaryNoEntry]);
    fireEvent.click(screen.getByRole("button", { name: FISHY.stop.primaryNoEntry }));
    expect(fishy.runAction).toHaveBeenCalledWith("watch.block_incoming");
    fireEvent.click(screen.getByRole("button", { name: FISHY.stop.link }));
    expect(fishy.notNow).toHaveBeenCalledWith("act.block_incoming");
    openDetails();
    expect(Array.from(document.querySelectorAll(".fishy-detail-lines li")).map((li) => li.textContent)).toEqual(["Port 4444", "helper"]);
  });
});

describe("FishyFlow, keep it from starting again", () => {
  it("opens Login Items, asks the watch to check now, then carries on; Reveal sits under Details", () => {
    const { fishy } = renderFlow("eradicate");
    expect(screen.getByRole("heading", { level: 1, name: FISHY.eradicate.title })).toBeTruthy();
    expect(screen.getByText(FISHY.eradicate.body)).toBeTruthy();
    expect(sources()).toEqual([FISHY.eradicate.source]);
    expect(primaries()).toEqual([FISHY.eradicate.primary]);
    expect(links()).toEqual([FISHY.eradicate.link]);
    fireEvent.click(screen.getByRole("button", { name: FISHY.eradicate.primary }));
    expect(fishy.showPane).toHaveBeenCalledWith("login_items");
    expect(fishy.next).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: FISHY.eradicate.link }));
    expect(fishy.notNow).toHaveBeenCalledWith("act.review_background_programs");
    openDetails();
    fireEvent.click(screen.getByRole("button", { name: REVEAL_LABEL }));
    expect(fishy.reveal).toHaveBeenCalledTimes(1);
  });
});

describe("FishyFlow, what experts do next", () => {
  it("lists the rows as 44 px controls with no inline links or buttons, Done as the one primary and no link", async () => {
    const { fishy } = renderFlow("experts");
    expect(screen.getByRole("heading", { level: 1, name: FISHY.experts.title })).toBeTruthy();
    const { main, more } = expertRows(false, false);
    expect(main).toEqual(["passwords", "devices", "twoFactor", "restore", "reinstall", "report", "update"]);
    expect(more).toEqual(["lockdown"]);
    const list = document.querySelector(".guided-end-list") as HTMLElement;
    const rows = Array.from(list.querySelectorAll(".guided-end-row"));
    expect(rows.map((r) => r.querySelector(".guided-end-row-text")?.textContent)).toEqual(main.map((key) => FISHY.experts.rows[key].text));
    expect(list.querySelectorAll("button").length).toBe(rows.length);
    expect(list.querySelectorAll("a, .guided-link, .button-primary").length).toBe(0);
    for (const row of rows) expect(row.querySelectorAll("svg").length).toBe(2);
    expect(primaries()).toEqual([FISHY.experts.primary]);
    expect(links()).toEqual([]);
    const moreDetails = document.querySelector("details.fishy-more") as HTMLDetailsElement;
    expect(moreDetails.querySelector("summary")?.textContent).toBe(FISHY.experts.more);
    expect(moreDetails.querySelector(".guided-end-row-text")?.textContent).toBe(FISHY.experts.rows.lockdown.text);
    fireEvent.click(screen.getByRole("button", { name: FISHY.experts.primary }));
    expect(fishy.next).toHaveBeenCalledTimes(1);
    const result = await axe.run(document.body, { runOnly: ["button-name", "nested-interactive", "list", "listitem", "heading-order", "aria-valid-attr-value"] });
    expect(result.violations.map((v) => v.id)).toEqual([]);
  });

  it("adds the do-not-pay row after the ransom box and the Lockdown row to the list for someone who handles others' data", () => {
    renderFlow("experts", { ransomNote: true }, { profile: { ...DEFAULT_SETTINGS.profile, handlesClientData: true } });
    const texts = Array.from(document.querySelectorAll(".guided-end-row-text")).map((t) => t.textContent);
    expect(texts).toEqual(EXPERT_ROWS.map((row) => FISHY.experts.rows[row.key].text));
    expect(document.querySelector("details.fishy-more")).toBeNull();
  });

  it("a row opens its own Details with the source line, the model's sentence under its badge, and the pane button", () => {
    const { fishy } = renderFlow("experts");
    const passwords = screen.getByRole("button", { name: `${FISHY.experts.rows.passwords.text} ${FISHY.noticed.details}` });
    expect(passwords.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector("details.fishy-details")).toBeNull();
    fireEvent.click(passwords);
    expect(passwords.getAttribute("aria-expanded")).toBe("true");
    const details = document.querySelector("details.fishy-details") as HTMLDetailsElement;
    expect(details.open).toBe(true);
    expect(details.closest("li")?.contains(passwords)).toBe(true);
    expect(details.textContent).toContain(FISHY.experts.rows.passwords.details);
    // act.change_passwords is in the item's action ids: the model's sentence and its badge.
    expect(details.querySelector(".fishy-model")?.textContent).toBe(ITEM.modelSentence);
    expect(details.querySelector(".guided-meta.guided-explain-badge")?.textContent).toBe(AI_BADGES.chatgpt);
    const source = details.querySelector(".fishy-source-button") as HTMLButtonElement;
    expect(source.textContent).toBe(playbookRow("act.change_passwords")?.step);
    fireEvent.click(source);
    expect(fishy.openSource).toHaveBeenCalledWith("act.change_passwords");
    fireEvent.click(passwords);
    expect(document.querySelector("details.fishy-details")).toBeNull();
    // A row the model did not pick says the app decided; a pane row carries "Show me where".
    fireEvent.click(screen.getByRole("button", { name: `${FISHY.experts.rows.report.text} ${FISHY.noticed.details}` }));
    expect(document.querySelector(".fishy-model")).toBeNull();
    expect(document.querySelector(".guided-explain-badge")?.textContent).toBe(DECIDED_BY_APP);
    fireEvent.click(screen.getByRole("button", { name: `${FISHY.experts.rows.restore.text} ${FISHY.noticed.details}` }));
    fireEvent.click(screen.getByRole("button", { name: NEXT.show }));
    expect(fishy.showPane).toHaveBeenCalledWith("time_machine");
    expect(fishy.next).not.toHaveBeenCalled();
  });

  it("says the app decided when the watch had no model sentence", () => {
    renderFlow("experts", { item: { ...ITEM, modelSentence: null, modelProvider: null } });
    fireEvent.click(screen.getByRole("button", { name: `${FISHY.experts.rows.passwords.text} ${FISHY.noticed.details}` }));
    expect(document.querySelector(".fishy-model")).toBeNull();
    expect(document.querySelector(".guided-explain-badge")?.textContent).toBe(DECIDED_BY_APP);
  });
});

describe("FishyFlow, back to normal", () => {
  it("turns Wi-Fi on, or allows incoming again on a wired Mac, after the password line", () => {
    const { fishy } = renderFlow("recover");
    expect(screen.getByRole("heading", { level: 1, name: FISHY.recover.title })).toBeTruthy();
    expect(screen.getByText(FISHY.recover.body)).toBeTruthy();
    expect(sources()).toEqual([FISHY.recover.source]);
    expect(screen.getByText(FIX.password)).toBeTruthy();
    expect(primaries()).toEqual([FISHY.recover.primary]);
    expect(links()).toEqual([FISHY.recover.link]);
    fireEvent.click(screen.getByRole("button", { name: FISHY.recover.primary }));
    expect(fishy.runAction).toHaveBeenCalledWith("watch.wifi_on");
    fireEvent.click(screen.getByRole("button", { name: FISHY.recover.link }));
    expect(fishy.notNow).toHaveBeenCalledWith("act.reconnect_and_watch");
    cleanup();
    const wired = renderFlow("recover", { wired: true });
    expect(primaries()).toEqual([FISHY.recover.primaryWired]);
    fireEvent.click(screen.getByRole("button", { name: FISHY.recover.primaryWired }));
    expect(wired.fishy.runAction).toHaveBeenCalledWith("watch.allow_incoming");
  });
});

describe("FishyFlow, no machine text outside Details", () => {
  it.each<FishyStage>(["noticed", "disconnect", "stop", "eradicate", "experts", "recover"])("%s keeps the path, label and program out of the headline, body and controls", (stage) => {
    renderFlow(stage);
    for (const selector of [".guided-title", ".guided-body", ".guided-actions", ".guided-link"]) {
      const text = Array.from(document.querySelectorAll(selector)).map((n) => n.textContent).join(" ");
      expect(text).not.toContain("com.example");
      expect(text).not.toContain("/tmp/.helper");
    }
  });
});
