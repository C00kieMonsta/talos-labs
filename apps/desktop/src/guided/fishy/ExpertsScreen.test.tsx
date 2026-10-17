// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { WatchDetailsItem, WatchItem } from "@talos/core";
import { playbookRow } from "@talos/core";
import { formatTime } from "../../app/labels";
import { StatefulProvider, fakeAdapters, fakeContextValue } from "../../app/testing";
import { REVEAL_LABEL } from "../../components/FixCard";
import { DEFAULT_SETTINGS } from "../../settings";
import { INERT_WATCH, WatchControllerContext } from "../../watch/watch-controller";
import { FISHY } from "../copy";
import { detailLines } from "./DetailsDisclosure";
import { EXPERT_ROWS, ExpertsScreen, LEAD_EXPERT_ROWS, LEAD_ROWS, expertRows } from "./ExpertsScreen";
import { NoticedScreen } from "./NoticedScreen";
import type { FishyController } from "./controller";
import { FishyContext, INERT_FISHY } from "./controller";

afterEach(cleanup);

const gate = { licensed: true, freeFixes: [], has: () => true, fixLocked: () => false, explainLocked: () => false, watchLocked: false };
const CHANGED_AT = "2026-10-17T13:32:00.000Z";
const BASE_ROWS = ["passwords", "devices", "twoFactor", "restore", "reinstall", "report", "update"] as const;

function item(overrides: Partial<WatchItem>): WatchItem {
  return {
    signalId: "sig.persistence_new",
    kind: "persistence",
    severity: "high",
    points: 6,
    change: "appeared",
    changedAt: CHANGED_AT,
    gated: false,
    snoozedUntil: null,
    hasStartupEntry: false,
    isListener: false,
    actionIds: [],
    modelSentence: null,
    modelProvider: null,
    ...overrides,
  };
}

const EXPOSURE = item({ kind: "exposure", signalId: "sig.internet_sharing_on", actionIds: ["act.stop_internet_sharing", "act.limit_airdrop", "act.change_passwords"] });
const SHELL = item({ kind: "shell", signalId: "sig.shell_startup_changed", severity: "medium", points: 3, actionIds: ["act.get_help", "act.note_what_you_saw"] });

function renderWith(fishy: Partial<FishyController>, element: React.ReactElement) {
  const value = fakeContextValue({ adapters: fakeAdapters(), license: { status: "none" }, gate, scanState: { kind: "idle", last: null }, settings: { ...DEFAULT_SETTINGS, onboarded: true } });
  const controller: FishyController = { ...INERT_FISHY, next: vi.fn(), reveal: vi.fn(), showPane: vi.fn(), setRansomNote: vi.fn(), thisIsFine: vi.fn(), ...fishy };
  render(createElement(StatefulProvider, { value }, createElement(WatchControllerContext.Provider, { value: INERT_WATCH }, createElement(FishyContext.Provider, { value: controller }, element))));
  return controller;
}

function rowTexts(): string[] {
  const list = document.querySelector(".guided-fishy-experts .guided-end-list") as HTMLElement;
  return Array.from(list.querySelectorAll(":scope > li > .guided-end-row .guided-end-row-text")).map((el) => el.textContent ?? "");
}

describe("expertRows", () => {
  it("the two-argument call returns the nine base rows as before, lead rows excluded", () => {
    expect(expertRows(false, false)).toEqual({ main: [...BASE_ROWS], more: ["lockdown"] });
    expect(expertRows(true, true).main).toEqual(["passwords", "devices", "twoFactor", "restore", "doNotPay", "reinstall", "report", "update", "lockdown"]);
    expect(expertRows(true, true).more).toEqual([]);
    expect(expertRows(false, false, null)).toEqual(expertRows(false, false));
    expect([...EXPERT_ROWS, ...LEAD_EXPERT_ROWS].map((row) => row.key)).toEqual([...Object.keys(FISHY.experts.rows)]);
    expect(EXPERT_ROWS.length).toBe(9);
    expect(LEAD_EXPERT_ROWS.map((row) => row.actionId)).toEqual(["act.limit_airdrop", "act.stop_internet_sharing", "act.get_help"]);
    expect(LEAD_ROWS).toEqual({ exposure: ["limitAirdrop", "stopSharing"], shell: ["getHelp"] });
    for (const row of [...EXPERT_ROWS, ...LEAD_EXPERT_ROWS]) expect(playbookRow(row.actionId)?.id).toBe(row.actionId);
  });

  it("prepends the lead rows the item's actions name, in LEAD_ROWS order, and never a lead row the playbook did not trigger", () => {
    expect(expertRows(false, false, EXPOSURE).main).toEqual(["limitAirdrop", "stopSharing", ...BASE_ROWS]);
    expect(expertRows(false, false, { ...EXPOSURE, actionIds: ["act.stop_internet_sharing"] }).main).toEqual(["stopSharing", ...BASE_ROWS]);
    expect(expertRows(false, false, { ...EXPOSURE, actionIds: [] }).main).toEqual([...BASE_ROWS]);
    expect(expertRows(false, false, SHELL).main).toEqual(["getHelp", ...BASE_ROWS]);
    expect(expertRows(true, true, SHELL).main).toEqual(["getHelp", "passwords", "devices", "twoFactor", "restore", "doNotPay", "reinstall", "report", "update", "lockdown"]);
    // A kind with no lead rows keeps the base list even when its actions include a lead action.
    expect(expertRows(false, false, item({ kind: "app", signalId: "sig.app_new_unsigned", actionIds: ["act.get_help"] })).main).toEqual([...BASE_ROWS]);
  });
});

