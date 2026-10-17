import { describe, expect, it } from "vitest";
import { evaluate } from "../../src/engine/evaluate";
import { DEV_MACHINE } from "../../src/fixtures/dev-machine";
import { MACOS_CATALOG } from "../../src/rules/macos/index";
import { whatIfFor } from "../../src/chat/whatif";
import { ctxFor } from "../helpers";

const DEV = evaluate(DEV_MACHINE, MACOS_CATALOG, ctxFor(DEV_MACHINE));

describe("whatIfFor", () => {
  it("reads the risk sentence and the points of a failing rule from the report; 001 is the critical one", () => {
    const disk = whatIfFor(DEV, "TL-MAC-001");
    const result = DEV.results.find((r) => r.ruleId === "TL-MAC-001");
    const rule = MACOS_CATALOG.rules.find((r) => r.id === "TL-MAC-001");
    expect(disk).toEqual({ ruleId: "TL-MAC-001", headline: rule?.guided.headline, why: rule?.guided.why, points: result?.points, critical: true });
    expect(disk?.points).toBe(20);
    expect(disk?.why).toBe("If your Mac is lost or stolen, anyone can read your files.");
    const firewall = whatIfFor(DEV, "TL-MAC-002");
    expect(firewall?.critical).toBe(false);
    expect(firewall?.points).toBeGreaterThan(0);
  });

  it("is null for a passing rule, an unknown id and a rule outside the catalogue", () => {
    expect(DEV.results.find((r) => r.ruleId === "TL-MAC-004")?.status).toBe("pass");
    expect(whatIfFor(DEV, "TL-MAC-004")).toBeNull();
    expect(whatIfFor(DEV, "TL-MAC-999")).toBeNull();
    expect(whatIfFor(DEV, "TL-MAC-001", { ...MACOS_CATALOG, rules: [] })).toBeNull();
  });
});
