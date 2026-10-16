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
| `ai` | `available` (default), `device_not_eligible`, `apple_intelligence_not_enabled`, `model_not_ready`, `helper_unavailable` | What the fake Apple explainer reports as availability |
| `ai_ready` | milliseconds | Flips `model_not_ready` to `available` after this long, for the re-probe path |
| `explainer` | `not_configured`, `no_api_key`, `network`, `auth`, `timeout`, `rejected_output`, `refused`, `unknown` | Every explainer call fails with this reason. Absent: the fake explainer streams a canned answer |
| `provider` | `apple`, `claude`, `ollama` | Pre-seeds the provider. `claude` and `ollama` also turn Developer mode on |

A cancelled AI request (the "Stop" button) is recorded as `{ kind: "aiCancel" }` on `window.__talosDemoCalls`.

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

`pace=0` also collapses the guided auto-advance and flash timers (v0.3).

Example: `http://localhost:1430/?reset=1&fixture=all-unavailable&onboarded=1&delay=0&pace=0`.

What the demo adapters do (`src/adapters/demo.ts`):

- Collect emits `started` then `ok` or `unavailable` per section in `SECTION_KEYS` order, honours cancel, then resolves the fixture. Rechecks return the fixture section again unless `fix=ok` or `poll_after` has replaced it with a passing variant.
- `DemoFixPort` answers `fix_preview` with a plan built from the catalog entry, runs `fix_apply` through the phases above with `fix_delay` between them, and records every call on `window.__talosDemoCalls` as `{ kind: "fixPreview" | "fixApply" | "fixCancel" | "fixReveal", ... }`. Nothing is applied and no URL is ever recorded. From v0.3 `previewBatch` builds the items from the catalog and `applyBatch` honours `batch=`; they are recorded as `{ kind: "fixPreviewBatch", arg: ruleIds }` and `{ kind: "fixApplyBatch", arg: planId }`.
- `DemoAppleExplainer` streams the canned explanation in 40 ms word chunks and passes core's validators: a prioritisation is a permutation of the eligible ids and no text contains a command line.
- The licence accepts two keys: `TL1.DEMO` for typed entry (plan personal, 1 seat, id `demo`, tag `deadbeef`), and `DEMO_LICENSE_KEY_PASTED` (`TL1.` + `DEMO` five times + `.` + 64 `D` characters), which matches the paste regex so the `lock-licence-pasted` shot exercises auto-verify. Any other key is rejected as unsigned. Remove clears it.
- Secrets and the last report live in memory and vanish on reload. Settings use localStorage as in the real app.
- Opening a System Settings pane, the buy page and restart open nothing. Each call is pushed onto `window.__talosDemoCalls` as `{ kind: "openSettingsPane", arg: pane }`, `{ kind: "openBuyPage" }` or `{ kind: "restart" }`, so a script can assert on it.

## Screenshots

```sh
cd apps/desktop
pnpm exec tsx qa/snap.ts --port 1430 --out qa/screenshots/<name>
```

Walks the guided check-up, then the expert screens through the sidebar rows (`guided=0`), and saves each screen in light and dark at 1100x760 and 900x600 as `<screen>-<variant>-<scheme>-<width>.png`. Screenshots are full page: the content column is unrolled so the whole screen is visible. The list of files is printed to stdout. `qa/screenshots/` is git-ignored. Shots marked volatile capture a moving state and may differ between runs.

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

The harness runs against the demo bundle, where `DemoFixPort` fakes rechecks. Under `tauri dev` the build is unsigned, the kernel withholds the socket table, and every real recheck of rules 019 to 022 comes back `unreadable`, so those four fixes can only be seen to pass on a signed build (`docs/SIGNING.md`).

## Accessibility

```sh
cd apps/desktop
pnpm exec tsx qa/axe.ts --port 1430
```

Runs axe-core on the same screens in light and dark and prints a JSON array of violations (`screen`, `id`, `impact`, `help`, `target`) to stdout. Exits 1 when any violation is serious or critical. Progress goes to stderr, so `> report.json` keeps the JSON clean.

## Files

- `harness.ts`: CLI args, the demo server, Chrome, and the screen walk shared by both scripts.
- `snap.ts`, `axe.ts`: the two entry points.
- `tsconfig.json`: the scripts are typechecked by `pnpm --filter @talos/desktop typecheck`.
- `scratch/`: git-ignored space for ad-hoc output.
