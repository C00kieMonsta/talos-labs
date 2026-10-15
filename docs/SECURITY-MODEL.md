# Security model

Talos Labs reads security settings and shows them with a fix. It never changes anything. This document lists the boundaries, what crosses each one, and what the app never does.

## Three boundaries

1. Collectors (Rust, `apps/desktop/src-tauri/src/collect/`). Run allow-listed binaries with no shell, read-only, without root. Output: a `SystemState` of booleans, enums, counts, versions, ports, process names and config paths. A collector failure becomes `{ status: "unavailable", reason, detail }` with one of nine fixed reasons; `detail` is a label written by our code ("parser: netstat"), never command output.
2. Rule engine (`packages/core`). Pure TypeScript. No OS, no network, no LLM. Same input, same output.
3. Explainer (`packages/core/src/explainer/` plus the desktop adapters). Receives a derived document whose only strings are rule ids, enum values from the catalog vocabulary and regex-validated versions. No string that originated on the machine reaches a model.

## Boundary 1: collectors

### Exec allow-list

`exec.rs` holds `enum Bin`. An unknown binary cannot be represented by type. Absolute paths, verified on macOS 27.

| Bin | Path | Used for |
|---|---|---|
| Fdesetup | `/usr/bin/fdesetup` | FileVault status |
| Socketfilterfw | `/usr/libexec/ApplicationFirewall/socketfilterfw` | firewall state |
| Spctl | `/usr/sbin/spctl` | Gatekeeper |
| Csrutil | `/usr/bin/csrutil` | SIP |
| SwVers | `/usr/bin/sw_vers` | OS version |
| Defaults | `/usr/bin/defaults` | preference domains, including Time Machine `Destinations` (only `SnapshotDates` is kept) |
| Sysadminctl | `/usr/sbin/sysadminctl` | screen lock |
| Dscl | `/usr/bin/dscl` | admin group membership, user id list (`-list /Users UniqueID`) |
| Whoami | `/usr/bin/whoami` | current user, compared and discarded |
| Netstat | `/usr/sbin/netstat` | listening ports |
| Sharing | `/usr/sbin/sharing` | share points |
| Launchctl | `/bin/launchctl` | service override list |
| Tmutil | `/usr/bin/tmutil` | backups |
| Osascript | `/usr/bin/osascript` | login items, one fixed script |
| Pwpolicy | `/usr/bin/pwpolicy` | password policy |

`systemsetup` and `sfltool` are absent on purpose: one needs root, the other hangs without it.

### How a command runs

- `std::process::Command::new(path)` with an explicit `args` slice. No shell, no `sh -c`, no string interpolation.
- `env_clear()`, then `PATH=/usr/bin:/bin:/usr/sbin:/sbin` and `LANG=C`.
- `stdin` is null. stdout and stderr are captured separately. Output is capped at 1 MiB, decoded as lossy UTF-8.
- Timeout 5 s per command, 45 s for `osascript` (the first-run Automation prompt blocks it until the user answers). The child is killed on expiry.
- Panics unwind: `collect::guarded` catches a collector panic and records that section as `unavailable` with `collector_error`, so a bug costs one section, not the scan. The crate also denies `clippy::unwrap_used`, `expect_used`, `panic` and `string_slice` and warns on `indexing_slicing`; every collector returns `Result`, and the section boundary maps every `Err` to `unavailable`.
- Raw command output is never logged in release builds. The `debug-raw` cargo feature enables it for development only.
- The cancel flag is checked before every spawn and polled every 200 ms while a child runs; on cancel the child is killed, so a cancelled scan ends within a fraction of a second.

### Files the collectors open

- launchd plists in `~/Library/LaunchAgents`, `/Library/LaunchAgents` and `/Library/LaunchDaemons`: label, program path (first of `Program` or `ProgramArguments`), `RunAtLoad`; a plist with neither is skipped. Arguments are never read.
- `~/.ssh`: directory and file modes, and the first 4 KiB of each key to classify the header. Key bytes never leave the function. `ssh-keygen` is never invoked.
- A fixed list of dotfiles (`~/.zshrc ~/.bashrc ~/.zprofile ~/.profile ~/.env ~/.npmrc ~/.netrc ~/.aws/credentials ~/.docker/config.json`), each capped at 1 MiB, matched line by line against a `RegexSet`. A hit stores the path, the pattern name and the line number, never the matched text. `$VAR` references do not match.
- Browser extension manifests: `name`, `version`, `permissions`, `host_permissions`, `content_scripts[].matches` and `default_locale`, plus `_locales/<locale>/messages.json` to resolve a `__MSG_key__` name. Chrome-family `Preferences` and `Secure Preferences`: only `extensions.settings.<id>.state`, to skip disabled extensions. Firefox `profiles.ini` and `extensions.json`. Chrome-family and Firefox profile directories are TCC-protected and need Full Disk Access.
- The app bundles of Chrome, Brave, Edge, Arc and Firefox under `/Applications` and `~/Applications`: metadata only, to decide whether a browser is installed.
- The XProtect bundle `Info.plist`, for its version.
- `/Library/Application Support/Apple/Remote Desktop/RemoteManagement.launchd`: existence only.

