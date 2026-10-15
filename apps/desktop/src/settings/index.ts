import type { ExplainerProfile } from "@talos/core";

/** Where AI help comes from. "browser" opens the user's own Claude or ChatGPT account; no key is involved. */
export type ExplainerProvider = "browser" | "none" | "claude" | "ollama";

/** The account the browser hand-off opens. */
export type Assistant = "claude" | "chatgpt";

export interface ExplainerSettings {
  provider: ExplainerProvider;
  assistant: Assistant;
  claudeModel: string;
  ollamaModel: string;
}

export interface AppSettings {
  explainer: ExplainerSettings;
  profile: ExplainerProfile;
  onboarded: boolean;
  /** Shows Terminal commands next to fixes and unlocks the API-key and local-model providers. */
  developerMode: boolean;
}

export const SETTINGS_STORAGE_KEY = "talos.settings";

/** Longest model id accepted; a longer stored value falls back to the default. */
export const MAX_MODEL_ID_LENGTH = 64;

export const DEFAULT_SETTINGS: AppSettings = {
  explainer: {
    provider: "browser",
    assistant: "claude",
    claudeModel: "claude-opus-5",
    ollamaModel: "llama3.1",
  },
  profile: {
    role: "individual",
    technical: "low",
    handlesClientData: false,
    laptopLeavesHome: true,
  },
  onboarded: false,
  developerMode: false,
};

export const PROVIDERS: readonly ExplainerProvider[] = ["browser", "none", "claude", "ollama"];
export const ASSISTANTS: readonly Assistant[] = ["claude", "chatgpt"];
const ROLES: readonly ExplainerProfile["role"][] = ["individual", "freelancer", "small_business"];
const TECHNICAL: readonly ExplainerProfile["technical"][] = ["low", "medium", "high"];

/** Providers that run inside the app and need Developer mode. */
export function isInAppProvider(provider: ExplainerProvider): provider is "claude" | "ollama" {
  return provider === "claude" || provider === "ollama";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function pickModelId(value: unknown, fallback: string): string {
  const id = pickString(value, fallback);
  return id.length <= MAX_MODEL_ID_LENGTH ? id : fallback;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Every field falls back to its default, so an old or damaged value never breaks the app. */
export function parseSettings(raw: unknown): AppSettings {
  const root = isRecord(raw) ? raw : {};
  const explainer = isRecord(root["explainer"]) ? root["explainer"] : {};
  const profile = isRecord(root["profile"]) ? root["profile"] : {};
  const d = DEFAULT_SETTINGS;
  const developerMode = pickBoolean(root["developerMode"], d.developerMode);
  const provider = pickEnum(explainer["provider"], PROVIDERS, d.explainer.provider);
  return {
    explainer: {
      // An in-app provider is only offered in Developer mode; without it the browser hand-off applies.
      provider: !developerMode && isInAppProvider(provider) ? "browser" : provider,
      assistant: pickEnum(explainer["assistant"], ASSISTANTS, d.explainer.assistant),
      claudeModel: pickModelId(explainer["claudeModel"], d.explainer.claudeModel),
      ollamaModel: pickModelId(explainer["ollamaModel"], d.explainer.ollamaModel),
    },
    profile: {
      role: pickEnum(profile["role"], ROLES, d.profile.role),
      technical: pickEnum(profile["technical"], TECHNICAL, d.profile.technical),
      handlesClientData: pickBoolean(profile["handlesClientData"], d.profile.handlesClientData),
      laptopLeavesHome: pickBoolean(profile["laptopLeavesHome"], d.profile.laptopLeavesHome),
    },
    onboarded: pickBoolean(root["onboarded"], d.onboarded),
    developerMode,
  };
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadSettings(): AppSettings {
  const store = storage();
  if (store === null) return parseSettings(null);
  let raw: unknown = null;
  try {
    const text = store.getItem(SETTINGS_STORAGE_KEY);
    raw = text === null ? null : JSON.parse(text);
  } catch {
    raw = null;
  }
  return parseSettings(raw);
}

export function saveSettings(settings: AppSettings): void {
  const store = storage();
  if (store === null) return;
  store.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(parseSettings(settings)));
}
