# Talos Labs chat design: talk to Talos once an AI is connected

v0.3 made the app drive. DESIGN-AI connected the AI the person already pays for. DESIGN-AI-PRESENCE let that AI be felt on the screens the app already had. This document changes the home. Once ChatGPT, Claude or Apple Intelligence is connected, the first thing the person sees after the check-up is a conversation with Talos. They type or tap what they want ("fix what you can", "what is urgent", "why does the disk matter", "leave the disk alone") and Talos answers and offers the actions in the chat, as cards, instead of the person walking screens. Without an AI connected the guided flow of v0.3 stays the home and there is no chat. With an AI connected the guided walk-through is still one tap away, and every expert screen stays reachable as "Details".

This document extends `docs/DESIGN-V03.md`, `docs/DESIGN-AI.md`, `docs/DESIGN-AI-PRESENCE.md`, `docs/DESIGN-WATCH.md`, `docs/DESIGN-MINERAL.md` and `docs/DESIGN-WARMTH.md`. `docs/SECURITY-MODEL.md` changes in two places (section 7, "Docs touched"): Boundary 3 lists the `chat` envelope field by field, and "Injection defences" gains two sentences about intents and the prose check. Everything else holds. The model receives only the derived document from `packages/core/src/explainer/context.ts` (rule ids, statuses, severities, categories, points, counts, enum values, the profile) plus the catalogue text in the frozen system prompt and a per-task block. It never runs anything. It never writes a fix step or a command. The plan stays `buildGuidedPlan`, a pure function. Every fix is a catalogue entry that Rust binds. Anything that changes the Mac runs only after the same confirmation as today: the card in the chat is the guided step, drawn by the app from the catalogue, and admin changes still go through macOS's own password dialog. The model may only propose actions as ids from a closed set, checked against allow-lists the app put in the request, before anything is rendered. Nothing runs at validation time; every intent becomes a card and the card's primary is the one tap. Every model text carries the provider's name and "Not verified" and is rendered as text nodes. The app is complete with AI off. Nobody is nagged. British English, plain words, the banned-word list in `apps/desktop/src/guided/copy.ts`. Facts about the tree were checked on 2026-10-17.

The owner's brief, verbatim (2026-10-17): "when the AI is connected, there should be some chat in the first place to let the user interact with talos rather than having to navigate. Without the AI connection, there is no chat." From the same message: "let the user also check out of some findings saying that you know but you don't want to do it, e.g., encrypt disk, you don't necessarily want to do it." The first bullet of that message, the menu bar watch not working, is a separate piece of work and is not designed here (section 9).

Three earlier decisions are re-opened in writing, as DESIGN-AI-PRESENCE re-opened DESIGN-V02 line 466. `docs/DESIGN-AI-PRESENCE.md` section 8 listed "a chat anywhere but Ask" as out of scope; the owner's brief asks for exactly that, and this document replaces Ask with the chat. `docs/DESIGN-AI.md` section 12 listed "using the AI to decide what to fix"; that stays out of scope. The chat does not decide what to fix. The plan decides. The model may only point at steps the plan already holds, by id, and the person taps. `docs/DESIGN-AI-PRESENCE.md` section 1 said "a model block never sits above a control"; the chat amends that for one case, stated in the decisions below.

Decisions taken where the brief left room:

- **The chat is the home when an AI could answer last time.** The home is decided from the last settled availability, stored in `GuidedMemory`, not from a probe racing the paced scan. When `explainer.aiEnabled` is on and the stored state is `available` for the chosen provider, the chat opens as the paced scan lands, and the live probe's answer arrives inline (the sign-in line, the limit line, the "didn't answer" line) if it disagrees. When the stored state is anything else, or there is none, the v0.3 plan screen opens as today, and "Chat" appears in the strip only when the probe answers `available`. On a Mac where On this Mac is chosen but cannot run, there is no chat, which is what the brief says.
- **Typed turns are free once an AI is connected, like Ask; the free version is never pitched by the home.** The free version sees the chat home with the opening message, the chips, the composer and every card the plan already allows (the free three fixes, the show-me-where steps, the list, rescan, snooze, accept), each fix, batch and show card carrying the Explain disclosure, which is free for every rule. The lock card concerns fixes only: it appears at most once per check-up, only when `paywallSnoozedUntil` is absent or past, and only after the free cards have resolved; otherwise one meta line, "3 more in the full version.", with no button. Owner decision 2026-10-17: AI is free once connected; the licence buys fixes beyond the free three, Check again and the menu bar watch (DESIGN-AI, LICENSING). Open question 1 is closed by it.
- **The first message costs nothing and is the app's.** The opening is an app message built from `planText(plan)`, the "since last time" rows when there is a diff, and the chips. When the plan reading of DESIGN-AI-PRESENCE exists in `last-brief.json` for this plan, it follows as the first model block, from disk, with no call. The chat never calls the model until the person types. Nothing in this document depends on the `checkup` task being built; without it, the opening is the authored sentence alone.
- **The chat lives in the guided shell, not the expert shell.** One 560 px column, the title strip, no sidebar. The strip carries "Step by step" (the v0.3 walk-through), "Details" (the expert Overview) and the gear. The expert shell's sidebar entry "Ask" becomes "Chat" and opens the same screen; with the expert home chosen in Settings the Overview stays the home.
- **DESIGN-AI-PRESENCE's moments fold into the chat.** Moment 1 (the plan reading) is the opening's model block. Moment 2 (the step lines) are the one-line model text under a card's link, from the cached `stepLines`, never requested on their own. Moment 3 (the end reading) is the model block under the end message after fixes. Moment 4 (Ask's briefing and three chips) is absorbed by the chat. Moment 5 onwards (the Overview and the Findings badges) is unchanged.
- **DESIGN-AI-PRESENCE's placement rule is amended for the chat's prose, and kept for cards.** A model turn's prose sits above the cards it points at; the card's own authored headline and sentence sit between that prose and the primary, which is the defence. On a card, the cached step line sits under the link, never between the authored sentence and the primary. The rule "a model block never sits above a control" holds inside every card.
- **Ask is retired.** The `ask` route becomes `chat`. `apps/desktop/src/screens/Ask.tsx` goes. The `ask` task stays in the protocol: it is the shape the chat uses on this Mac and on a ChatGPT session that has fallen back to plain output (section 6), and the ChatGPT and Claude adapters keep it for one release so a `chat` failure on an old binary degrades to text.
- **"I know, leave it" is a new, permanent, per-item choice.** `GuidedMemory` gains `accepted`. An accepted item is never a step, never the "Do this next" card, never the urgency sentence, and never a chip. It stays in the report and still counts against the score: the check is true, the person chose. It is listed on the end screen under "Things you chose to leave" and in Settings with "Ask again". The chat, the Details screen and the end screen can accept; the guided step cannot (it already has its one link, "Do this later").
- **Chips are authored and almost all of them cost no call.** A chip that names an app action ("Fix what you can", "Do them all", "What is urgent?", "What should I do first?", "What's next?", "Show me the list", "Check again", "Leave it alone") runs the action or renders the app's own answer with no model. The only question chip is "Why?" on a card the app just offered; it sends its authored text as the person's turn, one call. No chip is ever written by the model.
- **A card is the confirmation.** The chat renders the same step the guided flow renders (headline, the password sentence, one primary with the catalogue verb, one link), inline. Tapping the primary does what the guided step's primary does: `previewFix` then `applyFix`, and macOS asks for the password. There is no second sheet. Nothing runs until that tap, and nothing runs from a partial stream.
- **One live card at a time.** A model turn, a chip or an app answer renders at most one card with a primary; the other items it points at render as rows (`button.guided-end-row`) that become the live card when tapped or when the live card resolves. DESIGN-V03's "one primary per screen" holds in the chat as "exactly one primary in the transcript while a card is idle, none while it works"; the composer's Send is an icon button, never a primary. The harness assertion changes to match (section 8).
- **The transcript lives for one check-up and never touches disk.** It is cleared on "Check again" and at relaunch. The only model text on disk stays `last-brief.json` from DESIGN-AI-PRESENCE.
- **On this Mac gets text and derived cards, no model intents.** Apple's 3B model fills arrays and a cut stream is `rejected_output`, so the on-device chat uses the `ask` output shape and the app turns `relatedRuleIds` into cards itself, deterministically, through a pure function in core. The chips carry the actions on every provider, so this is a smaller chat, not a different one.
- **Accepting is routed before any call, on every provider.** A short authored grammar ("leave X alone", "I know about X", "don't ask about X", "skip X") matched against the headline words of the plan's items renders the accept card with no model. The owner's second bullet works the same on Apple Intelligence as on ChatGPT.
- **The model may not claim to have acted.** A reply in the app's voice ("I", "we", "the app") or claiming a change ("I've turned on", "Done.") is `rejected_output`, on the final value and on every partial. The prompt forbids it; the validator enforces it.
- **Claude answers slowly and the app says so.** One `claude -p` spawn per turn, 3 to 5 s to the first word, up to about ten seconds when a watch call has to yield first. Settings > Your AI gets one sentence about it. A long-lived process is a spike behind a Developer flag, not a commitment (section 6).
- **The history window slides.** The last six turns go to ChatGPT and Claude, the last two on this Mac. There is no "fresh thread" line and no reset the person has to notice.

## 1. Principles

