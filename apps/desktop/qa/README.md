# QA harness

Drives the web build of the desktop app in headless Chrome. The app runs in **demo mode**: every port is backed by a core fixture, so nothing touches Tauri, the Keychain, the filesystem, the network or any system setting. Google Chrome must be installed; `playwright-core` launches it with `channel: "chrome"`.

## Start the demo server

```sh
cd apps/desktop
pnpm dev:demo                                   # port 1430
VITE_TALOS_DEMO=1 pnpm exec vite --strictPort --port 1431   # any other port
```

Then open `http://localhost:1430/?reset=1` in a browser. Both scripts below start a server themselves when nothing answers on the port they were given, and kill it again when they finish. A server you started yourself is left alone.

Demo mode is a build-time switch. `VITE_TALOS_DEMO=1` must be in the environment of the Vite process; nothing in the page or in localStorage can turn it on. `tauri dev` and `tauri build` refuse to run with it set. See `docs/SECURITY-MODEL.md`.

## URL parameters

All optional. They are read once, when the page loads (`src/app/demo-boot.ts`).

Scan and fixtures:

| Parameter | Values | Effect |
|---|---|---|
| `fixture` | `dev-machine` (default), `hardened`, `all-unavailable`, `fresh-install`, `windows-minimal` | The `SystemState` the collector returns |
| `delay` | milliseconds, default `120` | Pause per section while collecting (17 sections) |
| `pace` | `0` | Collapses the Scanning screen's reveal schedule. Every shot that is not about pacing passes it |
| `fda_after` | `N` | `fullDiskAccess` flips to true on the Nth capability poll. Absent: never granted |
| `automation` | `granted`, `denied`, `not_determined` | What `capabilities()` reports for Automation. With `not_determined` the `loginItems` row holds for 9 s (`DEMO_PROMPT_HOLD_MS`), the way the real Automation prompt blocks `osascript`, so the prompting copy can be captured |
| `poll_after` | `N` | A watched section passes on the Nth poll of the away-watch |
| `watch_after` | `N` | Alias of `poll_after` (v0.3) |
| `fail` | `013` or `TL-MAC-013`, comma-separated | Forces the named rules to fail on the fixture. Only 013 is supported (the screen saver idle time becomes 60 minutes), which gives a user-level fix on `dev-machine` |
| `scan_error` | `collector_crashed`, `timeout`, `schema_mismatch` | The demo collector rejects with that error once, so the next `start()` succeeds. Serves the `guided-failed` shot and the "Try again" assertion (v0.3) |

Fixes:

| Parameter | Values | Effect |
|---|---|---|
| `fix` | `ok` (default), `still_failing`, or any `FixError`: `cancelled`, `wrong_password`, `command_failed`, `timeout`, `plan_expired`, `precondition_changed`, `not_in_catalog`, `invalid_choice`, `invalid_input`, `busy` | Outcome of every single Apply. On `ok` the fixture section is replaced by a passing variant, so the recheck turns green. `still_failing` runs and rechecks to the same failing section. The six pre-run errors resolve with no step; `command_failed` names a step |
| `fix_delay` | milliseconds | Pause between the fix phases (`waiting_for_password`, `running`, `rechecking`) so the sheet states can be captured. In v0.3 it also applies between the batch phases |
| `batch` | `ok` (default), `partial`, `cancelled`, `wrong_password`, `timeout` | Outcome of every batch Apply (v0.3). `ok` replaces every touched fixture section by its passing variant, as `fix=ok` does. `partial` fails the second item at step 0 with `command_failed`. The other three fail the dialog: nothing runs and every item is `not_run` |

AI:

