# Security model

Talos Labs reads security settings and shows them with a fix. From v0.2 it can also apply a fix, but only a command line from its own catalog, only after the user confirms it in the app, and never one a model wrote. From v0.3 the guided check-up can apply several of those catalog fixes behind one administrator dialog; the batch adds no command, no input and no privilege to the single-fix path. This document lists the boundaries, what crosses each one, and what the app never does. The v0.2 design is in `docs/DESIGN-V02.md`, the v0.3 design in `docs/DESIGN-V03.md`.

## Four boundaries

1. Collectors (Rust, `apps/desktop/src-tauri/src/collect/`). Run allow-listed binaries with no shell, read-only, without root. Output: a `SystemState` of booleans, enums, counts, versions, ports, process names and config paths. A collector failure becomes `{ status: "unavailable", reason, detail }` with one of nine fixed reasons; `detail` is a label written by our code ("parser: netstat"), never command output.
2. Rule engine (`packages/core`). Pure TypeScript. No OS, no network, no LLM. Same input, same output.
3. Explainer (`packages/core/src/explainer/` plus the desktop adapters and, from v0.2, the on-device sidecar). Receives a derived document whose only strings are rule ids, enum values from the catalog vocabulary and regex-validated versions, plus catalog text. No string that originated on the machine reaches a model.
4. Fix engine (Rust, `apps/desktop/src-tauri/src/fix/`, v0.2). Runs only command lines written into a table keyed by rule id. The webview picks a row and a validated choice; it never sends a command, a path that Rust has not itself listed, or a URL. Admin commands run through macOS's own administrator dialog.

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
| Codesign | `/usr/bin/codesign` | signature check of the Claude Code binary before every launch (Boundary 3, "Your AI") |

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

No root in the collectors. The app never draws a field for the login password. The only password dialog it ever triggers is macOS's own administrator dialog, raised by the fix engine (Boundary 4), and the app never receives what is typed into it. Two TCC permissions are optional: Full Disk Access (Chrome-family and Firefox extensions) and Automation for System Events (login items). Denying either marks the related rule `unknown`, which deducts nothing and sets `complete: false`. A denial cannot raise the score.

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

### On-device AI sidecar (v0.2)

The consumer provider is Apple's Foundation Models framework, running on the Mac. The browser hand-off of v0.1 (`buildBrowserPrompt` and its Tauri command) is removed; the app opens no chat website URL.

How it runs:

- `talos-ai` is a Swift command-line helper bundled through Tauri's `bundle.externalBin`, signed with the app. Rust spawns it from `current_exe().parent().join("talos-ai")` with `env_clear()` plus `HOME`, `PATH=/usr/bin:/bin` and `LANG`, stdin and stdout piped, stderr discarded in release. It is long-lived, killed after 300 s idle and on exit, and respawned on crash.
- The helper speaks JSON lines: `availability`, `generate`, `cancel`, `shutdown` in; `availability`, `partial`, `done`, `error` out. It never writes anything else to stdout. Rust parses every line against a closed set of shapes and drops anything unknown or over 1 MiB.
- Rust validates each request before forwarding: the id matches `^[a-z0-9]{1,16}$`, the task is one of `explain`, `prioritise`, `ask`, the instructions are at most 3000 characters and the prompt at most 8000. One request runs at a time; a second is rejected with `busy`. Timeouts: 5 s for an availability probe, 25 s to the first partial, 90 s per request; a cancel that is not acknowledged within 2 s kills the helper.
- The output shape is fixed in Swift as `@Generable` structs chosen by the task. The webview cannot send a schema. Every `done` value still goes through core's `validateExplanation`, `validatePrioritisation` or `validateAnswer`; a mismatch is `rejected_output`.
- One `LanguageModelSession` per request, never reused, so no context carries from one request to the next.
- The webview talks to Rust only (`ai_availability`, `ai_generate`, `ai_cancel`, and the `ai:stream` event). No Tauri shell plugin is added and no capability is granted.

What the model receives: the same `ExplainerContext` from `toExplainerContext`, serialised by `buildOnDevicePrompt` in `packages/core/src/explainer/on-device-prompt.ts`, plus catalog text for the rules the task needs (title, fail title, explanation, fix summary) and a frozen instructions string from `buildOnDeviceInstructions`. The on-device window is about 4096 tokens, so the prompt is capped at 12 findings, 4 history turns of 600 characters and 7000 characters in all. `buildOnDevicePrompt` returns the ids it kept, and a prioritisation is validated against exactly those (`validatePrioritisation(raw, report, kept)`), never against the full report, so the cap cannot turn every answer into `rejected_output`. Nothing from the machine is in it: no paths, process or extension names, evidence of kind `path` or `text`, report file, keys or settings, only what passed the chokepoint. The canary test covers this builder as it covers the v0.1 one.

