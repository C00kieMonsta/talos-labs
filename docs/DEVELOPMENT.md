# Development

## Toolchain

| Tool | Version |
|---|---|
| Node | 22.18 |
| pnpm | 10.20, pinned by `packageManager` in the root `package.json` |
| Rust | 1.99 stable, via rustup |
| Tauri | 2.12 (`@tauri-apps/cli` 2.12.3) |
| React | 19 |
| TypeScript | 6.0, strict |
| Vite | 8 |
| vitest | 3 |
| Swift | 6.3, `xcrun swiftc` from the Xcode Command Line Tools, with a macOS 26 or later SDK (FoundationModels) |

Development happens on macOS. The collectors run only on macOS; `packages/core` and its tests run anywhere.

Prerequisites: Xcode Command Line Tools (`xcode-select --install`) on macOS 26 or later, rustup, Node 22, pnpm 10. Then:

```sh
pnpm install
pnpm --filter @talos/desktop sidecar:build
```

The second command builds the `talos-ai` helper (see "Sidecar build" below). `tauri dev` and `tauri build` fail without the files it writes.

Never run `pnpm add` in a package to pull a dependency into the app without checking `docs/SECURITY-MODEL.md`; the webview has no filesystem or shell access by design, and every dependency ships to users.

## Commands

Run from the repo root unless noted.

