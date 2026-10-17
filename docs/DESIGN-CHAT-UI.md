# Talos Labs chat UI design: a conversation a person would recognise

DESIGN-CHAT made the chat the home once an AI is connected and fixed what the model may say and point at. It described the conversation in one section and left the surface to the build. The surface today is `apps/desktop/src/screens/Ask.tsx`: one text field, an "Ask" button, one paper card per exchange, no activity, no chips, no scroll handling, and the owner's verdict on it is "bad". This document designs the conversation surface itself: the transcript, its message kinds, the rows that show what the app is doing on the person's behalf, the cards, the chips, the composer, the streaming, the scrolling, the keyboard, the states, the component tree, the state machine, and what each provider adapter streams. It is the thing an implementer builds for TASKS #20, with DESIGN-CHAT as the rules underneath.

This document extends `docs/DESIGN-CHAT.md` (sections 2, 3, 7 and 8) and `docs/DESIGN-AI-PRESENCE.md` (section 5, the model block), on `docs/DESIGN-MINERAL.md` and `docs/DESIGN-WARMTH.md`. DESIGN-CHAT's intent set (`INTENT_KINDS`), validator (`validateChat`), allow-lists (`buildAllowed`), accept grammar, chip table, lock card rule and call budget hold unchanged; where this document changes one of its decisions it says so in the list below, as DESIGN-CHAT did for DESIGN-AI-PRESENCE. `docs/SECURITY-MODEL.md` gains nothing beyond what DESIGN-CHAT already lists under "Docs touched": every new element here is authored text, a catalogue headline, a count from `FixProgress` or a `WatchState` boolean. The model receives nothing new. It never runs anything. Nothing runs from a stream. Every Mac change is a catalogue entry behind the card's one tap, admin ones through macOS's own dialog. Model text is text nodes with the provider's badge and "Not verified", never a button, a headline, a row label or a chip. The app is complete with AI off: without a connected AI there is no chat and the v0.3 walk-through is the home. British English, no em-dashes, the banned-word list of `apps/desktop/src/guided/copy.test.ts`. Facts about the tree were checked on 2026-10-17 against the files named; `apps/desktop/src-tauri/src/watch/cycle.rs` and `App.tsx` are modified in the working tree and this document does not depend on their contents.

The owner's words, verbatim (2026-10-17): "Keep iterating on the talos UI -- the chat is bad, we need a better chat interface that you would have on a real modern agent driven app -- we need more playful interactions -- we need more of the threat detection strategies in place -- adding more agentic capabilities -- add threat detection strategies and interpretation of daily checks". Only the first two bullets are designed here; the rest are DESIGN-PLAYFUL, DESIGN-THREATS-V2, DESIGN-AGENT and DESIGN-DAILY (TASKS #21 to #24). The owner's standing tests from earlier rounds apply to every mock-up: is it obvious what to click, is there a sense of urgency, and not "too much clicking".

Decisions taken where the brief left room:

