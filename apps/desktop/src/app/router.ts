import { useCallback, useState } from "react";
import type { RuleId } from "@talos/core";

export type Route =
  | { name: "overview" }
  | { name: "findings" }
  | { name: "finding"; ruleId: RuleId }
  | { name: "ask" }
  | { name: "settings" }
  | { name: "about" };

export type RouteName = Route["name"];

export interface Router {
  readonly route: Route;
  navigate(route: Route): void;
  back(): void;
}

export const HOME: Route = { name: "overview" };

export function useRouter(initial: Route = HOME): Router {
  const [stack, setStack] = useState<readonly Route[]>([initial]);
  const navigate = useCallback((route: Route) => {
    setStack((prev) => [...prev, route]);
  }, []);
  const back = useCallback(() => {
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  }, []);
  const route = stack[stack.length - 1] ?? initial;
  return { route, navigate, back };
}
