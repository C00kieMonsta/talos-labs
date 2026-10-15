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

Development happens on macOS. The collectors run only on macOS; `packages/core` and its tests run anywhere.

Prerequisites: Xcode Command Line Tools (`xcode-select --install`), rustup, Node 22, pnpm 10. Then:

```sh
pnpm install
```

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
| `pnpm desktop` | `tauri dev`: Vite on port 1420 plus a debug Rust build with hot reload |
| `pnpm --filter @talos/desktop build` | web assets only, into `apps/desktop/dist` |
| `pnpm desktop:build` | `tauri build`: release binary and bundles. See `docs/SIGNING.md` |
| `pnpm scan` | runs `talos-collect` (building it when missing), evaluates the result and prints a summary. `pnpm scan --json` prints the `ScanReport`; `pnpm scan <state.json>` evaluates a saved `SystemState` instead of running the collector |
| `cargo test` (in `apps/desktop/src-tauri`) | parser, exec and serde round-trip tests |
| `cargo test -- --ignored` | smoke and capability tests that touch the real machine |
| `cargo clippy --all-targets -- -D warnings` | the crate denies `unwrap_used`, `expect_used`, `panic` and `string_slice` and warns on `indexing_slicing`; with `-D warnings` a new index site must use `get` or carry an allow with a reason |
| `cargo run --bin talos-collect` | dev binary: runs every collector and prints the `SystemState` JSON |
| `cargo run --bin talos-collect --features debug-raw` | same, with raw command output logged for parser work |

`cargo test` needs `apps/desktop/dist` to exist, because `tauri::generate_context!()` embeds `frontendDist` at compile time. Run `pnpm --filter @talos/desktop build` once first. CI does the same.

To see a report for this machine without the UI:

```sh
pnpm scan          # summary: score, grade, findings with evidence, unavailable sections
pnpm scan --json   # the full ScanReport
```

The script runs `apps/desktop/src-tauri/target/debug/talos-collect` and builds it with `cargo build --bin talos-collect` when it is missing (`--build` forces a rebuild). Pass a file path to evaluate a saved `SystemState` JSON instead.

## Layout

```
packages/core/src/
  domain/        SystemState, Finding, Rule, ScanReport types. The contract. Change with care.
  ports/         interfaces the desktop app implements
  fixtures/      DEV_MACHINE, HARDENED, ALL_UNAVAILABLE, FRESH_INSTALL, WINDOWS_MINIMAL
  engine/        evaluate(state, catalog, ctx) -> ScanReport
  rules/macos/   one file per rule, one test per rule, index.ts exports MACOS_CATALOG
  explainer/     toExplainerContext, buildSystemPrompt, JSON schemas, output validators, limits
  license/       parseLicense, entitled, freeFixRuleIds
packages/core/fixtures/*.json   emitted; read by cargo test
apps/desktop/src/
  adapters/      Tauri-backed implementations of the ports, the explainer adapters, NoExplainer
  settings/      non-secret settings in localStorage
  license/       public-key.ts, revoked.ts
  scan/          the scan state machine
  screens/       Welcome, Scanning, Overview, Findings, Finding detail, Ask, Settings, About
apps/desktop/src-tauri/src/
  commands.rs    Tauri command surface
  exec.rs        enum Bin and run(bin, args, timeout, cancel)
  state.rs       serde mirror of SystemState
  collect/       collect_all, collect_section, macos/<section>.rs
apps/desktop/src-tauri/tests/fixtures/*.txt   verbatim command outputs for parser tests
scripts/keygen/keygen.ts   licence keygen
scripts/scan-cli.ts        collector plus engine from the terminal (pnpm scan)
```

## Adding a rule

One file per rule, one test per rule, one row in `docs/RULES.md`.

