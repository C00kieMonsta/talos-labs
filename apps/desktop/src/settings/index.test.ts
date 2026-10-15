import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, loadSettings, parseSettings, saveSettings, type AppSettings } from "./index";

beforeEach(() => {
  localStorage.clear();
});

describe("settings defaults", () => {
  it("matches the contract", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      explainer: { provider: "none", claudeModel: "claude-opus-5", ollamaModel: "llama3.1" },
      profile: { role: "individual", technical: "low", handlesClientData: false, laptopLeavesHome: true },
      onboarded: false,
    });
  });

  it("loads the defaults when nothing is stored", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("settings round trip", () => {
  it("saves and loads the same value", () => {
    const next: AppSettings = {
      explainer: { provider: "claude", claudeModel: "claude-sonnet-5", ollamaModel: "mistral" },
      profile: { role: "small_business", technical: "high", handlesClientData: true, laptopLeavesHome: false },
      onboarded: true,
    };
    saveSettings(next);
    expect(loadSettings()).toEqual(next);
  });

  it("stores only the three top-level keys as JSON", () => {
    saveSettings(DEFAULT_SETTINGS);
    const raw = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? "null") as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(["explainer", "onboarded", "profile"]);
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
      JSON.stringify({ explainer: { provider: "openai", claudeModel: "" }, profile: { role: "ceo" }, onboarded: "yes" }),
    );
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps valid fields while repairing the rest", () => {
    localStorage.setItem(
      SETTINGS_STORAGE_KEY,
      JSON.stringify({ explainer: { provider: "ollama" }, profile: { technical: "medium", laptopLeavesHome: false }, onboarded: true }),
    );
    expect(loadSettings()).toEqual({
      explainer: { provider: "ollama", claudeModel: "claude-opus-5", ollamaModel: "llama3.1" },
      profile: { role: "individual", technical: "medium", handlesClientData: false, laptopLeavesHome: false },
      onboarded: true,
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
});
