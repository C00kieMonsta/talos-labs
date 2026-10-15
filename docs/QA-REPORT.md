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
