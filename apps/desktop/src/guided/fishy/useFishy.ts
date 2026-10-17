import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ActionId, FishyKind, FixChoice, FixError, GatedKind, SettingsPane, WatchActionId, WatchDetails, WatchDetailsItem, WatchItem, WatchMemory } from "@talos/core";
import { EMPTY_WATCH_MEMORY, actionNotNowRecently, siblings } from "@talos/core";
import type { Adapters } from "../../adapters";
import type { Route, Router } from "../../app/router";
import type { AppSettings } from "../../settings";
import type { WatchController } from "../../watch/watch-controller";
import type { FishyBusy, FishyController, FishyStage } from "./controller";

export interface FishyDeps {
  readonly watch: WatchController;
  readonly adapters: Adapters;
  readonly router: Router;
  readonly settings: AppSettings;
  /** The demo's ?ransomNote=1: the checkbox starts ticked when the flow opens. */
  readonly ransomNote?: boolean;
  readonly now?: () => string;
}

const GATED_KINDS: readonly FishyKind[] = ["guard", "remote", "admin", "backup"];

export function isGatedKind(kind: FishyKind): kind is GatedKind {
  return GATED_KINDS.includes(kind);
}

/** The playbook row a screen's "Not now" snoozes; the disconnect and stop rows depend on what Details binds later. */
function stageActions(stage: FishyStage, item: WatchItem | null, wired: boolean): readonly ActionId[] {
  switch (stage) {
    case "disconnect":
      return wired ? ["act.block_incoming"] : ["act.disconnect_network"];
    case "stop":
      return item?.hasStartupEntry === true ? ["act.stop_background_program"] : ["act.block_incoming"];
    case "eradicate":
      return ["act.review_background_programs"];
    case "recover":
      return ["act.reconnect_and_watch"];
    default:
      return [];
  }
}

/**
 * The screens the flow visits for an item, in order (DESIGN-WATCH.md section 6). A screen whose
 * own row was declined with "Not now" in the last 14 days is left out (section 7): the disconnect
 * screen's row is Wi-Fi off, or block incoming on a wired Mac, which Details decides later.
 */
export function stagesFor(item: WatchItem | null, memory: Pick<WatchMemory, "actionNotNow"> = EMPTY_WATCH_MEMORY, now: string = new Date().toISOString(), wired = false): readonly FishyStage[] {
  const stages: FishyStage[] = [];
  if (item !== null && item.gated && isGatedKind(item.kind)) stages.push("gate");
  stages.push("noticed", "disconnect");
  if (item !== null && (item.hasStartupEntry || item.isListener)) stages.push("stop");
  if (item !== null && item.kind === "persistence") stages.push("eradicate");
  stages.push("experts", "recover");
  return stages.filter((stage) => !stageActions(stage, item, wired).some((actionId) => actionNotNowRecently(memory, actionId, now)));
}

/** The details row from the item's own listing (the signal or a sibling), never another item's. */
export function detailsItemFor(details: WatchDetails | null, item: WatchItem | null): WatchDetailsItem | null {
  if (details === null || item === null) return null;
  const group = siblings(item.signalId);
  return details.items.find((row) => group.includes(row.signalId)) ?? null;
}

/** The stop row for the entry's scope: daemons need the admin row, everything else the user one. */
export function stopActionFor(row: WatchDetailsItem | null): WatchActionId {
  return row?.scope === "system_daemon" ? "watch.stop_daemon" : "watch.stop_user_agent";
}

/** The two stop rows take the start-up entry's path; the four network rows take no choice. */
export function choiceFor(actionId: WatchActionId, row: WatchDetailsItem | null): FixChoice {
  if ((actionId === "watch.stop_user_agent" || actionId === "watch.stop_daemon") && row?.plistPath !== undefined) return { kind: "plist", path: row.plistPath };
  return { kind: "none" };
}

const FIX_ERRORS: readonly FixError[] = ["cancelled", "wrong_password", "command_failed", "timeout", "plan_expired", "precondition_changed", "not_in_catalog", "invalid_choice", "invalid_input", "busy"];

function asFixError(error: unknown): FixError {
  const text = error instanceof Error ? error.message : error;
  return typeof text === "string" && (FIX_ERRORS as readonly string[]).includes(text) ? (text as FixError) : "command_failed";
}

const noop = (): void => undefined;

/**
 * Drives the "something seems fishy" flow. The item is snapshotted when the flow opens so the
 * screens hold still while the watch re-reads; the details document is fetched once, after the gate.
 */
