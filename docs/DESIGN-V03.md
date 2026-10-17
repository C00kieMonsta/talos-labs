# Talos Labs v0.3 design: guided autopilot

v0.2 built a fix engine and an on-device AI helper and kept both on a short leash. v0.3 changes who drives. The app checks the Mac on its own when it opens, builds a short plan, and walks the person through it one screen at a time. It does the work itself where the catalog lets it, opens the right System Settings page and waits where macOS makes it stop, and keeps every v0.2 screen one link away as "Details".

This document is the build spec. It extends `docs/DESIGN-V02.md`; nothing in the v0.2 security model changes. The webview still picks catalog rows and never writes a command, Rust still binds every argument from its own listings, there is still one native password dialog per run, no raw machine string reaches the model, and nothing leaves the Mac. File paths are relative to the repo root. Facts about the tree were checked on 2026-10-16 against `apps/desktop/src/scan/{useScan,useFix,useScanPacer,machine,awayPolling,useCapabilityPoll}.ts`, `apps/desktop/src/app/{gate,router,demo-boot}.ts`, `apps/desktop/src/settings/index.ts`, `apps/desktop/src-tauri/src/fix/{catalog,plan,run,privileged}.rs`, `apps/desktop/src-tauri/src/commands.rs`, `packages/core/src/{domain/finding.ts,domain/rule.ts,ports/fix-port.ts,license/entitled.ts,rules/fix-catalog.ts}` and the fixtures. The dev Mac is macOS 27.0.1 on arm64.

The owner's brief, which this design serves and does not re-open: "There is still too much clicking and discovery. Imagine this app being used by someone with no skills and very little understanding of computers. This needs to be much more guided and autopilot from a functionality point of view."

Decisions taken where the brief left room:

- **The plan is a pure function.** `buildGuidedPlan` in `packages/core` turns the report, the licence gate, the profile and a small local memory into an ordered list of steps. No model decides what to do or in what order. AI stays an optional "Explain this" disclosure.
- **Admin items run before user-level items in a batch.** The password dialog is the first thing that happens, so when it is cancelled nothing has changed and the screen can say so truthfully. User-level items (013, 030) run only after the admin script succeeded or had nothing to run.
- **No progress counter during the admin script.** All admin lines run in one `osascript` child; `do shell script` returns the script's output as its result when the child exits, so Rust cannot know which line is running. The screen shows one status line and the per-item results arrive with the outcome. Nothing on screen counts something it cannot see.
- **Per-item results come from marker lines on stdout, not from the exit code.** The v0.2 `|| exit 1N` scheme stops at the first failure and names one step. A batch runs each item in its own subshell, silences the commands, prints `R <item> <code>`, and ends with `exit 0` so the output comes back.
- **022 and 029 are never batched.** 022 takes a share path and 029 a passphrase. A batch holds only rules whose Rust spec is `Choice::None` or `Choice::AllSshKeys` with `Secret::None`, so no path and no secret ever travels in a batch call. 022 becomes one single step per guest share.
- **Developer-category rules (029, 030, 031) are steps only when `profile.technical` is `medium` or `high`.** The default is `low`, so the owner's mother never sees a screen about login keys. They are named on the end screen as "for a technical person". This is a default, not a question.
- **Scan on every launch.** A report loaded from disk leaves the scan machine in `idle`, not `ready`; `previewFix`, `startWatch` and `recheck` all require `ready`. A plan built on a loaded report would have no way to act, so the app scans (paced, as in v0.2) every time it opens, and uses the loaded report only for the "since last time" comparison.
- **Rules that need a person are never steps.** 005 (Recovery mode), 014 (a half-hour account workflow), 017, 018 (blocking all incoming connections can break things the person uses), 024, 028 and 031, and every `review` finding, appear as one line on the end screen under "Things I left alone", with a Details link.

## 1. The guided flow, screen by screen

Every guided screen has: a progress line ("2 of 7") above the headline, one headline, at most two short sentences, one primary button, and at most one text link under the button. The only other control a step may carry is the "Explain this" disclosure inside the body (section 1, "AI explain"), rendered only when AI is usable. "Details" lives in the title strip, not on the step. Rule ids below are for this document; the person never sees them. Copy is final unless marked placeholder.

### Ordering rule

`buildGuidedPlan(report, gate, profile, memory, now)` (section 7) produces steps in this order. "Unlocked" means `gate.licensed` or the rule id is in the plan's frozen free set (below). "Eligible" means `status === "fail"`, not in the left-alone set, not developer-category for a `low` profile, not snoozed, not past three Laters, and not in the 24 h `waiting` window.

1. **Batch**, once, when two or more eligible unlocked rules are batchable (`fix.apply.kind === "in_app"`, `choice` is `none` or `all_ssh_keys`, `passphrase` is false). Exactly one batchable rule becomes a single **fix** step instead, through the v0.2 single path.
2. **Fix** steps for eligible unlocked in-app rules that need a choice or a secret: 022, one step per `sharePath` evidence entry in evidence order; 029, one step per unprotected key. Points descending, then catalog order.
3. **Show-me-where** steps for eligible unlocked `deep_link` rules whose `fix.sideEffects` is not `restart`: 004, 006, 012, 026, 027. Points descending, then catalog order. 026 carries the one inline question.
4. **Show-me-where** steps for eligible unlocked `deep_link` rules with side effect `restart`: 001 then 010. They go after every other free step because a restart ends the session.
5. **Permission**, once, when 028 is `unknown` with `unknownReason: "needs_full_disk_access"` and `memory.permissionAskedAt.full_disk_access` is absent or older than 30 days. It comes after the fixes because it unlocks a check, not a fix. Automation is never a step: a `not_determined` prompt lands during the scan on the `loginItems` row as in v0.2, and a `denied` state is a Settings row.
6. **Paywall**, once, when at least one eligible rule is locked and `memory.paywallSnoozedUntil` is absent or in the past. It sits after every free step, so the person has already seen the app work, and after the restart steps, so no critical fix ever follows it. Locked rules are listed on it by headline.

When the licence turns valid on the paywall step, the locked rules are planned by the same rules 1 to 4 and appended after the paywall; the progress total grows. A rule whose batch item failed is appended as a show-me-where step when it has a pane, otherwise it joins "Things I left alone". The progress count never goes down.

Steps are keyed by id (`batch`, `fix:TL-MAC-022:/Users/alice/Public`, `show:TL-MAC-001`, `permission:full_disk_access`, `paywall`), so a report that changes mid-flow (a recheck, a watcher tick) never moves the person to a different step than the one they are on.

**The free set is frozen per check-up.** `gate.freeFixes` is recomputed from the current report (`buildGate` in `App.tsx`, memoised on the report; `freeFixRuleIds` takes the three failing rules worth the most points). Rebuilding the plan with the live gate would drift: on the unlicensed dev machine, fixing the free 002 makes 022 free (next by points), then 026, and an unlicensed run could fix everything one step at a time. So the controller reads `gate.freeFixes` once, when the paced scan lands (`presented`), stores it on the plan as `GuidedPlan.freeFixes`, and passes that list in place of `gate.freeFixes` on every rebuild (recheck, watch tick, batch outcome) until the next full scan (`start()`). A rebuild gets `gate.licensed` live, so a key pasted on the paywall still unlocks, but the free set never changes under the person's feet. A core test rebuilds the unlicensed dev-machine plan after 002 passes with the frozen set and asserts `lockedRuleIds` is still `[003, 011, 022, 026]`. The v0.2 Overview "next three" list and the expert finding screens keep using the live gate, so they drift the same way v0.2 did; that is known and out of scope here, because the expert path has a confirmation sheet per fix and the guide is the default home.

### First launch

Welcome replaces the v0.2 Welcome form on the guided home. The profile keeps its defaults (`individual`, `low`, `false`, `true`); the form moves to Settings under Developer mode.

> **Let's check your Mac.**
> I'll look at your Mac's safety settings and fix what I can. Nothing leaves your Mac.
> [Start]
> What do you look at?

"What do you look at?" expands the v0.2 Reads and Never reads lists in place, unchanged. "Start" saves `onboarded: true` with the default profile and starts the paced scan. There is no Skip.

### Automatic check-up

The v0.2 Scanning screen, reused under the guided type scale, toolbar title "Checking your Mac", the Cancel icon on the right as today. The 17 rows and the "n of 17 areas" subline stay because the pacing is information. The row labels come from `GUIDED_SECTION_LABELS` in `apps/desktop/src/guided/copy.ts`, which spreads the v0.2 `SECTION_LABELS` and overrides the three rows that carry banned words: `ssh` "Checking your login keys" (was "Checking SSH keys"), `passwordPolicy` "Checking password settings" (was "Checking the password policy"), `dotfiles` "Checking files for saved passwords" (was "Checking shell config files"). The map is under the same banned-word test as the rest of `copy.ts`; the v0.2 `SECTION_LABELS` stay as they are for the expert Scanning screen. The counter reads "3 things to fix so far" (the `attention` count; `review` is not counted here); that is a code change in `screens/Scanning.tsx`, where `counterText` and the row-label lookup take a `guided` flag, and the v0.2 "3 found so far" string stays for the expert screen. The Automation prompt on the `loginItems` row is handled in place as in v0.2.

