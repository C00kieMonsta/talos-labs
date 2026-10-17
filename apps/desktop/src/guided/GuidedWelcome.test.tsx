// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";
import { AppContext } from "../app/context";
import { fakeAdapters, fakeContextValue } from "../app/testing";
import { DEFAULT_SETTINGS } from "../settings";
import { GuidedWelcome } from "./GuidedWelcome";

afterEach(cleanup);

function renderWelcome(onboarded: boolean) {
  const value = fakeContextValue({
    adapters: fakeAdapters(),
    license: { status: "none" },
    gate: { licensed: false, freeFixes: [], has: () => false, fixLocked: () => true, explainLocked: () => false, watchLocked: true },
    scanState: { kind: "idle", last: null },
    settings: { ...DEFAULT_SETTINGS, onboarded },
  });
  return render(createElement(AppContext.Provider, { value }, createElement(GuidedWelcome, { onStart: vi.fn() })));
}

describe("GuidedWelcome", () => {
  it("staggers the hello on the first launch only", () => {
    const first = renderWelcome(false);
    expect(first.container.querySelector(".guided-welcome.guided-welcome-first")).not.toBeNull();
    cleanup();
    const later = renderWelcome(true);
    expect(later.container.querySelector(".guided-welcome")).not.toBeNull();
    expect(later.container.querySelector(".guided-welcome-first")).toBeNull();
  });
});
