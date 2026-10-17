import { afterEach, describe, expect, it } from "vitest";
import { DEV_MACHINE, MACOS_CATALOG, evaluate } from "@talos/core";
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, loadSettings } from "../settings";
import { bootDemo, DEFAULT_WATCH_DEMO, DEMO_CONTINUE_KEY, DEMO_GUIDED_MEMORY_KEY, DEMO_WATCH_MEMORY_KEY, parseDemoQuery, parseWatchDemoQuery, previousReportFor, seedSettings } from "./demo-boot";

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
      watchDemo: DEFAULT_WATCH_DEMO,
      watchMemory: null,
    });
    expect(DEFAULT_WATCH_DEMO).toEqual({ watch: null, fishy: null, fishyGate: false, fishyWired: false, watchAi: null, ransomNote: false, licensed: false, watchReason: true, watchNext: true, watchFlip: null, watchFlipAfter: null });
  });

  it("reads every parameter", () => {
    const flags = parseDemoQuery(
      "?fixture=hardened&explainer=timeout&delay=50&reset=1&provider=ollama&dev=1&onboarded=1&licensed=1&fix=wrong_password&batch=partial&scan_error=timeout&fix_delay=10&ai=model_not_ready&ai_ready=500&ai_until=2026-10-16T18%3A00%3A00.000Z&connect=closed&connect_delay=0&claude_fetch=1&fda_after=2&automation=denied&bundled=0&poll_after=3&pace=0&guided=0&memory=%7B%22version%22%3A1%7D&since=1&continue=guided&technical=medium&watch=act&fishy=remote&fishyGate=1&fishyWired=1&watchAi=chatgpt&ransomNote=1&watchReason=0&watchNext=0&watch_flip=act_now&watch_flip_after=250&watchMemory=%7B%22version%22%3A1%7D",
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
        provider: "ollama",
        ai: "model_not_ready",
        aiUntil: "2026-10-16T18:00:00.000Z",
        connect: "closed",
        connectDelayMs: 0,
        claudeFetch: true,
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
      watchDemo: { watch: "act", fishy: "remote", fishyGate: true, fishyWired: true, watchAi: "chatgpt", ransomNote: true, licensed: true, watchReason: false, watchNext: false, watchFlip: "act_now", watchFlipAfter: 250 },
      watchMemory: '{"version":1}',
    });
  });

  it("parseWatchDemoQuery reads the six watch params and the licence flag and ignores unknown values", () => {
    for (const state of ["calm", "look", "act", "unreadable", "first-run"] as const) expect(parseWatchDemoQuery(new URLSearchParams(`watch=${state}`)).watch).toBe(state);
    for (const kind of ["persistence", "listener", "guard", "remote", "admin", "dns", "backup"] as const) expect(parseWatchDemoQuery(new URLSearchParams(`fishy=${kind}`)).fishy).toBe(kind);
    for (const ai of ["off", "apple", "chatgpt", "claude", "limit"] as const) expect(parseWatchDemoQuery(new URLSearchParams(`watchAi=${ai}`)).watchAi).toBe(ai);
    expect(parseWatchDemoQuery(new URLSearchParams("watch=panic&fishy=ransomware&watchAi=gemini&fishyGate=yes&fishyWired=0&ransomNote=2&watchReason=2&watchNext=yes&watch_flip=red&watch_flip_after=-1"))).toEqual(DEFAULT_WATCH_DEMO);
    expect(parseWatchDemoQuery(new URLSearchParams(""))).toEqual(DEFAULT_WATCH_DEMO);
    expect(parseWatchDemoQuery(new URLSearchParams("licensed=1")).licensed).toBe(true);
    expect(parseWatchDemoQuery(new URLSearchParams("licensed=yes")).licensed).toBe(false);
    expect(parseDemoQuery("?watchMemory=%7B%22version%22%3A1%2C%22fishyRanAt%22%3A%222026-10-16T10%3A00%3A00.000Z%22%7D").watchMemory).toBe('{"version":1,"fishyRanAt":"2026-10-16T10:00:00.000Z"}');
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

  it("turns developer mode on for a Developer provider and ignores unknown values", () => {
    const flags = parseDemoQuery("?fixture=nope&explainer=nope&delay=-3&provider=claude&reset=yes");
    expect(flags.options).toEqual({ fixture: "dev-machine", explainerFailure: null, provider: "claude" });
    expect(flags.provider).toBe("claude");
    expect(flags.developerMode).toBe(true);
    expect(flags.reset).toBe(false);
    expect(parseDemoQuery("?provider=apple").developerMode).toBe(false);
    expect(parseDemoQuery("?provider=browser").provider).toBeNull();
  });

  it("seeds chatgpt and claude_plan without forcing Developer mode", () => {
    for (const provider of ["chatgpt", "claude_plan"] as const) {
      const flags = parseDemoQuery(`?provider=${provider}&ai=not_connected`);
      expect(flags.provider).toBe(provider);
      expect(flags.developerMode).toBe(false);
      expect(flags.options.provider).toBe(provider);
      expect(flags.options.ai).toBe("not_connected");
    }
  });

  it("reads the seven provider states, ai_until, connect, connect_delay and claude_fetch", () => {
    for (const state of ["not_connected", "connecting", "needs_sign_in", "limit_reached", "plan_not_eligible", "provider_unavailable", "not_offered"] as const) {
      expect(parseDemoQuery(`?ai=${state}`).options.ai).toBe(state);
    }
    expect(parseDemoQuery("?ai=off").options.ai).toBeUndefined();
    expect(parseDemoQuery("?ai_until=2026-10-16T18:00:00Z").options.aiUntil).toBe("2026-10-16T18:00:00Z");
    expect(parseDemoQuery("?ai_until=teatime").options.aiUntil).toBeUndefined();
    for (const outcome of ["ok", "closed", "plan_not_eligible", "unavailable", "timeout", "fetch_failed"] as const) {
      expect(parseDemoQuery(`?connect=${outcome}`).options.connect).toBe(outcome);
    }
    expect(parseDemoQuery("?connect=nope").options.connect).toBeUndefined();
    expect(parseDemoQuery("?connect_delay=250").options.connectDelayMs).toBe(250);
    expect(parseDemoQuery("?connect_delay=-1").options.connectDelayMs).toBeUndefined();
    expect(parseDemoQuery("?claude_fetch=1").options.claudeFetch).toBe(true);
    expect(parseDemoQuery("?claude_fetch=0").options.claudeFetch).toBeUndefined();
    expect(parseDemoQuery("").options).toEqual({ fixture: "dev-machine", explainerFailure: null });
  });

  it("accepts the three new explainer failures", () => {
    for (const reason of ["needs_sign_in", "limit_reached", "provider_unavailable"] as const) {
      expect(parseDemoQuery(`?explainer=${reason}`).options.explainerFailure).toBe(reason);
    }
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

  it("seeds chatgpt as the provider with Developer mode untouched", () => {
    const seeded = seedSettings(DEFAULT_SETTINGS, parseDemoQuery("?provider=chatgpt&onboarded=1"));
    expect(seeded).toEqual({
      ...DEFAULT_SETTINGS,
      explainer: { ...DEFAULT_SETTINGS.explainer, provider: "chatgpt" },
      onboarded: true,
    });
    expect(seeded?.developer.enabled).toBe(false);
  });

  it("guided=0 turns the guided home off and technical sets the profile", () => {
    const seeded = seedSettings(DEFAULT_SETTINGS, parseDemoQuery("?guided=0&technical=medium"));
    expect(seeded).toEqual({
      ...DEFAULT_SETTINGS,
      profile: { ...DEFAULT_SETTINGS.profile, technical: "medium" },
      guided: { home: false, autoScan: true, chatHome: true },
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

  it("stores the watch memory as given under talos.watch", () => {
    bootDemo("?watchMemory=%7B%22version%22%3A1%7D", localStorage);
    expect(localStorage.getItem(DEMO_WATCH_MEMORY_KEY)).toBe('{"version":1}');
    expect(DEMO_WATCH_MEMORY_KEY).toBe("talos.watch");
  });

  it("leaves memory, continue and the previous report alone without the flags", async () => {
    const adapters = bootDemo("?fixture=hardened", localStorage);
    expect(localStorage.getItem(DEMO_GUIDED_MEMORY_KEY)).toBeNull();
    expect(localStorage.getItem(DEMO_WATCH_MEMORY_KEY)).toBeNull();
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

describe("parseDemoQuery fail=", () => {
  it("accepts 013 and 001 in both spellings, each mapped to its own rule, and drops anything else", () => {
    expect(parseDemoQuery("?fail=001").options.fail).toEqual(["TL-MAC-001"]);
    expect(parseDemoQuery("?fail=TL-MAC-001").options.fail).toEqual(["TL-MAC-001"]);
    expect(parseDemoQuery("?fail=001,013").options.fail).toEqual(["TL-MAC-001", "TL-MAC-013"]);
    expect(parseDemoQuery("?fail=013,TL-MAC-001").options.fail).toEqual(["TL-MAC-013", "TL-MAC-001"]);
    expect(parseDemoQuery("?fail=099").options.fail).toBeUndefined();
    expect(parseDemoQuery("?fail=001,099").options.fail).toEqual(["TL-MAC-001"]);
    expect(parseDemoQuery("?fail=constructor,__proto__,001").options.fail).toEqual(["TL-MAC-001"]);
  });
});