| Parameter | Values | Effect |
|---|---|---|
| `provider` | `apple` (default), `chatgpt`, `claude_plan`, `claude`, `ollama` | Pre-seeds `explainer.provider`. Only `claude` and `ollama` turn Developer mode on; `chatgpt` and `claude_plan` are for everyone (AI layer) |
| `ai` | `available` (default for `apple`; `not_connected` is the default for `chatgpt` and `claude_plan`), the Apple states `device_not_eligible`, `apple_intelligence_not_enabled`, `model_not_ready`, `helper_unavailable`, and the provider states `not_connected`, `connecting`, `needs_sign_in`, `limit_reached`, `plan_not_eligible`, `provider_unavailable`, `not_offered` | The initial availability of the seeded provider's fake explainer. With `provider=apple` (or none) only the Apple states apply. `not_offered` also disables that provider's row on the Connect screen. A state other than `not_connected`, `connecting` or `not_offered` counts as a sign-in on this Mac, so Settings shows Disconnect |
| `ai_until` | ISO date | The `until` reported with `limit_reached`; the card and the Explain disclosure print it as "It comes back at 18:00." Absent: "It comes back on its own." |
| `ai_ready` | milliseconds | Flips `model_not_ready` to `available` after this long, for the re-probe path |
| `explainer` | `not_configured`, `no_api_key`, `network`, `auth`, `timeout`, `rejected_output`, `refused`, `unknown`, `needs_sign_in`, `limit_reached`, `provider_unavailable` | Every explainer call fails with this reason. Absent: the fake explainer streams a canned answer |
| `connect` | `ok` (default), `closed`, `plan_not_eligible`, `unavailable`, `timeout`, `fetch_failed` | The outcome of every demo sign-in. `ok` turns the provider `available` and connected; the others land on the matching failed screen (`unavailable` is `provider_unavailable`; `fetch_failed` shows the "I couldn't fetch Claude's helper." screen for whichever provider was started, so pair it with `provider=claude_plan&claude_fetch=1` to see it after the fetching stage) |
| `connect_delay` | milliseconds, default `1500` | Wait per connect stage (the fetch, then the sign-in). `60000` holds a connecting screen for capture; `0` settles at the first 2 s poll |
| `claude_fetch` | `1` | A Claude sign-in shows the "Getting Claude ready." fetching stage before the browser stage |

The demo sign-in opens no browser page: `DemoAiConnect` plays the stages on timers and records `{ kind: "aiConnectStart", arg: provider }`, `{ kind: "aiConnectCancel", arg: provider }` and `{ kind: "aiDisconnect", arg: provider }` on `window.__talosDemoCalls`, never a URL. A cancelled AI request (the "Stop" button) is recorded as `{ kind: "aiCancel" }`. The Connect screen's "Not now" writes `aiAskedAt` into `talos.guided`; seed it with `memory={"version":1,"aiAskedAt":"<iso>"}` to see the end-screen row skipped.

App state:

| Parameter | Values | Effect |
|---|---|---|
| `reset` | `1` | Clears localStorage before boot |
| `dev` | `1` | Developer mode on (`developer.enabled`) |
| `onboarded` | `1` | Skips the Welcome screen |
| `licensed` | `1` | Pre-installs the demo licence |
| `guided` | `0` | Opens the expert home (Overview) instead of the guided check-up; the v0.2 walk runs unchanged with it (v0.3) |
| `memory` | JSON | Seeds `localStorage["talos.guided"]`, the guided memory (snoozes, later counts, waiting, pending restart, paywall and permission snoozes) (v0.3) |
| `since` | `1` | Seeds a previous report with two fixed and one new finding, so the "since last time" screen appears (v0.3) |
| `continue` | `guided` | Seeds `talos.continue` with `{ "kind": "guided" }`, the relaunch continuation, so the check-up resumes at the first undone step (v0.3) |
| `technical` | `medium` | Sets the profile's technical level, which makes the SSH key fixes (029) guided steps (v0.3) |

Watch (DESIGN-WATCH.md section 8; the window is served at `/watch.html` with the same parameters):

| Parameter | Values | Effect |
|---|---|---|
| `watch` | `calm`, `look`, `act`, `unreadable`, `first-run` | The watch window state `DemoWatch` serves. `unreadable` carries three unavailable probes with reason `permission_denied`. Absent: a calm, enabled, non-first-run state with no items. `act` also pushes `watch:notified` onto `__talosDemoCalls` at construction |
| `fishy` | `persistence`, `listener`, `guard`, `remote`, `admin`, `dns`, `backup` | The top item's kind, which picks screen 1's headline and the signal set. Default `persistence` when `watch=act` or `watch=look` |
| `fishyGate` | `1` | Puts the item in `gated`, so the fishy flow starts on the "Did you just change this?" screen |
| `fishyWired` | `1` | `WatchDetails.wifiAvailable` is false, so the disconnect and recover screens show the wired variant ("Block incoming connections", "Allow incoming again") |
| `watchAi` | `off`, `apple`, `chatgpt`, `claude`, `limit` | The badge on Advise rows and whether a model sentence appears. `off` and `limit` give no sentence; `limit` also gives `lastVerdict: null` |
| `ransomNote` | `1` | Ticks "I saw a message asking for money", so the do-not-pay row appears on the experts screen |
| `watchMemory` | JSON | Seeds `localStorage["talos.watch"]`, the watch memory (snoozed signals, "This is fine" dates and counts, "Not now" per action, `fishyRanAt`, notified items), stored as given |