| Command | What it does |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` in every package |
| `pnpm test` | `vitest run` in every package |
| `pnpm --filter @talos/core test` | core tests only; `test:watch` for watch mode |
| `pnpm --filter @talos/desktop test` | desktop tests (jsdom) |
| `pnpm --filter @talos/core fixtures:emit` | writes every TypeScript fixture to `packages/core/fixtures/*.json` for the Rust contract test |
| `pnpm --filter @talos/desktop sidecar:build` | runs `apps/desktop/sidecar/build.sh`: compiles the Swift helper for both architectures and writes three files into `src-tauri/binaries/`. Run it once after cloning and again after any change under `sidecar/` |
| `pnpm desktop` | `tauri dev`: Vite on port 1420 plus a debug Rust build with hot reload |
| `pnpm --filter @talos/desktop build` | web assets only, into `apps/desktop/dist` |
| `pnpm --filter @talos/desktop dev:demo` | the web build in demo mode on port 1430: fixture-backed adapters, runs in a plain browser. See below |
| `pnpm desktop:build` | `tauri build`: release binary and bundles. See `docs/SIGNING.md` |
| `pnpm scan` | runs `talos-collect` (building it when missing), evaluates the result and prints a summary. `pnpm scan --json` prints the `ScanReport`; `pnpm scan <state.json>` evaluates a saved `SystemState` instead of running the collector |
| `cargo test` (in `apps/desktop/src-tauri`) | parser, exec, serde round-trip, fix catalog, quoting, plan, privileged-output, batch script and marker, and sidecar protocol tests. Nothing in the default set changes a setting or shows a dialog; the batch script round-trips through `/bin/sh -c` with `echo` and `false` as the programs |
| `cargo test -- --ignored` | smoke and capability tests that touch the real machine (the Automation probe, the real `ssh-keygen -p` on a temp key) |
| `cargo clippy --all-targets -- -D warnings` | the crate denies `unwrap_used`, `expect_used`, `panic` and `string_slice` and warns on `indexing_slicing`; with `-D warnings` a new index site must use `get` or carry an allow with a reason |
| `cargo run --bin talos-collect` | dev binary: runs every collector and prints the `SystemState` JSON |
| `cargo run --bin talos-collect --features debug-raw` | same, with raw command output logged for parser work |
| `pnpm exec tsx scripts/gen-icons.ts` (in `apps/desktop`) | turns `brand/mineral/icons/*.svg` into `src/components/icons/<Name>Icon.tsx`, `SpiralMark.tsx` and `index.ts`. Generated files; never edit them by hand |
| `pnpm exec tsx scripts/contrast.ts` (in `apps/desktop`) | measures the token pairs in `src/styles/tokens.css`, rewrites `src/styles/CONTRAST.md` and exits non-zero when a pair fails AA |
| `cargo run --bin talos-fixes` | prints `FIX_CATALOG` as JSON: rule, lines with placeholders, privilege, recheck, and from v0.3 `batchable`. Used by the contract test and when updating `docs/RULES.md`. Runs nothing |

`cargo test` needs `apps/desktop/dist` to exist, because `tauri::generate_context!()` embeds `frontendDist` at compile time. Run `pnpm --filter @talos/desktop build` once first. CI does the same.

To see a report for this machine without the UI:

```sh
pnpm scan          # summary: score, grade, findings with evidence, unavailable sections
pnpm scan --json   # the full ScanReport
```

The script runs `apps/desktop/src-tauri/target/debug/talos-collect` and builds it with `cargo build --bin talos-collect` when it is missing (`--build` forces a rebuild). Pass a file path to evaluate a saved `SystemState` JSON instead.

## Sidecar build

AI explanations run in `talos-ai`, a Swift command-line tool under `apps/desktop/sidecar/talos-ai/Sources/` that links FoundationModels and speaks JSON lines on stdin and stdout. Rust spawns it; the webview never sees it. `apps/desktop/sidecar/build.sh` compiles it with `xcrun swiftc -O` twice, once per target triple, then merges the two with `lipo`:

```
apps/desktop/src-tauri/binaries/talos-ai-aarch64-apple-darwin
apps/desktop/src-tauri/binaries/talos-ai-x86_64-apple-darwin
apps/desktop/src-tauri/binaries/talos-ai-universal-apple-darwin
```

`tauri.conf.json` lists `binaries/talos-ai` under `bundle.externalBin`. `tauri dev` and a plain `tauri build` pick the host-triple file; `tauri build --target universal-apple-darwin` (CI and releases) picks the `lipo` output. The entry file is `Sources/main.swift` with top-level code; do not add `-parse-as-library` or `@main`. The same source builds for both triples because the macOS SDK ships an x86_64 interface for FoundationModels. Details, the protocol and the Rust side are in DESIGN-V02.md section 4.

The three output files are build artefacts, not source; do not commit them. CI runs `pnpm --filter @talos/desktop sidecar:build` before any cargo step. CI runners have no Apple Intelligence, so nothing in `cargo test` or `pnpm test` talks to the real helper; the protocol tests use a fake sidecar binary. Running the helper for real is on the "Only on a real Mac" list below.

## Demo mode and QA harness

The web build can run in a plain browser with every port backed by a core fixture, so the UI can be driven by a script without the Tauri window. `apps/desktop/src/adapters/demo.ts` holds the adapters; `apps/desktop/src/app/demo-boot.ts` reads the options from the page URL (`fixture`, `delay`, `pace`, `explainer`, `reset`, `provider`, `dev`, `onboarded`, `licensed`, `fix`, `fix_delay`, `fail`, `ai`, `ai_ready`, `fda_after`, `automation`, `poll_after`, and from v0.3 `batch`, `scan_error`, `guided`, `memory`, `since`, `continue`, `watch_after`, `technical`). The fix port, the Apple explainer, the buy page and restart are faked and recorded on `window.__talosDemoCalls`; nothing is applied.

```sh
cd apps/desktop
pnpm dev:demo                                                   # http://localhost:1430/?reset=1
pnpm exec tsx qa/snap.ts --port 1430 --out qa/screenshots/mine  # screenshots, light and dark, two sizes
pnpm exec tsx qa/axe.ts --port 1430                             # axe-core, exits 1 on serious or critical
```

The v0.3 harness walks the guided check-up as well: every `guided-*` shot from DESIGN-V03.md section 7 "Harness", in both schemes and both sizes, with axe on all of them, plus the assertions listed there (one primary button per step, the 6 s floor, the progress total never shrinking, the recorded `fixPreviewBatch` and `fixApplyBatch` calls). The v0.2 walk runs unchanged with `guided=0`.

Both scripts start the server when nothing answers on the port and stop it afterwards. Demo mode is only reachable when Vite runs with `VITE_TALOS_DEMO=1`; `tauri dev` and `tauri build` refuse that variable (`apps/desktop/vite.config.ts`), and the production bundle carries no demo code. Details and the URL parameters are in `apps/desktop/qa/README.md`; the security note is in `docs/SECURITY-MODEL.md`.

## Brand assets and icons

The visual source is the Mineral kit (`docs/DESIGN-MINERAL.md`). The app reads only from `apps/desktop/brand/mineral/`; nothing imports from the kit folder.

To add a kit icon: copy the 24 x 24 `currentColor` SVG from `Talos-Labs-Mineral-Design-Kit-v1/icons/svg/` into `apps/desktop/brand/mineral/icons/<slug>.svg`, run `pnpm exec tsx scripts/gen-icons.ts` from `apps/desktop`, then import `<Slug>Icon` from `src/components/icons` and register it in `src/app/icons.ts` (`ICONS`, `SECTION_ICONS`, or whichever map it belongs to). Render it through `<Icon icon={...} />` from `src/components/Icon.tsx`; do not use the SVG directly. Fall back to lucide only when the kit has no glyph, and add the name to `LUCIDE_NAMES` in `icons.ts` so the export test covers it.

The app icon set in `src-tauri/icons/` is generated by `pnpm tauri icon brand/mineral/app-icon/icon-1024.png` from `apps/desktop`; `brand/mineral/app-icon/Talos-Labs.icns` then overwrites the generated `icon.icns`. The DMG background lives at `apps/desktop/src-tauri/assets/dmg-background.png` (copied from `brand/mineral/installer/dmg-background.png`) and is named by `bundle.macOS.dmg.background` in `tauri.conf.json` (see `docs/SIGNING.md`).

## Layout

```
packages/core/src/
  domain/        SystemState, Finding, Rule, ScanReport types. The contract. Change with care.
  ports/         interfaces the desktop app implements
  fixtures/      DEV_MACHINE, HARDENED, ALL_UNAVAILABLE, FRESH_INSTALL, WINDOWS_MINIMAL
  engine/        evaluate(state, catalog, ctx) -> ScanReport
  rules/macos/   one file per rule, one test per rule, index.ts exports MACOS_CATALOG
  explainer/     toExplainerContext, buildSystemPrompt, on-device-prompt (ON_DEVICE_LIMITS, buildOnDevicePrompt), JSON schemas, output validators, limits
  license/       parseLicense, entitled, freeFixRuleIds
  guided/        plan.ts: buildGuidedPlan, planLocked, diffReports, GuidedMemory, parseGuidedMemory (v0.3); pure
packages/core/fixtures/*.json   emitted; read by cargo test
apps/desktop/src/
  adapters/      Tauri-backed implementations of the ports (system state, fixes, licence, secrets, reports), the explainer adapters (Apple, Claude, Ollama), demo adapters
  settings/      non-secret settings in localStorage
  license/       public-key.ts, revoked.ts
  scan/          the scan state machine
  guided/        useGuided (phases and timers), memory.ts (talos.guided), continue.ts (talos.continue), copy.ts, the step components (v0.3)
  screens/       Guided (v0.3 home), Welcome, Scanning, Overview, Findings, Finding detail, Ask, Settings (About is its last section)
apps/desktop/qa/    snap.ts and axe.ts, browser QA against the demo build (see above)
apps/desktop/brand/mineral/   icons, logos, app icon and DMG background copied from the Mineral kit
apps/desktop/scripts/         gen-icons.ts (kit SVG to React), contrast.ts (CONTRAST.md)
apps/desktop/src/components/icons/   generated kit icon components; do not edit
apps/desktop/src-tauri/assets/dmg-background.png   the installer background
apps/desktop/sidecar/
  build.sh       xcrun swiftc for both triples, then lipo
  talos-ai/      Swift sources of the on-device AI helper
apps/desktop/src-tauri/src/
  commands.rs    Tauri command surface
  exec.rs        enum Bin and run(bin, args, timeout, cancel); collectors only, no fix binary
  state.rs       serde mirror of SystemState
  collect/       collect_all, collect_section, macos/<section>.rs
  fix/           catalog.rs (FIX_CATALOG, FixBin, batchable), inputs.rs, plan.rs, privileged.rs (osascript), batch.rs (v0.3), pty.rs (ssh-keygen -p), reveal.rs
  ai/            sidecar.rs (spawn, idle kill, cancel), protocol.rs (JSON lines)
  automation.rs  AEDeterminePermissionToAutomateTarget probe
  menu.rs        app menu
  bin/talos-fixes.rs   prints FIX_CATALOG as JSON
apps/desktop/src-tauri/tests/fixtures/*.txt   verbatim command outputs for parser tests
scripts/keygen/keygen.ts   licence keygen
scripts/scan-cli.ts        collector plus engine from the terminal (pnpm scan)
```

## Adding a rule

One file per rule, one test per rule, one row in `docs/RULES.md`.

1. Create `packages/core/src/rules/macos/tl-mac-0NN.ts` exporting a `Rule` (`packages/core/src/domain/rule.ts`). Pick the next unused id; ids are never reused. `title` is a statement the reader can agree with ("Your disk is encrypted"). Set `severity`, `category`, `cis` (a section from `docs/CIS-MAP.md` or `null`), `os: ["macos"]`, `requires` (sections that must be `ok` before `evaluate` runs), `evidenceKeys` (every key the rule may emit, each matching `SAFE_STRING_PATTERN`), `evidenceVocabulary` (allowed values for every `enum` key), `explanation`, `fix`, `guided` (see "Guided strings" below) and `evaluate`.
2. `evaluate(state, ctx)` is pure. Read `state`, return a `RuleOutcome`. Compare ages against `state.collectedAt`, not `ctx.now`. Return `not_applicable` when the concept is absent, `unknown` with a nested section's reason or `indeterminate` when the data is inconclusive. Never throw on purpose; the engine turns a throw into `unknown` with `rule_error`.
3. Evidence: `bool`, `number`, `enum` and `version` may reach the explainer; `path` and `text` are local-only. An `enum` value outside the vocabulary is downgraded to `text` by the engine. A catalog test asserts no downgrade happens on the fixtures.
4. Fix: the Settings path is primary. Commands are displayed with a copy button when Developer mode shows them. Follow the command policy in `docs/DESIGN.md` section 3 (no `spctl --global-enable`, no `systemsetup`, no `pwpolicy -setpolicy`). A `{path}` placeholder in `args` needs `appliesTo` set to a `path`-kind evidence key of the same rule. Every rule also carries `fix.apply` (`FixApply` in `packages/core/src/domain/finding.ts`): `in_app`, `deep_link` or `manual`. Start with `manual` or `deep_link`; an `in_app` entry follows "Adding an in-app fix" below.
5. Register the rule in `packages/core/src/rules/macos/index.ts` in id order.
6. Add `tl-mac-0NN.test.ts` next to it. Table-driven: pass, fail, section unavailable gives `unknown` with that reason, every `not_applicable` branch, and `WINDOWS_MINIMAL` gives `not_applicable`. Assert status, evidence keys and evidence kinds.
7. Add the row to `docs/RULES.md`. Update "Expected results on the fixtures" and the engine test expectations if the new rule changes a fixture's outcome or score. Update the dev-machine findings snapshot.
8. If the rule cites a CIS control, add the row to `docs/CIS-MAP.md` with the mSCP rule id you verified it against.
9. Bump `MACOS_CATALOG.version`. Any change to a rule's text, severity or condition bumps it too.

### Guided strings

Every rule carries `guided: GuidedStrings` (`packages/core/src/domain/rule.ts`): `headline`, `why`, `verb`, `done` and `where`. They are the only words the guided check-up shows for a rule, and the catalog test enforces the shape, so write them against DESIGN-V03.md section 6 rather than from memory:

- `headline`: the problem, no trailing stop, at most 60 characters. `why`: one sentence, at most 110 characters, ends with a stop. `done`: starts with "Done." `where`: non-null exactly when `fix.apply.kind` is `deep_link`, and says what to do on the opened page.
- `verb`: at most 22 characters; "Show me where" for every `deep_link` rule and "Details" for every `manual` rule, both exactly.
- No banned word, matched as a whole word: finding, findings, severity, CIS, rule, rules, policy, configuration, SSH, launchd, plist, daemon, sudo, Terminal, TCC, stealth, sysadminctl, command, points. macOS's own labels (FileVault, Remote Login, Time Machine) are allowed.
- `headline` and `why` pass the syllable ceiling of 1.6 with the counter fixed in section 6. Run the core test; it names the string that fails.

The table in section 6 is the source for all 31 rules. The fixed strings of the flow itself (welcome, plan sentences, status lines, the end states) live in `apps/desktop/src/guided/copy.ts` under the same banned-word test. Whether a rule becomes a step at all is decided by `buildGuidedPlan`, not by its strings: `LEFT_ALONE` in `packages/core/src/guided/plan.ts` lists the rules that only ever appear on the end screen.

## Adding an in-app fix

An in-app fix is a row in two tables that must agree, and a contract test that proves they do. Nothing in the UI can run a command that is not in the Rust table. Full shapes are in DESIGN-V02.md section 5 and section 8.

1. Core. Set the rule's `fix.apply` to an `in_app` entry: `choice` (`none`, `share`, `ssh_key` or `all_ssh_keys`), `passphrase`, `needsPassword`, `recheck` (a subset of `requires` plus the sections the commands change; 019 to 022 add `listeners`), `confirmTitle` (a question, "Turn the firewall on?"), `confirmVerb` ("Turn on"), `confirmNote` and `reversible` (one line or `null`). The catalog test in `packages/core` checks these constraints.
2. Rust. Add the entry to `FIX_CATALOG` in `apps/desktop/src-tauri/src/fix/catalog.rs`: the same rule id, the steps as `FixBin` (an absolute program path added to that enum, never to `exec.rs`) plus `Arg::Lit` literals or the placeholder kinds that `inputs.rs` validates, the privilege of each step, and the same `recheck`. Literal arguments must match the literal pattern; `cargo test` checks every one.
3. Contract test. Run `pnpm --filter @talos/core fixtures:emit` to refresh `packages/core/fixtures/fix-catalog.json` (one entry per rule with `kind`, `choice`, `passphrase`, `needsPassword`, `recheck`, `pane`, `watch` and, from v0.3, `batchable`), then `cargo test`. The Rust test asserts `FIX_CATALOG` lists exactly the `in_app` rules with the same `choice`, `needsPassword`, `recheck` and `batchable`. `cargo run --bin talos-fixes` prints the Rust table, `batchable` included, for the TypeScript side of the same test; update its snapshot when the table changes. `batchable` is derived on both sides, never set by hand: true when the choice is `none` or `all_ssh_keys` and there is no passphrase. A new row that takes a path or a secret is excluded from batches by construction; a new row that takes neither joins them, so check its admin command is happy to run silenced inside a subshell (DESIGN-V03.md section 3).
4. `docs/RULES.md`. Update the rule's row: fix kind, the commands as `talos-fixes` prints them, and the reversing line.
5. Tests for the commands: a stub program for the pty path, a stderr fixture for the privileged path if the command can fail in a new way. Never apply the fix on your own Mac from a test; the real-machine check is on the "Only on a real Mac" list.

Admin steps go through one `osascript` `do shell script ... with administrator privileges` per plan, built only from the plan and quoted by `sh_quote` and `as_quote`. The passphrase for 029 goes through a pty, never an argument. Both are in DESIGN-V02.md section 5, "Privilege path".

## The guided plan

The check-up is a pure function over the report. `buildGuidedPlan(report, gate, profile, memory, now)` in `packages/core/src/guided/plan.ts` returns the ordered steps (one batch, single fixes, show-me-where steps, the permission step, the paywall) and the end-screen lists; `planLocked` plans the rules a licence key unlocks; `diffReports` computes "since last time"; `parseGuidedMemory` reads `talos.guided` field by field. None of it touches the OS, the clock or storage, and the same inputs give the same plan, so the expected plans for every fixture are plain assertions in `plan.test.ts` (DESIGN-V03.md section 8 lists them). Ordering, snoozes, the frozen free set and the step shapes are in DESIGN-V03.md sections 1, 4 and 7; change them there first.

The desktop side (`apps/desktop/src/guided/useGuided.ts`) owns only phase transitions, memory writes and timers. It sits on `useScan` and calls `previewBatch`, `applyBatch`, `previewFix`, `applyFix` and `startWatch`; it has no fixing logic of its own. The plan is rebuilt from the latest report after every recheck with the frozen `freeFixes`, and the current step is found again by id, so a fix made on the expert screens is seen by the guide on return.

## Adding a collector section

A section is a change to the contract on both sides. Do it in this order.

1. Core types. In `packages/core/src/domain/system-state.ts`, add the data interface and a `Section<T>` field to `SystemStateSections`, and append the key to `SECTION_KEYS`. Values are booleans, enums, counts, versions, ports, process names and config paths. Mark display-only strings with a comment. Use `null` for a concept absent on another OS, `Tri` for a setting whose absence means the OS default.
2. Update every fixture in `packages/core/src/fixtures/` and the `assertSystemState` guard. `all-unavailable` must carry the new section as `unavailable`; `windows-minimal` as `not_supported_on_os` unless Windows has the concept.
3. Rust mirror. Add the struct to `apps/desktop/src-tauri/src/state.rs` with `#[serde(rename_all = "camelCase")]`. Field names and nullability must match the TypeScript exactly.
4. Collector. Create `collect/macos/<name>.rs` with one `collect() -> Section<T>` and one or more pure `parse_*(&str) -> Result<T, ParseError>` functions with no I/O. If a new binary is needed, add it to `enum Bin` in `exec.rs` with its absolute path, verified on the machine. Map every error to an `UnavailableReason` using the table in `docs/DESIGN.md` section 8. Never return command output in `detail`.
5. Register the module in `collect/mod.rs` so `collect_all` and `collect_section` know it, and emit the `scan:progress` event for it.
6. Capture real output into `apps/desktop/src-tauri/tests/fixtures/<name>.txt`, verbatim, and write parser tests for every output variant including the failures.
7. Run `pnpm --filter @talos/core fixtures:emit` then `cargo test`. The round-trip test now covers the new section.
8. UI: add the progress label for the Scanning screen and, if the section can be `needs_full_disk_access` or `needs_automation_permission`, the permission mapping for the "Couldn't check" group.
9. Then write the rules that read it.

## The contract between Rust and core

The shape is `SystemState` in `packages/core/src/domain/system-state.ts`. Rust is a mirror, not a source.

- JSON keys are camelCase, exactly as in the TypeScript.
- `Section<T>` is `{ "status": "ok", "data": ... }` or `{ "status": "unavailable", "reason": ..., "detail": string | null }`. `reason` is one of the nine `UnavailableReason` strings.
- `SECTION_KEYS` is the order for the progress UI, the fixtures and the Rust contract test.
- The TypeScript fixtures are the source. `pnpm --filter @talos/core fixtures:emit` writes them to `packages/core/fixtures/*.json`. `cargo test` deserialises every file into `state::SystemState` and re-serialises; the result must equal the input after key sorting. A field added on one side only fails this test.
- On the way in, `assertSystemState` (`packages/core/src/domain/system-state.guard.ts`) checks the JSON before it enters core. A missing section or an unknown reason fails the scan with `schema_mismatch` rather than reaching a rule.

Tauri commands. The Rust side defines them, the TypeScript side calls them with `invoke` from `@tauri-apps/api/core`. Argument names are single lowercase words so Tauri's camelCase conversion cannot bite.

```
collect_system_state() -> SystemState        emits "scan:progress" { key, status: "started" | "ok" | "unavailable" }
collect_section({ key }) -> Section          rejects with "cancelled"
cancel_scan() -> void                        the running scan and recheck reject with "cancelled"
cancel_section() -> void                     the running recheck rejects with "cancelled"; the scan goes on
check_capabilities() -> { fullDiskAccess: boolean | null, automation: "granted" | "denied" | "not_determined" | null }
open_settings_pane({ pane }) -> void         pane is a SettingsPane string (now including "apple_intelligence"); Rust maps it to a URL
fix_preview({ rule, choice }) -> FixPlan     builds and stores a plan for 5 min; rejects with not_in_catalog, invalid_choice or invalid_input
fix_apply({ plan, passphrase? }) -> FixOutcome   emits "fix:status" { planId, phase, step, of }; see below for the two error channels
fix_preview_batch({ rules }) -> BatchPlanWire   v0.3: one plan for several batchable rules; rejects with invalid_choice or not_in_catalog; stored for 5 min
fix_apply_batch({ plan }) -> BatchOutcome    v0.3: one dialog for the admin items, then the user-level items; rejects plan_expired or busy; "fix:status" carries item for the user-level phase
fix_cancel({ plan }) -> void                 kills the running child; the osascript dialog closes with it; works on a batch id
fix_reveal({ rule, choice }) -> void         Finder reveal for 023, 024 and 031 after the same validation
open_buy_page() -> void                      fixed URL chosen in Rust
app_restart() -> void                        AppHandle::restart, for the Full Disk Access continuation
ai_availability({ fresh }) -> AiAvailability
ai_generate({ request }) -> void             emits "ai:stream" events; see DESIGN-V02.md section 4
ai_cancel({ id }) -> void
secret_get({ name }) / secret_set({ name, value }) / secret_delete({ name })
report_save_last({ report }) / report_load_last()
license_read() / license_write({ key }) / license_delete()
```

Errors are strings. `fix_apply` has two failure channels: errors found before anything runs (`plan_expired`, `not_in_catalog`, `invalid_choice`, `invalid_input`, `busy`, `precondition_changed`) reject the invoke with the `FixError` string; errors from the run itself (`cancelled`, `wrong_password`, `command_failed`, `timeout`) resolve with `{ ok: false, error, step }`. The `TauriFixAdapter` folds both into one `FixOutcome`. Only one plan runs at a time.

The v0.1 browser assistant command is gone. The fix and AI contracts, the `FixChoice` wire shape and the `ai:stream` event are in DESIGN-V02.md sections 4, 5 and 8. The batch wire shapes (`BatchPlanWire`, `BatchOutcome`) and the `item` field are in DESIGN-V03.md section 3.

## TCC permissions in development

Two optional permissions. Denying either marks the related rule `unknown`; it never raises the score.

Full Disk Access. Needed to list Chrome, Brave, Edge, Arc and Firefox extension directories (and for the capability probe). macOS attributes a command-line process to the app that launched it, so for `cargo run --bin talos-collect` and `pnpm desktop` grant Full Disk Access to the terminal you run them from (Terminal, iTerm2, or your editor) under System Settings > Privacy & Security > Full Disk Access. For a built `.app`, grant it to the app itself. Without it, the `browsers` section reports `needs_full_disk_access` for Chrome-family browsers and Firefox, and rule 028 is `unknown`. That is the expected dev-machine fixture outcome.

Automation. The login-items collector asks System Events for the list of login items through `osascript`. The first run prompts "Terminal would like to control System Events". Approve it. A denial gives error -1743, which the collector maps to `needs_automation_permission`. If the prompt is left unanswered, `osascript` is killed after 45 s and the section is `timeout` with detail `osascript: no answer to the Automation prompt`. Manage it under Privacy & Security > Automation. The built app needs `NSAppleEventsUsageDescription` in its `Info.plist` (`apps/desktop/src-tauri/Info.plist`), otherwise macOS denies without prompting.

To test the denied paths again:

```sh
tccutil reset SystemPolicyAllFiles com.apple.Terminal
tccutil reset AppleEvents com.apple.Terminal
```

Use `si.taloslabs.desktop` instead of `com.apple.Terminal` for the app bundle.

The app also probes the Automation grant without prompting (`automation.rs`, `AEDeterminePermissionToAutomateTarget` against System Events) so the permission card can tell "not asked yet" from "denied". When System Events is not running the probe answers `null` and the collector result is used instead. The flow is in DESIGN-V02.md section 6.

Apple Intelligence is a third, optional dependency for the AI card only. The helper reports `device_not_eligible`, `apple_intelligence_not_enabled`, `model_not_ready` or `available`; the card has copy for each and a button that opens the Apple Intelligence pane. Developer builds with the model still downloading see `model_not_ready`; that is expected.

Grants are tied to the code signature. An unsigned dev build may lose its grants after a rebuild, which is why granting them to the terminal is easier during development.

## Network sections in development builds

On macOS 27.0.1, `netstat -anv -p tcp` run from an ad-hoc signed binary (a `cargo build` output, `pnpm desktop`, an unsigned CI build) returns an empty socket table, while the same command from a shell or a Developer ID signed process lists every listener. The `listeners` section is then `permission_denied` with detail `netstat: empty socket table`, `remoteAccess` and `fileSharing` carry `shared: listeners`, and rules 018 to 022 show as Couldn't check. Reproduce with `./target/debug/talos-collect --section listeners` next to `/usr/sbin/netstat -anv -p tcp | grep -c LISTEN` in the same shell. A Developer ID signed build is expected to fix it; that has not been verified, so check these three sections on the first signed build. The same limit means the in-app fixes for rules 019 to 022 cannot be seen to pass under `pnpm desktop`: the recheck after Apply comes back `unreadable`. The demo build fakes those rechecks, which is why the QA harness runs against it.

## Only on a real Mac

These cannot be covered by `pnpm test`, `cargo test` or the demo build. Check them by hand on a Mac before a release, and never from a test that runs on your own machine without meaning to. The full list is DESIGN-V02.md section 9, "Only on a real Mac".

- Window chrome: the vibrancy sidebar, traffic-light placement, drag region and inactive state; the Cmd+, menu item.
- The native administrator dialog: its prompt text, the cancel code, and the error number after three wrong passwords (recorded into the `privileged.rs` fixtures). `fix_cancel` closing the dialog.
- Each admin command in `FIX_CATALOG` applied and rechecked, including `launchctl bootout` exit 3 as root, and `sharing -e` on a real share.
- The pty path with real `ssh-keygen -p` on OpenSSH, PEM and PKCS#8 keys.
- The Full Disk Access grant, the Quit & Reopen prompt from System Settings, and the relaunch continuation. `AEDeterminePermissionToAutomateTarget` before and after granting Automation.
- The four FoundationModels availability states, guided generation output shape, the real context-window limit, guardrail refusals, and the Apple Intelligence settings URL.
- Sidecar signing and notarisation; the signed-build socket table; `reveal_item_in_dir` on hidden dotfiles.

Added by v0.3 (DESIGN-V03.md section 8, "Only on a real Mac"):

- The batch script under `do shell script with administrator privileges`: whether `without altering line endings` is honoured, whether the `R` marker lines come back in order when every command is silenced, and the exact stderr for cancel and wrong password on a multi-line script (expected unchanged from v0.2, not proven).
- Each admin fix inside a batch, including `launchctl bootout` exit 3 as root. `fix_cancel` during the dialog on a batch, confirming nothing ran.
- The FileVault watcher: whether `fdesetup status` reads On before encryption finishes, and whether turning FileVault on from Settings asks for a logout on macOS 27 (unknown; the step copy says "may restart").
- The pending-update restart and `pendingRestart` clearing on the next launch. The 10 min watcher cap with System Settings still open.
- The Full Disk Access "Quit & Reopen" path landing back in the guide with `talos.continue` written at open time.
- VoiceOver reading of the status region and the auto-advance announcement.
- The unsigned-build socket table still makes 019 to 022 rechecks `unreadable` under `tauri dev`, so a batch holding them shows the "could not check it" row on a dev build; the pass state needs a signed build.