- **A fifth message kind, the activity row.** DESIGN-CHAT section 3 lists four kinds (app, person, model, card). Modern agent apps show a line per step the agent takes, with a spinner that becomes a tick. Talos is honest about this only for things the app itself does, so the row is driven by the app's own events and never by the model: `FixProgress` from the `fix:status` Tauri event (`apps/desktop/src-tauri/src/fix/run.rs:15`, `apps/desktop/src/adapters/tauri-fix.ts:93` `toFixProgress`: `planId`, `phase` `waiting_for_password | running`, `step`, `of`, `item` for a batch), the recheck that `runFix.ts` and `runBatch.ts` run after an apply (`STATUS.checking`), the show watcher of `runShow.ts`, and `WatchState.checking` from the `watch:state` event (`apps/desktop/src-tauri/src/watch/cycle.rs:36`). The model's "thinking" is not an activity: the model does nothing on the person's behalf, so its turn shows a caret and a badge, nothing else.
- **The core chat code lives in `packages/core/src/chat/`.** DESIGN-CHAT section 7 named `src/explainer/chat.ts` and `src/guided/allowed.ts`. This document gathers the chat's pure logic in one folder (`intents.ts`, `input.ts`, `allowed.ts`, `transcript.ts`, `activity.ts`), re-exported from `packages/core/src/index.ts`. The schema, the validator and the prose check stay in `src/explainer/` beside their siblings, as DESIGN-CHAT placed them.
- **The composer's guard line avoids a near-banned word.** DESIGN-CHAT's "I can't read paths or commands." contains "commands"; the copy test is whole-word on "command" and would pass, but the line is reworded to "I can't read file paths or typed instructions. Say it in words and I'll answer." so no reviewer has to think about it.
- **Send is lucide `ArrowUp`, not a kit glyph.** DESIGN-CHAT wrote "ArrowUp from the kit"; the kit has `arrow-left` and `arrow-up-right` only (`apps/desktop/brand/mineral/icons`). `ICONS.send` is lucide `ArrowUp`, added to `LUCIDE_NAMES` in `apps/desktop/src/app/icons.ts`. Stop stays `ICONS.stop` (lucide `Square`).
- **The spiral breathes only while a request runs.** DESIGN-MINERAL section 5 forbids ambient looping motion and DESIGN-WARMTH 9b says nothing in the warmth pass animates. The chat mounts the spiral band (`useGuidedHero(true, false)`, no horizon: the transcript scrolls and the composer is fixed) and the band's opacity eases between `--hero-spiral-opacity` and 1.6 times it over 3 s, only while a model turn, an explain disclosure or a brief is `running`, and stops at the next whole cycle on `ready`, `failed` or Stop. It is never idle motion. Under `prefers-reduced-motion` it is static at `--hero-spiral-opacity`. Recorded as a one-row addition to the Mineral motion table under "Docs touched by the build".
- **Time dividers, not hover timestamps.** Agent apps put the time on hover; DESIGN-WATCH-WINDOW's principle "Nothing in the window needs a hover" holds for the audience here too. The transcript draws one `div.chat-divider` with `formatTime(at)` when more than ten minutes passed since the previous message (`DIVIDER_GAP_MS = 600_000`). A transcript lives for one check-up, so there is no day grouping.
- **Turns are grouped as exchanges.** One `section.chat-exchange` holds a person turn and everything that answered it (model block, cards, rows, activity rows, result lines, chips), with `aria-label` "You asked" plus the person's text clipped to 60 characters. App-started messages (the opening, the watch's message, the end message) are exchanges with no person turn and the label "Talos Labs". A screen reader can jump by exchange; a sighted person sees one indent per exchange and nothing else.
- **No copy button, no markdown, no links.** `ModelText` renders text nodes (`apps/desktop/src/components/ModelText.tsx`); SECURITY-MODEL.md:161 excludes a copy button on model text. App result lines carry no copy button either: the "explain to my son" export is DESIGN-AGENT's.
- **The counter appears at 60 characters left.** The field holds `CHAT_LIMITS.maxQuestionChars` (500). `Ask.tsx` shows a counter at 100 of 2000; at 500 that is too early. `CHAT_NEAR_LIMIT = 60`, shown as "60 left" under the field and announced once through the status element.
- **An error row is a message, and it carries exactly one way out.** Limit reached, signed out and didn't answer each render as an app line under the person's turn with one chip or one link, and the same reason sits in the composer's state line (DESIGN-CHAT "The composer"). The person's turn is never removed. A "Try again" or "Send again" chip resends the same text; nothing is retried on its own.
- **The gear in the strip is an icon button with a hidden label, and that is an open question.** The brief names "Step by step, Details, gear". DESIGN-WATCH-WINDOW dropped an icon-only pause control for this audience. The chat keeps the gear because `GuidedShell` already renders icon actions with a `visually-hidden` label and a `title`, and "Settings" as a third text link would crowd a 560 px strip at 900 wide. Open question 1 offers the text link as the alternative.
- **Reduced motion means whole-field text, no caret blink, no breathing, no fades, and the same layout.** The global rule in `apps/desktop/src/styles/base.css:201-207` already zeroes animations; the chat's partials are then applied at most every 400 ms so the text grows in readable steps rather than word by word (`CHAT_REDUCED_PARTIAL_MS`).

## 1. Principles

