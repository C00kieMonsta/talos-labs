# QA harness

Drives the web build of the desktop app in headless Chrome. The app runs in **demo mode**: every port is backed by a core fixture, so nothing touches Tauri, the Keychain, the filesystem or the network. Google Chrome must be installed; `playwright-core` launches it with `channel: "chrome"`.

## Start the demo server

```sh
cd apps/desktop
pnpm dev:demo                                   # port 1430
VITE_TALOS_DEMO=1 pnpm exec vite --strictPort --port 1431   # any other port
```

Then open `http://localhost:1430/?reset=1` in a browser. Both scripts below start a server themselves when nothing answers on the port they were given, and kill it again when they finish. A server you started yourself is left alone.

Demo mode is a build-time switch. `VITE_TALOS_DEMO=1` must be in the environment of the Vite process; nothing in the page or in localStorage can turn it on. `tauri dev` and `tauri build` refuse to run with it set. See `docs/SECURITY-MODEL.md`.

## URL parameters

All optional. They are read once, when the page loads.

| Parameter | Values | Effect |
|---|---|---|
| `fixture` | `dev-machine` (default), `hardened`, `all-unavailable`, `fresh-install`, `windows-minimal` | The `SystemState` the collector returns |
| `delay` | milliseconds, default `120` | Pause per section while collecting, so the Scanning screen stays visible (17 sections) |
| `explainer` | `not_configured`, `no_api_key`, `network`, `auth`, `timeout`, `rejected_output`, `refused`, `unknown` | Every in-app explainer call fails with this reason. Absent: the fake explainer answers after 300 ms |
| `reset` | `1` | Clears localStorage before boot |
| `provider` | `browser`, `none`, `claude`, `ollama` | Pre-seeds the AI provider. `claude` and `ollama` also turn Developer mode on |
| `dev` | `1` | Developer mode on |
| `onboarded` | `1` | Skips the Welcome screen |
| `licensed` | `1` | Pre-installs the demo licence |

Example: `http://localhost:1430/?reset=1&fixture=all-unavailable&onboarded=1&delay=0`.

What the demo adapters do:

- Collect emits `started` then `ok` or `unavailable` per section in `SECTION_KEYS` order, honours cancel, then resolves the fixture. Rechecks return the fixture section again. Full Disk Access reads as not granted.
- The licence accepts exactly `TL1.DEMO` (plan personal, 1 seat, id `demo`, tag `deadbeef`). Any other key is rejected as unsigned. Remove clears it.
- Secrets and the last report live in memory and vanish on reload. Settings use localStorage as in the real app.
- Opening a System Settings pane or the browser assistant opens nothing. Each call is pushed onto `window.__talosDemoCalls` as `{ kind: "openSettingsPane", arg: pane }` or `{ kind: "openAssistant", arg: assistant, prompt }`, so a script can assert on it.
- The in-app explainer (`provider=claude` or `ollama`) returns canned British English that passes core's validators: a prioritisation is a permutation of the eligible ids and no text contains a command line.

## Screenshots

```sh
cd apps/desktop
pnpm exec tsx qa/snap.ts --port 1430 --out qa/screenshots/<name>
```

Walks every screen (Welcome empty and filled, Overview, Findings, a free and a locked finding, Settings with Developer mode off and on, a finding with Terminal commands, Ask locked and answered, an AI explanation and a suggested order, About unlicensed and licensed, Scanning mid-scan, the Couldn't-check cards on `all-unavailable`, Overview on `hardened` and `fresh-install`, Overview and Findings on `windows-minimal`) and saves each in light and dark at 1100x760 and 900x600 as `<screen>-<variant>-<scheme>-<width>.png`. Screenshots are full page: the content column is unrolled so the whole screen is visible. The list of files is printed to stdout. `qa/screenshots/` is git-ignored.

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
