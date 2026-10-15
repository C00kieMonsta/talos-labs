import type { ExplainerProfile } from "@talos/core";

export interface ExplainerSettings {
  provider: "none" | "claude" | "ollama";
  claudeModel: string;
  ollamaModel: string;
}

export interface AppSettings {
  explainer: ExplainerSettings;
  profile: ExplainerProfile;
  onboarded: boolean;
}

export const SETTINGS_STORAGE_KEY = "talos.settings";

export const DEFAULT_SETTINGS: AppSettings = {
  explainer: {
    provider: "none",
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
};

const PROVIDERS: readonly ExplainerSettings["provider"][] = ["none", "claude", "ollama"];
const ROLES: readonly ExplainerProfile["role"][] = ["individual", "freelancer", "small_business"];
const TECHNICAL: readonly ExplainerProfile["technical"][] = ["low", "medium", "high"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function pickString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
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
  return {
    explainer: {
      provider: pickEnum(explainer["provider"], PROVIDERS, d.explainer.provider),
      claudeModel: pickString(explainer["claudeModel"], d.explainer.claudeModel),
      ollamaModel: pickString(explainer["ollamaModel"], d.explainer.ollamaModel),
    },
    profile: {
      role: pickEnum(profile["role"], ROLES, d.profile.role),
      technical: pickEnum(profile["technical"], TECHNICAL, d.profile.technical),
      handlesClientData: pickBoolean(profile["handlesClientData"], d.profile.handlesClientData),
      laptopLeavesHome: pickBoolean(profile["laptopLeavesHome"], d.profile.laptopLeavesHome),
    },
    onboarded: pickBoolean(root["onboarded"], d.onboarded),
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
