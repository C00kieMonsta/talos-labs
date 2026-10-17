# Talos Labs accept design: "I know, leave it alone"

v0.3 made the app drive and gave the person one way to say "not now": "Do this later", which snoozes a step for 7 days and, after three Laters, retires it without a word. DESIGN-WATCH gave the watch two ways to say "I know": "Yes, that was me" and "This is fine, I know it". This document adds the missing durable word for the check-up: a person can say, for one failing check, "I know about this and I choose not to do it", and the app respects that. It stops proposing the fix everywhere, keeps the check in the report and the score, labels the choice where the score is shown, and lets the person take it back in one place.

This document extends `docs/DESIGN-V03.md`, `docs/DESIGN-AI.md`, `docs/DESIGN-AI-PRESENCE.md` and `docs/DESIGN-WATCH.md`. `docs/SECURITY-MODEL.md` changes in one row of the Data at rest table: the `talos.guided` entry gains the word "accepted". Nothing in the security model moves: the score is still computed by code from statuses and points, the model still receives ids and enums only, nothing runs, nothing is deleted, no new file is written, no new network destination exists. One DESIGN-V03 rule is replaced on purpose, with the new wording in section 3, item 13: "three Laters retire a step" becomes "the third Later asks". Facts about the tree were checked on 2026-10-17 against `packages/core/src/guided/{memory,plan,next,diff}.ts`, `packages/core/src/engine/score.ts`, `packages/core/src/explainer/{context,validate,remote,on-device-prompt}.ts`, `packages/core/src/license/entitled.ts`, `apps/desktop/src/guided/{actions,core,effects,landing,plan,memory,useGuided,EndScreen,copy,copy.test}.ts(x)`, `apps/desktop/src/screens/{Overview,Findings,FindingDetail,Settings}.tsx`, `apps/desktop/src/adapters/{apple,chatgpt,claude,claude-plan,ollama}-explainer.ts`, `apps/desktop/src/app/{gate,container,labels}.ts`, `apps/desktop/src/App.tsx` and the watch sources named in section 3.

The owner's brief, verbatim (2026-10-17): "let the user also check out of some findings saying that you know but you don't want to do it, e.g., encrypt disk, you don't necessarily want to do it".

Decisions taken where the brief left room:

- **The state is called `accepted` in code and "Left alone" to the person.** The person's own words are the control: "Leave it alone, I know the risk". The end screen group says "Things you chose to leave". The word "accept" never appears on screen: it reads as approval, and the person is not approving the risk, they are declining the work.
- **No reason is asked.** The brief names one reason, "I don't want to do it", and that is the only one the app needs. A reason screen is one more tap for a non-technical person, and the choices are hard to write without sounding like an excuse list. The model receives the fact (section 3, item 8), not a why. A closed reason set can be added later as a second map without a migration (section 5).
- **It never expires and is never re-asked.** No 30-day reminder, no "still sure?". The one lapse is automatic and honest: when the check passes, the acceptance is cleared, so a check that fails again later is a step again. This is the watch's own rule (a change that clears takes its answer with it) and the Dependabot rule (a fixed alert cannot stay dismissed). It also avoids 1Password's stuck "Ignored" state. Two rules are exempt from the lapse because they pass and fail on their own cycle: 027 "Your last backup is over a week old" and 010 "An update is waiting". A person who backs up monthly and said "Leave it alone" would otherwise be asked the same question every month. Those two keep their acceptance through a pass (section 3, item 10).
- **The score is one unchanged number plus one label.** `computeScore` takes no memory and stays untouched. The score card gains one line, "1 thing you chose to leave still counts." No second "achievable" figure: a second, higher number is the one a person reads, and Talos has one person reading, not a manager.
- **Undo lives in one place: the Finding detail.** Every accepted row elsewhere (end screen, Findings) opens Details. The strip there has one button, "Ask me again". The 1Password lesson is that undo must sit on something that does not vanish; the finding stays in the report while it fails, and when it passes the acceptance clears itself.
- **The third "Do this later" asks instead of retiring.** Today three Laters retire a step silently and `laterCount` is never cleared, so the rule is gone until a Developer Reset. That is an acceptance the person never gave. From now on the third Later still does everything a Later does (7-day snooze, count, watcher stopped) and then shows one screen: "Shall I stop asking about this?" with "No, keep asking" as the primary and "Leave it alone, I know the risk" as the link. Only the person's answer retires a step. Closing the window on the question costs nothing: the rule is snoozed, as the person asked.
- **A person who knows on day one does not wait three weeks.** The real path is two taps from the end screen on every launch: "Still waiting" row, Details, the offer. The title strip's "Details" opens the Overview, not the finding, so it is not the path. The Findings list reaches the same offer from the expert shell. An open question for the owner is whether `LATER_ASK_COUNT` should be 2 so the guided path asks after one week instead of three.
- **An accepted free fix does not free a slot.** `freeFixRuleIds(report)` stays a function of the report. If it did free a slot, accept-fix-undo would hand every fix out for free one at a time, the drift DESIGN-V03 froze the free set against. The cost lands hardest on the owner's own example: 001 (disk encryption) is critical and worth the most points, so it is always one of the free three. An unlicensed person who leaves it alone has two free fixes left and meets the paywall one fix sooner.
- **Nothing is excluded.** The owner named disk encryption, the one critical rule, as the example, so severity cannot be the bar. Every rule is a setting on the person's own Mac, and SECURITY-MODEL already says the app "does not argue". What stays is the score, the label and the watch. Only `fail` can be accepted: `review` rows are never proposed, `unknown` rows have nothing confirmed to accept.
- **Findings keeps one "Needs fixing" group.** The Overview tile counts every failing rule and so does the Findings group; an accepted rule sits last in that group with a "Left alone" pill. Two screens never show the same label with two counts.
- **The end screen title changes for any accepted rule, whatever its severity.** A screen that reads "Nothing needs fixing." above a group called "Things you chose to leave" is wrong at every severity, so there is no severity bar. "Nothing left for me to do." and "Your Mac is safer than it was." take over whenever that group is non-empty.
- **The watch reads nothing new.** An accepted check keeps failing, which is "none" change to the watch, so nothing fires. A flip on that check can only come from a pass, which clears the acceptance first, so the gate question "Did you just change this?" is the right behaviour then. No push to Rust, no change to `rate.rs` or `watch-cases.json`.
- **"Yes, that was me" does not accept the rule.** "That was me" means "I did it", not "leave it forever". The person who turns the firewall off for an afternoon should see it as a step at the next check-up.

