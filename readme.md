# Talos Labs

Talos Labs is a desktop app you buy once. It reads the security settings of the Mac it runs on, judges them against the CIS Apple macOS Benchmark, explains to a non-expert what is wrong and why it matters for them, and fixes most of it in place. There is no account, no server and no background agent. The scan runs locally, the AI runs on this Mac, and the report stays on the machine.

## Design rule

Code collects and judges. The LLM explains. Fixes come from a fixed table.

- Collectors (Rust, `apps/desktop/src-tauri`) run a fixed list of read-only system commands, without a shell and without root, and produce a `SystemState` made of booleans, enums, counts, versions, ports, process names and config paths.
- The rule engine (TypeScript, `packages/core`) turns that state into a score, a grade and a list of findings. It is pure: no OS access, no network, same output for the same input.
- The explainer receives rule ids, statuses, severities and numbers. It never receives text from the machine, never writes fix steps and never runs anything. Every finding has an authored explanation and a complete fix, so the app is complete with AI switched off.
- The fix engine (Rust, `src-tauri/src/fix`) applies only entries of a compiled-in catalog. Each entry is an absolute program path and literal arguments. The user interface cannot name a program or add an argument; it names a rule and, where a rule needs one, picks a share or a key from the scan result.

The boundaries are described in [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md).

## Requirements

- macOS 26 or later. The app is a universal build and runs on Apple silicon and Intel.
- Apple silicon with Apple Intelligence turned on, for AI explanations. On other Macs the AI card says so and everything else works.
- Optional: Full Disk Access, to read browser extension folders. Optional: Automation permission for System Events, to read login items. Both are asked for in place when a check needs them, never during onboarding.

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

## What it never does

- Read file contents, with two narrow exceptions: the first 4 KiB of an SSH key, to classify its header, and the fixed list of shell config files, scanned line by line for secret patterns. In both cases the bytes stay inside the collector. A dotfile hit records the file, the pattern name and the line number, never the matched value.
- Read documents, mail, messages, photos, browser history, saved passwords or the Keychain.
- Send the hostname, the names of shared folders, the arguments of background programs or any file path anywhere. Your account name is part of file paths shown in the report (an SSH key under your home folder, for example). Those paths stay on this Mac and never reach a model.
- Run as root. Collectors never need an administrator password. A fix that does (the firewall, remote access, sharing, updates, the guest account) shows the exact commands first, then asks macOS to show its own administrator dialog once for the whole fix. The app never sees the password, never stores it and never runs a shell.
- Run anything the catalog does not list. There is no free-form command path, in the app or in the AI.
- Talk to the network. By default there is no outbound connection at all. The only one you can add is a Claude API key or a local Ollama server in Developer mode.
- Open a web page to explain a finding. Explanations are produced on this Mac.

## In-app fixes

Most failing findings have an Apply button. The app shows a sheet with the plain-words change, the commands it will run, and the line that reverses it. User-level changes run straight away. Administrator changes run through one native macOS password dialog per fix, then the affected sections are rechecked and the finding turns green or tells you what happened. A fix for an SSH key without a passphrase asks for the new passphrase in the app and runs `ssh-keygen -p` on that key only.

Settings the app will not change for you (FileVault, SIP, password policy, account changes, deleting launch items) get a button that opens the right System Settings pane. The app then watches the setting while you are away and rechecks on its own when you come back.

Rules, their fix kind and the exact commands are in [docs/RULES.md](docs/RULES.md). The engine's rules are in DESIGN-V02.md section 5.

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

Free, before any purchase: the full scan, the score and grade, every finding with its title, status, evidence and explanation, and the complete fix (including Apply) for the three highest-point failing findings. Fixes for "worth a look" findings are always free, and so is the recheck bundled into every Apply. FileVault is the only critical rule, so an unencrypted disk is always in the free three.

Paid, one licence key: fixes for every finding, "Check again" per finding, AI explanations and Ask.

Licence keys are verified offline with Ed25519 and pasted into the app wherever a lock appears. No account, no phone-home. See [docs/LICENSING.md](docs/LICENSING.md).

## AI on this Mac

AI explanations use Apple Intelligence through the FoundationModels framework, in a small signed helper (`talos-ai`) bundled with the app. Nothing leaves the Mac. The model receives a derived document: rule ids, statuses, severities, points, counts and your profile. No path, process name, file name or other machine text is in it. Model output is schema-checked and rendered as plain text in a card marked "AI explanation, not verified". One switch in Settings turns it off.

Developer mode adds two more providers for people who want them: Claude with your own Anthropic API key (stored in the macOS Keychain), and Ollama on `127.0.0.1:11434`. They receive the same derived document.

## Platform support

macOS 26 and later, universal build. Settings paths and commands are verified on macOS 26 and 27 on Apple silicon. The schema and rule engine are OS-neutral and a `windows-minimal` fixture exists, but there are no Windows or Linux collectors yet.

## Quick start for developers

```sh
pnpm install
pnpm --filter @talos/desktop sidecar:build   # builds the talos-ai helper with xcrun swiftc
pnpm desktop                                 # Tauri dev build with hot reload
pnpm test                                    # vitest in every package
cd apps/desktop/src-tauri && cargo test      # Rust parsers, exec, the fix catalog and the JSON contracts
```

Toolchain versions and the full command list are in [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Repo layout

```
packages/core        rule engine, catalog, fix catalog, explainer chokepoint, licence parsing; pure TypeScript
apps/desktop         Tauri 2 app: React UI and adapters in src/, Rust collectors and fix engine in src-tauri/, Swift helper in sidecar/
scripts/keygen       licence keygen (keypair, issue, verify); never shipped with the app
scripts/scan-cli.ts  run the collector and the engine from the terminal (pnpm scan)
docs                 design, rules, CIS map, development, signing, licensing, security model
```

## Status

v0.2 is in development. Builds are unsigned and not notarised, so they are not for distribution. Do not hand an unsigned build to anyone. See [docs/SIGNING.md](docs/SIGNING.md).

## Known limitations in unsigned builds

In an ad-hoc signed build (every `pnpm desktop` and unsigned `pnpm desktop:build`) the kernel returns an empty TCP socket table to the app, so the listeners, remote access and file sharing sections show as "Couldn't check" and rules TL-MAC-018 to TL-MAC-022 come back `unknown`, never a false pass. A Developer ID signed build gets the full table. This also means the fixes for TL-MAC-019 to TL-MAC-022 cannot be seen to pass under `pnpm desktop`; their recheck comes back `unreadable`. The measurements are in [docs/notes/socket-table-signing.md](docs/notes/socket-table-signing.md).
