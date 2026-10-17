import { beforeEach, describe, expect, it } from "vitest";
import {
  CONSUMER_PROVIDERS,
  DEFAULT_SETTINGS,
  DEVELOPER_PROVIDERS,
  MAX_MODEL_ID_LENGTH,
  PROVIDERS,
  SETTINGS_STORAGE_KEY,
  WATCH_INTERVALS,
  aiUsable,
  isDeveloperProvider,
  loadSettings,
  parseSettings,
  pickModelId,
  pickNumber,
  saveSettings,
  type AppSettings,
} from "./index";

beforeEach(() => {
  localStorage.clear();
});

describe("settings defaults", () => {
  it("matches the contract", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      explainer: { provider: "apple", aiEnabled: true, claudeModel: "claude-opus-5", ollamaModel: "llama3.1", chatgptModel: "" },
      profile: { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true },
      onboarded: false,
      developer: { enabled: false, showCommands: true, showPlanExpanded: true },
      guided: { home: true, autoScan: true, chatHome: true },
      watch: { enabled: true, startAtLogin: false, everyMinutes: 60, notify: true },
    });
    expect(WATCH_INTERVALS).toEqual([15, 60, 240]);
  });

  it("loads the defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("lists the five providers in order and splits them by who may choose them", () => {
    expect(PROVIDERS).toEqual(["apple", "chatgpt", "claude_plan", "claude", "ollama"]);
    expect(CONSUMER_PROVIDERS).toEqual(["apple", "chatgpt", "claude_plan"]);
    expect(DEVELOPER_PROVIDERS).toEqual(["claude", "ollama"]);
    for (const p of CONSUMER_PROVIDERS) expect(isDeveloperProvider(p)).toBe(false);
    for (const p of DEVELOPER_PROVIDERS) expect(isDeveloperProvider(p)).toBe(true);
  });
});

describe("settings round trip", () => {
  it("saves and loads the same value", () => {
    const next: AppSettings = {
      explainer: { provider: "claude", aiEnabled: false, claudeModel: "claude-sonnet-5", ollamaModel: "mistral", chatgptModel: "gpt-5" },
      profile: { role: "small_business", technical: "high", handlesClientData: true, laptopLeavesHome: false },
      onboarded: true,
      developer: { enabled: true, showCommands: false, showPlanExpanded: false },
      guided: { home: false, autoScan: false, chatHome: false },
      watch: { enabled: false, startAtLogin: true, everyMinutes: 15, notify: false },
    };
    saveSettings(next);
    expect(loadSettings()).toEqual(next);
  });

  it("stores only the six top-level keys as JSON", () => {
    saveSettings(DEFAULT_SETTINGS);
    const raw = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "null") as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(["developer", "explainer", "guided", "onboarded", "profile", "watch"]);
    expect(JSON.stringify(raw)).not.toContain("apiKey");
  });
});

