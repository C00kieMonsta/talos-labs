import { useCallback, useState } from "react";
import type { Category, RuleId, Severity } from "@talos/core";

export type SeverityFilter = Severity | "all";
export type CategoryFilter = Category | "all";

export type Route =
  | { name: "overview" }
  /** The filters ride on the route so Back from a finding restores them. A fresh visit starts unfiltered. */
  | { name: "findings"; severity?: SeverityFilter; category?: CategoryFilter }
  | { name: "finding"; ruleId: RuleId }
  | { name: "ask" }
  | { name: "settings" };

export type RouteName = Route["name"];

/** How the current route was reached. */
export type RouteMove = "navigate" | "back" | "replace";

export interface Router {
  readonly route: Route;
  readonly lastMove: RouteMove;
  navigate(route: Route): void;
  back(): void;
  /** Swaps the current route without growing the stack, e.g. to record a filter change. */
  replace(route: Route): void;
}

export const HOME: Route = { name: "overview" };

interface RouterState {
  readonly stack: readonly Route[];
  readonly lastMove: RouteMove;
}

export function useRouter(initial: Route = HOME): Router {
  const [state, setState] = useState<RouterState>({ stack: [initial], lastMove: "navigate" });
  const navigate = useCallback((route: Route) => {
    setState((prev) => ({ stack: [...prev.stack, route], lastMove: "navigate" }));
  }, []);
  const back = useCallback(() => {
    setState((prev) => (prev.stack.length > 1 ? { stack: prev.stack.slice(0, -1), lastMove: "back" } : prev));
  }, []);
  const replace = useCallback((route: Route) => {
    setState((prev) => ({ stack: [...prev.stack.slice(0, -1), route], lastMove: "replace" }));
  }, []);
  const route = state.stack[state.stack.length - 1] ?? initial;
  return { route, lastMove: state.lastMove, navigate, back, replace };
}
