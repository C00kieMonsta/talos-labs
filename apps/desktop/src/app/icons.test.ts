import { describe, expect, it } from "vitest";
import * as lucide from "lucide-react";
import * as kit from "../components/icons";
import { FIX_COST_ICONS, GRADE_ICONS, ICONS, LUCIDE_NAMES, NAV_ICONS, SECTION_ICONS, SEVERITY_ICONS } from "./icons";

describe("icons", () => {
  it("every lucide name the app uses exists in the installed lucide-react", () => {
    const missing = LUCIDE_NAMES.filter((name) => typeof (lucide as Record<string, unknown>)[name] !== "function" && typeof (lucide as Record<string, unknown>)[name] !== "object");
    expect(missing, `lucide-react does not export: ${missing.join(", ")}`).toEqual([]);
  });

  it("every generated kit icon is exported and the spiral mark is among them", () => {
    const exported = kit as Record<string, unknown>;
    const missing = kit.KIT_ICON_NAMES.filter((name) => typeof exported[name] !== "function");
    expect(missing, `icons/index.ts does not export: ${missing.join(", ")}`).toEqual([]);
    expect(kit.KIT_ICON_NAMES.length).toBe(33);
    expect(typeof kit.SpiralMark).toBe("function");
  });

  it("no map entry is undefined", () => {
    const maps = { NAV_ICONS, SECTION_ICONS, SEVERITY_ICONS, GRADE_ICONS, FIX_COST_ICONS, ICONS };
    for (const [mapName, map] of Object.entries(maps)) {
      for (const [key, value] of Object.entries(map)) {
        expect(value, `${mapName}.${key} is undefined`).toBeDefined();
      }
    }
  });

  it("nav, status and fix-cost keys that the kit covers use kit icons", () => {
    expect(NAV_ICONS.overview).toBe(kit.OverviewIcon);
    expect(NAV_ICONS.settings).toBe(kit.SettingsIcon);
    expect(SECTION_ICONS.firewall).toBe(kit.FirewallIcon);
    expect(ICONS.check).toBe(kit.CheckIcon);
    expect(ICONS.close).toBe(kit.CloseIcon);
    expect(FIX_COST_ICONS.deep_link).toBe(kit.ArrowUpRightIcon);
  });

  it("the chat's Send is lucide ArrowUp and the name is pinned for the export test", () => {
    expect(ICONS.send).toBe(lucide.ArrowUp);
    expect(LUCIDE_NAMES).toContain("ArrowUp");
  });
});
