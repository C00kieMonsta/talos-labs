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
      pace: null,
    });
  });

  it("reads every parameter", () => {
    const flags = parseDemoQuery(
      "?fixture=hardened&explainer=timeout&delay=50&reset=1&provider=ollama&dev=1&onboarded=1&licensed=1&fix=wrong_password&fix_delay=10&ai=model_not_ready&ai_ready=500&fda_after=2&automation=denied&poll_after=3&pace=0",
    );
    expect(flags).toEqual({
      options: {
        fixture: "hardened",
        explainerFailure: "timeout",
        collectDelayMs: 50,
        fix: "wrong_password",
        fixDelayMs: 10,
        ai: "model_not_ready",
        aiReadyMs: 500,
        fdaAfter: 2,
        automation: "denied",
        pollAfter: 3,
      },
      reset: true,
      licensed: true,
      provider: "ollama",
      developerMode: true,
      onboarded: true,
      pace: 0,
    });
  });

  it("turns developer mode on for an in-app provider and ignores unknown values", () => {
    const flags = parseDemoQuery("?fixture=nope&explainer=nope&delay=-3&provider=claude&reset=yes");
    expect(flags.options).toEqual({ fixture: "dev-machine", explainerFailure: null });
    expect(flags.provider).toBe("claude");
    expect(flags.developerMode).toBe(true);
    expect(flags.reset).toBe(false);
    expect(parseDemoQuery("?provider=apple").developerMode).toBe(false);
    expect(parseDemoQuery("?provider=browser").provider).toBeNull();
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
      developer: { ...DEFAULT_SETTINGS.developer, enabled: true },
      onboarded: true,
    });
  });

  it("never turns developer mode or onboarding off", () => {
    const current = { ...DEFAULT_SETTINGS, developer: { ...DEFAULT_SETTINGS.developer, enabled: true }, onboarded: true };
    expect(seedSettings(current, parseDemoQuery("?provider=apple"))).toEqual({
      ...current,
      explainer: { ...current.explainer, provider: "apple" },
    });
  });
});

describe("bootDemo", () => {
  it("clears storage on reset, stores the seeded settings and pre-installs the licence", async () => {
    localStorage.setItem("other", "x");
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...DEFAULT_SETTINGS, developer: { ...DEFAULT_SETTINGS.developer, enabled: true } }));
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