- **It reads as a conversation, top to bottom, with the newest thing at the bottom and the one thing to tap nearest the composer.** Exchanges are grouped, the person's turns sit right, the app and the model sit left, and the live card is the last block above the chips. Nothing moves once drawn: text streams into its own block, cards land under the text, result lines append under their card.
- **What the app is doing is visible as it happens, in words, with a tick when it is done.** Every fix, batch item, recheck, watcher and watch check is a row with a running, done or failed state carried by its text and its icon, never by colour alone. The rows are the app's own events; the model has no row.
- **The model is a voice, not an actor.** A model turn is a rule-left block with a caret, a badge from the first partial, and cards under it only after the whole validated reply. The model never has an activity row, a spinner of its own, a progress bar or a "thinking" line beyond the caret.
- **One primary in the transcript while a card is idle, none while it works.** DESIGN-CHAT's rule. Send is an icon button. Chips are chips. Rows are rows. The strip has text links and one icon button.
- **Obvious what to click, and urgent when it should be.** The live card is paper on sand with a 3 px severity cue for critical and high; the primary is the one gradient; "What is urgent?" is a chip when something is; the watch's act-now message lands with the `OctagonAlert` icon and the word "Act now" in its headline, never red alone.
- **Playful within the Mineral table.** The done tick draws (240 ms), the done disc settles with one 150 ms scale from 0.96 to 1, cards fade in at `--motion-base`, the spiral breathes while the AI writes, chip taps echo as the person's bubble so the log answers back. No confetti, no sound, no bounce, nothing idle.
- **Keyboard first, focus predictable, one live region.** Enter sends, Shift+Enter adds a line, Escape stops or moves focus and never clears. One `role="status"` outside the log carries every announcement. Nothing inside the log is live except the log itself, and a streaming block is `aria-live="off"`.
- **Honest and quiet.** A refusal is one authored line with one way out. The composer says why it is disabled. The 8 s "Still waiting" line is true when shown. The free version is never pitched by the surface: the lock card is DESIGN-CHAT's one card per check-up.

## 2. The conversation, state by state

### Anatomy

The guided shell (`apps/desktop/src/guided/GuidedShell.tsx`): the 52 px `.title-strip.guided-strip` with `Brand size=24`, then the strip's actions; one 560 px column at 72 px top padding. The chat screen (`ChatScreen.tsx`) fills the column with three stacked regions:

1. `div.chat[role="log"][aria-label="Conversation"]`, flex 1, `overflow-y: auto`, 16 px bottom padding; the exchanges in order; `aria-live` is not set on the log itself (DESIGN-CHAT set `polite`; this document moves every announcement to the status element so a streaming block and a landing card are never read twice). Each new app line, result line and card is announced once through `ChatStatus`.
2. `div.chat-foot`, sticky at the bottom of the column, sand with no grain: the "New messages" pill (absolute, above the foot, hidden by default), `div.chat-chips` (one wrapping row, `button.chat-chip`), `form.chat-composer`.
3. `div.chat-status[role="status"].visually-hidden`, outside the log, rendered once by `ChatStatus.tsx`.

The spiral band is mounted top-right as on the end screen (`Hero kind="spiral"`, `base.css:272-294`), at `--hero-spiral-opacity`, with `data-writing="true"` while a request runs. No horizon. Mineral tokens throughout: sand canvas with the gradient and grain from `base.css` (`.content::before`, `.content::after`), paper cards `--bg-elevated` with the 1 px `--border`, radius 12, no shadow; type `--text-guided-body` for app and model text, `--text-guided-list` for headlines and rows, `--text-guided-meta` for badges, chips, dividers and the counter; rust `--gradient-accent` only on the one primary and the done disc.

Message kinds, each a distinct DOM shape:

