# Talos Labs iteration 4: the index

Five documents answer the owner's brief of 2026-10-17. This file is the map: what each delivers, the contracts they share, the order to build them in, the files each build touches so two sessions can split the work, the call budget as a whole, the open questions in one list, and what only a real Mac can verify. It designs nothing; where two documents disagreed, the fix was made in the owning document on 2026-10-17 and the list is in section 8. Ownership rule used throughout: `docs/DESIGN-CHAT-UI.md` owns the transcript and how a row is drawn, `docs/DESIGN-AGENT.md` owns `ActivityEvent` and the intents, `docs/DESIGN-THREATS-V2.md` owns signals, `docs/DESIGN-DAILY.md` owns the reading, `docs/DESIGN-PLAYFUL.md` owns motion tokens.

The owner's words, verbatim (2026-10-17): "Keep iterating on the talos UI -- the chat is bad, we need a better chat interface that you would have on a real modern agent driven app -- we need more playful interactions -- we need more of the threat detection strategies in place -- adding more agentic capabilities -- add threat detection strategies and interpretation of daily checks". The first bullet of the same message, "The top bar app is not working anymore, it is not showing anymore", is TASKS #19 (explained: the watch is licence-only since #14) and is not designed here. The owner's standing tests apply to every screen: obvious what to click, a sense of urgency, not "too much clicking", warmth.

## 1. What each document delivers