## 1. Principles

- **Honest.** The check stays in the report with status `fail` and its points. The score does not move. The grade sentence does not move. The score card says how many things were left by choice and that they still count. The end screen never reads "in good shape" or "Nothing needs fixing" over an accepted check. The app never says "safe", "protected" or "done" about something the person chose not to do.
- **Respectful.** One tap, the person's own words, no reason, no confirmation dialogue, no "are you sure". The app shows the risk sentence before the choice (NIST's "intentional and informed") and then takes the person at their word, as the watch does.
- **Undoable, in one place.** One dated entry per rule id. "Ask me again" on the Finding detail removes it and nothing else. The Developer Reset clears everything, as today.
- **No nagging.** Once accepted, the check is never a step, never "Do this next", never on the paywall list, never in "Next three fixes", never in the AI's suggested order, never a watch alarm while it stays as it is. It is listed, with a count, in a group whose label says it was the person's choice. Nothing on the Mac is deleted or changed.

## 2. Where the choice is offered

Four surfaces could carry it. Two do.

**The guided step, at the third "Do this later".** `later()` in `apps/desktop/src/guided/actions.ts` keeps every write it makes today, including on the third press: the watcher is stopped when the state is `watching`, `snoozed[id] = now + 7 days` and `laterCount[id] += 1` for every rule of the step. Then, when the count of any rule of the step has reached `LATER_ASK_COUNT` (3), instead of flashing and advancing the step moves to a new `StepState` `{ kind: "ask_accept", ruleIds }`:

> 3 of 5
> **Shall I stop asking about this?**
> I've asked about this a few times. I can stop asking, but your Mac stays at risk until it's done.
> [No, keep asking]
> Leave it alone, I know the risk

The Explain disclosure stays on the screen for a single-rule step, since this is the moment to be informed. "No, keep asking" sets `laterCount` back to 0 for the asked rules and advances with no flash (the snooze is already written), so the question returns after three more Laters and never sooner. "Leave it alone, I know the risk" writes `accepted[id] = now` for the asked rules, removes their `snoozed`, `laterCount` and `waiting` entries, removes them from `core.leftAlone` and from any step in `core.extras`, flashes "OK, I'll leave it alone." for `ACCEPT_FLASH_MS` (1400 ms, long enough to read) and advances. One primary, one link, under the harness assertion and the `StepFrame` lint.

