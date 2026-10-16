# @talos/desktop

Tauri 2 app: React UI and port adapters in `src/`, Rust collectors, fix engine and commands in `src-tauri/`, the Swift `talos-ai` helper in `sidecar/`. Start with the root [README](../../README.md) for what the app does.
Commands, TCC permissions, the sidecar build and how to add a rule, a fix or a collector are in [docs/DEVELOPMENT.md](../../docs/DEVELOPMENT.md).
Run `pnpm --filter @talos/desktop sidecar:build` once, then `pnpm desktop` from the repo root to start it. The browser QA harness is described in [qa/README.md](qa/README.md).