Never collected as values: the current user's name (read from `whoami`, compared with the admin group and discarded), the hostname, the user-authored `name:` of share points, launchd arguments, file contents outside the exceptions above, secret values, user document names. The account name does appear inside home-directory paths (`/Users/<name>/.ssh/id_ed25519`, dotfiles, user launch agents, shared folders); those are `path` fields, shown locally and stored in the last report, and never sent to the explainer.

### Permissions

No root. The app never asks for a password. Two TCC permissions are optional: Full Disk Access (Chrome-family and Firefox extensions) and Automation for System Events (login items). Denying either marks the related rule `unknown`, which deducts nothing and sets `complete: false`. A denial cannot raise the score.

## Boundary 2: the engine

- `evaluate(state, catalog, ctx)` is pure and deterministic. Time comes from `ctx.now` and `state.collectedAt`, never the clock.
- Evidence is typed. `bool`, `number`, `enum` and `version` may reach the explainer; `path` and `text` are local-only.
- `enum` evidence outside the rule's `evidenceVocabulary` is downgraded to `text` by the engine, so a rule author cannot label a machine string as an enum.
- Every evidence key a rule may emit is declared in `evidenceKeys` and must match `SAFE_STRING_PATTERN`. Undeclared keys are dropped at the explainer chokepoint.
- Fix commands are text. The `{path}` placeholder is filled only from `path`-kind evidence of the same finding whose key equals the command's `appliesTo`, never from model output. The UI shows a copy button. Nothing executes.
- A rule that throws becomes `unknown` with `rule_error` and the run continues.

## Boundary 3: the explainer

### What the model receives

- System prompt: one frozen, deterministic string built from the catalog (per rule: id, title, explanation, fix summary) plus the role, data contract, audience and output rules.
- User message: `ExplainerContext`. `schemaVersion`, `os`, `osVersion` (regex-validated), `profile` (two enums and two booleans from the Welcome form), `score`, `counts`, and up to 60 findings, each with `ruleId`, `status`, `severity`, `category`, `points` and up to 8 `SafeEvidence` entries whose values are booleans, numbers, or strings matching `/^[A-Za-z0-9._-]{1,32}$/`.
- For follow-up questions: the question, clamped to 2000 characters, and at most 10 history turns. Assistant turns are previously validated outputs, never raw model text.

### What it never receives

- Paths, process names, extension names, login item names, share paths, plist paths, labels, key paths, dotfile paths. The context has no field of that kind.
- Any evidence of kind `path` or `text`.
- Any evidence whose key is not in the rule's `evidenceKeys` or fails `SAFE_STRING_PATTERN`.
- Any string value that fails `SAFE_STRING_PATTERN`.
- The raw `SystemState`, the last report file, the API key, the licence key.

`toExplainerContext(report, catalog, profile)` is the only function that builds a request. The structure of `ExplainerContext` is the defence: there is nowhere for a free-form machine string to go.

### Browser hand-off

The default provider opens the user's own Claude or ChatGPT account in the browser with a plain-text prompt that `buildBrowserPrompt(context, catalog, target?)` builds from the same `ExplainerContext` plus the catalog text for the rules in it (id, title, explanation, fix summary), capped at 6000 characters. Nothing from the machine is in that prompt: no paths, process or extension names, evidence of kind `path` or `text`, report file, keys or settings, only what passed the chokepoint.

### Injection defences

- Input is structural, as above. A canary test sets every display-only string in a fixture to `IGNORE PREVIOUS INSTRUCTIONS <field>`, including an evidence key, and asserts the serialised context contains no such substring.
- Caps: 60 findings, 8 evidence per finding, 2000-character question, 10 history turns (`EXPLAINER_LIMITS`).
- Output is JSON constrained by a plain JSON Schema with `additionalProperties: false` (Claude `output_config.format`, Ollama `format`), then validated by `validateExplanation`, `validatePrioritisation` and `validateAnswer`: unknown fields dropped, every string at most 1200 characters, every list at most 10 items, every `ruleId` must exist in the report, a prioritisation `order` must be a permutation of the input ids. Any string containing a fenced block or a line starting with `sudo `, `$ `, `curl ` or `bash ` rejects the whole response with `rejected_output`. The UI then shows the authored explanation.
- Rendering: model text becomes React text nodes. No markdown, no HTML, no links, no copy button. The card is labelled "AI explanation, not verified".
- The model has no tools and no way to call back into the app. Fix steps and commands always come from the catalog. The model never writes them.
- Provider adapters: Claude through `@anthropic-ai/sdk` in the webview (`dangerouslyAllowBrowser`, acceptable because the webview loads only bundled assets under the CSP below); Ollama through a fixed `http://127.0.0.1:11434/api/chat`. Model ids are validated by regex. The API key is read from the Keychain at call time and never held in component state or localStorage.

