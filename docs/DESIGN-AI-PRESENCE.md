# Talos Labs AI design: the AI you connected, felt throughout

DESIGN-AI connected the AI the person already pays for. Today that AI is reachable from three places: the "Explain this" disclosure on a step, the "Suggest an order" card on the Overview, and Ask. Everything else the person sees is authored copy, so a person who just connected ChatGPT sees no difference until they open a disclosure. This document adds the moments where the connected AI is felt without a tap, within the budget of a plan the person already pays for, and without moving anything the app itself decides.

This document extends `docs/DESIGN-V03.md`, `docs/DESIGN-AI.md` and `docs/DESIGN-WATCH.md`. `docs/SECURITY-MODEL.md` changes in two places only (section 6, "Docs touched"): Boundary 3 lists the new `checkup` envelope, and Data at rest gains one row for the persisted plan reading. The model receives only the derived document from `packages/core/src/explainer/context.ts` (rule ids, statuses, severities, categories, points, counts, enum values, the profile) plus the catalogue text in the frozen system prompt. It never runs anything, never writes fix steps, never decides what to fix. Every output is schema-checked and prose-checked before it is shown, carries the provider's name and "Not verified", and the app is complete with AI off. One new task id is added (`checkup`).

The owner's brief, verbatim (2026-10-17): "we need more of the AI magic once there is some ai connected". Context from the owner: the core proposition is "connect the AI you already pay for"; a person who connected ChatGPT or Claude should feel it throughout the app, not only behind an "Explain this" disclosure. Both connections were verified working on 2026-10-17.

This is the second draft. The first was refuted on the boundary, the product rules and the cost model; every refutation that held is folded in below and the changes are listed in the decisions.

Decisions taken where the brief left room:

- **One new task, `checkup`, called at two moments.** One call when the check-up lands with a plan and one when the end screen opens after at least one fix. The first feeds the plan screen, the steps and Ask. The second feeds the end screen. Nothing else the app starts on its own. Explain, prioritise and Ask stay person-initiated. `docs/DESIGN-V02.md` line 466 ("the protocol keeps its three tasks and no summary task is added") is re-opened here: that decision was taken when the only AI surface was the Overview card, and the owner's brief asks for text on screens no existing task can feed.
- **The brief is free once an AI is connected.** Its predicate is `settings.explainer.aiEnabled` and availability `available`, no gate, the same as prioritise and Ask since the owner's decision of 2026-10-17 (AI is free once connected; the licence buys fixes beyond the free three, Check again and the menu bar watch). Open question 1 is closed by that decision.
- **Authored copy stays the floor; the model comments.** No model text becomes a headline, a list row, a button, a control label, or the order of the plan. The plan stays a pure function (DESIGN-V03 decision 1). The model's text sits in a quotation block with the full badge, every time.
- **A model block never sits above a control.** On every guided screen the block is placed below the primary and the link, or inside the Explain disclosure. Nothing the person could be reaching for moves when a block lands. This is the check-up's form of DESIGN-WATCH's rule that a model sentence never reads as the instruction above a fix button.
- **The model never speaks as the app.** The app says "I". The model is told to write in the second person only, and every checkup string that contains the app's first person or starts a sentence with an imperative verb is dropped (section 6).
- **The plan reading is persisted; nothing else model-written is.** The app scans on every launch, so an in-memory cache keyed on the report is never hit on an unchanged Mac, and the first draft's plan to re-ask on every launch would spend a call per day for the same sentence. The plan reading is stored in `last-brief.json` next to `last-report.json`, keyed on what the model saw (section 3), and loaded instead of called when the key matches. The end reading stays in memory. The watch's `ratingReason` stays never persisted (DESIGN-WATCH section 3).
- **The step line appears only where the step's button changes nothing.** Show-me-where steps get it under the body. Fix and batch steps get it inside the Explain disclosure, as the first paragraph. Permission, paywall, question, watching, stale and done screens never carry it.
- **Suggested questions on Ask are authored, not model-written.** Model text as a button label is excluded by SECURITY-MODEL ("rendered as text nodes only"), and a model-written question the person submits unedited makes "The question is typed by the reader" false. Three authored chips built from the catalogue give most of the value at zero calls.
- **No prefetch of explanations and no automatic prioritisation.** Both spend plan calls the person may never read.
- **The "since last time" screen gets no model text.** The diff feeds the plan reading instead.
- **The profile moves partly out of Developer mode.** Role, "I keep other people's data on this Mac" and "This Mac leaves the house" move to Settings under "Your AI". "I know my way around computers" stays in Developer mode because it changes which steps the check-up shows (DESIGN-V03 decision on Developer-category rules).
- **The watch items are designed here and wait for DESIGN-WATCH.** No watch code exists (`docs/DESIGN-WATCH.md` line 9). Moment 8 says what the window shows, and nothing in it needs a call beyond the one the watch design already makes per cycle.

Facts about the tree and the providers were checked on 2026-10-17; the measurements in section 3 come from a throwaway script run against the dev-machine fixture that day. Claims about `useScan.ts`, `machine.ts`, `landing.ts`, `claude_code.rs` and `engine.rs` were re-checked against the tree for this draft.

## 1. Principles

- **Felt, never in the way.** The model's text appears where the person already is, with no extra tap. It never adds a control to a guided screen, never changes a count, never shifts a step, never moves a button, and never delays a screen. A screen renders complete without it and gains a block when it lands.
- **Authored copy is the floor.** Every moment has an authored fallback that is what the person sees with AI off, not connected, limited, failed or rejected. The fallback is never a placeholder, a spinner or a "could not write" line on a guided screen. The model's block is either there or absent.
- **Every model text is labelled.** The provider's name and "Not verified" sit under every block (section 5). This follows Apple's iOS 18.3 change after the BBC summary incident: labelled, never native-looking (engadget, macworld). The block is rendered through `ModelText` (text nodes only) and never as authored copy. The badge line is authored only; no model value sits inside it.
- **Below the controls.** DESIGN-V03's rule holds: one headline, at most two authored sentences, one primary, at most one link, the Explain disclosure. DESIGN-V03 section 1 gains one sentence: "A guided screen may carry one model block, below the link or inside the disclosure, never above a control." The block is content, not a control.
- **Budget per check-up.** The app starts at most three calls on its own per landed plan (section 3). Everything else is person-initiated and the provider's `limit_reached` is the stop, as DESIGN-AI section 8 says. The plan reading is cached across launches and nothing is re-asked on a re-render, a revisit or a recheck that did not touch the rule.
- **No nagging.** No banner, badge, notification, counter or "Don't write this" link. The one switch in Settings, "Explain things with my AI", turns everything in this document off. DESIGN-AI section 8 holds.
- **The boundary holds.** Each moment below lists exactly what the model receives and shows that it is ids, enums, booleans and counts. The UI renders every rule by its authored `guided.headline` from the id; the model never has to write a title the app depends on.

## 2. The moments

Priority order. Each moment gives: where it appears; what the person sees; the derived input; the task id and schema; the validator rules; the cache key; the fallback; and the state machine (idle, writing, ready, failed, hidden). "The prose check" means `containsMachineText` plus `containsAppVoice` plus the imperative-start check from section 6, applied on top of the existing `containsCommandText`.

### Moment 1. The plan screen's reading

**Where.** `apps/desktop/src/guided/screens/PlanScreen.tsx`, below the primary and the "Show me the list" link, above the list when the list is open. Shown once per check-up, the first screen after the paced scan.

**What the person sees.**

