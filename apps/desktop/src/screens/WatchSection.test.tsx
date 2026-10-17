import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WATCH_INTERVALS } from "@talos/core";
import { StatefulProvider, fakeAdapters, fakeContextValue } from "../app/testing";
import { NOT_ANTIVIRUS, WATCH_SETTINGS } from "../guided/copy";
import { DEFAULT_SETTINGS } from "../settings";
import type { AppSettings } from "../settings";
import type { WatchController } from "../watch/watch-controller";
import { INERT_WATCH, WatchControllerContext } from "../watch/watch-controller";
import { INTERVAL_LABELS, WatchSection } from "./WatchSection";

afterEach(cleanup);

const gate = { licensed: true, freeFixes: [], has: () => true, fixLocked: () => false, explainLocked: () => false, watchLocked: false };

function fakeWatch(overrides: Partial<WatchController> = {}): WatchController {
  return {
    ...INERT_WATCH,
    setEnabled: vi.fn(async () => undefined),
    setInterval: vi.fn(async () => undefined),
    setNotify: vi.fn(async () => undefined),
    setStartAtLogin: vi.fn(async () => undefined),
    requestNotifyPermission: vi.fn(async () => undefined),
    ...overrides,
  };
}

function renderSection(watchSettings: Partial<AppSettings["watch"]> = {}, watch: WatchController = fakeWatch()) {
  const settings: AppSettings = { ...DEFAULT_SETTINGS, onboarded: true, watch: { ...DEFAULT_SETTINGS.watch, ...watchSettings } };
  const value = fakeContextValue({ adapters: fakeAdapters(), license: { status: "none" }, gate, scanState: { kind: "idle", last: null }, settings });
  render(createElement(StatefulProvider, { value }, createElement(WatchControllerContext.Provider, { value: watch }, createElement(WatchSection))));
  return { value, watch };
}

describe("WatchSection", () => {
  it("renders the section with its anchor, the four controls from the settings cache and the not-antivirus sentence", () => {
    renderSection({ enabled: true, startAtLogin: false, everyMinutes: 240, notify: false });
    const section = document.querySelector(".settings-section");
    expect(section?.getAttribute("aria-labelledby")).toBe("watch-heading");
    expect(screen.getByRole("heading", { level: 2, name: WATCH_SETTINGS.title }).id).toBe("watch-heading");
    expect((screen.getByRole("switch", { name: WATCH_SETTINGS.enabled }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("switch", { name: WATCH_SETTINGS.startAtLogin }) as HTMLInputElement).checked).toBe(false);
    expect((screen.getByRole("switch", { name: WATCH_SETTINGS.notify }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(WATCH_SETTINGS.sentence)).toBeTruthy();
    expect(screen.getByText(WATCH_SETTINGS.startAtLoginDescription)).toBeTruthy();
    expect(screen.getByText(WATCH_SETTINGS.notifyDescription)).toBeTruthy();
    // "How often" is the kit's segmented control, the one the profile questions use.
    const group = screen.getByRole("group", { name: WATCH_SETTINGS.howOften });
    expect(group.className).toBe("segmented");
    const radios = Array.from(group.querySelectorAll(".segmented-options > label.segment > input[type='radio'][name='watch-interval']")) as HTMLInputElement[];
    expect(radios.map((r) => Number(r.value))).toEqual([...WATCH_INTERVALS]);
    expect(radios.map((r) => r.checked)).toEqual([false, false, true]);
    expect(Array.from(group.querySelectorAll("label.segment")).map((l) => l.classList.contains("segment-on"))).toEqual([false, false, true]);
    for (const minutes of WATCH_INTERVALS) expect(screen.getByLabelText(INTERVAL_LABELS[minutes])).toBeTruthy();
    expect(screen.getByText(NOT_ANTIVIRUS).className).toBe("muted");
    expect(document.querySelectorAll(".button-primary").length).toBe(0);
  });

  it("writes the four keys through the controller and never on mount", async () => {
    const { watch } = renderSection();
    for (const fn of [watch.setEnabled, watch.setInterval, watch.setNotify, watch.setStartAtLogin, watch.requestNotifyPermission]) expect(fn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch", { name: WATCH_SETTINGS.enabled }));
    await waitFor(() => expect(watch.setEnabled).toHaveBeenCalledWith(false));
    fireEvent.click(screen.getByRole("switch", { name: WATCH_SETTINGS.startAtLogin }));
    await waitFor(() => expect(watch.setStartAtLogin).toHaveBeenCalledWith(true));
    fireEvent.click(screen.getByLabelText(INTERVAL_LABELS[15]));
    await waitFor(() => expect(watch.setInterval).toHaveBeenCalledWith(15));
    expect(watch.setInterval).toHaveBeenCalledTimes(1);
    expect(watch.requestNotifyPermission).not.toHaveBeenCalled();
  });

  it("asks for the notification permission exactly once when the notify switch turns on, then records the flag; turning off records only", async () => {
    const calls: string[] = [];
    const watch = fakeWatch({
      requestNotifyPermission: vi.fn(async () => {
        calls.push("permission");
      }),
      setNotify: vi.fn(async (next: boolean) => {
        calls.push(`notify:${next}`);
      }),
    });
    renderSection({ notify: false }, watch);
    fireEvent.click(screen.getByRole("switch", { name: WATCH_SETTINGS.notify }));
    await waitFor(() => expect(calls).toEqual(["permission", "notify:true"]));
    expect(watch.requestNotifyPermission).toHaveBeenCalledTimes(1);
    cleanup();
    const off = fakeWatch();
    renderSection({ notify: true }, off);
    fireEvent.click(screen.getByRole("switch", { name: WATCH_SETTINGS.notify }));
    await waitFor(() => expect(off.setNotify).toHaveBeenCalledWith(false));
    expect(off.requestNotifyPermission).not.toHaveBeenCalled();
  });

  it("keeps the flag write when the permission call rejects", async () => {
    const watch = fakeWatch({
      requestNotifyPermission: vi.fn(async () => {
        throw "command_failed";
      }),
    });
    renderSection({ notify: false }, watch);
    fireEvent.click(screen.getByRole("switch", { name: WATCH_SETTINGS.notify }));
    await waitFor(() => expect(watch.setNotify).toHaveBeenCalledWith(true));
  });
});