| kind | DOM | look |
|---|---|---|
| app | `div.chat-app` | left, no bubble, `--fg`, first person, may hold `h2.chat-headline` (`--text-guided-list` 600, `tabIndex=-1`), a `GuidedList`, rows, a card |
| person | `div.chat-person` | right, `--bg-inset` bubble, radius 12, max-width 80 %, text nodes |
| model | `div.guided-model` | left, 2 px `--border` rule on the left, 12 px inset, `ModelText` (`caret` while streaming), `p.chat-badge` under it with `aiBadge(provider)` from the first partial |
| activity | `div.chat-activity[data-state]` | left, 28 px rows: a 20 px icon slot, the label at `--text-guided-list`, a trailing state word at `--text-guided-meta` in `--fg-secondary` |
| card | `div.chat-card[data-kind]` | paper, hairline, radius 12, 16 px 20 px padding, the 3 px cue bar (`--sev-cue-critical` or `--sev-cue-high`, inset 10 px top and bottom, as `.guided-next-card`), headline, body, one `button.button.button-primary.chat-card-primary` at 44 px and 220 to 320 px wide, at most one `button.guided-link`, the `ExplainPanel` disclosure where DESIGN-CHAT gives one |
| row | `button.guided-end-row` | 44 px, kit icon, headline, trailing chevron (`guided.css:524-575`) |
| divider | `div.chat-divider` | centred `formatTime(at)` at `--text-guided-meta` between two hairlines |
| notice | `p.chat-notice` | left, `--fg`, one authored sentence, followed by one chip row or one `guided-link` |

### The opening (first launch after connecting, licensed, ChatGPT, dev machine)

> ○ Talos Labs
> **I found 7 things to fix.**
> I can fix 4 of them for you now. The other 3 I'll show you where.
> ┃ Your Mac goes out with you and its disk is not locked, so a lost bag means lost photos and open accounts. The firewall is the quick one and the app puts it first.
> ┃ Written by ChatGPT. Not verified.
>
> [Do them all] [Fix what you can] [What is urgent?] [Show me the list]
> ┌──────────────────────────────────────────────────────────────┐
> │ Ask me, or tell me what to do.                             ↑ │
> └──────────────────────────────────────────────────────────────┘

The first line is the exchange's visually hidden label; the headline and body are `planText(plan)` from `apps/desktop/src/guided/plan.ts`; the model block is DESIGN-CHAT's cached brief and is absent until the `checkup` task exists. Focus is on the headline. Zero calls. With a diff, the "Since last time." meta line and the Since rows precede the headline in the same app message. With nothing to fix: "Nothing needs fixing." (`END.nothing`) and the chips "Show me the list" and "Check again".

### "Fix what you can": activity rows and a card

The chip echoes as the person's bubble, then the batch card lands with a 150 ms fade, no call:

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

Tap "Fix these for me". The card's primary and link are removed, the card keeps its headline and list, and activity rows append directly under the card, one per phase, from `FixProgress`:

> ◌ Waiting for your password                              waiting
> ✓ Waiting for your password                              done
> ◌ Fixing: The firewall is off                            1 of 3
> ✓ Fixing: The firewall is off                            done
> ✓ Fixing: Your Mac answers strangers on the network      done
> ◌ Fixing: App Store apps do not update on their own      3 of 3
> ◌ Re-reading 3 areas                                      checking