export function useFishy(deps: FishyDeps): FishyController {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const [item, setItem] = useState<WatchItem | null>(null);
  const [stages, setStages] = useState<readonly FishyStage[]>(() => stagesFor(null));
  const [index, setIndex] = useState(0);
  const [details, setDetails] = useState<WatchDetails | null>(null);
  const [ransomNote, setRansomNote] = useState(false);
  const [busy, setBusy] = useState<FishyBusy>("idle");
  const [error, setError] = useState<FixError | null>(null);
  const itemRef = useRef(item);
  itemRef.current = item;
  const stagesRef = useRef(stages);
  stagesRef.current = stages;
  const indexRef = useRef(index);
  indexRef.current = index;
  const detailsRef = useRef(details);
  detailsRef.current = details;
  /** Bumped by every open(); a fetch or an apply still in flight from an earlier opening is ignored. */
  const generation = useRef(0);
  const detailsAsked = useRef(false);

  const stage: FishyStage = stages[index] ?? "noticed";
  const onFishy = deps.router.route.name === "fishy";

  const goBack = useCallback(() => {
    const { router } = depsRef.current;
    if (router.route.name === "fishy") router.back();
  }, []);

  const open = useCallback((returnTo: Route, start?: "gate" | "noticed") => {
    // An unlicensed state carries no items for the webview.
    const state = depsRef.current.watch.state;
    const top = state !== null && state !== undefined && state.licensed ? (state.items[0] ?? null) : null;
    generation.current += 1;
    detailsAsked.current = false;
    setItem(top);
    setStages(stagesFor(top, depsRef.current.watch.memory, depsRef.current.now?.() ?? new Date().toISOString()));
    setIndex(0);
    setDetails(null);
    setRansomNote(depsRef.current.ransomNote === true);
    setBusy("idle");
    setError(null);
    depsRef.current.router.navigate(start === undefined ? { name: "fishy", returnTo } : { name: "fishy", returnTo, start });
  }, []);

  // The details document is read once per opening, after the gate, and never leaves the webview.
  // A wired Mac changes which row the disconnect screen carries, so the stages are recomputed
  // once it arrives; the screen on show keeps its place.
  useEffect(() => {
    if (!onFishy || stage === "gate" || detailsAsked.current) return;
    detailsAsked.current = true;
    const mine = generation.current;
    depsRef.current.adapters.watch.details().then(
      (fetched) => {
        if (generation.current !== mine) return;
        setDetails(fetched);
        const { watch, now } = depsRef.current;
        const next = stagesFor(itemRef.current, watch.memory, now?.() ?? new Date().toISOString(), !fetched.wifiAvailable);
        const current = stagesRef.current[indexRef.current];
        const at = current === undefined ? -1 : next.indexOf(current);
        setStages(next);
        setIndex(at >= 0 ? at : Math.min(indexRef.current, Math.max(next.length - 1, 0)));
      },
      () => undefined,
    );
  }, [onFishy, stage]);

  const done = useCallback(() => {
    depsRef.current.watch.markFishyRan();
    goBack();
  }, [goBack]);

  const next = useCallback(() => {
    const last = stagesRef.current.length - 1;
    if (indexRef.current >= last) return done();
    setError(null);
    setIndex(indexRef.current + 1);
  }, [done]);

  const notNow = useCallback(
    (actionId: ActionId) => {
      const { watch } = depsRef.current;
      const current = itemRef.current;
      if (current !== null) void watch.notNow(actionId, current.signalId).catch(noop);
      // The last screen's Not now still ends a flow that ran through the experts' list.
      if (stagesRef.current[indexRef.current] === "recover") watch.markFishyRan();
      goBack();
    },
    [goBack],
  );

  const thisIsFine = useCallback(() => {
    const current = itemRef.current;
    if (current !== null) void depsRef.current.watch.acknowledge(current.signalId).catch(noop);
    goBack();
  }, [goBack]);

  const answerGate = useCallback(
    (mine: boolean) => {
      const current = itemRef.current;
      if (current !== null) void depsRef.current.watch.answerGate(current.signalId, mine).catch(noop);
      if (mine) goBack();
      else next();
    },
    [goBack, next],
  );

  const runAction = useCallback(
    async (actionId: WatchActionId) => {
      const { adapters } = depsRef.current;
      const mine = generation.current;
      const live = () => generation.current === mine;
      const choice = choiceFor(actionId, detailsItemFor(detailsRef.current, itemRef.current));
      setError(null);
      setBusy("working");
      try {
        const plan = await adapters.watch.actionPreview(actionId, choice);
        if (!live()) return;
        setBusy(plan.needsPassword ? "password" : "working");
        const outcome = await adapters.watch.actionApply(plan.planId, {
          onProgress: (progress) => {
            if (live()) setBusy(progress.phase === "waiting_for_password" ? "password" : "working");
          },
        });
        if (!live()) return;
        setBusy("idle");
        if (!outcome.ok) return setError(outcome.error);
        if (stagesRef.current[indexRef.current] === "recover") done();
        else next();
      } catch (caught) {
        if (!live()) return;
        setBusy("idle");
        setError(asFixError(caught));
      }
    },
    [done, next],
  );

  const showPane = useCallback((pane: SettingsPane) => {
    const { adapters, watch } = depsRef.current;
    void adapters.openSettingsPane(pane).catch(noop);
    watch.checkNow();
  }, []);

  const reveal = useCallback(() => {
    const row = detailsItemFor(detailsRef.current, itemRef.current);
    if (row?.plistPath === undefined) return;
    const rule = row.scope === "user_agent" || row.scope === undefined ? "TL-MAC-023" : "TL-MAC-024";
    void depsRef.current.adapters.fixes.reveal(rule, { kind: "plist", path: row.plistPath }).catch(noop);
  }, []);

  const openSource = useCallback((actionId: ActionId) => {
    void depsRef.current.adapters.watch.openSource(actionId).catch(noop);
  }, []);

  const wired = details !== null && !details.wifiAvailable;

  return useMemo(
    () => ({ stage, item, details, wired, ransomNote, setRansomNote, busy, error, open, next, notNow, thisIsFine, answerGate, runAction, showPane, reveal, openSource, done }),
    [stage, item, details, wired, ransomNote, busy, error, open, next, notNow, thisIsFine, answerGate, runAction, showPane, reveal, openSource, done],
  );
}