1. Create `packages/core/src/rules/macos/tl-mac-0NN.ts` exporting a `Rule` (`packages/core/src/domain/rule.ts`). Pick the next unused id; ids are never reused. `title` is a statement the reader can agree with ("Your disk is encrypted"). Set `severity`, `category`, `cis` (a section from `docs/CIS-MAP.md` or `null`), `os: ["macos"]`, `requires` (sections that must be `ok` before `evaluate` runs), `evidenceKeys` (every key the rule may emit, each matching `SAFE_STRING_PATTERN`), `evidenceVocabulary` (allowed values for every `enum` key), `explanation`, `fix` and `evaluate`.
2. `evaluate(state, ctx)` is pure. Read `state`, return a `RuleOutcome`. Compare ages against `state.collectedAt`, not `ctx.now`. Return `not_applicable` when the concept is absent, `unknown` with a nested section's reason or `indeterminate` when the data is inconclusive. Never throw on purpose; the engine turns a throw into `unknown` with `rule_error`.
3. Evidence: `bool`, `number`, `enum` and `version` may reach the explainer; `path` and `text` are local-only. An `enum` value outside the vocabulary is downgraded to `text` by the engine. A catalog test asserts no downgrade happens on the fixtures.
4. Fix: the Settings path is primary. Commands are displayed with a copy button and never run. Follow the command policy in `docs/DESIGN.md` section 3 (no `spctl --global-enable`, no `systemsetup`, no `pwpolicy -setpolicy`). A `{path}` placeholder in `args` needs `appliesTo` set to a `path`-kind evidence key of the same rule.
5. Register the rule in `packages/core/src/rules/macos/index.ts` in id order.
6. Add `tl-mac-0NN.test.ts` next to it. Table-driven: pass, fail, section unavailable gives `unknown` with that reason, every `not_applicable` branch, and `WINDOWS_MINIMAL` gives `not_applicable`. Assert status, evidence keys and evidence kinds.
7. Add the row to `docs/RULES.md`. Update "Expected results on the fixtures" and the engine test expectations if the new rule changes a fixture's outcome or score. Update the dev-machine findings snapshot.
8. If the rule cites a CIS control, add the row to `docs/CIS-MAP.md` with the mSCP rule id you verified it against.
9. Bump `MACOS_CATALOG.version`. Any change to a rule's text, severity or condition bumps it too.

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
collect_section({ key }) -> Section
cancel_scan() -> void                        the running scan rejects with "cancelled"
check_capabilities() -> { fullDiskAccess: boolean | null }
open_settings_pane({ pane }) -> void         pane is a SettingsPane string; Rust maps it to a URL
secret_get({ name }) / secret_set({ name, value }) / secret_delete({ name })
report_save_last({ report }) / report_load_last()
license_read() / license_write({ key }) / license_delete()
```

Errors are strings.

## TCC permissions in development

Two optional permissions. Denying either marks the related rule `unknown`; it never raises the score.

Full Disk Access. Needed to list Chrome, Brave, Edge and Arc extension directories (and for the capability probe). macOS attributes a command-line process to the app that launched it, so for `cargo run --bin talos-collect` and `pnpm desktop` grant Full Disk Access to the terminal you run them from (Terminal, iTerm2, or your editor) under System Settings > Privacy & Security > Full Disk Access. For a built `.app`, grant it to the app itself. Without it, the `browsers` section reports `needs_full_disk_access` for Chrome-family browsers and rule 028 is `unknown`. That is the expected dev-machine fixture outcome.

Automation. The login-items collector asks System Events for the list of login items through `osascript`. The first run prompts "Terminal would like to control System Events". Approve it. A denial gives error -1743, which the collector maps to `needs_automation_permission`. If the prompt is left unanswered, `osascript` is killed after 45 s and the section is `timeout` with detail `osascript: no answer to the Automation prompt`. Manage it under Privacy & Security > Automation. The built app needs `NSAppleEventsUsageDescription` in its `Info.plist` (`apps/desktop/src-tauri/Info.plist`), otherwise macOS denies without prompting.

To test the denied paths again:

```sh
tccutil reset SystemPolicyAllFiles com.apple.Terminal
tccutil reset AppleEvents com.apple.Terminal
```

Use `ai.taloslabs.desktop` instead of `com.apple.Terminal` for the app bundle.

Grants are tied to the code signature. An unsigned dev build may lose its grants after a rebuild, which is why granting them to the terminal is easier during development.

## Network sections in development builds

On macOS 27.0.1, `netstat -anv -p tcp` run from an ad-hoc signed binary (a `cargo build` output, `pnpm desktop`, an unsigned CI build) returns an empty socket table, while the same command from a shell or a Developer ID signed process lists every listener. The `listeners` section is then `permission_denied` with detail `netstat: empty socket table`, `remoteAccess` and `fileSharing` carry `shared: listeners`, and rules 018 to 022 show as Couldn't check. Reproduce with `./target/debug/talos-collect --section listeners` next to `/usr/sbin/netstat -anv -p tcp | grep -c LISTEN` in the same shell. A Developer ID signed build is expected to fix it; that has not been verified, so check these three sections on the first signed build.