On a batch step, `laterCount` is per rule and batch membership changes between check-ups, so a rule can be at 0 while another is at 3. The ask covers only the rules whose own count has reached `LATER_ASK_COUNT`: `ruleIds` on the state holds those, the screen lists their headlines with `GuidedList` under the body, and the link accepts those and no others. The rest of the batch keeps the ordinary snooze written a moment before. With one rule at the count the singular strings are used; with two or more, "these", "them" and "they're". "I've asked about this a few times" is true at three and stays true on the migration's fourth Later (below).

An old memory with `laterCount` already at 3 or more (a rule retired silently by the current build) is a step again once its snooze has passed, because `bucketFor` no longer reads `laterCount` (section 3, item 1). Its next Later writes the count to 4 and asks. That is the migration: retired rules come back once, as a step, and the person decides.

**The Finding detail, expert shell.** Under the `FixCard` (or the `Lock` block, for a locked rule) of a failing check that is not accepted:

> Don't want to do this? I'll stop proposing it. It still counts against the score.
> [Leave it alone, I know the risk]

A text button, one tap, no confirmation. When accepted, the block is replaced by the strip in section 3, item 7, which carries the undo. This is the one place that reaches both the choice and its reversal. From the guided flow it is two taps from the end screen on every launch: the "Still waiting" row (every Latered rule is there), then Details. From the expert shell it is one tap from any "Needs fixing" row.

**The chat intent "accept".** `docs/DESIGN-CHAT.md` does not exist and `Ask.tsx` has no intent code. Nothing to wire. When a chat design lands, an "accept" intent must call the same `acceptRule(ruleId)` and show the same ask screen for the person to press; the model never writes an acceptance, and a model-parsed intent is never a write.

**The watch's fishy flow.** Not offered. The gate screen keeps "No, I didn't" and "Yes, that was me"; the noticed screen keeps "See what to do" and "This is fine, I know it". Those are answers about a change, written to `watch.json` and `talos.watch`; this document's state is about a proposal, written to `talos.guided`. The two never read each other:

| | watch "This is fine" / "Yes, that was me" | guided "Leave it alone" |
|---|---|---|
| about | one signal change | one failing rule |
| effect | re-baseline; three answers mute | never a step, never proposed |
| store | `watch.json` (Rust), `talos.watch` | `talos.guided` |
| lapse | the next change on that signal | the rule passing (except 027 and 010) |
| undo | none; the next change asks again | "Ask me again" on Details |

**What can be accepted.** Any rule with status `fail`, of any severity, locked or not, in `LEFT_ALONE` or not, developer category or not. Not `review` (never proposed, nothing to stop), not `unknown` (nothing confirmed), not `pass`. Two rules recur by nature and keep their acceptance through a pass: 010 "An update is waiting" passes when the update installs and fails at the next one; 027 "Your last backup is over a week old" passes when a backup runs and fails a week later. For every other rule a pass clears the acceptance and a later failure is a new thing, proposed again.

## 3. What changes everywhere

