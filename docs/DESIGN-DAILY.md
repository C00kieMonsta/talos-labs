# Talos Labs daily reading design: what today's checks mean, in five seconds

The watch (`docs/DESIGN-WATCH.md`, built) runs a sweep every 15, 60 or 240 minutes and keeps a rating, the last 50 changes and a calm-cycle counter for hysteresis (`Baseline.calm_streak`, `apps/desktop/src-tauri/src/watch/baseline.rs:86`, cycles not days) in `<app data>/watch.json` (`baseline.rs:73-120`). The check-up writes one report to `<app data>/last-report.json` (`apps/desktop/src-tauri/src/report_store.rs:7`) and the previous one is gone the moment the next is saved, so the app can say "Since last time." (`apps/desktop/src/guided/SinceScreen.tsx`) but never "this week". Nothing today adds a day up: a person who opens the app at 18:00 sees a rating word and "Checked 12 minutes ago", not what the day held. This document defines the daily unit, an authored reading the app derives from counts, one model paragraph a day at most, a score history the app draws itself, and the five places the reading shows.

This document extends `docs/DESIGN-WATCH.md` (sections 5 and 7), `docs/DESIGN-WATCH-WINDOW.md` (the calm rows), `docs/DESIGN-AI-PRESENCE.md` (the `checkup` task and `last-brief.json`), `docs/DESIGN-CHAT.md` (the opening message), `docs/DESIGN-V03.md` (the plan screen and the end screen), `docs/DESIGN-MINERAL.md` and `docs/DESIGN-WARMTH.md`. `docs/SECURITY-MODEL.md` changes in two rows of "Data at rest", listed in section 5 under "Docs touched by the build". Everything else holds: the model receives counts, enums and rule ids and never machine text; it never runs anything; the score, the grade, the words and the chart come from code; every model text carries the provider's name and "Not verified"; model text never becomes a button, a headline or a row label; the app is complete with AI off; no notification is added.

Section 4 depends on `docs/DESIGN-AI-PRESENCE.md` being built first: the `checkup` task (`RemoteTask`, `CHECKUP_JSON_SCHEMA`, Rust `Task::Checkup`, Swift `CheckupOnDeviceOutput`), `validateCheckup` and `prose.ts`, `BriefState` and `BriefSlot` in `apps/desktop/src/scan/machine.ts`, the `BriefStore` port and `last-brief.json`, and `GuidedModelBlock` (`div.guided-model`). On 2026-10-17 none of it exists: `packages/core/src/explainer/remote.ts:15` lists four tasks (`explain`, `prioritise`, `ask`, `watch`); `packages/core/src/explainer/validate.ts` exports `containsCommandText`, `validateExplanation`, `validatePrioritisation` and `validateAnswer` only; `machine.ts` holds no brief state; `apps/desktop/src/adapters/` has no brief store; `apps/desktop/src-tauri/src/ai/mod.rs:170` (`the_webview_may_name_every_task_but_watch`) pins that the webview may name explain, prioritise and ask only, so a `checkup` request is `invalid_input` today. Build order: sections 2, 3 and 5 (the Rust history, the card, the bars, the week screen, the plan line) stand alone with AI off; section 4 and the `daily` slot ship with or after DESIGN-AI-PRESENCE. `docs/DESIGN-PLAYFUL.md` section 3.10 owns the card's motion (the word and clause fades, the bars' one-time growth) and nothing of its content: one word set, one `readingFor`, one streak clause, all here.

The owner's words, verbatim (2026-10-17): "add threat detection strategies and interpretation of daily checks", inside "Keep iterating on the talos UI -- the chat is bad, we need a better chat interface that you would have on a real modern agent driven app -- we need more playful interactions -- we need more of the threat detection strategies in place -- adding more agentic capabilities -- add threat detection strategies and interpretation of daily checks". The owner judges a screen by whether it is obvious what to click and whether there is a sense of urgency.

Decisions taken where the brief left room:

- **The day is a local calendar day, keyed `YYYY-MM-DD`, never 24 hours of arithmetic.** The reading answers "how was today?", and a person's today ends at their midnight. A day across the clock change (the UK goes back on 2026-10-25) is 25 hours long and is still one row. Streaks and "N days" are differences of day keys, so a 23 or 25 hour day never adds or loses a day. The watch's model-call cap keeps its UTC date (`calls_on(&now.format("%Y-%m-%d"))` on a `DateTime<Utc>`, `cycle.rs:637`): it is a budget, not a reading, and moving it would make a cap day 23 hours long once a year for nothing. The two "days" differ by design: one is a budget, one is a reading.
- **Rust owns the history file.** The watch loop is the only part of the app that runs all day; the main window may never open. `daily.json` lives next to `watch.json`, is written by one Rust store, and both the Rust cycle and the webview's check-up feed it through commands that carry numbers and enums only. The free version has no watch, so its rows hold check-ups only and the week screen still draws.
- **Counts, scores, dates and enums only. No rule ids, no text.** The authored lines are built from counts ("1 thing got fixed."), as the Since screen's are. Rule ids would let the week screen list what got fixed by name, at the cost of a second file holding rule ids per day; `watch.json` already holds a rules snapshot, and the Since screen already names the diff on the day it happens. Dropped.
- **Model text lives in `last-brief.json`, never in `daily.json` and never in `watch.json`.** DESIGN-WATCH section 7 forbids model sentences in `watch.json`. DESIGN-AI-PRESENCE adds exactly one file for validated, provider-labelled prose, deleted on Disconnect. The daily paragraph is one more slot in that file (`daily`), under the same validation and the same deletion rules, so the number of files that can hold model text stays at one. In memory only would spend a call per launch, which DESIGN-AI-PRESENCE rejected for the plan reading, and the app scans on every launch.
- **At most one model call a day, and none on an empty day.** The reading is a new moment of the `checkup` task, `daily`, called from the main window only, once per local day, and only when the day document has something to read: a change the watch saw, a diff from the check-up, or a score that moved. On a day where nothing happened the authored floor says so and no call is made. The watch's judge keeps its own one-a-day calm call (DESIGN-WATCH-WINDOW section 3) and its reason line is reused, not duplicated. No Rust-started call is added.
- **The words are literal, five of them, and never a forecast.** "Calm.", "Worth a look.", "Act now.", "Couldn't check.", "Checked." The first three are the menu bar window's own states in DESIGN-WATCH-WINDOW, so the main window and the window never name one state two ways; "Couldn't check" is for a day the app read nothing; "Checked" is for a day the watch did not run (free version, watch off, Mac asleep), where "Calm" would be reassurance derived from absence. "Clear" is not used: "all clear" is on the reassurance list `safe_window_sentence` drops from model text (DESIGN-WATCH-WINDOW), and the app should not say what it forbids the model to say. The glyph is the kit's status icon from `apps/desktop/src/app/icons.ts`: `ICONS.checkup` (calm, checked), `ICONS.info` (look), `SEVERITY_ICONS.critical` (act), `ICONS.question` (couldn't check), never a sun or a cloud. The streak clause is "Day {n} of nothing changed."; DESIGN-PLAYFUL adds no second wording. Open question 1 offers the weather set as the alternative.
- **The score history is a fixed 0 to 100 bar chart drawn by the app, 7 and 30 days, one series.** No model, no auto-scaling (a two-point move must not look like a cliff), no line (a line implies a value on the days without a check-up). Today's bar in the ring hue, past bars in `--fg-tertiary`, a missing day a dash at the baseline. The rust accent is an action colour (DESIGN-MINERAL section 5) and is not used for data.
- **The reading on the plan screen is one line under the body, not a control.** Guided screens allow one primary and at most one link (`assertGuidedScreen`, `apps/desktop/qa/harness.ts:659`), and the plan screen's link is "Show me the list". A tappable row above the headline would put a calm line before the urgent one and invite the extra click the owner complained about; DESIGN-WARMTH 6e keeps urgency under its headline. So the plan screen gets `p.guided-daily`, a meta line with the icon, the word and the clause, no score and no chevron. "Your week" is reached from the Overview card and the chat chip only. The end screen draws nothing new. Open question 3.
- **The watch window is unchanged.** Its row 3 ("No change in 3 days.", from `lastChangeAt`, DESIGN-WATCH-WINDOW section 2) is the window's streak. A second streak line from `daily.json` under it would say the same thing from a different definition, and the two can disagree (a check-up that made a rule appear ends the day streak but does not move `lastChangeAt`). No `WatchState` field, no height change.
- **Rows are capped at 90.** Thirty days of bars needs 30 rows; 90 gives the 30-day chart a full window after a two-month gap and keeps the file under 10 KB. A year of rows would be a year of score history on disk for a chart nobody asked for.
- **Motion is DESIGN-PLAYFUL 3.10's.** The word and the clause fade in, and the bars grow once from the baseline over `--motion-settle` (600 ms) with `--ease-out` through that document's `bar-grow` keyframe, `animation: none` under reduced motion; the tokens, the keyframes and the smoke test are that document's. This document draws every bar at its final height so the frozen frame is complete. The streak number is plain text, never a count-up.