Streaming: partial values are rendered as text nodes only, labelled "Written on this Mac by Apple Intelligence. Not verified." `containsCommandText` runs on every partial; a hit cancels the request and removes the partial text, and the authored explanation stays. Unvalidated text never stays on screen.

Availability states (`available`, `device_not_eligible`, `apple_intelligence_not_enabled`, `model_not_ready`, `helper_unavailable`) are shown honestly; none of them opens a browser or asks for an account or a key. Developer mode keeps the Claude API key and Ollama providers with the v0.1 rules.

### Your AI: ChatGPT and Claude (DESIGN-AI)

From the AI layer the person may connect the ChatGPT or Claude subscription they already have (`docs/DESIGN-AI.md`). The sign-in always happens on the provider's own page in the default browser; the app never draws a password field for either, and never shows an API key field outside Developer mode. What the model receives does not change: the request bodies are built in core (`packages/core/src/explainer/remote.ts`, `explainTurns`, `prioritiseTurns`, `askTurns`, `responsesRequestBody`, `claudePromptFor`) from the same `ExplainerContext`, and the canary test (`packages/core/test/explainer/remote.test.ts`) runs over both adapters by id. The three JSON schemas live in Rust (`ai/schemas.rs`) and core (`fixtures/explainer-schemas.json`) with a parity test; the webview never sends a schema, a URL, a program name or an argument.

Network destinations, all outbound, only once a provider is connected or being connected:

| Destination | From | Purpose |
|---|---|---|
| `https://api.openai.com/v1/responses` | webview (`fetch`, CSP `connect-src`) | ChatGPT inference, `store: false`, `stream: true` |
| `https://api.openai.com/v1/models` | Rust | the account's model list once at connect time (eligibility check; the first `visibility == "list"` slug is stored as the model) |
| `https://auth.openai.com/api/accounts/authorize` | the default browser, URL built in Rust | the ChatGPT sign-in page |
| `https://auth.openai.com/api/accounts/oauth/token` | Rust | code exchange and refresh |
| `https://downloads.claude.ai/claude-code-releases` | Rust | `/stable`, `/<version>/manifest.json`, `/<version>/<platform>/claude`, verified by sha256 from the manifest |
| Anthropic's API | the Claude Code child process | Claude inference under the person's own plan; Talos Labs never holds a Claude token |

**ChatGPT.** Rust owns the OAuth flow (`ai/chatgpt_oauth.rs`): PKCE S256, random `state` and `nonce`, a loopback listener bound to `127.0.0.1:0` that accepts only `GET /auth/callback` (anything else gets a fixed 404), rejects a `state` mismatch or missing `code` with a fixed 400 and gives up after five, treats `error=access_denied` as "closed" and any other `error` as "unavailable", requires the issued client id to match `^oaiapp_[A-Za-z0-9_-]{1,128}$` and to equal the stored one when one exists, reads at most 8 KiB within a 2 s budget per connection (a client that drips bytes counts as a mismatch; cancel and the 10 min deadline are checked between reads), and drops the listener after the first valid callback. Request lines are never logged. The token response is parsed into exactly `access_token`, `refresh_token`, `expires_in` and `scope`, held in zeroing strings; `id_token` is never read. The five Keychain items (`chatgpt_access_token`, `chatgpt_refresh_token`, `chatgpt_client_id`, `chatgpt_scope`, `chatgpt_token_expires_at`) are Rust-only: `secret_get`, `secret_set` and `secret_delete` accept only `WEBVIEW_SECRET_NAMES = ["anthropic_api_key"]` and answer `invalid secret name` for anything else. The webview receives the access token per request through `chatgpt_token` and drops it after the call; a refresh happens in Rust when the token expires within 60 s, or once after OpenAI rejects the current token on an explanation request (`chatgpt_token { forceRefresh: true }`); rotated refresh tokens replace the old one, and the refresh errors named in OpenAI's docs clear the four token items. Disconnect deletes the same four. `chatgpt_client_id` stays in both cases: it names this app on this Mac, not the person, and the next sign-in reuses it instead of registering the app again. A non-secret `<app data>/chatgpt.json` holds the random `ext_agent_host_id` and the model slug.