1. **Plan.** `Bucket` in `packages/core/src/guided/plan.ts` gains `"accepted"`, checked first in `bucketFor`, before `LEFT_ALONE` and the technical check, so an accepted left-alone or developer rule lands in `accepted` and nowhere else. The `laterCount >= SNOOZE_LIMIT` clause is removed; `SNOOZE_LIMIT` is renamed `LATER_ASK_COUNT` and exported for the desktop. `GuidedPlan` gains `accepted: readonly RuleId[]`, filled like `later` and so always failing. `planLocked` runs through the same bucket and needs nothing. The `locked` list is computed from `buckets.eligible`, so an accepted locked rule leaves `lockedRuleIds` and the paywall's count on its own. The desktop's `mergePlan` (`apps/desktop/src/guided/plan.ts`) and `finalPlan` (`core.ts`) bypass `bucketFor` for two lists and must filter them: `liveExtras` and `extraLeftAlone` in `mergePlan`, and `extra` in `finalPlan`, each drop any rule in `fresh.accepted`. Without that, a rule accepted after a failed fix (in `core.leftAlone`) or after a conversion (in `core.extras`) would stay a `nextAction` candidate and be listed twice.
2. **Do this next.** `nextAction` in `packages/core/src/guided/next.ts` builds candidates from `later`, `locked` and the raised part of `leftAlone`. An accepted rule is in none of them, so it is never the card. A test pins it with 001 accepted and failing (section 7).
3. **End screen.** `apps/desktop/src/guided/EndScreen.tsx` gains a group `{ id: "accepted", label: END.chosen, icon: ICONS.eyeOff }` with `plan.accepted` rows, placed after "In the full version" and before "Things I left alone"; rows open Details as every row does. `nothingOpen` stays `waiting.length === 0 && plan.locked.length === 0`: accepted rules do not keep the check-up open. The titles change whenever `plan.accepted` is non-empty, at every severity: `END.nothingLeft` ("Nothing left for me to do.") in place of `END.nothing`, and `END.partial` ("Your Mac is safer than it was.") in place of `END.allDone`. Precedence stays as the line that builds `title` today: the watch's act-now word first, then `allDone` (now `partial` when accepted is non-empty), then the two unread titles, then `nothing` (now `nothingLeft`), then `partial`. So an accepted critical with one unreadable area still reads "Nothing to fix in what I could check." and the accepted group renders under it with its row; that title is true, since the group is on the same screen. No sentence under the title names the accepted rule; the group row does.
4. **Plan screen and Since screen.** Nothing. `planCounts` counts steps, and an accepted rule has none. `diffReports` compares statuses; an accepted rule fixed outside the app is announced as fixed, which is true, and its acceptance is cleared at the same landing (item 10).
5. **Paywall.** The list and the count follow `lockedRuleIds` (item 1). A person who accepts the only locked rule sees no paywall step that check-up. The paywall snooze is unchanged.
6. **Overview and the free three.** `freeFixRuleIds` and `buildGate` are unchanged; an accepted rule keeps its free slot (decision above). "Next three fixes" in `apps/desktop/src/screens/Overview.tsx` drops accepted rules from its rows, since a row there is a proposal; the heading stays, as it already does with one or two rows on a Mac with fewer than three failures. The score card is untouched except one fine-print line under the status line, shown only when the count is above zero: "1 thing you chose to leave still counts." / "2 things you chose to leave still count." The count is `acceptedFailing(memory, report).length` (item 10), never the raw map. The "Needs fixing" tile keeps counting every failing rule, accepted or not, because they do need fixing. `SuggestedOrderBody` gains an `accepted` prop and filters both `then` and `omitted` by it, so an accepted rule never appears under "Then, in points order" either (item 8).
7. **Findings and Finding detail.** `apps/desktop/src/screens/Findings.tsx` keeps accepted rules inside "Needs fixing", sorted after every other failing rule, each `FindingCard` carrying the pill "Left alone" (points line kept, since the points still count). No separate group: the tile on the Overview and the group here then agree. `FindingDetail.tsx`: an accepted failing check keeps its headline, severity badge and "Why it matters", gets the status pill "Left alone", and in place of the fix card or the lock block shows the strip: "You chose to leave this on 17 October. It still counts against the score." with the button "Ask me again". The AI card and the recheck card stay. When not accepted, the offer block from section 2 sits under the fix card or the lock block. Both read `acceptedFailing`, so a rule that passed since the last landing never shows the strip.
8. **The AI's document.** `ExplainerFinding` in `packages/core/src/ports/explainer-port.ts` gains `accepted: boolean`. `toExplainerContext(report, catalog, profile, accepted = [])` takes the rule ids and sets the flag; nothing else in the row changes, and the canary test asserts the field is a boolean. The desktop threads the ids through the one call site: `buildContext(report, profile, accepted)` in `apps/desktop/src/app/container.ts`, and in `App.tsx` the `deps` memo's `toContext` becomes `(report) => buildContext(report, settings.profile, Object.keys(memory.accepted))` with `memory` added to the memo's dependency list. That is safe: `useScan` holds its state in a reducer and keys its callbacks on `deps`, so a new `deps` rebinds the callbacks and keeps the report. For prioritise, the accepted findings are removed before the model sees them, not after: `prioritiseTurns` in `packages/core/src/explainer/remote.ts` and the prioritise branch of `buildOnDevicePrompt` in `on-device-prompt.ts` drop rows with `accepted: true` from the document; `explainerEligibleRuleIds(report, accepted = [])` drops the same ids, and the five adapter validation sites (`apple-explainer.ts` `built.kept`, and `explainerEligibleRuleIds(report)` in `chatgpt-explainer.ts`, `claude-explainer.ts`, `claude-plan-explainer.ts` and `ollama-explainer.ts`) pass the accepted ids read from `context.findings`. `validatePrioritisation` is unchanged and its permutation check holds. Explain and Ask keep the row with the flag, and the frozen prompts gain one sentence: "A finding marked accepted is one the reader knows about and chose to leave. Never tell them to fix it; mention it only when asked." The sentence lands in the remote system prompt builders in `remote.ts` and in the `INSTRUCTIONS` string of `on-device-prompt.ts`, pinned by `on-device-prompt.test.ts`. The `checkup` task of DESIGN-AI-PRESENCE, when built, needs nothing more: `stepRuleIds` has no accepted rule (no step) and `nextRuleId` is never one (item 2); the row flag reaches it through the context.
9. **The watch.** No change to `watch-context.ts`, `context.rs`, `rate.ts`, `rate.rs`, `cycle.rs` or `fixtures/watch-cases.json`. An accepted rule keeps failing, so its `WatchRule.change` is `none` and nothing floors or ceilings on it. A pass clears the acceptance at the next landing or rebuild (item 10), so by the time a bad flip can happen the rule is a plain rule again and a gated signal asks "Did you just change this?" as designed. One gap, named here and left: a pass seen only by the watch's full check between two main-window launches does not clear the acceptance, since the clear runs in the webview; the watch's own gate covers the flip in that window.
10. **Clearing on pass.** `clearAcceptedThatPass(memory, report)` (core, pure) removes an accepted id when its status is `pass` or `not_applicable`, except the ids in `KEEP_ACCEPTED_THROUGH_PASS` (`["TL-MAC-027", "TL-MAC-010"]`, exported from `plan.ts`); `fail`, `review` and `unknown` keep it, so a check that could not be read does not lose the person's choice. It runs in both `landed()` and `rebuilt()` in `apps/desktop/src/guided/landing.ts`, before the plan is built, saving through `writeMemory` when the result differs. Between a pass and the next rebuild the raw map can still name a passing rule, so every screen reads `acceptedFailing(memory, report)`: the accepted ids whose finding has status `fail`.
11. **Licence gate.** `gate.fixLocked` and `gate.explainLocked` are unchanged. Accepting a locked rule is allowed from Details (the offer sits under the lock block) because it stops a proposal and unlocks nothing.
12. **Details writes reach the guided flow.** `rebuilt()` runs today only when the report changes (`effects.ts`). Accepting on Details changes memory, not the report, so without more the same step would still be offered on the way back. `useGuided` already has the branch that adopts an outside `deps.memory` (one that is neither `core.memory` nor `core.lastSaved`); that branch now also calls `rebuilt(core, report)` with the held report when the phase is `since`, `plan`, `step` or `end`, so the step is gone and the index holds.
13. **Developer mode and Reset.** `GuidedDevBlock` already prints the memory JSON and its Reset writes `EMPTY_GUIDED_MEMORY`, which clears acceptances with everything else. The plan rows there gain "· accepted <date>" beside "· snoozed until".
14. **DESIGN-V03 wording.** Three places. Line 26, the ordering rule: "not past three Laters" becomes "not accepted (`docs/DESIGN-ACCEPT.md`)". Section 4, "No nagging": replace "A rule snoozed by "Do this later" is not a step for 7 days and after three Laters never again (until it is fixed elsewhere);" with "A rule snoozed by "Do this later" is not a step for 7 days; the third Later asks whether to stop, and only the person's answer retires it (`docs/DESIGN-ACCEPT.md`);". The "Do this later" step paragraph gets the same replacement. The `GuidedMemory` block in section 4 gains the `accepted` line from section 5 below. `docs/DESIGN-AI-PRESENCE.md` section 7 changes one clause: "`context.test.ts` is unchanged (`ExplainerContext` gains no field)" becomes "`ExplainerFinding` gains `accepted` (`docs/DESIGN-ACCEPT.md`); `ExplainerContext` gains no other field".