describe("tolerant parsing", () => {
  it("falls back to defaults on malformed JSON", () => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("falls back per field on an old or partial value", () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({
        explainer: { provider: "openai", assistant: "gemini", claudeModel: "" },
        profile: { role: "ceo" },
        onboarded: "yes",
        developerMode: "on",
      }),
    );
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("migrates a stored browser provider to apple", () => {
    expect(parseSettings({ explainer: { provider: "browser", assistant: "chatgpt" } }).explainer).toEqual(DEFAULT_SETTINGS.explainer);
  });

  it("migrates a stored none provider to apple with AI off", () => {
    const parsed = parseSettings({ explainer: { provider: "none" }, onboarded: true });
    expect(parsed.explainer.provider).toBe("apple");
    expect(parsed.explainer.aiEnabled).toBe(false);
    expect(parsed.onboarded).toBe(true);
  });

  it("migrates a stored developerMode boolean into developer.enabled", () => {
    expect(parseSettings({ developerMode: true }).developer).toEqual({ enabled: true, showCommands: true, showPlanExpanded: true });
    expect(parseSettings({ developerMode: false }).developer.enabled).toBe(false);
    expect(parseSettings({ developerMode: true, developer: { enabled: false } }).developer.enabled).toBe(false);
  });

  it("falls back to apple when a Developer provider is stored without developer mode", () => {
    expect(parseSettings({ explainer: { provider: "claude" } }).explainer.provider).toBe("apple");
    expect(parseSettings({ explainer: { provider: "ollama" }, developer: { enabled: false } }).explainer.provider).toBe("apple");
    expect(parseSettings({ explainer: { provider: "ollama" }, developer: { enabled: true } }).explainer.provider).toBe("ollama");
    expect(parseSettings({ explainer: { provider: "claude" }, developerMode: true }).explainer.provider).toBe("claude");
  });

  it("keeps chatgpt and claude_plan with Developer mode off", () => {
    expect(parseSettings({ explainer: { provider: "chatgpt" } }).explainer.provider).toBe("chatgpt");
    expect(parseSettings({ explainer: { provider: "claude_plan" }, developer: { enabled: false } }).explainer.provider).toBe("claude_plan");
    expect(parseSettings({ explainer: { provider: "chatgpt" }, developer: { enabled: true } }).explainer.provider).toBe("chatgpt");
  });

  it("keeps valid fields while repairing the rest", () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ explainer: { provider: "ollama" }, profile: { technical: "medium", laptopLeavesHome: false }, onboarded: true, developer: { enabled: true, showCommands: false } }),
    );
    expect(loadSettings()).toEqual({
      explainer: { provider: "ollama", aiEnabled: true, claudeModel: "claude-opus-5", ollamaModel: "llama3.1", chatgptModel: "" },
      profile: { role: "individual", technical: "medium", handlesClientData: false, laptopLeavesHome: false },
      onboarded: true,
      developer: { enabled: true, showCommands: false, showPlanExpanded: true },
      guided: { home: true, autoScan: true, chatHome: true },
      watch: { enabled: true, startAtLogin: false, everyMinutes: 60, notify: true },
    });
  });

  it("fills the watch block for a v0.3 value and repairs it field by field", () => {
    expect(parseSettings({ onboarded: true }).watch).toEqual({ enabled: true, startAtLogin: false, everyMinutes: 60, notify: true });
    expect(parseSettings({ watch: { enabled: false, everyMinutes: 15 } }).watch).toEqual({ enabled: false, startAtLogin: false, everyMinutes: 15, notify: true });
    expect(parseSettings({ watch: { everyMinutes: 30, notify: "no", startAtLogin: true } }).watch).toEqual({ enabled: true, startAtLogin: true, everyMinutes: 60, notify: true });
    expect(parseSettings({ watch: { everyMinutes: "60" } }).watch.everyMinutes).toBe(60);
    expect(parseSettings({ watch: { everyMinutes: 240 } }).watch.everyMinutes).toBe(240);
    expect(parseSettings({ watch: "on" }).watch).toEqual(DEFAULT_SETTINGS.watch);
  });

  it("pickNumber keeps only a number from the list", () => {
    expect(pickNumber(15, WATCH_INTERVALS, 60)).toBe(15);
    expect(pickNumber(16, WATCH_INTERVALS, 60)).toBe(60);
    expect(pickNumber("15", WATCH_INTERVALS, 60)).toBe(60);
    expect(pickNumber(null, [1, 2], 2)).toBe(2);
  });

  it("fills the guided block for a v0.2 value and repairs it field by field", () => {
    expect(parseSettings({ onboarded: true }).guided).toEqual({ home: true, autoScan: true, chatHome: true });
    expect(parseSettings({ guided: { home: false } }).guided).toEqual({ home: false, autoScan: true, chatHome: true });
    expect(parseSettings({ guided: { autoScan: false, home: "yes" } }).guided).toEqual({ home: true, autoScan: false, chatHome: true });
    expect(parseSettings({ guided: "off" }).guided).toEqual({ home: true, autoScan: true, chatHome: true });
    // v0.3 stored no chatHome; the chat home defaults on and a non-boolean is repaired.
    expect(parseSettings({ guided: { chatHome: false } }).guided).toEqual({ home: true, autoScan: true, chatHome: false });
    expect(parseSettings({ guided: { chatHome: "no" } }).guided.chatHome).toBe(true);
  });

  it("drops unknown keys and non-object shapes", () => {
    expect(parseSettings("string")).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings([1, 2])).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings({ explainer: "claude", extra: true })).toEqual(DEFAULT_SETTINGS);
  });

  it("trims model ids", () => {
    expect(parseSettings({ explainer: { claudeModel: "  claude-sonnet-5  " } }).explainer.claudeModel).toBe("claude-sonnet-5");
  });

  it("falls back to the default model when a stored id is longer than the cap", () => {
    const long = "claude-" + "a".repeat(MAX_MODEL_ID_LENGTH);
    const parsed = parseSettings({ explainer: { claudeModel: long, ollamaModel: "b".repeat(MAX_MODEL_ID_LENGTH + 1) } });
    expect(parsed.explainer.claudeModel).toBe(DEFAULT_SETTINGS.explainer.claudeModel);
    expect(parsed.explainer.ollamaModel).toBe(DEFAULT_SETTINGS.explainer.ollamaModel);
    expect(parseSettings({ explainer: { ollamaModel: "b".repeat(MAX_MODEL_ID_LENGTH) } }).explainer.ollamaModel).toHaveLength(MAX_MODEL_ID_LENGTH);
  });

  it("accepts an empty chatgptModel and rejects one outside the pattern", () => {
    expect(parseSettings({ explainer: { chatgptModel: "" } }).explainer.chatgptModel).toBe("");
    expect(parseSettings({ explainer: { chatgptModel: "  " } }).explainer.chatgptModel).toBe("");
    expect(parseSettings({ explainer: { chatgptModel: " gpt-5.1 " } }).explainer.chatgptModel).toBe("gpt-5.1");
    expect(parseSettings({ explainer: { chatgptModel: "GPT 5" } }).explainer.chatgptModel).toBe("");
    expect(parseSettings({ explainer: { chatgptModel: 7 } }).explainer.chatgptModel).toBe("");
    expect(parseSettings({ explainer: { chatgptModel: "a".repeat(MAX_MODEL_ID_LENGTH + 1) } }).explainer.chatgptModel).toBe("");
  });

  it("pickModelId checks the length and, for a non-empty value, the pattern", () => {
    expect(pickModelId("x", "d")).toBe("x");
    expect(pickModelId("", "d")).toBe("d");
    expect(pickModelId("", "")).toBe("");
    expect(pickModelId("ab", "", /^a$/)).toBe("");
    expect(pickModelId("a", "", /^a$/)).toBe("a");
    expect(pickModelId(null, "d", /^a$/)).toBe("d");
  });
});