Then the rows settle and the result lines append as DESIGN-CHAT specifies (`DoneRow` ticks, "Done. 3 things fixed."), the 022 row becomes the live card, and the chips read "What's next? · Show me the list · Check again". The first row's label is `CHAT.activity.password`; the per-item rows are `CHAT.activity.fixing(headline)` with `headline = guidedFor(ruleId).headline` for the batch plan's item at `progress.item`; the last is `CHAT.activity.rereading(n)` with `n = plan.recheck.length` (`FixPlan.recheck`, `packages/core/src/ports/fix-port.ts`). A single fix shows "Waiting for your password" (admin only), "Fixing: {headline}" and "Re-reading N areas". A show card shows one row "Watching for the change" (`CHAT.activity.watching`) with the state word "watching", then "done" on pass or "no change yet" on stale (`SHOW.staleTitle` stays the card's line). A watch "Check now" from the `open_watch` card shows "Checking your Mac" (`CHAT.activity.watchCheck`) while `WatchState.checking` is true. A failed row reads its state word from the `FixError`: "did not change" (`END.didNotChange`, lower-cased) for `command_failed`, "stopped" for `cancelled` and `wrong_password`, "couldn't check" for `unreadable`; the card then shows `failureCopy(...)` as DESIGN-CHAT's result table says.

Icons: running is `ICONS.spinner` with the existing `spin` keyframe (`components.css:560-565`), static under reduced motion; done is the kit `CheckIcon` at 20 px in `--fg-secondary`, drawn with the 240 ms `guided-tick` stroke animation (`guided.css:194-201`); failed is the kit `CloseIcon` in `--sev-critical-fg`. The state word is always present so colour and the icon never carry the state alone.

### A model turn

Typed "Why does the disk matter?", Enter. The bubble appears at once; the model block appears at once with the caret alone and the badge; the status element says "Writing".

> **Why does the disk matter?**                              (right)
>
> ┃ ▎
> ┃ Written by ChatGPT. Not verified.

After the first partial the text grows word by word with the caret at the end (`ModelText caret`, the blink in `components.css:1463-1482`). After 8 s with no partial, one line under the block, `CHAT.stillWaiting[provider]`: "Still waiting for ChatGPT." / "Still waiting for Claude." / "Still working on this Mac." It is removed on the next partial. When the stream completes and `validateChat` passes, the cards and rows land under the badge with the 150 ms fade, and the chips update. The composer shows Stop in the Send slot throughout and returns focus to the field on completion.

### A limit-reached turn

The person sends "why does the backup matter?" and ChatGPT answers 429, or fails mid-stream with `subscription_sharing_usage_limit_exceeded`:

> **why does the backup matter?**                            (right)
> Stopped.                                                    (meta, under the bubble)
> Your ChatGPT allowance is used up for now. It comes back on its own.
>
> [What's next?] [Show me the list] [Check again]
> ┌──────────────────────────────────────────────────────────────┐
> │ Your ChatGPT allowance is used up for now. It comes back on   │
> │ its own.                                                       │
> └──────────────────────────────────────────────────────────────┘

The partial text and its block are removed. The notice is `EXPLAIN.limit[provider]` plus `EXPLAIN.limitBack`, or `EXPLAIN.limitBackAtPrefix` plus `formatTime(until)` when Claude gave a reset time. The composer's field is replaced by the same sentence in `p.chat-composer-state`; the chips keep working; every card keeps working. When `useAiAvailability` settles `available` again, the field returns silently and the chip "Send again" appears under the stopped turn. Signed out: the notice is `EXPLAIN.signedOut[provider]` with one `guided-link` "Sign in again" (Connect, `returnTo: { name: "chat" }`); the composer state line is the same sentence with the same link. Didn't answer (`provider_unavailable`, `timeout`, `network`): `EXPLAIN.didNotAnswer[provider]` with the chip "Try again", and the composer stays usable. Rejected output: `CHAT.couldNotUse` "I couldn't use that answer. Try asking another way." with no chip, the field usable, focus in it.

### The watch's act-now entering the chat

While the chat is on screen and `WatchState.rating` becomes `act_now` with items (the `watch:state` event through `useWatchStatus`, `apps/desktop/src/watch/useWatch.ts:8`), or `watch:open` arrives with `screen: "noticed"` and items exist, the chat appends an app exchange and scrolls to it:

> ──────────────── 14:32 ────────────────
> ⛔ **Act now: a new program started running on its own**
> I noticed this at 14:32. It was not there at the last check. I have not deleted anything.
> ▍ Experts would cut it off first. CISA's ransomware checklist, step 1.
> [See what to do]
> This is fine, I know it

The divider appears because more than ten minutes passed. The headline is `WATCH.act` plus ": " plus `FISHY.noticed.headline[kind]` lower-cased at its first letter, with the kit `OctagonAlert` glyph in `--sev-critical-fg` leading, so the word carries the urgency; the body is `FISHY.noticed.body` with `formatTime(changedAt)`; the source line is `WATCH.sourceAct`. The card's primary opens the fishy flow with `returnTo: { name: "chat" }` and `start` as `App.tsx` chooses (gate when the item is in `WatchState.gated`, else noticed); the link calls `watch.acknowledge(signalId)` and appends "OK.". On return from the flow the chat appends `FISHY.recover.body` when the recover screen ran. This card is the live card; any other idle card becomes a row. No call is made. The status element announces the headline. `keep_an_eye` adds nothing, as DESIGN-WATCH says.

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

"Not now" writes `paywallSnoozedUntil` (14 days) and collapses the card to "OK." with a 150 ms fade. A pasted key runs `licenceAccepted` and appends `PAYWALL.thanks` then the newly planned card. Elsewhere the free person sees only the meta line "3 more in the full version." where a locked card would have been. The composer is present and free.

### Chips

As DESIGN-CHAT's table: `button.chat-chip`, at most four, at most 25 characters, authored in `apps/desktop/src/chat/chips.ts`. Look: `--bg-elevated`, 1 px `--border`, radius 7, 32 px tall, `--text-guided-meta` in `--fg`; hover `--bg-inset`; pressed `--bg-pressed`; the global focus ring. A tapped chip echoes as a person bubble, then the chip row re-renders for the new state. Chips never scroll with the log; they sit in the foot.

### The composer

`form.chat-composer`: a `textarea` (one row, grows to four, `rows=1`, `maxLength=500`, `aria-label` "Message", placeholder `CHAT.placeholder` "Ask me, or tell me what to do."), 44 px minimum, `--bg-elevated`, hairline, radius 7, the rust focus ring; a 44 px `button.icon-button.chat-send` with `ICONS.send` and `aria-label` "Send", disabled while the trimmed draft is empty; while a turn streams the same slot holds `ICONS.stop` with `aria-label` "Stop" and the field is `readOnly`. Under the field, when fewer than 60 characters remain, `span.chat-count` "N left" (`CHAT.left(n)`), read with the field through `aria-describedby`, and announced once by the status element as "60 characters left". Disabled states replace the field with `p.chat-composer-state` holding the reason sentence and its one link, and keep Send hidden. In Developer mode a meta line under the form reads `CHAT.calls(n)` "Calls this check-up: 3".

### Scrolling and the pill

`useStickToBottom(logRef)` in `apps/desktop/src/chat/scroll.ts`: the log scrolls to the bottom on every appended message while the person is within 48 px of the bottom; once they scroll up, new messages do not move the view and `button.chat-new-pill` "New messages ↓" (`CHAT.newMessages`, the arrow in an `aria-hidden` span) appears centred above the foot; tap scrolls to the bottom and hides it; reaching the bottom by hand hides it too. A streaming block never scrolls the view on its own partials; only a new message does. Focus never moves on scroll. Under reduced motion the scroll is instant (`behavior: "auto"`).

### Keyboard and focus order

DOM order: the strip's "Step by step", "Details", the gear; then the log's controls top to bottom (rows, card primaries, links, disclosures, chips inside notices); then the chips; the field; Send or Stop. Enter sends; Shift+Enter inserts a newline; Escape while streaming stops; Escape with nothing running and focus in the field moves focus to the newest card's headline (`tabIndex=-1`) or, with no card, the newest app headline; Escape never clears the draft. Cmd+L focuses the field through a window keydown handler in `ChatScreen.tsx` unless another text field has focus. After a chip or a resolved card, focus moves to the newest headline, as `StepFrame` does (`StepFrame.tsx`, `heading.current?.focus()`); after the person's own typed send and after Stop, focus returns to the field. Tab inside the `textarea` is a tab stop, not an inserted character.

### The strip

`GuidedShell` gains `strip?: { links: readonly { label: string; onClick(): void }[]; gear: boolean }`. The chat passes `links: [Step by step, Details]` and `gear: true`. "Step by step" (`CHAT.stepByStep`) enters the v0.3 flow at the first undone step; "Details" opens the Overview; the gear is `button.icon-button` with the kit `SettingsIcon` (`ICONS.settings`, new key), `title` and `visually-hidden` "Settings". The walk-through's strip shows "Chat" (`CHAT.chat`) in place of "Step by step" when the chat is the home, as DESIGN-CHAT says.

### Light and dark, and the 900x600 fold

Every colour is a token with a dark value in `tokens.css` (the dark block at 211 onwards); the person bubble is `--bg-inset` in both; the cue bars use `--sev-cue-*` dark values; the spiral uses `--hero-spiral-stroke` and its dark opacity 0.12. At 900x600 the strip takes 52 px, the foot about 112 px (chips 32, gap 8, field 44, padding), leaving about 436 px of log; a fix card is about 230 px tall with the disclosure closed, so the newest card's primary is above the fold when the log is at the bottom, which `useStickToBottom` guarantees after every append. The harness asserts it (section 7).

### Empty state

There is none: the opening is always drawn. No report, AI off, not connected, or On this Mac unable to run: no chat, the v0.3 screens (DESIGN-CHAT section 2).
