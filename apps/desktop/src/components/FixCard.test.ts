import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Evidence, Fix } from "@talos/core";
import { FixCard, TERMINAL_HINT, TERMINAL_ONLY_HINT, needsTerminalHint } from "./FixCard";

afterEach(cleanup);

const BASE: Fix = {
  summary: "Turn it on.",
  settingsPath: ["System Settings", "Network", "Firewall"],
  settingsPane: "firewall",
  commands: [{ program: "socketfilterfw", args: ["--setglobalstate", "on"], needsAdmin: true, interactive: false, appliesTo: null }],
  steps: ["Open the pane.", "Switch it on."],
  verify: null,
  effort: "two_minutes",
  sideEffects: "none",
  apply: { kind: "in_app", choice: "none", passphrase: false, needsPassword: true, recheck: ["firewall"], confirmTitle: "Turn the firewall on?", confirmVerb: "Turn on", confirmNote: null, reversible: null },
};

const KEY: Evidence = { key: "keyPath", label: "Key", value: { kind: "path", value: "/Users/a/.ssh/id_ed25519" } };

const DEV = { enabled: true, showCommands: true, showPlanExpanded: true };
const NO_DEV = { ...DEV, enabled: false };

// The card now takes a whole finding; this keeps the old test shape.
function card(fix: Fix, evidence: readonly Evidence[], points: number, developerMode: boolean) {
  const status = "fail" as const;
  return {
    finding: { ruleId: "TL-MAC-001" as const, title: "Your firewall is on", headline: "Firewall is off", severity: "high" as const, category: "network" as const, cis: null, requires: ["firewall" as const], status, evidence, unknownReason: null, points, explanation: "x", fix, guided: { headline: "Firewall is off", why: "It matters.", verb: "Turn it on", done: "Done. Firewall on.", where: null } },
    developer: developerMode ? DEV : NO_DEV,
    fixing: null,
    watching: null,
    onApply: vi.fn(),
    onOpenPane: vi.fn(),
    onReveal: vi.fn(),
    onWatch: vi.fn(),
  };
}

const TERMINAL_ONLY: Fix = {
  ...BASE,
  settingsPath: null,
  settingsPane: null,
  commands: [{ program: "chmod", args: ["600", "{path}"], needsAdmin: false, interactive: false, appliesTo: "keyPath" }],
  steps: [],
};

describe("needsTerminalHint", () => {
  it("is false when there are no commands", () => {
    expect(needsTerminalHint({ ...BASE, commands: [] })).toBe(false);
    expect(needsTerminalHint({ ...BASE, commands: [], settingsPath: null, steps: [] })).toBe(false);
  });

  it("is false when the settings path and steps stand on their own", () => {
    expect(needsTerminalHint(BASE)).toBe(false);
  });

  it("is true when nothing but the command describes the fix", () => {
    expect(needsTerminalHint(TERMINAL_ONLY)).toBe(true);
  });

  it("is true when a step points at a command or at Terminal", () => {
    expect(needsTerminalHint({ ...BASE, steps: ["Run the command shown for each key."] })).toBe(true);
    expect(needsTerminalHint({ ...BASE, steps: ["Open Terminal and run chmod 700 ~/.ssh."] })).toBe(true);
    expect(needsTerminalHint({ ...BASE, steps: ["If you prefer Terminal, run the commands above."] })).toBe(true);
    expect(needsTerminalHint({ ...BASE, steps: ["Commanding officer."] })).toBe(false);
  });
});

