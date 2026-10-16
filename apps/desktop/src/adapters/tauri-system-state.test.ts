import { invoke } from "@tauri-apps/api/core";
import { listen, type EventCallback, type UnlistenFn } from "@tauri-apps/api/event";
import { DEV_MACHINE, type SectionProgress } from "@talos/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ScanError, TauriSystemStateAdapter } from "./tauri-system-state";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const listenMock = vi.mocked(listen);

let handler: EventCallback<unknown> | null = null;
const unlisten = vi.fn<UnlistenFn>();

function emit(payload: unknown): void {
  handler?.({ event: "scan:progress", id: 1, payload });
}

beforeEach(() => {
  invokeMock.mockReset();
  listenMock.mockReset();
  unlisten.mockReset();
  handler = null;
  listenMock.mockImplementation(async (_name, cb) => {
    handler = cb as EventCallback<unknown>;
    return unlisten;
  });
});

describe("TauriSystemStateAdapter.collect", () => {
  it("returns the validated state and forwards well-formed progress events", async () => {
    const seen: SectionProgress[] = [];
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd !== "collect_system_state") return undefined;
      emit({ key: "firewall", status: "started" });
      emit({ key: "firewall", status: "ok" });
      emit({ key: "nope", status: "ok" });
      emit({ key: "firewall", status: "exploded" });
      emit("garbage");
      return DEV_MACHINE;
    });
    const state = await new TauriSystemStateAdapter().collect({ onProgress: (p) => seen.push(p) });
    expect(state).toEqual(DEV_MACHINE);
    expect(seen).toEqual([
      { key: "firewall", status: "started" },
      { key: "firewall", status: "ok" },
    ]);
    expect(listenMock).toHaveBeenCalledWith("scan:progress", expect.any(Function));
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("does not subscribe to progress when no callback is given", async () => {
    invokeMock.mockResolvedValueOnce(DEV_MACHINE);
    await new TauriSystemStateAdapter().collect();
    expect(listenMock).not.toHaveBeenCalled();
  });

  it("forwards an abort to cancel_scan and surfaces the cancellation", async () => {
    const controller = new AbortController();
    invokeMock.mockImplementation(
      (cmd: string) =>
        new Promise((resolve, reject) => {
          if (cmd === "cancel_scan") {
            resolve(undefined);
            return;
          }
          controller.signal.addEventListener("abort", () => reject("cancelled"));
        }),
    );
    const pending = new TauriSystemStateAdapter().collect({ signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "ScanError", kind: "cancelled" });
    expect(invokeMock).toHaveBeenCalledWith("cancel_scan");
  });

  it("rejects at once when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(new TauriSystemStateAdapter().collect({ signal: controller.signal })).rejects.toMatchObject({
      kind: "cancelled",
    });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("maps a collector timeout and a crash to their kinds", async () => {
    invokeMock.mockRejectedValueOnce("timeout");
    await expect(new TauriSystemStateAdapter().collect()).rejects.toMatchObject({ kind: "timeout" });
    invokeMock.mockRejectedValueOnce(new Error("panicked"));
    await expect(new TauriSystemStateAdapter().collect()).rejects.toMatchObject({ kind: "collector_crashed" });
  });

  it("rejects JSON that fails the SystemState guard", async () => {
    invokeMock.mockResolvedValueOnce({ schemaVersion: 1, sections: {} });
    const error = await new TauriSystemStateAdapter().collect().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ScanError);
    expect((error as ScanError).kind).toBe("schema_mismatch");
    expect((error as ScanError).message).toContain("schema mismatch");
  });
});

