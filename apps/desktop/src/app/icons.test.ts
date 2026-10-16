import { describe, expect, it } from "vitest";
import * as lucide from "lucide-react";
import { FIX_COST_ICONS, GRADE_ICONS, ICONS, LUCIDE_NAMES, NAV_ICONS, SECTION_ICONS, SEVERITY_ICONS } from "./icons";

describe("icons", () => {
  it("every lucide name the app uses exists in the installed lucide-react", () => {
    const missing = LUCIDE_NAMES.filter((name) => typeof (lucide as Record<string, unknown>)[name] !== "function" && typeof (lucide as Record<string, unknown>)[name] !== "object");
    expect(missing, `lucide-react does not export: ${missing.join(", ")}`).toEqual([]);
  });

  it("no map entry is undefined", () => {
    const maps = { NAV_ICONS, SECTION_ICONS, SEVERITY_ICONS, GRADE_ICONS, FIX_COST_ICONS, ICONS };
    for (const [mapName, map] of Object.entries(maps)) {
      for (const [key, value] of Object.entries(map)) {
        expect(value, `${mapName}.${key} is undefined`).toBeDefined();
      }
    }
  });
});