- **The chat is a way to say what you want, not a place to be lost.** Every action the chat offers is one the app already has, with the same button, the same sentence and the same confirmation. "Show me the list" and "Step by step" are always one tap away, because a text box says nothing about what it can do.
- **The app speaks as "I"; the model speaks to "you".** App messages carry no badge and are authored. Model turns carry the provider's badge and are told to write in the second person. "I'll fix that for you" is only ever the app's line on a card. The model never claims to have done anything, because it cannot do anything, and a reply that claims it is thrown away.
- **The model points, the app draws, the person taps.** An intent is an id from a list the app put in the request. The app looks the id up in the catalogue and renders its own card. The model's text is never a button label, never a headline, never a list row.
- **Every intent becomes a card and nothing runs at validation time.** The card's primary is the one tap. "No confirmation" means no second sheet after that tap, not no tap. This holds for `explain_rule` (a tap, one call, counted), `rescan` (a tap, the report is replaced), `open_details` (a tap, the person leaves the chat on purpose) and `show_where` (a tap, a pane opens and a watcher starts) exactly as it holds for a fix.
- **Nothing runs from a stream.** Text streams. Intents are read from the complete, validated output only. Stop discards the partial text and every intent in it.
- **Mac-changing things need the same tap as today.** A fix, a batch: the card's primary, then macOS's own dialog for admin changes. "Do this later" and "Leave it alone": one tap, no second confirmation, because nothing on the Mac changes.
- **Honest about what it cannot do.** A refusal is an app line keyed by reason (can't from here, in the full version, allowance used up, signed out, outside the check-up, can't read paths), never model prose, and it always carries one way out.
- **No call the person did not ask for.** The opening is authored or cached. Chips cost nothing except "Why?". The call budget is the person's typing, and the provider's `limit_reached` is the stop.
- **Fast enough to feel like talking.** The person's own turn appears at once. The caret appears at once. The first word is the model's time only. Stop is real and immediate.
- **Keyboard first, in DOM order.** Enter sends, Shift+Enter adds a line, Escape stops a stream or moves focus and never destroys text, Tab and Shift+Tab walk the page as the browser does.
- **No nagging.** The chat opens with the plan, never a question the person did not ask. It never re-offers an accepted or snoozed item. When the AI comes back after a limit, the composer re-enables silently. The free version is not pitched more than once per check-up and never within 14 days of "Not now".
- **Complete with AI off.** The guided flow is the home. Nothing in this document is on the path of a scan, a fix or a watcher.

## 2. Information architecture

### Routes

`Route` in `apps/desktop/src/app/router.ts` gains `{ name: "chat" }` and loses `{ name: "ask" }`. `connect` and `fishy` keep their `returnTo`, which may now be `{ name: "chat" }`. `menu:navigate` keeps `settings` and `about`.

### The home decision at boot

`App.tsx` keeps picking `guided` or `overview` from `settings.guided.home`. Inside the guided flow, `landed()` in `apps/desktop/src/guided/landing.ts` builds the plan as today and then chooses the phase:

```
stored   = memory.aiLastAvailable                           // { provider, at } | null, written on every settled probe
chatHome = settings.explainer.aiEnabled
        && settings.guided.chatHome                         // new, default true (section 7)
        && stored !== null
        && stored.provider === settings.explainer.provider
        && now - stored.at < AI_LAST_AVAILABLE_TTL_MS       // 7 days
phase    = chatHome ? "chat" : (diff non-empty ? "since" : "plan")
```

`memory.aiLastAvailable` is written by `useAiAvailability` whenever a probe settles: set on `available`, cleared on `not_connected`, `needs_sign_in`, `plan_not_eligible`, `not_offered` and on Disconnect, provider change and AI off; left alone on `provider_unavailable` and `limit_reached`, which are passing states. The chat opens optimistically from the stored state. The live probe starts with the scan (a Keychain read for ChatGPT, which may refresh a token over the network; `codesign --verify` and an `auth status` child for Claude; neither touches the scan) and its answer lands in the composer's state line when it disagrees. Nothing shifts under the person: the chat was the home, and stays the home, and the composer says what the provider said.

The licence is not an availability: an unlicensed person with ChatGPT connected lands in the chat with the composer, and only the fix lock card is the gate's answer. The `since` rows fold into the chat's opening when the phase is `chat`. `talos.continue = { kind: "guided" }` after a relaunch for Full Disk Access lands in the chat with the opening message, and the first undone step's card appended under it at once, zero calls, with focus on its headline: the person was mid-plan and should not have to ask for the next step.

First launch is unchanged: Welcome, Start, the paced scan, and nothing is connected, so the plan screen. The chat appears on the first launch after a connection whose probe settled `available`.

The `failed` and `stopped` screens are unchanged: there is no report, so there is no chat.

### Turning the AI off while the chat is on screen

`explainer.aiEnabled` off removes every AI surface, the chat included. When it goes false while the phase is `chat`, the controller moves to `plan` (or `end` when no undone step remains) on the same plan object, the transcript is dropped, and a card in flight completes through `Core` and shows as that step's done or failed state in the walk-through. The same happens on Disconnect and when the stored availability is cleared by a probe (`not_connected`, `needs_sign_in` keep the chat with the inline line; `not_offered` and `plan_not_eligible` move to the plan).

### Reaching the walk-through and the expert screens, and coming back

The title strip on the chat screen: "Step by step" · "Details" · gear. "Step by step" enters the v0.3 flow at the first undone step of the same plan (`core.goToStep(0)`; the plan object is shared, so a fix done in the chat is done in the walk-through). The walk-through's strip shows "Chat" in place of "Step by step" when the chat is the home; the end screen's "Check again" rescans and lands back where the home rule says. "Details" opens the Overview as today; Back from any expert screen returns to the chat because the router stack holds it. A card of kind `open_details` navigates to `{ name: "finding", ruleId }` on its tap and Back returns to the chat with the transcript intact.

The expert sidebar lists "Chat" where "Ask" was, under the same condition as today (`aiUsable` or a remote provider chosen with AI on). With the expert home, "Chat" opens the chat screen in the guided shell with the same transcript; no plan brief exists in that home (DESIGN-AI-PRESENCE moment 4), so the opening is authored.

Connect from the chat: the `change_ai` card and the composer's "Sign in again" link open the Connect screen with `returnTo: { name: "chat" }`. Connect's "Not now" writes `aiAskedAt` as today and returns.

### The watch entering the chat

When the watch state is `act_now` and the chat is on screen, or when a `watch:open` with `screen: "noticed"` arrives while the watch has items, the chat appends an app message: the noticed headline for the top item's kind, the time sentence, and one card whose primary is "See what to do" and whose link is "This is fine, I know it". The primary opens the fishy flow with `returnTo: { name: "chat" }` and `start` chosen as `App.tsx` chooses today (gate or noticed). The link calls `watch.acknowledge(signalId)`. When the flow returns, the chat appends an app result line ("Done." or "I'll keep watching more closely for a day.") taken from the flow's own outcome. The fishy screens stay their own screens, with their playbook lines; the chat never redraws them. `keep_an_eye` adds no message; the dot in the menu bar is the whole signal, as DESIGN-WATCH says. The watch card is the live card while it is idle; any other idle card becomes a row until it resolves.

## 3. The conversation

### Anatomy

One guided column, 560 px, 72 px top padding under the 52 px strip. The transcript is `div.chat[role="log"][aria-live="polite"]`, scrolling, filling the height above a fixed composer. Above the composer sits one row of chips. One `div.chat-status[role="status"]` sits outside the log, visually hidden, and carries every transient announcement: "Writing", "Still waiting for ChatGPT.", "Stopped.", and the card status lines (`STATUS.password`, `STATUS.working`, `STATUS.checking`). Nothing inside the log is itself a live region. Mineral tokens throughout: sand page, paper cards with the hairline `--border`, rust `--accent` only on the one primary and the done disc, body at `--text-guided-body`, list rows at `--text-guided-list`, badges and chips at `--text-guided-meta`. No grain on cards or the composer. Motion `--motion-base`; under reduced motion no fade and no typewriter, text appears in whole fields.

Four kinds of message, each visibly different:

| kind | look | who writes it |
|---|---|---|
| app | left, no bubble, `--fg` at body size, the app's first person, may end with a list, rows or a card | authored copy only |
| person | right, `--bg-inset` bubble, radius 12 | the person, or an authored chip's text |
| model | left, `div.guided-model`: a 2 px `--border` rule on the left, text through `ModelText`, the badge under it ("Written by ChatGPT. Not verified.") | the model |
| card | a paper card, radius 12, hairline border, a 3 px severity cue on the left for a critical or high item and none otherwise (DESIGN-WARMTH 6b), one primary at 44 px, at most one link, the Explain disclosure where the step has one | the app, from the catalogue |

A model turn renders its text first and its card and rows under it, after the stream completes. A card never sits above the text it came with, so nothing the person is reaching for moves when the text grows. While a model block streams it is `aria-live="off"`; its final text is announced once through the status element on `model_ready`.

### The opening message

Dev machine, licensed, ChatGPT, plan reading cached:

> **I found 7 things to fix.**
> I can fix 4 of them for you now. The other 3 I'll show you where.
> ┃ Your Mac goes out with you and its disk is not locked, so a lost bag means lost photos and open accounts. The firewall is the quick one and the app puts it first.
> ┃ Written by ChatGPT. Not verified.
>
> [Do them all] [Fix what you can] [What is urgent?] [Show me the list]
> [ Ask me, or tell me what to do.                                         ↑ ]

The headline and body are `planText(plan)` unchanged. On a later launch with a diff, the "since last time" rows come first as a list in the same app message ("Since last time." as a meta line, then the diff rows the Since screen draws today), then the plan sentence. With nothing to fix: "Nothing needs fixing." and the chips "Show me the list" and "Check again". With nothing readable: `END.unreadableAll` and the Full Disk Access card when the plan holds the permission step.

The model block is DESIGN-AI-PRESENCE moment 1's `summary`, from `last-brief.json` when the key matches, else nothing. It is never a placeholder and never a spinner. If the brief is running at open (a new plan, an AI connected), the opening renders without it and the block lands under the body when `brief_ready` fires; the chips and composer do not move because the block sits above them in the same message and the transcript is scrolled to the bottom. Until DESIGN-AI-PRESENCE's `checkup` task exists in the tree, the block never appears and the opening is the authored sentence alone.

### Chips

`button.chat-chip`, one row that wraps, at most four, each at most 25 characters, verb first when it starts an action. Authored in `apps/desktop/src/chat/chips.ts` from state, under the banned-word test. A chip is a real button. An action chip runs the action and adds the person's turn with the chip's text so the log reads as a conversation. "Why?" is the only chip that sends its text to the model.

