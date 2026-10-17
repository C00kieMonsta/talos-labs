# QA report

Date: 15 October 2026.
Build: Talos Labs v0.1, catalog 0.1.0, core 0.1.0, CIS Apple macOS 26 Tahoe Benchmark v1.0.0.

## What was tested

- The desktop app's web build in demo mode (`VITE_TALOS_DEMO=1`), where every port is backed by a core fixture. Nothing touched Tauri, the Keychain or the network. The Tauri window was not opened.
- Browser: headless Google Chrome 155.0.8059.80, driven with playwright-core (`channel: "chrome"`).
- Fixtures on the screen walk: `dev-machine`, `hardened`, `all-unavailable`, `fresh-install`. `windows-minimal` exists but is not on the walk.
- Screens: 22 (Welcome empty and filled, Overview, Findings, a free and a locked finding, Settings with Developer mode off and on, a finding with Terminal commands, Ask locked and answered, an AI explanation, a suggested order, About unlicensed and licensed, Scanning mid-scan, the Couldn't-check cards on `all-unavailable`, a finding on `all-unavailable`, Overview on `hardened` and on `fresh-install`). Each in light and dark at 1100x760 and 900x600: 88 screenshots. Axe ran on each screen in both schemes: 44 runs.
- Review lenses: visual, flows, a11y, copy, robustness, device. The device lens was a real read-only scan of this Mac (macOS 27.0.1, build 26A434, arm64).
- Four area fixers (ui, core, adapters, rust) applied the confirmed findings. This pass re-ran every check on the merged tree and closed the loose ends they flagged.

## Checks on the final tree

| Command | Result |
|---|---|
| `pnpm -r typecheck` | passes (core and desktop, including `qa/tsconfig.json`) |
| `pnpm -r test` | passes: 386 core tests (42 files), 260 desktop tests (20 files) |
| `cargo build` in `apps/desktop/src-tauri` | passes |
| `cargo test` | passes: 114 unit tests (2 ignored), 2 integration tests |
| `cargo clippy --all-targets -- -D warnings` | passes |
| `pnpm --filter @talos/desktop build` | passes (one pre-existing advisory about a 693 kB chunk) |
| `pnpm exec tsx qa/snap.ts --port 1438 --out qa/screenshots/after` | 88 screenshots written |
| `pnpm exec tsx qa/axe.ts --port 1438` | 0 violations, exit 0 |
| `pnpm scan` | score 48, grade poor; see below |

Before the fixers: 376 core tests, 195 desktop tests, 107 Rust tests, 10 serious axe violations, live score 42.

## Confirmed findings

All 44 confirmed findings are fixed. Area is the fixer that owned the change.

| Id | Severity | Area | Status |
|---|---|---|---|
| visual-sidebar-scrolls-away | high | ui | Fixed. `.shell` is `height: 100%`, so `.content` is the scroller and `.nav` stays put. |
| a11y-card-name | high | ui | Fixed. Cards have no `aria-label`; the badge, category, points and reason are read in order. |
| a11y-licence-feedback | high | ui | Fixed. `role="alert"`, `aria-invalid` and `aria-describedby` on the input; focus moves to the Licensed line or back to the input. |
| copy-001 | high | core | Fixed. 023 and 025 have verb titles and fail titles. |
| copy-002 | high | core | Fixed. 028 title is "Browser extensions are limited to the sites they need". |
| copy-004 | high | core | Fixed. 007, 009 and 023 steps no longer mention a command; catalog test guards it. |
| robustness-corrupt-report-blank-app | high | adapters | Fixed. `restoreReport` validates every field and returns null on any miss; the score is recomputed. |
| device-pending-update-false-positive | high | rust | Fixed. `pending_count` reads the `RecommendedUpdates` list; TL-MAC-010 passes on this Mac. |
| visual-h1-focus-ring-on-launch | medium | ui | Fixed. No focus on the launch route; `h1:focus-visible` is `width: fit-content`. |
| visual-ol-markers-misaligned | medium | ui | Fixed. `vertical-align: top` on the list links. |
| visual-aside-stretched-full-height | medium | ui | Fixed. Aside is `align-self: start`, sticky, with its own scroll. |
| visual-badge-row-vertically-centred | medium | ui | Fixed. Card is a flex column with points pinned to the bottom. |
| visual-settings-model-label-inline | medium | ui | Fixed. `.subsection > label` is block. |
| visual-nested-assistant-radios-flat | medium | ui | Fixed. Claude/ChatGPT sit in an indented `.sub-options` fieldset. |
| visual-overview-unknown-card-wall | medium | ui | Fixed. One card per reason with "Affects N checks" and a See in Findings button. |
| visual-secondary-button-and-input-borders-faint | medium | ui | Fixed. `--border-strong` on buttons and text inputs. |
| flows-001 | medium | ui | Fixed. Failed banner has Dismiss (`failure_dismissed`); the Overview duplicate is gone. |
| flows-002 | medium | ui | Fixed. Same change as visual-sidebar-scrolls-away. |
| flows-003 | medium | ui | Fixed. Severity and category filters ride on the route; Back restores them. |
| flows-005 | medium | ui | Fixed. Ask conversation and draft live in `useScan`, cleared on a new scan. |
| a11y-back-focus | medium | ui | Fixed. Back focuses the `[data-rule-id]` card the user came from. |
| a11y-scanning-focus | medium | ui | Fixed. The Scanning heading takes focus. |
| a11y-error-notices | medium | ui | Fixed. Error notices have `role="alert"`. |
| a11y-ask-focus | medium | ui | Fixed. Textarea is `readOnly` while busy and regains focus after the answer. |
| a11y-ai-buttons-focus | medium | ui | Fixed. Buttons stay mounted with `aria-disabled`; focus moves to the result heading. |
| a11y-recheck-focus | medium | ui | Fixed. Same pattern; focus moves to the recheck status. |
| a11y-copy-copied | medium | ui | Fixed. Name becomes "Copied"; a sibling `role="status"` announces. |
| a11y-settings-path | medium | ui | Fixed. Path reads "System Settings, then Network, then Firewall". |
| a11y-assistant-radiogroup | medium | ui | Fixed. Labelled nested fieldset. |
| a11y-ask-history-lost | medium | ui | Fixed. Same change as flows-005. |
| copy-003 | medium | core | Fixed. 031 title and fail title are singular sentences. |
| copy-005 | medium | ui | Fixed. Commands are headed "In Terminal" when there is no Settings path. |
| copy-006 | medium | core | Fixed. Eight verify lines reworded; catalog test rejects Terminal wording. |
| copy-007 | medium | ui | Fixed. `EVIDENCE_VALUE_LABELS` maps enum and Tri values to words. |
| copy-008 | medium | core | Fixed. 001 emits the method row only on pass. This pass also made the collector report `none` when FileVault is off. |
| copy-009 | medium | core | Fixed. Browser prompt labels follow the status (fail, review, unknown). |
| copy-010 | medium | ui | Fixed. No lock on an unknown finding. `gate.ts` unchanged. |
| copy-011 | medium | ui | Fixed. Option reads "Very. Be precise and brief." |
| robustness-recheck-no-timeout-no-cancel | medium | ui | Fixed in the UI: 60 s deadline, late results dropped, Rescan allowed while rechecking. See open items for the Rust side. |
| robustness-text-evidence-overflow | medium | ui | Fixed. `.evidence td { overflow-wrap: anywhere }`. |
| robustness-unknown-finding-shows-fix-and-lock | medium | ui | Fixed. Unknown findings show a Check again block only. |
| robustness-unknown-headline-grammar | medium | core | Fixed. Titles reworded; catalog test requires a finite verb. |
| device-backup-age-hidden | medium | rust | Fixed. Falls back to `SnapshotDates` in the Time Machine preference domain; TL-MAC-027 now fails on this Mac at 7030 hours. |
| device-browsers-not-installed | medium | rust | Fixed. Installed means the bundle exists under `/Applications` or `~/Applications`; this Mac reports Chrome and Firefox only. |

## Rejected findings

- a11y-wkwebview-tab: the WebKit behaviour is real but the shipped app is not affected as described; not verified in the Tauri window.
- a11y-live-on-mount: the live regions are built with their text already present, as claimed; the verifier judged this not a defect in the tested flows.
- robustness-evaluating-stuck: the reducer drops `collect_failed` in `evaluating`, but nothing reachable makes the engine throw.
- device-dotfiles-missed-files: `~/.pgpass` and `~/.cache/huggingface/token` exist, but the fixed file list is a documented scope decision.

## Accessibility (axe)

Final run: 0 violations across 44 screen and scheme pairs. Counts by impact: critical 0, serious 0, moderate 0, minor 0. Before the fixes the run reported 10 serious violations, mainly `label-content-name-mismatch` on finding cards across five screens and the Copy button's Copied state.

## Live scan of this Mac

`pnpm scan`, collected 2026-10-15T18:57:41Z.

- Score 48, grade poor, deducted 52, complete no, not capped by critical.
- Counts: pass 15, fail 8, review 2, unknown 6, not applicable 0.
- Failing: TL-MAC-001 (disk not encrypted), TL-MAC-002 (firewall off), TL-MAC-003 (stealth mode off), TL-MAC-011 (App Store auto-update off), TL-MAC-014 (admin account), TL-MAC-027 (last backup 7030 hours ago), TL-MAC-029 (six SSH keys without a passphrase), TL-MAC-031 (two tokens in `~/.npmrc`).
- Review: TL-MAC-017 (minimum password length 4), TL-MAC-023 (16 background items).
- Unknown: TL-MAC-018, 019, 020, 021, 022 (`permission_denied`: netstat returns an empty socket table in an unsigned build), TL-MAC-028 (`needs_full_disk_access`; 2 browsers installed, 0 broad-access extensions found).
- Sections unavailable: listeners, remoteAccess, fileSharing.

Change from the baseline score of 42: TL-MAC-010 no longer reports a phantom pending update (+8), TL-MAC-027 now measures the backup age instead of giving up (-2). TL-MAC-001 no longer shows a contradictory "Encryption method: filevault" row.

## Extra changes in this pass

- `apps/desktop/src-tauri/src/collect/macos/disk_encryption.rs`: `method` is `none` when FileVault is off, with a unit test. Confirmed by running `target/debug/talos-collect` directly.
- `packages/core/src/rules/macos/tl-mac-027.ts`: explanation no longer says the check gives up when the disk is unplugged.
- `docs/DESIGN.md`: backup and browser collector sources, the 023 fail-title example, the unknown-finding note in the free tier, filters on the route, the Dismiss and Rescan-while-rechecking transitions, the recheck deadline, the ENOENT note for browser data dirs, and the status-aware browser prompt labels.
- `docs/RULES.md`: TL-MAC-027 row describes the `SnapshotDates` fallback.
- `docs/SECURITY-MODEL.md`: Defaults row names the Time Machine `Destinations` read; the file inventory lists the browser bundle metadata stat.

## Open items

- No `cancel_section` Tauri command and no AbortSignal through `collectSection`. The UI deadline restores control, but a hung collector thread runs on until it returns.
- `App.tsx` has no error boundary around `<Screen />`. The store fix removed the known trigger; a future render throw would still blank the window.
- `report_store.rs` writes `last-report.json` in place. A crash mid-write leaves a partial file, which serde rejects, so the app boots without a report rather than blank.
- `computeScore` in `packages/core/src/engine/score.ts` pairs `rules[i]` with `results[i]`; the contract is implicit.
- Catalog version stays 0.1.0 although several rule texts changed.
- `tl-mac-018` step 1 mentions `lsof` in Terminal and shows with Developer mode off. Self-contained, left as is.
- `cargo fmt --check` reports pre-existing diffs in `src/bin/talos-collect.rs`; rustfmt is not enforced.
- The Firefox `profiles.ini` read reports `needs_full_disk_access` on this Mac when run from a shell (pre-existing).
- Reviewer artefacts under `apps/desktop/qa/scratch/` and `apps/desktop/qa/screenshots/copy/texts.json` are stale (git-ignored, not in `pnpm test`).
- Not exercised: the Tauri window, the real browser launch for AI help, and booting the live app with a corrupt `last-report.json`.
- A vite process on port 1420 (pid 76323, started 17:52 today) was running before this pass and was left alone.

## How to reproduce

See `apps/desktop/qa/README.md` for the URL parameters and the demo adapters.

```sh
cd /Users/antoineboxho/Developer/Personal/02_projects/talos-labs
pnpm -r typecheck
pnpm -r test
(cd apps/desktop/src-tauri && cargo build && cargo test && cargo clippy --all-targets -- -D warnings)
pnpm --filter @talos/desktop build
cd apps/desktop
VITE_TALOS_DEMO=1 pnpm exec vite --strictPort --port 1438 > /tmp/talos-demo-1438.log 2>&1 &
pnpm exec tsx qa/snap.ts --port 1438 --out qa/screenshots/after
pnpm exec tsx qa/axe.ts --port 1438 > /tmp/axe.json
kill %1
cd ../.. && pnpm scan
```

Both QA scripts start their own server when nothing answers on the port, so the manual vite line is optional.

## Screenshots

- After: `apps/desktop/qa/screenshots/after/` (88 files, `<screen>-<scheme>-<width>.png`).
- Baseline before the fixes: `apps/desktop/qa/screenshots/baseline/`.
- Both directories are git-ignored.

# Round two

Date: 15 October 2026.
Build: Talos Labs v0.1, catalog 0.2.0, core 0.1.0, CIS Apple macOS 26 Tahoe Benchmark v1.0.0.

Round two reviewed the tree that round one left behind with the same six lenses. The reviewers raised 43 findings; the verifier confirmed 27 and rejected 16. Four area fixers (core, ui, rust, adapters) applied the confirmed findings and the nine mandated hardening items in parallel; this pass re-ran every check on the merged tree, closed the loose ends the fixers flagged outside their own areas and wrote this section.

## Checks on the final tree

| Command | Result |
|---|---|
| `pnpm -r typecheck` | passes (core and desktop, including `qa/tsconfig.json`) |
| `pnpm -r test` | passes: 398 core tests (42 files), 295 desktop tests (20 files) |
| `cargo build` in `apps/desktop/src-tauri` | passes |
| `cargo test` | passes: 128 unit tests (2 ignored), 2 integration tests |
| `cargo clippy --all-targets -- -D warnings` | passes |
| `pnpm --filter @talos/desktop build` | passes (same advisory about a 697 kB chunk) |
| `pnpm exec tsx qa/snap.ts --port 1442 --out qa/screenshots/round2` | 96 screenshots written |
| `pnpm exec tsx qa/axe.ts --port 1442` | 0 violations, exit 0 |
| `pnpm scan` | score 48, grade poor; see below |

Round one ended at 386 core tests, 260 desktop tests, 114 Rust tests and 88 screenshots.

## Confirmed findings

All 27 confirmed findings are fixed. Every one was rated low. Area is the fixer that owned the change.

| Id | Area | Status |
|---|---|---|
| copy-013 | core | Fixed. 004 title is "Only apps from known developers can open"; fail title "Apps from unknown developers can open". |
| copy-014 | core | Fixed. 018 carries `sudo lsof -nP -iTCP -sTCP:LISTEN` in `commands`; step 1 names no tool. |
| copy-015 | core | Fixed. 030 carries `chmod 700 ~/.ssh` and `chmod 600 <key>` in `commands`; the steps refer to them by position. |
| copy-016 | core | Fixed. 028 summary is one action, the Settings path is gone (the permission card already has the Full Disk Access button) and the evidence label is "Extensions found with access to every site". |
| copy-017 | core | Fixed. 017 summary is "Use a login password of 15 or more characters."; `pwpolicy` sits in an optional step marked advanced. |
| copy-018 | ui | Fixed. Scanning counter reads "N of 17 areas done". |
| copy-019 | ui | Fixed. Settings says "File names, folder paths and file contents never leave this Mac."; the assistant card and Welcome say "never file names, paths or passwords". |
| copy-020 | ui | Fixed. About names the Explain buttons as the one thing that sends results out. |
| copy-021 | core | Fixed. 029 says "At least one of yours is stored with no passphrase". |
| copy-022 | core | Fixed. 027 no longer describes the check's own mechanics. |
| copy-025 | ui | Fixed. FixCard heads the path with its first segment, so 011 reads "In App Store". |
| a11y-ask-counter | ui | Fixed. The counter is not live; a hidden `role="status"` says "Fewer than 100 characters left" only under the threshold. |
| a11y-remove-key-focus | ui | Fixed. Focus moves to `#api-key` after Remove. |
| a11y-group-count-heading | ui | Fixed. Group heading name is "Needs fixing, 9 items" (verified in Chrome). |
| robustness-explanation-cache-survives-recheck | ui | Fixed. `recheck_done` keeps explanations of findings that do not read the rechecked section and drops the rest and the order; `cacheRef` is pruned to match. |
| robustness-model-id-unbounded | ui | Fixed. `MAX_MODEL_ID_LENGTH = 64` lives in `src/settings`; `parseSettings` falls back to the default beyond it, both inputs have `maxLength`, both notices name the limit. The parser cap was added in this pass. |
| device-admin-ghost-count | rust | Fixed. `humanAdminCount` counts members that resolve in `dscl . -list /Users UniqueID` to uid 500 or more; falls back to the name filter if the listing fails. This Mac now reports 1. |
| device-keystone-empty-plist | rust | Fixed. A plist with neither `Program` nor `ProgramArguments` is skipped; this Mac goes from 16 background items to 13. |
| device-firefox-fda-text | core | Fixed. 028 names Firefox beside Chrome, Brave, Edge and Arc; this pass updated the docs, the `browsers.rs` header and added `Library/Application Support/Firefox` to `PROBE_DIRS`. |
| flows-006 | ui | Fixed. Same change as robustness-explanation-cache-survives-recheck; the rechecking state carries `explain`, so the explanation on screen does not blank. |
| flows-009 | ui | Fixed. `collecting.previous` holds the ready state a Rescan interrupted; a cancelled Rescan returns to it with a notice and keeps the explanations and the Ask conversation. |
| flows-010 | ui | Fixed. Cancel sits in the Scanning header, is disabled once pressed and reads "Cancelling". |
| visual-passed-list-underline-gap | ui | Fixed. The underline is on `span.passed-title` only. |
| visual-empty-groups-no-spacing | ui | Fixed. 24 px between stacked groups (16 px collapsed into the existing margins and changed nothing). |
| visual-passed-empty-copy-mentions-filters | ui | Fixed. "No checks passed." with no filter; one "Nothing matches these filters. Show everything" line when a filter hides every group. |
| visual-scanning-cancel-below-fold | ui | Fixed. Same change as flows-010; Cancel's bottom edge is at 72 px at 900x600 and `harness.ts` fails the walk if it drops below the fold. |
| visual-command-row-copy-position | ui | Fixed. `.command` is a grid; Copy and the "Prompts for input" note sit in the same place on every row. |

## Rejected findings

Sixteen findings were rejected: copy-012, copy-023, copy-024, a11y-badge-aria-label, robustness-no-score-copy-without-permissions, robustness-cancel-shows-two-notices, robustness-prompt-contradicts-itself-on-null-score, robustness-last-loaded-dropped-when-scan-starts-first, device-dev-build-hides-listeners, flows-004, flows-007, flows-008, flows-011, flows-012, flows-013, visual-no-score-copy-points-below. Eight were already fixed in round one, four misstated the text or the mechanism, and four describe behaviour that is documented or out of scope (unsigned builds, the web-only history stack, the demo recheck, minute-resolution timestamps). Nothing was changed for them.

## Mandated hardening

- Error boundary: `apps/desktop/src/components/ScreenErrorBoundary.tsx` wraps `<Screen />` in `App.tsx`. The card has a heading that takes focus, one sentence, a Rescan button and an Open Settings link, and resets when the route changes. `App.test.ts` throws inside About and asserts the card, the focus, the nav and the recovery.
- Atomic report write: `report_store.rs` `write_private` writes `.<name>.<pid>-<seq>-<nanos>.tmp` in the same directory with `create_new` and mode 0600, flushes, fsyncs and renames over the target; the temp file is removed on any error. Licence writes share it. Unit tests cover two saves, a blocked rename and distinct temp names.
- Recheck cancel, Rust: `AppState` holds two flags. `cancel_scan` sets both; the new `cancel_section` sets the recheck flag only, so a Rescan that aborts the old recheck cannot stop the new scan. `collect_section` takes the state, clears its flag on entry, checks it before every command and after collecting, and rejects with `"cancelled"`. Tests in `commands.rs` and `collect/mod.rs`.
- Recheck cancel, adapter and hook: `collectSection(key, { signal })` on the port (`CollectSectionOptions`, optional second parameter). The Tauri adapter rejects at once on an aborted signal, otherwise races the command against the signal, invokes `cancel_section` on abort, rejects with `cancelled` and drops a late answer. The demo adapter honours the signal too. `useScan` aborts the recheck at the 60 s deadline and when a Rescan starts. The adapters fixer had wired the abort to `cancel_scan`; this pass switched it to `cancel_section` for the reason above, with the tests updated.
- `computeScore` looks up severity by `ruleId`; a new test shuffles the results and reorders the rules and fails against the old index-based code.
- `MACOS_CATALOG_VERSION` is 0.2.0; `docs/RULES.md`, `catalog.test.ts`, `evaluate.test.ts` and the engine snapshot follow. The sample reports in `src/app/testing.ts` and `src/adapters/test-fixtures.ts` say 0.2.0 too.
- 018 `lsof` moved into `commands` (needs admin) and the step reworded; catalog tests now also assert that no fix summary names a Terminal tool and no step spells out a program that `commands` already carries.
- `apps/desktop/qa/scratch/` is empty and `qa/screenshots/copy/texts.json` is gone. `snap.ts`, `axe.ts`, `README.md`, `baseline/` and `after/` are untouched.
- `windows-minimal` is on the walk as `overview-windows-minimal` and `findings-windows-minimal`; `qa/README.md` lists them.

## Accessibility (axe)

Final run: 0 violations across 48 screen and scheme pairs (24 screens, light and dark). Counts by impact: critical 0, serious 0, moderate 0, minor 0. Exit 0.

## Live scan of this Mac

`pnpm scan`, collected 2026-10-15T19:38:26Z.

- Score 48, grade poor, deducted 52, complete no, not capped by critical. Catalog 0.2.0.
- Counts: pass 15, fail 8, review 2, unknown 6, not applicable 0.
- Failing: TL-MAC-001, 002, 003, 011, 014, 027 (7031 hours), 029 (six keys), 031 (two tokens in `~/.npmrc`). Same eight ids as round one.
- Review: TL-MAC-017 (minimum length 4), TL-MAC-023 (13 background items, was 16).
- Unknown: TL-MAC-018 to 022 (`permission_denied`, unsigned build) and TL-MAC-028 (`needs_full_disk_access`; Chrome and Firefox both listed as not checked).
- Evidence changes: TL-MAC-014 now shows "Administrator accounts: 1" (was 2); TL-MAC-023 lost the two Keystone tombstones and `SessionManagerPlugin`.

## Extra changes in this pass

- `apps/desktop/src/adapters/tauri-system-state.ts` and its test: recheck abort invokes `cancel_section` instead of `cancel_scan`.
- `apps/desktop/src/settings/index.ts`: `MAX_MODEL_ID_LENGTH` and the parser cap, with a test; `Settings.tsx` and `screens.test.ts` import the constant from there.
- `apps/desktop/src-tauri/src/capabilities.rs`: `Library/Application Support/Firefox` in `PROBE_DIRS` before the Safari fallback. `collect/macos/browsers.rs` header names Firefox.
- `docs/DESIGN.md`: accounts and persistence sources, Firefox behind Full Disk Access, section 7 transitions (cancelled Rescan, `collectSection` signal, surviving explanations, `explain` on rechecking), `report_store.rs` line, the command surface with `cancel_section`, the two-flag paragraph, the out-of-scope line.
- `docs/SECURITY-MODEL.md`: Dscl row, the plist rule, Firefox, `cancel_section` in the command list.
- `docs/DEVELOPMENT.md`: `cancel_section` and the rejection strings, Firefox in the Full Disk Access note.

## Open items

- Closed from round one: `cancel_section` and the AbortSignal, the error boundary, the atomic write, `computeScore` keyed by id, the catalog version, 018 `lsof`, the stale reviewer artefacts.
- `cargo fmt --check` reports 264 hunks across most Rust files, not only `talos-collect.rs` as round one said. rustfmt is not part of the gate.
- The `windows-minimal` Overview says "Nothing could be checked. Every area was out of reach" although every rule on that fixture is not applicable rather than unavailable. Noted by the ui fixer, left as is.
- `resolveModel` in `src/adapters/explainer-shared.ts` does not check the id length itself. Stored ids are capped by `parseSettings`, so nothing in the app reaches it with a long id.
- The Firefox probe directory and the real `cancel_section` round trip were not exercised on a Firefox-only machine or in the Tauri window; unit tests cover both sides separately.
- Not exercised: the Tauri window, the real browser launch for AI help, booting the live app with a corrupt `last-report.json`.
- `pnpm scan` from a shell still reports listeners, remoteAccess and fileSharing as `permission_denied` (unsigned build; documented trade-off) and both browsers as `needs_full_disk_access`.
- The vite process on port 1420 (pid 76323) was left alone. The demo server this pass started on 1442 was stopped.

## Screenshots

- Round two: `apps/desktop/qa/screenshots/round2/` (96 files, `<screen>-<variant>-<scheme>-<width>.png`).
- Round one after and baseline sets are unchanged. All three directories are git-ignored.

# Mineral restyle

Date: 16 October 2026.
Build: Talos Labs v0.1, catalog 0.2.0, core 0.1.0, CIS Apple macOS 26 Tahoe Benchmark v1.0.0.

The app was restyled to the Mineral design kit (`Talos-Labs-Mineral-Design-Kit-v1`, token mapping in `docs/DESIGN-MINERAL.md`). Three fixers (guided, expert, rust) applied the parity, clean-copy, a11y-structure and mandated items. This pass re-ran every check on the merged tree, read the screens against the kit prototype and closed what was left.

## What was compared

- The demo build (`VITE_TALOS_DEMO=1`, port 1490) against the kit prototype (`app/index.html?screen=…&theme=…&width=…`) for welcome, plan, single, batch, show, permission, paywall, end, overview, findings, finding, settings and ask, in light and dark at 1100x760 and 900x600. Prototype captures are in `apps/desktop/qa/scratch/kit-final/` (52 files, git-ignored).
- Screens read in this pass: Overview, Findings, the free firewall finding, Settings, the guided plan, batch confirm, working and done, show, permission (bundled and `bundled=0`, before and after "Show me where"), paywall and the partial end screen, light and dark at both sizes.

## Checks on the final tree

| Command | Result |
|---|---|
| `pnpm -r typecheck` | passes (core and desktop, including `qa/tsconfig.json`) |
| `pnpm -r test` | core 49 files, 444 tests; desktop 51 files, 475 tests (was 464) |
| `cargo build`, `cargo test`, `cargo clippy --all-targets -- -D warnings` | build clean; 185 passed, 4 ignored; clippy clean |
| `pnpm --filter @talos/desktop build` | builds; the 841 kB chunk warning is unchanged |
| `pnpm exec tsx qa/snap.ts --port 1490 --out qa/screenshots/mineral-final` | 392 screenshots (244 expert, 148 guided), exit 0 |
| `pnpm exec tsx qa/axe.ts --port 1490` | 0 violations across the expert walk in both schemes; no `region` on scanning |
| `pnpm scan` | exit 0; score 48, grade poor, 15 pass, 8 fail, 2 review, 6 unknown |
| Real app | port 1420 was held by the owner's instance, so `src-tauri/target/debug/talos-desktop` ran directly for 20 s: empty log, no panic, killed afterwards |

## Confirmed from the fixers' reports

- Guided: the progress bar fills from `progress.done` and carries `aria-label="Check-up progress"`; the status line uses the static 7 px dot; the batch working step is title plus "Waiting for macOS"; the batch done step has no mark; the end screen is one 15 px row per group with a 13 px item list, no mark, and the new unread titles ("I couldn't check your Mac." / "Nothing to fix in what I could check."); the question, permission and show steps have one body paragraph and no muted card; the welcome columns are one paragraph each; `.guided` is the `main`.
- Expert: the Next three fixes rows are title, meta line with the cost word, text-only severity tag and chevron, no inline button; the locked AI card is one line plus the licence field with Activate and "Buy a licence"; the finding head is badge plus "Network · CIS 2.2.1"; the fix card shows "About two minutes · No side effects" and folds the manual route; Settings rows have descriptions, `<small data-status>` permission words and a strong plus small licence row; Ask pairs turns into one exchange card; scanning is wrapped in `main.screen-host`.
- Rust: `Capabilities.bundled` from `current_exe()`; `toCapabilities` in core defaults a missing value to `true`; `bundled=0` in the demo adds the development-build paragraph on the guided permission step (watching state only) and under the Full Disk Access row in Settings. Confirmed on screen in both schemes and sizes.

## Fixed in this pass

- `apps/desktop/qa/harness.ts`: `guided-end-unreadable` waited for "Nothing needs fixing." and timed out; it now waits for "I couldn't check your Mac." (the guided fixer's new title on `all-unavailable`). The `I couldn't check N areas.` row check is unchanged.
- `apps/desktop/src/styles/guided.css`: the guided paywall hid the Activate button but not the "Buy a licence" link, so the link wrapped onto two lines beside a short input and duplicated the step's own buy button. The guided variant now hides the Activate button, the Buy link and the caption together; the field is the 320 px input under the button, as in the kit. The expert licence field is untouched.

## Remaining differences from the prototype

- Overview rows at 900x600 wrap the meta line ("+20 points when fixed" plus the cost word) to two lines in the 324 px column; the kit shows one small line because it has no cost word. The Overview also keeps the locked AI card and its field, which the kit does not show; at 900 the Activate button and Buy link wrap under the input.
- The end screen's unreadable row stays the sentence "I couldn't check 1 area." (15 px, no small part) rather than the kit's "I couldn't check · 1 area" split, to keep the string and test id.
- The reads disclosure on the guided welcome keeps the welcome title and body while open; the kit swaps them for "What Talos Labs checks."
- The finding page keeps separate "What was found", "Why it matters" and "Done it?" cards, a filled "Turn on…" button with its icon and the "macOS will ask for your password." aside; the kit merges the evidence and why cards and uses an outlined button.
- Button labels kept as strings: "Rescan" (kit "Check again"), "Open Full Disk Access" and "Open Automation settings" (kit "Open Settings" and "See details").
- `qa/scratch/expert-measure.ts` still references `.detail-check`, which no longer renders; scratch is git-ignored.
- Not exercised: the Tauri window beyond the 20 s launch, the real browser launch for AI help, `cargo fmt --check`.

## Screenshots

- `apps/desktop/qa/screenshots/mineral-final/` (392 files, `<screen>-<scheme>-<width>.png`), captured after both fixes above; the guided set was re-shot after the paywall change.
- Permission step with `bundled=0`: `apps/desktop/qa/scratch/final-bundled/` (16 files). Paywall after the fix: `apps/desktop/qa/scratch/final-paywall/` (4 files). Kit prototype: `apps/desktop/qa/scratch/kit-final/`. All scratch directories are git-ignored.
- The owner's vite process on port 1420 (pid 94832) was left alone. The demo server this pass started on 1490 was stopped.

## Warmth and urgency

Final check of the warmth pass (docs/DESIGN-WARMTH.md) after both implementers finished: the guided end screen back to labelled groups of 44 px rows with a "Do this next" card and an urgency line, and the moodboard's gradients and grain on the canvas, hero bands, primary buttons, progress fill and score ring.

### Checks on the final tree

| Command | Result |
|---|---|
| `pnpm -r typecheck` | clean (core, desktop incl. qa) |
| `pnpm -r test` | core 50 files, 450 passed; desktop 51 files, 479 passed |
| `cargo build && cargo test && cargo clippy --all-targets -- -D warnings` (src-tauri) | 186 passed, 4 ignored; clippy clean |
| `pnpm --filter @talos/desktop build` | built; the 847 kB chunk warning is pre-existing |
| `pnpm exec tsx qa/snap.ts --port 1493 --out qa/screenshots/warmth` | 392 shots, exit 0, run twice (before and after the token fix below) |
| `pnpm exec tsx qa/axe.ts --port 1493` | first run: 5 serious `color-contrast` on `.badge-medium` in dark; after the fix 0 violations |
| `pnpm exec tsx scripts/contrast.ts` | all pairs pass after the fix; the script now follows source order (see below) |
| `pnpm scan` | exit 0 (listeners, remoteAccess and fileSharing unavailable, unsigned build) |
| Real app | port 1420 held by the owner's vite (94832) and app (61487); `src-tauri/target/debug/talos-desktop` ran directly for 20 s, empty log, no panic, killed |

### Fixed in this pass

- `apps/desktop/src/styles/tokens.css`: the warmth `:root` block re-declares `--fg-tertiary`, `--notice-fg`, `--sev-medium-fg` and `--grade-fair` for light, but it sits after the dark `@media` block, so dark inherited the light values (`#785a37` on `#312723` is 2.29:1). The dark warmth block now restates the dark values (`#af9788`, `#e3c48b` x3). Computed styles confirmed in both schemes.
- `apps/desktop/scripts/contrast.ts`: it tagged each `:root` block light or dark and merged light into dark only where dark had no value, which hides the cascade bug above. It now applies every unscoped block to both schemes in source order, so the same bug would fail 13 pairs. `src/styles/CONTRAST.md` regenerated.

### Read on screen

Welcome, plan, end partial, end all done, batch confirm, show, paywall, Overview, Findings, a finding and Settings, light and dark, 1100x760 and 900x600, in `apps/desktop/qa/screenshots/warmth/`. Canvas carries the sand to clay gradient with grain, the spiral and horizon sit on welcome and end only, primaries and the progress fill use the accent gradient, the score ring is the gradient arc on `--ring-track`, cue bars appear on failing critical and high rows and on the high "Do this next" card; cards, inputs, sidebar and strips are flat paper. Group labels and links on the canvas are 13 px `--fg-secondary`, measured at 4.85:1 on the darkest grain point in light and 9.37:1 in dark.

### Open

- Fixed after the pass: the all-done end screen on `dev-machine` showed a "Do this next" card for the low, left-alone TL-MAC-014 next to "Your Mac is in good shape." `nextAction` now raises a left-alone rule only when it is critical or high (spec 6b updated; core 451 tests, desktop 479, guided walk 148 shots re-run in `qa/screenshots/warmth`).
- A rule with neither a fix nor a pane gets a fourth label, "Details", which the spec does not list.
- The hover fill on the first end-screen row in some shots is a capture artefact (mouse left over the last link).
- `--fg-tertiary` is held to a 3:1 floor on the canvas in `scripts/contrast.ts`; it is used for icons and 11 px tags only, not checked here.
- Not exercised: the Tauri window beyond the 20 s launch, `cargo fmt --check`.
- The demo server on 1493 was stopped. No git commands were run.

## Menu bar watch

Date: 17 October 2026. Round for the menu bar watch (`docs/DESIGN-WATCH.md`): the tray item and the 320 px window, the Rust watch loop, the "something seems fishy" guided flow, the Watch section in Settings, the kill-switch rewrite of the two AI providers, and the ACL manifest over the app commands. Demo mode only for the screens; the Rust side by its own tests. Nothing in this round runs a catalogue action, writes a LaunchAgent, starts a sign-in or touches `~/.claude`, `~/.codex` or the Keychain on this Mac; live checks are read-only probes; at most one dev-build banner, under Terminal's name. The result cells below are from the run on the final tree; the rows not run in this pass say so.

### Checks on the final tree

| Command | Result |
|---|---|
| `pnpm --filter @talos/desktop typecheck` | Clean (`tsc --noEmit` on the app and on `qa/tsconfig.json`). |
| `pnpm -r test` (repo root) | Core 60 files, 613 tests, all passed. Desktop 72 files, 811 tests, all passed. |
| `cargo test` (apps/desktop/src-tauri) | Lib 361 passed, 8 ignored. Integration tests 24 passed, 2 ignored (`watch_live` and `smoke` stay ignored). |
| `cargo clippy --all-targets -- -D warnings` (apps/desktop/src-tauri) | Clean. |
| `pnpm exec tsx scripts/contrast.ts` (apps/desktop) | "all pairs pass". |
| `pnpm exec tsx qa/axe.ts --only ai` | 0 violations, exit 0. |
| `cargo fmt --check` (apps/desktop/src-tauri) | Failed on 30 files, all touched or created on this branch (`main` was fmt-clean for the same files). `cargo fmt` was run on the final tree; the check is clean, and clippy and `cargo test` were re-run after it. CI does not run fmt. |
| `pnpm exec tsx qa/snap.ts --only watch --out qa/screenshots/watch` (port 1430) | 114 shots, exit 0, no layout warning. |
| `pnpm exec tsx qa/axe.ts --only watch` | 10 violations, 0 serious or critical: `page-has-heading-one` (moderate) on the five 320 px window states in both schemes. The window is a status surface with one status line and no heading by design (DESIGN-WATCH.md section 5). |
| `pnpm exec tsx qa/snap.ts --out qa/screenshots/watch-full` and `qa/axe.ts` (all four walks) | Not run in this pass; the watch walk only. |
| `TALOS_CHATGPT_OFF=yes cargo build` and `TALOS_CLAUDE_PLAN_OFF=0 cargo build`, then a plain `cargo build` | Not run in this pass. The `offered()` unit tests ran under the plain build as part of `cargo test`. |
| `cargo test fetch_downloads_verifies_and_reports_the_version -- --ignored` (throwaway app-data dir) | Not run in this pass. |
| Real app (`pnpm desktop`, 60 s) | Not run in this pass. No catalogue action, LaunchAgent, sign-in, Keychain item or banner was touched on this Mac. |

### Fixed in this pass

- The apply commands check the catalogue table before the plan runs (`commands::take_single`): a `TL-MAC-*` plan handed to `watch_action_apply`, or a `watch.*` plan handed to `fix_apply`, is refused with `not_in_catalog` and nothing runs; a Rust test pins both directions.
- The four listing-derived counts (`sig.persistence_new`, `sig.persistence_unsigned`, `sig.persistence_in_temp_or_hidden`, `sig.listener_new_ports`) keep a baseline of 0 after "This is fine", "Yes, that was me" and the 24 h accept, so an acknowledged item no longer returns as a "1 to 0" change for a further day.
- The three persistence counters count as one pair signal (`signals::pair_group`, `pairGroup` in core): a lone unsigned or dot-folder item is "something to look at" and does not notify; a second listing (a manual DNS server, a new listener) makes it act now.
- A noise hold (a Talos fix, a validly signed persistence change) lasts one cycle; it no longer hides a change on every later cycle, and a held change never reaches the 24 h accept.
- A person-triggered refresh (acknowledge, answer, snooze) bypasses the two-cycle hysteresis and the 60 s manual guard, so "This is fine", "Yes, that was me" and "Not now" clear the act-now state at once; `refresh_requested` is now read by `run_once`.
- The notification candidate is the first item that is neither gated nor snoozed, and gated and snoozed items sort after the others, so a corroborated gate notifies for the corroborating item.
- "Not now" caps act now unless the unsnoozed signals justify it on their own, covers the listing's siblings, and the declined item sorts last; `DemoWatch.snooze` mirrors it and the harness warning is gone.
- The 24 h accept skips a snoozed signal, an open gate, a held change and a stand-alone flip in the bad direction (SIP, Gatekeeper, XProtect, a hidden account), which wait for the person.
- `sig.resolvers`, `sig.established_count` and `sig.backup_age_days` have no kind (Rust and `SIGNAL_KIND`): no item, no headline; the window renders the top item only when the rating is not calm.
- The notification body carries a full stop between the headline and the tail: "A new program started running on its own. Open me to see what experts suggest."
- The tray tooltip rounds the elapsed time like the window (`relative-time.ts`): to five minutes, hours from 90 minutes, never "1 hour".
- The expert Welcome's watch sentence is third person ("It also keeps an eye on your settings from the menu bar."); the guided `WELCOME.body` keeps the spec's first-person sentence.
- With the watch off, closing the main window ends the process (`tray::close_action`), since the hidden `watch` window would otherwise keep it alive with a Dock icon and no window.
- `capabilities/default.json` grants `core:window:allow-internal-toggle-maximize`, so the title-strip double-click zoom works again; `tests/capabilities_contract.rs` pins the four core permissions.
- Docs: SECURITY-MODEL counts four plugins (the opener, Rust-only), drops "per provider" from the daily cap, names `tray::on_second_instance` as the no-logging target and lists the fourth core permission; DESIGN-WATCH lists `watch/settings.rs` and `watch/types.rs`, drops "per provider", and records the listing-level rules and the close-on-watch-off in section 11 (notes 32 and 33); `qa/README.md` records the clean run.

### Read on screen

Folder `apps/desktop/qa/screenshots/watch/`, 114 shots: the five window states at 320 px wide and each state's own height from `tray.rs` `window_height` (170 first run, 150 calm and unreadable, 280 look, 360 act) in both schemes, the end screen's act-now card, the gate, the seven noticed headlines, disconnect and its wired variant, stop and its no-entry variant, eradicate, experts with the ransom and model variants, recover and its wired variant, the end screen after "Not now", Settings' Watch section and the guided welcome, light and dark, 1100 and 900 wide for the main-window shots. Read: one primary per fishy screen and at most one link; a source line under every body that suggests an action; the window's status word and icon together; the `act` window fits the 360 px window with "See what to do" and both footer links visible; "Checked 10 minutes ago" under the status word (the tooltip now says the same); "I couldn't check 3 areas" on `unreadable`; no password field anywhere; no program name, port or path outside the Details disclosure; after "Not now" the end screen reads "Nothing needs fixing." with no act-now card.

### Open

- The `page-has-heading-one` axe note on the 320 px window (moderate, by design; see the table).
- The three rows marked "Not run in this pass" above: the four-walk harness, the kill-switch builds and the 60 s real-app run.
- Only on a real Mac, unsigned build (DESIGN-WATCH.md section 9): tray tinting in light and dark, placement under the icon on both displays, hide on blur, the click-while-open case, Cmd+Q through the custom item, sleep and wake ticks, `networksetup -setairportpower` privilege, `launchctl bootout` on a real agent, notification delivery under the Terminal identifier. Not exercised in this round unless the result cell says so.
- Only on a Developer ID build: the socket table signals, notifications under the app's own name, click-through to the noticed screen.
- The demo server port used by this round was stopped. No git commands were run.

## Iteration 4, build A: playful and the activity timeline

Date: 17 October 2026. Final check of build A of iteration 4 (`docs/DESIGN-ITERATION-4.md`): DESIGN-PLAYFUL (TASKS #21, the motion vocabulary, `app/motion.ts`, `CountUp`, `qa/motion.ts`) and DESIGN-AGENT part A (TASKS #23, `packages/core/src/activity/`, `apps/desktop/src/activity/`, the rows on the guided step frame). Another session was editing the licence gate in the same checkout, so the files listed under "Deferred" were not touched by this build. Demo mode only for the screens; no fix, no admin command, no git command, nothing in `src-tauri` changed. Result cells are from the run on the final tree.

### Checks on the final tree

| Command | Result |
|---|---|
| `pnpm -r typecheck` | Clean (core, desktop including `qa/tsconfig.json`). |
| `pnpm -r test` | Core 62 files, 647 passed. Desktop 87 files, 964 of 965 passed; `pnpm -r` exits 1 on the one failure: `src/guided/useGuided.steps.test.ts` > "the third Later asks instead of retiring > 'Ask me again' mid-run for a rule accepted on an earlier step proposes it again after the person's place" (expects `phase.index` 0, gets 1, line 787). That test and `guided/actions.ts` are the other session's uncommitted accept-flow edits and touch none of this build's files; left alone. |
| `cargo test` (apps/desktop/src-tauri) | Lib 376 passed, 8 ignored. Integration 24 passed, 2 ignored. Untouched by this build. |
| `cargo clippy --all-targets -- -D warnings` | Clean. |
| `pnpm exec tsx qa/snap.ts --port 1496 --out qa/screenshots/iteration4-a` | Exit 1 after 276 shots (the expert walk and the guided walk to `guided-batch-confirm`): `harness.ts:783` waits for `.guided-status` "Waiting for macOS" on `guided-batch-working`, and `BatchStep` now draws the activity rows there (DESIGN-AGENT 2a). `harness.ts` is the other session's file; the edit is listed under "Deferred". The rest was captured with a scratch copy of `snap.ts` that logs a failed visit and carries on (`qa/scratch/it4a/snap-tolerant.ts`, git-ignored): guided 144, ai 168, watch 130, accept 40, `guided-batch-working` the only failed visit, no layout warning. The two working steps were then captured by `qa/scratch/it4a/capture-working.ts`, which waits for the "your password" row instead: `guided-batch-working` and `guided-fix-working`, both schemes, both widths. 738 shots in the folder, all from this run. |
| `pnpm exec tsx qa/axe.ts --port 1496` | Exit 1 at the same visit, nothing printed. Per walk with the scratch copy (`qa/scratch/it4a/axe-tolerant.ts`): guided 0 violations (`guided-batch-working` skipped), ai 0, accept 0, watch 10 moderate `page-has-heading-one` on the five 320 px window states (by design, as in the watch round). Expert 0 violations; its first run (straight after the motion smoke) timed out on `scanning-prompting`, `overview-windows-minimal` and `findings-windows-minimal`, and a rerun of the expert walk alone reached every visit with 0 violations, exit 0. 0 serious or critical overall. |
| `pnpm exec tsx qa/motion.ts --port 1496` | "every moment measured", exit 0: eleven moments in motion and under reduced motion, the idle plan screen, four logged skips (`motion-breathe`, `motion-reading`, `motion-watch-status`, `motion-fixed-count`). Run alone on an idle machine. |
| `pnpm exec tsx scripts/contrast.ts` | "all pairs pass". |

### Read on screen

Folder `apps/desktop/qa/screenshots/iteration4-a/`. Read against DESIGN-PLAYFUL and DESIGN-AGENT 2a: `guided-welcome` (light and dark 1100), `guided-scanning` (light 1100, dark 900), `guided-plan` (light 1100, dark 900), `guided-batch-working` (light 1100, dark 900), `guided-fix-working` (light 900), `guided-fix-done` (light 1100), `guided-end-partial` (light 1100), `guided-end-all-done` (dark 1100), `overview-dev-machine` (light and dark 1100), `watch-window-calm` (light) and `watch-window-act` (dark). Every frozen frame is the whole design: the spiral at its token opacity with the headline, body and "Start" all present on the welcome (the stagger's resting values); the scan dots at their resting size with the counter drawn; the score ring full with the grade word under it at `pace=0`; the done disc at full size with the tick drawn to its end; the cue bar present on the critical "Do this next" card and the horizon at rest on the end screen; the all-done screen with the watch on reading `WATCH_ON.nextTime` and no `allDoneLine` (PLAYFUL 3.12). The working steps match 2a and CHAT-UI's row: the password sentence split into the headline "Your Mac is asking for your password." and the body, two rows "Getting ready · done" and "Fixing 3 things · your password" (the single fix reads "Turning it on · your password"), the kit key on the running row and no spinner, the state word trailing in the meta style, no status line, no list, no primary, no link. The capture script also read the DOM: one `[data-state="running"]` row and no `[aria-live]` inside the rows on every working shot. Nothing needed fixing; no file was changed in this pass.

### Deferred to the other session's files

- `apps/desktop/qa/harness.ts:781-783`: replace the `.guided-status` "Waiting for macOS" wait on `guided-batch-working` with `page.locator(".guided .guided-activity .activity-word").filter({ hasText: "your password" }).waitFor({ timeout: STEP_TIMEOUT })`, update the comment, and add the assertions from DESIGN-AGENT: every `.chat-activity-row` has a visible state word, no `[aria-live]` inside rows, at most one `[data-state="running"]`, `animationName` none on `.guided-tick` and `.spin` under reduced motion. Until then `snap.ts` and `axe.ts` stop at that visit.
- `apps/desktop/src/guided/EndScreen.tsx` (HOLD): `<p><CountUp value={fixed.length} /> {fixed.length === 1 ? "thing" : "things"} fixed today.</p>` in place of `things(fixed.length)`, and `<p>{END.allDoneLine}</p>` between the all-done title and `END.nextTime` only when `allDone && !watchOn`; `EndScreen.test.ts`: textContent match on the line, the order test and the watch-on absence test (PLAYFUL 3.3, 3.12); then enable `motion-fixed-count` in `qa/motion.ts`.
- `apps/desktop/src/guided/copy.ts` (HOLD): `END.allDoneLine: "That's all for today."` with its 1.6 entry in `copy.test.ts`; move `ACTIVITY` from `apps/desktop/src/activity/copy.ts` into `guided/copy.ts` and `ACTIVITY.words` into `CHAT.word` (adding `working: "working"`), delete `activity/copy.ts` and repoint `activity/copy.test.ts`.
- `apps/desktop/src/watch/WatchWindow.tsx` (HOLD): `span.watch-status-inner` keyed by `state.rating` inside the stable `div[role="status"]`; `watch.css`: move `gap` from `.watch-status` to the inner span (the inner rule is already appended); `WatchWindow.test.tsx`: same status node across a rating change; enable `motion-watch-status`.
- `apps/desktop/src/adapters/demo-fix.ts:184-197`: emit per-item progress `{ planId, phase: "running", step: line + 1, of: item.lines.length, item: index }` as `batch.rs` does, with `demo-fix.batch.test.ts` updated; until then the demo's running user-level row shows cumulative numbers.
- Docs not in this build's list: `docs/DESIGN-MINERAL.md` section 5 (the eight motion table rows and the spiral exception to "no ambient looping motion"); `docs/DESIGN-WARMTH.md` 9b (one sentence pointing at DESIGN-PLAYFUL, the breath runs downward); `docs/DESIGN-CHAT-UI.md` line 314 (`working: "working"` in `CHAT.word`); `docs/DESIGN-PLAYFUL.md` 3.11 ("passed to `useEased` as its restart token", not a `key`) and 3.1 (the three welcome delays are literal 200/300/400 ms, so the `.guided-welcome-first` selectors sit in the `guided.css` `animation: none` block); `docs/TASKS.md` rows #21 and #23 part A.

### Open

- The failing `useGuided.steps.test.ts` case above, for the session that added it.
- The three expert axe timeouts above did not reproduce on the rerun; they are logged as a one-off, not investigated further.
- `ACTIVITY_STRINGS.sections` is `GUIDED_SECTION_LABELS`, which carries three progress sentences ("Checking your login keys" and two more); nothing feeds `section` rows in part A, and part B should add nouns for `ssh`, `passwordPolicy` and `dotfiles` under the banned-word test.
- `apps/desktop/src/scan/machine.ts` keeps a local `RecheckResult` union structurally identical to core's; a later cleanup can import it.
- Only on a real Mac: the password dialog's timing against the "your password" row on a fast batch, VoiceOver's reading of the always-mounted `p.guided-activity-status` during a batch, the tick's `stroke-dashoffset` under the 0.001 ms rule, WKWebView flipping `prefers-reduced-motion` live.
- The demo server on 1496 (vite pid 86401) was stopped. The scratch scripts stay in `apps/desktop/qa/scratch/it4a/` (git-ignored). No git commands were run.

## Chat home

Date: 17 October 2026. Final check of the chat build (TASKS #12 and #20, `docs/DESIGN-CHAT.md` and `docs/DESIGN-CHAT-UI.md`, index `docs/DESIGN-ITERATION-4.md`), session talos-labs-95, on HEAD 950a8cf plus the uncommitted work of build A and the chat. Another session edits the menu bar window in the same checkout, so nothing under `src/watch/`, `src-tauri/src/watch/`, `tray.rs`, `commands.rs`, the two watch adapters or `docs/DESIGN-WATCH-WINDOW.md` was touched. Demo mode only for the screens; no fix, no admin command, no git command.

### Checks on the final tree

| Command | Result |
|---|---|
| `pnpm -r typecheck` | Clean (core, desktop including `qa/tsconfig.json`). |
| `pnpm -r test` | Core 74 files, 735 passed. Desktop 103 files, 1177 passed; 1178 after the scroll fix below (`pnpm exec vitest run` in `apps/desktop`, exit 0). |
| `cargo build` (apps/desktop/src-tauri) | Clean. |
| `cargo test` | Lib 404 passed, 8 ignored. Integration 28 passed across 9 binaries. |
| `cargo clippy --all-targets -- -D warnings` | Clean. |
| `pnpm --filter @talos/desktop build` | Built; the standing advisory about the 619 kB main chunk. |
| `pnpm exec tsx qa/snap.ts --port 1499 --out qa/screenshots/chat` | Exit 0, 904 shots, every walk (expert, guided, ai, accept, watch, chat), no skipped visit. The 41 chat visits were re-captured after the scroll fix with `--only chat` (164 shots, exit 0), so the folder holds the fixed tree. |
| `pnpm exec tsx qa/axe.ts --port 1499` | Exit 0: 28 moderate `page-has-heading-one` on the 14 watch-window states (320 px window, by design, as in the watch round), 0 on every chat, guided, ai, accept and expert screen. The chat walk alone after the fix: 0 violations. |
| `pnpm exec tsx qa/motion.ts --port 1499` | "every moment measured", exit 0: fourteen moments in motion and under reduced motion including `motion-breathe` and `motion-caret` on the chat home, the idle plan screen, one logged skip (`motion-reading`, DESIGN-DAILY not built). |
| `pnpm exec tsx scripts/contrast.ts` | "all pairs pass". |
| `target/debug/talos-desktop` for 20 s | Not possible: the binary is single-instance (`tauri_plugin_single_instance`, `tray::on_second_instance`) and another `target/debug/talos-desktop` (pid 74680, started 20:29:28 by another shell, not this session's) was running, so the launch handed off to it and exited 0 at once with nothing on stdout or stderr. No panic from this launch; the running instance was left alone and nothing was killed. |

### Read on screen

Folder `apps/desktop/qa/screenshots/chat/` (git-ignored). Read against CHAT-UI's mock-ups and the owner's tests: `chat-opening` (light 1100, dark 900), `chat-opening-since` (dark 1100), `chat-opening-free` (light 900), `chat-batch-card` (dark 1100), `chat-activity-batch` (light 900), `chat-activity-done` (light 1100), `chat-activity-failed` (light 1100), `chat-model-cards` (dark 1100), `chat-model-waiting` (dark 900, light 900), `chat-still-waiting` (light 1100, dark 900), `chat-stopped` (light 900), `chat-limit-notice` (light 900), `chat-watch-act-now` (dark 1100), `chat-lock-card` (light 1100, dark 900), `chat-end` (dark 1100), and the guided end screen `guided-end-partial` (light 1100, dark 900) and `guided-end-all-done` (dark 1100). What matches: the opening parks at the top with the headline, the rust urgent line and the one live card, so the first thing to click is the card's primary; the batch card's three rows, its one primary and "Explain this"; the two activity rows with the kit key and the lower-case state words "done" and "your password"; the result list with ticks and the "Did not change" row with the cross; the model block with the rule, the caret, the badge from the first moment and "Still waiting for ChatGPT." under it; the limit notice under the person's turn with the same sentence in the composer's slot and the three chips still live; the act-now exchange with the red octagon, "See what to do" and "This is fine, I know it"; the lock card with four rows, "Buy the full version, €24 a year", the paste field and "Not now"; the strip's three text links, "Chat" on the walk-through's strip; dark values on every token.

One defect, fixed: at 900x600 the shots of a streaming turn (`chat-model-waiting`, `chat-still-waiting`) left the badge and the still-waiting line below the fold. Two causes, measured with a Playwright probe: `useStickToBottom` followed no content growth while `state.stream.kind !== "idle"`, so the line that lands while the model is still silent was not followed; and a resize of the log while a turn streams was not followed either, which is what the harness does between its 1100 and 900 shots. `apps/desktop/src/chat/scroll.ts`: the ResizeObserver follows a change of the log's own `clientHeight` whatever the stream (one comment: a resize of the log itself is never a partial). `apps/desktop/src/chat/ChatScreen.tsx`: the hook's `streaming` is `state.stream.kind === "streaming"`, so only partials are left unscrolled. `apps/desktop/src/chat/scroll.test.ts`: one case with a stubbed `ResizeObserver` (growth with no resize waits while streaming; a resize follows). After the fix the probe reads distance 0 from the bottom at 900x600 after the send, after the still-waiting line and after a 1100 to 900 resize; both shots show the caret, the badge and the line above the composer. `docs/DESIGN-CHAT-UI.md` section 5 carries the note.

Observations, not changed: the lock card at 900x600 and the batch card at 1100 are taller than the log, so their headline sits above the top edge while the primary stays above the fold (the design's bottom-stuck default, kept by the earlier fixer); `chat-end` on a one-step plan reads "I found 1 thing to fix." then `PLAN.urgent` "One of these is urgent.", the same pair the v0.3 plan screen draws (`guided/screens/PlanScreen.tsx:26`), so a singular line is a shared copy change outside this build; the chat's end title after one snooze and no fix is `END.partial` "Your Mac is safer than it was.", the same choice `EndScreen.tsx:171` makes; programmatic headline focus draws the focus ring in headless Chrome (`chat-watch-act-now`), as on the guided steps.

### Docs touched in this pass

`docs/DESIGN-CHAT.md` "As built" gains one bullet with CHAT-UI's "Docs touched" items (the `region` role, `activity` and `notice`, "New messages", `ICONS.send`, the three strip links, the opening's live card rule, the `src/chat/` files, the guard line, the free composer assertion). `docs/DESIGN-AI-PRESENCE.md` section 5 "Blocks": the chat's badge is drawn from the moment the block is appended. `docs/DESIGN-CHAT-UI.md` section 5: the scroll note above. `docs/TASKS.md` rows 12 and 20: "built, uncommitted (talos-labs-95); not yet verified by the owner". Already in place from the build and checked here: `docs/SECURITY-MODEL.md` Boundary 3 "The chat task" with `names`, the four "Injection defences" sentences and `watch_open_main`'s question rule; `docs/DESIGN-AI-PRESENCE.md` sections 1 and 8; `docs/DESIGN-V03.md` sections 1 and 7; `docs/DESIGN-AI.md` section 3; `readme.md`'s chat paragraph; `docs/DESIGN-AGENT.md` 2a and 4; `docs/DESIGN-PLAYFUL.md` 3.8; `apps/desktop/qa/README.md`.

### Deferred to the other session's files

- `packages/core/src/ports/watch-port.ts`: `WatchOpenScreen` gains `"chat" | "connect"`, `openMain(screen, question?)`, the `onOpen` and `onShown` payload gains `question?: string`. `App.tsx`'s `onWatchOpen` is typed structurally as `{ screen: string; question?: string }` and compiles before and after.
- `apps/desktop/src/adapters/tauri-watch.ts`: pass `question` through when it is a string of at most 500 characters. `apps/desktop/src/adapters/demo-watch.ts`: `watch_open=chat&question=` replay (the chat replays it through `withWatchOpenReplay` in `src/app/demo-boot.ts` until then).
- `apps/desktop/src-tauri/src/tray.rs` and `commands.rs`: `OpenScreen::Chat` and `OpenScreen::Connect`, `watch_open_main(screen, question?)` and the `watch:open { screen, question? }` emit; the `chat` case must route to `{ name: "chat" }` (the ask route no longer exists). `apps/desktop/src-tauri/tests/ai_no_logging.rs`: add `src/commands.rs` to `FILES`.
- `apps/desktop/src/watch/WatchWindow.tsx`: the ask field and the "Ask why this matters" link that call `openMain("chat", text)`; the main window matches the draft against core's `askWhyQuestion(headline)`.
- `apps/desktop/src/guided/copy.ts` WATCH block: `WATCH.askWhy` and `WATCH.askPlaceholder`; `copy.test.ts` asserts `WATCH.askWhy` equals the chat's text whenever the key exists.
- `docs/DESIGN-WATCH-WINDOW.md`: the ask-field section should say the main window takes the draft through `ChatDraftContext` (`apps/desktop/src/chat/draft.ts`), the event is `draft_received { text, autoSend }` in `apps/desktop/src/chat/state.ts`, and the quoted `CHAT.askWhy` form at line 266 versus the unquoted core text is theirs to resolve.
- `App.tsx` does not pass `next` into `useWatch`, so "Up next" shows only in the demo (the watch session's note). `watch:open { screen: "noticed" }` still goes straight to `fishy.open` (pinned by App tests); the chat appends the act-now exchange whenever `WatchState` becomes `act_now` while mounted, and routing the notification tap through the chat first is an owner call.
- Closed by a9067b8 (the watch session): `WatchOpenScreen` carries `"chat" | "connect"` and `openMain(screen, question?)` in `packages/core/src/ports/watch-port.ts`; `tauri-watch.ts` passes the question with `chat` only, cleaned and cut at 500; `demo-watch.ts` hands it to `onOpen` unrecorded and `demo-boot.ts` replays `watch_open=chat&question=`; `tray.rs` has `OpenScreen::Chat`; `WatchWindow.tsx`'s ask field and "Ask why this matters" send `WATCH_WINDOW.askWhy(headline)`, which is core's `askWhyQuestion`; `src/watch/copy.ts` holds `askPlaceholder`.
- Closed in this pass, 17 October 2026: `App.tsx` passes `next` into `useWatch` (`nextAction(plan, report)` as `{ reportId, ruleId, kind }`, an `unlock` read as `details` since the window only opens home, null without a plan or report; `useGuided` now runs before `useWatch`), pinned by an `App.test.ts` case that lands the launch check-up at pace 0; the earlier four-argument `setProfile` assertions carry the fifth `null`.
- Closed in this pass: the chip (`chat/controller.ts`) and the auto-send match (`chat/useChat.ts`) both read `askWhyQuestion` from core, pinned in `useChat.test.tsx` (the exact text sends once, one character off stays a draft); the unused `CHAT.why` and `CHAT.askWhy` templates left `guided/copy.ts` and `copy.test.ts` no longer looks for a `WATCH.askWhy` string.
- Closed in this pass: `ai/schemas.rs` and `explainer/schemas.ts` cap `ratingReason` at 120 (`explainer-schemas.json` re-emitted, the only fixture that changed; `WATCH_LIMITS.maxReasonChars` was already 120); `qa/motion.ts` `motion-watch-status` measures the crossfade on `watch_flip=act_now&watch_flip_after=1500` (the act span fades in on its first frame, the live region keeps its node); the chat walk's `chat-activity-watch-check` (`check_delay=60000`) and `chat-watch-act-now-mid-chat` (`watch_flip`) ran on port 1501, 164 shots, exit 0, no warning; `motion.ts` "every moment measured".
- Checks on this tree: `pnpm -r typecheck` clean; `pnpm -r test` core 74 files 735 passed, desktop 103 files 1179 passed; `cargo test` 432 passed, 10 ignored; `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check` clean. Still open on the watch side: `docs/DESIGN-WATCH-WINDOW.md` does not name `ChatDraftContext` or `draft_received`; `tests/ai_no_logging.rs` lists no `src/commands.rs`; `watch:open { screen: "noticed" }` still goes straight to `fishy.open`.

### Only on a real Mac

ChatGPT and Claude streaming (time to first word, the 8 s still-waiting line, a 429 arriving mid-stream, Claude Code's spawn with a watch call in flight); the password dialog's timing against the "your password" row on a fast batch; VoiceOver's reading of the one status element during a batch and a model turn (rows and headlines announced once, the transcript not re-read); the 900x600 fold with the Explain disclosure open on the live card; a `watch:open` draft arriving before the launch check-up lands; the spiral breath's CPU cost on an Intel Mac over a long Claude turn; the single-instance hand-off above, run again with no other instance alive.

The demo server on 1499 (vite pid 73389) was stopped. No git commands were run.