## 1. Principles

- **Five seconds.** The first line is a word and a clause from counts: "Calm. No change today." The second line is what held. The third is the score and where it moved. Everything else, the bars, the model paragraph, the week screen, is under those three lines and optional.
- **Code reads, the model comments.** Every word, count, streak and bar is derived by `packages/core` from numbers Rust stored. The model's one paragraph sits under the authored lines, with the badge, and is never the only thing that says how the day went. The app is complete with it absent.
- **Honest words.** Never "safe", "secure", "protected", "clean" or "fine" (DESIGN-WATCH-WINDOW principles). "Calm" says the watch ran and saw no change; it does not say nothing is wrong. "Checked" says the check-up ran and the watch did not, so no calm is claimed. "Couldn't check" says the app read nothing, and says how much in the next line. A day with no check-up and no cycle has no score bar, not a guessed one. The interpretation on a calm day is authored and costs nothing: "Still open: Your disk is not locked." from the plan's next action.
- **No nagging and no streak mechanics.** The calm streak is a plain figure, resets silently, never notifies, never a flame or a badge on the tray icon. A broken streak is not announced; the next day's line just has a smaller number or none.
- **Zero calls unless something happened.** The watch's judge and the plan brief are the calls that exist. The daily paragraph is at most one more a day, only from the main window, only on a day with a change, a diff or a score move, queued behind the plan brief, and never retried.
- **One primary per guided screen holds.** The reading is a line on the plan screen and a card in the Overview; in the chat it is a meta line of the opening message. The week screen has no primary: it is a reading, not a step, its way out is Back, and its one link is "Show me" on a look or act day, which goes where the window's primary goes.

## 2. The daily unit and the day document