| state | chips |
|---|---|
| opening, something to fix for the person | Do them all · Fix what you can · What is urgent? · Show me the list |
| opening, only show-me-where steps | Do them all · What is urgent? · Show me the list |
| opening, nothing to fix | Show me the list · Check again |
| after a fix, batch or show result | What's next? · Show me the list · Check again |
| after an app answer offering a card ("What is urgent?", "What should I do first?", "What's next?") | Why? · What's next? · Show me the list |
| after a card derived on this Mac | Leave it alone · What's next? · Show me the list |
| after the end message | Show me the list · Check again |
| composer disabled by a limit or sign-out | the action chips only |

Chip actions, all zero calls:

- **Do them all** walks the plan in step order, one live card at a time, auto-advancing to the next card `AUTO_ADVANCE_MS` (1400 ms, 1800 under reduced motion) after a tick, as `advance` does in `apps/desktop/src/guided/core.ts`. A show card does not auto-advance; its watcher or its "Check again" link settles it.
- **Fix what you can** renders the batch card as the live card and every other fixable step as a row.
- **What is urgent?** is answered by the app: the undone step with the highest points whose severity is critical or high, as the urgency sentence of DESIGN-WARMTH section 6d picks it. "This one is urgent: An update is waiting. Until it is installed, your Mac is missing fixes Apple has sent." then its card. Omitted when no undone step is critical or high.
- **What should I do first?** is answered by the app from the plan order: "Start here." then the first undone step's card. Shown instead of "What is urgent?" when nothing is critical or high.
- **What's next?** appends the next undone step's card, or the end message when none remains. Omitted when the plan has no steps left.
- **Show me the list** renders the plan list in place as the Plan screen draws it, each row a `guided-end-row` that makes its step the live card.
- **Check again** is `controller.start()`.
- **Leave it alone** (only after a card derived on this Mac) renders the accept card for that card's item.
- **Why?** sends "Why does <headline, lower-cased> matter?" as the person's turn, one call. Free once connected, like every typed turn.

"What is urgent?" and "What should I do first?" never both appear. No chip names an accepted or snoozed item.

### Person turns

The person's text appears the moment Enter is pressed, before any call. Before sending, three local checks run on the draft, in this order, and each one makes no call:

1. **The machine-text guard**: `PATH_LIKE` or `PORT_LIKE` from `packages/core/src/watch/validate.ts` or `containsCommandText` on the draft shows one app line, "I can't read paths or commands. Say it in words and I'll answer.", keeps the draft in the field, and makes no call. `question` and `history` are the only free-text fields in the envelope and carry the person's own words by design; this guard keeps a pasted Terminal line or a launchd label out of them.
2. **A chip's text, case-insensitive**: the chip runs.
3. **The accept grammar** (`apps/desktop/src/chat/accept-grammar.ts`): `^(leave|skip|ignore|forget) (.+?)( alone)?$`, `^i know (about )?(.+)$`, `^(don'?t|do not|stop) (ask|bring|mention|remind)(ing)? me (about )?(.+)$`, with the captured phrase matched against the headline words of the plan's undone and later steps and a short per-rule synonym list in `packages/core/src/guided/plain-names.ts` ("disk", "FileVault", "encrypt" for 001; "firewall" for 002; "backup", "Time Machine" for 026, and so on). One match renders the accept card. Two matches render the accept card for the first and a row for the second. No match falls through to the model.

The composer becomes read-only while a turn streams and shows Stop in place of Send. A second send while a turn streams cannot happen. A send while an explain disclosure streams (the one explain slot) is refused with one app line: "I'm still explaining the last one. Stop it, or give me a moment." and focus on that disclosure's Stop.

### Model turns and the badge

The reply streams word by word into the `guided-model` block with a caret; the badge is under it from the first partial. After 8 s with no partial the status element announces, and one line under the caret shows, "Still waiting for ChatGPT." (or Claude, or "Still working on this Mac."). When the stream completes and validation passes, the card and rows appear under the text with a 150 ms fade. When validation rejects the output, the partial text is removed and one app line takes its place: "I couldn't use that answer. Try asking another way." with the person's turn kept.

`relatedRuleIds` that are not already the card or a row render as one text row each, "Details: Your disk is not locked ›", a `button.guided-end-row` to the finding. `outsideScope: true` appends the app line "That's outside what the check-up covers." under the badge.

### App messages for results

Results are app messages built from the same strings the guided steps use. A result is appended as a new line under its card; the card's primary and link are removed and the done disc or the `CircleX` icon is drawn beside the headline, the state also in the text. The card's text is never mutated, so the log is not re-announced. Lines:

| outcome | line |
|---|---|
| fixed | `DONE_PREFIX` plus `guided.done`, for example "Done. The firewall is on." |
| batch done | the batch's rows as today (`DoneRow`), tick or "did not change" per row |
| did not change, could not check | `failureCopy(...)` title and body; the primary becomes "Try again" or "Show me where" as the step would |
| cancelled, wrong password | "You closed the password box. Nothing was changed." / "That password did not work. Nothing was changed." with Try again · Do this later |
| pane opened | `SHOW.opened` then `guided.where` then `SHOW.notice`; the card keeps a "Check again" link while the watcher runs |
| watcher passed | `guided.done` |
| watcher expired | `SHOW.expiredNotice` |
| snoozed | `LATER_FLASH` |
| accepted | "OK. I'll leave this one alone and won't bring it up again. You can change that in Settings." |
| stale | "That one is done." or "That one is waiting." when a card's item left `allowed` before its tap |
| rescanned | the transcript is cleared and a new opening message renders |
| unlocked | `PAYWALL.thanks` then the newly planned card and rows |

**The end message.** Whenever no undone step remains, whatever the reason (fixed, snoozed, accepted, left alone, converted), the chat appends `END.allDone`, `END.partial` or `END.nothing` as the end screen picks it, with `END.nextTime` or `WATCH_ON.nextTime`, the "Still waiting" rows and the "Things you chose to leave" rows as `guided-end-row`s, and, when licensed and cached or returned, DESIGN-AI-PRESENCE moment 3's end reading as a model block under it. A person who taps "Do this later" or "Leave it alone" on everything hears they are done.

### Action cards and their confirm

A card is built from `guidedFor(ruleId)` and `copy.ts`, never from the model. The card is the confirmation: its primary does what the guided step's primary does. Every fix, batch and show card carries the Explain disclosure (`ExplainPanel` with `explainRuleId`, cached per rule through the existing explain slot) exactly as `StepFrame` does; it is a disclosure, not a primary, so the card rule holds, and the free three's explanations are reachable from the home.

Fix, one item (002):

> ▍ **The firewall is off**
> It keeps other computers on the same Wi-Fi from reaching your Mac. I can fix that for you. Your Mac will ask for your password.
> [Turn it on]
> Do this later
> ▸ Explain this
> ┃ The quick one. Nothing you use will notice it. (only when a cached step line exists)
> ┃ Written by ChatGPT. Not verified.

Batch:

> ▍ **I can fix 3 things for you now.**
> Your Mac will ask for your password once. That is macOS asking, not me, and I never see it.
> • The firewall is off
> • Your Mac answers strangers on the network
> • App Store apps do not update on their own
> [Fix these for me]
> Do these later
> ▸ Explain this

Show me where (001):

> ▍ **Your disk is not locked**
> If your Mac is lost or stolen, anyone can read your files. macOS has to do this one, so I'll open the right page and wait.
> [Show me where]
> I'll do it later
> ▸ Explain this

The "What will run" disclosure appears on fix and batch cards only in Developer mode, as `BatchStep` does. The FixSheet's "Talos Labs will run N commands" sentence stays in the expert shell; it contains a banned word and the chat is a guided surface.

While a card works, its primary is removed and the status line (`STATUS.password`, `STATUS.working`, `STATUS.checking`) is shown in its place as plain text and announced through the status element; the link is hidden; the composer stays usable for typing but no second card may start. Rows under a working card stay rows.

**Live check at render and at tap.** `cardFor` re-checks the id against the live `buildAllowed` when the card renders, and `runCard` re-checks at the tap. A card whose item has left `allowed` since the turn was validated (a fix landed from the walk-through, a watcher passed, the item was snoozed in Details) collapses to the stale line with no call.

### The chooser card

Two items need a choice, and the choice is always the app's, never the model's. For 022 the plan already holds one fix step per shared folder; the chat shows one card per folder (the first live, the rest as rows), and each card shows the folder's name from the report's `sharePath` evidence as local text under the headline, as the Finding screen does, so the person can see which folder they are confirming. That text is report evidence rendered locally; it is never sent, and the canary asserts no `sharePath` in any body. For 029 the card holds the `PassphraseForm` inline (8 to 256 characters) above its primary "Add a password", exactly as `FixStep` does; the passphrase travels only in `fix_apply`. The backup question of 026 is its own card: "Do you have a disk for backups?" with primary "Yes, show me where" and link "No, I'll get one later" (30-day snooze as today). No card ever shows a path the model could have written, because the model has no field for one.

### The lock card

Unlicensed, after the free cards have resolved, when `paywallSnoozedUntil` is absent or past, at most once per check-up:

> ▍ **There are 3 more things I could fix.**
> They are in the full version. The full version does them all and keeps an eye on your Mac from the menu bar.
> • Your Mac answers strangers on the network
> • App Store apps do not update on their own
> • A shared folder has no password
> [Buy the full version, €24 a year]
> [Paste your licence key          ]
> Not now

"Not now" writes `paywallSnoozedUntil` (14 days) and collapses the card to "OK." A valid key runs `licenceAccepted` and the chat appends the newly planned card and rows under `PAYWALL.thanks`. When the lock card may not appear, the same place carries one meta line, "3 more in the full version.", with no button and no field.

A licensed turn that points at a locked id cannot happen (`locked` is empty for a licensed person). An unlicensed person's typed turn, the on-device derivation and the rows can all reach the validator's `locked` list; a locked id in any of them renders as the meta line, never as a card.

The free three are fixed from the chat with no mention of the lock.