**Claude.** Rust runs Anthropic's unmodified Claude Code binary (`ai/claude_code.rs`): found read-only under `~/.local/share/claude/versions` or `~/.local/bin/claude`, or fetched as above into `<app data>/claude-code/versions/<version>`. Before every launch `/usr/bin/codesign --verify --strict -R=<identifier "com.anthropic.claude-code" and anchor apple generic and certificate leaf[subject.OU] = "Q6L2SF6YDW">` must pass; only a `Verified` path can be spawned. The verdict is never cached: `locate` runs `codesign` on every probe (`--version`, `auth status`, `auth logout`), and the `auth login` and explanation spawns run it again immediately before `spawn`, so a binary swapped in place between two runs is caught. Every spawn is `Command::new(verified_path)` with literal args, `env_clear()`, and exactly `PATH=/usr/bin:/bin`, `LANG=en_GB.UTF-8`, `HOME=<the person's real home>`, `USER=<account name>`, `LOGNAME=<account name>`, `CLAUDE_CONFIG_DIR=<app data>/claude-code/config`, `DISABLE_AUTOUPDATER=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. HOME and USER are the real ones because Claude Code stores the plan credential in the login keychain. macOS finds that keychain under the real `~/Library/Keychains` and files the item under the account name. A made-up HOME ended every sign-in with "Keychain Not Found" and nothing stored (seen in the dev build on 2026-10-17). Rust resolves both values from the password database (`getpwuid_r`), with the process environment as the fallback, never from the webview. The config folder is 0700 and stays the Talos one, so the person's own `~/.claude` and `~/.claude.json` are never loaded. Claude Code keys its keychain item to `CLAUDE_CONFIG_DIR`: on 2.1.287, with the real HOME and a throwaway config dir, `claude auth status` reports `loggedIn: false` on a Mac whose owner is signed in to their own Claude Code (checked 2026-10-17; ignored test `auth_status_under_a_throwaway_config_dir_sees_no_sign_in`). The probes (`--version`, `auth status`, `auth logout`) run with the config folder as cwd, never the real home, so no ancestor `CLAUDE.md` is in play. Talos Labs never opens `config/.credentials.json`; Disconnect runs `claude auth logout` under that config dir and then removes the file by name. The binary is never deleted. `claude auth status` output is parsed into `{ logged_in, auth_method }` and nothing else is kept. Each explanation runs `claude -p --safe-mode --disable-slash-commands --tools "" --allowedTools StructuredOutput --strict-mcp-config --system-prompt <instructions> --max-turns 2 --no-session-persistence --permission-prompts none --permission-mode default --output-format stream-json --verbose --include-partial-messages --json-schema <schema>` with no positional argument, no `--model` and no `--bare`; the prompt (the derived document) is written to the child's stdin, never argv. `--permission-mode default` is there because Claude Code's "auto" mode adds a classifier context to its request naming the cwd, `HOME` and `CLAUDE_CONFIG_DIR`, which under `~/Library/Application Support` would carry the account name; with `default` that block is absent (verified on 2.1.287 with a local recorder). The recorder check was repeated on 2026-10-17 with the real HOME and USER in the child's environment and a throwaway config dir (ignored test `recorder_shows_the_prompt_on_stdin_and_no_canary`). The first request body carried the prompt from stdin and the system prompt. It did not contain the home path, the account name, any `/Users/` path, the config dir path, the per-user temp dir, a canary `CLAUDE.md` placed next to the cwd, or any text from the person's own `~/.claude/CLAUDE.md`. The only path in it was the cwd below. The cwd is a fresh 0700 folder `talos-claude-<16 hex>` under `/private/tmp`, removed after the run, so no ancestor `CLAUDE.md` and no account name is in it. It is not under the per-user temp dir (`$TMPDIR`, `/var/folders/<xx>/<token>/T`): Claude Code names the cwd in every request, and that token is stable for the account on this Mac. stderr is discarded except under the `debug-raw` feature; `provider.rs`, `claude_code.rs`, `claude_stream.rs` and `chatgpt_oauth.rs` contain no `println!`, `eprintln!` or `dbg!` (a test greps for them). Stream errors are classified into fixed codes (`needs_sign_in`, `limit_reached`, `plan_not_eligible`, `provider_unavailable`, `rejected_output`, `timeout`, `cancelled`, `internal`); the message text never leaves Rust. Claude Code creates its own `/tmp/cc-socks/<pid>.sock` during a run; Talos Labs does not touch it.

