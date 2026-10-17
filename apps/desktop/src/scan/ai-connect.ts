import { createContext, useContext } from "react";
import type { AiAvailability, RuleId } from "@talos/core";
import type { Route } from "../app/router";

/**
 * The contract between the Connect screen, the AI card and the controller that drives a
 * ChatGPT or Claude sign-in. The port is what the Rust commands (or the demo) expose; the
 * controller is what the screens read. The context defaults to an inert controller so a
 * screen rendered without App still works.
 */

export type ConnectProvider = "chatgpt" | "claude_plan";

export type ConnectOutcome = "closed" | "plan_not_eligible" | "provider_unavailable" | "timeout" | "fetch_failed";

export type ConnectPoll =
  | { readonly stage: "idle" }
  | { readonly stage: "fetching" }
  | { readonly stage: "signing_in" }
  | { readonly stage: "done" }
  | { readonly stage: "failed"; readonly outcome: ConnectOutcome };

/** Which rows the Connect screen may offer in this build and on this Mac. */
export interface ConnectOffered {
  readonly chatgpt: boolean;
  readonly claude_plan: boolean;
  readonly apple: boolean;
}

export interface AiConnectPort {
  offered(): Promise<ConnectOffered>;
  /**
   * Resolves with the stage Rust seeded (fetching or signing_in) so the first screen is right before
   * the first poll. Rejects with "busy" while a sign-in runs and "not_offered" for a provider this
   * build cannot offer.
   */
  start(provider: ConnectProvider): Promise<ConnectPoll>;
  poll(provider: ConnectProvider): Promise<ConnectPoll>;
  /** The job's outcome becomes closed. */
  cancel(provider: ConnectProvider): Promise<void>;
  /** Clears the stored sign-in on this Mac. Never deletes a fetched program. Rejects when the sign-in could not be cleared. */
  disconnect(provider: ConnectProvider): Promise<void>;
}

export type ConnectStage =
  | { readonly kind: "choose" }
  /** start() has not answered yet: the choose screen with its primary disabled. Claude only; ChatGPT opens the browser at once. */
  | { readonly kind: "starting"; readonly provider: "claude_plan" }
  | { readonly kind: "fetching"; readonly provider: "claude_plan" }
  | { readonly kind: "waiting"; readonly provider: ConnectProvider }
  | { readonly kind: "done"; readonly provider: ConnectProvider | "apple" }
  | { readonly kind: "failed"; readonly provider: ConnectProvider; readonly outcome: ConnectOutcome };

export interface AiConnectController {
  readonly stage: ConnectStage;
  /** null until offered() has answered. */
  readonly offered: ConnectOffered | null;
  /** offered is known and at least one subscription row can be connected. */
  readonly connectable: boolean;
  /** "Not now" was pressed in the last 14 days. */
  readonly askedRecently: boolean;
  /** The step whose disclosure asked to connect; opened again after a successful connect. */
  readonly resumeExplain: RuleId | null;
  /** Asks the port once which providers are offered; later calls are no-ops. */
  ensureOffered(): void;
  /** Always navigates to the connect route; resets the stage and remembers the explain target. */
  open(returnTo: Route, options?: { readonly explainRuleId?: RuleId }): void;
  start(provider: ConnectProvider): void;
  useThisMac(): void;
  cancel(): void;
  tryAgain(): void;
  chooseAnother(): void;
  /** Writes aiAskedAt, forgets the explain target and goes back only when the connect route is current. */
  notNow(): void;
  /** open() with the same options, then start() for the current provider. */
  signInAgain(returnTo: Route, options?: { readonly explainRuleId?: RuleId }): void;
  /** port.disconnect for the current provider, then a fresh probe. False when the port refused: the sign-in is still on this Mac and the probed state stands. */
  disconnect(): Promise<boolean>;
  /** True once when ruleId matches resumeExplain; cleared on consume, open and notNow. */
  consumeResume(ruleId: RuleId): boolean;
}

/**
 * True when nothing can explain and a Connect would help: no sign-in for the chosen provider, a plan that
 * does not cover it, a provider this build cannot offer, or On this Mac on a Mac that cannot run it.
 * The end-screen row and the Explain disclosure read this one predicate, with their own connectable guard.
 */
export function notConnectedFor(provider: string, availability: AiAvailability | null): boolean {
  if (availability === "not_connected" || availability === "plan_not_eligible" || availability === "not_offered") return true;
  return provider === "apple" && availability === "device_not_eligible";
}

/** The flat poll interval while a sign-in runs; the poll is a local read, not a TCC call. The AI surfaces re-probe a stale `connecting` at the same rate. */
export const CONNECT_POLL_MS = 2000;
/** After Cancel or the deadline: how often, and how many times, the job is read until the worker has reported its end. */
export const CONNECT_SETTLE_MS = 100;
export const CONNECT_SETTLE_ATTEMPTS = 10;
/** The controller's wall clock for a sign-in; the Rust job has the same deadline. */
export const CONNECT_TIMEOUT_MS = 600_000;
/** How often start() re-reads a job that answered "busy", and for how many rounds, before it gives up. */
export const CONNECT_BUSY_RETRY_MS = 250;
export const CONNECT_BUSY_ATTEMPTS = 20;

const noop = (): void => undefined;

/** The default controller: nothing offered, every method a no-op. Screens rendered without App see this. */
export const INERT_CONNECT: AiConnectController = {
  stage: { kind: "choose" },
  offered: null,
  connectable: false,
  askedRecently: false,
  resumeExplain: null,
  ensureOffered: noop,
  open: noop,
  start: noop,
  useThisMac: noop,
  cancel: noop,
  tryAgain: noop,
  chooseAnother: noop,
  notNow: noop,
  signInAgain: noop,
  disconnect: async () => true,
  consumeResume: () => false,
};

export const AiConnectContext = createContext<AiConnectController>(INERT_CONNECT);

/** Never throws: outside a provider it returns INERT_CONNECT. */
export function useConnect(): AiConnectController {
  return useContext(AiConnectContext);
}