### The composer

A single-line field that grows to four lines, placeholder "Ask me, or tell me what to do.", 500 characters, with a 44 px icon button Send (`ArrowUp` from the kit) that becomes Stop (`Square`) while streaming. `aria-label` "Send" and "Stop". The provider's badge sentence is not repeated on the composer; it sits under every model turn.

The composer is present for the free version too: typed turns are free once an AI is connected.

Disabled states keep the chips. One line sits where the field is, from the EXPLAIN table of DESIGN-AI: `EXPLAIN.signedOut[provider]` with "Sign in again"; `EXPLAIN.limit[provider]` with `EXPLAIN.limitBack` ("It comes back on its own."), or `EXPLAIN.limitBackAtPrefix` plus the time only when the provider gave `until` (Claude's "resets 3pm"; ChatGPT gives no reset time and the app does not guess one); "ChatGPT didn't answer." with "Try again". No link to a usage page: the app opens only the provider's sign-in page and the shop, and that stays true.

### Keyboard

Enter sends; Shift+Enter adds a line. Escape stops a running turn; with nothing running and focus in the field it moves focus to the newest card's headline; it never clears the draft. Tab order is DOM order: the transcript's controls top to bottom, the chips, the field, Send or Stop. Shift+Tab from the field reaches the chips, then the newest card's link, then its primary, because the newest card is the last thing above the composer. Arrow keys are the browser's; there is no roving tabindex in the log. Cmd+L focuses the field through a window keydown handler in `ChatScreen.tsx`; it is not a menu item and does not fire while a text field other than the composer has focus. There is no Cmd+N. After a chip or a resolved card, focus moves to the newest app message's or card's headline (`tabIndex=-1`), as `StepFrame` does; focus returns to the field only after the person's own typed send and after Stop. Every card's primary is a `button`, every row and chip is a `button`, every model block is text nodes.

### Stop

Stop aborts the adapter at once (fetch abort, `claude_cancel`, `ai_cancel`), removes the partial text and every intent, keeps the person's turn with a meta line "Stopped." and one chip "Send again" that resends the same text. The composer re-enables with focus in the field. Nothing that could have become a card survives a Stop.

### Scrolling

The transcript scrolls to the bottom on every new message unless the person has scrolled up, in which case a small "New message ↓" pill appears at the bottom edge and scrolls on tap. A streaming reply does not fight the person's scroll. Focus never jumps on scroll.

### Empty and error states

The chat is never empty: the opening is always there. States with no report do not show the chat (section 2). A model turn that fails renders one app line with one way out, per the table in DESIGN-AI section 4, and keeps the person's turn. A chat opened while the brief is still writing shows the opening without the block, never "Reading your check-up." (that line belonged to Ask and is retired).

## 4. The intent set and the chat task

### The closed intent set

```ts
export const INTENT_KINDS = [
  "fix_rule",      // one in-app fix, the card is the step; 022 and 029 keep their chooser
  "fix_batch",     // the batch of unlocked batchable failing items
  "show_where",    // open the item's System Settings pane and watch
  "explain_rule",  // the existing explain task for one item, cached per item, behind a tap
  "open_details",  // the item's Details screen (manual and left-alone items)
  "show_list",     // the plan list, in place
  "rescan",        // start a fresh check-up
  "change_ai",     // the Connect screen
  "snooze_rule",   // "Do this later", 7 days, as actions.later
  "accept_rule",   // "I know, leave it", permanent until "Ask again"
  "open_watch",    // the watch's state, "See what to do" or "Check now"
] as const;
export type IntentKind = (typeof INTENT_KINDS)[number];
```

There is no `unlock` kind. A locked id is not an intent; the validator moves it into `locked` and the app draws the meta line or, when allowed, the lock card. There is no kind that takes a pane, a path, a screen name or a label: the pane comes from the catalogue, the path from the report's evidence or the plan's step, the screen from the kind.

Every kind renders a card or a row and nothing else. `explain_rule`'s card is the item's headline with the Explain disclosure open and its primary "Explain this"; the tap makes the call and counts in the Developer counter. `show_list`'s card is the list with no primary (it is rows). `rescan`'s card is "Shall I check again?" with primary "Check again". `change_ai`'s card is "Change which AI I use" with primary "Change". `open_watch`'s card is the watch's state with primary "See what to do" or "Check now". `snooze_rule` and `accept_rule` are one-tap cards whose primary writes memory. `open_details`'s card is the headline with primary "Details".

### Schema

`CHAT_JSON_SCHEMA` in `packages/core/src/explainer/schemas.ts`, next to `WATCH_JSON_SCHEMA`, flat and closed because the repo's `strictSchema` uses no `anyOf` and the Swift outputs have no union:

```ts
const INTENT = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "ruleId"],
  properties: {
    kind: { type: "string", enum: INTENT_KINDS },
    ruleId: { type: ["string", "null"], minLength: 1, maxLength: 32 },
  },
};

export const CHAT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "relatedRuleIds", "outsideScope", "intents"],
  properties: {
    reply: { type: "string" },
    relatedRuleIds: RULE_ID_LIST,
    outsideScope: { type: "boolean" },
    intents: { type: "array", maxItems: 3, items: INTENT },
  },
};
```

`fix_batch` carries `ruleId: null`; the batch set is the app's (the plan's batch step, or the batchable unlocked failing items when the plan has none). The model cannot pick a subset. "Leave the disk alone, fix the rest" is caught by the accept grammar for the first half, and the model's `fix_batch` for the second; the disk was never batchable anyway.

### Validator

`validateChat(raw, report, allowed, locked)` in `packages/core/src/explainer/validate.ts`, pure, next to `validateAnswer`. `allowed` is the `Allowed` record the app built for the request; `locked` is the gate's locked set and is a validator argument only, never serialised.

Whole-response rules:

- not an object: `rejected_output`;
- `reply` empty, over `EXPLAINER_LIMITS.maxOutputStringChars` (1200), or `containsCommandText(reply)`: `rejected_output`;
- `containsAppVoice(reply)` or `claimsAction(reply)` from the new `packages/core/src/explainer/prose.ts`: `rejected_output`. `containsAppVoice` is `\b(I|I'm|I'll|I've|I'd|me|my|we|we're|we'll|we've|our|the app|Talos)\b`, case-sensitive for `I`. `claimsAction` is `\b(I|we)('ve| have| just|'ll| will)? ?(fixed|turned|switched|changed|enabled|disabled|removed|deleted|installed|updated|ran|applied|locked|encrypted|opened|started|stopped)\b` and `^\s*Done\b`. The prompt tells the model to write in the second person; a reply that does not is thrown away, not shown;
- `outsideScope` not a boolean: `rejected_output`;
- `relatedRuleIds` not an array of strings: `rejected_output`; otherwise filtered per entry (kept when it matches `SAFE_STRING_PATTERN`, exists in `report.results`, and is not in `allowed.accepted` or `allowed.snoozed`), then clamped to `CHAT_LIMITS.maxRelated` (3). One hallucinated id never throws away a completed stream.

Intents are dropped, not rejected; the text stays. Per entry:

- not a record, or `kind` not in `INTENT_KINDS`: dropped;
- `ruleId` present must match `SAFE_STRING_PATTERN`, exist in `report.results`, and be in the matching allow-list (`fix` for `fix_rule`, `show` for `show_where`, `explain` for `explain_rule`, `details` for `open_details`, `snooze` for `snooze_rule`, `accept` for `accept_rule`), as `readId` checks `actionsAvailable` in `packages/core/src/watch/validate.ts`; otherwise dropped;
- a `ruleId` on a kind that takes none (`fix_batch`, `show_list`, `rescan`, `change_ai`, `open_watch`) is ignored;
- `fix_rule`, `show_where` or `explain_rule` with an id in `locked`: dropped from `intents`, appended to the result's `locked` list;
- `fix_batch` when `allowed.batch` is empty: dropped;
- a kind not in `allowed.kinds` (for example `open_watch` with the watch off, `fix_batch` with no live scan): dropped;
- duplicates by kind and id: the second dropped; `fix_rule` for an id inside a kept `fix_batch`: dropped; at most one each of `fix_batch`, `show_list`, `rescan`, `change_ai`, `open_watch`;
- more than three: the first three kept.

The result is `{ reply, relatedRuleIds, outsideScope, intents, locked }`. The app renders only ids that survived: the first intent as the live card, the rest as rows. Extra keys on an intent (a `path`, a `pane`, a `label`) are ignored by the validator and never read by the renderer.

### The allow-lists

`buildAllowed(plan, report, gate, scan, watch, memory)` in `packages/core/src/guided/allowed.ts`, pure and tested:

- `fix`, `show`, `explain` and `batch` are subsets of the rule ids in `plan.steps` that are undone: `fix` the fix steps, `show` the show steps (including converted ones), `batch` the batch step's ids, `explain` every undone step's id. `fix`, `show` and `batch` are empty unless `scan.kind === "ready"`;
- `snooze` is the undone step ids minus those with `laterCount >= 3`;
- `accept` is the undone step ids plus `plan.later` minus `memory.accepted`;
- `details` is every rule id in the report;
- `accepted` and `snoozed` (the ids to drop from `relatedRuleIds`) are `plan.accepted` and `plan.later`;
- `kinds` holds `fix_rule`, `fix_batch`, `show_where` only when `scan.kind === "ready"`, `open_watch` only when `watch.enabled`, and the rest always;
- nothing in `plan.accepted`, `plan.later`, `fixed` or `leftAlone` appears in `fix`, `show`, `batch`, `explain` or `snooze`.

`locked` is `gate.locked(plan)`: every eligible failing id outside the frozen `plan.freeFixes` when `gate.licensed` is false, else empty. It is passed to `validateChat` and never put in the envelope.

### What the model receives per turn

