# Talos Labs watch window design: the menu bar window, with the AI in it

DESIGN-WATCH put a small window under a menu bar icon and a Rust cycle behind it. The window as built (`apps/desktop/src/watch/WatchWindow.tsx`) shows the state word, "Checked 12 minutes ago", a count of areas it could not check with the reasons in a hover title, the top item's authored headline and why, one primary and two links. The cycle already does far more than the window shows: it judges each cycle with the person's own AI and keeps the judge's sentence in memory (`WatchStore.last_verdict`), it knows the interval, it reads `last-report.json` every cycle, it holds the pause and the areas it could not read. None of that reaches the 320 px window, and nothing the person's connected AI wrote is ever drawn there. This document redesigns the window so that it is useful in two seconds, so that the AI the person connected is felt there, labelled, and so that the window is the shortest path into the chat.

This document extends `docs/DESIGN-WATCH.md` (sections 3, 5 and 11), `docs/DESIGN-AI.md`, `docs/DESIGN-AI-PRESENCE.md` (moment 8), `docs/DESIGN-CHAT.md`, `docs/DESIGN-MINERAL.md` and `docs/DESIGN-WARMTH.md`. `docs/SECURITY-MODEL.md` changes in three places, listed in section 5 under "Docs touched by the build". Everything else holds. The model receives only the derived `WatchContext` (ids, booleans, counts, enums, the profile, catalogue text), never machine text. It never runs anything. Every action that changes the Mac is a catalogue entry behind a confirmation in the main window; the small window runs nothing. At most one model call per watch cycle, the judge, and this document adds no call: every model text in the window is text the cycle already paid for, and every typed question is the person's own, sent from the main window's composer by the person's own tap. Every model text carries the provider's name and "Not verified". No notification is added. The window stays opaque, 320 px wide, Mineral. British English; every authored string is under the banned-word test in `apps/desktop/src/guided/copy.test.ts`. Facts about the tree were checked on 2026-10-17 against the files named; `cycle.rs` is being changed by other work and the line numbers given may move.

The owner's words, verbatim (2026-10-17), after seeing the window: "the menu bar is not super nice and useful, we need more AI capabilities" and "in general we are missing the AI magic in Talos". Context: the owner has ChatGPT and Claude connected and working; the window had shown "Nothing changed", "Checked just now", "I couldn't check 1 area", "Open Talos Labs" and "Check now".

Decisions taken where the brief left room:

