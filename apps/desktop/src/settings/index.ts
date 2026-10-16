import type { AiAvailability, ExplainerProfile } from "@talos/core";

/** Where AI help comes from. "apple" runs on this Mac; the other two need Developer mode. */
export type ExplainerProvider = "apple" | "claude" | "ollama";

export interface ExplainerSettings {
  provider: ExplainerProvider;
  /** The one switch that turns AI off. */
  aiEnabled: boolean;
  claudeModel: string;
  ollamaModel: string;
}

export interface DeveloperSettings {
  enabled: boolean;
  /** Terminal commands next to fixes and the reversing command in the sheet. */
  showCommands: boolean;
  /** The "What will run" disclosure opens by default. */
  showPlanExpanded: boolean;
}

export interface AppSettings {
  explainer: ExplainerSettings;
  profile: ExplainerProfile;
  onboarded: boolean;
  developer: DeveloperSettings;
}

export const SETTINGS_STORAGE_KEY = "talos.settings";

/** Longest model id accepted; a longer stored value falls back to the default. */
export const MAX_MODEL_ID_LENGTH = 64;

export const DEFAULT_SETTINGS: AppSettings = {
  explainer: {
    provider: "apple",
    aiEnabled: true,
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
  developer: { enabled: false, showCommands: true, showPlanExpanded: true },
};

export const PROVIDERS: readonly ExplainerProvider[] = ["apple", "claude", "ollama"];
const ROLES: readonly ExplainerProfile["role"][] = ["individual", "freelancer", "small_business"];
const TECHNICAL: readonly ExplainerProfile["technical"][] = ["low", "medium", "high"];

/** True when the AI switch is on and the provider can answer. */
export function aiUsable(settings: AppSettings, availability: AiAvailability | null): boolean {
  if (!settings.explainer.aiEnabled) return false;
  if (settings.explainer.provider !== "apple" && settings.developer.enabled) return true;
  return availability === "available";
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
  const developer = isRecord(root["developer"]) ? root["developer"] : {};
  const d = DEFAULT_SETTINGS;
  // v0.1 stored a top-level developerMode boolean.
  const developerEnabled = pickBoolean(developer["enabled"], pickBoolean(root["developerMode"], d.developer.enabled));
  const storedProvider = explainer["provider"];
  let aiEnabled = pickBoolean(explainer["aiEnabled"], d.explainer.aiEnabled);
  // v0.1 stored "none" for no AI; the switch carries that now.
  if (storedProvider === "none") aiEnabled = false;
  let provider = pickEnum(storedProvider, PROVIDERS, d.explainer.provider);
  if (!developerEnabled && provider !== "apple") provider = "apple";
  return {
    explainer: {
      provider,
      aiEnabled,
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
    developer: {
      enabled: developerEnabled,
      showCommands: pickBoolean(developer["showCommands"], d.developer.showCommands),
      showPlanExpanded: pickBoolean(developer["showPlanExpanded"], d.developer.showPlanExpanded),
    },
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