Later launches go here straight away, no Welcome (section 4). A cancelled first check-up lands on:

> **I stopped before finishing.**
> [Check again]

A check-up that fails (`scan.scan.kind === "failed"`: `collector_crashed`, `timeout` or `schema_mismatch`) lands on the `failed` phase, one screen for the three errors:

> **I couldn't finish checking.**
> Something went wrong on my side, not yours. Nothing was changed.
> [Try again]

"Try again" is `start()`. Developer mode adds the `SCAN_ERROR_LABELS` sentence for the error under the body. The expert Banner for a failed scan is not rendered in the guided shell; `cancelled` keeps the "I stopped before finishing." screen.

### The plan

Shown once per check-up, after `presented`, when at least one step exists.

> 0 of 5
> **I found 3 things to fix.**
> I can fix 1 of them for you now. The other 2 I'll show you where.
> [Let's go]
> Show me the list

Counts are rules, not steps: the first number is every rule in a batch, fix or show step; "for you" is batch and fix rules; "show you where" is show rules. Singular forms: "I found 1 thing to fix.", "I can fix it for you now.", "I'll show you where." When nothing is fixable in app: "They all need a quick visit to System Settings. I'll show you where." When every step is a permission or paywall step: "I found nothing to fix myself." plus the sentence of the step that follows. Locked rules are not in these counts; the paywall step names them.

"Show me the list" expands, in place, one line per rule in step order with `guided.headline` and a tag: "I'll do this" or "I'll show you where". The button stays. "Let's go" opens the first step.

### Since last time

On a later launch with a saved report, after the check-up, the plan screen is preceded by this screen when `diffReports` is non-empty:

> **Since last time.**
> 2 things got fixed. 1 new thing needs fixing.
> [Carry on]

Lines, each only when its count is non-zero: "2 things got fixed." "1 new thing needs fixing." "I couldn't check 1 thing this time." Below them, one line per rule in `fixed` and `appeared` with its `guided.headline`. "Carry on" goes to the plan, or to the end state when the plan is empty. When nothing changed and steps remain, the plan screen's second sentence becomes "Same 3 things as last time." When nothing changed and nothing is left, the end state shows directly.

### Step type: fix-all batch, one password

> 1 of 5
> **I can fix 3 things for you now.**
> Your Mac will ask for your password once. That is macOS asking, not me, and I never see it.
> • The firewall is off
> • Your Mac answers strangers on the network
> • App Store apps do not update on their own
> [Fix these for me]
> Do these later

The list is `guided.headline` per rule. "Fix these for me" calls `previewBatch` with the rule ids, then `applyBatch` at once; there is no confirmation sheet, the step is the confirmation. Developer mode adds a "What will run" disclosure under the list with every plan line and its privilege once the preview lands.

Status lines, in order, replacing the button:

- "Getting ready" (`previewing`)
- "Your Mac is asking for your password. Then I'll get to work." (the osascript child is running; this one line covers the dialog and the script, because Rust cannot tell them apart)
- "Working" (user-level items, if any)
- "Checking it worked" (`rechecking`)

After, every item done:

> **Done. 3 things fixed.**
> • The firewall is on
> • Your Mac stays quiet
> • App Store apps update on their own
> Next

The rows are `guided.done` without the "Done." prefix, each with a tick. Auto-advance after 1400 ms (section 5).

After, partial:

> **2 of 3 fixed.**
> • The firewall is on
> • Your Mac stays quiet
> • App Store apps did not change. I'll show you where to do it instead.
> [Carry on]

A failed item with a pane (`fix.settingsPane`) is appended to the plan as a show-me-where step; one without a pane goes under "Things I left alone". An item whose command ran but whose recheck still fails is treated the same as a failed item. An item whose recheck section could not be read reads "I made the change but could not check it. I'll check next time you open me." and is counted as done.

A converted step watches like a native one. The v0.2 `startWatch(ruleId)` returns early for any rule whose `fix.apply.kind` is `in_app` (every batchable rule), so `useFixActions.startWatch` gains an optional second argument, `startWatch(ruleId, watch?: { sections: readonly SectionKey[]; everyMs: number })`. When it is given, the hook skips the `in_app` early return and the `fix.apply.watch` lookup and polls the given sections at the given interval; everything else (the `watch_started` action, the away poller, `watch_passed`, `saveLast`) is the v0.2 code. `buildGuidedPlan` fills the converted step's `watch` from `fix.apply.recheck` (the sections the apply would have re-read) and `watchEvery` from `WATCH_EVERY_MS` (3 s), and the controller always passes a show step's `watch` and `watchEvery` to `startWatch`, so native deep-link steps and converted steps go through one call. The same conversion serves a single fix step that fails with `command_failed` ("Show me where" below). The expert "Watch for the change" button keeps calling `startWatch(ruleId)` with no second argument.

Items the preview refused (`BatchPlan.excluded`, `precondition_changed` at preview) are dropped from the list before the step is shown and routed as if they had failed: one with a pane becomes a show-me-where step appended to the plan, one without a pane goes under "Things I left alone". When the exclusion leaves one item, the step becomes a single fix step; when it leaves none, the preview is rejected (`invalid_choice`, below) and the batch is re-planned from the next report.

The guided batch step exposes no cancel control while the admin script runs: there is no button, no link, and Escape does nothing (section 5). `fix_cancel` stays available to the expert FixSheet and to a window close. On the guided path a `cancelled` outcome can therefore only come from the dialog itself (`classify` on `-128`, `-60006` or "User canceled"), and "Nothing was changed." is true. The controller still runs the union recheck on every outcome, `cancelled` included: when any item passes after a cancel (the kill path, where the `/bin/sh` the authorization server spawned ran on), the partial screen is shown with those items ticked instead of the cancelled row. The copy is chosen after the recheck, never before.

Dialog-level failures (nothing ran, every item `not_run`):

| `BatchOutcome.error` | headline | sentence | button · link |
|---|---|---|---|
| `cancelled` | You closed the password box. | Nothing was changed. | Try again · Do these later |
| `wrong_password` | That password did not work. | Nothing was changed. | Try again · Do these later |
| `timeout` | Your Mac did not answer. | Nothing was changed. | Try again · Do these later |
| `command_failed` (osascript exited non-zero with no marker, e.g. `-60007` no user interaction, or the child was killed) | That did not work. | Nothing was changed. | Try again · Do these later |
| `plan_expired`, `precondition_changed`, `busy` (rejected `fix_apply_batch`); `invalid_choice`, `not_in_catalog` (rejected `fix_preview_batch`) | Let me look again. | (the step re-previews on Try again) | Try again · Do these later |

The `command_failed` row is shown only when the union recheck confirms every item still fails (above); a second `command_failed` in a row on the same step routes every item as failed (pane to show step, else left alone) instead of offering a third try. "Do these later" snoozes every rule in the batch.

### Step type: fix-for-me, single

Used for one batchable rule on its own, for 022 per share, and for 029 (technical profiles only).

> 2 of 5
> **A shared folder has no password.**
> Anyone on your network can open it without a password. I can stop that. Your Mac will ask for your password.
> [Stop sharing it]
> Do this later

The second sentence is `guided.why`, then "I can fix that for you." or the rule's own line, then "Your Mac will ask for your password." when `needsPassword`, or "No password is needed." otherwise. The button is `guided.verb`. It calls `previewFix(ruleId, choice)` then `applyFix()` with no sheet. For 029 the v0.2 `PassphraseForm` (two fields, Show toggle, the hint) renders inline above the button, which reads "Add a password"; validation as in v0.2. Status lines as in the batch, then the tick and `guided.done`, then auto-advance.

Failure copy, by outcome:

| outcome | headline | sentence | button · link |
|---|---|---|---|
| `cancelled` | You closed the password box. | Nothing was changed. | Try again · Do this later |
| `wrong_password` | That password did not work. | Nothing was changed. | Try again · Do this later |
| `command_failed`, rule has a pane | That did not work. | I'll show you where to do it instead. | Show me where · Do this later |
| `command_failed`, no pane | That did not work. | I've left it alone. | Next |
| `timeout` | Your Mac did not answer. | Nothing more was run. | Try again · Do this later |
| `invalid_choice`, `invalid_input`, `not_in_catalog` | I can't do this one from here. | I'll show you where instead. (when a pane exists; else "I've left it alone.") | Show me where or Next · Do this later |
| `plan_expired`, `precondition_changed`, `busy` | Let me look again. | (re-previews on Try again) | Try again · Do this later |
| recheck `still_failing` | It ran, but the setting has not changed yet. | macOS sometimes needs a moment. | Check again · Do this later |
| recheck `unreadable` | I made the change but could not check it. | I'll check next time you open me. | Next |

"Check again" on `still_failing` re-reads the plan's `recheck` sections once more through the same reread the apply used; it is part of the fix and free. "Show me where" turns the step into a show-me-where step with the same headline, watching `fix.apply.recheck` every `WATCH_EVERY_MS` through `startWatch(ruleId, { sections, everyMs })` (the batch section above).

### Step type: show-me-where, with watching

> 3 of 5
> **Your disk is not locked.**
> If your Mac is lost or stolen, anyone can read your files. macOS has to do this one, so I'll open the right page and wait.
> [Show me where]
> Do this later

"Show me where" calls `openSettingsPane(pane)` and `startWatch(ruleId, { sections: step.watch, everyMs: step.watchEvery })`, and for 001 and 010 adds the rule to `memory.pendingRestart`. The screen becomes:

> **I've opened the right page.**
> Click "Turn On" next to FileVault. Write down the recovery key it shows you. Your Mac may restart.
> ⟳ I'll notice when it changes.
> I'll do it later

The instruction is `guided.where`. The spinner line is `role="status"`. The watcher is the v0.2 away-watch (`startWatch` in `useFixActions`, over `awayPolling`), with one addition: `pollOnFocusReturn` fires a poll the moment the window regains focus instead of waiting one interval.

- When the rule passes (`watch_passed`): tick, `guided.done`, auto-advance.
- When focus has been back for the 10 s grace with no pass (`onPaused`): the headline becomes "It doesn't look changed yet.", the sentence "The page is still open in System Settings." Primary "Check again" (one more reread of the watch sections; free, it is part of the watch). Link "I'll do it later".
- At the 10 min cap (`onExpired`) with no pass: the step moves itself on, the rule goes into `memory.waiting` for 24 hours, and the next screen opens with a one-line notice "I'll ask about this again another day."
- For 001 and 010 the sentence under the headline gains "Your Mac may restart. I'll carry on when you open me again." On the next launch (section 4), a `pendingRestart` rule that now passes counts as fixed on the "since last time" screen; one that still fails is a step again.

### The one inline question (026)

Before opening Time Machine on step 026, instead of the usual button:

> **Your Mac has no backup.**
> If it breaks or is lost, your photos and files go with it. Do you have a disk for backups?
> [Yes, show me where]
> No, I'll get one later

"No" snoozes 026 for 30 days, shows "A small external disk is enough. Plug it in and I'll help next time." for 1400 ms, and advances. This is the only question in v0.3.

### Step type: do it later

"Do this later" (or "Do these later") writes `snoozed[ruleId] = now + 7 days` and `laterCount[ruleId] += 1`, shows "OK, I'll remind you another day." for 800 ms, and advances. No confirmation. After three Laters the rule stops being a step and only appears under "Still waiting" on the end screen until it is fixed elsewhere.

### Step type: permission, just in time

> 4 of 5
> **Can I check your web browser too?**
> macOS needs you to flip one switch so I can read which browser add-ons you have. I read nothing else.
> [Show me where]
> Not now

"Show me where" writes `talos.continue = {"kind":"guided"}` first, then runs `open()` on the controller's permission flow. The flow is `usePermissionFlow("full_disk_access", initialPermissionState("full_disk_access", capabilities), flowDeps)`, called once inside `useGuided`: `initialPermissionState` is the v0.2 helper in `components/PermissionCard.tsx` and always yields `not_granted` for Full Disk Access (`not_determined` exists only for Automation); `capabilities` is the latest `Capabilities` value `App.tsx` already holds for the Settings screen; `flowDeps` are `capabilities`, `openPane`, `restart` and `collectSection` forwarded from the `useGuided` deps, plus `recheck: (sections) => scan.recheck(sections)` as the free recheck. `collectSection` is never called for Full Disk Access (the flow uses it only for a `not_determined` Automation prompt) but the hook requires it, so `useGuided` forwards it rather than stubbing it. The key is written before the pane opens because System Settings' own "Quit & Reopen" relaunches the app with no hook for the app to act on; a key left behind when no relaunch happens is read and cleared on the next normal launch, which scans anyway. Watching copy: "**I've opened the right page.** Find Talos Labs in the list and switch it on." with the spinner. On `granted`: tick, "Done. I'll check your browser now.", the free `recheck(["browsers"])`, auto-advance. On `reopen_needed` (focus back 10 s with the probe still false): "**Nearly there.** macOS applies this once Talos Labs reopens." Primary "Quit and reopen" (`reopen()`), link "Not now". On the relaunch the app scans and resumes at the first step whose rule is still failing (section 4). "Not now" writes `permissionAskedAt.full_disk_access = now` and advances; the step is not offered again for 30 days.

### Step type: paywall

> 5 of 5
> **There are 4 more things to fix.**
> The full version does them all and keeps an eye on your Mac from the menu bar.
> • Your Mac answers strangers on the network
> • App Store apps do not update on their own
> • A shared folder has no password
> • Your Mac has no backup
> [Buy the full version, £PRICE]
> [Paste your licence key          ]
> Not now

£PRICE is a placeholder. The button calls `open_buy_page`; the field is the v0.2 `LicenceField` with auto-verify on paste and stays in place for the key on return. On `valid`: "**Thank you.** Carrying on." for 800 ms, then the locked rules are planned and appended (ordering rule above) and the next step opens. "Not now" writes `paywallSnoozedUntil = now + 14 days` and goes to the end state, where the locked rules are counted under "in the full version". The paywall never appears before the first free step, never twice in a run, and never again within 14 days of "Not now".

### AI explain

On every batch, fix and show-me-where step, when `aiUsable` is true, the body ends with a small disclosure "Explain this". Open, it streams `explain(ruleId)` through the v0.2 chokepoint into a panel under the sentences (the batch step explains the first rule in the list and offers the others as plain text buttons inside the panel), with a "Stop" link while streaming. It collapses on advance. It is never on the path: no step waits on it. Locked AI (free tier) hides the disclosure; the paywall step already covers the full version.

### End states

All done:

> **Your Mac is in good shape.**
> I'll check again next time you open me.

Partial:

> **Your Mac is safer than it was.**
> 3 things fixed today.
> Still waiting: Your disk is not locked · An update is waiting
> In the full version: 4 things
> Things I left alone: Your main account can change anything · Some apps open when you log in
> For a technical person: 1 thing
> I couldn't check 1 area.

Each line appears only when its count is non-zero; every rule name is its `guided.headline` and a text button into that finding's Details. The end screen has no primary button; the title strip's "Details" is the way out, and "Check again" is a text link that starts a new paced scan (it is a rescan, which is free; the v0.2 manual "Check again" recheck stays paid).

Nothing to do, straight from the check-up:

> **Nothing needs fixing.**
> I'll check again next time you open me.

With unreadable areas: a third line, "I couldn't check 2 areas." with a Details link.

## 2. Information architecture

Routes (`apps/desktop/src/app/router.ts`) gain `{ name: "guided" }`. `HOME` is chosen at boot in `App.tsx`: `guided` when `settings.guided.home` is true (the default), else `overview`. The expert routes `overview`, `findings`, `finding`, `ask` and `settings` are unchanged.

**Guided shell.** The sidebar is not rendered. The 52 px title strip keeps `data-tauri-drag-region` and the traffic lights at (18, 18); the brand row sits to their right; on the right of the strip two text controls: "Details" (navigates to `overview`) and a gear icon button (Settings). The content column is centred, 560 px max width, 72 px top padding. The guided controller lives in the app context (`useGuided` is called next to `useScan` in `App.tsx`), so leaving to read a finding and coming back lands on the same step, a batch in flight keeps running, and a watcher keeps polling. "Details" stays enabled while a batch or a watcher runs; the v0.2 machine already owns that state.

**Expert shell.** The v0.2 sidebar plus a new first row, "Check-up" (`ShieldCheck`), which navigates to `guided`. When the guided home is on, every expert screen's toolbar shows "‹ Check-up" on the left (the finding screen keeps "‹ Findings" and reaches Check-up through the sidebar row). Opening a finding from Overview and fixing it there is visible to the guide because the plan is a pure function of the report: the step disappears on return and the total shrinks only when the person was not past it; a step the person has passed stays counted as done.

**Settings** for this persona, in order:

1. **Check-up.** Two switches: "Check my Mac when I open Talos Labs" (`guided.autoScan`, on) and "Start on the guided check-up" (`guided.home`, on). One sentence: "With these off, Talos Labs opens on the Overview and waits for you."
2. **AI explanations.** Unchanged from v0.2.
3. **Permissions.** Unchanged.
4. **Licence.** Unchanged.
5. **Developer mode.** The v0.2 disclosure, plus "About you" (the profile form, moved here from the v0.2 Welcome; the defaults stand for everyone else) and a **Guided** block: the current plan as a list (step id, kind, state, snooze date), the guided memory as JSON with a Reset button, "Run the check-up now", "Skip the cooldown", and a "Plan JSON" copy button.
6. **About.** Unchanged.

Developer mode on guided screens: the rule id in the progress line, the "What will run" disclosure on batch and fix steps listing every plan line with its privilege, the exit code and step on a failure, and the raw `R` marker lines after a batch. Developer mode never changes what runs.

## 3. Batch fix engine

### Rust: `fix/batch.rs` (new)

```rust
use super::catalog::{Choice, FixSpec, Secret};
use super::plan::{Plan, PlanLine, Running};
use super::{FixError, run};

/// Which catalog rows may join a batch: no choice to make, no secret, no pty.
/// 002, 003, 007, 008, 009, 011, 013, 015, 016, 019, 020, 021, 030. A test pins the set.
pub fn batchable(spec: &FixSpec) -> bool {
    matches!(spec.choice, Choice::None | Choice::AllSshKeys) && spec.secret == Secret::None
}

pub struct BatchPlan {
    pub id: String,
    /// In run order: admin items in catalog order, then user-level items in catalog order.
    pub items: Vec<Plan>,
    pub created: Instant,
}

#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct BatchItemWire { pub rule_id: String, pub lines: Vec<PlanLine>, pub recheck: Vec<&'static str>, pub previous: Option<String> }

#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct BatchExcluded { pub rule_id: String, pub error: FixError }

/// The wire shape returned by `fix_preview_batch`.
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct BatchPlanWire {
    pub plan_id: String,
    pub items: Vec<BatchItemWire>,
    /// Items the preview refused one by one (precondition_changed), so the UI can route them elsewhere.
    pub excluded: Vec<BatchExcluded>,
    pub needs_password: bool,
    /// Union of every item's recheck, in SectionKey::ALL order.
    pub recheck: Vec<&'static str>,
    pub expires_at: String,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq)] #[serde(rename_all = "snake_case")]
pub enum ItemStatus { Done, Failed, NotRun }

#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct BatchItemOutcome {
    pub rule_id: String,
    pub status: ItemStatus,
    /// Failed only.
    pub error: Option<FixError>,
    /// Failed only: 0-based step within the item, when a marker named it.
    pub step: Option<usize>,
}

#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct BatchOutcome {
    /// Every item Done.
    pub ok: bool,
    pub items: Vec<BatchItemOutcome>,
    /// The dialog itself failed (cancelled, wrong_password, timeout): nothing ran, every item is NotRun.
    pub error: Option<FixError>,
}

/// Builds every item through `run::preview(rule, &FixChoice::None)`, then applies the batch rules.
pub fn preview_batch(rules: &[String]) -> Result<BatchPlan, FixError>;
pub fn apply_batch(plan: &BatchPlan, running: &Arc<Running>, emit: &dyn Fn(FixStatus)) -> Result<BatchOutcome, FixError>;

/// One subshell per item; every command silenced; one report line per item.
pub fn item_block(index: usize, lines: &[String]) -> String;
/// Ordered item blocks, then `exit 0` so the script's own status is always success and stdout comes back.
pub fn batch_script(blocks: &[String]) -> Vec<String>;
/// "R <item> <code>" lines, split on CR, LF or CRLF; anything else is ignored. None when an item has no line.
pub fn parse_markers(stdout: &str, items: usize) -> Vec<Option<i32>>;
/// ADMIN_TIMEOUT plus 15 s per admin item: 17 items give 375 s.
pub fn batch_timeout(admin_items: usize) -> Duration;
/// "Talos Labs wants to fix 3 things on this Mac."
pub fn prompt_for_batch(count: usize) -> String;
```

**Preview.** Each rule goes through the existing `run::preview(rule, &FixChoice::None)`, so binding, `read_previous` (013) and the precondition check (020) are the same code as a single fix. Batch-level refusals, which reject the whole call with `invalid_choice`: a duplicate rule id, a rule whose spec is not `batchable`, and an empty list after exclusion. An unknown rule rejects with `not_in_catalog`. An item whose own preview returns `precondition_changed` lands in `excluded` with that error instead of failing the batch. There is no item cap: the batchable set is 13 rules by construction. The plan is stored in `PlanStore` beside single plans with the same five-minute `PLAN_TTL`.

**Ordering inside a batch.** Admin items first, in catalog order (002, 003, 007, 008, 009, 011, 015, 016, 019, 020, 021), then user-level items (013, 030). There is no dependency between 020 and 021: rule 020 passes with evidence `coveredByRemoteManagement` whenever Remote Management is loaded, so the two never fail together and 020's precondition only needs the re-check it already gets.

**Apply, three phases.**

1. Preconditions are re-checked for every item before the dialog, as `run::apply` does today. An item that fails now is reported `Failed` with `precondition_changed` and left out of the script.
2. One `osascript` for every admin item. Each item is a block:

```rust
pub fn item_block(index: usize, lines: &[String]) -> String {
    // `lines` are privileged::shell_line(j, tokens, tolerate) for the item's steps, so quoting,
    // the tolerated exit and the `exit 1N` step markers are the tested v0.2 ones.
    let silenced = lines.iter().map(|l| format!("{{ {l}; }} >/dev/null 2>&1")).collect::<Vec<_>>().join("; ");
    format!("( {silenced} ); echo R {index} $?")
}
```

   The group `{ cmd || test $? -eq 3 || exit 11; } >/dev/null 2>&1` puts the redirect on the whole group, so the command's own output never reaches stdout, while `exit 1N` still leaves the subshell with the step's marker and the later steps of that item do not run. The subshell's status becomes the item's code: 0 is `Done`; a code in `MARKER_BASE..MARKER_BASE + 10` is `Failed` with `step: Some(code - MARKER_BASE)`; any other code is `Failed` with `step: None`. The blocks are joined with `; ` and the script ends with `exit 0`, so `do shell script` returns stdout as its result instead of raising. `admin_source` gains a `without altering line endings` variant for batches; the parser accepts CR, LF and CRLF anyway because the line-ending behaviour is on the real-Mac list. The prompt is `prompt_for_batch(n)`. The child's timeout is `batch_timeout(n)`. `classify(stderr, status)` runs first, unchanged: `cancelled`, `wrong_password` and `timeout` become `BatchOutcome.error` with every item `NotRun`, and the user-level phase does not run, so "Nothing was changed" is true. The marker range in `classify` is untouched because the batch script never exits with a marker.
3. User-level items run through `run_user`, one `BatchItemOutcome` each, after a successful admin phase or when there were no admin items. A `fix_cancel` here marks the remaining items `NotRun`.

The recheck is the frontend's: one `reread` over the union `recheck`, then `rulePasses` per item.

**Status events.** `FixStatus` gains `item: Option<usize>` with `#[serde(skip_serializing_if = "Option::is_none")]`, so the single-fix payload is byte-identical to v0.2. A batch emits `waiting_for_password` (step 1 of 1) before the osascript child and `running` with `item: Some(i)` before each user-level item. Nothing is emitted during the script.

### Tauri commands (`commands.rs`)

```
fix_preview_batch(rules: Vec<String>) -> BatchPlanWire     rejects with invalid_choice, not_in_catalog; stores for 5 min
fix_apply_batch(plan: String) -> BatchOutcome               rejects plan_expired, busy; the run resolves, even on cancel
fix_cancel(plan)                                             unchanged; works on a batch id, kills the current child
```

`PlanStore` stores `enum Stored { Single(Plan), Batch(BatchPlan) }` in its one map. `insert(plan: Plan) -> FixPlan` wraps as `Stored::Single` and keeps its signature; `insert_batch(plan: BatchPlan) -> BatchPlanWire` is new. `start(id) -> Result<(Stored, Arc<Running>), FixError>` returns the enum, and `fix_apply` rejects a `Stored::Batch` with `plan_expired` as `fix_apply_batch` rejects a `Stored::Single`, so a batch id can never run through the single path or the reverse. The one `Running` slot is unchanged, so a batch and a single fix report `busy` to each other. `fix_preview` and `fix_apply` are untouched and keep serving the expert screens and the single guided step.

### TypeScript port (`packages/core/src/ports/fix-port.ts`)

```ts
export interface BatchPlanItem {
  readonly ruleId: RuleId;
  readonly lines: readonly FixPlanLine[];
  readonly recheck: readonly SectionKey[];
  readonly previous: string | null;
}
export interface BatchPlan {
  readonly planId: string;
  readonly items: readonly BatchPlanItem[];
  readonly excluded: readonly { readonly ruleId: RuleId; readonly error: FixError }[];
  readonly needsPassword: boolean;
  readonly recheck: readonly SectionKey[];
  readonly expiresAt: string;
}
export type BatchItemStatus = "done" | "failed" | "not_run";
export interface BatchItemOutcome {
  readonly ruleId: RuleId;
  readonly status: BatchItemStatus;
  readonly error: FixError | null;
  readonly step: number | null;
}
export interface BatchOutcome {
  readonly ok: boolean;
  readonly items: readonly BatchItemOutcome[];
  readonly error: FixError | null;
}
export interface FixProgress {
  readonly planId: string;
  readonly phase: FixPhase;
  readonly step: number;
  readonly of: number;
  /** Batch only: the user-level item being run. */
  readonly item?: number;
}
export interface FixPort {
  // the four v0.2 methods, unchanged
  previewBatch(ruleIds: readonly RuleId[]): Promise<BatchPlan>;
  applyBatch(planId: string, options?: FixApplyOptions): Promise<BatchOutcome>;
}
```

`TauriFixAdapter` validates the wire shapes as it does for `FixPlan` (every outcome `ruleId` must be in the plan, statuses in the closed set) and folds a rejected `fix_apply_batch` into `{ ok: false, items: [], error }` with a string outside `FixError` mapped to `command_failed`, as the single path does.

### Scan machine and hook

`scan/machine.ts`: `FixingState` becomes a union on `kind`:

```ts
export type FixingState =
  | { readonly kind: "single"; readonly plan: FixPlan; readonly phase: FixingPhase; readonly step: number; readonly of: number; readonly error: FixError | null; readonly result: RecheckVerdict | null }
  | { readonly kind: "batch"; readonly plan: BatchPlan; readonly phase: FixingPhase; readonly step: number; readonly of: number; readonly item: number | null; readonly error: FixError | null; readonly outcome: BatchOutcome | null; readonly byRule: Readonly<Record<string, RecheckResult>> };
```

The `single` variant is the v0.2 shape plus the tag; the phases keep their names. `FindingDetail.tsx` reads `scan.scan.fixing?.plan.ruleId` today, so it narrows on `kind === "single"` first; for the `batch` variant `fixing` is null and `busy` is true (the v0.2 `fixing !== null && fixing === null` rule gives that for free), so the finding screen shows its "another fix is running" state. `FixFlow` (`components/FixSheet.tsx`) returns null for the `batch` variant; the expert sheet never renders a batch, which only the guided batch step draws. New actions `batch_previewed { plan }`, `batch_done { state, report, outcome, byRule, verdicts }`; `fix_progress` sets `item` on the batch variant and ignores it on the single one. `scan/useFix.ts` gains `previewBatch(ruleIds)` and `applyBatch()`: preview, `fix_progress` as events arrive, apply, one `reread` over the plan's union `recheck`, a verdict per item from `rulePasses`, then `batch_done` and `saveLast`.

### Safety argument

Nothing new can run. The webview sends rule ids, as it does today, now in a list; every item is bound by the same `run::preview` as a single fix; `batchable` excludes every row that takes a path or a secret, so no `FixChoice` payload and no passphrase exist on the batch path. The script is assembled from the same `sh_quote`, `shell_line` and `admin_source`; the only new text is `( { … } >/dev/null 2>&1; … ); echo R i $?` and the final `exit 0`, where `i` is an integer Rust formats itself. Still one `osascript`, one dialog, the script over stdin, the prompt stating the count. The only new input Rust reads is the script's stdout, which the redirects reduce to marker lines and which is parsed with an anchored regex; a stray line cannot select or alter a command, only misreport an item, and a misreport is corrected by the recheck. The batch id is random, expires in five minutes, runs once. The LLM is not in the loop. Developer mode shows the lines and markers and never edits them.

## 4. Autopilot rules

**When it scans.** On every launch, when `settings.onboarded` and `guided.autoScan` are true, after `loadLast()` has returned so the previous report is held for the diff. The scan does not start twice within 60 s in one process (a ref in `App.tsx`; this covers StrictMode's double effect and a relaunch loop). A relaunch for a permission grant scans too. The main window never scans on focus or wake: a window left open for a week shows the same end screen until the app is reopened or "Check again" is pressed. The menu bar watch ticks on wake (`docs/DESIGN-WATCH.md`). Never while a batch, a fix or a watcher is in flight. The paced schedule from v0.2 is kept; the 6 s floor (4.5 s reduced motion) is the lower bound.

**What counts as a change.** `diffReports(previous, next)` compares `results[].status` per rule id. `fail` to `pass` or `not_applicable` is `fixed`; `pass`, `not_applicable` or `unknown` to `fail` is `appeared`; `fail` to `unknown` is `unreadable`. `review` changes and score deltas are not announced. A rule in `memory.pendingRestart` that now passes counts as `fixed` and is removed from the list; one that still fails is a step again. With no previous report the diff is empty.

**No nagging.** A rule snoozed by "Do this later" is not a step for 7 days and after three Laters never again (until it is fixed elsewhere); the backup question snoozes 026 for 30 days; the paywall for 14 days per "Not now"; the permission step for 30 days per "Not now"; a watcher that hit the 10 min cap marks the rule `waiting` for 24 hours. The "since last time" screen only appears when the diff is non-empty. The menu bar watch (`docs/DESIGN-WATCH.md`) is the one exception, decided on purpose: while it is on, the app re-reads settings on a timer, shows one of three states in the menu bar, and may notify once when something needs doing now. The main window still speaks only when it is opened, and the watch never fixes anything on its own.

**Memory.** `localStorage["talos.guided"]`, parsed field by field with fallbacks like `parseSettings`:

```ts
export interface GuidedMemory {
  readonly version: 1;
  /** ruleId -> ISO until. */
  readonly snoozed: Readonly<Record<string, string>>;
  readonly laterCount: Readonly<Record<string, number>>;
  /** Watcher timed out: ruleId -> ISO until. */
  readonly waiting: Readonly<Record<string, string>>;
  readonly pendingRestart: readonly RuleId[];
  readonly paywallSnoozedUntil: string | null;
  readonly permissionAskedAt: Readonly<Partial<Record<PermissionKind, string>>>;
}
```

Only rule ids and dates. No rule text, paths or evidence. The last report keeps living in the v0.2 `FileReportStore` (`<app_data>/last-report.json`); nothing else is stored.

**Relaunch.** `talos.continue` becomes JSON: `{ "kind": "fda" }` (what v0.2's `reopen()` writes as the bare string `"fda"`, still accepted) or `{ "kind": "guided" }`. The guided controller writes it when the permission step opens the pane and when its "Quit and reopen" button is pressed. On launch `App.tsx` reads and clears it, scans (the held state never survives a relaunch), and the controller resumes at the first step of the new plan whose rule is not already fixed, skipping the plan screen and the "since last time" screen. The old step index is not persisted, so a report that changed under the relaunch cannot send the person to a stale step.

**A Mac with nothing to fix.** Scan, then the quiet end state. No plan, no paywall, no AI card. The "since last time" screen shows only when something got fixed outside the app since the last run.

## 5. Visual and interaction rules

Tokens added to `apps/desktop/src/styles/tokens.css`, used only under `.guided`: `--text-guided-title: 600 26px/1.2 var(--font)`, `--text-guided-body: 400 17px/1.5 var(--font)`, `--text-guided-list: 400 16px/1.45 var(--font)`, `--text-guided-meta: 500 14px/1.3 var(--font)`. The expert screens keep the v0.2 scale.

- Layout: one centred column, 560 px max width, 72 px top padding under the 52 px title strip. The progress line sits above the headline at `--text-guided-meta` in `--fg-secondary`, with a 3 px bar under it filling `done / of` in `--accent` (`role="progressbar"`, `aria-valuetext="Step 2 of 7"`).
- One primary button per screen, 44 px tall, `--text-guided-body` weight 600, full `--accent`, at most 320 px wide, left-aligned under the body, at most 28 characters. The secondary action is one text link at `--text-guided-meta` in `--fg-secondary` under the button, a `button` element, never a second button. Destructive verbs do not exist in the guide.
- Lists (batch before and after, the plan list, the end screen) are `role="list"` rows at `--text-guided-list` with a 20 px icon slot (`LoaderCircle`, `CircleCheck` in `--success-fg`, `CircleX` in `--fg-secondary`); the state is also in the text ("did not change"), never colour alone.
- Motion: a step change crossfades over `--motion-base`. The done tick draws in over 240 ms, the headline swaps to the done line, and auto-advance fires 1400 ms after the tick starts. Auto-advance pauses while the window is unfocused and resumes on focus. A "Next" link is always under the done line, so nobody waits on a timer. Reduced motion: no fade, no stroke animation, the tick appears at once, auto-advance after 1800 ms.
- Status lines use the v0.2 `LoaderCircle`, static under reduced motion, and are `role="status"`.
- Focus moves to the headline (`tabIndex=-1`) on every step. The done line is announced through `role="status"`; auto-advance announces "Next: " plus the new headline. Enter on a focused step activates the primary button. Escape does nothing while a batch, a fix or a watcher is running.
- Minimum hit target 44 px on the primary, 32 px on links. Contrast 4.5:1 for every guided token in light and dark; axe runs on every guided shot. Type never goes below 14 px on guided screens.
- The window minimum stays 900 x 600, and the primary button and the link sit above the 600 px fold on every step (harness assertion).

## 6. Copy system

Every rule gains `guided: GuidedStrings` in `packages/core/src/domain/rule.ts`:

```ts
export interface GuidedStrings {
  /** The problem, reading age about 10, no trailing stop, at most 60 characters. */
  readonly headline: string;
  /** One sentence why it matters to this person, at most 110 characters, ends with a stop. */
  readonly why: string;
  /** Primary button for a fix-for-me step, at most 22 characters; "Show me where" for every deep_link rule; "Details" for rules with no pane (manual). */
  readonly verb: string;
  /** Shown with the tick. Starts with "Done." */
  readonly done: string;
  /** What to do on the opened page. Non-null exactly when fix.apply.kind is "deep_link". */
  readonly where: string | null;
}
```

A catalog test asserts every rule has all five; the length caps; `headline` has no trailing stop and `why` and `done` end with one; `done` starts with "Done."; `where` is non-null exactly when `fix.apply.kind === "deep_link"`; `verb` is "Show me where" exactly when `fix.apply.kind === "deep_link"` (001, 004, 006, 010, 012, 014, 018, 023, 025, 026, 027) and "Details" exactly when it is `manual` (005, 017, 024, 028, 031), so a left-alone deep link such as 014 keeps "Show me where" as the button on its Details screen while never being a step; and no string contains a banned word, matched as a whole word, case-insensitive: finding, findings, severity, CIS, rule, rules, policy, configuration, SSH, launchd, plist, daemon, sudo, Terminal, TCC, stealth, sysadminctl, command, points. macOS's own labels (FileVault, Remote Login, Screen Sharing, Remote Management, Time Machine) are allowed because the person sees them on the opened page. A syllables-per-word ceiling of 1.6 over `headline` and `why` is a crude reading-age guard. The counter is fixed so the test is reproducible: split on whitespace, drop tokens with no letter, strip everything but a-z from each word (so "add-on" and "login-key" are one word each), count runs of `[aeiouy]`, subtract one for a trailing "e" when the word has more than one run and does not end in "le", floor at one per word; the ratio is total syllables over word count, and a string passes at 1.6 or below. Under this counter "every" is 3 and "Apple" is 2, which errs long. Every `headline` and `why` in the table below was checked against it on 2026-10-16; the highest are 004 headline (1.60), 007 why (1.60), 021 why (1.53), 018 headline (1.57) and 028 headline (1.56). Earlier drafts of 005, 006, 014, 017, 018, 022, 028 and 030 headlines and of 010, 014 and 021 why lines failed it and were rewritten; "Built-in virus protection is missing" scored 2.0.

| id | headline | why | verb | done | where |
|---|---|---|---|---|---|
| 001 | Your disk is not locked | If your Mac is lost or stolen, anyone can read your files. | Show me where | Done. Your disk is locked. | Click "Turn On" next to FileVault. Write down the recovery key it shows you. Your Mac may restart. |
| 002 | The firewall is off | It keeps other computers on the same Wi-Fi from reaching your Mac. | Turn it on | Done. The firewall is on. | null |
| 003 | Your Mac answers strangers on the network | Staying quiet makes your Mac harder to find on public Wi-Fi. | Make it quiet | Done. Your Mac stays quiet. | null |
| 004 | Apps from anywhere can open | Letting only known apps open stops most bad downloads. | Show me where | Done. Only known apps can open. | Under "Allow applications from", choose "App Store & Known Developers". |
| 005 | A built-in safety guard is off | It stops programs from changing the parts of macOS that keep you safe. | Details | Done. The protection is back on. | null |
| 006 | Virus checks are missing | macOS checks downloads for known bad software, and this part is not there. | Show me where | Done. Virus checks are back. | Click "Update Now" and wait for it to finish. |
| 007 | Updates are not fetched on their own | Updates close holes that bad software uses, and fetching them yourself is easy to forget. | Turn it on | Done. Updates are fetched on their own. | null |
| 008 | macOS updates do not install on their own | A Mac that updates itself stays safe without you thinking about it. | Turn it on | Done. macOS updates install on their own. | null |
| 009 | Safety fixes do not install on their own | Apple sends small urgent fixes between updates, and these should just happen. | Turn it on | Done. Safety fixes install on their own. | null |
| 010 | An update is waiting | Until it is installed, your Mac is missing fixes Apple has sent. | Show me where | Done. Your Mac is up to date. | Click "Update Now". Your Mac will restart. Open me again afterwards. |
| 011 | App Store apps do not update on their own | Old apps have holes that new versions close. | Turn it on | Done. App Store apps update on their own. | null |
| 012 | Your Mac stays unlocked after the screen goes dark | Anyone walking past can use it before a password is asked. | Show me where | Done. A password is asked right away. | Next to "Require password after screen saver begins", choose "Immediately". |
| 013 | Your screen stays on too long when you step away | A screen that locks itself keeps others out when you forget. | Lock it sooner | Done. Your screen locks itself. | null |
| 014 | Your main account can change anything | A second account for daily use limits what a mistake or a bad program can do. | Show me where | Done. Your main account is a normal one. | Add a new account marked Administrator, log in as it, then untick "Allow this user to administer this computer" on your own account. |
| 015 | The Guest account is on | Anyone can use your Mac without a password. | Turn it off | Done. The Guest account is off. | null |
| 016 | Your Mac logs in without a password | Anyone who turns it on is straight in. | Turn it off | Done. Your Mac asks for a password at start. | null |
| 017 | Your Mac allows short passwords | A longer password is much harder to guess. | Details | Done. Long passwords are required. | null |
| 018 | A program lets other computers reach it | Other computers can reach that program, which you may not want. | Show me where | Done. Nothing is waiting for connections. | Click "Options", then turn on "Block all incoming connections". Or quit the program named in Details. |
| 019 | Other computers can log in to your Mac | Remote Login lets someone with your password use your Mac from elsewhere. | Turn it off | Done. Remote Login is off. | null |
| 020 | Others can see your screen over the network | Screen Sharing lets someone watch and control your Mac. | Turn it off | Done. Screen Sharing is off. | null |
| 021 | Your Mac can be controlled from elsewhere | Remote Management is for offices and hands your whole Mac to whoever has the key. | Turn it off | Done. Remote Management is off. | null |
| 022 | A shared folder has no password | Anyone on your network can open it without a password. | Stop sharing it | Done. The folder needs a password now. | null |
| 023 | Some programs start on their own | Most are fine. It is worth a look in case one is unwanted. | Show me where | Done. You have had a look. | Under "Allow in the Background", switch off anything you do not recognise. |
| 024 | A background program looks for a file that is missing | A bad program could put itself in that spot later. | Details | Done. The file is gone. | null |
| 025 | Some apps open when you log in | Fewer apps at login means a faster, tidier start. | Show me where | Done. You have had a look. | Under "Open at Login", select an app you do not need and click the minus. |
| 026 | Your Mac has no backup | If it breaks or is lost, your photos and files go with it. | Show me where | Done. Backups are set up. | Click "Add Backup Disk" and choose a disk. |
| 027 | Your last backup is over a week old | A backup only helps if it is recent. | Show me where | Done. A fresh backup has run. | Plug in your backup disk, then click "Back Up Now". |
| 028 | A browser add-on can see every site you visit | It can see what you type on any page, including your bank. | Details | Done. The add-on is limited. | null |
| 029 | A login key for other computers has no password | Anyone who copies the key file can log in as you. | Add a password | Done. The key has a password. | null |
| 030 | Others can see your login keys | Only you should be able to read these files. | Make it private | Done. Your login-key folder is private. | null |
| 031 | A password is saved in a plain text file | Anything that reads the file gets the password. | Details | Done. The file no longer holds a password. | null |

The guided flow also owns its fixed strings (welcome, plan sentences, batch and watch status lines, the question, the paywall, the end states, since last time, the failure tables) in `apps/desktop/src/guided/copy.ts`, under the same banned-word test. Rules with verb "Details" (005, 017, 024, 028, 031) and the left-alone deep links (014, 018, 023, 025, verb "Show me where") never become steps; their `where`, `verb` and `done` strings serve the Details screen and the end-screen line, which links to the finding whatever the verb.

## 7. Ports and contracts

### `packages/core`

- `src/domain/rule.ts`: `GuidedStrings` and `Rule.guided`. `src/domain/finding.ts`: `Finding.guided` copied from the rule.
- `src/rules/fix-catalog.ts`: `FixCatalogEntry.batchable: boolean` (true for `in_app` with `choice` `none` or `all_ssh_keys` and `passphrase` false), written to `packages/core/fixtures/fix-catalog.json`; the Rust contract test asserts it equals `batchable(spec)` for every in-app rule.
- `src/guided/plan.ts` (new):

```ts
export const LEFT_ALONE: readonly RuleId[] = ["TL-MAC-005", "TL-MAC-014", "TL-MAC-017", "TL-MAC-018", "TL-MAC-024", "TL-MAC-028", "TL-MAC-031"];

export type GuidedStep =
  | { readonly id: "batch"; readonly kind: "batch"; readonly ruleIds: readonly RuleId[] }
  | { readonly id: string; readonly kind: "fix"; readonly ruleId: RuleId; readonly choice: FixChoice; readonly passphrase: boolean }
  | { readonly id: string; readonly kind: "show"; readonly ruleId: RuleId; readonly pane: SettingsPane; readonly watch: readonly SectionKey[]; readonly watchEvery: number; readonly restart: boolean; readonly question: "backup_disk" | null }
  | { readonly id: "permission:full_disk_access"; readonly kind: "permission"; readonly permission: "full_disk_access"; readonly unlocks: readonly RuleId[] }
  | { readonly id: "paywall"; readonly kind: "paywall"; readonly lockedRuleIds: readonly RuleId[] };

export interface GuidedPlan {
  readonly reportId: string;
  /** gate.freeFixes as read when the check-up landed; rebuilds pass it back in place of the live gate (section 1). */
  readonly freeFixes: readonly RuleId[];
  readonly steps: readonly GuidedStep[];
  /** Rule ids per end-screen line. */
  readonly leftAlone: readonly RuleId[];
  readonly worthALook: readonly RuleId[];
  readonly technical: readonly RuleId[];
  readonly later: readonly RuleId[];
  readonly locked: readonly RuleId[];
  readonly unreadable: number;
}

export function buildGuidedPlan(
  report: ScanReport,
  gate: { readonly freeFixes: readonly RuleId[]; readonly licensed: boolean },
  profile: ExplainerProfile,
  memory: GuidedMemory,
  now: string,
): GuidedPlan;

/** The rules the paywall unlocked, planned by the same ordering, to append after it. */
export function planLocked(report: ScanReport, ruleIds: readonly RuleId[], profile: ExplainerProfile, memory: GuidedMemory, now: string): readonly GuidedStep[];

export interface ReportDiff { readonly fixed: readonly RuleId[]; readonly appeared: readonly RuleId[]; readonly unreadable: readonly RuleId[] }
export function diffReports(previous: ScanReport | null, next: ScanReport, pendingRestart: readonly RuleId[]): ReportDiff;

export interface GuidedMemory { /* section 4 */ }
export const EMPTY_GUIDED_MEMORY: GuidedMemory;
export function parseGuidedMemory(raw: unknown): GuidedMemory;
```

- `src/ports/fix-port.ts`: the batch types from section 3.
- `src/index.ts` re-exports all of it.

### `apps/desktop/src`

- `guided/memory.ts`: `GUIDED_STORAGE_KEY = "talos.guided"`, `loadGuidedMemory()`, `saveGuidedMemory(memory)`.
- `guided/continue.ts`: `CONTINUE_KEY` moves here from `useCapabilityPoll.ts`; `readContinue(): { kind: "fda" } | { kind: "guided" } | null` accepts the v0.2 bare `"fda"` string; `writeContinue(payload)`.
- `guided/useGuided.ts`:

```ts
export type GuidedPhase =
  | { readonly kind: "welcome" }
  | { readonly kind: "scanning" }
  | { readonly kind: "stopped" }
  | { readonly kind: "failed"; readonly error: ScanError }
  | { readonly kind: "since"; readonly diff: ReportDiff; readonly plan: GuidedPlan }
  | { readonly kind: "plan"; readonly plan: GuidedPlan; readonly listOpen: boolean }
  | { readonly kind: "step"; readonly plan: GuidedPlan; readonly index: number; readonly state: StepState; readonly notice: string | null }
  | { readonly kind: "end"; readonly plan: GuidedPlan; readonly fixed: readonly RuleId[] };

export type StepState =
  | { readonly kind: "idle" }
  | { readonly kind: "question" }
  | { readonly kind: "working"; readonly label: string }
  | { readonly kind: "watching"; readonly since: string; readonly stale: boolean }
  | { readonly kind: "permission"; readonly card: PermissionCardState }
  | { readonly kind: "done"; readonly line: string; readonly rows: readonly { readonly ruleId: RuleId; readonly ok: boolean; readonly text: string }[] }
  | { readonly kind: "failed"; readonly error: FixError | "still_failing" | "unreadable"; readonly step: number | null; readonly batch: boolean }
  | { readonly kind: "later_flash" };

export interface GuidedController {
  readonly phase: GuidedPhase;
  /** done is the index of the current step; of is the plan length, which only grows. */
  readonly progress: { readonly done: number; readonly of: number };
  start(): void;                       // welcome -> scanning; also "Check again"
  carryOn(): void;                     // since -> plan, plan -> first step, partial batch -> next
  primary(): void;                     // the one button of the current step
  later(): void;                       // the one link
  next(): void;                        // the Next link under a done line
  answer(question: "backup_disk", yes: boolean): void;
  toggleList(): void;
  enterLicence(key: string): Promise<void>;
}

export function useGuided(
  scan: ScanController,
  deps: {
    readonly gate: Gate;
    readonly settings: AppSettings;
    readonly memory: GuidedMemory;
    saveMemory(memory: GuidedMemory): void;
    /** The latest Capabilities App.tsx holds, for initialPermissionState. */
    readonly capabilitiesNow: Capabilities | null;
    capabilities(): Promise<Capabilities>;
    openPane(pane: SettingsPane | PermissionKind): Promise<void>;
    /** Forwarded to usePermissionFlow; unused for full_disk_access. */
    collectSection(key: SectionKey): Promise<unknown>;
    restart(): Promise<void>;
    readonly reducedMotion: boolean;
    readonly windowFocused: boolean;
  },
): GuidedController;
```

   `useGuided` sits on top of `useScan` (`start`, `previewFix`, `applyFix`, `startWatch` with its new optional `{ sections, everyMs }` argument, `stopWatch`, `recheck`), the new `previewBatch` and `applyBatch`, and `usePermissionFlow` (one instance for `full_disk_access`, deps as in section 1 "Step type: permission"). It owns no scanning or fixing logic, only phase transitions, the memory writes and the timers (auto-advance, the 800 ms later flash, the 1400 ms question flash). The plan is rebuilt from `scan.scan.report` on every `ready` report with `{ freeFixes: plan.freeFixes, licensed: gate.licensed }` (the frozen set, section 1) and the current step is found again by id. `awayPolling` gains `pollOnFocusReturn?: boolean`.

- Screens and components: `screens/Guided.tsx` (switch on phase), `guided/StepFrame.tsx` (progress, headline, sentences, primary, link, explain disclosure), `guided/GuidedList.tsx`, `guided/WatchStrip.tsx`, `guided/PaywallStep.tsx` (wraps `LicenceField`), `guided/ExplainPanel.tsx` (wraps the v0.2 `AiCard` streaming state), `guided/EndScreen.tsx`, `guided/SinceScreen.tsx`, `guided/GuidedWelcome.tsx`. `screens/Welcome.tsx` keeps the v0.2 form for the expert home only.
- `settings/index.ts`: `AppSettings.guided: { home: boolean; autoScan: boolean }` with defaults `true, true`; `parseSettings` fills both.
- `app/router.ts`: `{ name: "guided" }`; `HOME` chosen from settings in `App.tsx`. `App.tsx`: `useGuided` in the context; the launch effect calls `loadLast()` then `scan.start()` under the rules in section 4; the sidebar per mode; the `talos.continue` handling moves to `guided/continue.ts`.
- Adapters: `tauri-fix.ts` gains `previewBatch`, `applyBatch`, and reads `item` off `fix:status`. `demo-fix.ts` gains both with the flags below. `adapters/index.ts` is unchanged.

### Rust

`fix/batch.rs` and `fix/tests_batch.rs` (section 3); `plan.rs` gains `Stored`; `run.rs` adds `item` to `FixStatus`; `privileged.rs` gains the `without altering line endings` variant of `admin_source` and the batch timeout; `commands.rs` registers `fix_preview_batch` and `fix_apply_batch`; `lib.rs` lists them; `catalog.rs` gains `batchable()`; `src/bin/talos-fixes.rs` prints the new field. No new crates, no new binaries.

### Demo (`adapters/demo-fix.ts`, `app/demo-boot.ts`)

`DemoFixPort.previewBatch` builds items from the catalog; `applyBatch` honours `batch=ok|partial|cancelled|wrong_password|timeout` (`partial` fails the second item at step 0 with `command_failed`; `ok` replaces every touched fixture section by its passing variant as `fix=ok` does); `fix_delay` applies between batch phases. Calls are recorded as `{ kind: "fixPreviewBatch", arg: ruleIds }` and `{ kind: "fixApplyBatch", arg: planId }`. New boot parameters: `scan_error=collector_crashed|timeout|schema_mismatch` makes the demo `collect` reject with that error once, so the next `start()` succeeds (serves `guided-failed` and the "Try again" assertion); `guided=0` opens the expert home; `memory=<json>` seeds `talos.guided`; `since=1` seeds a previous report with two fixed and one new finding; `continue=guided` seeds `talos.continue`; `watch_after=N` is an alias of `poll_after`; `technical=medium` sets the profile. `pace=0` also collapses the auto-advance and flash timers.

### Harness (`apps/desktop/qa/harness.ts`)

The v0.2 walk runs unchanged with `guided=0`. New shots, light and dark, 1100x760 and 900x600, axe on all: `guided-welcome`, `guided-scanning` (volatile), `guided-stopped`, `guided-since`, `guided-plan`, `guided-plan-list`, `guided-batch-confirm` (`licensed=1`), `guided-batch-working` (volatile), `guided-batch-done`, `guided-batch-partial`, `guided-batch-cancelled`, `guided-batch-wrong-password`, `guided-fix-single`, `guided-fix-done`, `guided-fix-failed`, `guided-fix-still-failing`, `guided-show`, `guided-show-watching`, `guided-show-stale`, `guided-show-passed`, `guided-later-notice`, `guided-question-backup`, `guided-permission`, `guided-permission-watching`, `guided-permission-reopen`, `guided-paywall`, `guided-paywall-pasted` (volatile), `guided-explain` (volatile), `guided-failed` (`scan_error=collector_crashed`), `guided-end-all-done` (dev-machine, `licensed=1&batch=ok&fix=ok&poll_after=1&fda_after=1&fix_delay=0`: the batch, the 022 fix, the 026 question answered Yes with the watcher passing on the first poll, the 001 and 010 watchers passing on the first poll, the permission step granted; the "Your Mac is in good shape." screen is reachable only on this walk, because on `hardened` nothing fails and the check-up lands on "Nothing needs fixing." directly), `guided-end-partial`, `guided-end-nothing` (`fixture=hardened`), `guided-end-unreadable` (`fixture=all-unavailable`), `guided-reduced-motion` (`reducedMotion: "reduce"`), `guided-dev-what-will-run` (`dev=1`), `overview-with-checkup-row`, `settings-checkup`.

Assertions: exactly one `.button-primary` and at most one `.guided-link` on every guided shot; the primary and the link sit above the 600 px fold at 900x600; the plan screen is not reached before 6000 ms after launch (4500 ms reduced motion); the progress total never decreases across a walk and grows by one on `guided-batch-partial`; the plan screen on unlicensed dev-machine reads "I found 3 things to fix." and on `licensed=1` "I found 7 things to fix."; `__talosDemoCalls` records one `fixPreviewBatch` with `["TL-MAC-002", "TL-MAC-003", "TL-MAC-011"]` and one `fixApplyBatch` for the licensed batch step, one `fixPreview` and one `fixApply` for the unlicensed single step, and never a URL; the done line is announced through `role="status"`.

## 8. Test and QA strategy

**Core (`vitest`).**

- `buildGuidedPlan` on `dev-machine`, unlicensed, default profile: `fix:TL-MAC-002`, `show:TL-MAC-001`, `show:TL-MAC-010`, `permission:full_disk_access`, `paywall` with `lockedRuleIds` `[003, 011, 022, 026]`; 5 steps; `leftAlone` `[014]`, `worthALook` `[017, 023, 025]`, `technical` `[029]`, `unreadable` 1. Licensed: `batch` `[002, 003, 011]`, `fix:TL-MAC-022:/Users/alice/Public`, `show:TL-MAC-026` with `question: "backup_disk"`, `show:TL-MAC-001`, `show:TL-MAC-010`, `permission:full_disk_access`; 6 steps. Licensed with `technical: "medium"`: `fix:TL-MAC-029:/Users/alice/.ssh/id_ed25519` and the `.pem` key as two fix steps after 022. `hardened`: no steps, nothing to list. `all-unavailable`: one step, `permission:full_disk_access`, `unreadable` 31. A snoozed, thrice-Latered or `waiting` rule is absent; a paywall snooze removes the paywall step and keeps `locked`; `permissionAskedAt` within 30 days removes the permission step; `planLocked` after the paywall yields `batch [003, 011]`, `fix 022`, `show 026`. Frozen free set: the unlicensed dev-machine plan has `freeFixes` `[001, 002, 010, 017, 023, 025]` (the three top-point failures, then the review ids `freeFixRuleIds` appends); rebuilding from the same report with 002 passing and `{ freeFixes: plan.freeFixes, licensed: false }` yields no new fix step and `lockedRuleIds` still `[003, 011, 022, 026]`, while rebuilding with the live `buildGate` would make 022 free (the test documents the drift it guards against). A converted show step for 002 carries `watch` `["firewall"]` and `watchEvery` 3000.
- `diffReports` on `null` then `dev-machine` (empty), `dev-machine` then `hardened` (9 fixed), `hardened` then `dev-machine` (9 appeared), `dev-machine` then `all-unavailable` (9 unreadable), and a `pendingRestart` rule that passes.
- Guided strings: all five present for 31 rules; length caps; stops; the banned-word list as whole words; `where` presence exactly for `deep_link`; `verb` "Show me where" exactly for `deep_link` and "Details" exactly for `manual`; the syllable ceiling with the counter from section 6; `GUIDED_SECTION_LABELS` and every string in `guided/copy.ts` under the banned-word list. `fix-catalog.json` snapshot with `batchable`.
- `parseGuidedMemory` on `null`, a damaged value, a wrong version, and a value with unknown keys.

**Rust (`cargo test`).**

- `batchable` over `FIX_CATALOG` equals the 13-rule set and is false for 022 and 029; the contract test reads `batchable` from `fix-catalog.json`.
- `item_block` for 019 contains two silenced groups, one `test $? -eq 3`, `exit 10` and `exit 11`, and ends with `echo R 3 $?`; the full script for a four-item plan round-trips through `/bin/sh -c` with `echo` and `false` as the programs and yields four `R` lines in order with codes 0, 0, 11, 0, and the failing item's second step does not run; the script exits 0.
- `parse_markers` on LF, CR, CRLF, interleaved junk, a missing item, an out-of-range index, and a forged `R` line (the later line wins, documented).
- `batch_timeout(17)` is 375 s; `prompt_for_batch(3)` is the fixed sentence.
- `preview_batch` rejects a duplicate, a non-batchable rule and an all-excluded list with `invalid_choice`, an unknown rule with `not_in_catalog`, and puts a `precondition_changed` item in `excluded` (the precondition stubbed under `cfg(test)`).
- `PlanStore` refuses a single apply while a batch runs and vice versa; `start` on a batch id returns `Stored::Batch` and `fix_apply` rejects it with `plan_expired`; a batch id expires; a batch id runs once.
- `classify` fixtures unchanged; the single-path `FixStatus` JSON has no `item` key.

**Desktop (`vitest`, jsdom, fake timers).**

- `useGuided`: Welcome once, then scanning on every mount when `autoScan`; the 60 s in-process guard; a `failed` scan lands on the `failed` phase and "Try again" calls `start()`; `since` only on a non-empty diff; a show step calls `startWatch(ruleId, { sections, everyMs })` and a converted step for an `in_app` rule starts polling (the v0.2 early return no longer applies); a `cancelled` batch outcome with one item passing on recheck shows the partial screen, not the cancelled row; auto-advance at 1400 ms and 1800 ms reduced, paused while unfocused; the later flash at 800 ms; the watcher's stale state on `onPaused` and the move-on at the cap with `waiting` written; a batch partial appends a show step and the total grows by one; `talos.continue` as `"fda"`, `{"kind":"fda"}` and `{"kind":"guided"}`; resume lands on the first undone step; memory written on every transition; Escape ignored while working; the backup question snoozes 30 days; the paywall snooze; a valid key appends `planLocked`.
- Reducer tests for the `batch` variant of `FixingState` and the two new actions; `FixFlow` renders null and `FindingDetail` shows busy for the `batch` variant; `useFix.applyBatch` for every `BatchOutcome.error` including `command_failed`, a partial, an `excluded` item, and the three recheck verdicts per item.
- `parseSettings` for `guided`; `StepFrame` axe: one button, headings in order, status roles, no nested interactive element; the one-primary-button lint renders every step kind in every `StepState` and asserts exactly one `.button-primary`.

**Playwright.** The shot list and assertions in section 7.

**Only on a real Mac.** The batch script under `do shell script with administrator privileges`: whether `without altering line endings` is honoured, whether the `R` lines come back in order when every command is silenced, and the exact stderr for cancel and wrong password on a multi-line script (expected unchanged from v0.2, not proven). Each admin fix inside a batch, including `launchctl bootout` exit 3 as root. `fix_cancel` during the dialog on a batch, confirming nothing ran. The FileVault watcher: whether `fdesetup status` reads On before encryption finishes, and whether turning FileVault on from Settings asks for a logout on macOS 27 (unknown; the step copy says "may restart"). The pending-update restart and `pendingRestart` clearing on the next launch. The 10 min cap with System Settings still open. The Full Disk Access "Quit & Reopen" path landing back in the guide with `talos.continue` written at open time. VoiceOver reading of the status region and the auto-advance announcement. The unsigned-build socket table still makes 019 to 022 rechecks `unreadable` under `tauri dev`, so a batch holding them shows the "could not check it" row on a dev build; the pass state needs a signed build.

## 9. Out of scope

- Scanning files, real-time protection, notifications for anything but the watch's "act now"; the menu bar watch re-reads settings only (`docs/DESIGN-WATCH.md`), and "next time you open me" is literal for the main window with the watch off.
- A privileged helper or Touch ID in place of the password dialog; streaming per-line progress out of `do shell script`; undo beyond the per-rule reversal line already in the expert sheet.
- Guided steps for 005, 014, 017, 018, 024, 028, 031 and for `review` findings; an Automation permission step; batching 022 or 029.
- In-app FileVault, SIP, password policy, account creation, `softwareupdate -ia` and `tmutil startbackup`; an in-app login-password field for 012.
- Replacing the expert screens' copy with the guided strings; the two vocabularies coexist by design.
- Multiple local users, a per-user guided memory, localisation beyond British English, the price itself (placeholder £PRICE), payment and key delivery, telemetry, Windows and Linux.