**The day.** `localDayKey(now)` in core returns the `YYYY-MM-DD` of `now` in the system zone (`Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" })`, the one locale whose default order is ISO), and `chrono::Local::now().format("%Y-%m-%d")` in Rust (chrono's `clock` feature is on, `apps/desktop/src-tauri/Cargo.toml:47`). `daysBetween(a, b)` parses both keys into `Date.UTC(y, m - 1, d)` and divides by 86,400,000, so the UTC calendar does the subtraction and a 23 or 25 hour local day is still one day. A day boundary is local midnight; nothing stores a time zone and nothing converts a row when the zone changes (a row written in London and read in Lisbon keeps its date; the one row around the change may be short or long, accepted).

**What a day holds.** Every watch cycle the store kept (`cycle::run_once`, after `finish_cycle` returns `Some`), every landing (`landed()`, `apps/desktop/src/guided/landing.ts:13`, where `diffReports` runs), every later save of a report (`useScan.saveLast`, `apps/desktop/src/scan/useScan.ts:170`, called from `present()` at line 245, from a section recheck at line 270 and from every fix and batch in `useFix.ts:110,161,217`), and every fix the guided flow completed (`fix_done` and `batch_done`, the ids that reach `core.fixed`). The row:

```ts
interface DayRow {
  readonly date: string;              // YYYY-MM-DD, local
  readonly score: number | null;      // the last saved report of the day; null when none or unscored
  readonly grade: Grade | null;
  readonly checkups: number;          // landings that day (one per landed())
  readonly fixed: number;             // diffReports.fixed.length, summed over the day's landings
  readonly fixedByApp: number;        // fixes completed in Talos that day (fix_done, batch_done)
  readonly appeared: number;          // diffReports.appeared.length, summed over landings
  readonly unreadable: number;        // diffReports.unreadable.length of the last landing
  readonly cycles: number;            // watch cycles kept that day
  readonly changes: number;           // cycles whose sweep moved baseline.last_change_at
  readonly worst: Rating;             // the highest shown rating of the day's cycles; "calm" when no cycle ran (see dailyWord)
  readonly unavailableMax: number;    // the largest unavailable[] length seen that day
}
```

`fixed` and `fixedByApp` are two counts because `diffReports` compares against `core.previousReport` (`effects.ts:32`, `actions.ts:101`), the last saved report, and a fix made in Talos saves the post-fix report, so it never appears in the next landing's `diff.fixed`. "1 thing got fixed" reads `fixed + fixedByApp`.

Numbers, one closed enum, one date. No rule id, no signal id, no text, no digest. `DailyHistory = { version: 1, days: readonly DayRow[] }`, ascending by date, at most 90 rows.

**The day document** is derived in core at read time, never stored:

```ts
interface DayDocument {
  readonly today: DayRow | null;      // the row for localDayKey(now), null before the first event of the day
  readonly previous: DayRow | null;   // the most recent earlier row with a score
  readonly calmStreak: number;        // consecutive rows ending today (or yesterday when today has none) with cycles > 0, worst === "calm" and appeared === 0; a row with cycles === 0 ends it
  readonly trend7: readonly (number | null)[];   // one slot per day, oldest first, null for a day without a score
  readonly trend30: readonly (number | null)[];
  readonly fog: boolean;              // see below
}
```

`fog` is exact: `today !== null && ((today.checkups === 0 && today.cycles > 0 && today.unavailableMax >= FOG_UNAVAILABLE) || (today.checkups > 0 && today.score === null))`, with `FOG_UNAVAILABLE = PROBE_IDS.length` (21 today, `packages/core/src/ports/watch-port.ts:73`) exported from `daily/document.ts`. Unsigned dev builds never reach it: only the socket probes are unavailable there (SECURITY-MODEL, "Ad-hoc dev builds"). With no row today the document is never fog.

`buildDayDocument(history, now)` is pure. The word for the day rows comes from `dailyWord(row)`: `checked` when `cycles === 0`; else by `worst` (`calm`, `keep_an_eye` to `look`, `act_now` to `act`). The word for today's line comes from `todayWord(doc, watch: WatchState | null)`: `fog` when `doc.fog`; else the live `watch.rating` when the watch state is present (`calm`, `look`, `act`); else `checked` when today has a row; else `none`. The trend arrays are the chart's input; a day whose check-up was unscored (`score.value === null`, `packages/core/src/domain/report.ts:6-10`) is a null slot, drawn as the baseline dash.

**Where the watch state comes in.** The live rating, `lastChangeAt`, `recentCount` and `unavailable` stay in `WatchState` (DESIGN-WATCH-WINDOW section 5). Today's word is the live rating: when the person has run the fishy flow and the watch is back at calm, the line reads "Calm." at once, not "Act now." until midnight. DESIGN-WATCH section 6 ("No act-now state survives a Not now") holds. `worst` is used for the day rows and the streak only: a Thursday that held an act now stays "Act now" in Thursday's row. When today's row has `worst === "act_now"` and the live rating is calm, the clause is "An act now, handled."

## 3. The reading, place by place

Mock-ups are the dev machine, licensed, ChatGPT connected, hourly watch, Saturday 17 October 2026. Every authored string is in section 6. Model text is the `daily` paragraph of section 4, in the model-block style (`div.guided-model`: 2 px `--border` rule on the left, text through `ModelText`, the badge under it).

### The reading card (shared)

One component, `DailyCard` (`apps/desktop/src/daily/DailyCard.tsx`), rendered in three sizes: `full` (the week screen), `card` (the Overview), `line` (the plan screen and the chat opening: the word line alone, as `p.guided-daily`, no paper). Paper (`--bg-elevated`), hairline `--border`, radius 12, no grain, no shadow, a 3 px cue bar on the left for a live `act_now` (`--sev-cue-critical`) only. Inside, top to bottom:

1. The word line: the kit icon at 20 px (16 px in `line`) and `DAILY.word[kind]` at `--text-guided-list` 600 (`--text-guided-meta` in `line`), then the clause. "Act now." and its icon in `--sev-critical-fg`, word and icon together, never colour alone. The score never sits on this line: "Act now" next to "Fair" sends two messages.
2. The held line, `--text-guided-meta` in `--fg-secondary`: "27 of 31 checks held." from `counts.pass` and the rule count of the day's last report; when the day has no check-up, "No check-up today." (meta).
3. The open line, same style: "Still open: Your disk is not locked." from `nextAction(plan, report)` (`packages/core/src/guided/next.ts:53`) through `guidedFor(ruleId).headline` (`apps/desktop/src/guided/plan.ts:5`, so this line is built in the desktop layer, not in core); "Everything I check held." when `counts.fail === 0`; omitted when there is no plan. This is the interpretation on a calm day, at zero calls.
4. The score line, its own line: "72, Fair." with the move: "Up 4 since last time." or "Down 4 since last time." when `previous` exists and the value differs; nothing when equal or no previous.
5. In `card` and `full`: the 7-day bars (section 3, "The bars").
6. In `full`: the 30-day bars under a "This month" label, then the day rows.
7. The model paragraph when the `daily` slot holds today's key, under everything authored, with the full badge "Written by ChatGPT. Not verified."
8. In `card`: one text link "Your week" (`button.link-button`), which navigates to `{ name: "week", returnTo }`. In `full`, when the live rating is `keep_an_eye` or `act_now`: one text link "Show me" under the word line, which opens `{ name: "fishy", returnTo: { name: "week", returnTo }, start: "noticed" }` for act and `{ name: "guided" }` for look, as the window's primary does (DESIGN-WATCH-WINDOW section 5). Calm, checked and fog have no link.

The clause on the word line: calm with a streak of two or more, "Day 3 of nothing changed."; calm with a streak under two, "No change today."; calm after an act now cleared today, "An act now, handled."; checked, "The watch didn't run."; look, "One thing to look at." or "{n} things to look at." from `WatchState.items.length`; act, the top item's `FISHY.noticed.headline[kind]` plus a full stop; fog, "Nothing I could read today."; the first row ever, "First check-up."

### The bars

An inline SVG, `role="img"`, `aria-label` built by `trendLabel(doc)`: "Scores over the last 7 days: 68, 68, 70, no check-up, 72, 72, 72." Width the column, height 56 px for 7 bars and 72 px for 30. Each slot is `width / n`; the bar is at most 24 px wide and at least 6 px, centred in its slot, so 30 bars at 528 px are 12 px wide with 6 px of air. A fixed y scale of 0 to 100, no axis, no gridlines, one 1 px baseline in `--border`. The bar's top corners are 4 px rounded and its foot is square on the baseline. Today's bar is `--gradient-ring-mid`; every past bar is `--fg-tertiary` (3.98:1 on paper in light, DESIGN-WARMTH section 9); a null slot is a 2 px by 6 px dash in `--ring-track` on the baseline. The value is written once, on today's bar, in `--fg-secondary` text tokens, never in the bar colour; the other values are in the `aria-label` and in the day rows on the week screen. Each bar has an SVG `<title>` "Thu 15 Oct: 70, Fair" for the hover and for assistive tech. Motion: each bar is a `<rect>` drawn at its final height; DESIGN-PLAYFUL 3.10 grows it once with the `bar-grow` keyframe over `--motion-settle` and `--ease-out`, `animation: none` under reduced motion, no JavaScript timer, and the harness's `UNROLL_CSS` (`apps/desktop/qa/harness.ts:592`) freezes it for shots. Light and dark are the two token sets; `apps/desktop/scripts/contrast.ts` (it writes `apps/desktop/src/styles/CONTRAST.md`) gains the pairs `--fg-tertiary` and `--gradient-ring-mid` on `--bg-elevated` at the 3:1 graphics floor.

### Chat opening (DESIGN-CHAT, designed, not built)

The reading is one meta line inside the opening message of DESIGN-CHAT section 3, where that document puts "Since last time." (above the headline, in the same app message, label `opening`, so DESIGN-CHAT-UI's `AppMessage.label` union gains nothing):

> Today: ◎ Calm. Day 3 of nothing changed.
> **I found 1 thing to fix.**
> I'll show you where.
> [Do them all] [What is urgent?] [Show me the list] [Your week]

The line is the `line` size of the card, at `--text-guided-meta`. No bars, no score and no paragraph in the chat: the plan brief is the chat's one paragraph, and a second model block with a second badge above the chips would push "I found 1 thing to fix." toward the fold of DESIGN-CHAT-UI's 436 px log. The chip "Your week" takes the fourth slot of the opening chip row (DESIGN-AGENT section 2j, `chips.ts`) only when `history.days.length >= 2`, in place of "Write this up", which stays on the end message and is reachable by typing; it opens `{ name: "week", returnTo: { name: "guided" } }`. `opened()` receives `reading: DailyReading | null` (from `readingFor`) and the day count with the plan (DESIGN-CHAT-UI section 4). The message starts no call of its own; the `landed()` call of section 4 writes the paragraph to the slot for the week screen and the Overview, never into the chat. When the chat is cleared on "Check again" (DESIGN-CHAT open question 4) the line is rebuilt from the new report. Until the chat exists, the plan screen line below is the home's reading.

### Plan screen (built: `apps/desktop/src/guided/screens/PlanScreen.tsx`)

One `p.guided-daily` under the body and above the primary, passed as the first child of `StepFrame` (children render after `div.guided-body` and before the primary, `apps/desktop/src/guided/StepFrame.tsx:108-118`, so no new prop): the kit icon at 16 px, the word and the clause, at `--text-guided-meta` in `--fg-secondary`, no score, no chevron, not a control:

> 0 of 2
> **I found 1 thing to fix.**
> I'll show you where.
> ◎ Calm. Day 3 of nothing changed.
> [Let's go]
> Show me the list

The headline stays first and `assertGuidedScreen` holds (the line is not a `.guided-link`). The line is not drawn when the live rating is `act_now`: the act path is the fishy flow (`EndScreen.tsx:140,198`, `ActNowCard` to `fishy.open(..., "noticed")`), and a line reading "Act now." with nothing to tap fails the owner's "obvious what to click" test on the one day urgency matters. On a look day it reads "ⓘ Worth a look. One thing to look at." and the plan's own steps are the path. The end screen and the Since screen draw nothing new (the Since screen is the day's diff already; the end screen's act-now card is the one thing there, DESIGN-WARMTH 6b).

### Overview (built: `apps/desktop/src/screens/Overview.tsx`)

A `section.card.daily-card` before the score card in `.expert-grid` (`Overview.tsx:175`), the `card` size: word line, held line, open line, score line, the 7 bars, the paragraph when cached, "Your week". The score card keeps `ScoreMeter` and `GRADE_SUMMARY`; the daily card never repeats the grade sentence (`GRADE_SUMMARY.fair` contains "protected").

### Watch window (DESIGN-WATCH-WINDOW section 2)

Unchanged. Row 3 ("No change in 3 days.") is the window's streak; `WatchState`, the port, the heights and the capability are as that document leaves them. "Open Talos Labs" is the way to the week screen.

### "Your week" (new route, guided shell)

`{ name: "week"; returnTo: Route }` in `apps/desktop/src/app/router.ts`, rendered by `apps/desktop/src/daily/WeekScreen.tsx` inside `GuidedShell` with `title="Your week"` and one strip link, `button.guided-strip-link` "Back" (`DAILY.back`) through `GuidedShell`'s `strip` prop (DESIGN-CHAT-UI, "The strip"), which calls `router.back()`; no icon-only control. No hero bands. The column is the `full` card. No primary; at most one link ("Show me", on a look or act day); `assertGuidedScreen` is not applied (as for Settings). The day rows read `formatDayRow(date)`, the day word (`Calm`, `Worth a look`, `Act now`, "·" for a row with `cycles === 0`), the score or "no check-up", then "1 thing got fixed" or "3 changes" when above zero.

A calm week:

> ← Your week
> ◎ **Calm.** Day 5 of nothing changed.
> 27 of 31 checks held.
> Still open: Your disk is not locked.
> 72, Fair.
> This week
> ▅▅▅▅▅▅▅   72
> Sun 11 Oct · Calm · 72
> Mon 12 Oct · Calm · 72
> Tue 13 Oct · Calm · no check-up
> Wed 14 Oct · Calm · 72
> Thu 15 Oct · Calm · 72
> Fri 16 Oct · Calm · 72
> Sat 17 Oct · Calm · 72
> This month
> ▃▃▃▃▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅▅   72

No paragraph: nothing happened, so no call was made.

A week with one fix (Wednesday's check-up fixed the firewall, 68 to 72):

> ← Your week
> ◎ **Calm.** Day 3 of nothing changed.
> 27 of 31 checks held.
> Still open: Your disk is not locked.
> 72, Fair. Up 4 since last time.
> This week
> ▃▃▃▅▅▅▅   72
> Sun 11 Oct · Calm · 68
> Mon 12 Oct · Calm · 68
> Tue 13 Oct · Calm · 68
> Wed 14 Oct · Calm · 72 · 1 thing got fixed
> Thu 15 Oct · Calm · 72
> Fri 16 Oct · Calm · 72
> Sat 17 Oct · Calm · 72
> ┃ The firewall you turned on this week closes the hole most attacks on a home network try first, and the disk is the one thing still open.
> ┃ Written by ChatGPT. Not verified.

The paragraph was written on Wednesday, the day with a diff, and is shown that day only; Saturday's screen above shows it only in the demo fixture that pins Wednesday as today. On a later day the slot's key no longer matches and the screen is authored lines alone.

A week with an act now (Thursday the watch saw a new start-up program and a new open port within an hour; the person ran the fishy flow):

> ← Your week
> ⓘ **Worth a look.** One thing to look at.
> Show me
> 27 of 31 checks held.
> Still open: Your disk is not locked.
> 72, Fair.
> This week
> ▅▅▅▅▅▅▅   72
> Sun 11 Oct · Calm · 72
> Mon 12 Oct · Calm · 72
> Tue 13 Oct · Calm · 72
> Wed 14 Oct · Calm · 72
> Thu 15 Oct · Act now · 72 · 3 changes
> Fri 16 Oct · Worth a look · 72 · 1 change
> Sat 17 Oct · Worth a look · 72
> ┃ The changes that came close together are the pattern the app treats as an attack in progress, and the quiet since then is what you want to see.
> ┃ Written by ChatGPT. Not verified.

On Thursday itself, while the watch said act now, the live word was "Act now." with the cue bar and "Show me" opened the fishy flow; the plan line was not drawn and the end screen's act-now card was the one thing. Once the person had run the flow and the watch returned to calm, Thursday's line read "Calm. An act now, handled." and Thursday's row keeps "Act now". The day rows never name the signal: counts only, as decided. The paragraph above names no weekday, no count and no duration, which the validator enforces (section 4).

### Fog and the first day

Fog: "? Couldn't check. Nothing I could read today." then "I couldn't check 21 areas." from `unavailableMax` (the count, never the list: the reasons are the watch window's rows). Before any row: the card is not drawn anywhere, the plan line is absent and the Overview starts at the score card. From the first row the card draws: with one row the bars show one bar and the clause is "First check-up."; a day with no check-up reads "No check-up today." on the held line. A day with `cycles === 0` (the free version, the watch off, the Mac asleep) reads "Checked. The watch didn't run." and its row shows "·" in place of a word; it ends the calm streak rather than pausing it (open question 4).

## 4. The AI reading

**Task.** `checkup`, moment `daily` (DESIGN-AI-PRESENCE's `CheckupInput.moment` gains the value). Output `{ summary, stepLines }` with `stepLines` requested empty as the end moment does. `RemoteTask` is as DESIGN-AI-PRESENCE leaves it, with `checkup`; this document adds no further task id, no schema, no Rust `Task` variant and no Swift output type beyond that document's. None of it exists on 2026-10-17 (the dependency paragraph at the top).

**Derived input.** `{ task: "checkup", moment: "daily", context, stepRuleIds: [], fixedRuleIds: [], nextRuleId: null, previous: null, day }` where `context` is `toExplainerContext(report, catalog, profile)` unchanged and `day` is:

```ts
interface DayInput {
  readonly score: number | null;
  readonly previousScore: number | null;
  readonly fixed: number;             // fixed + fixedByApp, one count for the model
  readonly appeared: number;
  readonly unreadable: number;
  readonly cycles: number;
  readonly changes: number;
  readonly worst: Rating;
  readonly calmStreak: number;
  readonly trend7: readonly (number | null)[];
}
```

Numbers, one enum and nulls. No date, no weekday, no zone, no signal id: the canary test cannot find anything to plant. The system prompt gains, for this moment: "The app has already said what changed and what the numbers are; never repeat a number, a count or a day. Say what this day means for this person in one or two sentences, in the second person, and name at most one thing still open by its plain name. Never write as the app."

**Validator.** `validateCheckup` as DESIGN-AI-PRESENCE section 6 (600 characters, `containsCommandText`, `containsMachineText`, `containsAppVoice`, `claimsAction`), plus the reassurance list of `safeWindowSentence` (safe, protected, secure, clean, fine, "all clear", "no threat", "no malware") and a numbers check: a summary containing a digit, a weekday name (Monday to Sunday, whole word, case-insensitive) or one of the number words one to ten followed by minutes, hours, days, weeks or changes (the duration regex of `safe_window_sentence`, DESIGN-WATCH-WINDOW section 3, with `changes?` added) is dropped, since the app owns the numbers and the model is not told the day. A dropped summary is `null` and the card shows the authored lines.

**When.** Once per local day at most, from the main window. The daily call is queued behind the plan brief: it starts when `brief.plan` is `ready`, `failed` or served from the file, and only if no person-started request has begun; a person request that starts first wins and the daily call is skipped for that landing, not retried. The order holds on ChatGPT too, so one rule covers every provider. Two calls in one `landed()` would fail with `busy` on Claude Code (`claude_code.rs:1041`) and on the on-device engine (`engine.rs:269`), which DESIGN-AI-PRESENCE section 3 cites. The call also needs a free slot: the app-started cap per landed plan becomes 4, the daily call being the fourth (section 7). Conditions, all required: AI on and the provider `available`; `localDayKey(now)` differs from the cached slot's `dayKey`; the day document is not empty: `fixed + fixedByApp + appeared + unreadable > 0`, or `changes > 0`, or `worst !== "calm"`, or `score !== previousScore`. A `--watch` login launch with the window hidden makes no call; a day the main window never opens has no paragraph. The watch's `day_passed` gate (`cycle.rs:650`) is left as it is: its calm sentence feeds the window's row 3 and the daily paragraph does not replace it.

**Cache and persistence.** `brief.daily` in `BriefState` (DESIGN-AI-PRESENCE section 6) with `BriefSlot.key = dayKey`; persisted as a second slot in `last-brief.json`: `{ version: 1, plan: {...}, daily: { dayKey, provider, summary, writtenAt } | null }`. Loaded in `landed()`; shown when `dayKey === localDayKey(now)` and the provider equals the current one; re-validated on load, so an edited file is dropped. Deleted with the file on Disconnect, provider change, the AI switch off, Developer "Reset" (the button at `apps/desktop/src/screens/Settings.tsx:153`; its handler `onResetMemory` is bound at `apps/desktop/src/App.tsx:511` to `saveMemory(EMPTY_GUIDED_MEMORY)` and today touches localStorage only; it gains `await adapters.daily.clear()` and the brief store's `clear()`). A midnight that passes while the app is open: the next `landed()` (a relaunch or "Check again") rekeys; the card on screen keeps the paragraph until then.

**On this Mac.** `CheckupOnDeviceOutput { summary }` as DESIGN-AI-PRESENCE section 4, the 300-character guide; the day input adds under 200 characters to the on-device prompt. The badge is the Apple one.

**Fallback and state machine.** `hidden` (AI off, not `available`, empty day, no row), `cached` (from the file, zero calls), `writing` (nothing on screen for it, no caret, no Stop), `ready`, `failed` (any reason, no retry, no line). The authored card is drawn in every state.

## 5. Contracts

### Core (`packages/core/src/daily/`, new)

- `types.ts`: `DayRow`, `DailyHistory`, `DayDocument`, `DayInput`, `DailyWord = "calm" | "look" | "act" | "fog" | "checked" | "none"`, `DAILY_LIMITS = { maxDays: 90, maxCount: 64 }`.
- `day.ts`: `localDayKey(now: Date, timeZone?: string): string`, `daysBetween(a: string, b: string): number`, `isDayKey(value: unknown): value is string` (`^\d{4}-\d{2}-\d{2}$` and a real date).
- `history.ts`: `parseDailyHistory(raw: unknown): DailyHistory` (field by field, as `parseGuidedMemory`, `packages/core/src/guided/memory.ts:106`; a bad row is dropped, rows sorted, capped), and four pure reducers that upsert the row for `date` and drop the oldest row past 90: `recordLanding(history, { date, score, grade, fixed, appeared, unreadable })` (checkups + 1, sums `fixed` and `appeared`, takes `unreadable`, `score`, `grade`), `recordScore(history, { date, score, grade })` (takes the last score and grade, nothing else), `recordFix(history, { date, count })` (`fixedByApp` + count), `recordCycle(history, { date, rating, changed, unavailable })` (cycles + 1, `changes` + 1 when changed, `worst` the maximum rating, `unavailableMax` the max). Rust mirrors them; `packages/core/fixtures/daily-cases.json` pins both, read by Rust the way `tests/watch_cases_contract.rs:37-51` reads `watch-cases.json` (skipped when absent).
- `document.ts`: `buildDayDocument(history, now)`, `dailyWord(row)`, `todayWord(doc, watch)`, `calmStreak(history, todayKey)`, `trend(history, todayKey, n)`, `FOG_UNAVAILABLE`.
- `reading.ts`: `readingFor(doc, watch: WatchState | null, report: ScanReport | null): DailyReading` with `{ kind: DailyWord, word, clause, held, scoreLine, moveLine, showMe: "act" | "look" | null, dayRows[] }`, `kind` for the icon and the rest as plain strings from the `DAILY` copy (the open line is the desktop's, since `guidedFor` lives in `apps/desktop/src/guided/plan.ts`), and `trendLabel(doc)`. `dayInputFor(doc): DayInput`. This is the one `readingFor`; DESIGN-PLAYFUL's `src/guided/reading.ts` is not written.
- `ports/daily-port.ts`: `DailyPort { load(): Promise<DailyHistory>; recordLanding(input): Promise<void>; recordScore(input): Promise<void>; recordFix(input): Promise<void>; clear(): Promise<void> }`, no `date` on any input (Rust stamps it). The cycle side has no port: Rust records its own cycles.
- `explainer-port.ts`: `CheckupInput.moment` gains `"daily"`, `CheckupInput.day?: DayInput`. `validate.ts`: the numbers (digit, weekday, number word) and reassurance checks for the daily moment. `remote.ts`: `checkupTurns` carries `day`. `system-prompt.ts` and `on-device-prompt.ts`: the sentences above.

### Rust (`apps/desktop/src-tauri/src/daily.rs`, new)

- `FILE_NAME = "daily.json"`, `MAX_DAYS = 90`, `DailyFile { version: u8, days: Vec<DayRow> }`, `DayRow` with the fields of section 2 (`Grade` and `Rating` as closed enums; `Grade` becomes a closed enum as DESIGN-WATCH-WINDOW already requires). Written with `report_store::write_private` (0600, temp file and rename, `report_store.rs:31-45`). One `Mutex<Option<DailyFile>>` in the app state; every edit is load, reduce, write.
- `record_landing`, `record_score`, `record_fix` and `record_cycle(dir, input)` as the core reducers, every one stamping `Local::now().format("%Y-%m-%d")` itself so one clock keys the file; `load(dir)`; `clear(dir)`. No `calm_streak` in Rust: the streak is read in core from the rows.
- `watch/cycle.rs`: `run_once` calls `daily::record_cycle` after `store.finish_cycle` returns `Some(baseline)` (`cycle.rs:1289-1295`, `watch/mod.rs:507`; it returns `None` when the watch was switched off or the licence dropped during the cycle, and then nothing is written or shown, so no row for a discarded cycle), with `conclusion.rating` (the value `store.update` publishes as `s.rating`, `cycle.rs:1304`), `changed = baseline.last_change_at != before` where `before` is the `last_change_at` read at the top of the cycle, and `compared.unavailable.len()`. `WatchState`, `types.rs`, `watch-port.ts` and `watch_cases_contract.rs` are unchanged.
- Commands (`commands.rs`, `commands.txt`, `capabilities/default.json`, `tests/capabilities_contract.rs`): `daily_record_landing({ score, grade, fixed, appeared, unreadable })`, `daily_record_score({ score, grade })`, `daily_record_fix({ count })`, all `Callers::MainOnly`, refusing a score outside 0 to 100, a grade outside the enum or a count above 64 with `invalid_input`; no `date` crosses, so a stray future row cannot be written; `daily_load()` returning `DailyFile`; `daily_clear()`. The watch window's capability is unchanged.
- The no-logging grep test (`tests/ai_no_logging.rs`) adds `src/daily.rs`.

### Desktop

- `apps/desktop/src/adapters/tauri-daily.ts` (`DailyPort` over the five commands), `demo-daily.ts` (section "Demo"), registered in `adapters/index.ts` as `daily`.
- `apps/desktop/src/guided/landing.ts`: `landed()` calls `adapters.daily.recordLanding` once with the score, the grade and `diff.fixed.length`, `diff.appeared.length`, `diff.unreadable.length` (the diff is computed there, line 13). `apps/desktop/src/scan/useScan.ts`: after every `saveLast` succeeds (present, recheck, fix, batch), `adapters.daily.recordScore` with the score and grade, so the day's last score is right. The guided `fix_done` and `batch_done` call `adapters.daily.recordFix` with the count of ids that reached `core.fixed`. A failure is logged nowhere and ignored (the file is a convenience, not the report).
- `apps/desktop/src/daily/`: `useDaily.ts` (loads once per landing, exposes `doc` and `reading`), `DailyCard.tsx` (builds the open line from `nextAction` and `guidedFor`), `TrendBars.tsx`, `WeekScreen.tsx`, `daily.css` (`.daily-card`, `.guided-daily`, `.daily-word`, `.daily-clause`, `.daily-bars`, `.daily-day-row`).
- `PlanScreen.tsx` (the line as the first child of `StepFrame`), `Overview.tsx`, `App.tsx` (the `week` route, `onResetMemory` gains the two `clear()` calls at line 511), `router.ts`. `EndScreen.tsx` and `WatchWindow.tsx` are untouched.
- `machine.ts`: `BriefState.daily`, actions `daily_started`, `daily_ready`, `daily_failed`; `file-brief-store.ts`: the `daily` slot (both files are DESIGN-AI-PRESENCE's, not yet written). `useScan`'s per-plan counter allows 4 app-started calls.
- `labels.ts`: `formatDayRow(date)` giving "Thu 15 Oct" (`Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" })`).

### Demo (`app/demo-boot.ts`, `adapters/demo-daily.ts`, `adapters/demo-explainer.ts`)

| param | values | effect |
|---|---|---|
| `daily` | `calm`, `fix`, `act`, `fog`, `first`, `checked` | the seeded history: 30 calm rows at 72 (`cycles: 24` each); the fix week (68 to 72 on day 4, `fixedByApp: 1`); the act week (`worst: act_now` with 3 changes on day 5, `keep_an_eye` after; the live `watch` param should be `look`); fog (today with `cycles: 4`, `checkups: 0`, `unavailableMax: PROBE_IDS.length`, 21 today and 27 with DESIGN-THREATS-V2); `first` (one row, today); `checked` (today with `cycles: 0`, `checkups: 1`). Absent: `calm`. The param touches `DemoDaily` only, never `DemoWatch` |
| `today` | `YYYY-MM-DD` | pins `localDayKey` in the webview for stable shots; default the real local date |
| `daily_reading` | `1` | seeds the `daily` slot with a canned paragraph keyed on today |
| `daily_fail` | an `ExplainerFailure` | fails the daily call |

`DemoDaily` records `{ kind: "dailyRecordLanding" | "dailyRecordScore" | "dailyRecordFix" }` on `window.__talosDemoCalls`. `CannedAnswers.checkup` (DESIGN-AI-PRESENCE's, not yet written) builds the daily summary from `day.worst` and `day.fixed`, with no digit, weekday or number word.

### Docs touched by the build

`docs/SECURITY-MODEL.md` Data at rest (lines 257-273): a row "Daily history | `<app data>/daily.json`, mode 0600 | one row per local day: a score, a grade, counts and the day's highest watch rating; no rule id, signal id, text or digest; deleted by the Developer Reset". The `last-brief.json` row does not exist there today; DESIGN-AI-PRESENCE's build adds it, and if this document builds first it adds the row itself, naming both slots. Boundary 3 "What the model receives" lists `day` field by field. `docs/DESIGN-AI-PRESENCE.md`: section 3, "at most 3" app-started calls per landed plan becomes 4 with the daily call named as the fourth, and the `useScan` test "a fourth app-started call is refused" (line 414) becomes "a fifth"; section 6, the `daily` moment and slot; section 9 (line 422), "persisted model text beyond the plan reading" becomes "beyond the plan reading and the day's paragraph". `docs/DESIGN-PLAYFUL.md`: nothing; its 3.10 owns the motion alone and names this document for the content (aligned 2026-10-17). `docs/DESIGN-CHAT.md` section 3: the "Today:" meta line and the "Your week" chip in the opening. `docs/DESIGN-WATCH.md` section 7: a sentence that `watch.json` holds no daily rows and `daily.json` is the file. `docs/DESIGN-WATCH-WINDOW.md`: nothing. `apps/desktop/qa/README.md`: the four params and the shots. `docs/TASKS.md` #24.

## 6. Copy

Every string goes into `DAILY` in `apps/desktop/src/guided/copy.ts` under the banned-word test and the 1.6 counter (`copy.test.ts`), scored per string with the dev values; labels, meta lines and the day rows are exempt as the window's meta lines are.

| key | string | counter |
|---|---|---|
| `label` | Today: | exempt (label) |
| `word.calm` | Calm. | 1.00 |
| `word.look` | Worth a look. | 1.00 |
| `word.act` | Act now. | 1.00 |
| `word.fog` | Couldn't check. | 1.00 |
| `word.checked` | Checked. | 1.00 |
| `clause.calm` | No change today. | 1.33 |
| `clause.streak` | Day {n} of nothing changed. | 1.20 |
| `clause.actHandled` | An act now, handled. | 1.33 |
| `clause.checked` | The watch didn't run. | 1.25 |
| `clause.first` | First check-up. | 1.00 |
| `clause.lookOne` | One thing to look at. | 1.00 |
| `clause.look` | {n} things to look at. | 1.00 |
| `clause.fog` | Nothing I could read today. | 1.40 |
| `held` | {n} of {m} checks held. | 1.00 |
| `stillOpen` | Still open: {headline}. | 1.25 (with the dev headline) |
| `allHeld` | Everything I check held. | 1.00 |
| `showMe` | Show me | 1.00 |
| `noCheckup` | No check-up today. | exempt (meta) |
| `score` | {score}, {grade}. | exempt (meta) |
| `up` | Up {n} since last time. | 1.00 |
| `down` | Down {n} since last time. | 1.00 |
| `couldNotCheck` | I couldn't check {n} areas. | 1.25 |
| `fixedOne` | 1 thing got fixed | 1.33 |
| `fixed` | {n} things got fixed | 1.33 |
| `changeOne` | 1 change | exempt (fragment) |
| `changes` | {n} changes | exempt |
| `week` | Your week | 1.00 |
| `thisWeek` | This week | exempt (label) |
| `thisMonth` | This month | exempt |
| `back` | Back | exempt (link) |
| `trendLabel` | Scores over the last {n} days: {values}. | exempt (aria-label; "no check-up" for a null) |

Grade words are `GRADE_LABELS` (`labels.ts:99`). The day-row words are `word.*` without the full stop. The words never appear with "safe", "secure", "protected", "clean" or "fine"; a test greps `DAILY` for them. `WATCH` gains nothing.

## 7. Call budget and caching

| call | when | cap |
|---|---|---|
| `checkup` daily | main window, after the plan brief settles, first landing of a local day with a non-empty day document | 1 per local day, never retried |
| `checkup` plan and end | DESIGN-AI-PRESENCE, unchanged | 3 per landed plan |
| watch judge | `model_gate` in Rust, unchanged | `DAILY_CAP` 24 per UTC day |

DESIGN-AI-PRESENCE's table already spends three app-started calls on the day the owner most wants a reading (plan, end, and the end refresh when "Do this next" changes the fixed list), so the cap per landed plan becomes 4 and the daily call is the fourth; `useScan` refuses a fifth. A changed day with a fix and "Do this next" is four calls; a changed day without a fix is two; an unchanged day with a cached plan brief is zero or one. The daily call is never started in the same tick as the plan brief (section 4, "When"). Measured on the dev-machine fixture: the day input adds about 220 characters to the 2,500-character checkup message. Zero extra calls for the bars, the words, the streak, the rows, the window line. The history file is read once per landing and once per watch cycle (Rust), 10 KB at most.

## 8. Tests and QA

- **Reducers.** `history.test.ts` and `daily.rs` tests from `packages/core/fixtures/daily-cases.json`: a cycle on a new day creates the row; three cycles sum to 3; `worst` keeps `act_now` after a calm cycle; a landing sets the score and grade, adds one to `checkups` and sums `fixed`; a score on the same day replaces the score and adds nothing to `checkups`; a fix adds to `fixedByApp`; the 91st day drops the oldest; a row with a bad date is dropped; a row for an earlier date is upserted in place (the clock went back); `calmStreak` is 0 after a day with `appeared: 1`, 0 across a row with `cycles: 0`, and 5 over five calm rows with cycles ending yesterday when today has no row; `fog` is false for a row with `unavailableMax: 2` (the dev build) and true at `PROBE_IDS.length` with no check-up.
- **Boundary.** `day.test.ts`: `localDayKey` at 2026-10-24T23:30:00Z in Europe/London is 2026-10-25 and at 2026-10-25T00:30:00Z is 2026-10-25 (the 25-hour day); `daysBetween("2026-10-24", "2026-10-26")` is 2 across the clock change; `daysBetween("2026-03-28", "2026-03-30")` is 2 across the spring change; 23:59 and 00:01 local are different keys; the same instant is a different key in Europe/London and in Pacific/Auckland. Rust: `daily::tests::local_date_matches_core_fixture` on the pinned cases.
- **Words.** `document.test.ts`: fog only when nothing was read; `none` with no rows; `checked` for a row with `cycles: 0`; `look` for a row whose worst was `keep_an_eye`; `act` for `act_now`; `todayWord` follows the live rating (calm live over an `act_now` row gives `calm` with `clause.actHandled`); the move line absent when equal; "Up 4" and "Down 4" from the previous scored row, skipping null days. `reading.test.ts`: `showMe` is `"act"` for a live act, `"look"` for a live look, null otherwise; the act word never appears without a watch state.
- **Copy.** `copy.test.ts` walks `DAILY` under the banned words and the per-string counter with the dev values; the reassurance grep.
- **Validator.** `validate.test.ts`: a daily summary with a digit is dropped; "Thursday's two changes in one hour were the pattern." is dropped (weekday, and "two changes"); "Your Mac is safe today." is dropped; "I'll keep watching." is dropped; a two-sentence summary without numbers is kept. Canary: `remote.test.ts` adds the daily moment with a `DayInput` built from the fixture: the ChatGPT and Claude bodies contain neither `INJECT` nor `IGNORE` and no date.
- **Bars.** `TrendBars.test.tsx`: 7 slots from 3 rows have 4 nulls; a null slot renders the dash; today's bar carries the one value label; the `aria-label` lists "no check-up" for a null; the fixed scale puts 50 at half height.
- **Hooks and commands.** `landing.test.ts`: `recordLanding` is called once per `landed()`, never on a fix's `saveLast`. `useScan.test.ts`: `recordScore` once per `saveLast`; `recordFix` once per `fix_done` with the count; a rejected call changes nothing. `daily_record_landing` refuses a score of 101 and a count of 65; the row it writes carries Rust's own date. The daily brief: one call per day under StrictMode; it starts only after the plan brief settles, and a `busy` failure of the daily call is a test failure; none on an empty day; none while a person's request runs; plan + daily + end + refresh makes four calls and the fifth is refused; the slot survives a fix; a mismatched key makes no call and shows nothing.
- **Harness (`apps/desktop/qa/harness.ts`), demo, light and dark, 1100x760 and 900x600, axe on all.** `daily-plan-calm` (`daily=calm&today=2026-10-17`), `daily-plan-look` (`daily=act&watch=look`), `daily-plan-act` (`watch=act`, asserts no `.guided-daily`), `daily-plan-checked` (`daily=checked`), `daily-overview-calm` (`guided=0`), `daily-week-calm`, `daily-week-fix`, `daily-week-fix-reading` (`daily_reading=1`, the paragraph with the badge), `daily-week-act` (`watch=act`, asserts the "Show me" link), `daily-week-fog`, `daily-week-first` (one bar, "First check-up."), `daily-week-none` (`daily=first` with no row: no card on the plan screen, the Overview starts at the score card), `daily-week-reduced-motion`. No watch window shot changes. Assertions: `assertGuidedScreen` on the plan shots (the line is not a `.guided-link`); no `.button-primary` on the week screen; the badge visible wherever `.guided-model` is; the word and the icon both present; the score never on the word line; `dailyRecordLanding` recorded once and `dailyRecordScore` once per save in the guided walk.
- **Only on a real Mac, over days.** The file growing one row a day with the watch on and the window closed; the row around 2026-10-25 (the 25-hour day) counting once; the streak reaching 7; the local date Rust writes matching the webview's on this Mac (Europe/London, checked by `ls -l /etc/localtime`); the real daily paragraph on ChatGPT and on Claude Code, and how often the numbers rule drops it; whether the daily call ever answers `busy` on Claude Code once queued behind the plan brief.

## 9. Out of scope

Rule ids or signal ids in the history; a line chart or an auto-scaled axis; a weather forecast or a sun and cloud glyph set; a notification of any kind, including a streak; a daily call from Rust; a paragraph on an empty day; a paragraph in the chat (the plan brief is the chat's one); a reading per hour; a 365-day history; exporting the week; any change to the 320 px window; a tappable reading on the plan or end screen; model text as the word, the clause, a row or a label; the chat route until DESIGN-CHAT is built (the plan line stands in); count-ups and press motion (`docs/DESIGN-PLAYFUL.md`); the threat signals that would feed the rows (`docs/DESIGN-THREATS-V2.md`); the tray item not showing (TASKS #19); Windows and Linux; localisation beyond British English.

## Open questions for the owner

1. **The words.** "Calm.", "Worth a look.", "Act now.", "Couldn't check.", "Checked.": the window's words, so one state has one name everywhere. The alternative is a weather set ("Calm", "A little wind", "Storm", "Fog"), which reads warmer and asks a 60-year-old to decode a metaphor, and would name the same state two ways across the two windows. Default here: the literal set, always with the kit's status icon.
2. **A paragraph on an empty day.** The authored "Still open: Your disk is not locked." line is the interpretation on a calm day, at zero calls. The alternative is one model call every day, about 30 calls a month per person, most of them on "nothing changed". Default here: no call.
3. **Where the line sits.** It is a meta line under the plan's body, above "Let's go", not a control. The alternative is a 44 px tappable row above the headline that opens "Your week", which puts a calm row before the urgent one and adds a click. Default here: under the body.
4. **A day the watch did not run.** It ends the calm streak ("Checked. The watch didn't run.", day 1 again tomorrow). The alternative pauses the streak and resumes the count after, which would let "Day 12 of nothing changed." stand over a week nobody watched. Default here: end it.