`DemoWatch` (`src/adapters/demo-watch.ts`) records `{ kind, arg }` on `window.__talosDemoCalls` for `watch_check_now`, `watch_pause`, `watch_acknowledge`, `watch_answer_gate`, `watch_snooze`, `watch_set_enabled`, `watch_set_interval`, `watch_set_notify`, `watch_set_profile`, `watch_request_notify_permission`, `watch_action_preview` and `watch_action_apply` (with the `watch.*` id), `watch_open_source` (the action id, never a URL), `autostart_enable`, `autostart_disable`, and the `watch:notified` event. `arg` is an id, a boolean or a number; a URL, a path or profile text is never recorded. Plans expire after five minutes like `DemoFixPort`'s.

`pace=0` also collapses the guided auto-advance and flash timers (v0.3).

Example: `http://localhost:1430/?reset=1&fixture=all-unavailable&onboarded=1&delay=0&pace=0`.

What the demo adapters do (`src/adapters/demo.ts`):

- Collect emits `started` then `ok` or `unavailable` per section in `SECTION_KEYS` order, honours cancel, then resolves the fixture. Rechecks return the fixture section again unless `fix=ok` or `poll_after` has replaced it with a passing variant.
- `DemoFixPort` answers `fix_preview` with a plan built from the catalog entry, runs `fix_apply` through the phases above with `fix_delay` between them, and records every call on `window.__talosDemoCalls` as `{ kind: "fixPreview" | "fixApply" | "fixCancel" | "fixReveal", ... }`. Nothing is applied and no URL is ever recorded. From v0.3 `previewBatch` builds the items from the catalog and `applyBatch` honours `batch=`; they are recorded as `{ kind: "fixPreviewBatch", arg: ruleIds }` and `{ kind: "fixApplyBatch", arg: planId }`.
- `DemoAppleExplainer` streams the canned explanation in 40 ms word chunks and passes core's validators: a prioritisation is a permutation of the eligible ids and no text contains a command line. `DemoProviderExplainer` does the same for `chatgpt` and `claude_plan`, reading its availability from `DemoAiConnect`, so a connect that finishes in the demo turns the provider available at once and Disconnect turns it `not_connected`.
- The licence accepts two keys: `TL1.DEMO` for typed entry (plan personal, 1 seat, id `demo`, tag `deadbeef`), and `DEMO_LICENSE_KEY_PASTED` (`TL1.` + `DEMO` five times + `.` + 64 `D` characters), which matches the paste regex so the `lock-licence-pasted` shot exercises auto-verify. Any other key is rejected as unsigned. Remove clears it.
- Secrets and the last report live in memory and vanish on reload. Settings use localStorage as in the real app.
- Opening a System Settings pane, the buy page and restart open nothing. Each call is pushed onto `window.__talosDemoCalls` as `{ kind: "openSettingsPane", arg: pane }`, `{ kind: "openBuyPage" }` or `{ kind: "restart" }`, so a script can assert on it.

## Screenshots

```sh
cd apps/desktop
pnpm exec tsx qa/snap.ts --port 1430 --out qa/screenshots/<name> [--only expert|guided|ai|watch]
```

Walks the expert screens through the sidebar rows (`guided=0`), then the guided check-up, then the AI-layer screens, then the watch window and the fishy flow (`--only` limits the run to one of the four), and saves each screen in light and dark at 1100x760 and 900x600 as `<screen>-<variant>-<scheme>-<width>.png`. Screenshots are full page: the content column is unrolled so the whole screen is visible. A shot with its own `size` (the watch window) is captured at that size only and is not unrolled. The list of files is printed to stdout. `qa/screenshots/` is git-ignored. Shots marked volatile capture a moving state and may differ between runs. Exit 0 is clean, 2 means the walk finished with layout warnings (see the watch section), 1 is a failed assertion or a crash.

