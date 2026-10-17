# Talos Labs chat UI design: a conversation a person would recognise

DESIGN-CHAT made the chat the home once an AI is connected and fixed what the model may say and point at. It described the conversation in one section and left the surface to the build. The surface today is `apps/desktop/src/screens/Ask.tsx`: one text field, an "Ask" button, one paper card per exchange, no activity, no chips, no scroll handling, and the owner's verdict on it is "bad". This document designs the conversation surface itself: the transcript, its message kinds, the rows that show what the app is doing on the person's behalf, the cards, the chips, the composer, the streaming, the scrolling, the keyboard, the states, the component tree, the state machine, and what each provider adapter streams. It is the thing an implementer builds for TASKS #20, with DESIGN-CHAT as the rules underneath.

This document extends `docs/DESIGN-CHAT.md` (sections 2, 3, 7 and 8) and `docs/DESIGN-AI-PRESENCE.md` (section 5, the model block), on `docs/DESIGN-MINERAL.md` and `docs/DESIGN-WARMTH.md`. DESIGN-CHAT's intent set (`INTENT_KINDS`), validator (`validateChat`), allow-lists (`buildAllowed`), accept grammar, chip table, lock card rule and call budget hold unchanged; where this document changes one of its decisions it says so in the list below, as DESIGN-CHAT did for DESIGN-AI-PRESENCE. `docs/SECURITY-MODEL.md` gains nothing beyond what DESIGN-CHAT already lists under "Docs touched": every new element here is authored text, a catalogue headline, a count from `FixProgress` or a `WatchState` boolean. The model receives nothing new. It never runs anything. Nothing runs from a stream. Every Mac change is a catalogue entry behind the card's one tap, admin ones through macOS's own dialog. Model text is text nodes with the provider's badge and "Not verified", never a button, a headline, a row label or a chip. The app is complete with AI off: without a connected AI there is no chat and the v0.3 walk-through is the home. British English, no em-dashes, the banned-word list of `apps/desktop/src/guided/copy.test.ts`. Facts about the tree were checked on 2026-10-17 against the files named; `apps/desktop/src-tauri/src/watch/cycle.rs` and `App.tsx` are modified in the working tree; the lines cited from them (`cycle.rs:1115-1125`, `App.tsx:345-347`) are the working-tree lines as read today.

The owner's words, verbatim (2026-10-17): "Keep iterating on the talos UI -- the chat is bad, we need a better chat interface that you would have on a real modern agent driven app -- we need more playful interactions -- we need more of the threat detection strategies in place -- adding more agentic capabilities -- add threat detection strategies and interpretation of daily checks". Only the first two bullets are designed here; the rest are DESIGN-PLAYFUL, DESIGN-THREATS-V2, DESIGN-AGENT and DESIGN-DAILY (TASKS #21 to #24). The owner's standing tests from earlier rounds apply to every mock-up: is it obvious what to click, is there a sense of urgency, and not "too much clicking".

Decisions taken where the brief left room:

- **A fifth message kind, the activity row, and it is DESIGN-AGENT's timeline drawn here.** DESIGN-CHAT section 3 lists four kinds (app, person, model, card). Modern agent apps show a line per step the agent takes, with a spinner that becomes a tick. Talos is honest about this only for things the app itself does, so the row is driven by the app's own events and never by the model. The one source is DESIGN-AGENT section 4: `ActivityEvent`, `reduceActivity` and `rowsFor(activity, cardId)` in core, fed by `apps/desktop/src/activity/useActivity.ts` from the scan machine's `fix_progress` action (`apps/desktop/src/scan/useFix.ts:94`, `scan/machine.ts:59-84`), the recheck and `WatchState.checking`. This document owns the row's DOM, its state word and its icons, and one rule DESIGN-AGENT's mock-ups miss: a row exists only for a phase Rust reports. `apply_batch` (`apps/desktop/src-tauri/src/fix/batch.rs:353`) emits one `WaitingForPassword` for the whole admin block and `Running { item }` only for user-level items (`batch.rs:376-380`); a single admin fix (`fix/run.rs:258`) emits `WaitingForPassword` once and nothing until the outcome; `runBatch.ts:24` records that Rust cannot tell the dialog from the admin script. So admin work is one row that resolves with the outcome, never a password row that ticks before a fixing row. The model's "thinking" is not an activity: its turn shows a caret and a badge, nothing else.
- **The core chat code lives in `packages/core/src/chat/`.** DESIGN-CHAT section 7 named `src/explainer/chat.ts` and `src/guided/allowed.ts`. This document gathers the chat's pure logic in one folder (`intents.ts`, `input.ts`, `allowed.ts`, `transcript.ts`), re-exported from `packages/core/src/index.ts`. The schema, the validator and the prose check stay in `src/explainer/` beside their siblings, as DESIGN-CHAT placed them. The activity timeline is DESIGN-AGENT's `packages/core/src/activity/`.
- **The composer's guard line avoids a near-banned word.** DESIGN-CHAT's "I can't read paths or commands." contains "commands"; the copy test is whole-word on "command" and would pass, but the line is reworded to "I can't read file paths or typed instructions. Say it in words and I'll answer." so no reviewer has to think about it.
- **Send is lucide `ArrowUp`, not a kit glyph.** DESIGN-CHAT wrote "ArrowUp from the kit"; the kit has `arrow-left` and `arrow-up-right` only (`apps/desktop/brand/mineral/icons`). `ICONS.send` is lucide `ArrowUp`, added to `LUCIDE_NAMES` in `apps/desktop/src/app/icons.ts`. Stop stays `ICONS.stop` (lucide `Square`).
- **The spiral breathes only while a request runs, and the breath is DESIGN-PLAYFUL 3.8.** The chat mounts the spiral band with no horizon (the transcript scrolls and the composer is fixed). The breath is DESIGN-PLAYFUL 3.8's rule in `base.css`: `.hero-spiral[data-writing="true"] svg { animation: spiral-breathe var(--motion-breathe) ease-in-out infinite }` with `50% { opacity: 0.5 }` on the svg inside the band (the band keeps `hero-drift` on its own `animation` property), `animation: none` under reduced motion; it fades down, never up, because DESIGN-WARMTH 4a measured 0.10 light as the contrast limit over the column's edge. `GuidedShell.tsx:56` renders `<Hero kind="spiral" />` itself from the `GuidedHero` context and `Hero` (`components/Hero.tsx:33`) takes no data attribute, so `GuidedHero` gains `writing: boolean`, `useGuidedHero(spiral, horizon, writing = false)` passes it, the shell ORs it with the explain slot's `running` as DESIGN-PLAYFUL 3.8 does, and `Hero` gains `writing?: boolean` rendered as `data-writing` on the spiral only. `useChat`'s busy flag is the chat's input. It runs only while a model turn, an explain disclosure or a brief is `running` and stops on `ready`, `failed` or Stop; it is never idle motion. DESIGN-PLAYFUL owns the token and the keyframe; nothing is added to the Mineral or Warmth tables here.
- **Time dividers, not hover timestamps.** Agent apps put the time on hover; DESIGN-WATCH-WINDOW's principle "Nothing in the window needs a hover" holds for the audience here too. The transcript draws one `div.chat-divider` with `formatTime(at)` when more than ten minutes passed since the previous message (`DIVIDER_GAP_MS = 600_000`). A transcript lives for one check-up, so there is no day grouping.
- **Turns are grouped as exchanges.** One `section.chat-exchange` holds a person turn and everything that answered it (model block, cards, rows, activity rows, result lines, chips), with `aria-label` "You asked" plus the person's text clipped to 60 characters. App-started messages (the opening, the watch's message, the end message) are exchanges with no person turn and the label "Talos Labs". A screen reader can jump by exchange; a sighted person sees one indent per exchange and nothing else.
- **No copy button, no markdown, no links.** `ModelText` renders text nodes (`apps/desktop/src/components/ModelText.tsx`); SECURITY-MODEL.md:161 excludes a copy button on model text. App result lines carry no copy button either: the "explain to my son" export is DESIGN-AGENT's.
- **The counter appears at 60 characters left.** The field holds `CHAT_LIMITS.maxQuestionChars` (500). `Ask.tsx` shows a counter at 100 of 2000; at 500 that is too early. `CHAT_NEAR_LIMIT = 60`, shown as "60 left" under the field and announced once through the status element.
- **An error row is a message, and it carries exactly one way out.** Limit reached, signed out and didn't answer each render as an app line under the person's turn with one chip or one link, and the same reason sits in the composer's state line (DESIGN-CHAT "The composer"). The person's turn is never removed. A "Try again" or "Send again" chip resends the same text; nothing is retried on its own.
- **The strip keeps three text links, no gear.** DESIGN-CHAT wrote "Step by step, Details, gear". `GuidedShell.tsx:44-48` draws "Details" and "Settings" as `button.guided-strip-link` today and `.guided-strip` spans the window (`styles/guided.css:33-54`, actions at `margin-left: auto`), so there is room. DESIGN-WATCH-WINDOW decided "No icon-only control" for this audience, and a gear would be the first on a guided screen. The chat strip is "Step by step" · "Details" · "Settings".
- **Reduced motion means stepped text, no caret blink, no breathing, no fades, and the same layout.** The global rule in `apps/desktop/src/styles/base.css:201-207` already zeroes animations; the chat's partials are then applied at most every 400 ms (`CHAT_REDUCED_PARTIAL_MS`) so the text grows in readable steps rather than word by word.