describe("FixCard", () => {
  it("renders no commands and no hint when Developer mode is off and the steps are enough", () => {
    render(createElement(FixCard, card(BASE, [], 8, false)));
    expect(document.querySelector(".command")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy command" })).toBeNull();
    expect(screen.queryByText(TERMINAL_HINT)).toBeNull();
    expect(screen.getByText("Switch it on.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open this settings pane" })).toBeTruthy();
  });

  it("says the fix is done in Terminal when there is no Settings path, and part of it otherwise", () => {
    render(createElement(FixCard, card(TERMINAL_ONLY, [KEY], 2, false)));
    expect(document.querySelector(".command")).toBeNull();
    expect(document.body.textContent).not.toContain("chmod");
    expect(screen.getByText(TERMINAL_ONLY_HINT)).toBeTruthy();
    expect(screen.queryByText(TERMINAL_HINT)).toBeNull();
    cleanup();
    const partly: Fix = { ...BASE, steps: ["Run the command shown for each key."] };
    render(createElement(FixCard, card(partly, [], 2, false)));
    expect(screen.getByText(TERMINAL_HINT)).toBeTruthy();
    expect(screen.queryByText(TERMINAL_ONLY_HINT)).toBeNull();
  });

  it("shows the filled command with a Copy button in Developer mode, headed by whether Terminal is the only way", () => {
    render(createElement(FixCard, card(TERMINAL_ONLY, [KEY], 2, true)));
    expect(screen.getByText("chmod 600 /Users/a/.ssh/id_ed25519")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy command" })).toBeTruthy();
    expect(screen.getByText("In Terminal")).toBeTruthy();
    expect(screen.queryByText("If you prefer Terminal")).toBeNull();
    expect(screen.queryByText(TERMINAL_HINT)).toBeNull();
    expect(screen.queryByText(TERMINAL_ONLY_HINT)).toBeNull();
    cleanup();
    render(createElement(FixCard, card(BASE, [], 8, true)));
    expect(screen.getByText("If you prefer Terminal")).toBeTruthy();
  });

  it("numbers the Copy buttons when a fix has several commands", () => {
    const two: Fix = { ...BASE, commands: [...BASE.commands, { program: "ls", args: ["-la"], needsAdmin: false, interactive: false, appliesTo: null }] };
    render(createElement(FixCard, card(two, [], 8, true)));
    expect(screen.getByRole("button", { name: "Copy command 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy command 2" })).toBeTruthy();
  });

  it("labels the path block by the app it starts in", () => {
    render(createElement(FixCard, card(BASE, [], 8, false)));
    expect(screen.getByText("In System Settings")).toBeTruthy();
    cleanup();
    const appStore: Fix = { ...BASE, settingsPath: ["App Store", "Settings", "Automatic Updates"], settingsPane: null };
    render(createElement(FixCard, card(appStore, [], 2, false)));
    expect(screen.getByText("In App Store")).toBeTruthy();
    expect(screen.queryByText("In System Settings")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open this settings pane" })).toBeNull();
  });

  it("marks the interactive note so it always lands under the command", () => {
    const prompts: Fix = { ...BASE, commands: [{ ...BASE.commands[0]!, interactive: true }] };
    render(createElement(FixCard, card(prompts, [], 8, true)));
    const note = screen.getByText("Prompts for input");
    expect(note.classList.contains("command-note")).toBe(true);
    expect(note.closest(".command")).not.toBeNull();
  });

  it("reads the Settings path with a spoken separator and no prohibited label", () => {
    render(createElement(FixCard, card(BASE, [], 8, false)));
    const path = document.querySelector("p.settings-path") as HTMLParagraphElement;
    expect(path.getAttribute("aria-label")).toBeNull();
    const spoken = path.cloneNode(true) as HTMLElement;
    spoken.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
    expect(spoken.textContent).toBe("System Settings, then Network, then Firewall");
  });
});

describe("CopyButton", () => {
  it("names itself by its visible text and announces Copied through a status region", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(createElement(FixCard, card(TERMINAL_ONLY, [KEY], 2, true)));
    const button = screen.getByRole("button", { name: "Copy command" });
    expect(button.getAttribute("aria-live")).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith("chmod 600 /Users/a/.ssh/id_ed25519");
    expect(screen.getByRole("status").textContent).toBe("Copied");
  });
});
