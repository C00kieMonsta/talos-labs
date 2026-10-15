import { describe, expect, it } from "vitest";
import { assertSystemState, isSystemState, SystemStateGuardError } from "../../src/domain/system-state.guard";
import { ALL_UNAVAILABLE, DEV_MACHINE, FIXTURES, HARDENED } from "../../src/fixtures/index";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

type Loose = Record<string, any>;

describe("assertSystemState", () => {
  it("accepts every fixture, including after a JSON round trip", () => {
    for (const [name, state] of Object.entries(FIXTURES)) {
      expect(() => assertSystemState(state), name).not.toThrow();
      expect(isSystemState(clone(state)), name).toBe(true);
    }
  });

  it("rejects a missing section", () => {
    const state: Loose = clone(DEV_MACHINE);
    delete state["sections"]["firewall"];
    expect(() => assertSystemState(state)).toThrow(SystemStateGuardError);
    expect(() => assertSystemState(state)).toThrow("$.sections.firewall: missing");
    expect(isSystemState(state)).toBe(false);
  });

  it("rejects an unknown reason", () => {
    const state: Loose = clone(ALL_UNAVAILABLE);
    state["sections"]["firewall"]["reason"] = "dog_ate_it";
    expect(() => assertSystemState(state)).toThrow("$.sections.firewall.reason");
    expect(isSystemState(state)).toBe(false);
  });

  it("rejects a wrong status", () => {
    const state: Loose = clone(HARDENED);
    state["sections"]["ssh"]["status"] = "pending";
    expect(() => assertSystemState(state)).toThrow("$.sections.ssh.status");
    expect(isSystemState(state)).toBe(false);
  });

  it("rejects a non-string path", () => {
    const state: Loose = clone(DEV_MACHINE);
    state["sections"]["ssh"]["data"]["keys"][0]["path"] = 42;
    expect(() => assertSystemState(state)).toThrow("$.sections.ssh.data.keys[0].path: expected a string");
    expect(isSystemState(state)).toBe(false);
  });

  it("rejects a nested browser extensions section with a bad reason", () => {
    const state: Loose = clone(DEV_MACHINE);
    state["sections"]["browsers"]["data"]["installed"][0]["extensions"]["reason"] = "nope";
    expect(() => assertSystemState(state)).toThrow("$.sections.browsers.data.installed[0].extensions.reason");
  });

  it("rejects bad enums, bad tri values and a wrong schemaVersion", () => {
    const bad = (mutate: (s: Loose) => void, path: string) => {
      const state: Loose = clone(DEV_MACHINE);
      mutate(state);
      expect(() => assertSystemState(state)).toThrow(path);
    };
    bad((s) => (s["schemaVersion"] = 2), "$.schemaVersion");
    bad((s) => (s["host"]["os"] = "beos"), "$.host.os");
    bad((s) => (s["host"]["arch"] = "riscv"), "$.host.arch");
    bad((s) => (s["sections"]["updates"]["data"]["automaticCheck"] = "maybe"), "$.sections.updates.data.automaticCheck");
    bad((s) => (s["sections"]["listeners"]["data"]["entries"][0]["bind"] = "any"), "$.sections.listeners.data.entries[0].bind");
    bad((s) => (s["sections"]["dotfiles"]["data"]["hits"] = [{ path: "x", pattern: "bogus", line: 1 }]), "$.sections.dotfiles.data.hits[0].pattern");
    bad((s) => (s["sections"]["screenLock"]["data"]["screensaverIdleSeconds"] = "never"), "$.sections.screenLock.data.screensaverIdleSeconds");
    bad((s) => (s["sections"]["remoteAccess"]["data"]["remoteManagement"] = {}), "$.sections.remoteAccess.data.remoteManagement.serviceLoaded");
    bad((s) => (s["sections"]["updates"]["data"]["pendingCount"] = "1"), "$.sections.updates.data.pendingCount");
    bad((s) => delete s["collectedAt"], "$.collectedAt");
  });

  it("rejects non-objects", () => {
    for (const value of [null, undefined, 1, "state", [], true]) {
      expect(isSystemState(value)).toBe(false);
    }
  });
});