## 4. Copy

Every string is in `apps/desktop/src/guided/copy.ts` under the banned-word test. Scores are from the fixed 1.6 counter in `copy.test.ts`, run on 2026-10-17; primaries are at or under 28 characters. Links have no cap; the one below is 31 characters at `--text-guided-meta`, the same width class as "Connect the AI you already use".

```ts
export const ACCEPT = {
  title: "Shall I stop asking about this?",      // 1.33
  titleMany: "Shall I stop asking about these?", // 1.33
  body: "I've asked about this a few times. I can stop asking, but your Mac stays at risk until it's done.",       // 1.25
  bodyMany: "I've asked about these a few times. I can stop asking, but your Mac stays at risk until they're done.", // 1.25
  primary: "No, keep asking",                    // 1.33, 15 chars
  link: "Leave it alone, I know the risk",       // 1.14
  linkMany: "Leave them alone, I know the risks",// 1.14
  flash: "OK, I'll leave it alone.",             // 1.20
  flashMany: "OK, I'll leave them alone.",       // 1.20
  /** The Finding detail offer and strip; the expert shell may use a real button. */
  offer: "Don't want to do this? I'll stop proposing it. It still counts against the score.", // 1.20
  strip: "You chose to leave this on {date}. It still counts against the score.",             // 1.08
  undo: "Ask me again",                          // 1.33, 12 chars
  pill: "Left alone",                            // 1.50
} as const;
```

