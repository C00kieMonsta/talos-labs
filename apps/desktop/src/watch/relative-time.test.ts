import { describe, expect, it } from "vitest";
import { formatTime } from "../app/labels";
import { WATCH } from "../guided/copy";
import { WATCH_WINDOW } from "./copy";
import { checkedLabel, nextCheckLabel, relativeCheck } from "./relative-time";

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

describe("nextCheckLabel", () => {
  const ahead = (minutes: number) => ago(-minutes);

  it("reads soon for a null, unreadable or past next check, and under the first step", () => {
    expect(nextCheckLabel(null, NOW, null)).toBe(WATCH_WINDOW.nextCheckSoon);
    expect(nextCheckLabel("not a date", NOW, null)).toBe(WATCH_WINDOW.nextCheckSoon);
    expect(nextCheckLabel(ago(5), NOW, null)).toBe(WATCH_WINDOW.nextCheckSoon);
    expect(nextCheckLabel(NOW, NOW, null)).toBe(WATCH_WINDOW.nextCheckSoon);
    expect(nextCheckLabel(ahead(2), NOW, null)).toBe(WATCH_WINDOW.nextCheckSoon);
    expect(nextCheckLabel(ahead(10), "not a date", null)).toBe(WATCH_WINDOW.nextCheckSoon);
  });

  it("rounds minutes to the nearest five under 50", () => {
    expect(nextCheckLabel(ahead(3), NOW, null)).toBe("Next check in 5 minutes");
    expect(nextCheckLabel(ahead(12), NOW, null)).toBe("Next check in 10 minutes");
    // 48 rounds to 50, which is already "about an hour".
    expect(nextCheckLabel(ahead(48), NOW, null)).toBe(WATCH_WINDOW.nextCheckHour);
    expect(nextCheckLabel(ahead(47), NOW, null)).toBe("Next check in 45 minutes");
  });

  it("reads about an hour from exactly 50 to exactly 90 rounded minutes", () => {
    expect(nextCheckLabel(ahead(50), NOW, null)).toBe(WATCH_WINDOW.nextCheckHour);
    expect(nextCheckLabel(ahead(60), NOW, null)).toBe(WATCH_WINDOW.nextCheckHour);
    expect(nextCheckLabel(ahead(90), NOW, null)).toBe(WATCH_WINDOW.nextCheckHour);
    expect(nextCheckLabel(ahead(92), NOW, null)).toBe(WATCH_WINDOW.nextCheckHour);
  });

  it("reads hours after 90 rounded minutes", () => {
    expect(nextCheckLabel(ahead(93), NOW, null)).toBe("Next check in 2 hours");
    expect(nextCheckLabel(ahead(180), NOW, null)).toBe("Next check in 3 hours");
    expect(nextCheckLabel(ahead(240), NOW, null)).toBe("Next check in 4 hours");
  });

  it("a closer watch still running wins over the next check, and a past one does not", () => {
    const until = ahead(25);
    expect(nextCheckLabel(ahead(48), NOW, until)).toBe(`Checking every 15 minutes until ${formatTime(until)}`);
    expect(nextCheckLabel(null, NOW, until)).toBe(`Checking every 15 minutes until ${formatTime(until)}`);
    expect(nextCheckLabel(ahead(48), NOW, ago(1))).toBe("Next check in about an hour");
    expect(nextCheckLabel(ahead(20), NOW, "not a date")).toBe("Next check in 20 minutes");
  });

  it("accepts a Date for now", () => {
    expect(nextCheckLabel(ahead(20), new Date(NOW), null)).toBe("Next check in 20 minutes");
  });
});
