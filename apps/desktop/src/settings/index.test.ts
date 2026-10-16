import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, MAX_MODEL_ID_LENGTH, SETTINGS_STORAGE_KEY, aiUsable, loadSettings, parseSettings, saveSettings, type AppSettings } from "./index";

beforeEach(() => {
  localStorage.clear();
});

describe("settings defaults", () => {
  it("matches the contract", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      explainer: { provider: "apple", aiEnabled: true, claudeModel: "claude-opus-5", ollamaModel: "llama3.1" },
      profile: { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true },
      onboarded: false,
      developer: { enabled: false, showCommands: true, showPlanExpanded: true },
      guided: { home: true, autoScan: true },
    });
  });

  it("loads the defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("settings round trip", () => {
  it("saves and loads the same value", () => {
    const next: AppSettings = {
      explainer: { provider: "claude", aiEnabled: false, claudeModel: "claude-sonnet-5", ollamaModel: "mistral" },
      profile: { role: "small_business", technical: "high", handlesClientData: true, laptopLeavesHome: false },
      onboarded: true,
      developer: { enabled: true, showCommands: false, showPlanExpanded: false },
      guided: { home: false, autoScan: false },
    };
    saveSettings(next);
    expect(loadSettings()).toEqual(next);
  });

  it("stores only the five top-level keys as JSON", () => {
    saveSettings(DEFAULT_SETTINGS);
    const raw = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "null") as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(["developer", "explainer", "guided", "onboarded", "profile"]);
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

  it("falls back to apple when an in-app provider is stored without developer mode", () => {
    expect(parseSettings({ explainer: { provider: "claude" } }).explainer.provider).toBe("apple");
    expect(parseSettings({ explainer: { provider: "ollama" }, developer: { enabled: false } }).explainer.provider).toBe("apple");
    expect(parseSettings({ explainer: { provider: "ollama" }, developer: { enabled: true } }).explainer.provider).toBe("ollama");
    expect(parseSettings({ explainer: { provider: "claude" }, developerMode: true }).explainer.provider).toBe("claude");
  });

  it("keeps valid fields while repairing the rest", () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ explainer: { provider: "ollama" }, profile: { technical: "medium", laptopLeavesHome: false }, onboarded: true, developer: { enabled: true, showCommands: false } }),
    );
    expect(loadSettings()).toEqual({
      explainer: { provider: "ollama", aiEnabled: true, claudeModel: "claude-opus-5", ollamaModel: "llama3.1" },
      profile: { role: "individual", technical: "medium", handlesClientData: false, laptopLeavesHome: false },
      onboarded: true,
      developer: { enabled: true, showCommands: false, showPlanExpanded: true },
      guided: { home: true, autoScan: true },
    });
  });

  it("fills the guided block for a v0.2 value and repairs it field by field", () => {
    expect(parseSettings({ onboarded: true }).guided).toEqual({ home: true, autoScan: true });
    expect(parseSettings({ guided: { home: false } }).guided).toEqual({ home: false, autoScan: true });
    expect(parseSettings({ guided: { autoScan: false, home: "yes" } }).guided).toEqual({ home: true, autoScan: false });
    expect(parseSettings({ guided: "off" }).guided).toEqual({ home: true, autoScan: true });
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
});