describe("TauriSystemStateAdapter.collectSection", () => {
  it("returns a validated section", async () => {
    invokeMock.mockResolvedValueOnce(DEV_MACHINE.sections.firewall);
    const section = await new TauriSystemStateAdapter().collectSection("firewall");
    expect(section).toEqual(DEV_MACHINE.sections.firewall);
    expect(invokeMock).toHaveBeenCalledWith("collect_section", { key: "firewall" });
  });

  it("accepts an unavailable section", async () => {
    const unavailable = { status: "unavailable", reason: "needs_full_disk_access", detail: null };
    invokeMock.mockResolvedValueOnce(unavailable);
    expect(await new TauriSystemStateAdapter().collectSection("browsers")).toEqual(unavailable);
  });

  it("rejects a section with the wrong shape", async () => {
    invokeMock.mockResolvedValueOnce({ status: "ok", data: { enabled: "yes" } });
    await expect(new TauriSystemStateAdapter().collectSection("firewall")).rejects.toMatchObject({
      kind: "schema_mismatch",
    });
  });

  it("maps a collector error string", async () => {
    invokeMock.mockRejectedValueOnce("boom");
    await expect(new TauriSystemStateAdapter().collectSection("firewall")).rejects.toMatchObject({
      kind: "collector_crashed",
    });
  });

  it("rejects with cancelled on abort and forwards it to cancel_section, even if the command never answers", async () => {
    const controller = new AbortController();
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "cancel_section" ? Promise.resolve(undefined) : new Promise<never>(() => undefined),
    );
    const pending = new TauriSystemStateAdapter().collectSection("firewall", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "ScanError", kind: "cancelled" });
    expect(invokeMock).toHaveBeenCalledWith("collect_section", { key: "firewall" });
    expect(invokeMock).toHaveBeenCalledWith("cancel_section");
  });

  it("rejects at once when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new TauriSystemStateAdapter().collectSection("firewall", { signal: controller.signal }),
    ).rejects.toMatchObject({ kind: "cancelled" });
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("still rejects with cancelled when cancel_section itself fails", async () => {
    const controller = new AbortController();
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "cancel_section" ? Promise.reject(new Error("no window")) : new Promise<never>(() => undefined),
    );
    const pending = new TauriSystemStateAdapter().collectSection("ssh", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("removes its abort listener once the section arrives and never calls cancel_section", async () => {
    const listeners = new Set<() => void>();
    const signal = {
      aborted: false,
      addEventListener: vi.fn((_type: "abort", listener: () => void) => listeners.add(listener)),
      removeEventListener: vi.fn((_type: "abort", listener: () => void) => listeners.delete(listener)),
    };
    invokeMock.mockResolvedValueOnce(DEV_MACHINE.sections.firewall);
    const section = await new TauriSystemStateAdapter().collectSection("firewall", { signal });
    expect(section).toEqual(DEV_MACHINE.sections.firewall);
    expect(signal.addEventListener).toHaveBeenCalledTimes(1);
    expect(signal.removeEventListener).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    expect(invokeMock).not.toHaveBeenCalledWith("cancel_section");
  });

  it("a late answer after abort is dropped rather than surfaced", async () => {
    const controller = new AbortController();
    let finish: (value: unknown) => void = () => undefined;
    invokeMock.mockImplementation((cmd: string) =>
      cmd === "cancel_section"
        ? Promise.resolve(undefined)
        : new Promise<unknown>((resolve) => {
            finish = resolve;
          }),
    );
    const pending = new TauriSystemStateAdapter().collectSection("firewall", { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
    finish(DEV_MACHINE.sections.firewall);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
  });
});

describe("TauriSystemStateAdapter.capabilities", () => {
  it("passes a well-formed answer through", async () => {
    invokeMock.mockResolvedValueOnce({ fullDiskAccess: true, automation: "granted", bundled: true });
    expect(await new TauriSystemStateAdapter().capabilities()).toEqual({ fullDiskAccess: true, automation: "granted", bundled: true });
    invokeMock.mockResolvedValueOnce({ fullDiskAccess: null, automation: null, bundled: false });
    expect(await new TauriSystemStateAdapter().capabilities()).toEqual({ fullDiskAccess: null, automation: null, bundled: false });
    expect(invokeMock).toHaveBeenCalledWith("check_capabilities");
  });

  it("treats a malformed answer as unknown, field by field, and a missing bundled flag as bundled", async () => {
    invokeMock.mockResolvedValueOnce({ fullDiskAccess: "maybe", automation: "denied", bundled: false });
    expect(await new TauriSystemStateAdapter().capabilities()).toEqual({ fullDiskAccess: null, automation: "denied", bundled: false });
    invokeMock.mockResolvedValueOnce({ fullDiskAccess: false, automation: "sometimes" });
    expect(await new TauriSystemStateAdapter().capabilities()).toEqual({ fullDiskAccess: false, automation: null, bundled: true });
    invokeMock.mockResolvedValueOnce("nope");
    expect(await new TauriSystemStateAdapter().capabilities()).toEqual({ fullDiskAccess: null, automation: null, bundled: true });
  });
});
