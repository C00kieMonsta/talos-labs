import { describe, expect, it } from "vitest";
import { WATCH } from "../guided/copy";
import { checkedLabel, relativeCheck } from "./relative-time";

const NOW = "2026-10-16T12:00:00.000Z";

function ago(minutes: number): string {
  return new Date(new Date(NOW).getTime() - minutes * 60_000).toISOString();
}

describe("relativeCheck", () => {
  it("reads just now under two and a half minutes", () => {
    expect(relativeCheck(ago(0), NOW)).toEqual({ unit: "now" });
    expect(relativeCheck(ago(2), NOW)).toEqual({ unit: "now" });
  });

  it("rounds minutes to the nearest five", () => {
    expect(relativeCheck(ago(3), NOW)).toEqual({ unit: "minutes", n: 5 });
    expect(relativeCheck(ago(7), NOW)).toEqual({ unit: "minutes", n: 5 });
    expect(relativeCheck(ago(8), NOW)).toEqual({ unit: "minutes", n: 10 });
    expect(relativeCheck(ago(12), NOW)).toEqual({ unit: "minutes", n: 10 });
    expect(relativeCheck(ago(13), NOW)).toEqual({ unit: "minutes", n: 15 });
    expect(relativeCheck(ago(57), NOW)).toEqual({ unit: "minutes", n: 55 });
    expect(relativeCheck(ago(58), NOW)).toEqual({ unit: "minutes", n: 60 });
    expect(relativeCheck(ago(85), NOW)).toEqual({ unit: "minutes", n: 85 });
  });

  it("switches to hours from 90 rounded minutes, so hours is never one", () => {
    expect(relativeCheck(ago(88), NOW)).toEqual({ unit: "hours", n: 2 });
    expect(relativeCheck(ago(90), NOW)).toEqual({ unit: "hours", n: 2 });
    expect(relativeCheck(ago(145), NOW)).toEqual({ unit: "hours", n: 2 });
    expect(relativeCheck(ago(148), NOW)).toEqual({ unit: "hours", n: 3 });
    expect(relativeCheck(ago(60 * 26), NOW)).toEqual({ unit: "hours", n: 26 });
  });

  it("treats a future or unreadable time as just now", () => {
    expect(relativeCheck(ago(-30), NOW)).toEqual({ unit: "now" });
    expect(relativeCheck("not a date", NOW)).toEqual({ unit: "now" });
    expect(relativeCheck(ago(10), "not a date")).toEqual({ unit: "now" });
  });

  it("accepts a Date for now", () => {
    expect(relativeCheck(ago(20), new Date(NOW))).toEqual({ unit: "minutes", n: 20 });
  });
});

describe("checkedLabel", () => {
  it("uses the three WATCH strings", () => {
    expect(checkedLabel(ago(1), NOW)).toBe(WATCH.checkedJustNow);
    expect(checkedLabel(ago(12), NOW)).toBe("Checked 10 minutes ago");
    expect(checkedLabel(ago(60), NOW)).toBe("Checked 60 minutes ago");
    expect(checkedLabel(ago(180), NOW)).toBe("Checked 3 hours ago");
  });
});
