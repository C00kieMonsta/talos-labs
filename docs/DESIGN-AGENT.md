# Talos Labs agent design: more it can do, every step visible, one tap per change

DESIGN-WATCH made Rust the agent: a timer, fixed probes, a baseline, a pure rating, and a model that is a one-shot judge naming ids. DESIGN-CHAT made the chat the place to say what you want and turned the model's answers into closed intents the app draws as cards. Both keep the agent invisible: the model's probe choices run after the call and feed the next cycle without a word (`run_model_probes` in `apps/desktop/src-tauri/src/watch/cycle.rs`), a fix shows one status word at a time (`STATUS.*` in `apps/desktop/src/guided/copy.ts`), and nothing the person can ask for starts a round of looking. This document adds the capabilities the owner asked for as closed intents with visible activity: a person-started investigation round, a plan that runs step by step in the chat with a running checklist, verify-after-fix rechecks drawn as rows, a closer watch for an hour, "ask me again tomorrow" and "remind me on Sunday", a write-up for someone else, "what if I leave the disk alone?" answered from the plan's points, and an activity timeline as a first-class object fed by the fix engine, the scan pacer and the watch, consumed by the chat and the guided step frame.

This document extends `docs/DESIGN-CHAT.md` (the intent set, the cards, the chips), `docs/DESIGN-WATCH.md` (section 3 step 7, the probe round), `docs/DESIGN-WATCH-WINDOW.md` (the closer-watch line), `docs/DESIGN-AI-PRESENCE.md` (moment 5, the order) and `docs/DESIGN-ACCEPT.md`. `docs/SECURITY-MODEL.md` changes in the places listed under "Docs touched by the build" (section 5). Everything else holds: Rust collects and judges; the model only explains and proposes ids from closed sets the app put in the request; it never runs anything and never receives machine text; every Mac change is a Rust catalogue entry run after the person's tap, admin ones through macOS's own dialog; no shell, no root, no file contents beyond the declared exceptions; the app is complete with AI off; one primary per guided screen and one live card in the chat; no notification beyond the watch's act now; nothing leaves the Mac except the person's own AI calls; British English, no em-dashes, the banned-word list in `apps/desktop/src/guided/copy.test.ts`; every model text carries the provider's name and "Not verified"; model text never becomes a button, a headline or a row label. Facts about the tree were checked on 2026-10-17 against the files named; `cycle.rs` and `watch/mod.rs` are modified in the working tree, so line numbers there may move.

The owner's words, verbatim (2026-10-17): "Keep iterating on the talos UI -- the chat is bad, we need a better chat interface that you would have on a real modern agent driven app -- we need more playful interactions -- we need more of the threat detection strategies in place -- adding more agentic capabilities -- add threat detection strategies and interpretation of daily checks". This document is the "more agentic capabilities" piece (TASKS #23). The chat surface itself is DESIGN-CHAT-UI, the threat strategies DESIGN-THREATS-V2, the daily reading DESIGN-DAILY, the motion DESIGN-PLAYFUL; this document names where it meets each and designs nothing twice.

Decisions taken where the brief left room:

- **"Agentic" means Rust does more, and shows it; the model never gains a tool.** Every capability here is a Rust command or a pure app action with a closed argument list (an id, an enum, a minute count). The model's part stays what DESIGN-WATCH gave it: up to three probe ids and the order of up to three intents. A modern agent app shows its work as a list of steps with spinners and ticks; Talos can be honest about that only for things the app itself does, so the activity rows are the app's own events, never a model's narration of them.
- **The activity timeline is one type, one reducer, in core.** `ActivityEvent` (section 4) is fed by the fix engine's `fix:status`, the scan machine's `section_progress` and `recheck_*` actions, the watch's `watch:cycle` and a new `watch:activity` event, and the explainer calls. The chat and the guided step frame read the same list. It lives in memory for one check-up, like the transcript (DESIGN-CHAT decision "The transcript lives for one check-up and never touches disk"), and is never written anywhere.
- **"Look into this" costs one judge call, person-started, counted, and works with AI off.** On a watch item it asks Rust for an investigation: one cycle with the model gate forced open (one call under the existing `DAILY_CAP` 24 in `cycle.rs:39`), the model's up to three probe choices run at once as rows, and a code-only re-rate follows with no second call. With AI off, or when the cap is reached, Rust runs the item's own probe set (the probes whose signals are the item's listing siblings and its pair group, `signals::siblings` and `signals::pair_group` in `apps/desktop/src-tauri/src/watch/signals.rs`) and the rows are the same. On a check-up item it is a recheck of the rule's `requires` sections (`core.scan.recheck(sections)`, as `checkAgain` in `apps/desktop/src/guided/runFix.ts` does), zero calls. The model never decides whether to investigate; the person's tap does.
- **A plan executes one tap per Mac change, never one tap for the plan.** "Do them all" (DESIGN-CHAT chip) walks `plan.steps` one live card at a time; each fix card keeps its own primary and macOS keeps its own dialog; a batch is the one batching that exists (one `osascript`, SECURITY-MODEL Boundary 4). The checklist under the walk is `GuidedList` rows with `DoneRow` ticks (`apps/desktop/src/guided/state.ts`, `GuidedList.tsx`). Nothing chains admin dialogs.
- **Verify-after-fix is already the rule; this document makes it a row.** `fix.apply.recheck`, `rulePasses` and `STATUS.checking` exist. The step frame and the chat card draw "Checking it worked" as the last row of the fix's activity, with the tick when the rule passes and the `still_failing` copy when it does not.
- **A closer watch for an hour is the existing closer watch with a minute count.** `close_watch` in `watch/mod.rs:958` sets `close_watch_until` to 24 h (`CLOSE_WATCH_MS`, `cycle.rs:47`) at 15 minutes (`CLOSE_WATCH_MINUTES`, `cycle.rs:48`). `watch_close_watch(minutes: 60 | 1440)` is the one new argument; the interval stays 15. It is offered only when the watch is active (`enabled && licensed`), and refused in words otherwise.
- **Reminders are snoozes with a date and a sentence, never a notification.** "Ask me again tomorrow" and "Remind me on Sunday" write `snoozed[ruleId]` to 09:00 local on that day and `reminders[ruleId]` to the same date in `GuidedMemory` (`packages/core/src/guided/memory.ts`). They surface where the app already speaks: the chat's opening line on the first launch on or after that date, the plan's step order, the end screen's "Still waiting" rows, and the watch window's "Up next" row once DESIGN-WATCH-WINDOW's `next` push exists. The no-nagging rule stands: only the watch's act now may notify.
- **The write-up is authored text, copied; saving is a Rust dialog.** "Write this up for my son" assembles plain text from the catalogue's `guided.headline`, `guided.why`, `guided.where` and `guided.done` strings, the score and grade words, the dates, and the watch's state word. No path, share name, label or port is in it: the 022 folder name is report evidence and is left out on purpose. The model's plan reading (`last-brief.json`, DESIGN-AI-PRESENCE) is included only as a labelled quote with its full badge when it exists. The primary copies to the clipboard through the `CopyButton` pattern (`apps/desktop/src/components/CopyButton.tsx`). The link "Save as a file…" calls a new Rust command that opens macOS's own save panel; the webview never names a path. Open question 1.
- **"What if I leave X?" is answered by the app from points, zero calls, on every provider.** The score is `computeScore` over statuses and points; leaving one rule changes nothing today, so the honest answer is what the rule costs the score and what the catalogue says could happen. A what-if grammar routes the typed question before any call, like DESIGN-CHAT's accept grammar; the model may also name `what_if` as an intent and the app draws the same card.
- **The model's order is honoured within what the app allowed, and nowhere else.** DESIGN-CHAT's "most useful first" over at most three intents stands: the first survivor is the live card. DESIGN-AI-PRESENCE moment 5 keeps the Overview's suggested order behind its button. `plan.steps` order never moves; "Do them all" walks the plan's order, not the model's.
- **A refusal is an app line keyed by reason, with one way out.** `cannot_from_here`, `watch_off`, `full_version`, `cap_reached`, `ai_off`, `no_item`, `busy` (section 3). Never model prose.

## 1. Principles

- **Visible, honest, bounded.** Every row in the activity list is something the app did: a probe it ran, a section it re-read, a command it ran after a tap, a call it made. The row's text is authored, the state is a word and an icon, the time is the app's clock. The model's `probes[].reason` may sit under a probe row as a grey line with the short badge; it never becomes the row.
- **One tap per Mac change, as today.** A plan that executes is a sequence of cards, each with its own primary and its own macOS dialog. Nothing runs from a stream, from a chip, or from an intent at validation time (DESIGN-CHAT section 1).
- **Person-started, counted, capped by the provider.** The document adds no app-started call. "Look into this" is one counted judge call; typed turns are the person's own; everything else is zero calls. `limit_reached` and the watch's daily cap are the stops, and both are said in words.
- **Complete with AI off.** Every capability runs on the fixed rules: the investigation runs the item's own probe set, the plan walks, the recheck rows draw, the closer watch ticks, the reminder returns, the write-up assembles. The badge then reads `DECIDED_BY_APP`.
- **Ids only across every boundary.** A command takes a signal id, a rule id, a minute count or a closed word. The one free-text argument is the write-up's authored text on its way to the save panel, and it is authored by the app from catalogue strings.
- **No nagging.** A reminder is a line on the day, once; a closer watch ends on its own; an investigation never re-runs itself. Nothing in this document notifies.

## 2. The capabilities, state by state

Mock-ups are the chat home of DESIGN-CHAT on the dev machine, licensed, ChatGPT connected, unless noted. Rows marked ○ are running (the static `LoaderCircle`, `ICONS.spinner`, spinning only outside reduced motion), ✓ done (`ICONS.check` in the done bullet), ✗ did not change or could not check (`ICONS.close`), · waiting. Each row is `li.chat-activity-row` inside `ul.chat-activity` (`role="list"`); the state word is in the text, never in the icon alone. Rule ids are for this document only.

### 2a. Activity rows under a fix card

The fix card of DESIGN-CHAT section 3 keeps its headline, sentence, primary and link. When the primary is tapped the primary and link are removed and the activity list takes their place, one row per `ActivityEvent` of that fix, oldest first:

> ▍ **The firewall is off**
> It keeps other computers on the same Wi-Fi from reaching your Mac. I can fix that for you. Your Mac will ask for your password.
> ✓ Getting ready
> ✓ Your password, to macOS
> ○ Turning it on
> · Checking it worked

Rows and their sources: "Getting ready" (`fix_preview` sent, `STATUS.preparing`); "Your password, to macOS" (`fix:status` phase `waiting_for_password`, `STATUS.password`); the verb row, "Turning it on" from `guidedFor(ruleId).verb` lower-cased into the present participle by a fixed table (`ACTIVITY.verbs`, section 4; never a model string); "Checking it worked" (`recheck_started`, `STATUS.checking`). On pass the last row ticks and the result line `DONE_PREFIX` plus `guided.done` appends as DESIGN-CHAT specifies. On `still_failing` the last row is ✗ "It has not changed yet" and the card's primary becomes "Check again" (`failureCopy("still_failing")`). On a cancelled dialog the password row is ✗ "You closed the password box" and the rest never start. A batch draws one list for the whole batch: "Getting ready", "Your password, to macOS", then one verb row per rule as `fix:status` `item` advances for the user-level items (the admin items run inside one script and share one row, "Fixing 3 things"), then "Checking it worked" with one ✓ or ✗ per rule as `DoneRow`s. The same list renders on the guided `StepFrame` in the `working` state in place of the one status line (`StepFrame.tsx` line 111, `.guided-status`), as `ul.guided-activity`; the one `role="status"` element announces each row's text as it changes. Rows never re-order, never collapse while the card works, and collapse to the result line 1400 ms after the last tick (`AUTO_ADVANCE_MS`, 1800 under reduced motion) so the log stays short; the full list stays in Developer mode.

### 2b. "Look into this": the investigation round

Offered as a chip on a watch item (DESIGN-CHAT "The watch's act now" message and the look state), as a chip under a card the app answered with, and as an intent (`investigate`). On a watch item:

> **Look into this**
> I'll re-read the areas this touches and tell you what changed.
> ✓ Background programs · same
> ✓ Open network ports · changed
> ○ Scheduled jobs
> ┃ A new start-up item and a new port in the same hour is the pair worth checking.  ChatGPT, not verified
> Still one thing to look at. [See what to do]
> This is fine, I know it

The app line is `ACTIVITY.investigate.lead`. One row per probe Rust ran, in the order it ran them, labelled by `WATCH_PROBE_LABELS[probeId]` (`apps/desktop/src/app/labels.ts:436`) with the first letter raised; the outcome word after the dot is `same`, `changed` or `couldn't check` from the probe's signals against the baseline (section 4, `ProbeOutcomeWord`), never a value. The grey line under a row, when the judge gave `probes[].reason` and it passed `safe_sentence` (`validate.rs`), is a `p.guided-model-line` with `AI_BADGES_SHORT`; it sits under the row it explains, never above the primary. After the last row, the re-rated state in one authored line: `ACTIVITY.investigate.calm` "Nothing changed in what I re-read.", `.look` "Still one thing to look at.", `.act` "This needs doing now." followed by the watch card (DESIGN-CHAT section 5) when the state is look or act. Budget: one judge call when AI is on and the cap allows (section 5); with AI off the rows are the item's own probe set and no grey line appears. A tap while a cycle runs waits for it (`WatchState.checking` true, the lead reads "Checking now, one moment."); a second tap within the cycle is ignored. On a check-up item the same shape with one row per section in `finding.requires` labelled by `SECTION_PROGRESS_LABELS[key]` and the outcome `still off` or `now on` from `rulePasses`, zero calls.

### 2c. The plan, step by step, with a running checklist

"Do them all" (DESIGN-CHAT chip) appends one app message holding the checklist, then the first live card under it:

> **Do them all**
> I'll go through these one at a time. Each fix is one tap, and macOS asks for your password when it needs it.
> ○ The firewall is off
> · Your Mac answers strangers on the network
> · App Store apps do not update on their own
> · A shared folder has no password
> · Your disk is not locked
> ▍ **The firewall is off** … [Turn it on] · Do this later · ▸ Explain this

The checklist is `GuidedList` rows (`GuidedRowIcon` pending, ok, failed) keyed by step id, one per undone step in `plan.steps` order, batch steps expanded to their rules. The live card is the step's card as DESIGN-CHAT draws it; its activity rows (2a) draw inside the card, not in the checklist. When the card resolves, its checklist row ticks (or crosses with the tag "Did not change" or "I'll show you where", as `DoneRow.tag` does today) and the next card appends after `AUTO_ADVANCE_MS`. A show card does not auto-advance: its watcher or "Check again" settles it; "What's next?" moves on and the row keeps ○ with the tag "Waiting for you". "Do this later" on a card marks the row · with the tag `LATER_FLASH` text shortened to "Another day". The person may tap any pending row to make it the live card out of order (`row_promoted`), as DESIGN-CHAT allows; the walk continues from the row after the one resolved. The checklist message is updated in place (rows are keyed) so the log is not re-announced; the status element announces "3 of 5 done". When every row has settled the end message of DESIGN-CHAT appends under the list. One live card at a time holds throughout; the harness assertion of DESIGN-CHAT section 8 is unchanged.

### 2d. Verify-after-fix

No new mechanism. Every fix card and every batch card ends its activity list with "Checking it worked" (2a). The chat gains one chip after a `still_failing` result: "Check again" (zero calls, `checkAgain`), beside "Show me where" when the rule has a pane. The step frame shows the same row. In Developer mode the row's grey line names the sections re-read (`SECTION_LABELS`).

### 2e. "Watch this closer for an hour"

Chip after a watch message in the look state, after the fishy flow's recover screen ran, and after "This is fine, I know it"; also the intent `close_watch`:

> **Watch this closer for an hour**
> ✓ I'll check every 15 minutes until 15:40.
> [What's next?] [Show me the list]

The line is `ACTIVITY.closer.until(time)` with `formatTime` (`labels.ts:240`). The watch window's meta line reads DESIGN-WATCH-WINDOW's `closerWatch` "Checking every 15 minutes until 15:40" for the hour. When the watch is active but paused, the line is "I'll start when the pause ends, then check every 15 minutes for an hour." (`ACTIVITY.closer.paused`). Refusals, as app lines with one chip: watch off, "The menu bar watch is off. Turn it on in Settings and I can watch closer." with "Open Settings"; unlicensed, "Watching from the menu bar is in the full version." with no chip (the lock card rule of DESIGN-CHAT holds: the full version is pitched at most once per check-up, so this line carries no button). Nothing runs on the Mac; the command edits the baseline's `close_watch_until` and wakes the loop (`reconfigure`, `notify_one`, as `close_watch` does today).

### 2f. "Ask me again tomorrow" and "Remind me on Sunday"

Chips on a card the person just declined ("Do this later" result), and the intents `remind_rule` with `when: "tomorrow" | "sunday"`; the typed forms "ask me tomorrow", "remind me on Sunday", "bring this up on Sunday" are caught by the reminder grammar (section 4) before any call:

> **Ask me again tomorrow**
> ✓ OK. I'll bring up the firewall tomorrow when you open me.

`ACTIVITY.remind.tomorrow(headlineLower)` / `.sunday(headlineLower)`: "OK. I'll bring up {thing} on Sunday when you open me." The headline is `guidedFor(ruleId).headline` with the first letter lowered, authored text. The card collapses to the line; the step leaves the plan as a Later does (`snoozed[id]` written) without counting as a Later (`laterCount` untouched, so DESIGN-ACCEPT's third-Later ask is not advanced by a reminder). How it surfaces, since nothing notifies: on the first launch on or after the date, when the rule still fails, the chat's opening message (or the plan screen with the chat off) carries one line before the plan sentence, `ACTIVITY.remind.due` "You asked me to bring this up today: The firewall is off." and that step is first in `plan.steps` for that check-up (a sort key, not a new bucket); the end screen lists it under "Still waiting" until then; the watch window's "Up next" row reads it once DESIGN-WATCH-WINDOW's `watch_set_next` push exists. A reminder that is due and whose rule now passes is cleared silently at `landed()`. On a Mac left closed past the date the line waits for the next open; the app never speaks when closed.

### 2g. "Write this up for my son"

Chip on the end message and the opening, the intent `write_up`, and the typed forms "write this up", "write it up for my son/daughter/someone", "give me a summary I can send":

> **Write this up for my son**
> Here is a plain summary you can send. It has no file names or settings paths in it.
> ┌ Talos Labs check-up, 17 October 2026
> │ Score 72 out of 100, Fair.
> │ Fixed today: The firewall is on. Your Mac stays quiet.
> │ Still to do: Your disk is not locked. If your Mac is lost or stolen, anyone can read your files. Where: System Settings, Privacy & Security, FileVault. Click "Turn On"…
> │ Left for later: A shared folder has no password.
> │ The menu bar watch: nothing changed since the last check.
> │ ChatGPT wrote, not verified: "Your Mac goes out with you and its disk is not locked…"
> └
> [Copy it]
> Save as a file…

The text is built by `buildWriteUp(plan, report, fixed, watch, brief)` in core, pure, from: `formatDate` (DESIGN-ACCEPT's `labels.ts` addition) for the date; `report.score` and `GRADE_LABELS[grade]`; per fixed id `guided.done`; per undone step `guided.headline`, `guided.why`, and `guided.where` prefixed "Where: " when non-null; per later id the headline under "Left for later"; per accepted id under "Left alone by choice" (DESIGN-ACCEPT); `WATCH.calm|look|act` after "The menu bar watch: " when the watch is active; the brief's `summary` in quotes after `AI_BADGES_SHORT[provider]` and " wrote, not verified: " only when a validated brief for this `planKey` exists. Every string passes `containsMachineText` (`packages/core/src/explainer/prose.ts`, DESIGN-AI-PRESENCE section 6) before the card renders; a hit drops that line, so a catalogue string that ever gains a path cannot leak through this card. "Copy it" writes the text to the clipboard with the `CopyButton` confirmation ("Copied" for 1500 ms). "Save as a file…" calls `writeup_save(text)`: Rust opens macOS's save panel with the default name `Talos Labs check-up 2026-10-17.txt`, writes the text (0644) to the path the person chose, and returns `saved | cancelled`; the webview never sees the path. The preview is a `pre.chat-writeup` at `--text-guided-meta`, scrolling past 12 lines.

### 2h. "What if I leave the disk alone?"

The what-if grammar (section 4) routes the typed question; the intent `what_if` renders the same; the chip "What if I leave it?" appears after a card derived on this Mac and after "Do this later":

> **What if I leave the disk alone?**
> **Leaving it costs 18 of the 100 points.** The score would stay at 72, and the best it can reach is 82 while this is left.
> If your Mac is lost or stolen, anyone can read your files.
> ▍ **Your disk is not locked** … [Show me where] · I'll do it later · ▸ Explain this
> [Leave it alone] [What's next?] [Show me the list]

Zero calls. The points line is `ACTIVITY.whatIf.points(points, score, ceiling)` where `points` is the finding's `result.points`, `score` is `report.score`, and `ceiling` is the score with every other failing rule fixed, computed by `computeScore` over a copy of the results with those statuses set to `pass` (the same function, pure). The second line is `guided.why`. For a critical rule a third authored line: `ACTIVITY.whatIf.critical` "This is the one that would hurt most." The card is the step's card (or the Details card for a left-alone rule) and "Leave it alone" is one tap away, so the honest answer and the accept of DESIGN-ACCEPT sit together. When the model is asked instead (a form the grammar misses), its reply streams above the same app card, which the app draws from `what_if` or from `relatedRuleIds`.

### 2i. The model's order

DESIGN-CHAT's `intents` list is kept in the model's order after validation; the first survivor is the live card and the rest are rows. This document adds one rule: when `investigate`, `close_watch`, `remind_rule`, `write_up` or `what_if` survives alongside a `fix_rule`, `fix_batch` or `show_where`, the Mac-changing intent is still drawn as the live card and the others as rows, whatever the model's order, because a card whose primary changes the Mac is the one the person must see whole (DESIGN-WARMTH 6b, the one primary). Within the non-changing kinds the model's order holds. `plan.steps` never re-orders on the model's word.

## 3. Honest limits, and how the app says them

| the agent cannot | the app says | way out |
|---|---|---|
| run anything the model wrote, or a command at all | never arises: there is no field for one; a typed command meets the composer guard, "I can't read paths or commands. Say it in words and I'll answer." (DESIGN-CHAT) | type it in words |
| stop a program by name or pid, delete a file or an account | "I can't stop it by name. I can switch off the start-up entry it uses, if it has one." (`ACTIVITY.refuse.cannot_from_here`); the fishy flow's Stop screen when a plist can be bound | "See what to do" |
| see what a program does, scan files, read the socket table on an unsigned build | "I read settings and start-up lists, never what a program does." / the unreadable row with `SOCKET_TABLE_LABEL` | none; the not-antivirus sentence |
| investigate without the watch | "The menu bar watch is off, so I can't look closer from here." (`refuse.watch_off`) with "Open Settings"; unlicensed: "Looking closer from the menu bar is in the full version." (`refuse.full_version`), no button | Settings |
| make a second judge call in one round, or any call past the cap | "I've used today's allowance for the watch. I'll keep checking by the rules until tomorrow." (`refuse.cap_reached`); the rows still run | the rules run |
| act while the person is away, or remind with a notification | "I'll say it next time you open me. I don't send reminders." (`refuse.no_notify`) | the reminder line on the day |
| choose which areas to re-read beyond the 19 model-choosable probes (`MODEL_PROBE_IDS`), or run `probe.persistence_signatures` and `probe.ssh_keys` on the model's word | never shown; the validator drops the id and the row never exists | none |
| run two things at once | "I'm in the middle of something. One moment." (`refuse.busy`) when `PlanStore::is_busy()`, a cycle, a recheck or a stream is live | wait |
| explain a watch item with the `explain` task, or fix a watch item as a rule | DESIGN-WATCH-WINDOW's rule: a watch item is a signal id and a kind; the chat offers the watch card and "Ask why this matters" | the fishy flow |

Every refusal is an app line, authored, under the banned-word test, with at most one chip. The model is told nothing about refusals; it sees `allowed.kinds` and names only what is there.
