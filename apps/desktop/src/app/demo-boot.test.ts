import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, loadSettings } from "../settings";
import { bootDemo, parseDemoQuery, seedSettings } from "./demo-boot";

afterEach(() => {
  localStorage.clear();
});

describe("parseDemoQuery", () => {
  it("defaults to the dev machine with no flags", () => {
    expect(parseDemoQuery("")).toEqual({
      options: { fixture: "dev-machine", explainerFailure: null },
      reset: false,
      licensed: false,
      provider: null,
      developerMode: false,
      onboarded: false,
    });
  });

  it("reads every parameter", () => {
    const flags = parseDemoQuery("?fixture=hardened&explainer=timeout&delay=50&reset=1&provider=ollama&dev=1&onboarded=1&licensed=1");
    expect(flags).toEqual({
      options: { fixture: "hardened", explainerFailure: "timeout", collectDelayMs: 50 },
      reset: true,
      licensed: true,
      provider: "ollama",
      developerMode: true,
      onboarded: true,
    });
  });

  it("turns developer mode on for an in-app provider and ignores unknown values", () => {
    const flags = parseDemoQuery("?fixture=nope&explainer=nope&delay=-3&provider=claude&reset=yes");
    expect(flags.options).toEqual({ fixture: "dev-machine", explainerFailure: null });
    expect(flags.provider).toBe("claude");
    expect(flags.developerMode).toBe(true);
    expect(flags.reset).toBe(false);
    expect(parseDemoQuery("?provider=browser").developerMode).toBe(false);
  });
});

describe("seedSettings", () => {
  it("returns null when the URL changes nothing", () => {
    expect(seedSettings(DEFAULT_SETTINGS, parseDemoQuery("?fixture=hardened&reset=1"))).toBeNull();
  });

  it("merges the provider, developer mode and onboarded flags", () => {
    const seeded = seedSettings(DEFAULT_SETTINGS, parseDemoQuery("?provider=claude&onboarded=1"));
    expect(seeded).toEqual({
      ...DEFAULT_SETTINGS,
      explainer: { ...DEFAULT_SETTINGS.explainer, provider: "claude" },
      developerMode: true,
      onboarded: true,
    });
  });

  it("never turns developer mode or onboarding off", () => {
    const current = { ...DEFAULT_SETTINGS, developerMode: true, onboarded: true };
    expect(seedSettings(current, parseDemoQuery("?provider=none"))).toEqual({
      ...current,
      explainer: { ...current.explainer, provider: "none" },
    });
  });
});

describe("bootDemo", () => {
  it("clears storage on reset, stores the seeded settings and pre-installs the licence", async () => {
    localStorage.setItem("other", "x");
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, developerMode: true }));
    const adapters = bootDemo("?reset=1&onboarded=1&licensed=1&fixture=hardened&delay=0", localStorage);
    expect(localStorage.getItem("other")).toBeNull();
    expect(loadSettings()).toEqual({ ...DEFAULT_SETTINGS, onboarded: true });
    expect((await adapters.license.current()).status).toBe("valid");
    expect(await adapters.systemState.collect()).toMatchObject({ sections: { firewall: { status: "ok" } } });
  });

  it("leaves storage alone without reset and stays unlicensed by default", async () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, onboarded: true }));
    const adapters = bootDemo("?fixture=dev-machine", localStorage);
    expect(loadSettings().onboarded).toBe(true);
    expect(await adapters.license.current()).toEqual({ status: "none" });
  });
});