- **No new model call.** Every model line in the window comes from the judge the cycle already runs. The "AI magic" the owner misses is a wiring gap: `ratingReason` exists in Rust (`WatchVerdict.rating_reason`, kept in `WatchStore.last_verdict`) and never reaches the window; `WatchState` has no field for it. The window gets `ratingReason`, in every rating, and nothing else model-written. The ask field costs nothing until the person taps Send in the main window.
- **The judge writes one sentence in every rating, including calm, and the calm sentence says what is open, not how long things have held still.** On calm the gate opens once a day (`day_passed`, `ACCEPT_AFTER_MS` 24 h), so a sentence that states a duration is wrong by the afternoon. The instruction block tells the model to say what is still open on this Mac and why it matters to this person, never a duration (the app shows the time), never a check-up item's title (the app shows the name). The authored rows carry the live numbers. On this Mac (Apple Intelligence) the calm reason stays empty and the authored line shows.
- **The reason line appears in act now too, under the primary.** DESIGN-AI-PRESENCE moment 8 kept it to the look state because "the act-now primary runs a catalogue entry". In the window the act-now primary opens the main window on the noticed screen and runs nothing (`WatchWindow.tsx`, `openMain("noticed")`). The judge's reason is the honest answer to "why act now?". It sits under the primary, never above it, so it never reads as the instruction. Open question 2.
- **The window's model line has a stricter validator than the fishy flow's.** `safe_sentence` (`validate.rs`) keeps machine text out; it does not keep out "your Mac is safe" or "I've fixed it". The window line is dropped on app voice, on an action claim, on an imperative start, on a guided banned word, on a duration in calm, and on the reassurance words (safe, protected, secure, clean, fine, "all clear", "no threat", "no malware"). The word "malware" on its own is allowed: the judge's own prompt uses it eight times and the catalogue frames start-up changes as malware. A dropped line is replaced by the authored line, never cut.
- **The reason cap is 120 characters, down from 300.** `MAX_REASON_CHARS` is 300 in `validate.rs`, `maxLength` 300 in `ai/schemas.rs` and `WATCH_LIMITS.maxReasonChars` 300 in `watch-port.ts`; moment 8's 140 was never built. At 14 px in a 288 px column a line holds about 40 characters; 120 is three lines, with the badge on a fourth.
- **The ask field is in the calm window only; look gets one link; act gets nothing new.** A 44 px field under an item, a 44 px primary and a reason line do not fit. In look, "Ask why this matters" carries the authored "Why?" question into the main window in one tap. In act now the primary is the one thing, and the chat shows the watch card there (DESIGN-CHAT, "The watch's act now").
- **The question is a draft, not a send.** The watch window's capability is four commands and no free text. The ask field adds the first free-text argument that crosses from that webview, so it crosses as a composer draft: the main window opens with the text in its field and focus on it, and the person taps Send. The one exception is the authored "Why?" question, which the main webview sends at once only when the text equals the string it would have built itself from its own watch state. No text from the small window reaches a model without the person's tap or an exact match on an authored string.
- **The field lands on the Ask screen today and on the chat when it exists.** DESIGN-CHAT is designed, not built (TASKS #12). `apps/desktop/src/screens/Ask.tsx` exists, has a question field and is free once an AI is connected (owner decision, 2026-10-17). The `chat` open screen lands on Ask until the chat route replaces it; the window does not wait for #12.
- **The height cap moves from 360 to 420 px, and the height is a sum of rows.** `tray::window_height` holds one number per rating and `WINDOW_SIZE.height` is 360. The window now sums a fixed budget per row present (section 2, "Heights"), capped at 420. The act state is 404 at most, the calm state 332. The harness keeps measuring and warning. Open question 1.
- **The evidence sentence leaves the window.** `FISHY.evidence` ("I have not deleted anything…") stays on the noticed screen, where DESIGN-WATCH note 40 put it inside Details. In the window its two lines are the reason line's.
- **An unlicensed Mac has no tray item, as today.** `tray::build` returns early when `watch::is_active` is false, `tray::set_state` removes the item when `licensed` is false, `lib.rs` lets the process exit on the last window close when the watch is inactive, and `WatchWindow.test.tsx` pins "renders nothing for an unlicensed state". A menu bar item whose only content is "See the full version" would be a paywall surface against the no-nagging rule. The Welcome and paywall sentences already say the watch is in the full version. The licence flag is the one that exists: `WatchState.licensed`, pushed by `watch_set_profile(profile, ai, licensed)` and persisted in `watch-settings.json`. Open question 3.
- **"What changed" is authored from counts, never a model digest.** A model digest would be a second daily call on the same input the judge saw and would have to live in memory only (DESIGN-WATCH section 7 forbids model text in `watch.json`). The window says "No change in 3 days." from a date and "At your last check-up, 1 new thing to fix." from a count.
- **The calm window says the score, not what the last check-up changed.** "Nothing changed" and "1 new" on one card contradict each other to a person who cannot tell signals from rules, and the Rust rules diff describes what the last check-up changed against the one before, not what changed since it. The check-up row is the score and grade. The appeared count goes to the look-without-item state, where a change is the headline.
- **The window can read the plan's "Do this next" through one new MainOnly push.** Rust has no rule engine (DESIGN-WATCH note 1), so the main webview pushes `{ reportId, ruleId, kind }` whenever `nextAction` changes, as it pushes the profile today. The window renders the catalogue headline, never model text.
- **The window never says "protected", "safe", "secure" or "clean".** The calm line is built from a date, or is a judge line that passed the reassurance check. The score line says the number and the grade word, never the grade sentence (`GRADE_SUMMARY.fair` contains "protected").
- **No icon-only control.** The footer pause icon of the first draft is dropped: a bare pause glyph between two text links means nothing to a non-technical person, and the tray's right-click menu already has "Pause for an hour". The window's port stays the four commands minus `pause`.

## 1. Principles

- **Useful at a glance in two seconds.** The first line is the verdict word. The second is the time, last and next. Then one true sentence about the Mac, then what to do, then one way to ask. Nothing in the window needs a hover: the "I couldn't check" reasons are text, not a `title`.
- **The AI felt, labelled, never in the way.** One model line per state at most, in the model-line style with the short badge, under the authored line it comments on. The authored floor is always drawn; the model line is added or absent, never a replacement, never a headline, never a label, never above a control that leads to a Mac change.
- **Nothing the person did not ask for costs a call beyond the budget.** The judge's call is the only app-started call, one per cycle at most, under `DAILY_CAP` 24 and the gate in section 3. A typed question or a tapped "Ask why this matters" is person-started and goes through the main window's composer, where the plan limits and `limit_reached` are the stop.
- **Honest.** The window never says protected, safe, secure, clean, or fine. The calm line is derived from a date, or is a judge line that passed the reassurance check and that Rust still holds as current (section 3, cache). "Decided by the app itself" is never written in the window; the app's own lines carry no badge, because they are the app's.
- **One primary or none.** As DESIGN-WATCH section 5. The two footer links stay. The ask field's Send is an icon button with an `aria-label`, as the chat's is, never a primary.
- **The window runs nothing.** Its four commands stay: status, check now, pause, open main. Every action that changes the Mac is a catalogue entry run from the main window after a confirmation. The window's primary opens a screen.
- **No nagging.** No notification is added. The "Connect" line is one quiet line with one link, shown only when the person opens the window, never within 14 days of "Not now", never animated, never badged on the icon. When the window cannot read whether "Not now" was pressed, the line is not drawn.

## 2. The window, state by state

Every state is 320 px wide, opaque paper (`--bg-elevated`) with the 1 px `--border` inside, square corners, 16 px padding, 8 px between rows, no grain, no gradient except the one primary. Type: the status word at `--text-guided-list` 600; headlines at `--text-guided-list`; everything else at `--text-guided-meta`, `--fg-secondary` for meta and links, `--fg` for sentences. Icons: the kit's 20 px glyphs through `Icon`. The model line is `p.guided-model-line` from DESIGN-AI-PRESENCE section 5: the sentence through `ModelText`, then the short badge as a trailing `span.guided-model-badge`. `main.watch` keeps `aria-busy` until the first state.

Mock-ups below are the dev machine, licensed, ChatGPT connected, hourly interval. Times are local.

### Calm

> ◎ **Nothing changed**
> Checked 12 minutes ago
> Next check in 48 minutes
> ┃ The one thing still open is your unlocked disk, and it matters most on a laptop that leaves the house.  ChatGPT, not verified
> Last check-up: 72, Fair.
> Up next: Your disk is not locked ›
> [ Ask me about your Mac.                              ↑ ]
> Open Talos Labs · Check now

Rows:

1. Status: kit `check-up` icon and `WATCH.calm`.
2. Meta, two lines: `checkedLabel(lastCheckAt)` as today; the next-check line from `WatchState.nextCheckAt` with the same five-minute rounding as `relativeCheck`: "Next check in 48 minutes", "Next check in about an hour" from 50 to 90 minutes, "Next check in 3 hours" after. A null or past `nextCheckAt` (after sleep, while the full check waits for mains, while a scan or fix holds the tick) reads "Next check soon". While `checking`, the first line is "Checking now" with the static spinner and the second is omitted. Within the 15-minute closer watch (`closeWatchUntil` in the future) the second line reads "Checking every 15 minutes until 18:40".
3. The calm sentence. The judge's `reason` with the short badge when `WatchState.judge` is non-null and its `rating` is `calm` (Rust owns currency, section 3). Otherwise the authored line, no badge: "No change in 3 days." from `lastChangeAt` (days from 24 h, hours under that: "No change in 5 hours."), "No change since the last check." under an hour, or "No change since I started." when `lastChangeAt` is null.
4. The check-up row, when `WatchState.report` is present: "Last check-up: 72, Fair." from `report.score` and `GRADE_LABELS[report.grade]`; with a null score "Last check-up: not scored." Second line, when `WatchState.next` is non-null and its `reportId` equals `report.reportId`: a `button.watch-link` "Up next: {guidedFor(ruleId).headline}" with a trailing "›" in an `aria-hidden` span, opening the main window on `home` (the plan or the chat lands on that step by its own rule). Without a report (a `--watch` login launch before any check-up) the row is "Waiting for your first check-up." with no link.
5. The ask field, when `ai.enabled` is true: a single-line `input` at 44 px, placeholder `WATCH.askPlaceholder` "Ask me about your Mac.", 500 characters, with a 32 px icon button Send (kit `ArrowUp`, `aria-label` "Send"). Enter or Send calls `openMain("chat", text)`; the window hides as the main window takes focus and the draft is cleared. An empty or whitespace draft does nothing. When `ai.enabled` is false, row 5 is the Connect line when the window can tell the AI switch is on and nothing is connected (see "AI not connected"), else absent.
6. Footer: "Open Talos Labs" (`home`) left, "Check now" right, as today.

`ai.enabled` in `WatchState` mirrors `watch-settings.json`'s `ai.enabled`, which `watchAiFor` (`App.tsx`) sets to true only when the AI switch is on and a consumer provider (Apple, ChatGPT or Claude) is chosen. `ai.provider` null means Rust auto-picks, not "nothing connected".

### Something to look at

> ⓘ **One thing to look at**
> Checked 12 minutes ago
> **A new program starts when you log in**
> Bad software often starts this way.
> ┃ Two start-up changes in a day is more than this Mac usually sees.  ChatGPT, not verified
> and 1 more thing
> [Show me]
> Ask why this matters
> Open Talos Labs · Check now

Rows: status with the kit `info` icon and the word with the count as today; meta, one line (the next-check line is calm's); the top item's `FISHY.noticed.headline[kind]` and `WATCH.why[kind]`; the reason line when `judge` is non-null with `rating` `keep_an_eye`, under the why and above "and N more things" (moment 8's placement); the primary "Show me" (`openMain("noticed")`); one text link "Ask why this matters" when `ai.enabled`, which calls `openMain("chat", question)` with `WATCH.askWhy(headline)`: `Why does "A new program starts when you log in" matter?`, the form of DESIGN-CHAT's "Why?" chip; the footer. The answer is prose about the item. A watch item is a signal id and a kind, not a rule, so the chat's intents cannot offer a fix on it; at most the chat's own "open the watch" intent and the watch card when the state is act now.

Look with no item (a rule appeared in the full check, a good flip, a hysteresis hold): the headline rows are replaced by one authored line: "At your last check-up, 1 new thing to fix." when `rulesSince.appeared` is above zero, else "1 change in the last day." from `recentCount`; the primary is "Show me" and opens `home`, where the Since screen or the chat's opening lists the diff. The reason line follows the same rule as with an item.

### Act now

> ⛔ **Act now**
> Checked just now
> **A new program started running on its own**
> Bad software often starts this way.
> and 2 more things
> Experts would cut it off first. CISA's ransomware checklist, step 1.
> [See what to do]
> ┃ A new start-up program and a new open port appeared within the same hour.  ChatGPT, not verified
> Open Talos Labs · Check now

Rows: status in `--sev-critical-fg` with `OctagonAlert`; meta; the item's headline, why and "and N more things"; `WATCH.sourceAct`, the playbook source line, in `--fg-secondary`; the primary "See what to do" (`openMain("noticed")`); the reason line when `judge` is non-null with `rating` `act_now`, under the primary; the footer. No ask field and no ask link: the primary is the one thing, and the chat shows the watch card with "See what to do" and "This is fine, I know it" when the main window opens (DESIGN-CHAT section 5). `FISHY.evidence` is no longer drawn in the window.

### Unreadable (areas the sweep could not read)

Any state may carry `unavailable`. In calm, one visible row replaces today's hover title, under the meta line:

> I couldn't check network services. Not available in this build.

One probe: "I couldn't check {label}. {reason}." with `WATCH_PROBE_LABELS[probeId]` and `UNKNOWN_REASON_LABELS[reason]` (the v0.2 words, already in `labels.ts`). Several probes with one reason: "I couldn't check network services, file sharing and remote access. Needs Full Disk Access." Several reasons: "I couldn't check 3 areas. Open Talos Labs to see why." `UnavailableReason` gains `unsigned_build`, which Rust reports for the socket table an unsigned build cannot read (today `cycle.rs` maps that empty table to `PermissionDenied`, and only the main window corrects it through `socketTableHidden`), labelled with the existing `SOCKET_TABLE_LABEL` "Not available in this build"; today the window's hover reads "Permission was denied", which is false. In look and act now the meta line keeps the count as today ("I couldn't check 1 area") with no hover, and the list is one tap away on the main window; the item is the content of those states. No model line is involved.

### First run

Unchanged: "I'll check your settings on a timer and tell you when something changed." with "Start me when you log in" (`settings_watch`), no status line, no meta line, no field. 170 px.

### Paused

> ⏸ **Paused until 15:30**
> Checked 12 minutes ago
> I'll check again when the hour is up.
> Open Talos Labs · Check now

Status with the kit `pause` icon and "Paused until {time}" (local time, `formatTime`); meta as today; one authored line; footer. "Check now" lifts the pause and checks, as `watch::check_now` does today (DESIGN-WATCH note 35), so no resume command is added. The calm sentence, the check-up row and the ask field are not drawn while paused: a paused window is about the pause. Pause is reached from the tray's right-click menu only.

### Unlicensed

No tray item, so no window: `tray::build` and `tray::set_state` as today. The tooltip, the raster and the window never see `licensed: false` except in the one `WatchWindow` test that pins "renders nothing". A fresh install has `licensed: false` in `watch-settings.json` until the main webview's first push after the licence is read (`useWatch`, `setProfile` runs once `licensed` is not null), so no item appears before the push; after the push a licensed Mac builds the item on first run.

### AI not connected

The window works without an AI: every row above except the model line, the ask field and the ask link. In calm, row 5 is one quiet line with one link, drawn only when `ai.enabled` is false, the window reads `explainer.aiEnabled` true from `localStorage["talos.settings"]`, and `localStorage["talos.guided"]`'s `aiAskedAt` is null or older than `AI_ASK_AGAIN_MS` (14 days):

> Connect your AI to ask me things from here. Connect my AI ›

"Connect my AI" opens the main window on `connect` (the Connect screen of DESIGN-AI, `returnTo` the home). Both reads use the parsers the main window uses (`parseGuidedMemory` and the settings parser) on the same origin; the watch window is a second webview of the same app. If either read fails or parses to a default, the line is not drawn: the window is complete without it, and a line shown on every click to a person who pressed "Not now" would be the nagging the principles forbid. Open question 4 keeps the alternative of carrying `aiAskedAt` through `watch_set_profile`.

### What changed since the last check

There is no separate digest row. The authored calm sentence carries the time since the last change; look-without-item carries the one-line count. These are counts and dates, no labels per signal: the 51 signal names have no authored labels and would be new strings under the banned-word and syllable tests for one line a person sees rarely.

### Heights

`tray::window_height(state)` becomes a sum. One rule: 16 px padding above and below (32), the rows present, and 8 px between every two consecutive rows, the footer being the last row. Capped at 420 (`WINDOW_SIZE.height` in `tray.rs` and `height` of the `watch` window in `tauri.conf.json`, both 360 today). Row budgets, in px: status 24; meta 20 (one line) or 40 (calm, two lines); unreadable 40; calm sentence 20 (authored) or 72 (judge, three lines and the badge); check-up row 20 (score line or waiting line) plus 28 with the "Up next" link; ask field 44; connect line 52; item 92 (a two-line headline, why, more); look-empty line 20; source 40; reason 72; primary 44; ask link 32; first-run text 58 plus link 32; paused line 20; footer 32.

Resulting heights, computed from the rule: first run 170 (58 + 32 + 32, two gaps, padding); calm with the judge line, the score, "Up next" and the field 332; calm with the authored line 280; calm with the unreadable row and the judge line 380; calm with the Connect line in place of the field 340; calm with AI off (authored line, no field) 228; calm with no report 252; look with the reason line and the ask link 396; look with the reason line and no link 356; look with no reason line and the link 316; look with neither 276; look-empty with the reason line and the link 324; act with the reason line 404; act without 324; paused 152. The harness `WATCH_WINDOW_HEIGHTS` table is replaced by the same sum in TypeScript (`watch/height.ts`, one function, one test pinning it to the Rust table through the shared fixture) so a shot is taken at the real height and warns on clipping as today. Note 35's finding that 160 clipped the first-run window by 3 px is why the first-run text row is 58, not 48.

## 3. The AI capabilities

### Kept

**(a) The judge's reason line, in every rating.**

- *Derived input.* `WatchContext` as specified in DESIGN-WATCH section 3: rules with status and change, signals with `same`, `changed`, `first_seen`, counts, the floor and ceiling, `cycle.minutesSinceLastChange`, `cycle.minutesSinceFullCheck`, `recent[]`, `lastVerdict`. The only strings are the regex-checked OS version and rule ids; the canary test pins it.
- *Task.* `watch`, unchanged id. Today nothing tells the model what `ratingReason` is for: the watch block in `packages/core/fixtures/watch-instructions.txt` is one sentence (`WATCH_INSTRUCTIONS_BLOCK` in `remote.ts`: "You rate, and choose probes and actions by id. You cannot run anything. The ids are the only vocabulary."), and the on-device prompt (`watch-instructions-on-device.txt`) has no line about it. New text, appended to `WATCH_INSTRUCTIONS_BLOCK` and emitted into the fixture: "ratingReason is one sentence of at most 120 characters, in every rating, written to the reader in the second person. Never write as the app: never I, me, my or we. Never tell the reader what to click or run. Never say the Mac is safe, protected, secure, clean or fine. Never say how long anything has held still; the app shows the time. Never name a check-up item by its title; describe it in plain words. On calm, say what is still open on this Mac and why it matters to this reader today. On keep_an_eye and act_now, say what the change is and why it stands out." The on-device prompt gains the same rules for `keep_an_eye` and `act_now` and, as new text, "On calm, ratingReason is empty."; the on-device calm fixture keeps `ratingReason: ""`.
- *Schema.* `WATCH_JSON_SCHEMA` `ratingReason` `maxLength` 120 (`apps/desktop/src-tauri/src/ai/schemas.rs`, the Swift `@Generable` guide, `WATCH_LIMITS.maxReasonChars` in `packages/core/src/ports/watch-port.ts`, the fixtures). `MAX_REASON_CHARS` 120 in `validate.rs`. `probes[].reason` and `actions[].sentence` keep 300.
- *Validator.* `validate_watch_verdict` keeps `safe_sentence` for `actions[].sentence` and `probes[].reason` (the fishy flow's Advise rows, DESIGN-WATCH's word list). `ratingReason` goes through a new `safe_window_sentence(text, rating)`: `safe_sentence` with the two corrected regex forms from DESIGN-AI-PRESENCE section 6 (path `(^|[^A-Za-z0-9])[~/][A-Za-z0-9._-]+`, port `(?<![0-9]):[0-9]{2,5}\b`, so "18:00" and "and/or" pass), plus app voice (whole-word `I`, I'll, I've, I'm, I'd, me, my, mine, we, us, our, let's), an action claim (DESIGN-CHAT's `claimsAction`: "done" at the start, "I've turned", "has been turned", "is now on/off"), an imperative first word (DESIGN-AI-PRESENCE's `startsImperative` list), any guided banned word, the reassurance words (safe, safely, protected, secure, secured, clean, fine, "all clear", "no threat", "no malware", "no virus"; case-insensitive, whole words), and on `calm` only a duration `\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(minutes?|hours?|days?|weeks?)\b`. More than one sentence (a second terminal stop followed by a space and a letter) is dropped. A failing `ratingReason` is dropped to `""`; the verdict stands. Over 120 characters is dropped, never cut. The guided banned-word list does not exist as an export today: `copy.test.ts` holds a local `BANNED`. DESIGN-AI-PRESENCE moves it to `packages/core/src/guided/words.ts` as `GUIDED_BANNED_WORDS`; this document depends on that move, adds `emit-fixtures.ts` writing it to `packages/core/fixtures/guided-words.json`, and has Rust pin its own copy to the fixture in `watch_cases_contract.rs`.
- *Cache and currency.* `WatchStore.last_verdict` in memory, as today, extended to `LastVerdict { verdict, at, provider }`; `last_verdict_for` keeps feeding the context's `lastVerdict`. A second in-memory slot, `WatchStore.judge`, holds what the window may show: `{ provider, at, rating, reason }`. Rust owns its currency. It is set when a cycle's call returns a verdict whose `ratingReason` survived `safe_window_sentence` and whose clamped rating equals the shown rating; it is cleared when a cycle opens the gate and no verdict comes back (no provider, busy, `limit_reached`, `rejected_output`, reason dropped), when a cycle records a signal change (`last_change_at` moves), when the shown rating changes, on every baseline edit command (`acknowledge`, `answer_gate`, `snooze`, `record_fix`) and the refresh cycle they request, and on `settle`. Published as `WatchState.judge: { provider, at, rating, reason } | null`. The window draws it when non-null and `judge.rating == state.rating`, nothing else. A relaunch loses it until the next judged cycle; the authored line covers. Never persisted (DESIGN-WATCH section 3). The acknowledgement path is why Rust owns this: `acknowledge` edits the baseline and re-rates with no call, `lastChangeAt` does not move, and a date check in the window would keep showing a sentence about a change the person just said was theirs.
- *Budget.* Zero extra calls. One change to `model_gate` (`cycle.rs`): today the gate opens on every tick while the floor is `keep_an_eye`, which spends the 24-call cap in six hours at the 15-minute interval. New rule: open when `changed_since`, or `day_passed`, or the previous cycle ran model-chosen probes (`run_model_probes` fed `store.pending`, so this cycle's sweep holds the answer the model asked for; one follow-up call), or (`floor >= keep_an_eye` and the last call is older than 6 h). This is a change to the fishy flow's budget as well as the window's: DESIGN-WATCH section 3 step 7 relies on the follow-up. Calm costs one call a day; look costs at most four a day plus one per change plus one per probe round; "Check now" never forces a call.
- *Fallback.* The authored calm line (section 2); `WATCH.why[kind]` alone in look and act.
- *State machine.* `hidden` (`judge` null, rating mismatch, provider On this Mac on calm) or `ready`. No `writing`: the window shows the last cycle's result and never waits.

**(b) The ask field and the "Ask why this matters" link.**

- *Derived input.* None at the window. The text is the person's own words, as the Ask screen's `question` and the chat composer's `question` are. It travels `watch_open_main("chat", question)` to Rust (in memory, never logged, never written), then `watch:open { screen: "chat", question }` to the main webview, which puts it in the composer as a draft with focus in the field. The person taps Send; the composer's own checks run unchanged (today the Ask screen's limit; with DESIGN-CHAT the machine-text guard, the chip match and the accept grammar, each zero-call). Only then a call. The one auto-send: when the question equals `WATCH.askWhy(FISHY.noticed.headline[top.kind])` for the main webview's own current top item, the webview sends it as the "Why?" chip would. Any other text, including one that differs by a character, is a draft.
- *Task, schema, validator.* Today `ask` through the Ask screen; with DESIGN-CHAT, `chat`, `CHAT_JSON_SCHEMA`, `validateChat`, exactly DESIGN-CHAT section 4. The chat envelope carries `watch: { enabled, rating, lastCheckMinutesAgo, items[] }`, so "what did you notice?" is answerable there.
- *Cache.* None; person turns are not cached.
- *Budget.* Person-started, one call per send, uncapped by the app; `limit_reached` is the stop and the screen shows the limit line. The window itself makes no call. Side effects of the open, as of every open of the main window: `tray::show_main` calls `watch::on_main_open`, which requests a full check on the next tick (DESIGN-WATCH section 2), and that check may set `changed_since` and open the judge gate once; when the main window was hidden, `main:shown` fires and `chat` counts as `home` for the launch check-up (note 42), which with DESIGN-AI-PRESENCE built may start the `checkup` brief once per landed plan. All within existing budgets; none is a window call.
- *Fallback.* With no report yet (a `--watch` login launch), the main window runs its launch check-up and holds the draft in a ref until `landed()`; the Ask screen (or the chat) then opens with the draft. With AI off in the main window at that moment (switched off between the push and the open) the draft is dropped and the plan screen shows. With a `chat` route absent and the Ask screen absent (neither built, which cannot happen in this tree) the open lands on `home`.
- *State machine.* `hidden` (first run, paused, act now, `ai.enabled` false), `idle`, `sent` (the window hides as the main window takes focus).

**(c) "I couldn't check", explained by the app.** Zero calls. The hover title becomes a visible row (section 2, "Unreadable") and `unsigned_build` fixes the wrong "Permission was denied" on unsigned builds. State: `hidden` when `unavailable` is empty, else `ready`.

**(d) The authored "what changed" lines.** Zero calls, from `lastChangeAt`, `recentCount` and `rulesSince`. Section 2.

**(e) The plan reading's window line, later.** When DESIGN-AI-PRESENCE's `last-brief.json` exists, a `windowLine` field (one sentence, 120 characters, same validator as `summary` plus `safe_window_sentence`'s reassurance words) written by the same `checkup` call can replace the authored calm line when `judge` is null. Zero extra calls. Not built until the brief is; listed so the schema is designed with the field from the start.

### Dropped, with reasons

- **A model digest of what changed.** A second daily call on the input the judge already saw; its text could not be persisted (DESIGN-WATCH section 7), so a relaunch would re-spend the call; the authored count lines say the same thing.
- **A calm sentence per full check.** A call for text nobody asked for, every six hours; the model deciding timing and urgency, which the app keeps; the one-a-day judge line on calm gives a sentence at zero extra calls.
- **"Explain" as its own task on an item.** A watch item is a signal id and a kind, not a rule, so the `explain` task cannot take it; a new `watch_explain` task would compete with the judge for the 24-call cap on the item it explains; the reason line is already the one-sentence explanation, and "Ask why this matters" gives the fuller one in the main window.
- **A chat inside the 320 px window.** DESIGN-CHAT section 9 keeps it out; a reply streaming into a window that hides on blur is lost on the first click away, and on Claude the first word takes 3 to 5 s. The field hands the draft to the main window instead.
- **Auto-sending typed text from the window.** It would make the main webview spend a model call on text that crossed from the watch webview with no tap in the main window. The draft costs one more tap and keeps the trust boundary where SECURITY-MODEL draws it.
- **Showing `items[].modelSentence` in the window.** It is an action-row sentence and DESIGN-WATCH section 3 allows it on Advise rows only, next to the authored playbook line.
- **A global shortcut to open the window.** A new plugin and permission; Apple's guidance is not to rely on the presence of a menu bar extra. The icon is the way in.
- **The model's `basedOn` ids as a "because of" list.** Labels per signal do not exist and the reason sentence already says it in words.
- **A pause control in the window.** The tray menu has it; an icon-only button is a mystery to the audience; the port stays smaller.

## 4. Quick actions and keyboard

| action | where | what it does | call |
|---|---|---|---|
| Check now | footer, every state but first run | `watch_check_now`; lifts a pause; "Checking now" in the meta line | none (the cycle's gate decides) |
| Open Talos Labs | footer, every state | `watch_open_main("home")` | none at the window; the open requests a full check on the next tick, which may open the judge gate once |
| Up next: … | calm, check-up row | `watch_open_main("home")` | as above |
| See what to do | act now primary | `watch_open_main("noticed")`, the fishy flow | as above |
| Show me | look primary | `watch_open_main("noticed")`; with no item, `home` | as above |
| Ask (the field) | calm | `watch_open_main("chat", text)`; the text lands as a draft | one call after the person's tap in the main window, plus the open's full check as above |
| Ask why this matters | look | `watch_open_main("chat", WATCH.askWhy(headline))`; sent at once by the main webview when it matches its own authored string, else a draft | one call, plus the open's full check as above |
| Connect my AI | calm, switch on and nothing connected | `watch_open_main("connect")` | none |
| Start me when you log in | first run | `watch_open_main("settings_watch")` | none |
| Pause for an hour | tray right-click menu only | `watch::pause(60)` from Rust | none |

Keyboard. The window takes focus when shown (it already does, so blur fires). Focus lands on the ask field when present, else on the primary, else on "Open Talos Labs". Tab and Shift+Tab walk DOM order: status, links, field, Send, footer. Enter in the field sends the draft; Enter on a link or button activates it. Escape never clears the draft, as DESIGN-CHAT's composer rule says; Escape does nothing (the window closes on blur or on a second icon click, as today). No roving tabindex, no arrow handling, no Cmd shortcuts: the window may run under `Accessory` with no app menu (DESIGN-WATCH section 5), so a Cmd shortcut cannot be promised. Paste into the field under `Accessory` is on the real-Mac list (section 7); if Cmd+V does not work there, the fallback DESIGN-WATCH already names applies: `Regular` with `set_dock_visibility(false)`. Every control is a `button` or an `input`; the model line is text nodes with the badge in a `span`; the "›" after "Up next" is `aria-hidden`.

## 5. Contracts

### `WatchState` additions (Rust `watch/mod.rs`, core `watch-port.ts`, `toWatchState` and its test, the demo adapter, `watch_cases_contract.rs` through `..Default`)

```ts
readonly nextCheckAt: string | null;        // written by the loop at the top of each wait
readonly lastChangeAt: string | null;       // baseline.last_change_at
readonly ai: { readonly enabled: boolean; readonly provider: WatchModelProvider | null }; // watch-settings.json ai; provider null means auto-pick
readonly judge: { readonly provider: WatchModelProvider; readonly at: string; readonly rating: Rating; readonly reason: string } | null;
readonly recentCount: number;               // baseline.recent entries in the last 24 h
readonly rulesSince: { readonly reportId: string; readonly appeared: number } | null; // kept until report.reportId changes
readonly report: { readonly reportId: string; readonly scannedAt: string; readonly score: number | null; readonly grade: Grade | null } | null; // from last-report.json, read each cycle
readonly next: { readonly reportId: string; readonly ruleId: RuleId; readonly kind: "fix" | "show" | "details" } | null; // pushed by the main webview
```

Every field is an id, a date, a count, an enum or a validated sentence. `Grade` becomes a `closed_enum` in Rust. `judge.reason` is the only model text and it passed `safe_window_sentence` before publication. `reportId` in `report`, `rulesSince` and `next` is validated in Rust (`report_id_ok`: `[A-Za-z0-9._-]{1,64}`) and in `toWatchState`; a failing id drops the whole field to null. `rulesSince` is kept across cycles because the Rust diff (`WatchContext.rules[].change`, from the `rules` snapshot in `watch.json` against the newly read `last-report.json`) is non-empty only on the first cycle after a main-window check-up, since the watch's own full check never writes `last-report.json`; it is cleared when `report.reportId` changes. `licensed` already exists and is unchanged. `lastFullCheckAt` is not published; no row uses it.

### Commands

- `watch_open_main(screen, question?)`: `OpenScreen` gains `Chat = "chat"` and `Connect = "connect"`. `question` is accepted only with `chat`: at most 500 characters after trimming, CR and LF replaced by spaces, other control characters refused with `invalid_input`, held in memory only, never logged (the no-logging grep test already covers `tray.rs`; `App.tsx` and the adapter never log it either, pinned by a grep in the desktop tests). The emitted event is `watch:open { screen, question? }`; `tauri-watch.ts` drops a payload whose `question` is not a string or is over 500 characters, as it drops malformed payloads today. `App.tsx` gains the two cases: `chat` opens the Ask screen (the chat when it exists) with the draft, or sends it when it equals the authored "Why?" string for the current top item, or holds it until `landed()` when no report exists; `connect` opens the Connect screen with `returnTo` the home. The `chat` case also counts as `home` in `onMainShown` so the launch check-up runs when the main window was hidden.
- `watch_set_next({ reportId, ruleId, kind } | null)`: new, `Callers::MainOnly`, stored in `watch-settings.json` so a `--watch` launch has it, published as `WatchState.next`. `ruleId` must pass `rule_id_ok`; `reportId` must pass `report_id_ok`; `kind` is a closed enum; anything else is `invalid_input`. Called from `App.tsx` whenever `nextAction(plan, report)` changes, next to `watch_set_profile`; null when there is no plan.
- The licence: `WatchState.licensed` is the pushed, persisted flag that exists (`watch_set_profile(profile, ai, licensed)`, `watch-settings.json`, `active()`). This document only reads it and changes nothing about it.
- No new command for the watch window. `capabilities/watch.json` stays at listen, unlisten and the four watch commands; `tests/capabilities_contract.rs` keeps pinning it. The watch window's port stays `Pick<WatchPort, "status" | "onState" | "checkNow" | "openMain">`.

### Rust

- `cycle.rs`: `model_gate` with the probe follow-up and the 6 h rule; `run_once` fills `judge` under the currency rules of section 3(a), `recentCount`, `rulesSince`, `report`, `lastChangeAt`, `ai`; `remember_verdict` keeps the provider. The loop writes `nextCheckAt` before each wait and publishes.
- `mod.rs`: `acknowledge`, `answer_gate`, `snooze`, `record_fix` and `settle` clear `judge`.
- `validate.rs`: `MAX_REASON_CHARS` 120; `safe_window_sentence`; `ratingReason` routed through it; the guided banned-word list pinned to `guided-words.json`; `tests/watch_cases_contract.rs` gains the cases in section 7.
- `types.rs`, `schemas.rs`, the Swift `@Generable WatchVerdictOut`: the 120 cap.
- `state.rs` and `cycle.rs`: `UnavailableReason::UnsignedBuild` for the socket table; core `system-state.ts` and `UNKNOWN_REASON_LABELS` mirror it.
- `tray.rs`: `window_height` as the row sum; `WINDOW_SIZE.height` 420; the tooltip gains "Talos Labs: paused until 15:30."; `open_main` carries the optional question; `tauri.conf.json` `height` 420 for the `watch` window.
- `settings.rs`: `next` in `watch-settings.json`.

### Core and desktop

- `packages/core/src/ports/watch-port.ts`: the fields above, `WatchOpenScreen` gains `chat | connect`, `openMain(screen, question?)`, `WATCH_LIMITS.maxReasonChars` 120, `WATCH_LIMITS.maxQuestionChars` 500 (the Ask screen's limit today, shared with `CHAT_LIMITS` later).
- `packages/core/src/watch/validate.ts`: `safeWindowSentence` mirroring Rust, pinned by the shared `watch-cases.json`.
- `packages/core/src/guided/words.ts` (DESIGN-AI-PRESENCE's deliverable) and `emit-fixtures.ts` writing `fixtures/guided-words.json`.
- `apps/desktop/src/watch/WatchWindow.tsx`: the rows of section 2; `height.ts`; `relative-time.ts` gains `nextCheckLabel`.
- `apps/desktop/src/guided/copy.ts`: the `WATCH` strings of section 6. `apps/desktop/src/app/labels.ts`: `AI_BADGES_SHORT` (DESIGN-AI-PRESENCE section 5), `UNKNOWN_REASON_LABELS.unsigned_build`.
- `apps/desktop/src/App.tsx`: the two `onWatchOpen` cases, the `watch_set_next` push, `chat` in `onMainShown`.
- Demo (`demo-boot.ts`, `demo-watch.ts`): `watch=` gains `paused`, `not-connected`, `look-empty`, `no-report`; `watchAi=` keeps `off | apple | chatgpt | claude | limit` and now also decides the field and the reason line (`apple` draws no calm reason); `watchReason=0` hides the judge line; `watchNext=0` hides "Up next".

### Docs touched by the build

DESIGN-WATCH section 5 (the rows, the height cap, the evidence sentence moving, no pause in the window), note 13 (the `WatchState` fields) and note 35 (the heights); DESIGN-AI-PRESENCE moment 8 (120 characters from 300, act now under the primary, every rating, the calm rules); SECURITY-MODEL Boundary 3, "The watch task" (`ratingReason` 120 characters and `safe_window_sentence`), "Webview and CSP" (the one free-text argument from the watch window is a composer draft, never sent without the person's tap or an exact match on an authored string) and Data at rest (`watch-settings.json` gains `next`: a rule id, a report id and a kind); DESIGN-CHAT section 2 (the `watch:open` draft path); TASKS #15 (the field lands on Ask until #12 is built).

## 6. Copy

Every string goes into `WATCH` in `apps/desktop/src/guided/copy.ts` or `labels.ts` and under the banned-word test. The 1.6 syllable counter (`copy.test.ts`, the fixed counter of DESIGN-V03 section 6) is applied to the guided-style lines below, scored per string; meta lines, status words with a time, links, fragments and the placeholder are exempt as the existing meta lines are (DESIGN-WATCH note 17). The composed "I couldn't check" lines are exempt as meta too: with "Needs permission to control System Events" the composed line scores 1.73 and with "Needs an administrator account" 1.89, because the reason labels are the v0.2 words and are not re-authored here. Scores were computed with the counter on 2026-10-17.

| key | string | counter |
|---|---|---|
| `nextCheckMinutes` | Next check in {n} minutes | exempt (meta) |
| `nextCheckHour` | Next check in about an hour | exempt |
| `nextCheckHours` | Next check in {n} hours | exempt |
| `nextCheckSoon` | Next check soon | exempt |
| `closerWatch` | Checking every 15 minutes until {time} | exempt |
| `calmDays` | No change in {n} days. | 1.00 |
| `calmHours` | No change in {n} hours. | 1.00 |
| `calmRecent` | No change since the last check. | 1.00 |
| `calmStart` | No change since I started. | 1.20 |
| `checkup` | Last check-up: {score}, {grade}. | 1.33 with "Fair" |
| `checkupUnscored` | Last check-up: not scored. | exempt (meta) |
| `checkupNone` | Waiting for your first check-up. | 1.40 |
| `upNext` | Up next: {headline} | 1.14 with the dev headline |
| `askPlaceholder` | Ask me about your Mac. | 1.20 |
| `askWhy` | Why does "{headline}" matter? | 1.18 with the dev headline (the chat's own form) |
| `askLink` | Ask why this matters | 1.25 |
| `send` | Send | exempt (aria-label) |
| `connectLine` | Connect your AI to ask me things from here. | 1.11 |
| `connectLink` | Connect my AI | 1.33 (DESIGN-AI's label) |
| `couldNotCheckArea` | I couldn't check {area}. {reason} | exempt (meta; 1.44 to 1.89 by reason label) |
| `couldNotCheckAreas` | I couldn't check {areas}. {reason} | exempt (meta) |
| `couldNotCheckMixed` | I couldn't check {n} areas. Open Talos Labs to see why. | 1.30 |
| `lookEmptyNew` | At your last check-up, {n} new thing to fix. | 1.13 |
| `lookEmptyNewMany` | At your last check-up, {n} new things to fix. | 1.13 |
| `lookEmptyChange` | {n} change in the last day. | 1.00 |
| `lookEmptyChanges` | {n} changes in the last day. | 1.00 |
| `paused` | Paused until {time} | exempt (status word) |
| `pausedLine` | I'll check again when the hour is up. | 1.13 |
| `AI_BADGES_SHORT` | ChatGPT, not verified / Claude, not verified / Apple Intelligence on this Mac, not verified | exempt (badges) |
| `UNKNOWN_REASON_LABELS.unsigned_build` | Not available in this build | existing `SOCKET_TABLE_LABEL` |
| tooltip | Talos Labs: paused until {time}. | Rust, pinned in `tray.rs` tests |

Plurals: the singular form by the `{n} === 1` rule the window uses today for "and 1 more thing". Grade words are `GRADE_LABELS` (Good, Fair, Poor, At risk); `GRADE_SUMMARY` is never drawn in the window. Unchanged strings: `calm`, `look`, `lookOne`, `lookMany`, `act`, `checked*`, `checking`, `couldNotCheck*` (kept for the look and act meta line), `moreOne`, `more`, `seeWhatToDo`, `showMe`, `openApp`, `checkNow`, `firstRun`, `startAtLogin`, `sourceAct`, `why`. Removed from the window: nothing authored; `FISHY.evidence` is no longer rendered there.

## 7. Tests and QA

- **Copy.** `copy.test.ts` walks every new `WATCH` string and `AI_BADGES_SHORT` under the banned-word list; the per-string counter list gains `calm*`, `checkupNone`, `connectLine`, `couldNotCheckMixed`, `lookEmpty*`, `pausedLine`, each filled with the dev values. `WATCH_PROBE_LABELS` and `UNKNOWN_REASON_LABELS` keep their tests; `unsigned_build` is added to the keys assertion. `words.test.ts` asserts `GUIDED_BANNED_WORDS` equals the fixture.
- **Validator.** `watch-cases.json` gains window-line cases pinned on both sides (`watch_cases_contract.rs`, `validate.test.ts`): kept: "The one thing still open is the update you have been putting off, and it closes the hole attackers try first." (under 120), "It comes back at 18:00.", "and/or", "A new start-up program is how malware usually stays on a Mac." (malware alone is allowed); dropped: "I'll keep an eye on it for you.", "Your Mac is safe for now.", "There is no malware here.", "Done, the firewall is back on.", "Turn the firewall on first.", "A new rule appeared.", "~/Library/LaunchAgents changed.", "port :8080 opened.", a 121-character sentence, two sentences, and on calm only "Three days without a change." (a duration; kept on `keep_an_eye`); a dropped reason leaves the verdict valid with `ratingReason: ""`; `actions[].sentence` keeps today's cases unchanged (the reassurance words and the duration rule apply to the window line only).
- **Canary.** No new task, so the existing watch canary stands; it is re-run with the amended instructions fixture to prove the ChatGPT and Claude bodies carry neither `INJECT` nor `IGNORE` and that the instructions block contains the new sentence rules. `watch_set_next` has a Rust test that refuses an id failing `rule_id_ok` or `report_id_ok`.
- **Gate.** `cycle.rs` tests: with the floor at `keep_an_eye` and a call 10 minutes old the gate is closed; at 6 h it opens; after a cycle that ran model-chosen probes it opens once and then closes; `day_passed` still opens on calm; `changed_since` still opens at once.
- **Judge currency.** `cycle.rs` and `mod.rs` tests: `judge` is set on a kept reason; null after `acknowledge`, `answer_gate`, `snooze`, `record_fix` and the refresh cycle; null when the gate opened and the call failed; null when the shown rating changes; `last_verdict` survives all of those for the context.
- **State.** `toWatchState` and its test parse every new field, drop a malformed `judge`, and drop `report`, `rulesSince` or `next` on a bad `reportId`; the demo adapter's state builds every `watch=` value; `watch_cases_contract.rs` builds states with `..Default` so additive fields pass; `nextCheckAt` is written before each wait (a loop test on the pure helper).
- **Window.** `WatchWindow.test.tsx`: the reason line renders with the short badge in calm, look and act and never with a `judge` whose rating differs from the state's; the field renders only with `ai.enabled` and never in act now, first run or paused; Enter calls `openMain("chat", text)` and clears the draft; Escape leaves the draft; "Ask why this matters" sends the quoted headline form; the unreadable row is visible text and the `title` attribute is gone; a past `nextCheckAt` reads "Next check soon"; the Connect line is absent with `talos.settings` unreadable and absent within 14 days of `aiAskedAt`; the "›" is `aria-hidden`; the unlicensed state still renders nothing; `height.ts` equals the Rust table for every demo state (through the fixture).
- **App.** `App.test.ts`: a `watch:open` with `chat` and free text lands as a draft with no explainer call; with the exact authored "Why?" string for the current top item it sends once; with a string one character off it is a draft; with no report it is held until `landed()`; `connect` opens the Connect screen; `watch_set_next` is pushed when `nextAction` changes and null with no plan; nothing logs the question (a grep over `App.tsx` and `tauri-watch.ts` for `console` next to `question`).
- **Harness, demo, light and dark, 320 px at the state's own height, axe on each:** `watch-window-calm`, `-calm-reason`, `-calm-apple`, `-calm-no-ai`, `-calm-not-connected`, `-calm-unreadable`, `-calm-no-report`, `-look`, `-look-reason`, `-look-empty`, `-act`, `-act-reason`, `-first-run`, `-paused`. The harness asserts: at most one `.button-primary`; the short badge visible wherever `.guided-model-line` is; no `[title]` in `main.watch`; `watch_request_notify_permission` never recorded; the content height at or under the Rust height.
- **Only on a real Mac.** The real judge's calm sentence through ChatGPT and Claude, and the drop rate of `safe_window_sentence` over a day of real cycles on each (whether a 120-character cap survives the model's habit of writing more, and whether the reassurance list drops too much); the window's focus landing in the field on show under `Accessory`; Cmd+V into the field under `Accessory`; `watch:open` with a draft landing in the Ask field; localStorage shared between the two webviews (the Connect line); the 420 px window under a menu bar on a 13-inch screen.

## 8. Out of scope

A chat inside the window; any new model task; a model digest; model text as a headline, a row, a label or a button; auto-sending typed text; a global shortcut; a pause control in the window; signal-level labels for the digest; the licence gate's mechanism and the day-366 rule; `BriefStore` and `windowLine` until the brief is built; the chat route until DESIGN-CHAT is built (the Ask screen stands in); notifications of any new kind; Windows and Linux; provider logos; localisation beyond British English.

## Open questions for the owner

1. **The height cap.** 420 px is the number that fits the act state with the reason line (404). If the owner wants 360 kept, the ask link leaves the look state and the reason line in act now moves to the main window's noticed screen; calm fits either way. Default here: 420.
2. **The reason line in act now.** This document shows it under the primary. The stricter reading of DESIGN-AI-PRESENCE keeps it out of act now altogether. Default here: shown, under the primary.
3. **The unlicensed Mac.** No tray item, as today. The alternative is an icon with a calm raster and a window of one sentence and one link to the full version; it needs five changes (`watch::is_active`, `tray::build`, `tray::set_state`, the `lib.rs` exit guard, the window test), keeps a background process for a free person, and puts the full version in the menu bar. Default here: no item.
4. **The Connect line's 14-day rule.** The window reads `talos.settings` and `talos.guided` from localStorage. If the two webviews do not share it, the line is not drawn at all. The alternative is carrying `aiAskedAt` and the switch through `watch_set_profile`, two more fields in `watch-settings.json`. Default here: read, and hide on failure.
5. **The draft, not a send.** Typed text from the window lands in the main window's field and the person taps Send; only the authored "Why?" question is sent at once. Auto-sending every question would save one tap and would need the trust change recorded in SECURITY-MODEL's webview section. Default here: draft.
6. **The Ask screen as the landing until the chat exists.** The field ships with the window and lands on `apps/desktop/src/screens/Ask.tsx`; when DESIGN-CHAT is built the same event lands in the chat composer. The alternative is to hold the field until #12 lands. Default here: ship on Ask.

## 11. Implementation notes (2026-10-17)

Three blocks follow, one per build: Rust, Core and Window. Each build appends its own.

### Core

- `fixtures/watch-cases.json` gains four keys after `chatgptBody`, in this order: `bannedWords` (the nineteen words), `windowSentences` (every case of section 7, the duration sentence on both ratings, each with a hand-written `kept` flag that `safeWindowSentence` is asserted to match), `heights` (the sixteen named states of contract F as full `WatchState` objects, with the height written by hand from the sum rule) and `reportRows` (the `last-report.json` shapes of contract A, the first a real `evaluate()` report). Rust pins each key; a Rust pin returns early while a key is absent.
- The instruction builders split. `watch-prompt.ts` exports `WATCH_REASON_RULES`, `WATCH_REASON_RULES_ON_DEVICE` and `buildWatchJudgeInstructions()` (system prompt, the rules, then `WATCH_INSTRUCTIONS_BLOCK`); `buildOnDeviceWatchInstructions()` carries the on-device rules in the same place. `remote.ts`'s `buildWatchInstructions()` is unchanged and no longer feeds a fixture: `watch-instructions.txt` is emitted from `buildWatchJudgeInstructions()`, so the ChatGPT call Rust builds from that file carries the rules. Both texts still end with "The ids are the only vocabulary." The rules sit before that block, never after it, because Rust and `watch-context.test.ts` assert the ending. `CHATGPT_BODY_CASE` uses the judge builder.
- `packages/core/test/explainer/remote.test.ts` (the chat session's uncommitted edit) pins `watch-instructions.txt` to `buildWatchInstructions()` at line 192; with the judge text in the fixture that assertion fails. The pin needs to move to `buildWatchJudgeInstructions()`; the core build did not edit that file.
- The banned list lives in `packages/core/src/watch/words.ts` as `WATCH_BANNED_WORDS` with `WATCH_BANNED_PATTERN` (whole word, case-insensitive), not in `guided/words.ts` as section 3 planned, since `packages/core/src/guided/` was not free. It is the local `BANNED` of `apps/desktop/src/guided/copy.test.ts`, same words, same order. Nothing pins the two to each other; drift between them is not tested.
- `WATCH_LIMITS` reads `maxReasonChars: 120` (the window line), `maxSentenceChars: 300` (probe reasons and action sentences, through `safeSentence`) and `maxQuestionChars: 500`. `validateWatchVerdict` routes `ratingReason` through `safeWindowSentence(text, clamped)` and drops it to `""` on failure; the verdict stands. `PATH_LIKE` and `PORT_LIKE` are the corrected forms (`and/or`, `24/7` and `18:00` pass; the port form has no lookbehind so Rust can share it). `validate.ts` exports the named patterns `APP_VOICE`, `ACTION_CLAIM`, `IMPERATIVE_START`, `REASSURANCE`, `DURATION` and `SECOND_SENTENCE`.
- `WatchUnavailableReason = UnavailableReason | "unsigned_build"` and `WATCH_UNAVAILABLE_REASONS` live in `watch-port.ts`; `UnavailableProbe.reason` uses it. Core's `UnavailableReason` and the collector guard are untouched.
- `askWhyQuestion(headline)` in `packages/core/src/watch/ask.ts` is the one place the "Why?" question is built: `Why does {headline with its first character lower-cased} matter?`, no quotes, the DESIGN-CHAT form rather than the quoted one in section 6's table. It throws `invalid_input` on an empty headline. The window's `askWhy` delegates to it, and the chat's "Why?" chip and its auto-send match must import it rather than build the string, or the equality check between the two never holds.
- `watchReportRow(value)` in `packages/core/src/watch/report-row.ts` mirrors Rust `context::report_row`: `reportId` under `WATCH_REPORT_ID` and a parsing `scannedAt` decide whether there is a row; the score and the grade are read from the nested `score.value` and `score.grade` of a `ScanReport`, and a malformed score nulls those two fields, never the row.
- `WatchState` gained the eight fields of contract A after `items`; `WatchOpenScreen` gained `chat` and `connect` with `WATCH_OPEN_SCREENS`; `WatchOpenEvent { screen, question? }` is the shape of `onOpen` and `onShown`; `openMain(screen, question?)` and `setProfile(..., accepted?, next?)` are the port's new signatures. `cases.ts` exports `baseState()`, `DEMO_REASONS`, `HEIGHT_CASES`, `REPORT_ROW_CASES`, `WINDOW_SENTENCE_CASES` and `LONG_WINDOW_SENTENCE` for the other builds' tests.
