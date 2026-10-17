import type { AiAvailability, ExplainerProfile, WatchInterval } from "@talos/core";
import { CHATGPT_MODEL_PATTERN, DEFAULT_CHATGPT_MODEL, WATCH_INTERVALS } from "@talos/core";

export { WATCH_INTERVALS };
export type { WatchInterval };

/**
 * Where AI help comes from. "apple" runs on this Mac; "chatgpt" and "claude_plan" are the
 * person's own subscriptions, connected in the browser; "claude" (API key) and "ollama" need
 * Developer mode.
 */
export type ExplainerProvider = "apple" | "chatgpt" | "claude_plan" | "claude" | "ollama";

export interface ExplainerSettings {
  provider: ExplainerProvider;
  /** The one switch that turns AI off. */
  aiEnabled: boolean;
  claudeModel: string;
  ollamaModel: string;
  /** Developer-mode override; "" uses the account's first model. */
  chatgptModel: string;
}

export interface DeveloperSettings {
  enabled: boolean;
  /** Terminal commands next to fixes and the reversing command in the sheet. */
  showCommands: boolean;
  /** The "What will run" disclosure opens by default. */
  showPlanExpanded: boolean;
}

export interface GuidedSettings {
  /** The guided flow is the home screen; false opens the expert overview. */
  home: boolean;
  /** A check-up starts on every launch. */
  autoScan: boolean;
  /** The chat opens after the check-up when the connected AI answered last time; off shows the step-by-step plan first. */
  chatHome: boolean;
}

/**
 * The menu bar watch. A cache of Rust's watch-settings.json for enabled, everyMinutes and notify,
 * reconciled by useWatch on mount; startAtLogin mirrors the autostart plugin.
 */
export interface WatchSettings {
  enabled: boolean;
  startAtLogin: boolean;
  everyMinutes: WatchInterval;
  notify: boolean;
}

export interface AppSettings {
  explainer: ExplainerSettings;
  profile: ExplainerProfile;
  onboarded: boolean;
  developer: DeveloperSettings;
  guided: GuidedSettings;
  watch: WatchSettings;
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
    chatgptModel: DEFAULT_CHATGPT_MODEL,
  },
  profile: {
    role: "individual",
    technical: "low",
    handlesClientData: false,
    laptopLeavesHome: true,
  },
  onboarded: false,
  developer: { enabled: false, showCommands: true, showPlanExpanded: true },
  guided: { home: true, autoScan: true, chatHome: true },
  watch: { enabled: true, startAtLogin: false, everyMinutes: 60, notify: true },
};

export const PROVIDERS = ["apple", "chatgpt", "claude_plan", "claude", "ollama"] as const satisfies readonly ExplainerProvider[];
/** Offered on the Connect screen. */
export const CONSUMER_PROVIDERS: readonly ExplainerProvider[] = ["apple", "chatgpt", "claude_plan"];
/** Only reachable in Developer mode. */
export const DEVELOPER_PROVIDERS: readonly ExplainerProvider[] = ["claude", "ollama"];

export function isDeveloperProvider(provider: ExplainerProvider): boolean {
  return DEVELOPER_PROVIDERS.includes(provider);
}

const ROLES: readonly ExplainerProfile["role"][] = ["individual", "freelancer", "small_business"];
const TECHNICAL: readonly ExplainerProfile["technical"][] = ["low", "medium", "high"];

/** True when the AI switch is on and the provider can answer. */
export function aiUsable(settings: AppSettings, availability: AiAvailability | null): boolean {
  if (!settings.explainer.aiEnabled) return false;
  if (isDeveloperProvider(settings.explainer.provider) && settings.developer.enabled) return true;
  return availability === "available";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** Trims, caps the length and, when a pattern is given, checks a non-empty value against it. */
export function pickModelId(value: unknown, fallback: string, pattern?: RegExp): string {
  const id = typeof value === "string" ? value.trim() : fallback;
  if (id.length > MAX_MODEL_ID_LENGTH) return fallback;
  if (id.length === 0) return fallback;
  if (pattern !== undefined && !pattern.test(id)) return fallback;
  return id;
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** A number from a closed list, else the fallback. */
export function pickNumber<T extends number>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "number" && (allowed as readonly number[]).includes(value) ? (value as T) : fallback;
}

/** Every field falls back to its default, so an old or damaged value never breaks the app. */
export function parseSettings(raw: unknown): AppSettings {
  const root = isRecord(raw) ? raw : {};
  const explainer = isRecord(root["explainer"]) ? root["explainer"] : {};
  const profile = isRecord(root["profile"]) ? root["profile"] : {};
  const developer = isRecord(root["developer"]) ? root["developer"] : {};
  // v0.2 stored no guided block; both switches default on.
  const guided = isRecord(root["guided"]) ? root["guided"] : {};
  // v0.3 stored no watch block; the watch defaults on.
  const watch = isRecord(root["watch"]) ? root["watch"] : {};
  const d = DEFAULT_SETTINGS;
  // v0.1 stored a top-level developerMode boolean.
  const developerEnabled = pickBoolean(developer["enabled"], pickBoolean(root["developerMode"], d.developer.enabled));
  const storedProvider = explainer["provider"];
  let aiEnabled = pickBoolean(explainer["aiEnabled"], d.explainer.aiEnabled);
  // v0.1 stored "none" for no AI; the switch carries that now.
  if (storedProvider === "none") aiEnabled = false;
  let provider: ExplainerProvider = pickEnum(storedProvider, PROVIDERS, d.explainer.provider);
  if (!developerEnabled && isDeveloperProvider(provider)) provider = "apple";
  return {
    explainer: {
      provider,
      aiEnabled,
      claudeModel: pickModelId(explainer["claudeModel"], d.explainer.claudeModel),
      ollamaModel: pickModelId(explainer["ollamaModel"], d.explainer.ollamaModel),
      chatgptModel: pickModelId(explainer["chatgptModel"], d.explainer.chatgptModel, CHATGPT_MODEL_PATTERN),
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
    guided: {
      home: pickBoolean(guided["home"], d.guided.home),
      autoScan: pickBoolean(guided["autoScan"], d.guided.autoScan),
      chatHome: pickBoolean(guided["chatHome"], d.guided.chatHome),
    },
    watch: {
      enabled: pickBoolean(watch["enabled"], d.watch.enabled),
      startAtLogin: pickBoolean(watch["startAtLogin"], d.watch.startAtLogin),
      everyMinutes: pickNumber(watch["everyMinutes"], WATCH_INTERVALS, d.watch.everyMinutes),
      notify: pickBoolean(watch["notify"], d.watch.notify),
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