`END` gains `chosen: "Things you chose to leave"` (1.00) and `nothingLeft: "Nothing left for me to do."` (1.17). The Overview line is `"{n} thing{s} you chose to leave still count{s}."` (1.00), built like `things()` in `EndScreen.tsx`. `{date}` is rendered by a new `formatDate(iso)` in `apps/desktop/src/app/labels.ts`, `new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long" })`, never a raw ISO string; the existing `formatDateTime` includes the year and the time and is not used here.

The body counts the app's asks, not the person's refusals, so it does not tally the person's behaviour at the moment they are asked to commit. "A few times" is true at three and at the migration's fourth.

Rejected on the way: "Keep reminding me" (1.67, over the counter), "You've put this off three times" (counts the person, and false on the fourth), "I accept the risk" (reads as approval), "Hide" and "Dismiss" (Apple's and Chrome's words; they say the warning goes away, and here it does not), "Ignore" (1Password; the app does not ignore it, it stops proposing it).

## 5. Storage

`localStorage["talos.guided"]`, `GuidedMemory` in `packages/core/src/guided/memory.ts`, version stays 1:

```ts
/** ruleId -> ISO when the person said "Leave it alone, I know the risk". */
readonly accepted: Readonly<Record<string, string>>;
```

Ids and dates only, parsed by the existing `dateMap` (rule-id key, ISO value; anything else dropped). `EMPTY_GUIDED_MEMORY.accepted` is `{}`. No migration: `parseGuidedMemory` falls back field by field, so an older memory loads with `accepted: {}`, and an older build that reads a newer memory drops the map on its next save, which loses acceptances and nothing else. `laterCount` keeps its shape; its meaning changes from "retire at 3" to "ask at 3, reset on 'No, keep asking'". The `docs/SECURITY-MODEL.md` Data at rest row for `talos.guided` gains "the date each check was left alone by choice (`accepted`)". Nothing is written to `watch.json`, `watch-settings.json` or `last-report.json`. The demo seeds it through the existing `memory=<json>` boot parameter.

## 6. Contracts

**Core (`packages/core`).**

- `GuidedMemory.accepted`; `EMPTY_GUIDED_MEMORY`; `parseGuidedMemory` adds `accepted: dateMap(raw.accepted)`.
- `isAccepted(memory: Pick<GuidedMemory, "accepted">, ruleId: RuleId): boolean`.
- `acceptedFailing(memory: Pick<GuidedMemory, "accepted">, report: ScanReport): readonly RuleId[]`, the accepted ids whose finding has status `fail`, in report order.
- `clearAcceptedThatPass(memory: GuidedMemory, report: ScanReport): GuidedMemory`, returns the same object when nothing changes; skips `KEEP_ACCEPTED_THROUGH_PASS`.
- `plan.ts`: `Bucket` adds `"accepted"`; `bucketFor` checks it first and drops the `laterCount` clause; `export const LATER_ASK_COUNT = 3`; `export const KEEP_ACCEPTED_THROUGH_PASS: readonly RuleId[] = ["TL-MAC-027", "TL-MAC-010"]`; `GuidedPlan.accepted`.
- `next.ts`: no code change; a test.
- `explainer-port.ts`: `ExplainerFinding.accepted: boolean`. `context.ts`: `toExplainerContext(report, catalog, profile, accepted: readonly RuleId[] = [])`; `explainerEligibleRuleIds(report, accepted: readonly RuleId[] = [])` drops the ids. `remote.ts`: `prioritiseTurns` drops accepted rows from the document; the system prompt builders for explain, prioritise and ask gain the sentence. `on-device-prompt.ts`: the prioritise branch drops accepted rows; `INSTRUCTIONS` gains the sentence. `validate.ts`: unchanged.
- Watch: nothing.