## 1. Principles

- **It reads as a conversation, top to bottom, with the newest thing at the bottom and the one thing to tap nearest the composer.** Exchanges are grouped, the person's turns sit right, the app and the model sit left, and the live card is the last block above the chips. Nothing moves once drawn: text streams into its own block, cards land under the text, result lines append under their card.
- **What the app is doing is visible as it happens, in words, with a tick when it is done.** Every fix, batch, user-level batch item, recheck, watcher and watch check is a row with a running, done or failed state carried by its text and its icon, never by colour alone. The rows are the app's own events, only for phases Rust reports; the model has no row.
- **The model is a voice, not an actor.** A model turn is a rule-left block with a caret, a badge from the first partial, and cards under it only after the whole validated reply. The model never has an activity row, a spinner of its own, a progress bar or a "thinking" line beyond the caret.
- **One primary in the transcript while a card is idle, none while it works.** DESIGN-CHAT's rule. Send is an icon button. Chips are chips. Rows are rows. The strip has three text links.
- **Obvious what to click, and urgent when it should be.** The opening always has a live card under its body, so the home has a primary: the urgent item's card when any undone step is critical, else the batch card, else the first step's card. A critical step also draws `p.guided-urgent` with `PLAN.urgent` "One of these is urgent." and lucide `OctagonAlert` (`SEVERITY_ICONS.critical`) between the headline and the body, as `PlanScreen.tsx:21-27` does today. The live card is paper on sand with a 3 px severity cue for critical and high; the primary is the one gradient; the watch's act-now message lands with the same icon and the word "Act now" in its headline, never red alone.
- **Playful within the Mineral table.** The done tick draws (240 ms), the done disc arrives from 0.92 with an opacity fade over `--motion-fast` (DESIGN-PLAYFUL 3.4), cards fade in at `--motion-base`, the spiral breathes while the AI writes, chip taps echo as the person's bubble so the log answers back. No confetti, no sound, no bounce, nothing idle.
- **Keyboard first, focus predictable, one live region.** Enter sends, Shift+Enter adds a line, Escape stops or moves focus and never clears. One `role="status"` outside the transcript carries every announcement. The transcript is a `region`, not a `log`, because `role="log"` carries an implicit `aria-live="polite"` and would read every line twice; nothing inside it is live, and a streaming block is `aria-live="off"`.
- **Honest and quiet.** A refusal is one authored line with one way out. The composer says why it is disabled. The 8 s "Still waiting" line is true when shown. The free version is never pitched by the surface: the lock card is DESIGN-CHAT's one card per check-up.

## 2. The conversation, state by state

### Anatomy

The guided shell (`apps/desktop/src/guided/GuidedShell.tsx`): the 52 px `.title-strip.guided-strip` with `Brand size=24`, then the strip's actions; one 560 px column at 72 px top padding. The chat screen (`ChatScreen.tsx`) fills the column with three stacked regions:

1. `div.chat[role="region"][aria-label="Conversation"]`, flex 1, `overflow-y: auto`, 16 px bottom padding; the exchanges in order. DESIGN-CHAT set `role="log"` with `aria-live="polite"`; `log` has an implicit `polite` even with the attribute absent, so the transcript is a `region` and every announcement goes through the status element, once. Each new app line, result line and card is announced once through `ChatStatus`.
2. `div.chat-foot`, sticky at the bottom of the column, sand with no grain: the "New messages" pill (absolute, above the foot, hidden by default), `div.chat-chips` (one wrapping row, `button.chat-chip`), `form.chat-composer`.
3. `div.chat-status[role="status"].visually-hidden`, outside the log, rendered once by `ChatStatus.tsx`.

The spiral band is mounted top-right as on the end screen (`Hero kind="spiral"`, `base.css:272-294`), at `--hero-spiral-opacity`, with `data-writing="true"` from the shell's `writing` flag while a request runs. No horizon. Mineral tokens throughout: sand canvas with the gradient and grain from `base.css` (`.content::before`, `.content::after`), paper cards `--bg-elevated` with the 1 px `--border`, radius 12, no shadow; type `--text-guided-body` for app and model text, `--text-guided-list` for headlines and rows, `--text-guided-meta` for badges, chips, dividers and the counter; rust `--gradient-accent` only on the one primary and the done disc.

Message kinds, each a distinct DOM shape:

| kind | DOM | look |
|---|---|---|
| app | `div.chat-app` | left, no bubble, `--fg`, first person, may hold `p.guided-urgent`, `h2.chat-headline` (`--text-guided-list` 600, `tabIndex=-1`), a `GuidedList`, rows, a card |
| person | `div.chat-person` | right, `--bg-inset` bubble, radius 12, max-width 80 %, text nodes; a chip's echo looks the same |
| model | `div.guided-model` | left, 2 px `--border` rule on the left, 12 px inset, `ModelText` (`caret` while streaming), `p.chat-badge` under it with `aiBadge(provider)` from the first partial |
| activity | `ul.chat-activity[role="list"]` of `li.chat-activity-row[data-state][data-activity]` | inside the card, under its body, 28 px rows: a 20 px icon slot, the label at `--text-guided-list`, a trailing state word at `--text-guided-meta` in `--fg-secondary` (DESIGN-AGENT's DOM) |
| card | `div.chat-card[data-kind]` | paper, hairline, radius 12, 16 px 20 px padding, the 3 px cue bar (`--sev-cue-critical` or `--sev-cue-high`, inset 10 px top and bottom, as `.guided-next-card`), headline, body, one `button.button.button-primary.chat-card-primary` at 44 px and 220 to 320 px wide, at most one `button.guided-link`, the `ExplainPanel` disclosure where DESIGN-CHAT gives one |
| row | `button.guided-end-row` | 44 px, kit icon, headline, trailing chevron (`guided.css:524-575`) |
| divider | `div.chat-divider` | centred `formatTime(at)` at `--text-guided-meta` between two hairlines |
| notice | `p.chat-notice` | left, `--fg`, one authored sentence, followed by one chip row or one `guided-link` |

### The opening (first launch after connecting, licensed, ChatGPT, dev machine)

> ○ Talos Labs
> **I found 7 things to fix.**
> ⛔ One of these is urgent.
> I can fix 4 of them for you now. The other 3 I'll show you where.
> ┃ Your Mac goes out with you and its disk is not locked, so a lost bag means lost photos and open accounts. The firewall is the quick one and the app puts it first.
> ┃ Written by ChatGPT. Not verified.
>
> ▍ **Your disk is not locked**
> If your Mac is lost or stolen, anyone can read your files.
> [Show me where]
> I'll do it later
> ▸ Explain this
>
> [Do them all] [Fix what you can] [Show me the list]
> ┌──────────────────────────────────────────────────────────────┐
> │ Ask me, or tell me what to do.                             ↑ │
> └──────────────────────────────────────────────────────────────┘

The first line is the exchange's visually hidden label; the headline and body are `planText(plan)` from `apps/desktop/src/guided/plan.ts`; the model block is DESIGN-CHAT's cached brief and is absent until the `checkup` task exists. The opening always carries one live card under the model block (or under the body when there is no brief), so the home has a primary: when any undone step is critical, `p.guided-urgent` draws between the headline and the body and the urgent item's card is live, exactly what the "What is urgent?" chip would draw, zero calls, and that chip is left out; otherwise the batch card is live and the chips are DESIGN-CHAT's four. Focus is on the headline. With a diff, the "Since last time." meta line and the Since rows precede the headline in the same app message. When DESIGN-DAILY's reading exists, its `line` size (`p.guided-daily`: "Today: ◎ Calm. Day 3 of nothing changed.") is the first line of this same app message, above the Since rows and the headline, as DESIGN-DAILY section 3 specifies; the chip "Your week" takes the fourth slot of the opening row when the history holds two or more days (DESIGN-AGENT section 2j, `chips.ts`). With nothing to fix: "Nothing needs fixing." (`END.nothing`), no card, and the chips "Show me the list" and "Check again". After a relaunch for Full Disk Access (`talos.continue`), the first undone step's card is appended under the opening (`step_appended`); when that step is `permission`, the card is the `permission` kind with `PERMISSION.title` and the primary `PERMISSION.button`.

### "Fix what you can": activity rows and a card

The chip echoes as the person's bubble, then the batch card lands with the `--motion-base` fade (200 ms, DESIGN-PLAYFUL's arrival), no call:

> **Fix what you can**                                        (right, bubble)
>
> ▍ **I can fix 3 things for you now.**
> Your Mac will ask for your password once. That is macOS asking, not me, and I never see it.
> • The firewall is off
> • Your Mac answers strangers on the network
> • App Store apps do not update on their own
> [Fix these for me]
> Do these later
> ▸ Explain this
>
> A shared folder has no password ›

Tap "Fix these for me". The card's primary and link are removed, the card keeps its headline and list, and the activity list `rowsFor(activity, cardId)` draws under the list, one row per `ActivityEvent`, oldest first. The three items here are all admin (002, 008 and 011; of the batchable rules only 013 and 030 are user-level, `fix/catalog.rs:333` and `:468`), so the admin block is one row:

> ✓ Getting ready                                            done
> ○ Fixing 3 things                                          your password
> · Checking it worked

The row labels are DESIGN-AGENT's (`ACTIVITY.rows`): "Getting ready" on `fix_preview_batch` sent; `rows.batchAdmin(n)` "Fixing {n} things" on `fix_progress` `waiting_for_password`, and it stays `running` with the state word `CHAT.word.password` "your password" until `applyBatch` resolves, because no event marks the dialog closing (`runBatch.ts:24`); then one verb row per user-level item when `fixing.item` is non-null (`ACTIVITY.verbs` participle of `guidedFor(ruleId).verb`, "Turning it on"), with the word "{step} of {of}" meaning the steps of that item; then "Checking it worked" on `rechecking`. Per-item ticks for admin items come from `BatchOutcome.items[].status` after the batch, drawn as DESIGN-CHAT's `DoneRow` result lines ("Done. 3 things fixed."), not as activity rows; then the 022 row becomes the live card and the chips read "What's next? · Show me the list · Check again". A single admin fix shows "Getting ready", then the verb row with the word "your password" resolved by `FixOutcome`, then "Checking it worked"; a single user-level fix shows the verb row per `Running` step with "{step} of {of}". A show card shows one row "Watching for the change" (`CHAT.activity.watching`) with the state word "watching", then "done" on pass or "no change yet" on stale (`SHOW.staleTitle` stays the card's line). A watch "Check now" from the `open_watch` card shows "Checking your Mac" (`CHAT.activity.watchCheck`) and resolves on the next `watch:state` event whichever way `checking` reads, because `run_once` returns with no event when the watch is inactive or the cycle lock is held (`cycle.rs:1115-1125`); a 20 s fallback (`CHAT_WATCH_CHECK_MS`) marks it "couldn't check". A failed row reads its state word from `activityWord(event)` over `status` and `outcome` (`FixError | RecheckResult | ProbeOutcomeWord`): "did not change" (`END.didNotChange`, lower-cased) for `command_failed`, "stopped" for `cancelled` and `wrong_password`, "couldn't check" for `unreadable`, "not changed yet" for `still_failing`; the card then shows `failureCopy(...)` as DESIGN-CHAT's result table says. At most one row is `running` at a time on every card.

Icons: a running row whose word is "your password" shows the kit `KeyIcon` (`ICONS.password`), static, in `--fg-secondary`, because DESIGN-PLAYFUL forbids motion while macOS's dialog is up; every other running row is `ICONS.spinner` with the existing `spin` keyframe (`components.css:560-565`), static under reduced motion; done is the kit `CheckIcon` at 20 px in `--fg-secondary`, drawn with the 240 ms `guided-tick` stroke animation (`guided.css:194-201`); failed is the kit `CloseIcon` in `--sev-critical-fg`. The state word is always present so colour and the icon never carry the state alone.

### A model turn

Typed "Why does the disk matter?", Enter. The bubble appears at once; the model block appears at once with the caret alone and the badge; the status element says "Writing".

> **Why does the disk matter?**                              (right)
>
> ┃ ▎
> ┃ Written by ChatGPT. Not verified.

After the first partial the text grows word by word with the caret at the end (`ModelText caret`, the blink in `components.css:1463-1482`). After 8 s with no partial, one line under the block, `CHAT.stillWaiting[waitingKey(provider)]`: "Still waiting for ChatGPT." / "Still waiting for Claude." / "Still working on this Mac." (`waitingKey` maps `ExplainerProvider`, `apps/desktop/src/settings/index.ts:12`, to `chatgpt | claude_plan | apple`: `claude` to `claude_plan`, `ollama` to `apple`). It is removed on the next partial. When the stream completes and `validateChat` passes, the cards and rows land under the badge with the `--motion-base` fade, and the chips update. The composer shows Stop in the Send slot throughout and returns focus to the field on completion.

### A limit-reached turn

The person sends "why does the backup matter?" and ChatGPT answers 429, or fails mid-stream with `subscription_sharing_usage_limit_exceeded`:

> **why does the backup matter?**                            (right)
> Your ChatGPT allowance is used up for now. It comes back on its own.
>
> [What's next?] [Show me the list] [Check again]
> ┌──────────────────────────────────────────────────────────────┐
> │ Your ChatGPT allowance is used up for now. It comes back on   │
> │ its own.                                                       │
> └──────────────────────────────────────────────────────────────┘

The partial text and its block are removed; the person's turn stays as typed, with no meta line (the provider failed, the person stopped nothing; "Stopped." is drawn only by the `stopped` event). `EXPLAIN.limit`, `signedOut` and `didNotAnswer` (`copy.ts:175-180`) are keyed `chatgpt | claude_plan` only, so every lookup goes through `remoteOf(provider)` as `ExplainPanel.tsx:24` does (`claude` to `claude_plan`, everything else to `chatgpt`). The notice is `EXPLAIN.limit[remote]` plus `EXPLAIN.limitBack`, or `EXPLAIN.limitBackAtPrefix` plus `formatTime(until)` when Claude gave a reset time. The composer's field is replaced by the same sentence in `p.chat-composer-state`; the chips keep working; every card keeps working. When `useAiAvailability` settles `available` again, the field returns silently and the chip "Send again" appears under the turn. Signed out (`needs_sign_in`, `auth`, `no_api_key`, `not_configured`): the notice is `EXPLAIN.signedOut[remote]` with one `guided-link` "Sign in again" (Connect, `returnTo: { name: "chat" }`); the composer state line is the same sentence with the same link. Didn't answer (`provider_unavailable`, `timeout`, `network`, `unavailable`, `busy`): `EXPLAIN.didNotAnswer[remote]` with the chip "Try again", and the composer stays usable; on this Mac the notice is `AI_UNAVAILABLE_COPY.helper_unavailable` instead, since `didNotAnswer` has no `apple` key. Too long (`too_long`, Apple's second context overflow): `CHAT.tooLong` "That was too much for this Mac in one go. Ask a shorter question.", the field usable. Rejected output, `refused`, `unknown`: `CHAT.couldNotUse` "I couldn't use that answer. Try asking another way." with no chip, the field usable, focus in it. `cancelled` from an adapter behaves as Stop.

### The watch's act-now entering the chat

While the chat is on screen and `WatchState.rating` becomes `act_now` with items (the `watch:state` event through `useWatchStatus`, `apps/desktop/src/watch/useWatch.ts:8`), or `watch:open` arrives with `screen: "noticed"` and items exist, the chat appends an app exchange and scrolls to it:

> ──────────────── 14:32 ────────────────
> ⛔ **Act now: a new program started running on its own**
> I noticed this at 14:32. It was not there at the last check. I have not deleted anything.
> ▍ Experts would cut it off first. CISA's ransomware checklist, step 1.
> [See what to do]
> This is fine, I know it

The divider appears because more than ten minutes passed. The headline is `CHAT.actHeadline` "Act now: {headline}" with `FISHY.noticed.headline[kind]` lower-cased at its first letter, with lucide `OctagonAlert` (`SEVERITY_ICONS.critical`) in `--sev-critical-fg` leading, so the word carries the urgency; the body is `FISHY.noticed.body` with `formatTime(at)` where `at` is `item.changedAt ?? state.lastCheckAt` (`WatchItem.changedAt` is `string | null`, `watch-port.ts:316`); when both are null the body is `CHAT.noticedNoTime` "It was not there at the last check. I have not deleted anything."; the source line is `WATCH.sourceAct`. The exchange is appended only when `WatchState.licensed` is true and `items.length > 0`, and never while the route is `fishy`, the guards `App.tsx:345-347` applies. The card's primary calls `fishy.open({ name: "chat" }, "noticed")`; `useFishy` adds the gate stage itself when the item is gated (`guided/fishy/useFishy.ts:49`). The link calls `watch.acknowledge(signalId)` and appends "OK.". On return from the flow the chat appends `FISHY.recover.body` when the recover screen ran. This card is the live card; any other idle card becomes a row. No call is made. The status element announces the headline. `keep_an_eye` adds nothing, as DESIGN-WATCH says.

### The free version's lock card

Unlicensed, ChatGPT connected, after the free 002 card resolved, `paywallSnoozedUntil` absent or past, once per check-up:

> ✓ Done. The firewall is on.
>
> ▍ **There are 3 more things I could fix.**
> They are in the full version. The full version does them all and keeps an eye on your Mac from the menu bar.
> • Your Mac answers strangers on the network
> • App Store apps do not update on their own
> • A shared folder has no password
> [Buy the full version, €24 a year]
> ┌──────────────────────────────┐
> │ Paste your licence key       │
> └──────────────────────────────┘
> Not now
>
> [What's next?] [Show me the list] [Check again]

"Not now" writes `paywallSnoozedUntil` (14 days) and collapses the card to "OK." with the `--motion-base` fade. A pasted key runs `licenceAccepted` and appends `PAYWALL.thanks` then the newly planned card. Elsewhere the free person sees only the meta line "3 more in the full version." where a locked card would have been. The composer is present and free.

### Chips

As DESIGN-CHAT's table: `button.chat-chip`, at most four, at most 25 characters, authored in `apps/desktop/src/chat/chips.ts`. Look: `--bg-elevated`, 1 px `--border`, radius 7, 32 px tall, `--text-guided-meta` in `--fg`; hover `--bg-inset`; pressed `--bg-pressed`; the global focus ring. A tapped chip echoes as a person bubble, then the chip row re-renders for the new state. Chips never scroll with the log; they sit in the foot.

### The composer

`form.chat-composer`: a `textarea` (one row, grows to four, `rows=1`, `maxLength=500`, `aria-label` "Message", placeholder `CHAT.placeholder` "Ask me, or tell me what to do."), 44 px minimum, `--bg-elevated`, hairline, radius 7, the rust focus ring; a 44 px `button.icon-button.chat-send` with `ICONS.send` and `aria-label` "Send", disabled while the trimmed draft is empty; while a turn streams the same slot holds `ICONS.stop` with `aria-label` "Stop" and the field is `readOnly`. Under the field, when fewer than 60 characters remain, `span.chat-count` "N left" (`CHAT.left` "{n} left"), read with the field through `aria-describedby`, and announced once by the status element with the same text. Disabled states replace the field with `p.chat-composer-state` holding the reason sentence and its one link, and keep Send hidden. In Developer mode a meta line under the form reads `CHAT.calls` "Calls this check-up: {n}". A draft can arrive from the watch window (DESIGN-WATCH-WINDOW, "The question is a draft, not a send"): `watch:open { screen: "chat", question }` fires `draft_received`, which sets the field to the text and focuses it; it is sent at once only when the text equals `WATCH.askWhy(headline)` built from the main window's own top watch item, one character off is a draft. With no report yet the draft is held until the launch check-up lands, as DESIGN-WATCH-WINDOW specifies.

### Scrolling and the pill

`useStickToBottom(logRef)` in `apps/desktop/src/chat/scroll.ts`: the log scrolls to the bottom on every appended message while the person is within 48 px of the bottom; once they scroll up, new messages do not move the view and `button.chat-new-pill` "New messages ↓" (`CHAT.newMessages`, the arrow in an `aria-hidden` span) appears centred above the foot; tap scrolls to the bottom and hides it; reaching the bottom by hand hides it too. A streaming block never scrolls the view on its own partials; only a new message does. Focus never moves on scroll. One exception: a `watch_noticed` exchange always scrolls the log to the bottom and moves focus to its headline, whatever the scroll position, because it is the one urgent message; the draft in the field is kept and the pill is not shown. Under reduced motion the scroll is instant (`behavior: "auto"`).

### Keyboard and focus order

DOM order: the strip's "Step by step", "Details", "Settings"; then the log's controls top to bottom (rows, card primaries, links, disclosures, chips inside notices); then the chips; the field; Send or Stop. Enter sends; Shift+Enter inserts a newline; Escape while streaming stops; Escape with nothing running and focus in the field moves focus to the newest card's headline (`tabIndex=-1`) or, with no card, the newest app headline; Escape never clears the draft. Cmd+L focuses the field through a window keydown handler in `ChatScreen.tsx` unless another text field has focus. After a chip or a resolved card, focus moves to the newest headline, as `StepFrame` does (`StepFrame.tsx`, `heading.current?.focus()`); after the person's own typed send and after Stop, focus returns to the field. Tab inside the `textarea` is a tab stop, not an inserted character.

### The strip

`GuidedShell` gains `strip?: { links: readonly { label: string; onClick(): void }[] }`, drawn as `button.guided-strip-link` before the "Details" and "Settings" links it renders today (`GuidedShell.tsx:44-48`). The chat passes one link, "Step by step" (`CHAT.stepByStep`), which enters the v0.3 flow at the first undone step; "Details" opens the Overview; "Settings" opens Settings. No icon-only control. The walk-through's strip shows "Chat" (`CHAT.chat`) in place of "Step by step" when the chat is the home, as DESIGN-CHAT says.

### Light and dark, and the 900x600 fold

Every colour is a token with a dark value in `tokens.css` (the dark block at line 213 onwards); the person bubble is `--bg-inset` in both; the cue bars use `--sev-cue-*` dark values; the spiral uses `--hero-spiral-stroke` and its dark opacity 0.12. At 900x600 the strip takes 52 px, the foot about 112 px (chips 32, gap 8, field 44, padding), leaving about 436 px of log; a fix card is about 230 px tall with the disclosure closed, so the newest card's primary is above the fold when the log is at the bottom, which `useStickToBottom` guarantees after every append. The harness asserts it (section 7).

### Empty state

There is none: the opening is always drawn. No report, AI off, not connected, or On this Mac unable to run: no chat, the v0.3 screens (DESIGN-CHAT section 2).

## 3. The component tree (`apps/desktop/src/chat/`)

```
ChatScreen.tsx          the route screen: GuidedShell(strip), useGuidedHero(true, false, busy), useChat(), Cmd+L handler
├─ ChatTranscript.tsx   div.chat[role="region"]; maps state.messages into exchanges; useStickToBottom; dividers
│  ├─ ChatExchange.tsx  section.chat-exchange[aria-label]; one person turn plus what answered it
│  │  ├─ ChatPerson.tsx     div.chat-person (text nodes)
│  │  ├─ ChatApp.tsx        div.chat-app: headline, body, GuidedList, "since" rows
│  │  ├─ ChatModel.tsx      div.guided-model: ModelText(caret), p.chat-badge, the still-waiting line
│  │  ├─ ChatCard.tsx       div.chat-card[data-kind]: headline, cue, body, primary, link, ExplainPanel, PassphraseForm (029), folder name (022), licence field (lock), ChatActivity
│  │  │  └─ ChatActivity.tsx  ul.chat-activity[role="list"] of li.chat-activity-row from rowsFor(activity, cardId): icon slot, label, state word
│  │  ├─ ChatRow.tsx        button.guided-end-row
│  │  └─ ChatNotice.tsx     p.chat-notice plus its one chip row or guided-link
│  ├─ ChatDivider.tsx   div.chat-divider
│  └─ ChatNewPill.tsx   button.chat-new-pill
├─ ChatFoot.tsx         div.chat-foot: ChatChips, ChatComposer, the Developer calls line
│  ├─ ChatChips.tsx     button.chat-chip[]
│  └─ ChatComposer.tsx  form.chat-composer: textarea, send/stop, counter, the disabled state line
└─ ChatStatus.tsx       div.chat-status[role="status"].visually-hidden, outside the log
```

Logic files beside them: `useChat.ts` (the hook: `useReducer(reduce, initial)` over `state.ts`, the `AbortController` ref, the 8 s timer, the watch subscription, the `watch:open` draft, the 20 s watch-check fallback), `controller.ts` (`send`, `chip`, `runCard`, `later`, `accept`, `promote`, `doThemAll`, `stop`, `dismissLock`, `acknowledgeWatch`), `state.ts` (types, events, `reduce`), `activityWord.ts` (`activityWord(event: ActivityEvent): string`, the state word from `status` and `outcome` through `CHAT.word`), `cards.ts` (`cardFor` with the live `buildAllowed` check), `chips.ts` (`chipsFor(state)`), `accept-grammar.ts`, `scroll.ts` (`useStickToBottom`), `copy` under `CHAT` in `apps/desktop/src/guided/copy.ts`, CSS in `apps/desktop/src/styles/chat.css` (the `.ask`, `.chat-turn`, `.chat-exchange`, `.chat-user`, `.chat-assistant`, `.related` and `.ask-*` classes in `screens.css:307-385` and `ai-expert.css:52-70` are deleted with `Ask.tsx`).

## 4. The state machine (`apps/desktop/src/chat/state.ts`)

```ts
type Remote = "chatgpt" | "claude_plan";   // remoteOf(provider), the key into EXPLAIN.limit, signedOut, didNotAnswer
export type ChatMessage =
  | { id; kind: "app"; at; headline: string | null; body: string | null; urgent: boolean; rows: GuidedRow[]; since: ReportDiff | null; reading: DailyReading | null; label: "opening" | "answer" | "end" | "watch" | "result" }
  | { id; kind: "person"; at; text: string; source: "typed" | "chip"; stopped: boolean; resend: boolean }
  | { id; kind: "model"; at; turnId; text: string; provider: ExplainerProvider; streaming: boolean; stillWaiting: boolean; outsideScope: boolean }
  | { id; kind: "card"; at; cardId; card: ChatCard; state: "idle" | "working" | "resolved" | "stale"; live: boolean; result: string | null; rows: DoneRow[] }   // activity rows are read from rowsFor(activity, cardId), not stored here
  | { id; kind: "row"; at; cardId; ruleId: RuleId; headline: string }
  | { id; kind: "notice"; at; text: string; wayOut: { kind: "chip"; label: string; action: ChipId } | { kind: "link"; label: string; route: Route } | null };

export interface ChatState {
  readonly messages: readonly ChatMessage[];
  readonly stream: { kind: "idle" } | { kind: "waiting"; turnId: string; since: number } | { kind: "streaming"; turnId: string; since: number; lastPartialAt: number };
  readonly composer: { kind: "ready" } | { kind: "busy" } | { kind: "limit"; provider: Remote; until: string | null } | { kind: "signed_out"; provider: Remote } | { kind: "did_not_answer"; provider: ExplainerProvider };
  readonly draft: string | null;       // set by draft_received, consumed by the composer once
  readonly live: string | null;        // the card id holding the primary
  readonly working: string | null;     // the card id in flight; at most one
  readonly walking: boolean;           // "Do them all"
  readonly lockShown: boolean;
  readonly calls: number;              // Developer counter: typed turns, "Why?", explain taps
  readonly announce: { readonly text: string; readonly seq: number };
}
```

Activity rows are not chat state: `ChatCard.tsx` reads `rowsFor(activity, cardId)` from DESIGN-AGENT's timeline, fed by `useActivity.ts` from the scan machine, and `activityWord(event)` gives the state word. The chat has no activity events and no bridge; a card running in the chat and a step running in the walk-through are the same machinery, read twice.

Events, with the reducer's effect, in the order they occur in a check-up:

| event | payload | effect |
|---|---|---|
| `opened` | `plan, diff, brief, provider, reading: DailyReading | null` | replaces `messages` with the opening exchange, its `reading` line first when non-null (DESIGN-DAILY's `readingFor`), then its live card (section 2); chips from `chipsFor` |
| `step_appended` | `step` | appends the first undone step's card under the opening as live (the `talos.continue` relaunch) |
| `brief_ready` | `text, provider` | appends the `model` block (`streaming: false`) under the opening's body when the brief lands after `opened` |
| `guard_refused` | `text` | appends a `notice` (`CHAT.guard`) with no way out; the draft stays in the field |
| `draft_received` | `text, autoSend` | `draft = text`, the field takes it and focus; when `autoSend` (the text equals `WATCH.askWhy(headline)` for the top watch item) `person_sent` follows at once |
| `person_sent` | `text, turnId` | appends `person` (`source: "typed"`); `stream = waiting`; `composer = busy`; `calls + 1`; announce "Writing" |
| `chip_pressed` | `chipId, text` | appends `person` (`source: "chip"`); then one of: `app_answered` ("Fix what you can", "What is urgent?", "What should I do first?", "What's next?", "Show me the list", the accept grammar), `cleared` then `opened` ("Check again"), `person_sent` ("Why?", "Try again", "Send again"), `card_started` ("Do them all", with `walking = true`) |
| `app_answered` | `headline, body, rows: GuidedRow[], cards: ChatCard[], label` | appends an `app` message; the first card lands as live and any other idle card demotes to a row; the rest as rows; chips recomputed; announce the headline |
| `model_partial` | `turnId, text` | first partial: appends `model` with `streaming: true`; later ones replace `text`; `stream = streaming`, `lastPartialAt = now`; clears `stillWaiting` |
| `model_still_waiting` | `turnId` | sets `stillWaiting` on the model message (8 s timer in `useChat`); announce `CHAT.stillWaiting[waitingKey(provider)]` |
| `model_ready` | `turnId, result: ChatResult, cards: ChatCard[]` | `streaming: false`; appends the first card as live and the rest as rows; `stream = idle`; `composer = ready`; announce "Done writing" then the first card's headline |
| `model_failed` | `turnId, reason: ExplainerFailure, until` | removes the model message; the person turn keeps `stopped: false` and gains `resend` where a chip resends; appends the notice for `reason` (section 2); exhaustive over `ExplainerFailure` with a `never` check: `limit_reached` → `limit`; `needs_sign_in | auth | no_api_key | not_configured` → `signed_out`; `provider_unavailable | timeout | network | unavailable | busy` → `did_not_answer`; `too_long | rejected_output | refused | unknown` → `ready`; `cancelled` → as `stopped`; every branch sets `stream = idle`; announce the notice |
| `stopped` | `turnId` | removes the model message; the person turn gets `stopped: true, resend: true` and the meta "Stopped."; `stream = idle`; `composer = ready`; announce "Stopped." |
| `card_started` | `cardId` | that card `working`; `live = null`; `working = cardId`; its link hidden |
| `card_result` | `cardId, outcome: ChatOutcome, line, rows` | the card `resolved` with `result = line` and `rows`; `working = null`; the next idle row (if any) is promoted to live; chips recomputed; announce `line`. While `walking`, the next card is promoted to live after `AUTO_ADVANCE_MS` (`guided/timing.ts:3`) and focus moves to its headline; its primary is still the person's tap and nothing runs on promotion |
| `row_promoted` | `rowId` | the row becomes a card `idle`, `live = that card` |
| `card_stale` | `cardId, line` | the card `stale` with `result = line` ("That one is done." / "That one is waiting."); `live` moves on |
| `lock_shown` | `ruleIds` | appends the lock card as live; `lockShown = true` |
| `lock_dismissed` | | collapses the lock card to "OK." |
| `end_reached` | `title, groups, brief` | appends the end exchange; chips "Show me the list · Check again" |
| `watch_noticed` | `item, at: string | null` | appends the watch exchange as live; any idle card demotes to a row; scrolls to it and focuses its headline; announce the headline |
| `watch_returned` | `ran: boolean` | appends `FISHY.recover.body` when `ran` |
| `availability_changed` | `state, until` | `composer` follows the state; on `available` after `limit` or `signed_out`: `ready`, and every `person` turn that failed gains `resend` |
| `counter_near_limit` | `left` | announce "{n} left" once per crossing |
| `cleared` | | `messages = []`; the next `opened` follows (rescan, AI off, Disconnect, the `off` availability) |

`reduce` is pure and tested on every event in every state; an event that does not apply (a `model_partial` for a turn that was stopped, a `card_result` for a card that is not `working`) is ignored, not thrown. `useChat` derives `card_started`, `card_result` and `card_stale` from `scan.fixing` transitions (`FixingState`, `scan/machine.ts:59-84`: `phase`, `error`, `outcome`, `byRule`) and `scan.kind === "rechecking"`, the way `fixLabel` and `batchLabel` read them; `startFix` (`runFix.ts:14`) and `startBatch` (`runBatch.ts:15`) take no listener and none is added.

## 5. Contracts

### Core (`packages/core/src/chat/`)

- `intents.ts`: `INTENT_KINDS`, `IntentKind`, `ChatIntent` (DESIGN-CHAT section 4, unchanged).
- `input.ts`: `ChatInput`, `ChatEvent`, `ChatOutcome`, `ChatResult`, `CHAT_LIMITS` re-exported from `explainer/limits.ts` (DESIGN-CHAT, unchanged).
- `allowed.ts`: `buildAllowed(plan, report, gate, scan, watch, memory)`, `cardsFromRelated(relatedRuleIds, allowed)` (DESIGN-CHAT, moved from `guided/allowed.ts`).
- `transcript.ts`: `ChatCard = { kind: "fix" | "batch" | "show" | "permission" | "accept" | "snooze" | "lock" | "rescan" | "details" | "explain" | "change_ai" | "watch" | "question" | "write_up"; ruleId: RuleId | null; ruleIds: readonly RuleId[]; severity: Severity | null }`; `cardKindFor(intent): ChatCard["kind"] | null`, `null` for `show_list` (rows only) and for DESIGN-AGENT's `investigate`, `close_watch` and `remind_rule` (app messages, not cards), `write_up` to `write_up`, `what_if` to the rule's own step card kind (DESIGN-AGENT section 4); `permission` is drawn from the `permission` guided step, never from an intent; `historyFor(messages)` builds `ChatInput.history` from `person` messages with `source: "typed"` and `model` messages with `streaming: false`, in order, nothing else; `exchangeLabel(person: string | null)` (clips to 60 characters), `DIVIDER_GAP_MS`, `dividerBefore(prev, next)`.
- `activity/`: DESIGN-AGENT's `ActivityEvent`, `reduceActivity`, `rowsFor`, `activityLabel`; nothing is added here.
- `explainer/schemas.ts` `CHAT_JSON_SCHEMA`, `explainer/validate.ts` `validateChat`, `explainer/prose.ts`, `explainer/remote.ts` `chatTurns` and `buildChatInstructions`, `explainer/on-device-prompt.ts` `chat` shape: DESIGN-CHAT section 7, unchanged.
- `ports/explainer-port.ts`: `ExplainerPort` (`explainer-port.ts:180-189`) gains `chat(input: ChatInput, options?: ExplainOptions<ChatResult>)` as DESIGN-CHAT section 7 specifies; `ExplainOptions.onPartial` (`explainer-port.ts:174-178`) keeps its contract: the whole value so far, never a delta. `ExplainerFailure` (`explainer-port.ts:153-168`) is unchanged and the reducer covers all fifteen members.

### Adapters (`apps/desktop/src/adapters`), what each streams

| adapter | `chat` output | partials | first word | Stop |
|---|---|---|---|---|
| `chatgpt-explainer.ts` | `ChatResult` through `CHAT_JSON_SCHEMA`; `plainOutput` fallback uses the `ask` shape and `cardsFromRelated` | SSE, whole-snapshot `reply` through the partial-JSON reader, throttled `CHATGPT_PARTIAL_EVERY_MS` 80 | about 1 s | fetch abort |
| `claude-plan-explainer.ts` | `ChatResult` | `ai:stream` `partial` events (whole value), 80 ms | 3 to 5 s, up to 10 s behind a watch call | `claude_cancel` |
| `claude-explainer.ts` (Developer, API key) | `ChatResult` | none: one `onPartial` with the whole value (`claude-explainer.ts:133`), so the chat shows the caret alone then the whole text at once, no typewriter | 2 to 6 s | abort |
| `ollama-explainer.ts` (Developer) | `ChatResult` | as the API key adapter | varies | abort |
| `apple-explainer.ts` | the `ask` shape (`Answer`: `answer`, `relatedRuleIds`, `outsideScope`) rendered by the `chat` on-device prompt; cards from `cardsFromRelated`; no intents | `ai:stream` field by field; `snapshotHasCommandText`, `containsAppVoice`, `claimsAction` on every partial | 1 to 3 s | `ai_cancel` |
| `demo-explainer.ts` | canned `ChatResult` by `chat_reply`; the Apple demo streams the `ask` shape | `streamFields` at `DEMO_WORD_CHUNK_MS` 40 per word | immediate or `chat_first_partial` | records `aiCancel` |
| `no-explainer.ts` | `{ ok: false, reason: "not_configured" }` (`no-explainer.ts:22-30`); its availability is `off`, which `cleared` handles | | | |

The UI treats every adapter the same: the model block appears at `person_sent`, grows on `model_partial`, and lands cards on `model_ready`. An adapter that never calls `onPartial` before the final value is indistinguishable from reduced motion. Timeouts stay the adapters' own (ChatGPT 90 s whole; Claude Code 60 s to first partial and 180 s whole; Apple 25 s and 90 s); the 8 s "Still waiting" line is the only addition and it is purely visual.

### Rust and Swift

No new command, event or URL. The chat uses `fix_preview`, `fix_apply`, `fix_preview_batch`, `fix_apply_batch`, `fix_reveal`, `open_settings_pane` and the `watch_*` commands as the guided steps do, and listens to the existing `fix:status`, `watch:state`, `watch:open`, `main:shown` and `ai:stream` events. `Task::Chat` and the schema copy are DESIGN-CHAT's. The sidecar is unchanged (`AnswerOut`).

### Desktop

- `App.tsx`: the `chat` route, the watch message routing (section 2) through `onWatchOpen` (`App.tsx:340-350`) with its existing guards, the `watch:open { screen: "chat", question }` draft handed to `useChat` as `draft_received` (held in a ref until the launch check-up lands, as DESIGN-WATCH-WINDOW specifies), `ask` route removed.
- `GuidedShell.tsx`: the `strip` prop; `GuidedHero` gains `writing: boolean` and `useGuidedHero(spiral, horizon, writing = false)`; the shell renders `<Hero kind="spiral" writing={wanted.writing || explainRunning} />`. `components/Hero.tsx`: `writing?: boolean` rendered as `data-writing` on the spiral only (DESIGN-PLAYFUL's prop). `app/icons.ts`: `ICONS.send` (lucide `ArrowUp`), `LUCIDE_NAMES` gains `ArrowUp`; `ICONS.settings` and `ICONS.password` exist (`icons.ts:72`, `:150`).
- `guided/copy.ts` `CHAT` block, every string, all plain templates with `{n}` and `{headline}` placeholders substituted at render with `.replace`, as `WATCH.checkedMinutes` and `FISHY.noticed.body` are, because `copy.test.ts`'s `strings()` skips function values: `placeholder` "Ask me, or tell me what to do."; `send` "Send"; `stop` "Stop"; `writing` "Writing"; `doneWriting` "Done writing"; `stopped` "Stopped."; `sendAgain` "Send again"; `tryAgain` "Try again"; `stillWaiting` { chatgpt: "Still waiting for ChatGPT.", claude_plan: "Still waiting for Claude.", apple: "Still working on this Mac." } keyed by `waitingKey(provider)` (`claude` → `claude_plan`, `ollama` → `apple`); `guard` "I can't read file paths or typed instructions. Say it in words and I'll answer."; `busyExplain` "I'm still explaining the last one. Stop it, or give me a moment."; `couldNotUse` "I couldn't use that answer. Try asking another way."; `tooLong` "That was too much for this Mac in one go. Ask a shorter question."; `outside` "That's outside what the check-up covers."; `left` "{n} left"; `newMessages` "New messages"; `stepByStep` "Step by step"; `chat` "Chat"; `calls` "Calls this check-up: {n}"; `activity` { watching: "Watching for the change", watchCheck: "Checking your Mac" } (the fix rows are DESIGN-AGENT's `ACTIVITY.rows` and `ACTIVITY.verbs`); `word` { password: "your password", running: "{i} of {n}", watching: "watching", done: "done", didNotChange: "did not change", stopped: "stopped", couldNotCheck: "couldn't check", notChangedYet: "not changed yet", noChange: "no change yet", same: "same", changed: "changed", stillOff: "still off", nowOn: "now on" } (the last four are the words of DESIGN-AGENT's `probe` and `section` rows); `ok` "OK."; `exchangeYou` "You asked"; `exchangeApp` "Talos Labs"; `actHeadline` "Act now: {headline}"; `noticedNoTime` "It was not there at the last check. I have not deleted anything."; `moreLocked` "{n} more in the full version."; plus DESIGN-CHAT's chip labels, urgent and first-step leads, accept lines and stale lines. `EXPLAIN` gains `busy` "I'm answering in the chat. Stop it there, or give me a moment." for `ExplainPanel`'s refusal path. Every string is under the banned-word test. The sentences (`guard`, `busyExplain`, `couldNotUse`, `tooLong`, `outside`, `noticedNoTime`, `actHeadline`, `moreLocked`, `EXPLAIN.busy`) go in `copy.test.ts`'s per-string 1.6 syllable list (all score 1.14 to 1.50 on the repo's counter); status and state words (`writing`, `doneWriting`, `stopped`, `word.*`, `newMessages`, `left`, `activity.*`) are exempt like `WATCH.calm`. Primaries at or under 28 characters.
- `styles/chat.css`: the classes of section 2 on tokens only; `.chat-activity-row[data-state="done"] .guided-tick` reuses the stroke animation; `.chat-card` fade `chat-in` opacity over `var(--motion-base)` (DESIGN-PLAYFUL's arrival duration); all `animation: none` under `prefers-reduced-motion`. The spiral breath is DESIGN-PLAYFUL's rule in `base.css`, nothing in `chat.css`.

### As built (2026-10-17)

The strip links come through `useGuidedStrip` (a context hook in `GuidedShell.tsx`), not a prop; `Guided.tsx` offers "Chat" on the walk-through only when a plan exists, the AI is usable and no step is in flight. `ChatScreen` takes `bridge: ChatBridge` from `GuidedController.chat`. The draft is `ChatDraftContext` in `src/chat/draft.ts` (`{ text, seq }`), provided by `App.tsx`. The bridge and the chat phase are described in `docs/DESIGN-CHAT.md` section 7 "As built".

### Demo params (`app/demo-boot.ts`, `adapters/demo-explainer.ts`)

DESIGN-CHAT's: `chat_reply=urgent|disk|leave_disk|cannot|outside|inject|too_many|app_voice`, `chat_fail=limit_reached|needs_sign_in|provider_unavailable|rejected_output`, `chat_fail_after=N`, `memory=<json>`, `watch=act`, `licensed=1`, `fixture=`, `batch=`, `fix=`, `fix_delay=` (paces the activity rows: one phase per `fix_delay`). Added: `chat_reply=long` (a 1,100-character reply for the pill shot); `chat_first_partial=<ms>` (holds the first partial, `9000` for the still-waiting shot); `chat_watch_at=<ms>` (flips `DemoWatch` to `act` after that long while the chat is on screen, for the watch shot); `chat_divider=1` (seeds the opening's `at` eleven minutes in the past, for the divider shot); `check_delay=<ms>` (`DemoWatch.checkNow`, `demo-watch.ts:268-272`, holds `checking: true` that long, for the watch-check shot); `watch_open=chat&question=<text>` (replays `watch:open` with the draft after the opening, for the draft shot); `chat_fail` gains `too_long|busy|cancelled`. Calls are recorded as `{ kind: "chat", arg: { question, allowed } }`, never text beyond the question.

## 6. Call budget and caching

The surface adds no call. The opening is authored plus the cached brief from `last-brief.json` when DESIGN-AI-PRESENCE exists. Every chip but "Why?" is zero calls. Activity rows are events the app already receives. The watch message costs nothing (the judge ran in Rust). Typed turns, "Why?" and "Explain this" taps are person-started and uncapped; the provider's `limit_reached` is the stop and is cached 300 s by the adapters (`chatgpt-explainer.ts:79`, `claude-plan-explainer.ts:75`) with `until` when given. Explanations stay cached per rule in the explain slot (`scan/machine.ts` `ExplainCache.byRule`) and the chat's cards read them through `ExplainPanel`. The transcript is memory only and is cleared on rescan, AI off, Disconnect and relaunch. The 8 s timer, the 80 ms partial throttle and the 400 ms reduced-motion step are UI timers, not calls. One request at a time on every provider: `useChat` and the explain slot refuse each other with the authored lines (DESIGN-CHAT section 6): the chat with `CHAT.busyExplain`, the explain tap with the new `EXPLAIN.busy`, since `EXPLAIN` (`copy.ts:166-188`) has no such key today.

## 7. Tests and QA

**Core (`packages/core/test/chat/`).** `transcript.test.ts`: `exchangeLabel` clips at 60 and never contains a newline; `dividerBefore` true at 600,001 ms and false at 600,000; `cardKindFor` maps every `IntentKind`, `null` only for `show_list`, `investigate`, `close_watch` and `remind_rule`; `historyFor` over a transcript holding every message kind returns typed `person` texts and finished `model` texts in order and never an `app`, `card`, `row`, `notice`, streaming or chip-echo text. The DESIGN-CHAT tests for `validateChat`, `buildAllowed`, `cardsFromRelated`, the canary and the fixtures stand, with their paths moved to `src/chat/`. The activity tests are DESIGN-AGENT's.

**Desktop (`vitest`, jsdom), `apps/desktop/src/chat/*.test.ts(x)`.** `state.test.ts`: every event in the table against every `stream` and `composer` state, including the ignored combinations; `model_failed` over every `ExplainerFailure` with a `never` check, every branch leaving `stream` idle and none of them setting `stopped`; `working` never holds two ids; `live` is null while `working` is set; `availability_changed(available)` after `limit` sets `resend` on every failed turn; `watch_noticed` with `at: null`; `opened` with and without a `reading`. `useChat.test.ts`: the opening with and without a brief and a diff makes no call, and with a critical step carries `urgent` and that step's live card; the batch chip produces `card_started` and one `card_result` from a `DemoFixPort` batch with `fix_delay=0`, and `rowsFor` reads one "Fixing 3 things" row with the word "your password" then "Checking it worked"; `batch=partial` yields a "did not change" result line and a show row; a single admin fix yields one verb row with "your password" and a user-level fix (`fail=013`) yields "1 of 1"; the watcher row goes `watching` then `done` on `poll_after=1`; the watch-check row resolves on the next `watch:state` and on the 20 s fallback with fake timers; `draft_received` with the exact `WATCH.askWhy` text sends once and with one character off stays a draft with no call; with `walking` true, `__talosDemoCalls` records one `fix_apply` per tap and none from promotion; the 8 s timer fires `model_still_waiting` with fake timers and is cleared by a partial; Stop removes the model message and keeps the person turn with `resend` and the meta; `limit_reached` mid-stream removes the partial, appends the notice, disables the field and draws no meta; `act_now` while the chat is open appends the watch exchange, demotes the idle card and keeps the draft; a 10 min gap draws one divider. `ChatComposer.test.tsx`: Enter, Shift+Enter, Escape in `ready`, `busy` and `limit`; the counter at 61 and 60 left; the state line and its link in each disabled state; Send disabled on whitespace. `ChatTranscript.test.tsx`: the pill appears only after a scroll-up and a new message; the transcript is `role="region"`, no `[role="log"]` or `[aria-live]` other than `off` inside it; exactly one live region on the page, the `[role="status"]`. `ChatCard.test.tsx`: at most one `.button-primary` and one `.guided-link` in every state, none while working; the cue bar only for critical and high; a `permission` card shows `PERMISSION.button`; no `.spin` on a row whose word is "your password". `copy.test.ts` walks `CHAT` under the banned list, the named sentences under the counter, and `waitingKey` and `remoteOf` over every `ExplainerProvider`. `icons.test.ts`: `ArrowUp` in `LUCIDE_NAMES`, `ICONS.send` present. `GuidedShell.test.tsx` (DESIGN-PLAYFUL's new file; `shell.test.ts` tests the expert shell): `data-writing` on the spiral while `useGuidedHero(true, false, true)` is mounted and gone on `false`.

**Harness (`apps/desktop/qa/harness.ts`, `walkChat`), demo, light and dark, 1100x760 and 900x600, axe on all.** DESIGN-CHAT's shot names stand; added: `chat-opening-urgent` (a critical step: `p.guided-urgent` and the urgent card live, three chips), `chat-activity-batch` (the batch card with one running row, "your password", `fix_delay=60000`, volatile), `chat-activity-done` (the rows ticked and the 022 card live), `chat-activity-failed` (`batch=partial`), `chat-activity-single-admin`, `chat-activity-show-watching`, `chat-activity-watch-check` (`watch=calm&check_delay=60000` then the `open_watch` card's "Check now"), `chat-watch-draft` (`watch_open=chat&question=why`, the draft in the field, no call), `chat-model-waiting` (`chat_first_partial=60000`: the caret alone and the badge), `chat-still-waiting` (`chat_first_partial=9000`, captured at 8.5 s), `chat-limit-notice`, `chat-signed-out-notice`, `chat-did-not-answer`, `chat-too-long` (`chat_fail=too_long`), `chat-new-pill` (`chat_reply=long`, scrolled to the top, then a chip), `chat-divider` (`chat_divider=1`), `chat-watch-act-now-mid-chat` (`chat_watch_at=1000`), `chat-composer-near-limit` (a 445-character draft), `chat-composer-four-lines`, `chat-strip`, `chat-breathing` (volatile, `data-writing="true"` present), `chat-reduced-motion` (`reducedMotion: "reduce"`: no `.caret` animation, no `data-writing` animation, text updated at most every 400 ms), `chat-apple-derived-cards`, `chat-dev-calls`. Assertions, on top of DESIGN-CHAT's: every `.chat-activity-row` has a non-empty state word and an icon; no `.chat-activity` exists on a shot where no card ran; `.chat-activity-row[data-state="running"]` count is at most one on every shot; no `.spin` inside a running row whose word is "your password" (`chat-activity-single-admin`, `chat-activity-batch`); exactly one live region on the page counting implicit roles (`[aria-live]` other than `off`, `[role="status"]`, `[role="log"]`, `[role="alert"]`), and it is the status element outside `.chat`; the newest `.chat-card .button-primary` sits above the 600 px fold at 900x600 whenever a card is the last message; `.chat-new-pill` is absent unless the shot scrolled up, and absent on `chat-watch-act-now-mid-chat` with the log at the bottom; `.chat-composer` present and enabled on `chat-opening-free` with no `.button-primary` in it; every `.guided-model` has a `.chat-badge`; the strip holds three `.guided-strip-link` and no `.icon-button`; `__talosDemoCalls` records no `chat` call on `chat-activity-*`, `chat-opening-urgent` and `chat-watch-draft`, and one on `chat-model-waiting`; never a URL.

**Only on a real Mac.** Whether macOS keeps the password dialog open long enough for the "your password" row to be seen on a fast batch; Claude's time to first word and the 8 s line; VoiceOver's reading of the status element during a batch (rows announced once each, the transcript not re-read); the spiral breathing's CPU cost on an Intel Mac over a 30 s Claude turn; the 900x600 fold with the Explain disclosure open on the live card; a `watch:open` draft arriving before the launch check-up lands.

## 8. Out of scope

- The menu bar watch not showing (TASKS #19, explained: licence-only), `cycle.rs`, and anything in the 320 px window (DESIGN-WATCH-WINDOW).
- Building the `checkup` task, `BriefStore` and `last-brief.json`; the chat reads them when present.
- Playful motion beyond this surface (DESIGN-PLAYFUL), new signals (DESIGN-THREATS-V2), the activity timeline's types, reducer, feeders and fix-row labels, probe rounds and plans (DESIGN-AGENT), the daily reading's content (DESIGN-DAILY; the `reading` slot in `opened` is the only hook here). DESIGN-AGENT's probe rounds draw in this document's row DOM with `activityLabel(event)`; nothing here has to change for them.
- Markdown, links, bold, copy on model text; model-written chips; a model activity row; a tool loop; voice; a transcript on disk; more than one provider at a time; hover timestamps; day grouping; message editing or deletion; reactions.

## Open questions for the owner

1. **The activity row's state word.** Lower-case words ("done", "1 of 3", "did not change", "your password") after the label, or no word and the icon alone with the state in a hidden span. Default: the visible word, so colour and shape never carry the state alone.
2. **The opening's live card when nothing is critical.** The batch card (fixes the most in one tap) or the first step's card (the plan's own order). Default: the batch card when the plan has one, else the first step.
3. **The time divider at ten minutes.** Five or fifteen are equally defensible. Default: ten.
4. **Chips in the foot, not under the last message.** Agent apps put suggestions under the last turn; keeping them in the foot means they never scroll away and the composer is always one row above them. Default: the foot.

## Docs touched by the build

- `docs/DESIGN-CHAT.md` section 3 "Anatomy": the kinds table gains the `activity` and `notice` rows; `div.chat[role="log"][aria-live="polite"]` becomes `div.chat[role="region"][aria-label="Conversation"]`, announcements through the status element only; "Scrolling": "New message ↓" becomes "New messages" (`CHAT.newMessages`); "The composer": "ArrowUp from the kit" becomes "lucide `ArrowUp` (`ICONS.send`)"; section 2 and the strip paragraph: "gear" becomes "Settings", a text link; "The opening": a critical step draws `p.guided-urgent` and the urgent card live with three chips, otherwise the batch or first step's card is live; section 7 "Core": `src/explainer/chat.ts` and `src/guided/allowed.ts` become `src/chat/intents.ts`, `src/chat/input.ts` and `src/chat/allowed.ts`; "Person turns" item 1: the guard line reworded; section 8: replace "no `.chat-composer` on `chat-opening-free`" with "`.chat-composer` present and enabled on `chat-opening-free`; no `.button-primary` in it" (the owner's decision in TASKS #14), and the shot and assertion lists of section 7 above.
- `docs/DESIGN-AGENT.md` section 2a and section 4: the row DOM is `li.chat-activity-row[data-state][data-activity]` in `ul.chat-activity[role="list"]` as drawn here; admin work (a single admin fix or a batch's admin block) is one row resolved by the outcome, with the state word "your password" while the dialog is up and the kit `KeyIcon` static, because Rust emits no event between `WaitingForPassword` and the outcome (`fix/run.rs:258`, `fix/batch.rs:353`); the 2a mock-up's separate "Your password, to macOS" tick before "Turning it on" holds only for user-level steps that follow an admin one in the same plan.
- `docs/DESIGN-PLAYFUL.md` 3.8: `GuidedHero.writing` and `useGuidedHero(spiral, horizon, writing)` carry the chat's busy flag to the shell; open question 4 is answered: down.
- `docs/DESIGN-AI-PRESENCE.md` section 5 "Blocks" gains: "In the chat the badge is drawn from the first partial, under the caret."
- `docs/DESIGN-WATCH-WINDOW.md` section on the ask field: the main window's event is `draft_received { text, autoSend }` in `apps/desktop/src/chat/state.ts`; the exact-match rule is unchanged.
- `docs/DESIGN-V03.md` section 7 harness: `assertGuidedScreen` is replaced on the chat route by the chat assertions above.
- `apps/desktop/qa/README.md`: the `walkChat` group and the new params. `docs/TASKS.md` #20: "designed" with this file, then "in progress" when the build starts.

## What was checked on this Mac (read-only, 2026-10-17)

`defaults read -g AppleInterfaceStyle` returns Dark (the owner runs dark mode, so the dark shots matter first). `defaults read com.apple.universalaccess reduceMotion` and `reduceTransparency` have no key (both off). `~/.local/bin/claude` is a symlink to Claude Code 2.1.287. `~/Library/Application Support/si.taloslabs.desktop` holds `last-report.json` (47 kB, mode 0600, written 12:33 today), `chatgpt.json`, `watch-settings.json` and a `claude-code/` folder, and no `last-brief.json`, which confirms DESIGN-AI-PRESENCE is not built; an older `ai.taloslabs.desktop` folder holds a `last-report.json` only. File contents were not read. Not checked: the app was not launched, no screenshot was taken, no git command was run, the tray's current state was not inspected, and no `cargo` or `pnpm` command ran.