The v0.1 shots that survive: Welcome empty and filled, Overview, Findings, a free and a locked finding, Settings with Developer mode off and on, a finding with Terminal commands, Ask locked and answered, an AI explanation and a suggested order, the Couldn't-check cards on `all-unavailable`, Overview on `hardened` and `fresh-install`, Overview and Findings on `windows-minimal`. About is a Settings section now, so the two About shots are part of `settings-reduced` and `settings-licensed`. Back from a finding is the "‹ Findings" button.

Added in v0.2, each in both schemes and both sizes:

| Group | Shots |
|---|---|
| Welcome and Scanning | `welcome-single`, `scanning-paced-2s`, `scanning-paced-5s`, `scanning-preparing` (volatile), `scanning-prompting`, `scanning-reduced-motion` (`reducedMotion: "reduce"`) |
| Overview and Findings | `overview-inline-actions`, `overview-transition` (100 ms after `presented`), `findings-cost-words` |
| Fix sheet | `fix-confirm-admin`, `fix-confirm-user` (`fail=013`, the user-level screen saver fix), `fix-waiting-password` (volatile), `fix-running` (volatile), `fix-done`, one shot per `FixError`, named `fix-<error>` with underscores turned into hyphens (`fix-cancelled`, `fix-wrong-password`, `fix-command-failed`, `fix-timeout`, `fix-precondition-changed`, `fix-plan-expired`, `fix-invalid-choice`, `fix-invalid-input`, `fix-not-in-catalog`, `fix-busy`), `fix-still-failing`, `fix-passphrase`, `fix-watching`, `fix-passed` |
| Permissions | `permission-watching`, `permission-granted`, `permission-reopen`, `permission-prompting` |
| AI | one shot per availability state, named `ai-<state>` with underscores turned into hyphens (`ai-device-not-eligible`, `ai-apple-intelligence-not-enabled`, `ai-model-not-ready`, `ai-helper-unavailable`), `ai-failed` (`explainer=network`), `ai-streaming` (volatile), `ai-ready`, `ask-streaming` |
| Licence and Settings | `lock-licence-pasted`, `settings-reduced`, `settings-dev-on` |
| Window | `window-inactive` |

Assertions in the walk: the Overview heading is not reached before 6000 ms after "Run check-up" (4500 ms with reduced motion); the "n of 17 areas" subline advances and "found so far" increments; the Cancel icon button and every sheet's primary button sit above the 600 px fold at 900x600; `window.__talosDemoCalls` records the expected preview and apply calls and never a URL.

Added in v0.3, the guided check-up, each in both schemes and both sizes, axe on all (DESIGN-V03.md section 7, "Harness"):

| Group | Shots |
|---|---|
| Launch | `guided-welcome`, `guided-scanning` (volatile), `guided-stopped`, `guided-failed` (`scan_error=collector_crashed`), `guided-since` (`since=1`) |
| Plan | `guided-plan`, `guided-plan-list` |
| Batch | `guided-batch-confirm` (`licensed=1`), `guided-batch-working` (volatile), `guided-batch-done`, `guided-batch-partial` (`batch=partial`), `guided-batch-cancelled`, `guided-batch-wrong-password` |
| Single fix | `guided-fix-single`, `guided-fix-done`, `guided-fix-failed`, `guided-fix-still-failing` |
| Show me where | `guided-show`, `guided-show-watching`, `guided-show-stale`, `guided-show-passed`, `guided-later-notice`, `guided-question-backup` |
| Permission | `guided-permission`, `guided-permission-watching`, `guided-permission-reopen` |
| Paywall and AI | `guided-paywall`, `guided-paywall-pasted` (volatile), `guided-explain` (volatile) |
| End | `guided-end-all-done` (`licensed=1&batch=ok&fix=ok&poll_after=1&fda_after=1&fix_delay=0`: the batch, the 022 fix, the 026 question answered Yes with the watcher passing on the first poll, the 001 and 010 watchers passing on the first poll, the permission step granted; the only walk that reaches "Your Mac is in good shape."), `guided-end-partial`, `guided-end-nothing` (`fixture=hardened`), `guided-end-unreadable` (`fixture=all-unavailable`) |
| Other | `guided-reduced-motion` (`reducedMotion: "reduce"`), `guided-dev-what-will-run` (`dev=1`), `overview-with-checkup-row`, `settings-checkup` |

