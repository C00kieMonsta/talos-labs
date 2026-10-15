import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, MAX_MODEL_ID_LENGTH, SETTINGS_STORAGE_KEY, isInAppProvider, loadSettings, parseSettings, saveSettings, type AppSettings } from "./index";

beforeEach(() => {
  localStorage.clear();
});

describe("settings defaults", () => {
  it("matches the contract", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      explainer: { provider: "browser", assistant: "claude", claudeModel: "claude-opus-5", ollamaModel: "llama3.1" },
      profile: { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true },
      onboarded: false,
      developerMode: false,
    });
  });

  it("loads the defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("settings round trip", () => {
  it("saves and loads the same value", () => {
    const next: AppSettings = {
      explainer: { provider: "claude", assistant: "chatgpt", claudeModel: "claude-sonnet-5", ollamaModel: "mistral" },
      profile: { role: "small_business", technical: "high", handlesClientData: true, laptopLeavesHome: false },
      onboarded: true,
      developerMode: true,
    };
    saveSettings(next);
    expect(loadSettings()).toEqual(next);
  });

  it("stores only the four top-level keys as JSON", () => {
    saveSettings(DEFAULT_SETTINGS);
    const raw = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "null") as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(["developerMode", "explainer", "onboarded", "profile"]);
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

  it("keeps a stored value from before developerMode and assistant existed", () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ explainer: { provider: "none", claudeModel: "claude-opus-5", ollamaModel: "llama3.1" }, profile: DEFAULT_SETTINGS.profile, onboarded: true }),
    );
    expect(loadSettings()).toEqual({
      ...DEFAULT_SETTINGS,
      explainer: { ...DEFAULT_SETTINGS.explainer, provider: "none" },
      onboarded: true,
      developerMode: false,
    });
  });

  it("falls back to the browser hand-off when an in-app provider is stored without developer mode", () => {
    expect(parseSettings({ explainer: { provider: "claude" } }).explainer.provider).toBe("browser");
    expect(parseSettings({ explainer: { provider: "ollama" }, developerMode: false }).explainer.provider).toBe("browser");
    expect(parseSettings({ explainer: { provider: "ollama" }, developerMode: true }).explainer.provider).toBe("ollama");
    expect(parseSettings({ explainer: { provider: "none" } }).explainer.provider).toBe("none");
  });

  it("keeps valid fields while repairing the rest", () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ explainer: { provider: "ollama", assistant: "chatgpt" }, profile: { technical: "medium", laptopLeavesHome: false }, onboarded: true, developerMode: true }),
    );
    expect(loadSettings()).toEqual({
      explainer: { provider: "ollama", assistant: "chatgpt", claudeModel: "claude-opus-5", ollamaModel: "llama3.1" },
      profile: { role: "individual", technical: "medium", handlesClientData: false, laptopLeavesHome: false },
      onboarded: true,
      developerMode: true,
    });
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

describe("isInAppProvider", () => {
  it("is true only for the providers that run inside the app", () => {
    expect(isInAppProvider("claude")).toBe(true);
    expect(isInAppProvider("ollama")).toBe(true);
    expect(isInAppProvider("browser")).toBe(false);
    expect(isInAppProvider("none")).toBe(false);
  });
});