Both routes keep the v0.2 output rules: partial snapshots are rendered as text nodes, `containsCommandText` runs on every partial and on the final value, every value goes through core's validators, and a rejected output removes the partial text and keeps the authored explanation. Release builds offer neither provider until `TALOS_CHATGPT_APPROVED=1` or `TALOS_CLAUDE_PLAN_APPROVED=1` is set at build time (debug builds offer both); an unoffered provider reads "Not available yet" and `ai_connect_start` answers `not_offered`.

### Injection defences

- Input is structural, as above. A canary test sets every display-only string in a fixture to `IGNORE PREVIOUS INSTRUCTIONS <field>`, including an evidence key, and asserts the serialised context contains no such substring.
- Caps: 60 findings, 8 evidence per finding, 2000-character question, 10 history turns (`EXPLAINER_LIMITS`).
- Output is JSON constrained by a plain JSON Schema with `additionalProperties: false` (Claude API key `output_config.format`, Ollama `format`, ChatGPT `text.format` with `strict: true` and the length and pattern keywords stripped by `strictSchema`, Claude Code `--json-schema` from `ai/schemas.rs`), then validated by `validateExplanation`, `validatePrioritisation` and `validateAnswer`: unknown fields dropped, every string at most 1200 characters, every list at most 10 items, every `ruleId` must exist in the report, a prioritisation `order` must be a permutation of the ids the prompt carried (the `eligible` list the adapter passes: the on-device subset for Apple, every finding for ChatGPT, Claude Code, the Claude API key and Ollama). Any string containing a fenced block or a line starting with `sudo `, `$ `, `curl ` or `bash ` rejects the whole response with `rejected_output`. The UI then shows the authored explanation. For ChatGPT, an account that answers 400 `subscription_sharing_unsupported_capability` to the strict request is sent plain requests (no `reasoning`, no `text.format`) for the rest of the session; its output is then held only by the validators and `containsCommandText` below.
- Rendering: model text becomes React text nodes. No markdown, no HTML, no links, no copy button. The card is labelled "AI explanation, not verified".
- The model has no tools and no way to call back into the app. Fix steps and commands always come from the catalog. The model never writes them.
- Provider adapters: Claude through `@anthropic-ai/sdk` in the webview (`dangerouslyAllowBrowser`, acceptable because the webview loads only bundled assets under the CSP below); Ollama through a fixed `http://127.0.0.1:11434/api/chat`. Model ids are validated by regex. The API key is read from the Keychain at call time and never held in component state or localStorage.

## Boundary 4: the fix engine

Talos Labs may change a setting only when the fix is a fixed, catalog-defined command and the user has confirmed it in the app. The engine lives in `apps/desktop/src-tauri/src/fix/`. The design is in `docs/DESIGN-V02.md` section 5.

### Allow-list