describe("aiUsable", () => {
  it("is false when the switch is off, whatever the availability", () => {
    const off = parseSettings({ explainer: { aiEnabled: false } });
    expect(aiUsable(off, "available")).toBe(false);
  });

  it("needs an available on-device model for the apple provider", () => {
    expect(aiUsable(DEFAULT_SETTINGS, "available")).toBe(true);
    expect(aiUsable(DEFAULT_SETTINGS, "model_not_ready")).toBe(false);
    expect(aiUsable(DEFAULT_SETTINGS, null)).toBe(false);
  });

  it("is true for a Developer-mode provider without a probe", () => {
    const dev = parseSettings({ explainer: { provider: "ollama" }, developer: { enabled: true } });
    expect(aiUsable(dev, null)).toBe(true);
  });

  it("needs an available probe for chatgpt and claude_plan, even in Developer mode", () => {
    for (const provider of ["chatgpt", "claude_plan"] as const) {
      const plain = parseSettings({ explainer: { provider } });
      const dev = parseSettings({ explainer: { provider }, developer: { enabled: true } });
      expect(aiUsable(plain, "available")).toBe(true);
      expect(aiUsable(plain, "not_connected")).toBe(false);
      expect(aiUsable(plain, null)).toBe(false);
      expect(aiUsable(dev, null)).toBe(false);
      expect(aiUsable(dev, "needs_sign_in")).toBe(false);
      expect(aiUsable(dev, "available")).toBe(true);
    }
  });
});