```ts
export interface ChatInput {
  readonly context: ExplainerContext;                 // toExplainerContext, unchanged
  readonly history: readonly Turn[];                  // clampChatHistory: last 6 turns remote, last 2 on this Mac; assistant turns are the validated reply text only
  readonly question: string;                          // clampQuestion at CHAT_LIMITS.maxQuestionChars (500)
  readonly plan: {
    readonly stepRuleIds: readonly RuleId[];          // one per undone batch, fix or show step, at most 10
    readonly fixed: readonly RuleId[];
    readonly later: readonly RuleId[];
    readonly accepted: readonly RuleId[];
    readonly leftAlone: readonly RuleId[];
  };
  readonly allowed: {
    readonly fix: readonly RuleId[];
    readonly batch: readonly RuleId[];
    readonly show: readonly RuleId[];
    readonly explain: readonly RuleId[];
    readonly details: readonly RuleId[];
    readonly snooze: readonly RuleId[];
    readonly accept: readonly RuleId[];
    readonly kinds: readonly IntentKind[];
  };
  readonly events: readonly { kind: ChatEvent; ruleIds: readonly RuleId[]; turnsAgo: number }[]; // at most 10
  readonly watch: {
    readonly enabled: boolean;
    readonly rating: Rating;
    readonly lastCheckMinutesAgo: number | null;
    readonly items: readonly { signalId: SignalId; kind: FishyKind; change: Change }[];  // at most 6, never WatchDetails
  };
}
```

`ChatEvent` is `fixed | did_not_change | snoozed | accepted | pane_opened | rescanned`. `wrong_password`, `cancelled`, `could_not_check`, `timeout`, `watch_passed`, `watch_expired`, `unlocked`, `stale` and `stopped` are app-side outcomes (`ChatOutcome`) and never leave the Mac: the outcome of the macOS password dialog and whether the person paid are not the model's business. There is no `licence` field and no `plan.locked`; the lock is handled by an app line, never model prose, so the model has nothing to say about it.

Every value is an id under `SAFE_STRING_PATTERN`, a closed enum, a boolean or a finite number. The only free strings are the person's typed text and prior validated replies, both the person's own words after the composer's guard. `allowed.accepted` and `allowed.snoozed` are validator-side only and not serialised. `chatTurns(input)` in `packages/core/src/explainer/remote.ts` builds history first and the envelope `{ task: "chat", context, question, plan, allowed, events, watch }` in the last user turn, like `askTurns`, and never ends on an assistant turn.

### The system prompt

The frozen system prompt from `buildSystemPrompt` is shared with the watch and pinned by `packages/core/fixtures/watch-instructions.txt` and the Rust `watch_instructions` test; it does not change. The chat gets its own per-task block appended after it, the way `buildWatchInstructions` appends `WATCH_INSTRUCTIONS_BLOCK`: `buildChatInstructions()` in `packages/core/src/explainer/remote.ts` returns `buildSystemPrompt(catalog) + CHAT_INSTRUCTIONS_BLOCK`, used as ChatGPT `instructions` and Claude `--system-prompt` for the `chat` task only. The watch request does not grow, and the shared prefix stays shared. The block is pinned in `packages/core/fixtures/chat-instructions.txt`.

`CHAT_INSTRUCTIONS_BLOCK`, verbatim:

> For the chat task: answer the person in plain British English, in the second person, in at most four short sentences. Never write as "I", "we" or the app. Never say that you did, will do, are doing, or have changed anything: you cannot change anything, the app draws the buttons and the person decides. Never write what to click, type or run; never name a command, a file path or a setting's menu path. Name actions only in `intents`, as ids from `allowed`, at most three, most useful first; leave `intents` empty when nothing in `allowed` fits. Other tasks have no `intents` field. When the person asks to leave something alone, use `accept_rule`. When the person asks about something the check-up does not cover, set `outsideScope` to true and say so in one sentence.
>
> Plain names, so you can say "your disk is not locked" rather than an id:
> TL-MAC-001: Your disk is not locked
> TL-MAC-002: The firewall is off
> …

The plain-name list is every rule's `guided.headline`, generated from the catalogue, about 1,200 characters. It sits in the chat block, not in the frozen prompt, so the watch never receives it.

### On this Mac

The on-device prompt (`packages/core/src/explainer/on-device-prompt.ts`) gains a `chat` shape that renders the `ask` output (`answer`, `relatedRuleIds`, `outsideScope`) with no intents, the question, 2 history turns of 400 characters, 8 findings (fail by points first), catalogue explanations for the top 2 failing items only, the plain names of the undone steps, and a 5,000-character ceiling. The app derives cards with `cardsFromRelated(relatedRuleIds, allowed)` in `packages/core/src/guided/allowed.ts`, pure and tested with the same cases as intents: for each id that is in `allowed.fix`, `allowed.show` or `allowed.details`, in that order of preference per id, one card of that kind, at most three, in `allowed` order; the first is live, the rest rows. A derived card's link is the step's own ("Do this later" or "I'll do it later"); the chip row after it carries "Leave it alone" for that item so the accept is one tap. The chips carry the rest.

## 5. Worked conversations

Dev machine fixture (13 findings, score 38), ChatGPT, unless noted. Rule ids are for this document only.

### First launch after connecting (licensed)

> **I found 7 things to fix.**
> I can fix 4 of them for you now. The other 3 I'll show you where.
> ┃ Your Mac goes out with you and its disk is not locked, so a lost bag means lost photos and open accounts. The firewall is the quick one and the app puts it first.
> ┃ Written by ChatGPT. Not verified.
> [Do them all] [Fix what you can] [What is urgent?] [Show me the list]

Zero calls. The block is from `last-brief.json`; on a new plan it lands a few seconds later or not at all.

### "Fix what you can"

The chip is an action. The person's turn "Fix what you can" appears, then the app's live card and one row, no call:

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

Tap "Fix these for me": the card's primary is replaced by `STATUS.password`, macOS asks, then `STATUS.working`, then the rows settle under the card:

