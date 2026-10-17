# Talos Labs

Talos Labs is a desktop app with a yearly licence, €24 a year. It reads the security settings of the Mac it runs on, judges them against the CIS Apple macOS Benchmark, explains to a non-expert what is wrong and why it matters for them, and fixes most of it in place. There is no account and no server. The only background work is the optional menu bar watch, which re-reads the same settings on a timer and can be switched off. The scan runs locally and the report stays on the machine. Explanations come from the AI you already use, ChatGPT or Claude, connected once in the browser, or from Apple Intelligence on this Mac; the AI receives a short summary of the results and nothing else. Talos Labs lives at taloslabs.si; the shop is https://taloslabs.si/shop.

## The check-up

The guided check-up is the home screen. Open the app and it checks your Mac. It then fixes what it can with one administrator password, shows you where in System Settings for the rest and watches the setting until you have changed it, and asks nothing else. Each step is one plain sentence, one button and one link. "Details" is one link away on every step and opens the expert screens (Overview, Findings, Ask, Settings) that v0.2 shipped; the two views read the same report, so a fix made in either is seen by the other.

The main window speaks only when it is opened. The menu bar watch re-reads your settings on a timer you choose, shows a small icon, and tells you once when something needs doing now, never about anything else. It is not antivirus: it reads settings and start-up lists, never your files. See [docs/DESIGN-WATCH.md](docs/DESIGN-WATCH.md). A step you put off with "Do this later" stays away for 7 days and, after three times, for good. Settings has two switches to turn the automatic check and the guided home off. The flow is specified in [docs/DESIGN-V03.md](docs/DESIGN-V03.md).

## Design rule

Code collects and judges. The LLM explains. Fixes come from a fixed table.

- Collectors (Rust, `apps/desktop/src-tauri`) run a fixed list of read-only system commands, without a shell and without root, and produce a `SystemState` made of booleans, enums, counts, versions, ports, process names and config paths.
- The rule engine (TypeScript, `packages/core`) turns that state into a score, a grade and a list of findings. It is pure: no OS access, no network, same output for the same input.
- The explainer receives rule ids, statuses, severities and numbers. It never receives text from the machine, never writes fix steps and never runs anything. Every finding has an authored explanation and a complete fix, so the app is complete with AI switched off.
- The fix engine (Rust, `src-tauri/src/fix`) applies only entries of a compiled-in catalog. Each entry is an absolute program path and literal arguments. The user interface cannot name a program or add an argument; it names a rule and, where a rule needs one, picks a share or a key from the scan result.

The boundaries are described in [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md).

## Design

The look follows the Mineral design kit at `Talos-Labs-Mineral-Design-Kit-v1/`: warm sand, paper and clay surfaces, hairline borders, the system font, a rust accent that is only ever an action colour, and a status that always has a word and an icon. The app icon is the Mineral spiral, generated from `apps/desktop/brand/mineral/app-icon/icon-1024.png`. Tokens, the severity and grade colours with their contrast numbers, and the icon policy are in [docs/DESIGN-MINERAL.md](docs/DESIGN-MINERAL.md).

<img src="apps/desktop/brand/mineral/app-icon/icon-1024.png" width="96" alt="Talos Labs app icon: a thin spiral on a sand square">

## Requirements

- macOS 26 or later. The app is a universal build and runs on Apple silicon and Intel.
- For AI explanations: a ChatGPT Plus or Pro account, a Claude Pro or Max account, or Apple silicon with Apple Intelligence turned on. Without any of them the AI card says so and everything else works.
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