Guided assertions: exactly one `.button-primary` and at most one `.guided-link` on every guided shot; the primary and the link sit above the 600 px fold at 900x600; the plan screen is not reached before 6000 ms after launch (4500 ms reduced motion); the progress total never decreases across a walk and grows by one on `guided-batch-partial`; the plan screen on unlicensed `dev-machine` reads "I found 3 things to fix." and on `licensed=1` "I found 7 things to fix."; `__talosDemoCalls` records one `fixPreviewBatch` with `["TL-MAC-002", "TL-MAC-003", "TL-MAC-011"]` and one `fixApplyBatch` for the licensed batch step, one `fixPreview` and one `fixApply` for the unlicensed single step, and never a URL; the done line is announced through `role="status"`. The walk order and the parameters per shot are the implementer's; see `harness.ts` and DESIGN-V03.md section 7.

Added for the AI layer (DESIGN-AI.md section 11), each in both schemes and both sizes, axe on all. Base `G` is `reset=1&onboarded=1&delay=0&pace=0` on `dev-machine`; `CHATGPT` is `G&provider=chatgpt&ai=not_connected`, `CLAUDE` the same with `claude_plan`, `EXPERT` is `G&guided=0&provider=chatgpt`:

| Group | Shots |
|---|---|
| Explain disclosure | `guided-explain-not-connected` (`CHATGPT`, the first step with "Explain this" open on the not-connected body), `guided-explain-after-connect` (back on the step after a connect, the disclosure open and the ChatGPT badge under the text), `guided-connect-not-now` (back on the step with the disclosure closed; `aiAskedAt` written) |
| Connect | `guided-connect` (from "Connect my AI": three native radios, ChatGPT selected, "Connect ChatGPT"), `guided-connect-claude-selected` (the primary follows the selection), `guided-connect-not-offered` (`ai=not_offered`: the ChatGPT row disabled with "Not available yet", "Connect Claude"), `guided-connect-from-end`, `connect-from-settings`, `connect-from-ask` (the same screen reached from the end-screen row, Settings "Change" and the Ask row; each reach proves "Not now" lands back where it came from) |
| Connecting | `guided-connect-chatgpt-waiting` (volatile, `connect_delay=60000`), `guided-connect-claude-fetching` (volatile, `CLAUDE&claude_fetch=1&connect_delay=60000`), `guided-connect-claude-waiting` (volatile), `guided-connect-done` (volatile, `connect=ok&connect_delay=0&pace=2` so the tick stays 2800 ms) |
| Connect failures | `guided-connect-cancelled` (Cancel on the waiting screen), `guided-connect-failed-closed`, `guided-connect-failed-plan`, `guided-connect-failed-unavailable`, `guided-connect-failed-timeout` (`connect=closed|plan_not_eligible|unavailable|timeout&connect_delay=0`), `guided-connect-failed-fetch` (`CLAUDE&claude_fetch=1&connect=fetch_failed`), `guided-connect-choose-another` (after the plan failure, the failed row still selected) |
| End screen and paywall | `guided-end-connect-row` (`CHATGPT&fix=ok&fix_delay=0`, the partial end with "Get things explained"), `guided-end-after-not-now` (the row gone after Not now), `guided-end-connect-row-asked` (`memory={"version":1,"aiAskedAt":"<now>"}`, the row absent), `guided-paywall-yearly` |
| Settings | `settings-your-ai-connected`, `settings-your-ai-not-connected`, `settings-your-ai-needs-sign-in`, `settings-your-ai-limit-reached` (`ai_until` today 18:00), `settings-your-ai-not-offered` (`EXPERT&ai=<state>`), `settings-your-ai-disconnected` (after Disconnect) |
| Ask | `ask-not-connected` (the Connect row and the disabled composer), `ask-connected` (`licensed=1`, an answer signed "Written by ChatGPT. Not verified.") |
| Overview | `overview-ai-<state>` for the seven provider states, underscores turned into hyphens (`overview-ai-not-connected` also opens Connect and returns), `overview-ai-connected` (`licensed=1`, the suggested order with the ChatGPT badge) |