**DESIGN-CHAT-UI (TASKS #20, with DESIGN-CHAT #12).** The conversation surface that replaces `apps/desktop/src/screens/Ask.tsx`: grouped exchanges, person bubbles, model blocks with the caret and badge, cards with one primary, activity rows under a working card, chips in the foot, a composer with Send and Stop, time dividers, the "New messages" pill, one live region.
A reducer (`apps/desktop/src/chat/state.ts`) with every event and its effect, the component tree under `apps/desktop/src/chat/`, what each provider adapter streams, and the error notices with one way out each.
Zero new calls, no Rust change; the opening always has a live card so the home has a primary.

**DESIGN-PLAYFUL (TASKS #21).** A motion vocabulary inside Mineral: three new duration tokens, a press scale, thirteen moments (the first-run hello, scan dots, the ring count-up, the done disc, the cue bar, press, the horizon, the breathing spiral, the watch status crossfade, the reading's arrival, tap the ring, one new string, model text unchanged).
Every moment looks right frozen; reduced motion and the harness's `UNROLL_CSS` get the final frame; a separate `qa/motion.ts` smoke test measures each moment.
CSS, one `app/motion.ts` module, `CountUp`, a few props; no core, no Rust, no call.

**DESIGN-THREATS-V2 (TASKS #22).** Sixteen new watch signals behind six probes (shell start-up files, PATH, new apps and their signatures, library apps, AirDrop and Internet Sharing, login hooks and library inserts, authenticated root, PAM files), four signals widened, an OS-build hold so an update is not an item, three new fishy kinds (`app`, `shell`, `exposure`).
Five check-up rules TL-MAC-032 to 036, two playbook rows with a `CIS` source, and a "What I watch" screen (route `coverage`) grouped by the five Cyber Essentials controls with an honest "What I can't see" list.
No new call, no notification, no permission prompt; one widened content exception (`codesign` on a new app bundle).

**DESIGN-AGENT (TASKS #23).** The activity timeline (`packages/core/src/activity/`) that both the chat and the guided step frame draw; five new closed intents (`investigate`, `close_watch`, `remind_rule`, `write_up`, `what_if`) with typed grammars that run before any call.
"Look into this" is one person-started, counted judge call (the rules choose the probes with AI off); "Do them all" walks the plan with a running checklist, one tap per Mac change; a closer watch for an hour; reminders as dated snoozes; a write-up copied or saved through macOS's own panel; "what if I leave it?" answered from points.
Three Rust commands (`watch_investigate`, `watch_close_watch(minutes)`, `writeup_save`) and one event (`watch:activity`), ids and closed words only.

**DESIGN-DAILY (TASKS #24).** A local calendar day as the unit, `daily.json` written by Rust (counts, scores, enums, at most 90 rows), a day document derived in core, and an authored reading: a word ("Calm.", "Worth a look.", "Act now.", "Couldn't check.", "Checked."), a clause, what held, what is still open, the score and its move, a 7 and 30 day bar chart drawn by the app.
Shown as a line on the plan screen and in the chat opening, a card on the Overview, and the "Your week" screen; the watch window is unchanged.
At most one model paragraph a day, only on a day where something happened, stored as a second slot of `last-brief.json`; sections 2, 3 and 5 stand alone with AI off.

## 2. Shared contracts

| contract | owner | consumers |
|---|---|---|
| `ActivityEvent`, `ActivityKind`, `ActivityOutcome`, `ProbeOutcomeWord`, `reduceActivity`, `rowsFor`, `activityLabel` (`packages/core/src/activity/`) | AGENT section 4 | CHAT-UI (`ChatActivity.tsx`, `activityWord.ts`), AGENT's `StepFrame` rows, `apps/desktop/src/activity/useActivity.ts` |
| Row DOM `li.chat-activity-row[data-state][data-activity]`, icons, state words `CHAT.word.*` (incl. `same`, `changed`, `stillOff`, `nowOn`) | CHAT-UI section 2 and 5 | AGENT (2a, 2b, the step frame's `ul.guided-activity`) |
| Fix-row labels `ACTIVITY.rows.preparing`, `.batchAdmin`, `.checking`, `ACTIVITY.verbs` | AGENT section 4 copy | CHAT-UI's "Fix what you can" mock-up and tests |
| `ChatMessage`, `ChatState`, the event table, `ChatCard.kind` (incl. `write_up`), `cardKindFor`, `chips.ts` | CHAT-UI sections 4 and 5 | AGENT (round events, the 2j chip table), DAILY (`reading` in `opened`, the "Your week" chip) |
| `INTENT_KINDS` (DESIGN-CHAT's eleven plus AGENT's five), `ChatInput.allowed`, `validateChat`, `CHAT_JSON_SCHEMA` (`packages/core/src/chat/intents.ts`, `explainer/schemas.ts`) | DESIGN-CHAT, extended by AGENT | CHAT-UI, the six adapters' `chat` methods |
| `GuidedHero.writing`, `Hero writing` prop, `data-writing`, `spiral-breathe` on `.hero-spiral svg` | PLAYFUL 3.8 (tokens, keyframe, selector) | CHAT-UI (`useGuidedHero(spiral, horizon, writing)`) |
| `--motion-settle`, `--motion-fill`, `--motion-breathe`, `--press-scale`, `MOTION`, `motionOff()`, `useEased()`, `CountUp` | PLAYFUL section 2 | CHAT-UI (card fade at `--motion-base`, disc 0.92), DAILY (`bar-grow` over `--motion-settle`) |
| `GuidedShell` `strip` prop (`button.guided-strip-link` links before "Details" and "Settings") | CHAT-UI "The strip" | DAILY ("Your week" Back), THREATS ("What I watch" Back) |
| `SIGNAL_IDS` (67), `PROBE_IDS` (27), `RUST_PROBE_IDS` (3), `FishyKind` (10), `GatedKind`, `WatchOpenScreen` + `coverage`, `UnavailableReason` + `spotlight_off`, `WATCH_PROBE_LABELS` | THREATS section 7 | AGENT (`investigation_set`, `MODEL_PROBE_IDS` 24, probe-row labels), DAILY (`FOG_UNAVAILABLE = PROBE_IDS.length`), WATCH-WINDOW |
| `DayRow`, `DailyHistory`, `DayDocument`, `DailyReading` (with `kind: DailyWord`), `readingFor`, `DailyPort`, `daily.json` | DAILY sections 2 and 5 | CHAT-UI (the opening's first line), PLAYFUL 3.10 (motion only), AGENT (nothing; the write-up reads the report, not the history) |
| `CheckupInput.moment` + `daily`, `DayInput`, the `daily` slot of `last-brief.json`, app-started cap 4 per landed plan | DAILY section 4 (on AI-PRESENCE's `checkup` task) | AGENT section 5 (cites the 4), AI-PRESENCE (docs touched) |
| `watch:activity` event, `watch_investigate`, `watch_close_watch(60 \| 1440)`, `Edit::CloseWatch { minutes }`, `writeup_save`, `GuidedMemory.reminders` | AGENT section 4 | WATCH-WINDOW's closer-watch line, `useActivity.ts`, `tauri-watch.ts` |
| `coverage` route `{ name: "coverage"; returnTo }`, `week` route `{ name: "week"; returnTo }`, `chat` route | THREATS 4a, DAILY section 3, DESIGN-CHAT | `app/router.ts`, `App.tsx`, `onWatchOpen` |
| Copy blocks: `CHAT` + `EXPLAIN.busy` (CHAT-UI), `ACTIVITY` (AGENT), `DAILY` (DAILY), `COVERAGE` + `FISHY.*.{app,shell,exposure}` + `FISHY.signature` (THREATS), `END.allDoneLine` (PLAYFUL) | each doc | `apps/desktop/src/guided/copy.ts`, `copy.test.ts` (banned list, 1.6 counter; templates use `{n}` placeholders and `.replace`) |

## 3. Build order

Designed but not built today, and what this iteration needs from each:

- **DESIGN-CHAT (#12).** Built with CHAT-UI, which is its surface; AGENT's intents extend its set; DAILY's chat line and THREATS' `open_watch` link land on it when it exists (the plan line and the watch window stand in until then).
- **DESIGN-ACCEPT (#13).** Before the chat's accept grammar and AGENT's what-if card ("Leave it alone", `accepted` in the write-up, `formatDate`).
- **DESIGN-AI-PRESENCE (#10).** Before DAILY section 4 only (the `checkup` task, `BriefStore`, `last-brief.json`); the chat and AGENT read the plan brief when it exists and run without it.
- **DESIGN-WATCH-WINDOW (#15).** Optional for every build here: the chat accepts its draft when it arrives, AGENT's closer-watch line and "Up next" push use it when present, THREATS adds the `coverage` open screen beside its `chat` and `connect` cases.

1. **PLAYFUL.** No core, no Rust, no dependency; touches files the chat will touch later (`GuidedShell.tsx`, `Hero.tsx`), so it lands first and the chat builds on its `writing` prop. Unblocks the chat's breath and the daily card's motion.
2. **AGENT part A: the activity timeline.** `packages/core/src/activity/`, `apps/desktop/src/activity/useActivity.ts`, `ACTIVITY.rows` and `ACTIVITY.verbs`, the step frame's `ul.guided-activity`. Small, zero calls, and CHAT-UI's rows read it, so it goes before the chat.
3. **DESIGN-ACCEPT, then DESIGN-CHAT with CHAT-UI.** The home once an AI is connected. Needs 1 and 2. The largest build; everything after it in the chat column waits for it.
4. **AGENT part B: intents, grammars, chips, Rust commands.** Needs 3. The "Do them all" checklist, "Look into this", the closer watch, reminders, the write-up, what-if.
5. **THREATS.** Independent of the chat; needs only the built watch. Rust-heavy (`watch/*.rs`), the five rules, the coverage screen. Can run in parallel with 3 and 4 in the other session; its one meeting point with the chat is the `open_watch` card's link.
6. **DAILY sections 2, 3 and 5.** Needs the `strip` prop (3) or adds it itself per CHAT-UI's spec if it lands first; the chat opening's line needs 3; the plan line stands in until then. After THREATS when the same session does both, because both touch `cycle.rs`, `router.ts` and `App.tsx`.
7. **DESIGN-AI-PRESENCE, then DAILY section 4.** The daily paragraph is the last thing; nothing else waits for it.

`apps/desktop/src-tauri/src/watch/cycle.rs` is still being changed by the #14 gate workflow (TASKS #16: "build starts when the gate workflow has stopped editing the tree"); steps 4, 5 and 6 touch it and should not start before that workflow is done.

## 4. Files each build touches

**PLAYFUL.** `apps/desktop/src/styles/{tokens,base,guided,components,screens,watch}.css`; new `src/app/motion.ts`, `src/components/CountUp.tsx`; `components/Hero.tsx` (`writing`), `components/ScoreMeter.tsx`, `guided/GuidedShell.tsx` (`writing` from the explain slot), `guided/GuidedWelcome.tsx`, `guided/EndScreen.tsx`, `watch/WatchWindow.tsx` (`span.watch-status-inner`), `guided/copy.ts` (`END.allDoneLine`); new `qa/motion.ts`; tests beside each. Later: `styles/chat.css` press scale, `styles/daily.css` 3.10 rules.

**AGENT A.** New `packages/core/src/activity/{types,reduce,label}.ts` and `test/activity/`; new `apps/desktop/src/activity/useActivity.ts`; `guided/StepFrame.tsx`; `guided/copy.ts` (`ACTIVITY.rows`, `ACTIVITY.verbs`); `styles/guided.css` (`.guided-activity`).

**DESIGN-CHAT + CHAT-UI.** New `packages/core/src/chat/{intents,input,allowed,transcript}.ts`; `explainer/{schemas,validate,prose,remote,on-device-prompt}.ts` (the `chat` task); `ports/explainer-port.ts` (`chat`); new `apps/desktop/src/chat/` (every file of CHAT-UI section 3), new `styles/chat.css`; `app/App.tsx` (the `chat` route, `onWatchOpen`, `ask` removed), `screens/Ask.tsx` deleted with its classes in `styles/screens.css:307-385` and `ai-expert.css:52-70`; `guided/GuidedShell.tsx` (`strip`, `writing` OR), `components/Hero.tsx`, `app/icons.ts` (`ArrowUp`), `guided/copy.ts` (`CHAT`, `EXPLAIN.busy`); the six adapters' `chat` methods; Rust `ai/` `Task::Chat` as DESIGN-CHAT specifies; `qa/harness.ts` (`walkChat`).

**AGENT B.** `packages/core/src/chat/{intents,input}.ts`, `explainer/{schemas,validate,remote}.ts`, new `chat/writeup.ts`, `guided/memory.ts` (`reminders`), fixtures `chat-instructions.txt`, `explainer-schemas.json`; Rust `watch/{cycle,mod,probes}.rs` (`watch_investigate`, `investigation_set`, `watch:activity`, `Edit::CloseWatch { minutes }`), `commands.rs` (`writeup_save`), `Cargo.toml` (`rfd`), `commands.txt`, `capabilities/default.json`; `apps/desktop/src/chat/{grammar.ts (new),chips.ts,controller.ts,state.ts,useChat.ts}`, `activity/useActivity.ts` (`watch:activity`), `adapters/{tauri-watch,demo-watch,demo-fix}.ts`, `app/demo-boot.ts`, `guided/landing.ts` (`reminderDue`), `guided/copy.ts` (the rest of `ACTIVITY`).

**THREATS.** Rust `exec.rs`, `watch/{probes,signals,baseline,cycle,types,mod,notify,playbook}.rs`, `fix/catalog.rs` (033), `settings_pane.rs` (`AirDrop`), new `collect/macos/apps.rs`, `collect/macos/remote_access.rs`; core `ports/watch-port.ts`, `watch/{signals,cases,playbook}.ts`, `domain/system-state.ts`, new `rules/macos/tl-mac-032..036.ts`, `guided/plan.ts` (`LEFT_ALONE`), fixtures `watch-cases.json`, `playbook.json`; desktop `guided/copy.ts` (`FISHY`, `WATCH.why`, `COVERAGE`), new `guided/coverage-experts.ts`, new `guided/screens/CoverageScreen.tsx`, `guided/fishy/useFishy.ts`, `app/{router,App,labels}.ts(x)`, `screens/WatchSection.tsx`, `adapters/demo-watch.ts`, `app/demo-boot.ts`, `styles/guided.css` (`.coverage-*`).

**DAILY.** New Rust `daily.rs`; `watch/cycle.rs` (`record_cycle`), `commands.rs`, `commands.txt`, `capabilities/default.json`; new `packages/core/src/daily/{types,day,history,document,reading}.ts`, new `ports/daily-port.ts`, fixtures `daily-cases.json`; new `apps/desktop/src/adapters/{tauri-daily,demo-daily}.ts`, `adapters/index.ts`, new `src/daily/{useDaily.ts,DailyCard.tsx,TrendBars.tsx,WeekScreen.tsx,daily.css}`, `guided/landing.ts`, `scan/useScan.ts`, `guided/screens/PlanScreen.tsx`, `screens/Overview.tsx`, `app/{router,App,labels}.ts(x)`, `guided/copy.ts` (`DAILY`), `scripts/contrast.ts`. Section 4 adds `explainer/{explainer-port,validate,remote,system-prompt,on-device-prompt}.ts`, `scan/machine.ts`, `file-brief-store.ts`.

Collision hot spots, to be edited by one session at a time: `guided/copy.ts` (all five; each owns one block, append only), `app/App.tsx` and `app/router.ts` (chat, THREATS, DAILY), `guided/GuidedShell.tsx` and `components/Hero.tsx` (PLAYFUL first, then the chat), `watch/cycle.rs` (THREATS, DAILY, AGENT B, and the #14 workflow), `ports/watch-port.ts` and `adapters/demo-watch.ts` (THREATS, AGENT B), `app/demo-boot.ts` (all but PLAYFUL), `styles/guided.css` (PLAYFUL, AGENT A, THREATS), `guided/landing.ts` (DAILY, AGENT B). Suggested split: session A takes PLAYFUL, THREATS, DAILY; session B takes AGENT A, ACCEPT, DESIGN-CHAT with CHAT-UI, AGENT B.

## 5. Call budget per day, per provider

The same rules hold for ChatGPT, Claude Code and Apple Intelligence on device; nothing here distinguishes them except the provider's own limits.

| source | started by | cap | document |
|---|---|---|---|
| Watch judge, one per cycle, including "Look into this" rounds | Rust (`model_gate`) or the person's tap | `DAILY_CAP` 24 per UTC day; the calm gate opens once a day, the look gate every 6 h (WATCH-WINDOW) | DESIGN-WATCH, AGENT section 5 |
| Plan brief, end brief, end refresh | the app, per landed plan | 3 per landed plan, cached in `last-brief.json` (usually 0 or 1) | DESIGN-AI-PRESENCE |
| Daily paragraph | the app, after the plan brief settles | 1 per local day, never on an empty day, never retried; the fourth of the 4 per landed plan | DAILY section 7 |
| Typed turns, "Why?", "Explain this" | the person | uncapped by the app; the provider's `limit_reached` is the stop, cached 300 s | DESIGN-CHAT, CHAT-UI section 6 |
| Everything else: chips, cards, rows, the plan walk, rechecks, the closer watch, reminders, the write-up, what-if, the bars, the words, the coverage screen, every motion | | zero | all five |

App-started ceiling per day with L landings (launches plus "Check again"): 24 + 3L + 1. A quiet day with one launch and a cached brief: 1 or 2. Person-started turns are added on top and are the person's own.

## 6. Open questions for the owner, with the default each build takes

- **CHAT-UI.** (1) A visible lower-case state word on activity rows, default yes. (2) The opening's live card when nothing is critical, default the batch card else the first step. (3) The time divider at ten minutes. (4) Chips in the foot, not under the last message.
- **PLAYFUL.** (1) The done disc at 0.92 with a fade, now one value in both documents. (2) No second ring on the scanning screen. (3) Keep tap-the-ring. (4) The spiral breath fades down. (5) The watch window's text links do not scale.
- **THREATS.** (1) Three new fishy kinds. (2) Widen `codesign -dvv` to new app bundles and record it in SECURITY-MODEL. (3) Keep the Spotlight probe outside the sweep. (4) Ship all five rules, the since screen naming them. (5) Browser homepage out. (6) Root certificates not now. (7) The unsigned masquerade stand-alone. (8) Persistent library inserts not this round.
- **AGENT.** (1) Build both the clipboard primary and the save-panel link. (2) One counted judge call for "Look into this". (3) An hour from the chat, a day from the recover screen. (4) Activity rows on the guided step frame too. (5) A due reminder puts its step first.
- **DAILY.** (1) The literal word set with the kit icon, not weather. (2) No paragraph on an empty day. (3) The plan line under the body, not a control. (4) A day the watch did not run ends the streak.
- **Decided in this pass, open to the owner.** "Your week" takes the opening's fourth chip slot in place of "Write this up" once the history has two days; the "Back" on the week and coverage screens is a text link, not an icon.

## 7. What only a real Mac can verify

- **Chat and motion.** The password dialog's timing against the "your password" row on a fast batch; Claude's time to first word and the 8 s "Still waiting" line; VoiceOver's reading of the status element during a batch and of the activity list; the spiral breath's CPU cost over a long Claude turn; WKWebView flipping `prefers-reduced-motion` live; the tick's `stroke-dashoffset` under the 0.001 ms rule; `transform-box: fill-box` on the bars in WebKit; a `watch:open` draft arriving before the launch check-up lands.
- **Agent.** The investigation round end to end on a signed build (the socket probes are unreadable on `pnpm desktop`); the judge's `probes[].reason` drop rate under `safe_sentence`; `rfd`'s save panel under `Accessory` activation when the main window was opened from the tray; the one-hour closer watch across a sleep; the time from tap to first probe row on a cold sweep.
- **Threats.** `codesign -dvv` on a revoked certificate; `mdfind` with Spotlight off; whether macOS 27 honours `LoginHook`; the AEServer row after toggling Remote Apple Events; the `com.apple.nat` read when the file exists; the AirDrop pane URL on macOS 26 and 27; which probes read `unavailable` on the dev build; the two `launchctl` steps for 033 through the admin route; the sweep's timing with 100 apps.
- **Daily.** `daily.json` growing a row a day with the window closed; the 25-hour day on 2026-10-25 counting once; the streak reaching 7; the local date Rust writes matching the webview's; the real daily paragraph's drop rate under the numbers rule; whether the queued daily call ever answers `busy` on Claude Code.

## 8. Contradictions fixed on 2026-10-17

- Activity timeline ownership was circular (CHAT-UI pointed at AGENT, AGENT at CHAT-UI, with different kinds and labels). AGENT now defines `ActivityEvent`, `ActivityKind`, `reduceActivity`, `rowsFor`, `activityLabel` in `packages/core/src/activity/` and the fix-row labels (`ACTIVITY.rows`, `ACTIVITY.verbs`); CHAT-UI keeps the row DOM, icons and `CHAT.word`. AGENT's `rereading` row, `activity_*` chat events and `CHAT.activity.password|fixing|rereading` strings are gone.
- The state words `same`, `changed`, `still off`, `now on` were AGENT copy keys beside CHAT-UI's `CHAT.word.couldNotCheck`; they are now `CHAT.word.*` only.
- The done disc (CHAT-UI 0.96, PLAYFUL 0.92 with a fade) and the breath selector (CHAT-UI on the band, PLAYFUL on the svg): CHAT-UI follows PLAYFUL; the chat's card fade is `--motion-base`, not 150 ms; PLAYFUL's stale "1.6x" and `chat-breathe` notes and CHAT-UI's wrong open-question number were corrected.
- PLAYFUL described a weather word set, "{n} calm days in a row.", `WatchState.calm_streak_days` and a tappable reading row above the title; DAILY's literal words, "Day {n} of nothing changed.", `DayDocument.calmStreak` and the non-control line under the body hold. DAILY's stale references to PLAYFUL "3.11", `READING`, `guided/reading.ts` and a `LATER_MS` transition were replaced by PLAYFUL 3.10's `bar-grow` over `--motion-settle`.
- The reading in the chat: CHAT-UI had it as its own message with `label: "reading"`; DAILY has it as the opening's first line. CHAT-UI now carries `reading: DailyReading | null` on the opening message, and `DailyReading` gained `kind: DailyWord`.
- The opening chip row would have held five chips (AGENT's "Write this up" plus DAILY's "Your week"); AGENT's 2j table now gives "Your week" the slot when the history has two days.
- AGENT cited the three-call cap per landed plan as unchanged while DAILY makes it four; AGENT now says four with DAILY. AGENT's intents file path, guard sentence, `MODEL_PROBE_IDS` count and Rust-only probe list follow CHAT-UI and THREATS. CHAT-UI's `ChatCard.kind` gained `write_up` and `cardKindFor` maps AGENT's five intents.
- DAILY and THREATS used an icon-only Back in the strip against CHAT-UI's "no icon-only control"; both now use the `strip` prop's text link. THREATS claimed DAILY adds an end-screen row; it does not. DAILY's fog fixture is `PROBE_IDS.length`, not 21. DAILY's tests named a `WATCH.streak` it never adds. CHAT-UI's shell test is PLAYFUL's `GuidedShell.test.tsx`.