- Read file contents, with two narrow exceptions: the first 4 KiB of an SSH key, to classify its header, and the fixed list of shell config files, scanned line by line for secret patterns. In both cases the bytes stay inside the collector. A dotfile hit records the file, the pattern name and the line number, never the matched value. The menu bar watch opens no file contents of its own: it runs `codesign` on a new start-up program, which hashes the file itself, and reads `/etc/hosts`, the two `sudo` entries under `/etc/pam.d` and the SSH server and `authorized_keys` files for size, mode and date only, plus a count of the SSH server's config folder.
- Read documents, mail, messages, photos, browser history, saved passwords or the Keychain.
- Send the hostname, the names of shared folders, the arguments of background programs or any file path anywhere. Your account name is part of file paths shown in the report (an SSH key under your home folder, for example). Those paths stay on this Mac and never reach a model.
- Run as root. Collectors never need an administrator password. A fix that does (the firewall, remote access, sharing, updates, the guest account) shows the exact commands first, then asks macOS to show its own administrator dialog once for the whole fix, or once for the whole batch in the check-up. The app never sees the password, never stores it and never runs a shell.
- Run anything the catalog does not list, apart from the fixed programs it starts itself: the read-only collectors, the `talos-ai` helper and Anthropic's signature-checked Claude Code, each with literal arguments and no shell. There is no free-form command path, in the app or in the AI.
- Talk to the network, except to the AI you connected. The check-up and the fixes open no connection. With ChatGPT or Claude connected, the only outbound traffic is the sign-in (the provider's own page in your browser and, for Claude, a fetch of Claude Code from Anthropic unless a signed copy is already installed), the short summary sent for each explanation and, for ChatGPT, a token refresh to OpenAI when the sign-in is about to expire or once after OpenAI rejects the current token on an explanation request. Developer mode adds a Claude API key or a local Ollama server. With AI switched off, or with On this Mac, there is no outbound connection at all.
- Open a web page to explain a finding. The only pages it opens are the provider's own sign-in page when you connect ChatGPT or Claude, and the shop when you click Buy. Explanations come back into the app from the AI you connected, or are written on this Mac by Apple Intelligence.

## In-app fixes

Most failing findings have an Apply button. The app shows a sheet with the plain-words change, the commands it will run, and the line that reverses it. User-level changes run straight away. Administrator changes run through one native macOS password dialog per fix, then the affected sections are rechecked and the finding turns green or tells you what happened. A fix for an SSH key without a passphrase asks for the new passphrase in the app and runs `ssh-keygen -p` on that key only.

The check-up groups the fixes that need no choice and no secret (13 of the 15 in-app rules; never the shared folder or the SSH key) into one batch with one password dialog. Each item is the same catalog command line as the single fix, rechecked one by one afterwards, and an item that fails does not stop the others. The batch engine is described in DESIGN-V03.md section 3 and [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md).

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

Free, before any purchase: the full scan, the score and grade, every finding with its title, status, evidence and explanation, the complete fix (including Apply) for the three highest-point failing findings, connecting your AI, and everything it does once connected: explanations for every finding, the suggested order and Ask. Fixes for "worth a look" findings are always free, and so is the recheck bundled into every Apply. FileVault is the only critical rule, so an unencrypted disk is always in the free three.

Paid, one licence key at €24 a year: fixes for every finding, "Check again" per finding, and the menu bar watch. What happens after the licence year ends is not decided yet (docs/LICENSING.md).

In the check-up the free three are fixed first, and the paywall is one step after them with the key field inline. The free set is frozen when the check-up lands, so fixing one free finding does not unlock the next (DESIGN-V03.md section 1 and section 8).

Licence keys are verified offline with Ed25519 and pasted into the app wherever a lock appears. No account, no phone-home. See [docs/LICENSING.md](docs/LICENSING.md).

## Your AI

Talos Labs explains things with the AI you already pay for. You connect ChatGPT (Plus or Pro) or Claude (Pro or Max) once, on the provider's own sign-in page in your browser; no API key and no second subscription. On Apple silicon with Apple Intelligence turned on, "On this Mac" is the no-account option: it uses the FoundationModels framework through a small signed helper (`talos-ai`) bundled with the app, and nothing leaves the Mac. The Claude route runs Anthropic's own Claude Code program, fetched from Anthropic and signature-checked before every launch, under a Talos-owned config folder, so your own Claude Code setup is never touched. A Claude Code already installed under `~/.local/share/claude/versions` or at `~/.local/bin/claude` is used read-only when it is signed by Anthropic and at least 2.1.259; otherwise the stable build is fetched. Every build offers both ChatGPT and Claude. A build made with `TALOS_CHATGPT_OFF` or `TALOS_CLAUDE_PLAN_OFF` set to any value turns that row to "Not available yet"; with both set, On this Mac is the only option. See [docs/DESIGN-AI.md](docs/DESIGN-AI.md) and [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md).

Your check-up and your fixes never leave this Mac. With ChatGPT or Claude connected, Talos Labs sends them a short summary of the results and nothing else: rule ids, statuses, severities, points, counts and your profile. No path, process name, file name or other machine text is in it. Model output is schema-checked and rendered as plain text in a card marked with the provider's name and "Not verified". One switch in Settings turns it off.

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
packages/core        rule engine, catalog, fix catalog, guided plan, explainer chokepoint, licence parsing; pure TypeScript
apps/desktop         Tauri 2 app: React UI, guided flow and adapters in src/, Rust collectors and fix engine in src-tauri/, Swift helper in sidecar/
scripts/keygen       licence keygen (keypair, issue, verify); never shipped with the app
scripts/scan-cli.ts  run the collector and the engine from the terminal (pnpm scan)
docs                 design, rules, CIS map, development, signing, licensing, security model
```

## Status

v0.3 (the guided check-up) is in development on top of v0.2. Builds are unsigned and not notarised, so they are not for distribution. Do not hand an unsigned build to anyone. See [docs/SIGNING.md](docs/SIGNING.md).

## Known limitations in unsigned builds

In an ad-hoc signed build (every `pnpm desktop` and unsigned `pnpm desktop:build`) the kernel returns an empty TCP socket table to the app, so the listeners, remote access and file sharing sections show as "Couldn't check" and rules TL-MAC-018 to TL-MAC-022 come back `unknown`, never a false pass. A Developer ID signed build gets the full table. This also means the fixes for TL-MAC-019 to TL-MAC-022 cannot be seen to pass under `pnpm desktop`; their recheck comes back `unreadable`. The measurements are in [docs/notes/socket-table-signing.md](docs/notes/socket-table-signing.md).
