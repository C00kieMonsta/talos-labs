# Talos Labs

Talos Labs is a desktop app you buy once. It reads the security settings of the Mac it runs on, judges them against the CIS Apple macOS Benchmark, and tells a non-expert what is wrong, why it matters for them, and exactly how to fix it. There is no account, no server and no background agent. The scan runs locally and the report stays on the machine.

## Design rule

Code collects and judges. The LLM explains.

- Collectors (Rust, `apps/desktop/src-tauri`) run a fixed list of read-only system commands, without a shell and without root, and produce a `SystemState` made of booleans, enums, counts, versions, ports, process names and config paths.
- The rule engine (TypeScript, `packages/core`) turns that state into a score, a grade and a list of findings. It is pure: no OS access, no network, same output for the same input.
- The explainer is optional. It receives rule ids, statuses, severities and numbers. It never receives text from the machine, never writes fix steps and never runs anything. Every finding has an authored explanation and a complete fix, so the app is complete with no AI provider configured.

The boundaries are described in [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md).

## What it reads

| Area | Source on macOS |
|---|---|
| Disk encryption | `fdesetup status` |
| Firewall | `socketfilterfw` global state, stealth mode, block all incoming |
| Gatekeeper and SIP | `spctl --status`, `csrutil status` |
| XProtect | the XProtect bundle version |
| Software updates | `com.apple.SoftwareUpdate` and `com.apple.commerce` preferences |
| Screen lock | `sysadminctl -screenLock status`, screensaver idle time |
| Accounts | admin group membership, guest and automatic login settings |
| Password policy | `pwpolicy getaccountpolicies` |
| Listening ports | `netstat -anv -p tcp` |
| Remote Login, Screen Sharing, Remote Management | `launchctl print-disabled system` and ports 22, 5900, 3283 |
| File Sharing | `sharing -l` share paths and guest access, port 445 |
| Background programs | plists in the LaunchAgents and LaunchDaemons folders: label, program path, run at load |
| Login items | System Events via `osascript` |
| Backups | `tmutil destinationinfo`, `tmutil latestbackup` |
| Browser extensions | Firefox and Chrome-family extension manifests: name, version, permissions and site access; disabled extensions are skipped |
| SSH | `~/.ssh` permissions and the header of each key, to tell whether it has a passphrase |
| Shell config files | a fixed list (`.zshrc`, `.bashrc`, `.netrc`, `.aws/credentials` and a few more) matched against secret patterns |

## What it never reads

- File contents, with two narrow exceptions: the first 4 KiB of an SSH key, to classify its header, and the fixed list of shell config files, scanned line by line for secret patterns. In both cases the bytes stay inside the collector. A dotfile hit records the file, the pattern name and the line number, never the matched value.
- Documents, mail, messages, photos, browser history, saved passwords or the Keychain.
- The hostname, the user-authored names of shared folders, or the arguments of background programs. Your account name is not collected as a value, but it is part of file paths shown in the report (an SSH key under your home folder, for example). Those paths stay on this Mac and are never sent to an AI provider.
- Anything that needs root. The app never asks for an administrator password and never runs `sudo`.
- Anything on the network. The only outbound connection is to the AI provider you choose, and by default there is none.

## Rules

31 rules, ids `TL-MAC-001` to `TL-MAC-031`, pinned to the CIS Apple macOS 26 Tahoe Benchmark v1.0.0 where a control exists.

| Category | Rules | Covers |
|---|---|---|
| encryption | 1 | FileVault |
| network | 3 | firewall on, stealth mode, no program listening on the network |
| platform | 3 | Gatekeeper, SIP, XProtect present |
| updates | 5 | automatic check, download and install; nothing pending; App Store updates |
| access_control | 6 | password after lock, screen saver timeout, non-admin daily account, guest off, no auto-login, password policy |
| remote_access | 3 | Remote Login, Screen Sharing and Remote Management off |
| sharing | 1 | no guest access to shared folders |
| persistence | 3 | background programs, orphaned launch items, login items |
| backup | 2 | Time Machine configured, backup within 7 days |
| browser | 1 | no extension reads every website |
| developer | 3 | SSH keys have a passphrase, `~/.ssh` is private, no secrets in shell config |

Severity weights: critical 20, high 8, medium 4, low 2, info 0. The score starts at 100 and each failing rule deducts its weight. A failing critical rule caps the score at 59. A rule that could not be checked deducts nothing but marks the report incomplete.

The full table with pass conditions and fixes is [docs/RULES.md](docs/RULES.md). The benchmark section numbers are in [docs/CIS-MAP.md](docs/CIS-MAP.md).

## Free and paid

Free, before any purchase: the full scan, the score and grade, every finding with its title, status, evidence and explanation, and the complete fix for the three highest-point failing findings. Fixes for "worth a look" findings are always free. FileVault is the only critical rule, so an unencrypted disk is always in the free three.

Paid, one licence key: fixes for every finding, "I've done this, check again" per finding, and the AI explainer.

Licence keys are verified offline with Ed25519. No account, no phone-home. See [docs/LICENSING.md](docs/LICENSING.md).

## AI providers

- None. The default. Every screen works.
- Claude, with your own Anthropic API key. The key is stored in the macOS Keychain and read at call time.
- Ollama on `127.0.0.1:11434`, for a fully local setup.

Whichever provider you pick, the model receives the same derived document: rule ids, statuses, severities, points, counts and your profile. No path, process name, file name or other machine text is in it. Model output is schema-checked and rendered as plain text in a card marked "AI explanation, not verified".

## Platform support

macOS now. Settings paths and commands are verified on macOS 26 and 27 on Apple silicon. The schema and rule engine are OS-neutral and a `windows-minimal` fixture exists, but there are no Windows or Linux collectors yet.

## Quick start for developers

```sh
pnpm install
pnpm desktop                              # Tauri dev build with hot reload
pnpm test                                 # vitest in every package
cd apps/desktop/src-tauri && cargo test   # Rust parsers, exec and the JSON contract
```

Toolchain versions and the full command list are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Repo layout

```
packages/core        rule engine, catalog, explainer chokepoint, licence parsing; pure TypeScript
apps/desktop         Tauri 2 app: React UI and adapters in src/, Rust collectors in src-tauri/
scripts/keygen       licence keygen (keypair, issue, verify); never shipped with the app
scripts/scan-cli.ts  run the collector and the engine from the terminal (pnpm scan)
docs                 design, rules, CIS map, development, signing, licensing, security model
```

## Status

v0.1 is in development. Builds are unsigned and not notarised, so they are not for distribution. Do not hand an unsigned build to anyone. See [docs/SIGNING.md](docs/SIGNING.md).

## Known limitations in unsigned builds

In an ad-hoc signed build (every `pnpm desktop` and unsigned `pnpm desktop:build`) the kernel returns an empty TCP socket table to the app, so the listeners, remote access and file sharing sections show as "Couldn't check" and rules TL-MAC-018 to TL-MAC-022 come back `unknown`, never a false pass. A Developer ID signed build gets the full table. The measurements are in [docs/notes/socket-table-signing.md](docs/notes/socket-table-signing.md).