**Desktop (`apps/desktop`).**

- `StepState` gains `{ kind: "ask_accept"; ruleIds: readonly RuleId[] }`; `initialStepState` never returns it; `FixStep`, `ShowStep` and `BatchStep` render it with `StepFrame` (progress, title, body, primary, link, `explainRuleId` on single-rule steps, the `GuidedList` of the asked headlines on a batch).
- `actions.ts`: `later()` keeps its writes and the `stopWatch()` call, then moves to `ask_accept` with the rules whose count reached `LATER_ASK_COUNT`, or flashes and advances as today when none did; new `keepAsking(core)` and `accept(core)` as in section 2, `accept` also pruning `core.leftAlone` and `core.extras`; `GuidedController` exposes `keepAsking` and `accept`. `ACCEPT_FLASH_MS = 1400` in `timing.ts`, collapsed by `pace=0`.
- `landing.ts`: `landed()` and `rebuilt()` run `clearAcceptedThatPass` and save through `writeMemory` when it differs, before the plan is built or merged.
- `plan.ts` (desktop): `mergePlan` filters `liveExtras` and `extraLeftAlone` by `!fresh.accepted.includes(r)`. `core.ts`: `finalPlan` filters `extra` the same way.
- `useGuided.ts`: the outside-memory branch also calls `rebuilt(core, report)` with the held report in the `since`, `plan`, `step` and `end` phases.
- `AppContextValue` (`apps/desktop/src/app/context.ts`) gains `guidedMemory: GuidedMemory`, `acceptRule(ruleId: RuleId): void` and `unacceptRule(ruleId: RuleId): void`; `App.tsx` owns the state already (`useState(() => loadGuidedMemory())`) and the two writers go through `saveMemory`. `container.ts`: `buildContext(report, profile, accepted)`. `App.tsx`: `toContext` passes `Object.keys(memory.accepted)` and `memory` joins the `deps` memo list.
- Adapters: the five validation sites pass the accepted ids read from `context.findings` to `explainerEligibleRuleIds` (or filter `built.kept` the same way in `apple-explainer.ts`).
- `EndScreen.tsx`: the group, the two title swaps when `plan.accepted` is non-empty.
- `Overview.tsx`: the fine-print line; the "Next three fixes" filter; `SuggestedOrderBody` `accepted` prop filtering `then` and `omitted`.
- `Findings.tsx`: accepted rules last in "Needs fixing" with the pill. `FindingDetail.tsx`: the offer block, the strip, the pill, "Ask me again".
- `labels.ts`: `formatDate(iso)`.
- `Settings.tsx`: the dev block row; no new setting. There is no switch for this feature and none is wanted: it is the person's per-check word, not a preference.
- Demo: no new parameter; `memory={"version":1,"accepted":{"TL-MAC-001":"2026-10-10T09:00:00.000Z"}}` seeds the shots.

## 7. Tests and QA

**Core (`vitest`).**

- `parseGuidedMemory`: `accepted` round-trips; a non-rule-id key, a non-ISO value and a non-object are dropped; a memory without the key loads as `{}`.
- `plan-memory.test.ts`: an accepted rule is absent from steps and listed under `plan.accepted`; an accepted `LEFT_ALONE` rule (014) is in `accepted`, not `leftAlone`; an accepted developer rule with `technical: "low"` is in `accepted`, not `technical`; an accepted batch member shrinks the batch and one left converts to a single fix; an accepted locked rule leaves `lockedRuleIds` and, when it was the only one, the paywall step; the existing "a thrice-Latered rule is absent" case flips to "a thrice-Latered rule is still a step once its snooze passes" with the comment that the ask screen owns retirement now.
- `next.test.ts`: with 001 accepted and failing, and 010 in `later`, the card is 010; with only 001 accepted, `nextAction` is null.
- `clearAcceptedThatPass`: clears on `pass` and `not_applicable`, keeps on `fail`, `review` and `unknown`, keeps 027 and 010 through a pass, returns the same object when nothing changes. `acceptedFailing`: lists only ids whose finding fails.
- `context.test.ts`: `accepted` is true for exactly the ids given and false otherwise; the canary asserts the field is a boolean and no new string field exists; the prioritise document carries no accepted row; `explainerEligibleRuleIds(report, ["TL-MAC-001"])` omits 001 and keeps the rest; a prioritisation from the remaining ids validates.
- `on-device-prompt.test.ts`: `INSTRUCTIONS` contains the accepted sentence; the prioritise prompt built from a context with one accepted row omits that row.
- The watch parity fixture is untouched and the test proves it by not changing.