- `FIX_CATALOG` in `fix/catalog.rs` is a static table keyed by rule id. Fifteen rules have an entry (002, 003, 007, 008, 009, 011, 013, 015, 016, 019, 020, 021, 022, 029, 030). Every other rule has no entry and `fix_preview` rejects it with `not_in_catalog`.
- Each step names a binary from `enum FixBin` (absolute paths: `socketfilterfw`, `defaults`, `sysadminctl`, `sharing`, `launchctl`, the ARDAgent `kickstart`, `chmod`, `ssh-keygen`) and an argument list of `Arg::Lit` literals plus the bound slots below. A test asserts every literal, and every token `Arg::KeyFormatFlags` can expand to, matches `^[A-Za-z0-9._/:=+-]+$`. `FixBin` is separate from the collectors' `exec::Bin`, so a collector cannot name a fix binary and a fix cannot name a collector binary.
- The only non-literal arguments are a share name (022), key paths (029, 030), the `~/.ssh` directory (030) and the key-format flags for 029 (`Arg::KeyFormatFlags`: nothing, `-m PEM` or `-m PKCS8`, picked by Rust from a fixed table by the bound key's `classify_key` result, never from input). Rust fills the share name and key paths from its own fresh listing at preview time (`sharing -l -f json`, `ssh::scan_keys`): the webview's choice must equal one candidate exactly, and the plan binds Rust's copy. A share name outside `^[A-Za-z0-9 ._-]{1,64}$` is rejected and the UI falls back to the deep link. A key path must canonicalise to a regular, non-symlinked file under `$HOME/.ssh` owned by the current uid. Slot values containing a newline or NUL are rejected before quoting. Reveal paths (023, 024, 031) are validated the same way against the persistence and dotfile listings.
- Deep-link fixes (`settings link` in `docs/RULES.md`) run nothing: Rust opens a pane from the closed `SettingsPane` enum and the app re-reads the section with the read-only collectors.

### What the user confirms

- `fix_preview(rule, choice)` builds a plan, stores it under a random id for five minutes, and returns the exact command lines, whether a password will be asked, whether a passphrase is needed, the sections that will be re-read and the reversal line. The sheet shows the title and verb from the catalog, the sentence "macOS will ask for your administrator password. The dialog is macOS's own and may name osascript. Talos Labs never sees the password." for admin fixes, the side effects, and a "What will run" disclosure with the lines.
- `fix_apply(plan, passphrase?)` accepts only an unexpired plan id from Rust's own store. What was shown is what runs. Errors found before anything runs (`plan_expired`, `not_in_catalog`, `invalid_choice`, `invalid_input`, `busy`, `precondition_changed`) reject the invoke; errors from the run (`cancelled`, `wrong_password`, `command_failed`, `timeout`) resolve as `{ ok: false, error, step }`. A plan whose precondition no longer holds (020 when Remote Management came on) fails with `precondition_changed` before anything runs.
- After an apply the app re-reads the affected section with the read-only collectors and shows the result. The engine never reports success on its own word.

### Privilege path

- User-level steps run like collectors: `Command::new(absolute_path)` with explicit args, `env_clear()`, a fixed `PATH`, stdin null, no shell.
- Admin steps run through one `/usr/bin/osascript` per plan, reading from stdin (never `-e`, so the script is not visible in `ps`), executing `do shell script "<lines>" with prompt "<prompt>" with administrator privileges`. Every program path and argument is single-quoted (`'` becomes `'\''`), each step ends with an exit marker (`|| exit 1N`) so Rust learns which step failed, tolerated exit codes are written as `|| test $? -eq N`, the joined script is escaped for an AppleScript string literal, and all admin steps of one plan share one dialog. This is the one place the product runs a shell, and it runs only strings assembled from the table and the bound candidate. Property tests round-trip adversarial strings through `osascript` and `/bin/sh -c`.
- The dialog is raised by macOS. The app never receives the password, never passes a user name or password parameter to `do shell script`, and never stores an authorization. `(-128)`, `(-60006)` or "User canceled" in stderr is `cancelled`. The wrong-password case (after macOS's three attempts) is matched on the parenthesised error number `osascript` appends to the message (expected `(-60005)`, `errAuthorizationDenied`; recorded on the first real run before the mapping ships), with the case-insensitive regex `administrator user ?name or password was incorrect` as a secondary match. The text itself is localised by StandardAdditions from the user's macOS language, not `LANG` (`en` "user name", `en_GB` "username", translations elsewhere), so the exact `en` string is never relied on. A step marker is `command_failed` with the step index; a kill after 120 s is `timeout`. `-60007` is `errAuthorizationInteractionNotAllowed` and is not treated as a wrong password.
- Rule 029 runs `ssh-keygen -p` on a pseudo-terminal. The new passphrase arrives in the Tauri invoke payload (in-process IPC), is held in a `Zeroizing<String>`, is written to the pty for the two "Enter new passphrase" prompts and is zeroed afterwards. It never touches argv, the environment, a file, or a log. An "Enter old passphrase" prompt aborts the run.
- No stdout or stderr from any fix command is logged in release or returned to the webview. Developer mode sees the exit code and step index only.
- Rule 012 is a deep link on purpose: the app never draws a field for the login password.

### Batch fixes (v0.3)

The guided check-up fixes several rules behind one dialog. The engine is `fix/batch.rs`; the design is `docs/DESIGN-V03.md` section 3.

- Which rules may join a batch is a property of the catalog row, `batchable(spec)`: no choice to make, no secret, no pty. That is 13 rules (002, 003, 007, 008, 009, 011, 013, 015, 016, 019, 020, 021, 030). Rule 022 (a share name) and rule 029 (a passphrase) never join, so no `FixChoice` payload with a path and no passphrase exist on the batch path. A test pins the set, and the core contract test reads the same `batchable` field from `fix-catalog.json`.
- `fix_preview_batch({ rules })` takes a list of rule ids, nothing else. Each one goes through the same `run::preview(rule, FixChoice::None)` as a single fix, so binding, `read_previous` and the precondition check are the same code. A duplicate, a non-batchable rule or an empty list after exclusion rejects the whole call with `invalid_choice`; an unknown rule with `not_in_catalog`; an item whose own precondition fails lands in `excluded`. The plan is stored beside single plans under a random id for the same five minutes and runs once.
- `fix_apply_batch({ plan })` accepts only a batch id. The `PlanStore` keeps singles and batches as one `Stored` enum, so `fix_apply` rejects a batch id and `fix_apply_batch` rejects a single id, both as `plan_expired`. The one running slot is shared, so a batch and a single fix report `busy` to each other. `fix_cancel` works on a batch id.
- Admin items run first, in catalog order, through one `osascript` reading the script from stdin, one `do shell script ... with administrator privileges`, one dialog, with the prompt "Talos Labs wants to fix N things on this Mac." Each item is a subshell: `( { line; } >/dev/null 2>&1; ... ); echo R i $?`. The lines inside are the v0.2 `shell_line` output (quoted by `sh_quote`, tolerated exits, `exit 1N` step markers), so the only new text in the script is the subshell wrapper, the marker echo with an integer Rust formats itself, and a final `exit 0`. The redirects keep every command's output off stdout, so the only thing Rust reads back is the `R` lines, parsed with an anchored regex. A stray line cannot select or alter a command; at worst it misreports an item, and the recheck corrects that. The child's timeout is the single-fix admin timeout plus 15 s per admin item.
- A cancelled dialog, a wrong password or a timeout is classified by the unchanged `classify(stderr, status)`; nothing ran, every item is `not_run`, and the user-level phase does not start. User-level items (013, 030) run afterwards through `run_user`, one at a time, with no shell.
- The recheck is the frontend's and is per item: one re-read of the union of sections, then `rulePasses` per rule. The engine never reports success on its own word, for a batch as for a single fix.
- Nothing is emitted while the script runs; `fix:status` gains an optional `item` index for the user-level phase only, and the single-fix payload is unchanged.
- Developer mode shows the plan lines, the markers, the exit code and the failing step. It never edits them.
- The free set is a product gate, not a security one. The guided plan freezes `freeFixes` when the check-up lands and rebuilds from that list, so fixing a free rule does not unlock another; a licence key unlocks the rest. The gate decides which rule ids the webview may send; the engine still binds, previews and confirms each of them exactly as above.

### What can never happen

- A command that is not in `FIX_CATALOG` cannot run: the webview sends a rule id and a choice, and the table has no entry built from input.
- A path, share name or key the webview chose cannot reach a command unless Rust's own fresh listing contains it exactly.
- A model cannot write, choose or trigger a fix. Model output is text in a labelled card; the fix engine is driven by catalog ids only, and `containsCommandText` rejects model text that looks like a command.
- The app cannot run as root, cannot start a privileged helper, and cannot keep an authorization between plans. Each admin plan, single or batch, is one dialog, answered by the user to macOS.
- A batch cannot carry a path, a share name, a passphrase or a choice: the batchable set excludes every row that takes one, and the batch command takes rule ids only.
- The displayed `fix.commands` text (the Developer-mode copy buttons) is never executed. The engine runs its own table, not the catalog's display strings.
- Nothing runs without the in-app confirmation, and nothing runs after the five-minute plan expiry without a fresh preview.

## Webview and CSP

`app.security.csp` in `apps/desktop/src-tauri/tauri.conf.json`:

```
default-src 'self'; connect-src 'self' ipc: http://ipc.localhost https://api.anthropic.com https://api.openai.com http://127.0.0.1:11434; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'
```

`connect-src` carries `'self' ipc: http://ipc.localhost` for Tauri's command channel, the two Developer-mode explainer origins, and `https://api.openai.com` for ChatGPT inference (the only remote call the webview makes for a connected subscription; the sign-in and token endpoints are reached from Rust and the browser, never from the webview). The on-device sidecar and Claude Code need no origin: they are reached through Tauri commands, not the network. Tauri appends its own script nonces. `style-src 'unsafe-inline'` lets Vite inject stylesheets as `<style>` elements during `tauri dev`; the UI itself sets no inline style attributes. No inline script is allowed.

Capabilities (`apps/desktop/src-tauri/capabilities/default.json`): `core:default` plus `core:window:allow-start-dragging` (for the unified title bar); app-defined commands need no capability entry. No `shell`, `fs`, `http` or `opener` permission is granted to the webview. `open_settings_pane` maps a closed `SettingsPane` enum (v0.2 adds `apple_intelligence`) to an `x-apple.systempreferences` URL in Rust; `open_buy_page` opens one fixed URL chosen in Rust; the frontend never passes a URL. The v0.1 assistant hand-off command is removed. The webview has no path to the filesystem except the commands below.

```
collect_system_state, collect_section, cancel_scan, cancel_section, check_capabilities, open_settings_pane,
fix_preview, fix_apply, fix_preview_batch, fix_apply_batch, fix_cancel, fix_reveal, open_buy_page, app_restart,
ai_availability, ai_generate, ai_cancel,
claude_generate, claude_cancel, claude_code_info,
ai_provider_status, ai_connect_offered, ai_connect_start, ai_connect_poll, ai_connect_cancel, ai_disconnect,
chatgpt_token, chatgpt_info,
secret_get, secret_set, secret_delete, report_save_last, report_load_last,
license_read, license_write, license_delete
```

`ai_connect_start`, `ai_connect_poll`, `ai_connect_cancel` and `ai_disconnect` take a provider id (`chatgpt` or `claude_plan`) and nothing else; `ai_provider_status` takes the provider id and a `fresh` boolean; `ai_connect_offered` takes nothing; `claude_generate` takes an id matching `^[a-z0-9]{1,16}$`, a task name, the instructions (at most 40 000 characters, must not start with `-`) and the prompt (at most 60 000 characters); `chatgpt_token` takes a `forceRefresh` boolean. No command accepts a URL, a path, a program name or a schema.

## Demo build

For browser-driven QA the web build can be served with fixture-backed adapters (`apps/desktop/src/adapters/demo.ts`): the collector returns a core fixture, the licence accepts only the two demo keys (`TL1.DEMO` for typed entry and the long `DEMO_LICENSE_KEY_PASTED` that matches the paste pattern), secrets and reports stay in memory, the fix engine, the AI sidecar and the ChatGPT and Claude sign-in are scripted fakes (`DemoAiConnect` opens no page and plays its stages on timers), and `open_settings_pane`, `open_buy_page`, `app_restart`, `fix_preview`, `fix_apply`, `fix_preview_batch`, `fix_apply_batch`, `fix_reveal`, `ai_connect_start`, `ai_connect_cancel`, `ai_disconnect` and a stopped AI request record their arguments on `window.__talosDemoCalls` instead of doing anything; a URL is never recorded.

The switch is `import.meta.env.VITE_TALOS_DEMO === "1"` in `apps/desktop/src/app/container.ts`, and nothing else. Vite inlines that value when it builds, so it is a property of the bundle, not of the page, the URL, localStorage or any runtime flag. The URL parameters that choose a fixture are only read once that build-time branch has been taken. `apps/desktop/vite.config.ts` throws when `VITE_TALOS_DEMO=1` is set while the Tauri CLI is driving the build (`TAURI_ENV_PLATFORM` present), so neither `tauri dev` nor `tauri build` can produce a demo bundle. In a normal build the condition is a constant `false` and the demo module is dropped; `grep __talosDemoCalls apps/desktop/dist/assets/*.js` finds nothing. `.env` files are git-ignored, so the variable cannot arrive through the repository.

## Data at rest

| Item | Where | Notes |
|---|---|---|
| Anthropic API key | macOS Keychain, through the `keyring` crate | never in localStorage, component state or logs; read at call time; the only name the webview's `secret_*` commands accept |
| ChatGPT sign-in | macOS Keychain: `chatgpt_access_token`, `chatgpt_refresh_token`, `chatgpt_client_id`, `chatgpt_scope`, `chatgpt_token_expires_at` | Rust-only; the webview gets the access token per call through `chatgpt_token`; `expires_at` is written last so a partial write reads as not connected; Disconnect and a dead refresh delete the four token items and keep `chatgpt_client_id` |
| ChatGPT host id and model | `<app data>/chatgpt.json`, mode 0600 | a random `urn:uuid:` `ext_agent_host_id` generated once (OpenAI accepts only a URI form), the model slug, a `planNotEligible` flag (set on a 403 from the models call, cleared on a 200 or Disconnect) and a `needsSignIn` flag (set when a refresh answers that the sign-in is gone, cleared by a new sign-in or Disconnect) so both states survive a relaunch; no secret |
| Claude Code sign-in | `<app data>/claude-code/config/.credentials.json` and Claude Code's own Keychain item, both written by Claude Code | Talos Labs never opens the file; Disconnect runs `claude auth logout` then removes the file by name |
| Claude Code binary | `<app data>/claude-code/versions/<version>` plus `installed.json` | sha256 from Anthropic's manifest at fetch, `codesign` before every launch; never deleted by Disconnect |
| Licence key | `<app data>/license.key` | re-verified on every launch; contains no email |
| Last report | `<app data>/last-report.json`, mode 0600 | holds findings with display-only paths and names; never leaves the machine |
| Settings | localStorage | provider, AI switch, model ids, profile, the developer group (switch, show commands, show plan), onboarded flag, the two check-up switches, the relaunch continuation (`talos.continue`, a kind only); no secrets |
| Guided memory | localStorage `talos.guided` | rule ids and ISO dates only: snoozes, "later" counts, watcher time-outs, rules waiting for a restart, the paywall and permission snooze dates, the date "Not now" was last pressed on the Connect screen or the "Explain this" disclosure (`aiAskedAt`). No rule text, path or evidence |

The full `SystemState` lives in memory for the session and is not persisted. `ScanReport.sections` records only which sections were collectable. Fix plans live in Rust memory for five minutes and are never written to disk; a passphrase lives in a zeroed buffer for one apply.

## Network

Outbound only. The check-up and the fixes never open a connection. With "On this Mac" as the AI, explanations are written by the Foundation Models framework and the app opens no connection. With ChatGPT or Claude connected (`docs/DESIGN-AI.md`), the short summary built by `toExplainerContext` goes to that provider and nothing else does: the destinations are the table in Boundary 3, "Your AI". Developer mode adds `https://api.anthropic.com` for the API-key route and `http://127.0.0.1:11434` for Ollama. No telemetry, no crash reporting, no update check, no licence server. The web links in the product, each opened in the default browser only when the person clicks, are "Buy a licence" (one fixed URL from Rust), the ChatGPT sign-in page (`https://auth.openai.com/api/accounts/authorize` with a per-attempt state, nonce and PKCE challenge, the only URL `open_in_browser` accepts) and the Claude sign-in page, which Anthropic's own `claude auth login` opens; the webview never names a URL. With AI switched off the app opens nothing at all.

## What the app never does

- Generate a script, or run anything a model wrote. The only commands it runs are the fixed lines in `FIX_CATALOG`, after an in-app confirmation.
- Run as root, prompt for `sudo`, or draw its own password field. Admin commands go through macOS's administrator dialog, one plan or one batch per dialog.
- Draw a sign-in field for ChatGPT or Claude, or an API key field outside Developer mode. Sign-in is the provider's own page in the browser; Claude's sign-in is Claude Code's own and Talos Labs never sees a Claude token.
- Load or read the person's own Claude Code setup (`~/.claude`) or Keychain item: every launch runs under Talos Labs' own `CLAUDE_CONFIG_DIR` and `HOME`.
- Run a shell, except the `sh` inside `do shell script` for an admin plan or batch, which receives only fully quoted catalog text.
- Scan, fix or watch while the app is closed. No notifications, no menu bar agent, no scheduled scans.
- Send a URL, a command or a schema from the webview to Rust.
- Read documents, mail, messages, browser history, saved passwords or Keychain items.
- Send machine text to a model.
- Phone home.

## Known limits

- It assesses the current user only.
- It trusts the OS tools it calls. A compromised machine can lie to it.
- Model output is advisory. The score and the fixes never depend on it.
- Offline licence checks cannot stop key sharing. See `docs/LICENSING.md`.
- Development builds are unsigned. See `docs/SIGNING.md`.
- Accepted local-attacker limits of the AI layer: the ChatGPT authorize URL (client id, PKCE challenge, state, nonce; no token) is visible in `ps` while the browser is being opened, and the frozen system prompt (catalogue text only, no person or machine text) travels in Claude Code's argv. The derived document itself goes over stdin. Claude Code's own environment block names the run cwd to the model: a random folder under `/private/tmp`, which carries no account name and no per-user token; no flag was found that removes it.
- With ChatGPT or Claude connected, the provider learns that the person uses Talos Labs, and the summary leaves the Mac. The Connect screen says so before anything is sent.