> ✓ The firewall is on
> ✓ Your Mac stays quiet
> ✓ App Store apps update on their own
> Done. 3 things fixed.
> ▍ **A shared folder has no password**
> Documents
> Anyone on your network can open it without a password. I can fix that for you. Your Mac will ask for your password.
> [Stop sharing it]
> Do this later
> ▸ Explain this
> [What's next?] [Show me the list] [Check again]

The 022 row became the live card when the batch resolved. A batch row that did not change becomes a show-me-where row under the result when the item has a pane, as `routeFailed` does. "Documents" is the folder name from the `sharePath` evidence, rendered locally.

### "Do them all"

The same opening. The batch card is live; after its tick the 022 card appears 1400 ms later, then the 026 backup question, then the 001 show card, then the 010 show card, each one becoming live as the previous resolves. A show card waits for its watcher; "What's next?" moves on without it. When the last resolves, the end message:

> **Your Mac is safer than it was.**
> I'll check again next time you open me.
> Still waiting: Your disk is not locked ›
> ┃ Four of the seven are done and the firewall was the one that mattered most on a Mac that travels. The disk is the one left that would hurt.
> ┃ Written by ChatGPT. Not verified.
> [Show me the list] [Check again]

### "What is urgent?"

An action chip, zero calls:

> **This one is urgent: An update is waiting.**
> Until it is installed, your Mac is missing fixes Apple has sent.
> ▍ **An update is waiting**
> Until it is installed, your Mac is missing fixes Apple has sent. macOS has to do this one, so I'll open the right page and wait.
> [Show me where]
> I'll do it later
> ▸ Explain this
> [Why?] [What's next?] [Show me the list]

"Why?" sends "Why does an update waiting matter?" as the person's turn, one call, and the model's prose lands above a row for the same item (the card is already on screen, so the validator's `show_where TL-MAC-006` renders as a row, not a second card).

### "Why does the disk matter?"

Typed, one call. The reply streams:

> ┃ Your disk holds your photos, documents and saved logins in a form anyone can read once the Mac is in their hands. Locking it means a thief gets a brick, not your life. You travel with this Mac, so this is the one that matters most for you.
> ┃ Written by ChatGPT. Not verified.
> ▍ **Your disk is not locked**
> If your Mac is lost or stolen, anyone can read your files. macOS has to do this one, so I'll open the right page and wait.
> [Show me where]
> I'll do it later
> ▸ Explain this

The model returned `intents: [{ kind: "show_where", ruleId: "TL-MAC-001" }]`; 001 is in `allowed.show`, so the card is drawn. Tap: the FileVault pane opens, `SHOW.opened`, `guided.where` ("Click "Turn On" next to FileVault. Write down the recovery key it shows you. Your Mac may restart."), `SHOW.notice`, and the watcher runs with "Check again" as the card's link.

### "Leave the disk alone"

Typed. The accept grammar matches "disk" to 001 before any call:

> **Leave the disk alone**
> ▍ **Your disk is not locked**
> I'll stop bringing this up. You can change your mind in Settings.
> [Leave it alone]
> Not now

Tap "Leave it alone": `memory.accepted["TL-MAC-001"] = now`, a result line "OK. I'll leave this one alone and won't bring it up again. You can change that in Settings." appends under the card. The plan drops its 001 step; the opening of the next check-up does not count it; the end screen lists it under "Things you chose to leave". The score still shows the cap. Zero calls, the same on every provider.

Typed "I'd rather not encrypt the disk, is that a problem?" misses the grammar and goes to the model, one call. The model answers in the second person and returns `accept_rule TL-MAC-001`, which renders the same accept card under its prose.

### Something the model cannot do

Typed: "turn the safety guard back on for me". 005 is manual and left alone; it is in `allowed.details` only.

> ┃ That guard can only be switched back on from your Mac's recovery screen, which is a restart away and something to do by hand with the instructions in front of you. The app cannot do it for you.
> ┃ Written by ChatGPT. Not verified.
> ▍ **A built-in safety guard is off**
> I can't do this one from here. I'll show you the details instead.
> [Details]

If the model had returned `fix_rule TL-MAC-005`, the validator would have dropped it (not in `allowed.fix`) and the app would still render the Details card from `relatedRuleIds`. Typed "change my Apple password" gives `outsideScope: true`: the model's sentence, then the app line "That's outside what the check-up covers." and no card. Typed "run sudo spctl --master-enable" never leaves the Mac: the composer's guard answers "I can't read paths or commands. Say it in words and I'll answer."

### A reply in the wrong voice

The model streams "Done, I have turned your firewall on for you." The partial check catches `claimsAction` at "I have turned" and cancels the request as `rejected_output`; the partial is removed and the app line "I couldn't use that answer. Try asking another way." takes its place. The firewall's state is unchanged and the only record of what happened is the app's own result lines.

### The free version

The free three on the dev machine are 002, 001 and 010; 003, 011, 022 and 026 are locked. The composer is present and typed turns run as for a licensed person; only the fixes differ. "Fix what you can":

> **Fix what you can**
> ▍ **The firewall is off**
> It keeps other computers on the same Wi-Fi from reaching your Mac. I can fix that for you. Your Mac will ask for your password.
> [Turn it on]
> Do this later
> ▸ Explain this
> 3 more in the full version.

After the firewall card resolves, and only if `paywallSnoozedUntil` is absent or past and the lock card has not appeared this check-up, the lock card of section 3 is appended once. "Not now" snoozes it for 14 days and the meta line is all the free person sees of the lock until then. Every card is explained from its disclosure and every question can be typed, with no mention of the lock; a typed turn that points at a locked id gets the meta line "3 more in the full version." where its card would be.

### The watch's act now

Pushed as an app message when the watch transitions, or when the window opens on "noticed":

> **A new program started running on its own**
> I noticed this at 14:32. It was not there at the last check. I have not deleted anything.
> ▍ Experts would cut it off first. CISA's ransomware checklist, step 1.
> [See what to do]
> This is fine, I know it

"See what to do" opens the fishy flow with `returnTo: { name: "chat" }`. On return, the chat appends "I'll keep watching more closely for a day." when the recover screen ran, or nothing when the person left early. "This is fine, I know it" acknowledges the signal and appends "OK." No model call is made for this message; the watch's own call already happened in Rust.

### AI unavailable mid-chat

The person sends "why does the backup matter?" and ChatGPT answers 429 before streaming, or `response.failed` with `subscription_sharing_usage_limit_exceeded` after the first words:

> **why does the backup matter?**
> Stopped. (meta)
> Your ChatGPT allowance is used up for now. It comes back on its own.
> [What's next?] [Show me the list] [Check again]

The partial text is removed. The composer shows the limit line in place of the field; the chips keep working; every card keeps working because fixes need no AI. On Claude the line ends "It comes back at 15:00." when the result carried a reset time. `ai.report({ state, until })` schedules the re-probe. When the state returns to `available` the field returns silently and the chip "Send again" reappears on the stopped turn. On `needs_sign_in` the line is "ChatGPT signed me out." with "Sign in again" (Connect, `returnTo: chat`). The chat never flips to the plan screen mid-conversation.

### On this Mac

The same "Why does the disk matter?" on Apple Intelligence:

> ┃ A locked disk keeps your files unreadable if the Mac is lost. Yours is not locked and it leaves the house, so this matters.
> ┃ Written on this Mac by Apple Intelligence. Not verified.
> ▍ **Your disk is not locked** … [Show me where] · I'll do it later · ▸ Explain this
> [Leave it alone] [What's next?] [Show me the list]

The card came from `relatedRuleIds: ["TL-MAC-001"]` through `cardsFromRelated`. "Leave it alone" renders the accept card for 001 with no call.

## 6. Budget, caching and speed per provider

Measured baseline (DESIGN-AI-PRESENCE section 3, dev fixture): frozen system prompt 16,284 characters (about 4,000 tokens), derived document 2,452 characters (about 600 tokens), one Ask body about 5,000 input tokens. The chat block adds about 1,600 characters (about 400 tokens) to the instructions for the chat task only.

**Limits.** `CHAT_LIMITS` in `packages/core/src/explainer/limits.ts`: `maxQuestionChars` 500; reply 1,200 characters (the existing validator cap); `maxIntents` 3; `maxRelated` 3; `maxChips` 4; `maxHistoryTurns` 6 remote (3 exchanges) and 2 on this Mac at 400 characters; `maxEvents` 10; `maxWatchItems` 6. `clampChatHistory(history, provider)` keeps the most recent turns, as `clampHistory` does. A remote turn is about 4,400 (instructions) + 600 (document) + up to 1,800 (history) + the question, so 7,000 to 7,500 input tokens.

**The window slides.** When history reaches six turns the oldest exchange is dropped on the next send. There is no fresh-thread line and no reset the person has to notice. OpenAI's prompt cache matches the longest identical prefix, so the instructions (frozen prompt plus chat block) are first and unchanged and stay cached whichever history turns follow; what sliding loses is at most the history part. Whether cached tokens count less against a ChatGPT plan allowance is not documented and is treated as unknown; the design does not pay anything for it. The derived document is resent in every last turn (about 600 tokens); that is the price of keeping state out of the history.

**Zero-call turns.** The opening (authored, plus the cached brief). Every chip but "Why?". Every card and row. The accept grammar. The composer's machine-text guard. "Explain this" on an item already in `cacheRef.byRule`. The lock card, the limit line, the refusal lines, the end message.

**Calls per check-up.** The chat adds no app-started call. DESIGN-AI-PRESENCE's ceiling of 3 app-started calls per landed plan is unchanged and the chat reads what those calls produced. Typed turns, "Why?" and "Explain this" taps are person-started and uncapped; the provider's `limit_reached` is the stop. The watch keeps its own 24 a day in Rust. Developer mode shows "Calls this check-up: n" under the composer, counting typed turns, "Why?" and explain taps.

**One request at a time.** `useChat` owns its own `AbortController` ref and `busy` flag and calls the explainer port directly; it does not go through `runExplain` in `useScan`, whose non-ready branch neither streams nor honours `busy`. `useChat` and the explain slot of `useScan` check each other: a chat turn is refused with the authored line while an explain disclosure streams, and an explain tap is refused with `EXPLAIN.busy` while a chat turn streams. On Claude Code and on this Mac the Rust side is one request at a time regardless. The person's turn wins over an app-started call: a running brief is aborted and awaited before the turn starts, as DESIGN-AI-PRESENCE section 3 specifies.

**Streaming and Stop.** `reply` streams through the partial-JSON reader on the `ask_partial` path; `snapshotHasCommandText`, `containsAppVoice` and `claimsAction` run on every partial and a hit cancels the request as `rejected_output` before the text is shown further. Intents are read from the final value only. Partials are throttled at 80 ms on every provider. Timeouts stay the adapters' own: ChatGPT 90 s whole, Claude Code 60 s to first partial and 180 s whole, Apple 25 s and 90 s. The 8 s "Still waiting" line is the chat's only addition.

**ChatGPT.** Responses API, `store: false`, strict schema, `instructions` first, `reasoning: { effort: "low" }` as today. `max_output_tokens` stays `RESPONSES_MAX_OUTPUT_TOKENS` (4,000) as `explain` and `ask` send it, because reasoning tokens count against the cap and a 1,200 cap would turn a long answer into `response.incomplete`. `response.incomplete` is mapped to `rejected_output` in `chatgpt-explainer.ts` without setting `cache.unavailable`; `response.failed` with a usage code (`subscription_sharing_usage_limit_exceeded`) is mapped to `limit_reached` and cached 300 s (today every `failed` is `provider_unavailable`; `parseResponsesEvent` already yields the code). When the adapter's `plainOutput` fallback is set (one 400 `subscription_sharing_unsupported_capability` earlier in the session), the chat sends the `ask` shape and derives cards from `relatedRuleIds` as on this Mac; a reply that still does not parse is one `rejected_output` line, and after two in a row the composer shows the `provider_unavailable` line with "Try again".

**Claude.** One `claude -p` spawn per turn with the locked-down flags of DESIGN-AI section 9, 3 to 5 s to the first word. When a watch call is in flight, `take_slot` cancels it and waits up to `YIELD_WAIT` (5 s) first, so the worst case is about ten seconds, past the 8 s "Still waiting" line, which is correct: the line says the app is waiting, and it is. Settings > Your AI gains one sentence under the Claude pill: "Claude takes a few seconds to start each reply, sometimes ten." `--resume` is not used: it needs `--no-session-persistence` dropped, writes transcripts holding the derived document and the model's text under the app's config folder, and still spawns. A long-lived `--input-format stream-json` process is spiked behind a Developer flag on a real Mac before it is designed: whether `--json-schema` yields `structured_output` per turn, how one turn is cancelled without killing the process, and the resident memory of an idle process. Whether the watch should defer while the chat is on screen is open question 6; `cycle.rs` is being changed in the tree and this document does not touch it.

**On this Mac.** One `LanguageModelSession` per request, so every turn starts with an empty 4,096-token window. Instructions about 300 tokens, prompt at most 5,000 characters (about 1,250 tokens), output `MAX_TOKENS` 600 in `engine.rs` (the webview sends no cap and this document adds none), total about 2,150, leaving about half the window for tokenizer variance. Trim order on overflow: events, watch, history, catalogue explanations, findings, as the existing loop. One retry without explanations on `context_window`, then `too_long`. No plan limit; the cost is wall time.

**First paint.** The chat renders complete at mount with zero calls: the opening, the chips, the composer. There is never a spinner before the first screen and never a "Reading your check-up" line.

## 7. Contracts

### Core (`packages/core`)

- `src/explainer/chat.ts`: `INTENT_KINDS`, `IntentKind`, `ChatIntent`, `ChatInput`, `ChatEvent` (`fixed | did_not_change | snoozed | accepted | pane_opened | rescanned`), `ChatOutcome` (`ChatEvent` plus `could_not_check | cancelled | wrong_password | timeout | watch_passed | watch_expired | unlocked | stale | stopped`), `ChatResult`.
- `src/explainer/prose.ts`: `containsAppVoice`, `claimsAction`; `src/explainer/schemas.ts`: `CHAT_JSON_SCHEMA`; `src/explainer/validate.ts`: `validateChat(raw, report, allowed, locked)`; `src/explainer/remote.ts`: `RemoteTask` gains `chat`, `chatTurns`, `SCHEMAS.chat`, `CHAT_INSTRUCTIONS_BLOCK`, `buildChatInstructions`; `src/explainer/limits.ts`: `CHAT_LIMITS`, `clampChatHistory`; `src/explainer/on-device-prompt.ts`: the `chat` shape on the `ask` output; `src/explainer/system-prompt.ts` unchanged.
- `src/ports/explainer-port.ts`: `ExplainerPort.chat(input, onPartial, signal)` returning the `ask`-style stream of `ChatResult`; `EXPLAINER_LIMITS` unchanged.
- `src/guided/memory.ts`: `accepted: Readonly<Record<string, string>>` (rule id to ISO), parsed with `dateMap` like `waiting`; `aiLastAvailable: { provider: ExplainerProvider; at: string } | null`, `AI_LAST_AVAILABLE_TTL_MS` (7 days); version unchanged. `src/guided/plan.ts`: `bucketFor` gains `accepted` before `later`; `GuidedPlan.accepted: RuleId[]`; accepted ids are never steps and never in `later`. `src/guided/next.ts`: `nextAction` excludes accepted ids. `src/guided/allowed.ts`: `buildAllowed`, `cardsFromRelated`. `src/guided/plain-names.ts`: the per-rule synonym list for the accept grammar and the plain-name list for the chat block. `src/guided/diff.ts` unchanged.
- `src/explainer/context.ts` unchanged. `src/license/entitled.ts`: `explainer` removed, `watch` added (2026-10-17).
- Fixtures: `fixtures/explainer-schemas.json` regenerated with `pnpm fixtures:emit` and pinned (`explain, prioritise, ask, watch, chat`); `fixtures/chat-instructions.txt` added and pinned; `fixtures/watch-instructions.txt` unchanged, and its test proves it.

### Adapters (`apps/desktop/src/adapters`)

- `chatgpt-explainer.ts`: `chat` task through the existing stream path with `buildChatInstructions()` as `instructions`; `response.incomplete` to `rejected_output` without touching `cache.unavailable`; `response.failed` with a usage code to `limit_reached`; the `plainOutput` fallback uses the `ask` shape for `chat`.
- `claude-plan-explainer.ts`: `chat` with `buildChatInstructions()` as the system prompt.
- `apple-explainer.ts`: `chat` renders the on-device `chat` prompt and asks for the `ask` output; `relatedRuleIds` returned as today; the partial check runs `containsAppVoice` and `claimsAction` beside `snapshotHasCommandText`.
- `demo-explainer.ts`: canned `chat` replies by fixture (below); `streamFields` gains a fail-after-N-partials path.
- `index.ts`: `NoExplainer.chat` returns `{ ok: false, reason: "off" }`.

### Rust and Swift

- `ai/protocol.rs`: `Task::Chat`; `ai/schemas.rs`: `for_task(Chat)`; `ai/mod.rs`: `chat` allowed from the webview like `ask` (the test `the_webview_may_name_every_task_but_watch` gains `chat` on the allowed side); `tests/explainer_schemas_contract.rs` pins the copy. The `watch_instructions` test and `chatgpt_watch.rs`'s `include_str!` are unchanged.
- The sidecar's `Outputs.swift` is unchanged: on this Mac the chat uses `AnswerOut`. `engine.rs`'s `MAX_TOKENS` 600 is the on-device output cap; no `maxTokens` field is added to the request.
- No new commands and no new URL. Every card calls `fix_preview`, `fix_apply`, `fix_preview_batch`, `fix_apply_batch`, `fix_reveal`, `open_settings_pane`, `watch_*` as today, with rule ids, catalogue choices and paths from the report's evidence only.

### Desktop state (`apps/desktop/src/chat`)

- `useChat(core, scan, ai, gate, watch, connect, router, settings, explainer)`: the transcript as `useReducer` state outside the scan machine; its own `AbortController` ref and `busy` flag; actions `opened(plan, diff, brief)`, `person(text)`, `model_partial`, `model_ready(result)`, `model_failed(reason)`, `stopped`, `card_started(cardId)`, `card_result(cardId, outcome, ruleIds)`, `row_promoted(rowId)`, `end_reached`, `watch_noticed(item)`, `limit(state, until)`, `cleared`.
- `controller.ts`: `send(text)`, `chip(id)`, `runCard(cardId, passphrase?)`, `later(cardId)`, `accept(ruleId)`, `promote(rowId)`, `doThemAll()`, `stop()`.
- **How cards enter the step machinery.** The guided phase gains `{ kind: "chat"; plan: GuidedPlan; active: GuidedStep | null; walking: boolean }`. `currentStep(core)` in `apps/desktop/src/guided/core.ts` returns `phase.active` when the phase is `chat`, so `startFix`, `startBatch`, `startShow`, `settleFix`, `settleBatch`, `observeWatch`, `markStale` and `routeFailed` in `runFix.ts`, `runBatch.ts` and `runShow.ts` work unchanged on the chat's live card. `runCard` sets `active` to the card's step (appending it to `plan.steps` through `appendSteps` when it is not already there, as `doNext` does for the end screen), calls the same run helper the guided primary calls, and clears `active` on settle. `appendSteps` and `doNext` accept the `chat` phase. `rebuilt()` in `landing.ts` gains the chat case: the plan is rebuilt on the same memory and the transcript is kept, with `cardFor`'s live check collapsing any card whose item left `allowed`. `landed()` gains the chat branch of section 2. `fixed`, `leftAlone` and the end screen stay correct and the walk-through sees the same plan.
- `allowed.ts` (desktop): the thin call into core's `buildAllowed` with the live `scan`, `watch` and `gate`; `cards.ts`: `cardFor(intent, plan, catalogue, allowed)` with the live check; `chips.ts`: `chipsFor(state)`; `accept-grammar.ts`; `transcript.ts`: the message types.
- `ChatScreen.tsx`, `ChatMessage.tsx`, `ChatCard.tsx`, `ChatRow.tsx`, `ChatComposer.tsx`, `ChatChips.tsx`, `ChatStatus.tsx` (the one status element outside the log). CSS in `styles/chat.css` on the Mineral tokens; the Ask classes are retired.
- `guided/copy.ts` gains `CHAT` (every authored string in sections 3 and 5: the chips, the composer placeholder, the refusal lines, the guard line, the accept and stopped lines, the still-waiting lines, the stale lines, the urgent and first-step lead lines, the lock card's headline template, the meta line template "N more in the full version.", "Things you chose to leave", "Ask again", "Leave it alone", "Calls this check-up").
- `guided/landing.ts`: the phase rule of section 2. `guided/screens/Guided.tsx`: the `chat` phase. `GuidedShell.tsx`: the strip items. `EndScreen.tsx`: the "Things you chose to leave" group. `screens/FindingDetail.tsx`: the "Leave it alone" link and "Ask again". `screens/Settings.tsx`: the accepted list under Check-up, the chat-home switch, the Claude sentence. `components/Sidebar.tsx`: "Chat". `App.tsx`: the probe at launch, the watch message routing to the chat, `ask` route removed, the AI-off transition of section 2.
- `scan/useScan.ts`: `conversation`, `draft` and `ask` removed; `present()` no longer resets a conversation. `scan/useAiAvailability.ts`: writes `memory.aiLastAvailable` on every settled probe.

### Routes

`{ name: "chat" }` added, `{ name: "ask" }` removed, `returnTo` on `connect` and `fishy` may be `chat`.

### Settings

`guided.chatHome: boolean`, default `true`, row "Start with the chat when my AI is connected" under Check-up, with the sentence "Off shows the step-by-step check-up first. The chat stays one tap away." No other new setting. `explainer.aiEnabled` stays the one switch that removes every AI surface, the chat included.

### Demo params (`app/demo-boot.ts`, `adapters/demo-explainer.ts`)

`provider=chatgpt&ai=available` as today seeds the chat home (with `memory` carrying `aiLastAvailable`); `chat_reply=<id>` picks a canned reply from a fixture table (`urgent`, `disk`, `leave_disk`, `cannot`, `outside`, `inject`, `too_many`, `app_voice`); `chat_fail=limit_reached|needs_sign_in|provider_unavailable|rejected_output` fails the next turn; `chat_fail_after=N` fails after N partials through the new `streamFields` path; `memory=<json>` seeds `accepted` and `aiLastAvailable`; `watch=act` seeds the act-now item as today; `licensed=1`, `fixture=`, `batch=`, `fix=` as today. There is no `brief=` param and no brief shot until DESIGN-AI-PRESENCE's `BriefStore` exists. Calls are recorded as `{ kind: "chat", arg: { question, allowed } }`.

### Docs touched

`docs/SECURITY-MODEL.md` Boundary 3 lists the `chat` envelope field by field: `context`, `history` (validated reply text and the person's typed words), `question` (the person's typed words after the composer's guard), `plan.stepRuleIds`, `plan.fixed`, `plan.later`, `plan.accepted`, `plan.leftAlone`, `allowed.*` (ids and the kinds enum), `events` (the six `ChatEvent` values and ids), `watch` (enabled, rating, minutes, signal ids and enums); it states that licence state, the outcome of the password dialog and every path stay on the Mac. "Injection defences" gains: "An intent is an id from a list the app put in the request. The app draws the card from the catalogue and runs nothing until the person taps. The model's text is never a control label. A reply in the app's voice or claiming a change is thrown away." `docs/DESIGN-V03.md` section 1 gains the one-live-card sentence; section 7's harness assertion gains the chat exception. `docs/DESIGN-AI-PRESENCE.md` section 1 records the placement amendment and section 8 strikes "a chat anywhere but Ask". `docs/DESIGN-AI.md` section 3 records that the probe starts with the scan and the home reads the stored result. `readme.md` gains one paragraph on the chat.

## 8. Tests and QA

**Canary (`packages/core/test/explainer/remote.test.ts`).** `chat` joins `TASKS`, `TURNS`, the two adapter loops and the schemas table with a `ChatInput` built from `evaluate(CANARY)`, the canary `watchContext` (ids only into `watch.items`), `PRIOR_ANSWER` in history, every `ChatEvent` once in `events`, and `allowed` from `buildAllowed` on the canary report. Assert the ChatGPT and Claude bodies contain neither `INJECT` nor `IGNORE`, no `WatchDetails` field name, no `/Users`, no `sharePath`, `plistPath` or `label` substring, neither `licensed` nor `locked` nor `unlocked` nor `wrong_password` nor `cancelled`, and that every id in `plan.*`, `allowed.*`, `events[].ruleIds` and `watch.items[].signalId` matches `SAFE_STRING_PATTERN` and is a subset of the report's ids or the closed signal sets. A second case passes `inj("question")` and asserts it appears only inside `"question":`. A third asserts `buildWatchInstructions()` equals the pinned fixture after the chat block exists, and `buildChatInstructions()` equals its own. `on-device-prompt.test.ts` adds `chat` and asserts under 5,000 characters on `DEV_MACHINE` with 8 findings.

**Validator (`validate.test.ts`).** A reply with `{ kind: "run_command" }`, `{ kind: "fix_rule", ruleId: inj("ruleId") }`, `{ kind: "fix_rule", ruleId: "/Users/alice" }`, `{ kind: "fix_rule", ruleId: "TL-MAC-005" }` (manual), `{ kind: "fix_rule", ruleId: "TL-MAC-022", path: "/tmp/x" }` (extra key ignored), a locked `fix_rule`, a locked `show_where` (both land in `locked`), an id not in the report, a duplicate, a `fix_rule` inside a kept `fix_batch`, five intents: every bad entry dropped, three kept, `reply` kept. `relatedRuleIds` with one hallucinated id and one accepted id: both dropped, the rest kept, the reply kept; five good ids: three kept. A fenced block or a `sudo ` line in `reply`: `rejected_output`. "I've turned on your firewall", "Done. Your disk is locked.", "We changed that for you" and "The app will fix it": `rejected_output`; "You can turn it on from the button below" and "Your disk is not locked": kept. `open_watch` with `allowed.kinds` lacking it: dropped. The catalogue sweep of DESIGN-AI-PRESENCE section 7 stays, now also against `containsAppVoice` on every `guided.why` to prove the authored text would never be mistaken for the model's.

**Allowed (`allowed.test.ts`).** `buildAllowed` on the licensed dev machine: `fix`, `show`, `batch`, `explain` are subsets of the undone step ids; nothing from `accepted`, `later`, `fixed` or `leftAlone` appears in an action list; `snooze` drops `laterCount >= 3`; `accept` drops `memory.accepted`; `fix`, `show`, `batch` empty when `scan.kind !== "ready"`; `open_watch` absent from `kinds` when the watch is off. `cardsFromRelated` with a fix id, a show id, a details-only id, an accepted id and five ids: three cards, in `allowed` order, the accepted id dropped.

**Plan and memory.** `parseGuidedMemory` with and without `accepted` and `aiLastAvailable`, a damaged date; `buildGuidedPlan` on the licensed dev machine with `accepted: { "TL-MAC-001": now }` yields no `show:TL-MAC-001`, `accepted: ["TL-MAC-001"]`, and 5 steps; `nextAction` never returns an accepted id; the free set is unchanged by accepting. The accept grammar: "leave the disk alone", "I know about the firewall", "don't remind me about backups", "skip FileVault" each resolve to one id; "leave it" with no item resolves to none; a path in the phrase is caught by the guard first.

**Desktop (`vitest`, jsdom).** `useChat`: the opening with and without a brief and with a diff; chips by state; every action chip makes no explainer call; "Why?" makes one; a validated turn with every intent kind makes no explainer call, no navigation, no `open_settings_pane` and no `start()` until a primary is pressed; `allowed` is recomputed when `scan.kind` leaves `ready`; the lock card appears once per check-up and not within `paywallSnoozedUntil`; the meta line otherwise; `present()` clears the transcript and renders a new opening; Stop aborts and discards intents; `limit_reached` mid-stream removes the partial and disables the field, and `available` re-enables it with no message; a fix landing from the walk-through while a turn streams turns the pending `fix_rule` card into the stale line; the watch message on `act_now` and its acknowledge; the sliding window at six turns with no app line; the typed text equal to a chip routes with no call; the accept grammar routes with no call; the guard line on a pasted path; AI off mid-chat moves the phase to `plan` with a card in flight settling through `Core`; the end message after the last step is snoozed; "Do them all" auto-advances after a tick and waits on a show card; resume after a permission relaunch appends the first undone card. `ChatCard`: at most one `.button-primary` and at most one `.guided-link` per card in every state, none while working; the Explain disclosure on fix, batch and show cards; the 029 card holds the passphrase form; the 026 question card; the 022 card shows the folder name. `ChatComposer`: Enter, Shift+Enter, Escape in the three states, Tab and Shift+Tab order, Escape never clears. Live regions: a jsdom test of the status element's text at each step (writing, still waiting, stopped, password, working, done) and that the log's text content does not change while a model block streams. The copy test walks `CHAT` and the new `END`, `SETTINGS` and Details strings under the banned-word list and the syllable ceiling on headlines.

**Rust.** `chat` accepted from the webview; `watch` still refused; the schema contract test; the `watch_instructions` fixture test unchanged and passing; the no-`println!` grep covers nothing new.

**Harness (`apps/desktop/qa/harness.ts`), demo, light and dark, 1100x760 and 900x600, axe on all.** `chat-opening`, `chat-opening-since`, `chat-opening-nothing`, `chat-opening-free`, `chat-batch-card`, `chat-batch-working` (volatile), `chat-batch-done`, `chat-fix-chooser-share`, `chat-fix-passphrase`, `chat-show-card`, `chat-show-opened`, `chat-urgent`, `chat-do-them-all` (volatile), `chat-end`, `chat-model-streaming` (volatile), `chat-model-cards`, `chat-accept`, `chat-accept-grammar`, `chat-cannot`, `chat-outside`, `chat-guard`, `chat-app-voice`, `chat-lock-card`, `chat-lock-meta`, `chat-limit`, `chat-signed-out`, `chat-stopped`, `chat-stale`, `chat-watch-act-now`, `chat-apple`, `chat-reduced-motion`, `chat-dev-calls`, `guided-strip-step-by-step`, `end-accepted-group`, `settings-accepted`, `settings-chat-home`. Assertions: on every `chat-*` shot each `.chat-card` has at most one `.button-primary` and at most one `.guided-link`; exactly one `.button-primary` inside `.chat` on every shot where a card is idle and none on `chat-batch-working`; the composer holds no `.button-primary`; every `.guided-model` has a `.chat-badge` under it; no `[aria-live]` inside `.chat` other than the log itself and exactly one `[role="status"]` on the page, outside the log; the newest card's primary sits above the 600 px fold at 900x600 when a card is the last message; `__talosDemoCalls` records no `chat` call on `chat-batch-card`, `chat-urgent`, `chat-accept-grammar` and `chat-guard`, and one on `chat-model-cards`; no URL ever; no card appears before the demo stream completes on `chat-model-streaming`; no `.chat-composer` on `chat-opening-free`.

**Only on a real Mac.** Claude's time to first word per spawn, with and without a watch call to yield; the long-lived process spike; the on-device window on three fixtures; a ChatGPT limit arriving mid-stream; a ChatGPT session in `plainOutput` fallback; VoiceOver's reading of the status element against the jsdom test.

## 9. Out of scope

- The menu bar watch not ticking (the owner's first bullet). `apps/desktop/src-tauri/src/watch/cycle.rs` is being changed in the tree; the chat reads `watch.state` and calls the existing controller, nothing more. Whether the cycle should defer while the chat is on screen is open question 6.
- Building the `checkup` task, `BriefStore` and `last-brief.json` (DESIGN-AI-PRESENCE). The chat reads them when present and is complete without them.
- A long-lived Claude Code process; `--resume`; any transcript on disk; the model choosing the batch set or the plan order; model-written chips or follow-ups; a chat in the small watch window; voice; the model calling tools; more than one provider at a time; an accept without a tap; a free taste of typed turns; a link to the provider's usage page.
- A chat with AI off or not connected; a chat on a Mac where On this Mac cannot run.
- Provider logos, other providers, Windows and Linux, localisation beyond British English, payment and the licence year's end.

## Open questions for the owner

1. **Free version, no composer.** Decided by the owner on 2026-10-17: AI is free once connected, so the free version has the composer and unlimited typed turns; the lock concerns fixes only.
2. **Accepted items still count against the score.** The check is true, so the score shows the cap and the Overview still lists the item. The alternative is a score that ignores accepted items, which reads as the app agreeing the Mac is safe when it is not. Default here: the score is unchanged by accepting.
3. **The 022 folder name on the card.** The chooser card shows the shared folder's name from the report's evidence, the first path-like text on a guided surface outside Details. It is local and never sent. The alternative is "Folder 1 of 2" with the name in the Explain disclosure. Default here: show the folder name.
4. **The transcript clears on "Check again".** The old cards referred to a report that is gone, so the transcript is cleared and the new opening carries the "since last time" rows. The alternative, keeping the old transcript with its cards collapsed, is more to build and more to read. Default here: clear.
5. **No usage link on the ChatGPT limit line.** OpenAI's guidance is to link to ChatGPT's usage settings; the app's promise is that it opens only the sign-in page and the shop. Adding the link means a fixed URL in Rust, a row in SECURITY-MODEL's network table, a readme line and a harness exemption. Default here: no link.
6. **The watch yielding to the chat.** On Claude a chat turn may wait up to 5 s for a watch call to yield. Making the cycle skip while the chat is on screen touches `cycle.rs`, which is in flux. Default here: say "sometimes ten" in Settings and leave the cycle alone.
7. **"Things you chose to leave" and "Leave it alone" as the wording.** Both pass the banned-word test; neither has been read by a non-technical person.
8. **The long-lived Claude Code process.** Worth a spike only if the 3 to 5 s per reply is a complaint after launch.
