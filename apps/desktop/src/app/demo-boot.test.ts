import { afterEach, describe, expect, it } from "vitest";
import { DEV_MACHINE, MACOS_CATALOG, evaluate } from "@talos/core";
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, loadSettings } from "../settings";
import { bootDemo, DEMO_CONTINUE_KEY, DEMO_GUIDED_MEMORY_KEY, parseDemoQuery, previousReportFor, seedSettings } from "./demo-boot";

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
      guided: true,
      memory: null,
      since: false,
      continueGuided: false,
      technical: null,
    });
  });

  it("reads every parameter", () => {
    const flags = parseDemoQuery(
      "?fixture=hardened&explainer=timeout&delay=50&reset=1&provider=ollama&dev=1&onboarded=1&licensed=1&fix=wrong_password&batch=partial&scan_error=timeout&fix_delay=10&ai=model_not_ready&ai_ready=500&fda_after=2&automation=denied&bundled=0&poll_after=3&pace=0&guided=0&memory=%7B%22version%22%3A1%7D&since=1&continue=guided&technical=medium",
    );
    expect(flags).toEqual({
      options: {
        fixture: "hardened",
        explainerFailure: "timeout",
        collectDelayMs: 50,
        fix: "wrong_password",
        batch: "partial",
        scanError: "timeout",
        fixDelayMs: 10,
        ai: "model_not_ready",
        aiReadyMs: 500,
        fdaAfter: 2,
        automation: "denied",
        bundled: false,
        pollAfter: 3,
      },
      reset: true,
      licensed: true,
      provider: "ollama",
      developerMode: true,
      onboarded: true,
      pace: 0,
      guided: false,
      memory: '{"version":1}',
      since: true,
      continueGuided: true,
      technical: "medium",
    });
  });

  it("takes watch_after as an alias of poll_after and ignores unknown batch, scan_error and technical values", () => {
    expect(parseDemoQuery("?watch_after=2").options.pollAfter).toBe(2);
    expect(parseDemoQuery("?bundled=1").options.bundled).toBeUndefined();
    expect(parseDemoQuery("?poll_after=1&watch_after=2").options.pollAfter).toBe(1);
    const flags = parseDemoQuery("?batch=nope&scan_error=nope&technical=wizard&continue=fda&guided=1");
    expect(flags.options).toEqual({ fixture: "dev-machine", explainerFailure: null });
    expect(flags.technical).toBeNull();
    expect(flags.continueGuided).toBe(false);
    expect(flags.guided).toBe(true);
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

  it("guided=0 turns the guided home off and technical sets the profile", () => {
    const seeded = seedSettings(DEFAULT_SETTINGS, parseDemoQuery("?guided=0&technical=medium"));
    expect(seeded).toEqual({
      ...DEFAULT_SETTINGS,
      profile: { ...DEFAULT_SETTINGS.profile, technical: "medium" },
      guided: { home: false, autoScan: true },
    });
    expect(seedSettings(DEFAULT_SETTINGS, parseDemoQuery("?guided=1"))).toBeNull();
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

describe("bootDemo guided seeds", () => {
  it("stores memory and continue, seeds a previous report on since=1, and sets the pace", async () => {
    const adapters = bootDemo("?memory=%7B%22version%22%3A1%7D&continue=guided&since=1&pace=0", localStorage);
    expect(localStorage.getItem(DEMO_GUIDED_MEMORY_KEY)).toBe('{"version":1}');
    expect(JSON.parse(localStorage.getItem(DEMO_CONTINUE_KEY) ?? "null")).toEqual({ kind: "guided" });
    expect(window.__talosDemoPace).toBe(0);
    const previous = await adapters.reports.loadLast();
    expect(previous?.reportId).toBe("demo-previous");
    const now = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: "2026-10-15T10:00:00.000Z", os: "macos" });
    const by = (r: typeof now, id: string) => r.results.find((x) => x.ruleId === id)?.status;
    const fixed = previous!.results.filter((r) => r.status === "fail" && by(now, r.ruleId) === "pass");
    const appeared = previous!.results.filter((r) => r.status === "pass" && by(now, r.ruleId) === "fail");
    expect(fixed).toHaveLength(2);
    expect(appeared).toHaveLength(1);
  });

  it("leaves memory, continue and the previous report alone without the flags", async () => {
    const adapters = bootDemo("?fixture=hardened", localStorage);
    expect(localStorage.getItem(DEMO_GUIDED_MEMORY_KEY)).toBeNull();
    expect(localStorage.getItem(DEMO_CONTINUE_KEY)).toBeNull();
    expect(await adapters.reports.loadLast()).toBeNull();
  });

  it("scan_error rejects the first collect with that kind and the next succeeds", async () => {
    const adapters = bootDemo("?scan_error=collector_crashed&delay=0", localStorage);
    await expect(adapters.systemState.collect()).rejects.toMatchObject({ kind: "collector_crashed" });
    await expect(adapters.systemState.collect()).resolves.toMatchObject({ host: { os: "macos" } });
  });

  it("previousReportFor keeps every rule id from the fixture report", () => {
    const previous = previousReportFor("hardened");
    const now = evaluate(DEV_MACHINE, MACOS_CATALOG, { now: "2026-10-15T10:00:00.000Z", os: "macos" });
    expect(previous.results.map((r) => r.ruleId).sort()).toEqual(now.results.map((r) => r.ruleId).sort());
  });
});
