import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { HOME, useRouter } from "./router";
import type { Route } from "./router";

afterEach(cleanup);

describe("useRouter", () => {
  it("starts on the given route, or the overview", () => {
    expect(renderHook(() => useRouter()).result.current.route).toEqual(HOME);
    expect(renderHook(() => useRouter({ name: "guided" })).result.current.route).toEqual({ name: "guided" });
  });

  it("navigate pushes, back pops, and back on the first route is a no-op", () => {
    const { result } = renderHook(() => useRouter({ name: "guided" }));
    act(() => result.current.navigate({ name: "settings" }));
    expect(result.current.route).toEqual({ name: "settings" });
    expect(result.current.lastMove).toBe("navigate");
    act(() => result.current.back());
    expect(result.current.route).toEqual({ name: "guided" });
    expect(result.current.lastMove).toBe("back");
    act(() => result.current.back());
    expect(result.current.route).toEqual({ name: "guided" });
  });

  it("replace swaps the current route without growing the stack", () => {
    const { result } = renderHook(() => useRouter({ name: "guided" }));
    act(() => result.current.navigate({ name: "findings" }));
    act(() => result.current.replace({ name: "findings", severity: "high" }));
    expect(result.current.route).toEqual({ name: "findings", severity: "high" });
    expect(result.current.lastMove).toBe("replace");
    act(() => result.current.back());
    expect(result.current.route).toEqual({ name: "guided" });
  });

  it("the connect route carries where it was opened from and leaves with back", () => {
    const { result } = renderHook(() => useRouter({ name: "guided" }));
    const from: Route = { name: "finding", ruleId: "TL-MAC-001" };
    act(() => result.current.navigate(from));
    act(() => result.current.navigate({ name: "connect", returnTo: from }));
    const route = result.current.route;
    expect(route.name).toBe("connect");
    if (route.name === "connect") expect(route.returnTo).toEqual(from);
    act(() => result.current.back());
    expect(result.current.route).toEqual(from);
  });

  it("can open connect from every shell route and return to it", () => {
    const origins: Route[] = [{ name: "guided" }, { name: "overview" }, { name: "chat" }, { name: "settings" }];
    for (const origin of origins) {
      const { result } = renderHook(() => useRouter(origin));
      act(() => result.current.navigate({ name: "connect", returnTo: origin }));
      expect(result.current.route.name).toBe("connect");
      act(() => result.current.back());
      expect(result.current.route).toEqual(origin);
    }
  });
});

describe("the fishy route", () => {
  it("carries where it was opened from and an optional start, and leaves with back", () => {
    const { result } = renderHook(() => useRouter({ name: "guided" }));
    act(() => result.current.navigate({ name: "fishy", returnTo: { name: "guided" }, start: "gate" }));
    const route = result.current.route;
    expect(route.name).toBe("fishy");
    if (route.name === "fishy") {
      expect(route.returnTo).toEqual({ name: "guided" });
      expect(route.start).toBe("gate");
    }
    act(() => result.current.back());
    expect(result.current.route).toEqual({ name: "guided" });
  });

  it("can open fishy from every shell route without a start", () => {
    const origins: Route[] = [{ name: "guided" }, { name: "overview" }, { name: "chat" }, { name: "settings" }];
    for (const origin of origins) {
      const { result } = renderHook(() => useRouter(origin));
      act(() => result.current.navigate({ name: "fishy", returnTo: origin }));
      expect(result.current.route).toEqual({ name: "fishy", returnTo: origin });
      act(() => result.current.back());
      expect(result.current.route).toEqual(origin);
    }
  });
});
