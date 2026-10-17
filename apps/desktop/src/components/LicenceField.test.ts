import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LicenseState } from "@talos/core";
import { StatefulProvider, fakeAdapters, fakeContextValue } from "../app/testing";
import { LICENCE_AUTO_VERIFY_MS, LICENCE_UNLOCK_DELAY_MS, LicenceField } from "./LicenceField";

afterEach(cleanup);

const VALID: LicenseState = {
  status: "valid",
  payload: { v: 1, lid: "L", product: "talos-desktop", plan: "personal", seats: 1, issuedAt: "2026-01-01", updatesUntil: "2027-10-15", tag: "abcd1234" },
};
const GOOD_KEY = `TL1.${"a".repeat(24)}.${"b".repeat(64)}`;

function mount(install: (key: string) => Promise<LicenseState>, props: { onUnlocked?: () => void; onBuy?: () => void } = {}) {
  const adapters = fakeAdapters();
  adapters.license.install = vi.fn(install);
  const value = fakeContextValue({ adapters, license: { status: "none" }, gate: { licensed: false, freeFixes: [], has: () => false, fixLocked: () => true, explainLocked: () => true }, scanState: { kind: "idle", report: null, last: null } });
  render(createElement(StatefulProvider, { value }, createElement(LicenceField, { onBuy: props.onBuy ?? vi.fn(), onUnlocked: props.onUnlocked })));
  return { adapters, value };
}

describe("LicenceField", () => {
  it("verifies a pasted key on its own after the debounce and unlocks after the valid line", async () => {
    vi.useFakeTimers();
    try {
      const onUnlocked = vi.fn();
      const { adapters } = mount(async () => VALID, { onUnlocked });
      fireEvent.change(screen.getByLabelText("Licence key"), { target: { value: ` ${GOOD_KEY} ` } });
      expect(adapters.license.install).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(LICENCE_AUTO_VERIFY_MS);
      });
      expect(adapters.license.install).toHaveBeenCalledWith(GOOD_KEY);
      await act(async () => {
        await Promise.resolve();
      });
      expect(screen.getByText(/Licensed\. Updates until 2027-10-15/)).toBeTruthy();
      expect(onUnlocked).not.toHaveBeenCalled();
      await act(async () => {
        vi.advanceTimersByTime(LICENCE_UNLOCK_DELAY_MS);
      });
      expect(onUnlocked).toHaveBeenCalledWith(VALID);
    } finally {
      vi.useRealTimers();
    }
  });

  it("needs the Activate button for a key that does not match the pattern and announces a rejection", async () => {
    const { adapters } = mount(async () => ({ status: "invalid", reason: "signature" }));
    const input = screen.getByLabelText("Licence key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "TL1.short" } });
    await new Promise((r) => setTimeout(r, LICENCE_AUTO_VERIFY_MS + 50));
    expect(adapters.license.install).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("The key is not signed by Talos Labs."));
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    expect(input.disabled).toBe(false);
    fireEvent.change(input, { target: { value: "TL1.other" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("disables the field while checking and keeps the Buy link in place", async () => {
    let settle: (state: LicenseState) => void = () => undefined;
    const onBuy = vi.fn();
    mount(() => new Promise<LicenseState>((resolve) => (settle = resolve)), { onBuy });
    const input = screen.getByLabelText("Licence key") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "TL1.x" } });
    fireEvent.click(screen.getByRole("button", { name: "Activate" }));
    await waitFor(() => expect(input.disabled).toBe(true));
    expect(screen.getByRole("button", { name: "Checking" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Buy a licence" }));
    expect(onBuy).toHaveBeenCalled();
    expect(screen.getByText("Your key arrives by email.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Buy a licence" }).closest(".field-row")).not.toBeNull();
    await act(async () => {
      settle({ status: "invalid", reason: "revoked" });
    });
    await waitFor(() => expect(input.disabled).toBe(false));
    expect(screen.getByRole("alert").textContent).toBe("The key has been revoked.");
  });
});