**Desktop (`vitest`, jsdom, fake timers).**

- `useGuided.steps.test.ts`: the first and second Later flash and advance as today; the third writes the snooze and the count, then shows `ask_accept`; the third Later on a watching show step stops the watcher before asking; "No, keep asking" writes `laterCount` 0 and advances with the snooze still in place; "Leave it alone" writes `accepted[id]` at `now`, removes the rule's `snoozed`, `laterCount` and `waiting`, flashes for 1400 ms and advances; on a batch of 002 (count 2) and 003 (count 0), the third Later asks about 002 alone with the singular strings and 003 keeps its snooze; a memory with `laterCount` 3 from before is a step and asks on its next Later; `finalPlan` lists a rule accepted this run under `plan.accepted`; a converted show step and a `leftAlone` rule that are then accepted appear in neither steps, extras, `plan.leftAlone` nor `nextAction`; an accept through `deps.memory` while on that rule's step removes the step and holds the index.
- `EndScreen.test.ts`: the group renders with its rows and each row navigates to the finding; the accepted rule is never the next card even at the most points; "Nothing left for me to do." with an accepted low and nothing fixed; "Your Mac is safer than it was." with an accepted high and one fixed; "Nothing to fix in what I could check." with an accepted critical, nothing fixed and one unreadable area, with the group rendered under it.
- `FindingDetail`: the offer renders for a failing, unaccepted check (locked or not), not for review, unknown or pass; pressing it calls `acceptRule`; the strip renders the date through `formatDate` and "Ask me again" calls `unacceptRule`; the pill reads "Left alone"; a rule in the map whose finding passes shows neither.
- `Findings`: the accepted rule stays in "Needs fixing", sorted last, with the pill. `Overview`: the line is absent at zero, singular at one, plural at two; "Next three fixes" hides the accepted row; with 001 accepted the suggested order card renders no row for 001 under any heading.
- `copy.test.ts`: `ACCEPT` and the two `END` strings join the banned-word walk; `ACCEPT.title`, `titleMany`, `body`, `bodyMany`, `offer`, `strip`, `END.chosen` and `END.nothingLeft` join the 1.6 list; the 28-character walk becomes `walk({ FISHY, ACCEPT })` with the expected count raised from 10 to 11 (only `ACCEPT.primary` matches the `primary` prefix), plus an explicit `expect(ACCEPT.undo.length).toBeLessThanOrEqual(28)`.
- `StepFrame` lint: `ask_accept` rendered for fix, show and batch asserts exactly one `.button-primary` and one `.guided-link`.

**Harness (Playwright), demo mode, light and dark, 1100x760 and 900x600, axe on all.** `guided-ask-accept` (`memory` with `laterCount` 2 for 001, then Later once), `guided-ask-accept-batch` (`licensed=1`, `laterCount` 2 for 002 and 003, 0 for 011; the screen lists two headlines), `guided-accept-flash` (volatile), `guided-end-chosen` (001 accepted, one fix), `guided-end-nothing-left` (001 accepted, nothing fixed), `finding-detail-offer`, `finding-detail-left-alone`, `findings-left-alone-pill`, `overview-chosen-line`. Assertions: one primary and at most one link on the ask screen; the end screen never contains "in good shape" or "Nothing needs fixing" with 001 accepted; `__talosDemoCalls` records no fix call on an accept.

**Only on a real Mac.** Nothing: the feature touches no OS surface.

## 8. Out of scope

- A reason for the choice, closed or free text.
- Accepting `review` or `unknown` rows.
- An expiry, a reminder or a "still sure?" of any kind.
- Pushing accepted ids to the Rust watch, and the watch-only pass gap named in section 3, item 9.
- A chat intent (no `docs/DESIGN-CHAT.md`).
- The `checkup` task's envelope beyond the row flag (not built).
- A free slot freed by an acceptance; the Overview heading mismatch with fewer than three rows, which predates this document.
- Carrying acceptances between Macs or across a reinstall.
- Any copy change in the design kit's website.