describe("ExpertsScreen with the lead rows", () => {
  it("draws the AirDrop and Internet Sharing rows first for an exposure item, each with its pane button under Details", () => {
    const fishy = renderWith({ item: EXPOSURE }, createElement(ExpertsScreen, { item: EXPOSURE, handlesClientData: false }));
    expect(rowTexts()).toEqual([FISHY.experts.rows.limitAirdrop.text, FISHY.experts.rows.stopSharing.text, ...BASE_ROWS.map((key) => FISHY.experts.rows[key].text)]);
    expect(rowTexts().length).toBe(9);
    fireEvent.click(screen.getByRole("button", { name: `${FISHY.experts.rows.limitAirdrop.text} ${FISHY.noticed.details}` }));
    const details = document.querySelector(".guided-fishy-experts .fishy-details[open]") as HTMLElement;
    expect(details.textContent).toContain(FISHY.experts.rows.limitAirdrop.details);
    expect(details.textContent).toContain(playbookRow("act.limit_airdrop")?.whatExpertsDo ?? "missing");
    fireEvent.click(details.querySelector("button.button-small") as HTMLElement);
    expect(fishy.showPane).toHaveBeenCalledWith("airdrop");
    expect(document.querySelectorAll(".button-primary").length).toBe(1);
    expect(document.querySelectorAll(".guided-link").length).toBe(0);
  });

  it("draws the get-help row first for a shell item, with no pane button", () => {
    renderWith({ item: SHELL }, createElement(ExpertsScreen, { item: SHELL, handlesClientData: false }));
    expect(rowTexts()[0]).toBe(FISHY.experts.rows.getHelp.text);
    expect(rowTexts().length).toBe(8);
    fireEvent.click(screen.getByRole("button", { name: `${FISHY.experts.rows.getHelp.text} ${FISHY.noticed.details}` }));
    const details = document.querySelector(".guided-fishy-experts .fishy-details[open]") as HTMLElement;
    expect(details.textContent).toContain(FISHY.experts.rows.getHelp.details);
    expect(details.querySelector("button.button-small")).toBeNull();
  });
});

describe("Details for the new kinds", () => {
  it("detailLines adds the changed file and the signature in words", () => {
    expect(detailLines({ signalId: "sig.shell_startup_changed", filePath: "/Users/me/.zshrc" })).toEqual(["/Users/me/.zshrc"]);
    expect(detailLines({ signalId: "sig.app_new_unsigned", label: "Helper.app", programPath: "/Applications/Helper.app", signature: "unsigned" })).toEqual(["Helper.app", "/Applications/Helper.app", "not signed"]);
    expect(detailLines({ signalId: "sig.app_new_unsigned", signature: "adhoc" })).toEqual([FISHY.signature.adhoc]);
    expect(detailLines({ signalId: "sig.internet_sharing_on" })).toEqual([]);
  });

  it("the noticed screen adds the changed-at line for a shell row and no Reveal; an app row gets Reveal and no changed-at line", () => {
    const shellRow: WatchDetailsItem = { signalId: "sig.shell_startup_changed", filePath: "/Users/me/.zshrc" };
    renderWith({ item: SHELL }, createElement(NoticedScreen, { kind: "shell", changedAt: CHANGED_AT, row: shellRow }));
    expect(screen.getByRole("heading", { level: 1, name: FISHY.noticed.headline.shell })).toBeTruthy();
    expect(document.querySelector(".fishy-changed-at")?.textContent).toBe(`changed at ${formatTime(CHANGED_AT)}`);
    expect(document.querySelector(".fishy-detail-lines")?.textContent).toBe("/Users/me/.zshrc");
    expect(screen.queryByRole("button", { name: REVEAL_LABEL })).toBeNull();
    cleanup();
    const appRow: WatchDetailsItem = { signalId: "sig.app_new_unsigned", label: "Helper.app", programPath: "/Applications/Helper.app", signature: "unsigned" };
    const app = item({ kind: "app", signalId: "sig.app_new_unsigned" });
    const fishy = renderWith({ item: app }, createElement(NoticedScreen, { kind: "app", changedAt: CHANGED_AT, row: appRow }));
    expect(document.querySelector(".fishy-changed-at")).toBeNull();
    expect(Array.from(document.querySelectorAll(".fishy-detail-lines li")).map((li) => li.textContent)).toEqual(["Helper.app", "/Applications/Helper.app", "not signed"]);
    fireEvent.click(screen.getByRole("button", { name: REVEAL_LABEL }));
    expect(fishy.reveal).toHaveBeenCalledTimes(1);
    cleanup();
    renderWith({ item: EXPOSURE }, createElement(NoticedScreen, { kind: "exposure", changedAt: CHANGED_AT, row: { signalId: "sig.internet_sharing_on" } }));
    expect(screen.getByRole("heading", { level: 1, name: FISHY.noticed.headline.exposure })).toBeTruthy();
    expect(document.querySelector(".fishy-detail-lines")).toBeNull();
    expect(screen.queryByRole("button", { name: REVEAL_LABEL })).toBeNull();
  });
});