> 0 of 5
> **I found 3 things to fix.**
> I can fix 1 of them for you now. The other 2 I'll show you where.
> [Let's go]
> Show me the list
> ┃ Your Mac goes out with you and its disk is not locked, so a lost bag means lost photos and open accounts. The firewall is the quick one and the app puts it first.
> ┃ Written by ChatGPT. Not verified.

The model block is `div.guided-model` (section 5): the paragraph through `ModelText`, the badge at `--text-guided-meta` in `--fg-secondary`, a 2 px `--border` rule on the left so it reads as a quotation and not as the app's own sentence. The authored headline, body, "One of these is urgent." line, primary and link are unchanged. The list carries no model text. When the plan has no batch, fix or show step (`planCounts(plan).total === 0`) the block is not requested and not shown.

Because the block sits below the controls, it may land while the screen is on view: nothing the person is reaching for moves. On an unchanged launch the block is on screen at mount, from `last-brief.json`.

On a later launch with a non-empty diff, the model is given the diff and the previous score, so the sentence can say what changed ("Two of last week's three got fixed; the new one is the one that matters most"). The Since screen itself keeps its authored lines.

**The model may not reorder, and may not speak as the app.** The system prompt gains, for this task: "The app has already chosen the order; comment on it, never propose a different one, and never write what to click. Write to the reader in the second person. Never write as the app and never use I, me, my or we." The validator cannot check prose order, so the UI never derives anything from the sentence: the list, the counts and the first step come from `buildGuidedPlan` as today.

**Derived input.** `{ task: "checkup", moment: "plan", context, stepRuleIds, fixedRuleIds: [], nextRuleId: null, previous }` where `context` is `toExplainerContext(report, catalog, profile)` unchanged; `stepRuleIds` is one id per batch, fix or show step in step order (the step's rule, or the first rule of a batch), at most 10; `previous` is `{ score, fixed, appeared, unreadable }` from `diffReports` (`packages/core/src/guided/diff.ts`, ids only) plus the previous report's score as a finite number, or null on a first launch. Every value is a rule id under `SAFE_STRING_PATTERN`, a finite number, or null. No path, label, port or name exists in the plan step list the model receives: `fix:TL-MAC-022:/Users/alice/Public` is a step id the UI keeps; the model receives `TL-MAC-022`.

**Task id and schema.** `checkup`, `CHECKUP_JSON_SCHEMA` (section 6). Output `{ summary, stepLines }`. The plan moment uses both: `summary` here and on Ask, `stepLines` in moment 2.

**Validator.** `validateCheckup(raw, report, input)`: `summary` is a string of at most 600 characters, non-empty after trimming, passes `containsCommandText` and the prose check, else it is dropped (null); `stepLines` as in moment 2. The output is `rejected_output` only when it is not an object, or when the summary was dropped and no line survived.

**Cache key.** `brief.plan` in the scan state (section 3), keyed on `planKey`: the catalogue version, the provider, the profile's four values, the score, the joined `stepRuleIds`, and the joined `previous` lists and score (or "first"). Set in `landed()` (`apps/desktop/src/guided/landing.ts`). Survives every fix, batch, watch tick and section recheck of the check-up because the plan's step list is frozen per check-up (DESIGN-V03 "The free set is frozen"); a result that lands with a `planKey` other than the current one is discarded. Persisted to `last-brief.json` on `ready`; loaded in `landed()` when the file's key equals `planKey`, in which case no call is made.

**Fallback.** The screen as built. Nothing is inserted.

**State machine.** `idle`: AI on, provider `available`, plan has steps, `landed()` ran, no cached reading. `writing`: the call runs; the screen shows nothing for it (no caret, no "Writing", no Stop; the brief has no visible progress on guided screens). `ready`: the block renders. `failed`: any failure, including `rejected_output`, `limit_reached` and `cancelled`; nothing renders, no state line (state lines belong to the disclosure and the AI card, where the person asked). `hidden`: AI off, provider not `available`, or `total === 0`. If the person presses "Let's go" before `ready`, the plan screen is gone; the result still lands in the cache and serves moments 2 and 4.

**Timing, stated plainly.** The plan is built in `landed()`, which runs from the `presented` effect after `present()`, and `present()` is where `useScan` resets its caches (`useScan.ts:239-245`). The brief therefore starts when the plan screen mounts, not during the pacer's 6 s floor; the first draft's claim that it runs during the floor was wrong. On ChatGPT the reading usually lands while the plan screen is still on view. On Claude Code each call is a codesign verify, a spawn and a structured-output round trip, so the reading usually lands after "Let's go" and is first felt as a step line on a later step or on Ask. On an unchanged launch the reading comes from disk and is on screen at mount on every provider.

### Moment 2. One line for you on a step

**Where.** Show-me-where steps (`ShowStep.tsx`, the `idle` state only: the first screen, before "I've opened the right page" and not the 026 `question` state), under the body and above the primary. Fix steps (`FixStep.tsx`) and the batch step (`BatchStep.tsx`): inside the Explain disclosure, as the first paragraph above the streamed explanation. Never on the permission step, the paywall step, the question, watching, stale, done or failure screens.

**What the person sees, show step.**

> 3 of 5
> **Your Mac lets anyone connect to it**
> Sharing is on and anyone on your Wi-Fi can try to log in. I'll show you where to turn it off.
> ┃ You work from cafés, so this is the one strangers on the same Wi-Fi can reach.
> ┃ Written by ChatGPT. Not verified.
> [Show me where]
> Do this later
> Explain this

**What the person sees, fix step with the disclosure open.**

> 2 of 5
> **Your disk is not locked**
> Anyone who picks up this Mac can read everything on it. I can fix that for you.
> Your Mac will ask for your password once. That is macOS asking, not me, and I never see it.
> [Fix it for me]
> Do this later
> Explain this ▾
> ┃ You carry this Mac around, so this is the one that matters most for you this week.
> ┃ Written by ChatGPT. Not verified.
> ┃ Locking the disk means … (the streamed explanation, as built)

The block is `div.guided-model` with the full badge on both placements; the first draft's inline short-badge line between the authored why and the password sentence is dropped because it was the text most likely to be read as authored copy, and it sat above a button that runs a catalogue entry. On a show step the button opens a System Settings pane and changes nothing, so a block under the body is allowed there; it never says what to click (the validator rejects imperative starts) and the authored lead is still the last sentence before the button. On the batch step the block is the line for the batch's first rule, which is the one the disclosure explains too. One block per step, never one per row: the `GuidedList` rows stay authored and under the banned-word test.

**Rendered at mount only.** A step renders its block only when the line was in the cache when the step mounted. A line that lands while a step is on view waits for the next step. This keeps "never shifts a step" true on the show step, where the block sits above the primary.

**Derived input.** None of its own. The lines come from moment 1's `stepLines`, one entry per id in `stepRuleIds`. The model receives nothing about the step beyond its rule id, status, severity, points and safe numeric evidence already in `context.findings` (for example `hoursSinceBackup`, `pendingCount`, `minLength`; the evidence keys in `packages/core/src/rules/macos/tl-mac-*.ts`). No pane name, path or share name is needed: the step's own copy comes from the catalogue by id.

**Task id and schema.** `checkup`, field `stepLines: [{ ruleId, line }]`, at most 10.

**Validator.** Each `ruleId` through `readRuleId` against `input.stepRuleIds` (not merely the report), no duplicates; `line` at most 160 characters, one sentence (one terminal full stop, no other full stop followed by a space), passes `containsCommandText`, the prose check, and the guided banned-word list from `apps/desktop/src/guided/copy.test.ts` (exported as `GUIDED_BANNED_WORDS` from `copy.ts`; matched case-insensitively as whole words). A bad entry is dropped; the rest stand. The banned-word test on lines is the answer to the register problem: the system prompt's catalogue block gains each rule's `guided.headline` as its plain name (section 6), the checkup task is told to use plain names, and a line that still says "SSH" or "daemon" under a headline rewritten to avoid those words is dropped.

**Cache key.** Inside `brief.plan`. On a section recheck the lines are filtered like `survivingExplanations` (`machine.ts:233-244`): a line survives when its rule is still in the report and its `requires` does not include the re-read section. After a fix or batch the lines for rules no longer in the report are never read because their steps are gone.

**Fallback.** The step as built: headline, authored why, the step's own sentence; the disclosure as built.

**State machine.** `hidden` until the plan brief is `ready` and a line for this step's rule survived and was present at mount; `ready` renders the block. There is no `writing` or `failed` on a step.

### Moment 3. The end screen's close

**Where.** `apps/desktop/src/guided/EndScreen.tsx`, below the "Do this next" card and the "Still waiting" and "Check again" links, above the grouped rows.

**What the person sees.**

> **Your Mac is safer than it was.**
> 3 things fixed today.
> Your disk is not locked. That is the biggest risk left.
> [Do this next · Your disk is not locked]
> Still waiting …
> Check again
> ┃ Today's fixes closed the doors a stranger on the same Wi-Fi could have used. The disk is the one still open, and for a Mac that travels it is worth ten minutes this week.
> ┃ Written by ChatGPT. Not verified.
> Fixed today · Later · For a technical person …

The block uses `div.guided-model`. The authored title, the "N things fixed today." line, `urgencyLine` and the "Do this next" card stay; the card is the one primary and is never written by the model (DESIGN-AI section 4, "End screen row"). The block sits under the card so a model sentence is never above a button that runs a fix, and so a late landing moves nothing the person is reaching for.

The block is requested only when `fixedRuleIds` is non-empty. On "Nothing needs fixing", "I couldn't check your Mac", and on a visit where nothing was fixed (the person pressed "Do this later" on everything, or an unchanged launch went straight to the end) there is nothing to close, and this is what keeps the end brief at zero calls on a daily launch where nothing happened.

The text is shown only when complete, never streamed, so a slow Claude Code spawn never holds "Check again" or the primary (the Cloudscape and Arc findings: stream only where the person is waiting for that text).

**Derived input.** `{ task: "checkup", moment: "end", context, stepRuleIds: [], fixedRuleIds, nextRuleId, previous: null }`. `fixedRuleIds` is `EndScreenProps.fixed` (ids only, `EndScreen.tsx:100-108`). `nextRuleId` is `nextAction(plan, report).ruleId` or null (`packages/core/src/guided/next.ts`); for an unlicensed person `nextAction` may return `unlock`, and the brief then has no `nextRuleId`. `context` is the current report's derived document, in which the fixed rules are no longer findings, so the model learns what was fixed only from the id list. What the fixes did comes from the catalogue text in the system prompt.

**Task id and schema.** `checkup`, field `summary`. `stepLines` is requested empty at this moment (the prompts say "return an empty list when stepRuleIds is empty"), and any content in it is ignored by the UI.

**Validator.** As moment 1 for `summary`.

**Cache key.** `brief.end` in the scan state, keyed on `endKey`: `planKey` plus the joined `fixedRuleIds`. In memory only. When "Do this next" runs a fix and the list changes, the block is dropped and requested once more, at most once per landed plan (section 3). A second change keeps the screen without a block.

**Fallback.** The end screen as built.

**State machine.** `idle` when the end screen mounts with AI on, the provider `available`, the title "in good shape" or "safer than it was", and `fixedRuleIds` non-empty. `writing`: nothing shown. `ready`: the block. `failed`: nothing. `hidden`: otherwise.

### Moment 4. Ask: the briefing and three questions

**Where.** `apps/desktop/src/screens/Ask.tsx`, the empty conversation state (today one fixed hint at `Ask.tsx:181`).

**What the person sees.**

> Questions are answered from this report only. Answered by ChatGPT. Not verified.
> ┃ Your Mac goes out with you and its disk is not locked, so a lost bag means lost photos and open accounts. The firewall is the quick one and the app puts it first.
> ┃ Written by ChatGPT. Not verified.
> Try asking
> [ Why does "Your disk is not locked" matter for me? ]  [ What happens if I leave "Updates are waiting" for a month? ]  [ Is 38 out of 100 bad? ]
> [ composer ]

The briefing is moment 1's `summary`, reused: the same paragraph the plan screen showed, now where the person can act on it. The chips are `button.ask-chip`, authored, text only, one row, wrapping. A chip puts its text into the composer and focuses it; it never sends. The three templates live in `labels.ts` (`ASK_CHIPS`): the first takes the highest-point failing rule's `guided.headline`, the second the next one's, the third the score; with fewer than two failing rules the missing chip is omitted; with none, only the score chip. The chips are authored copy under the banned-word test, so they carry no badge. The header sentence from DESIGN-AI stays and covers the briefing together with its own badge. Once the first exchange exists the briefing and the chips are gone. The authored "Try: …" hint is replaced by the chips.

Dropped from the first draft: model-written questions (model text as a control label, and a model-to-model loop when the person submits one unedited), a model-written first answer on open (one call per visit; Gmail's automatic Gemini summaries are the warning, 404media) and model-written follow-ups after each answer (a second call per answer; nngroup found no evidence they help beyond the first).

**Derived input.** None of its own; the briefing is moment 1's `summary`. The chips need no model.

**Task id and schema.** `checkup` (cached), field `summary`.

**Validator.** As moment 1.

**Cache key.** `brief.plan`. Ask's conversation and draft reset per report (`useScan.ts:242-243`); the briefing resets with the landed plan.

**Fallback.** The chips alone, or the authored hint when there is no report.

**State machine.** `hidden` when AI off, not connected, or no summary in the cache; the chips still render whenever Ask is usable. `writing` while the plan brief runs: the one static line "Reading your check-up." under the header (Ask is where the person waits for the text, so a line is fair here; it is `role="status"`, with no Stop because it is the brief). `ready`: the briefing and the chips. `failed`: the chips alone.

In the expert home (`guided.home` false) the guided controller never runs, so no plan is landed and no brief exists. Ask then shows the chips without the briefing. The first draft had the Overview request a brief from a plan the person never sees; that is dropped, because the summary would then be the only ordering statement on a screen that shows no app-decided order.

### Moment 5. The Overview: the order that survives, with every reason

**Where.** `apps/desktop/src/screens/Overview.tsx` (`AiCard` with the suggested order), `apps/desktop/src/screens/Findings.tsx` and `FindingCard.tsx` for the rank badges.

**What the person sees.** The "Suggest an order" card stays behind its button (one person-initiated call, free once connected). Two changes to what it shows: the reason under every ranked row, not only the three "Start with" rows (`SuggestedOrderBody` passes `withReason` true for every row; `priority.reasons` already carries them, `schemas.ts:28-39`); and the order survives a recheck for rules the recheck did not touch. Today `useScan.ts:266-268` drops `order` and `priority` on every recheck, and every guided step rechecks, so the order never survives a check-up. `survivingPriority` (section 6) keeps the order minus rules that left the report or whose `requires` includes the re-read section, and keeps the reasons for the surviving ids.

The first draft put the plan reading under the grade line on the score card. Dropped: it was the same paragraph a third time, and the Overview's AI surface is the order card.

**Derived input.** None new. The prioritise task is unchanged.

**Task id and schema.** `prioritise`, unchanged.

**Validator.** Unchanged.

**Cache key.** `ExplainCache.order` and `priority` with the new survival rule.

**Fallback.** The AI card as built.

**State machine.** The AI card keeps its v0.2 states; "Suggest an order" is its `idle`.

### Moment 6. The Explain disclosure shows what it already receives

**Where.** `apps/desktop/src/guided/ExplainPanel.tsx` (guided), `apps/desktop/src/screens/FindingDetail.tsx` (expert), `BatchStep.tsx`.

**What the person sees.** The guided panel today renders `whyItMattersForYou` only (`ExplainPanel.tsx:108`) and discards `whatCouldHappen` and `urgency`, which the validator already checks (`validate.ts:96-110`) and the expert screen already shows (`FindingDetail.tsx:296-318`). Change: after "why", a second paragraph with `whatCouldHappen`, through `ModelText`, under the same badge. The `urgency` enum stays off the guided panel: a model "Today" on a low-severity step would contradict the code-decided "One of these is urgent." line, and the first draft's idea of putting the word inside the badge line made the label part model output. The expert screen keeps its labelled pill as built.

On the batch step, `StepFrame` passes `others={step.ruleIds.slice(1)}` to the panel, which already renders them as text buttons (`ExplainPanel.tsx:227-233`). DESIGN-V03's "offers the others as plain text buttons" is then built. Each is one person-initiated explain call, cached by rule.

On the expert finding screen, when `byRule[ruleId]` is already cached (the rule was explained during the check-up) the card opens in `ready` with the text, no button. Otherwise the "Explain this for me" button stays; no auto-start.

**Derived input.** `{ task: "explain", context, ruleId }`, unchanged.

**Task id and schema.** `explain`, unchanged.

**Validator.** Unchanged. The new prose checks apply to `checkup` strings only (section 6); explain and ask keep the validation that worked on 2026-10-17.

**Cache key.** `byRule` per report, unchanged.

**Fallback.** The panel body as built; the finding screen's authored "Why it matters".

**State machine.** Unchanged (the v0.3 panel and the v0.2 card).

### Moment 7. About you, partly out of Developer mode

**Where.** `apps/desktop/src/screens/Settings.tsx` (today the form renders only under Developer mode, `Settings.tsx:173`) and `YourAiSection.tsx`.

**What the person sees.** Under the "Your AI" row and the switch, when a provider is connected or On this Mac is ready, a short group "About you" with three of the four v0.2 controls: role (individual, freelancer, small business), "I keep other people's data on this Mac", "This Mac leaves the house". Section sentence: "Your AI writes for you from these answers, your check-up's results, what changed since last time and what was fixed today. Nothing else about you is sent." That sentence names the whole `checkup` envelope (the OS version is part of "your check-up's results", as the Connect sentence already says).

"I know my way around computers" stays in Developer mode. It makes 029, 030 and 031 steps when set to medium or high (DESIGN-V03 decision on Developer-category rules), so a person who flipped it for a different tone would get login-key steps in the next check-up. The form in Developer mode keeps all four controls as today.

The first draft's "4 requests this check-up." line is moved to Developer mode: the plan allowance is not a number the app can know, so the counter has nothing to compare against, and a running number on the Settings screen is the kind of meter "no nagging" keeps off the screen. In Developer mode it reads "4 requests this check-up." from `aiCallsThisPlan` (section 3).

Not a question on the path: the Welcome screen stays three taps to a report (DESIGN-V03 First launch, DESIGN-AI decision "No AI step in Welcome").

**Derived input.** None. The profile already travels in `context.profile`.

**Task, schema, validator, cache, state machine.** None. This is a settings change. The plan reading's `planKey` includes the profile, so changing an answer re-asks on the next check-up and never serves a reading written for the old profile.

**Fallback.** The Settings screen as built: the group is not rendered until a provider is connected or On this Mac is ready, and the defaults (`individual`, `false`, `true`) stand.

### Moment 8. The watch window's reason line (design only, waits for DESIGN-WATCH)

**Where.** The 320 px menu bar window, DESIGN-WATCH section 5, row 3, in the "something to look at" state only.

**What the person sees.**

> One thing to look at
> Checked 12 minutes ago
> **A new program starts when you log in**
> It was not there at the last check.
> ┃ Two start-up changes in a day is more than this Mac usually sees.  ChatGPT, not verified
> [Show me]
> Open Talos Labs · Check now

The line is `WatchVerdict.ratingReason` from the cycle's one-shot judge (DESIGN-WATCH section 3), rendered in the model line style with the short badge. Never in the act-now state, whose primary runs a catalogue entry (`watch.wifi_off`): DESIGN-WATCH's rule that a model sentence never sits above such a button holds. "Show me" opens a pane and changes nothing, like a show step. Never in the calm state (nothing to explain). The fishy flow's screens keep their authored "What experts do" lines and source lines; the model's only contribution there stays `actions[].sentence` on Advise rows, as DESIGN-WATCH section 4 says. The research's "expert line" candidate is dropped: every expert action comes from a published playbook with a source and a step, by the owner's rule (DESIGN-WATCH line 7), and a model cannot be allowed to cite.

**Derived input.** `WatchContext` as specified: rules with status and change, signals with `same`, `changed`, `first_seen`, counts, the floor and ceiling. No label, path, port or name (DESIGN-WATCH section 3, "there is nowhere for machine text to go").

**Task id and schema.** `watch`, as designed. No extra call: the cycle call already exists. `ratingReason`'s cap drops from 300 to 140 characters in the schema and the validator, because the window is 320 px and a sentence must never be cut after validation (a cut could drop a "not").

**Validator.** `validate_watch_verdict` as designed, with DESIGN-WATCH's full word list kept for the watch (pid, process, kill, delete, remove, rm, unload: "remove the process" on an Advise row is what that list exists to keep out) and the two regex forms corrected as in section 6 (the port pattern must not reject "18:00"; the path pattern must not reject "and/or" and must catch a path after a quote, a bracket or a colon). A `ratingReason` over 140 characters is dropped, never truncated.

**Cache key.** The current cycle's verdict, in memory in Rust; `ratingReason` is never persisted (DESIGN-WATCH section 3).

**Fallback.** Row 3 as designed: the authored headline and why.

**State machine.** `hidden` in calm and act now, or when the badge reads "Decided by the app itself"; `ready` in the look state when the cycle's verdict kept its `ratingReason`. No `writing` (the cycle runs in Rust; the window shows the last cycle's result).

### Candidates evaluated and dropped

- **The personalised sentence as the default body line, replacing the authored why.** Dropped. The authored why is under the banned-word and syllable tests and is the floor; a model line that replaces it would make the step wrong when the line is dropped.
- **A model line between the authored why and the fix button (first draft's moment 2).** Dropped. It was the text most likely to be read as the app's own instruction above a button that runs a catalogue entry.
- **A separate "since last time" narrative.** Dropped. The screen is one tap and gone; a Claude Code spawn takes seconds; the diff feeds moment 1 instead.
- **A first "briefing" answer written on opening Ask.** Dropped. One call per visit for text the person did not ask for. The cached summary is the briefing.
- **Model-written suggested questions.** Dropped (moment 4).
- **The plan reading under the Overview's grade line.** Dropped (moment 5).
- **The brief in the expert home.** Dropped (moment 4).
- **The urgency word on the guided panel.** Dropped (moment 6).
- **A free brief limited to the free three.** Moot: the brief is free once connected (owner decision 2026-10-17).
- **An AI reason line on the plan screen, "I'd start with the firewall because…".** Folded into moment 1. The model comments on the order; it never proposes one, and the UI derives nothing from the sentence.
- **The fishy flow's expert line.** Dropped. Authored from the playbook with a source, by the owner's rule.
- **"Explain in simpler words" / "Explain for a friend".** Dropped. A second call per rule, a new control on a guided screen, and the profile's `technical` level already sets the register.
- **Prefetching the current step's explanation.** Dropped. Five to seven calls per check-up on the dev machine for text behind a disclosure the person may not open.
- **Automatic prioritisation on the Overview.** Dropped. One more app-started call per check-up; the card's button stays. The order now survives rechecks, which was the real defect.
- **Model-written follow-up questions after each answer.** Dropped.
- **A "Don't write this" link on the end screen.** Dropped. It would be a second link under the body (DESIGN-V03 allows one) and the one switch exists.
- **A "N requests this check-up" counter on the Settings screen.** Moved to Developer mode (moment 7).
- **Skipping the plan brief on an unchanged launch instead of persisting it.** Dropped. The first brief ever happens on the launch after connecting, which is usually an unchanged launch, so skipping would hide the flagship moment from the person it was built for.

## 3. Call budget and caching

**Measured, dev-machine fixture (31 rules, 13 findings, score 38), chars/4 as the token estimate.** The frozen system prompt from `buildSystemPrompt(MACOS_CATALOG)` is 16,284 characters, about 4,000 tokens, sent as ChatGPT `instructions` on every request (`apps/desktop/src/adapters/chatgpt-explainer.ts:128`) and as Claude Code `--system-prompt`. The plain-name column from section 6 adds about 31 short lines, under 1,500 characters. The derived document is 2,452 characters. The explain, prioritise and ask user messages are 2,503, 2,484 and 2,515 characters. One ChatGPT request body is 19,894 characters, about 5,000 input tokens. The `checkup` user message adds the moment, up to 10 step ids, up to 10 fixed ids and the diff lists, about 400 characters more. Its output is about 150 tokens for the summary and up to 10 lines at about 40 tokens: under 600 output tokens. On-device: instructions 1,227 characters; the prioritise prompt is 3,940 of the 7,000-character budget (`ON_DEVICE_LIMITS`, `packages/core/src/explainer/on-device-prompt.ts:7-14`) with 12 of 13 findings kept; the checkup prompt is the same context plus about 200 characters of ids and plain names, so it fits the budget with room. The on-device output cap is `MAX_TOKENS = 600` in `apps/desktop/src-tauri/src/ai/engine.rs:12`.

**Plan allowances are not numbers the app can know.** ChatGPT Plus and Pro usage counts against the person's plan; the person sets a per-app weekly percentage in ChatGPT Settings > Usage, and Plus also shares one five-hour window across every connected app; a 429 `subscription_sharing_usage_limit_exceeded` gives no reset time and OpenAI says not to guess one (OpenAI SIWC errors-and-recovery; the help article via WorkOS and mixed-news). Claude Pro and Max have a five-hour session limit and a weekly limit shared across claude.ai, Desktop and Claude Code, with no published counts (support.claude.com 11647753, 11049741, 11145838). So the budget is by call count, not by a presumed quota.

**App-started calls per landed plan, remote providers: at most 3, usually 0 or 1.**

| call | when | moment |
|---|---|---|
| `checkup` plan | in `landed()`, when the plan has steps and `last-brief.json` does not hold this `planKey` | 1, 2, 4 |
| `checkup` end | when the end screen mounts with a closable title and a non-empty fixed list | 3 |
| `checkup` end, refresh | once, when "Do this next" changed the fixed list | 3 |

A brief is one call. It is never retried, on any failure. (The first draft allowed one retry on `network` or `provider_unavailable`; the ChatGPT adapter never returns `network` and marks the provider unavailable on a failed fetch, and on Claude Code a retry is a second spawn, so the rule was dead on one provider and wasteful on the other.) A fourth app-started call in one landed plan is refused by `useScan` with no notice. The unit is the landed plan, not the report object: every fix replaces the report, so a per-report ceiling would restart after each fix.

**Cost on a typical day.** An unchanged launch: zero calls (the plan reading comes from disk; nothing fixed, no end brief). A launch where something changed and the person fixes something: two calls. A launch where the person also presses "Do this next": three.

**Person-started calls: no app cap.** Explain (one per rule, cached), the others on a batch step (one per rule, cached), prioritise (one per report, kept across rechecks), Ask (one per question, not cached). The provider's `limit_reached` is the stop and the existing state lines show it. On the dev machine a full check-up with every disclosure opened is about 2 + 6 explain + 1 prioritise = 9 calls plus Ask. With nothing opened it is 0 to 3.

**The watch shares the plan.** DESIGN-WATCH keeps its cap of 24 calls per provider per day and skips a tick while a guided step is on screen, so a check-up and a watch cycle never run their calls at the same time. On Plus the five-hour window is shared with every connected app; this design adds nothing on top of the watch's own rules.

**When calls happen.** The plan brief starts in `landed()`, after `present()` reset the caches and the plan was built. DESIGN-AI section 3's sentence "probed lazily when the first AI surface mounts, never during onboarding or the scan" is amended: the plan screen is an AI surface, and the availability probe may run at landing; on a first launch nothing is connected, so nothing runs. The end brief starts on the end screen's mount. Neither starts while a person-initiated explain, prioritise or ask is `running`: the brief is then skipped for that moment, not queued.

**One request at a time, on two of three providers.** Claude Code is one request at a time (`claude_code.rs:1041` swaps `busy` and returns `Err("busy")`), and so is the on-device engine (`engine.rs:269`, with `busy` held until `cancel_ack` or 2 s). The first draft's "separate slot" claimed concurrency; it only gets a separate abort ref. The rule on every provider: the person's request wins. When the person opens "Explain this", presses "Suggest an order" or sends a question while a brief runs, `useScan` aborts the brief, awaits the brief's promise (so the adapter has released `busy`), marks the brief `failed` (reason `cancelled`, not restarted) and only then starts the person's call. A brief is never started while a person-initiated request runs. On ChatGPT two HTTP requests could run side by side, but the same rule applies so the behaviour is one rule on every provider and the person's disclosure is never answered `busy`. The cost, stated plainly: on Claude Code, opening "Explain this" on the first step during the spawn loses the plan reading for that check-up; the end close is unaffected.

**Streaming and Stop.** The brief is never streamed to a guided screen and has no Stop: it is whole or absent. Explain, prioritise and Ask keep their streaming, caret and Stop as built. The adapters' `onPartial` is still called for `checkup` (the partial JSON reader needs nothing new) and ignored by the UI. `snapshotHasCommandText` (`apple-explainer.ts:90`, used by the ChatGPT and Claude adapters too) runs on every checkup partial as on every other partial; a hit cancels the request and the whole checkup is `rejected_output`. The per-field drops of section 2 apply to the final validation only.

**Timeouts.** The adapters' own: ChatGPT 90 s whole (`chatgpt-explainer.ts:39-41`), Claude Code 60 s to first partial and 180 s whole (`claude_code.rs:38-40`), Apple 25 s to first partial and 90 s whole (`engine.rs:119-126`). A brief that lands after the person left its screen is cached and serves the next surface. A brief that times out is `failed` with no retry.

**On a provider failure.** When a brief fails with `needs_sign_in`, `limit_reached`, `provider_unavailable` or `plan_not_eligible`, `useScan` calls `ai.report({ state, until })` (`useAiAvailability.ts`, `AiController.report`) so the availability catches up without a probe and `limitReprobeMs` schedules the re-probe at `until`, or every 300 s when the provider gave none. The first draft relied on the AiCard's failure effect, which never runs for the brief because the brief is outside the explain state. A brief skipped for a limit is not requested again for that landed plan; the next check-up asks again. The disclosure and the AI card keep their authored limit lines.

**Its own slice of state.** The brief does not live in `ExplainCache`. `explainFrom()` returns `{ kind: "off" }` when `byRule` is empty and `order` is null, `explain_ready` and `explain_failed` replace the explain state wholesale, `running.from` is restored on Stop, and `cacheRef` is a ref that triggers no render; a brief inside that structure would be invisible, clobbered or lost. `ReadyState` gains `brief: BriefState` (section 6), with its own actions `brief_started`, `brief_ready`, `brief_failed`, carried explicitly through `recheck_done`, `recheck_failed`, `fix_done`, `batch_done` and `watch_tick`. `useBrief` reads `scan.scan.brief`. `survivingPriority` keeps the order and reasons across a recheck. A result that lands with a `planKey` or `endKey` other than the current one is discarded. `brief_started` is dispatched before the call so StrictMode's double effect and a re-render cannot start a second call.

**Persisting the plan reading.** On `brief_ready` for the plan moment, `useScan` writes `last-brief.json` next to `last-report.json` through a new `BriefStore` port (`file-brief-store.ts`): `{ version: 1, planKey, provider, summary, stepLines, writtenAt }`. In `landed()` the file is read; when its `planKey` and provider equal the current ones, `brief_ready` is dispatched from it and no call is made. The file holds validated text only (it passed every check in section 6 before it was written) and is re-validated on load, so an edited file is dropped, not shown. It is deleted on Disconnect, on a provider change, when "Explain things with my AI" is switched off, on the Developer "Reset" button, and whenever a new reading replaces it. SECURITY-MODEL's Data at rest table gains the row: "`last-brief.json`: one model-written reading of the last check-up, provider-labelled, no machine text (validated), deleted with the connection." The end reading is never persisted.

**ChatGPT request body.** `remote.ts:88` sends `max_output_tokens: 4000`, which OpenAI's preview-limitations page lists among the parameters to omit; the connection worked on 2026-10-17. The brief's output fits well under 4,000, so nothing here depends on changing it; the open question stays with the owner.

## 4. The on-device case

Apple Intelligence's model is 3B parameters at 2-bit, "not designed for world knowledge or advanced reasoning" (WWDC25 session 286), with a context of about 4,000 tokens (Apple DTS, forum thread 791380). The app holds it to 7,000 prompt characters and 12 findings (`ON_DEVICE_LIMITS`, `on-device-prompt.ts:7-14`) and 600 output tokens (`MAX_TOKENS`, `engine.rs:12`). It has no plan limit; its costs are the window and wall time, and it runs one request at a time.

What On this Mac gets:

- **Moment 1, the plan reading.** Yes. The checkup prompt is the prioritise prompt's size plus the ids and plain names, about 4,300 of 7,000 characters. The on-device prompt asks for two short sentences (the validator cap is 600; the Swift output guide caps `summary` at 300 characters).
- **Moment 2, step lines.** No. The on-device output is a separate `@Generable struct CheckupOnDeviceOutput { summary }` with no `stepLines` field at all, because guided generation lets the model choose array lengths and a 3B model asked in prose to return an empty list often fills it, and a stream cut by the 600-token cap throws `decodingFailure` in `Generator.run` (`TalosAI.swift:127`), which maps to `rejected_output`. `validateCheckup` treats a missing `stepLines` as empty. Steps on this Mac show the authored copy and the disclosure; this is the graceful reduction.
- **Moment 3, the close.** Yes, same shape as moment 1.
- **Moment 4, the briefing and chips.** Yes. Ask is free once connected, like the brief.
- **Moment 5.** The suggested order stays behind its button and emits no partials on this provider, as today.
- **Moment 6.** Yes, zero cost.
- **Moment 8.** As DESIGN-WATCH specifies for On this Mac.

Trimming follows `on-device-prompt.ts:160-168`: catalogue explanations are dropped first, then findings from the end, and the adapter retries once without explanations on `context_window` before returning `too_long` (`apple-explainer.ts`). A `too_long` brief is `failed` and hidden.

One request at a time, as section 3 says for every provider: a person-initiated request aborts a running brief, `useScan` awaits the brief's promise (the engine's `cancel_ack` within 2 s), and the person's request starts only then, so it is never answered `busy`. A brief is never started while a person-initiated request runs.

## 5. Copy and labels

British English throughout. Model text is shown in a model-text block and is not under the authored banned-word test; every authored string below is, and goes into `apps/desktop/src/guided/copy.ts` or `apps/desktop/src/app/labels.ts`. (Checkup step lines are additionally dropped on the banned list, section 6; that is a validator rule on model text, not a test on authored copy.)

**Blocks.** `div.guided-model` for paragraphs: a 2 px `--border` rule on the left, 12 px inset, the text through `ModelText` at `--text-guided-body` in `--fg`, the badge under it at `--text-guided-meta` in `--fg-secondary`. `p.guided-model-line` for the watch window's one-liner: the sentence through `ModelText`, then the short badge as a trailing `span.guided-model-badge` at `--text-guided-meta` in `--fg-secondary`. Both are text only, never a control. Light and dark follow the kit's tokens; no gradient, no icon, no italics (the Apple precedent used italics; the kit's answer to "this is not ours" is the rule and the badge). The badge line is authored only.

**Full badges** (`AI_BADGES`, unchanged): "Written by ChatGPT. Not verified." / "Written by Claude. Not verified." / "Written on this Mac by Apple Intelligence. Not verified." / "Written by a local model. Not verified." (Developer mode).

**Short badges** (`AI_BADGES_SHORT`, new, for the watch window only): "ChatGPT, not verified" / "Claude, not verified" / "Apple Intelligence on this Mac, not verified" / "A local model, not verified".

**Ask.** `ASK.tryAsking`: "Try asking". `ASK.reading`: "Reading your check-up." `ASK_CHIPS`: `why(headline)`: Why does "{headline}" matter for me? / `leave(headline)`: What happens if I leave "{headline}" for a month? / `score(n)`: Is {n} out of 100 bad? The fallback hint with no report stays: Try: "Which of these should I do first?"

**Settings.** `YOUR_AI.aboutYou`: "About you". `YOUR_AI.aboutYouSentence`: "Your AI writes for you from these answers, your check-up's results, what changed since last time and what was fixed today. Nothing else about you is sent." Developer mode: `DEVELOPER.requests(n)`: "1 request this check-up." / "4 requests this check-up."

**Explain disclosure.** No new authored string; the second paragraph is model text under the existing badge.

**DESIGN-V03 section 1** gains: "A guided screen may carry one model block, below the link or inside the disclosure, never above a control."

**Nothing new on the plan screen, the steps or the end screen** beyond the model block itself; their authored strings are unchanged.

**Privacy sentences.** DESIGN-AI section 7's sentences stay true: the brief sends the same short summary plus id lists and two numbers. The Connect screen sentence ("I send it a short summary of the check-up, never your files, passwords or your computer's name.") covers it. The readme's "Your AI" paragraph gains one clause: "and, once an AI is connected, a short reading of each check-up written by your AI appears on the plan, at the end and on Ask." The readme's "Your check-up and your fixes never leave this Mac" paragraph gains: "The last reading is kept on this Mac next to the last report, and goes when you disconnect."

## 6. Contracts

**Core, `packages/core`.**

- `ports/explainer-port.ts`: `CheckupInput { context; moment: "plan" | "end"; stepRuleIds: readonly RuleId[]; fixedRuleIds: readonly RuleId[]; nextRuleId: RuleId | null; previous: { score: number | null; fixed: readonly RuleId[]; appeared: readonly RuleId[]; unreadable: readonly RuleId[] } | null }`; `Checkup { summary: string | null; stepLines: readonly { ruleId: RuleId; line: string }[] }`; `ExplainerPort.checkup(input, options)`; `EXPLAINER_LIMITS` gains `maxSummaryChars: 600`, `maxStepLineChars: 160`, `maxStepLines: 10`.
- `explainer/schemas.ts`: `CHECKUP_JSON_SCHEMA` with `required: ["summary", "stepLines"]`, `additionalProperties: false` (OpenAI strict mode requires every property; `strictSchema` in `remote.ts:52-85` strips the length keywords). The empty string and the empty array are the "nothing" values.
- `explainer/prose.ts` (new), applied to `checkup` strings only. `containsMachineText(text)`: true on `containsCommandText`, a path-like token `(^|[^A-Za-z0-9])[~/][A-Za-z0-9._-]+` (so `"/Users/alice"`, `(/tmp/x)` and `folder:/Library` are caught and "and/or" and "24/7" are not), a port-like token `(?<![0-9]):[0-9]{2,5}\b` (so "18:00" passes), a rule id `\bTL-[A-Z]{3}-`, a fake citation `\b(step|section)\s*[0-9]` (case-insensitive) or `\b(NIST|CISA|SANS|NCSC)\b`, or any of the words pid, kill, rm, unload, launchctl, daemon as whole words, case-insensitive. "delete", "plist", "Terminal", "remove" and "process" are not on this list: the first three appear in the catalogue the model is handed (`tl-mac-005`, `017`, `023`, `024`, `029`, `031`), and `prose.test.ts` runs `containsMachineText` over every catalogue string (title, failTitle, explanation, fix summary, every step) and fails on a hit, so the list can never collide with the catalogue again. `containsAppVoice(text)`: a whole-word `I` (case-sensitive) or any of I'll, I've, I'm, I'd, me, my, mine, we, us, our, let's (case-insensitive). `startsImperative(text)`: any sentence begins with one of click, press, open, go, run, type, turn, switch, tap, enable, disable, delete, remove, check, set, change, choose, select, install, uninstall, update, restart, lock, unlock, use, make, do, don't, start, stop (case-insensitive). `hasBannedGuidedWord(text)`: the `GUIDED_BANNED_WORDS` list exported from `apps/desktop/src/guided/copy.ts`, moved to core as `GUIDED_BANNED_WORDS` in `packages/core/src/guided/words.ts` so the validator and the copy test share one list. The watch validator in Rust adopts the two corrected regex forms and keeps its own word list.
- `explainer/validate.ts`: `readString(value, allowEmpty, max)` gains the per-field cap; `validateCheckup(raw, report, input)`: `summary` through `readString(…, true, 600)`, dropped (null) on `containsCommandText`, `containsMachineText`, `containsAppVoice` or `startsImperative`; `stepLines` missing is treated as empty; each entry's `ruleId` through `readRuleId` against `input.stepRuleIds`, duplicates dropped, `line` through `readString(…, false, 160)` and dropped on any of the four checks, on `hasBannedGuidedWord`, or on more than one sentence; `rejected_output` only when the raw value is not an object, or when the summary was dropped and no line survived. Explain, prioritise and ask validators are unchanged.
- `explainer/remote.ts`: `RemoteTask` gains `"checkup"`; `checkupTurns(input)` builds the one user message `{ task: "checkup", moment, context, stepRuleIds, fixedRuleIds, nextRuleId, previous }`; `SCHEMAS.checkup`.
- `explainer/system-prompt.ts`: the catalogue block gains one line per rule, "Plain name: {guided.headline}"; DATA_CONTRACT names four tasks and describes the checkup fields; OUTPUT gains "For checkup: the app has already chosen the order; comment on it, never propose a different one, and never write what to click. Write to the reader in the second person. Never write as the app and never use I, me, my or we. Use the plain names. summary is two short sentences for this reader. stepLines is one reason sentence per id in stepRuleIds, in the same order, or an empty list when stepRuleIds is empty." The prompt stays one frozen string per catalogue so the provider's prompt cache holds.
- `explainer/on-device-prompt.ts`: `OnDeviceTask` gains `"checkup"`; the builder adds the ids and the plain names of the step rules after the context; the frozen INSTRUCTIONS gain the same sentences in short form and ask for a summary of at most 300 characters; `on-device-prompt.test.ts` asserts the exact new sentences.
- `guided/words.ts` (new): `GUIDED_BANNED_WORDS`, the list from `copy.test.ts` line 6.
- `fixtures/explainer-schemas.json` regenerated with `pnpm fixtures:emit`; `schemas-fixture.test.ts` pins it.

**Rust, `apps/desktop/src-tauri/src/ai`.** `protocol.rs` `Task::Checkup`; `schemas.rs` the checkup schema for `--json-schema`, pinned by `tests/explainer_schemas_contract.rs`; `engine.rs` passes `MAX_TOKENS` 600 as today and skips the first-partial timeout for checkup as it does for prioritise when the Swift helper streams no partials for it.

**Swift, `apps/desktop/sidecar/talos-ai/Sources/Outputs.swift`.** `@Generable struct CheckupOnDeviceOutput { summary: String (guide: at most 300 characters) }`, no `stepLines`. Field names match core's validator; the parity test lists the on-device shape as a subset of the core schema.

**Desktop adapters.** `apple-explainer.ts`, `chatgpt-explainer.ts`, `claude-plan-explainer.ts`, `claude-explainer.ts`, `ollama-explainer.ts`, `no-explainer.ts` gain `checkup`. `demo-explainer.ts` `CannedAnswers.checkup(input)` builds the summary from `situation(context)` and the top two findings' plain names, and one line per step id from `firstSentence(rule.explanation)` with a profile clause; every canned string passes the validators except under `brief=rejected`. Demo params in `apps/desktop/src/app/demo-boot.ts`: `brief=none|slow|rejected` (default canned, 1,200 ms; `slow` is 8 s so the plan screen is left before it lands; `rejected` is a canned summary containing a fenced block so the validator drops it), alongside the existing `ai=`, `explainer=` (which already fails every task, so there is no `brief=failed`), `provider=`, `fixture=`.

**Desktop state.** `machine.ts`: `BriefState { plan: BriefSlot | null; end: BriefSlot | null; calls: number }` with `BriefSlot { key: string; kind: "writing" | "ready" | "failed"; value: Checkup | null }`; `ReadyState.brief`; actions `brief_started { moment, key }`, `brief_ready { moment, key, value }`, `brief_failed { moment, key }`; `recheck_done` filters `plan.value.stepLines` with the `survivingExplanations` rule; `fix_done`, `batch_done`, `watch_tick` and `recheck_failed` carry `brief` through unchanged; `present()` and `landed()` reset it. `survivingPriority(order, priority, report, key)` keeps the order and reasons across a recheck. `useScan` gains `brief(moment, input)` on `briefAbortRef`, the three-call ceiling on `brief.calls`, the abort-and-await rule before every person-initiated call, `ai.report` on provider failures, and the `BriefStore` write and read. `useBrief(moment)` returns `{ kind: "hidden" | "writing" | "ready" | "failed"; value: Checkup | null }` from `scan.scan.brief`, the gate and the availability.

**Desktop components.** The guided controller calls `brief("plan", …)` in `landed()` when the plan has steps; `EndScreen` calls `brief("end", …)` on mount when `fixed` is non-empty; `GuidedModelBlock` and `GuidedModelLine` wrap `ModelText` and the badge; `PlanScreen` renders the block below the link; `ShowStep` (idle only) renders it under the body when present at mount; `ExplainPanel` renders the step line as its first paragraph on fix and batch steps and renders `whatCouldHappen` as a second paragraph; `BatchStep` passes `others`; `EndScreen` renders the block under the "Do this next" card; `Ask` renders the briefing and `ASK_CHIPS`; `SuggestedOrderBody` passes `withReason` for every row; `Settings` moves three profile controls into `YourAiSection`, keeps the full form and the request counter in Developer mode.

**Ports and adapters, persistence.** `BriefStore { load(): Promise<StoredBrief | null>; save(brief): Promise<void>; clear(): Promise<void> }`; `file-brief-store.ts` next to `file-report-store.ts`; `clear()` called from Disconnect, provider change, the AI switch off, and Developer Reset.

**Gate.** None. The brief, the step lines, the briefing on Ask and the end close follow `settings.explainer.aiEnabled` and availability `available`, the same predicate as prioritise and Ask; `gate.explainLocked` is always false and `useAiCardFlow` has no `locked`. The chips follow Ask's availability.

**Settings.** One switch stays: `explainer.aiEnabled` off hides every surface in this document. No per-moment switch.

**Docs touched by the build.** DESIGN-AI section 3 (the probe sentence), section 6 (the checkup fields in "what the provider receives"); SECURITY-MODEL Boundary 3 ("What the model receives" lists the `checkup` envelope: `moment`, `stepRuleIds`, `fixedRuleIds`, `nextRuleId`, `previous.score`, `previous.fixed`, `previous.appeared`, `previous.unreadable`, all rule ids, enums and finite numbers; and the `prose.ts` checks) and Data at rest (the `last-brief.json` row); DESIGN-WATCH section 3 (the two regex forms, the 140-character cap on `ratingReason`); DESIGN-V03 section 1 (the model block sentence); DESIGN-V02 line 466 (a note that this document re-opens it); the readme clauses in section 5.

## 7. Tests and QA

- **Canary per task.** `remote.test.ts` adds `checkup` to `TURNS`, to both task loops (lines 59 and 68) and to the schemas table (line 106), with a `CheckupInput` built from `evaluate(CANARY)`: the ChatGPT and Claude bodies contain neither `INJECT` nor `IGNORE`, the catalogue marker, the first rule title and the first plain name appear only in instructions, and every id in `stepRuleIds`, `fixedRuleIds` and `previous.*` matches `SAFE_STRING_PATTERN` and is a subset of the report's rule ids. A second case builds the input with `CANARY` as the previous report and a second canary fixture as the current one, asserts the body carries no `INJECT` or `IGNORE`, and asserts `previous.score` is a finite number (`Number.isFinite`) or null. `on-device-prompt.test.ts` adds `checkup` to its task loop. `context.test.ts` is unchanged (`ExplainerContext` gains no field).
- **Prose check.** `prose.test.ts`: passes "It comes back at 18:00.", "and/or", "24/7", "Remove the device you don't know.", "Delete the leftover item."; rejects "~/Library/LaunchAgents", "/usr/bin/x", "\"/Users/alice\"", "(/tmp/x)", "folder:/Library/LaunchAgents", "port :8080", "TL-MAC-001", "see step 3", "CISA says", "kill the pid", a fenced block, a line starting with "sudo ". `containsAppVoice` rejects "I'll lock the disk for you now.", "I can fix this in one go.", "Let me show you."; passes "Your Mac goes out with you.". `startsImperative` rejects "Turn this on first.", "click the switch"; passes "The quickest win is the firewall." (the validator cannot catch every advisory sentence; the placement rule in section 1 is the defence for the rest). The catalogue sweep: every string in `MACOS_CATALOG` passes `containsMachineText`.
- **Validator.** `validate.test.ts`: a bad step line drops only that line; a step line for an id not in `stepRuleIds` is dropped; a duplicate id is dropped; a line with two sentences is dropped; a line with "SSH" is dropped; a line with "I'll" is dropped; a 601-character summary is dropped and the lines stand; a missing `stepLines` is an empty list; an output with nothing left is `rejected_output`.
- **Core limits.** `limits.test.ts` covers the new caps; the on-device checkup prompt on dev-machine is under 7,000 characters with 12 findings kept.
- **Schema parity.** `schemas-fixture.test.ts`, `explainer_schemas_contract.rs` and a Swift field-name list test pin the copies; the on-device shape is asserted to be a subset of the core schema.
- **Desktop reducer.** `machine.test.ts`: `brief_started`, `brief_ready`, `brief_failed` on each moment; a `brief_ready` with a stale key is ignored; `recheck_done` filters step lines by section; `fix_done`, `batch_done`, `watch_tick` and `recheck_failed` carry `brief` through; `present()` resets it; `survivingPriority` keeps untouched rules.
- **Desktop hooks.** `useScan`: the plan brief is requested once per landed plan under StrictMode; a cached `last-brief.json` with the matching key makes no call; a mismatched or edited file is dropped and a call is made; a fourth app-started call is refused; a brief that lands after a new landing is discarded; a person-initiated explain aborts a running brief and starts only after the brief's promise settles; a brief is not started while an explain runs; a `limit_reached` brief calls `ai.report`; the end brief runs only with a non-empty fixed list and refreshes once; the ceiling resets per landed plan, not per fix.
- **Desktop components.** `ExplainPanel` renders the step line first on fix and batch steps and `whatCouldHappen` second; the batch step passes `others`. `PlanScreen` renders the block below the link in `ready` and nothing in `writing`, `failed` and `hidden`; the block may appear while mounted. `ShowStep` renders the block only when present at mount, never in `question`. `EndScreen` renders the block under the card and never without fixes. The block never appears on permission, paywall, watching, stale or done screens. `Ask` renders the briefing and the chips; a chip fills the composer and does not submit; the expert home shows chips without a briefing. `Settings` shows "About you" with three controls outside Developer mode when connected, four inside, and the counter inside only.
- **Copy.** `copy.test.ts` walks every new authored string (section 5) under the banned-word list, including `ASK_CHIPS` filled with every `guided.headline`, and asserts `AI_BADGES_SHORT` is walked. `words.test.ts` asserts `GUIDED_BANNED_WORDS` equals the list the copy test uses.
- **Harness shots, demo mode, light and dark, 900 and 1100:** `guided-plan-brief`, `guided-plan-brief-none`, `guided-plan-brief-apple`, `guided-show-step-line`, `guided-fix-step-explain-line`, `guided-batch-step-explain-line`, `guided-explain-two-paragraphs`, `guided-end-brief`, `guided-end-brief-none`, `findings-order-reasons`, `ask-briefing-chips`, `ask-chips-only`, `ask-reading`, `settings-about-you`, `settings-developer-requests`. axe on each. The full badge visible in every shot that carries model text.
- **Only on a real Mac.** The live brief on ChatGPT and on Claude Code (the time to first result on this Mac; whether the 4,000 `max_output_tokens` is tolerated); the on-device brief within 600 tokens on three fixtures; the Claude Code spawn count per check-up equals the Developer counter; `last-brief.json` written, loaded on an unchanged relaunch with zero calls, and deleted on Disconnect.

## 8. Out of scope

The watch surfaces until DESIGN-WATCH is built (moment 8 is the design for them); "Explain for a friend" and any rewrite control; persisted model text beyond the plan reading; model text as a headline, a row, the order, a control label or a button; automatic prioritisation and prefetching of explanations; model-written suggested or follow-up questions; a chat anywhere but Ask; new providers; payment and the licence year's end; Windows and Linux.

## 9. Open questions for the owner

1. **A free taste.** Decided by the owner on 2026-10-17: the AI is free once connected, so the brief, the step lines, the end close and the briefing on Ask run for the free version too. The limited-to-the-free-three alternative is not built.
2. **Persisting the reading.** `last-brief.json` is new data at rest: validated, provider-labelled prose about the person's own check-up, next to a report file that already holds far more. The alternative is in-memory only, which costs one call per launch for the same sentence, or skipping unchanged launches, which hides the first reading from the person who just connected. The owner confirms or rejects the file.
3. **`max_output_tokens` on ChatGPT.** Unchanged; the open question from the limits research stands.
4. **The Claude Code cost of the person winning.** On Claude Code, opening "Explain this" on the first step while the plan brief spawns loses the reading for that check-up. The alternative is to let the person's request wait behind the brief with the "Writing" state shown, which the design rejects because it makes the person wait for text they did not ask for. The owner may prefer the wait.

## 10. Sources

Repository: `docs/DESIGN-V03.md` (section 1 plan, since last time, AI explain, end states; decision on Developer-category rules; section 4 pacer floor and no nagging; section 6 guided strings), `docs/DESIGN-AI.md` (decisions, sections 3, 4, 6, 7, 8), `docs/DESIGN-WATCH.md` (line 9; section 3 WatchContext, WatchVerdict, validator and limits; section 5 window anatomy; section 6 fishy flow), `docs/SECURITY-MODEL.md` (Boundary 3, Data at rest), `docs/DESIGN-V02.md:466`, `packages/core/src/explainer/{context,schemas,validate,limits,remote,system-prompt,on-device-prompt}.ts`, `packages/core/src/ports/explainer-port.ts`, `packages/core/src/guided/{plan,next,diff}.ts`, `packages/core/src/rules/macos/tl-mac-{005,017,023,024,029,031}.ts`, `packages/core/test/explainer/{remote,on-device-prompt,schemas-fixture}.test.ts`, `apps/desktop/src/guided/{ExplainPanel,StepFrame,EndScreen,SinceScreen,landing,copy,copy.test}.tsx|ts`, `apps/desktop/src/guided/screens/{PlanScreen,BatchStep,FixStep,ShowStep}.tsx`, `apps/desktop/src/screens/{Overview,Findings,FindingDetail,Ask,Settings,YourAiSection}.tsx`, `apps/desktop/src/scan/{useScan,machine,useAiAvailability,useScanPacer}.ts`, `apps/desktop/src/app/{labels,gate,demo-boot}.ts`, `apps/desktop/src/adapters/*`, `apps/desktop/src-tauri/src/ai/{protocol,engine,schemas,claude_code}.rs`, `apps/desktop/sidecar/talos-ai/Sources/{Outputs,TalosAI}.swift`. Measurements: a throwaway tsx script against `DEV_MACHINE`, 2026-10-17, removed afterwards.

Providers: https://developers.openai.com/siwc/token-sharing-open-source (and /models-and-inference, /errors-and-recovery, /preview-limitations); https://workos.com/blog/sign-in-with-chatgpt-plan-usage-scope; https://mixed-news.com/en/chatgpt-plus-allowance-16-partner-apps-no-api-key/; https://support.claude.com/en/articles/11647753-how-do-usage-and-length-limits-work; https://support.claude.com/en/articles/11049741-what-is-the-max-plan; https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan; https://code.claude.com/docs/en/legal-and-compliance; https://developer.apple.com/documentation/foundationmodels/systemlanguagemodel/contextsize; https://developer.apple.com/documentation/foundationmodels/generationoptions/maximumresponsetokens; https://developer.apple.com/forums/thread/791380; https://developer.apple.com/videos/play/wwdc2025/286/.

Patterns: https://support.apple.com/guide/mac-help/mchlb2dbea8f (Mail summaries); https://www.engadget.com/mobile/smartphones/ios-183-is-here-with-clearly-labeled-apple-intelligence-notification-summaries-181935725.html and https://www.macworld.com/article/2579807/apple-intelligence-notification-summaries-are-changing-in-ios-18-3.html (labels after the BBC incident); https://macpaw.com/news/introducing-smart-insights; https://support.1password.com/watchtower/; https://www.malwarebytes.com/blog/product/2023/08/trusted-advisor; https://manual.raycast.com/ai and https://manual.raycast.com/ai/bring-your-own-key; https://tidbits.com/2023/10/06/arc-web-browser-introduces-focused-ai-features/; https://www.nngroup.com/articles/AI-conversation-types/; https://cloudscape.design/patterns/genai/genai-loading-states/; https://www.microsoft.com/en-us/haxtoolkit/library/; https://pair.withgoogle.com/chapter/explainability-trust/; https://www.404media.co/opting-out-of-gmails-gemini-ai-summaries-is-a-mess-heres-how-to-do-it-we-think/; https://www.neowin.net/news/office-users-hated-the-new-copilot-button-now-microsoft-is-changing-it/.