AI-layer assertions: every guided shot passes `assertGuidedScreen` (one primary on choose and failed, none on waiting, fetching and done, Cancel the only link on the browser screen and no link on the Claude fetch, primary and link above the fold at 900x600); the Connect screen shows no progress line; the headline, sentence and primary of each failure match DESIGN-AI.md section 4; the end row's `aria-label` is "Get things explained. Connect the AI you already use" with no literal separator and a height of at least 44 px; the row never becomes the "Do this next" card; the progress total does not drop across the connect detour; the Settings pill word and the presence of Disconnect follow the state and no password field is drawn; the Ask row is a real `button.button` and the composer is disabled; each Overview card carries the spec line and its one action (none for `limit_reached`, which prints `.ai-card-until`); `__talosDemoCalls` records `aiConnectStart` with `chatgpt` or `claude_plan`, `aiConnectCancel` on Cancel, `aiDisconnect` on Disconnect, and never a URL.

Added for the menu bar watch (DESIGN-WATCH.md section 9), axe on all. The window shots load `${baseUrl}/watch.html?watch=<state>&pace=0` and are captured at 320 px wide and the state's own height, the one `tray.rs` `window_height` gives the real window (170 first run, 150 calm and unreadable, 280 look, 360 act; `WATCH_WINDOW_HEIGHTS` in `harness.ts`, `Shot.size`, `captureWholeScreen(..., { fixed: true })`), so a shot shows any clipping the window would. The file name carries the width, `watch-window-<state>-<scheme>-320.png`. The fishy shots use base `G` = `reset=1&fixture=hardened&onboarded=1&delay=0&pace=0`, which lands on the end screen at once, with `watch=act` so the end screen shows the watch's act-now card; every flow is opened from that card's "See what to do", in both schemes and both sizes:

| Group | Shots |
|---|---|
| Watch window | `watch-window-calm`, `watch-window-look` (after a "Check now": "Checking now", then "Checked just now"), `watch-window-act`, `watch-window-unreadable` (`watch=unreadable`, the "I couldn't check 3 areas" line with its hover title), `watch-window-first-run` (`watch=first-run`, the timer sentence and "Start me when you log in") |
| End screen | `guided-end-act-now` (the title reads "Act now" and the sentence under it is the item's headline, never the calm lines; the act-now card in place of "Do this next": the headline, the evidence sentence, "See what to do", the critical cue), `guided-end-after-fine` (back after "This is fine, I know it"), `guided-end-after-fishy` (back after the whole flow; the demo's item is still there, so the title is still "Act now"), `guided-end-after-fishy-not-now` (back after "Not now" on the disconnect screen) |
| Gate | `guided-fishy-gate` (`fishy=remote&fishyGate=1&watch=act`: "Did you just change this?", primary "No, I didn't", link "Yes, that was me") |
| Noticed | `guided-fishy-noticed-persistence`, `guided-fishy-noticed-listener`, `guided-fishy-noticed-guard`, `guided-fishy-noticed-remote` (reached through the gate's "No, I didn't"), `guided-fishy-noticed-admin`, `guided-fishy-noticed-dns`, `guided-fishy-noticed-backup` (`fishy=<kind>`, one per headline, Details closed), `guided-fishy-noticed-details` (Details open: the three local lines, the ransom box, Reveal in Finder, the phase line and the source button) |
| Disconnect | `guided-fishy-disconnect` ("Turn Wi-Fi off"), `guided-fishy-disconnect-wired` (`fishyWired=1`, "Block incoming connections") |
| Stop | `guided-fishy-stop` ("Stop it", reached by running Wi-Fi off), `guided-fishy-stop-no-entry` (`fishy=listener`, the "Quit the program named in Details" body with "Block incoming connections") |
| Eradicate and experts | `guided-fishy-eradicate` ("Show me where", reached by running Stop it), `guided-fishy-experts` (the row list, primary "Done", no link), `guided-fishy-experts-details` (the first row open: "Decided by the app itself", the source line, the source button), `guided-fishy-experts-model` (`watchAi=chatgpt`: the model sentence under "Written by ChatGPT. Not verified."), `guided-fishy-experts-ransom` (`fishy=dns&ransomNote=1`, the do-not-pay row present) |
| Recover | `guided-fishy-recover` ("Turn Wi-Fi on"), `guided-fishy-recover-wired` ("Allow incoming again") |
| Settings and Welcome | `settings-watch` (the Watch section first in Settings: two switches, the segmented "How often", the notify switch, the not-antivirus sentence), `guided-welcome-watch` (the welcome's watch sentence, the disclosure open on the not-antivirus sentence and the "Tell me when something needs doing now" button, pressed) |

Watch assertions: every fishy shot has exactly one `.button-primary` with the spec's label, the spec's one `.guided-link` or none, no `.guided-progress`, the expected number of `.guided-source` lines (one on every screen that suggests an action, two on the disconnect screen), Details closed unless the shot opens it, and never an `input[type='password']`; the admin rows (Wi-Fi, block incoming, allow incoming) show the password line and the user-level stop row does not; every headline is free of machine text; screen 5's main `.guided-end-list` holds seven rows (eight with the ransom row), no `a`, and no button but the rows themselves, with Lockdown Mode under "More experts suggest"; an open Details shows a `.fishy-phase` line and a `button.fishy-source-button` and no `a`; the watch window is 320 px wide with no sideways overflow, shows one `.button-primary` on `look` and `act` and none on `calm`, `unreadable` and `first-run`, the status icon and word together, a "Checked ..." line, the two footer links, the source and evidence lines on `act` only, and the hover title naming the three unreadable areas; Settings shows the Watch section first with the defaults (watch on, start at login off, every hour, notify on); `__talosDemoCalls` records `watch_action_preview` and `watch_action_apply` with `watch.*` ids (`watch.wifi_off`, `watch.stop_user_agent`, `watch.block_incoming`, `watch.wifi_on`), `watch_open_source` with an action id, `watch_answer_gate`, `watch_acknowledge`, `watch_snooze`, `watch_check_now`, `openSettingsPane` with `login_items`, `autostart_enable` and `autostart_disable` from the Settings switch, `watch_set_notify` and `watch_set_interval` from their controls, `watch:notified` on every `watch=act` page that is not gated and never on `calm`, `look`, `unreadable`, `first-run` or a gated item, never a URL (`assertNoUrlRecorded`), and `watch_request_notify_permission` never on a page load and exactly once after the Settings notify switch turns on or the Welcome button is pressed; `localStorage["talos.watch"]` gains `normalForMe` and `acknowledgeCount` after "This is fine", `actionNotNow` and `snoozedSignals` after "Not now", and `fishyRanAt` after the flow ends.

Layout warnings. Two checks in the watch walk are collected as warnings instead of stopping the walk, so every shot is still written: the 600 px fold on the fishy screens (the primary and the link at 900x600; screen 5 is exempt because its "Done" closes the list, as the end screen's "Check again" does), and the window's content height against that state's height from `tray.rs` `window_height`. A warning is printed as `[qa] warning: ...` when it is raised and again at the end; `snap.ts` then exits 2 (1 is a crash, 0 is clean), and `axe.ts` keeps its own exit code. The run of 2026-10-17 on the final tree raised none: the `act` window's content fits the 360 px window with the footer visible, "This is fine, I know it" sits above the fold with Details open, and after "Not now" the act-now card leaves the end screen, because `DemoWatch.snooze` re-rates the unsnoozed signals by the rules and a lone corroborating signal is "something to look at" (`demo-watch.test.ts` pins it). An earlier run that day raised three (a 27 px footer clip on the `act` window, an 8 px fold miss with Details open, and the "Not now" card); the first two no longer reproduce on this tree and the third was the snooze rule.

The harness runs against the demo bundle, where `DemoFixPort` fakes rechecks. Under `tauri dev` the build is unsigned, the kernel withholds the socket table, and every real recheck of rules 019 to 022 comes back `unreadable`, so those four fixes can only be seen to pass on a signed build (`docs/SIGNING.md`). The same empty socket table makes the watch's listener, remote access and file sharing signals read "I couldn't check" on every tick under `pnpm desktop`, and a dev build's notifications arrive under Terminal's name, so the harness asserts the `watch:notified` event on the demo page instead of a banner.

## Accessibility

```sh
cd apps/desktop
pnpm exec tsx qa/axe.ts --port 1430 [--only expert|guided|ai|watch]
```

Runs axe-core on the same four walks in light and dark and prints a JSON array of violations (`screen`, `id`, `impact`, `help`, `target`) to stdout. Exits 1 when any violation is serious or critical. Progress goes to stderr, so `> report.json` keeps the JSON clean.

## Files

- `harness.ts`: CLI args, the demo server, Chrome, and the four screen walks (`walk`, `walkGuided`, `walkAi`, `walkWatch`) shared by both scripts.
- `snap.ts`, `axe.ts`: the two entry points.
- `tsconfig.json`: the scripts are typechecked by `pnpm --filter @talos/desktop typecheck`.
- `scratch/`: git-ignored space for ad-hoc output.