## Webview and CSP

`app.security.csp` in `apps/desktop/src-tauri/tauri.conf.json`:

```
default-src 'self'; connect-src 'self' ipc: http://ipc.localhost https://api.anthropic.com http://127.0.0.1:11434; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'
```

`connect-src` carries `'self' ipc: http://ipc.localhost` for Tauri's command channel plus the two explainer origins. Tauri appends its own script nonces. `style-src 'unsafe-inline'` lets Vite inject stylesheets as `<style>` elements during `tauri dev`; the UI itself sets no inline style attributes. No inline script is allowed.

Capabilities (`apps/desktop/src-tauri/capabilities/default.json`): `core:default` only; app-defined commands need no capability entry. No `shell`, `fs`, `http` or `opener` permission is granted to the webview. `open_settings_pane` maps a closed `SettingsPane` enum to an `x-apple.systempreferences` URL in Rust; the frontend never passes a URL. `open_assistant` takes an assistant id from a closed set (`claude`, `chatgpt`) and the prompt text; Rust rejects anything else, rejects a prompt over 6000 characters, picks the base URL (`https://claude.ai/new?q=` or `https://chatgpt.com/?q=`) and percent-encodes the prompt itself, so the frontend never passes a URL here either. The webview has no path to the filesystem except the commands below.

```
collect_system_state, collect_section, cancel_scan, cancel_section, check_capabilities, open_settings_pane, open_assistant,
secret_get, secret_set, secret_delete, report_save_last, report_load_last,
license_read, license_write, license_delete
```

## Demo build

For browser-driven QA the web build can be served with fixture-backed adapters (`apps/desktop/src/adapters/demo.ts`): the collector returns a core fixture, the licence accepts only `TL1.DEMO`, secrets and reports stay in memory, and the two open-something commands record their arguments on `window.__talosDemoCalls` instead of opening anything.

The switch is `import.meta.env.VITE_TALOS_DEMO === "1"` in `apps/desktop/src/app/container.ts`, and nothing else. Vite inlines that value when it builds, so it is a property of the bundle, not of the page, the URL, localStorage or any runtime flag. The URL parameters that choose a fixture are only read once that build-time branch has been taken. `apps/desktop/vite.config.ts` throws when `VITE_TALOS_DEMO=1` is set while the Tauri CLI is driving the build (`TAURI_ENV_PLATFORM` present), so neither `tauri dev` nor `tauri build` can produce a demo bundle. In a normal build the condition is a constant `false` and the demo module is dropped; `grep __talosDemoCalls apps/desktop/dist/assets/*.js` finds nothing. `.env` files are git-ignored, so the variable cannot arrive through the repository.

## Data at rest

| Item | Where | Notes |
|---|---|---|
| Anthropic API key | macOS Keychain, through the `keyring` crate | never in localStorage, component state or logs; read at call time |
| Licence key | `<app data>/license.key` | re-verified on every launch; contains no email |
| Last report | `<app data>/last-report.json`, mode 0600 | holds findings with display-only paths and names; never leaves the machine |
| Settings | localStorage | provider, assistant, model ids, profile, developer mode, onboarded flag; no secrets |

The full `SystemState` lives in memory for the session and is not persisted. `ScanReport.sections` records only which sections were collectable.

## Network

Outbound only, and only when the user picks an in-app provider: `https://api.anthropic.com` for Claude, `http://127.0.0.1:11434` for Ollama. No telemetry, no crash reporting, no update check, no licence server. The default provider is `browser`: the app itself opens no connection; when the user clicks an Explain button it hands a `claude.ai` or `chatgpt.com` URL to the default browser, which loads it under the user's own account. With `none` the app opens nothing at all.

## What the app never does

- Execute a fix, generate a script, or run anything a model wrote. Commands are text with a copy button.
- Run as root or prompt for `sudo`.
- Run a shell.
- Read documents, mail, messages, browser history, saved passwords or Keychain items.
- Send machine text to a model.
- Phone home.

## Known limits

- It assesses the current user only.
- It trusts the OS tools it calls. A compromised machine can lie to it.
- Model output is advisory. The score and the fixes never depend on it.
- Offline licence checks cannot stop key sharing. See `docs/LICENSING.md`.
- Development builds are unsigned. See `docs/SIGNING.md`.
