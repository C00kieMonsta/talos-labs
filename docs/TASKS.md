# Task ledger

Every request from the owner, in the order it was made, with its state. Updated at every milestone. States: done, in progress, designed (spec written, nothing built), waiting on owner, declined by owner, deferred by owner.

| # | Asked | Request | State | Where |
|---|---|---|---|---|
| 1 | 2026-10-16 | Describe Talos for a designer, Apple-style | done, superseded by the Mineral kit | docs/DESIGN-BRIEF.md |
| 2 | 2026-10-16 | Research using a Claude or ChatGPT subscription from inside Talos, no back and forth with their chat apps | done | this ledger's section "Provider routes"; docs/DESIGN-AI.md section 9 |
| 3 | 2026-10-16 | Use the terminal CLIs (claude, codex) as the AI layer | done for Claude (the user's own Claude Code, locked down); Codex not chosen, ChatGPT uses Sign in with ChatGPT | docs/DESIGN-AI.md |
| 4 | 2026-10-16 | AI for every user, not Developer mode; one licence at EUR 24 a year; connect the AI you already pay for | done, merged | docs/DESIGN-AI.md, branch ai-layer merged into main |
| 5 | 2026-10-16 | Finish the design first, then the AI layer | done | docs/DESIGN-WARMTH.md pass, then the AI layer |
| 6 | 2026-10-16 | Menu bar window that keeps checking for threats, an agent that catches what rules miss, suggestions grounded in published incident-response playbooks (cut the internet, isolate) | built and merged; clicks fixed on macOS 26 and later on 2026-10-17; window shown working by the owner | docs/DESIGN-WATCH.md, apps/desktop/src-tauri/src/watch, tray.rs |
| 7 | 2026-10-16 | Proceed until fully done (AI layer) | done | review rounds, QA, final report |
| 8 | 2026-10-17 | Proceed with recommended actions | done: commit and merge, site copy, favicon. Declined by owner: OpenAI and Anthropic approvals. Deferred by owner: day-366 rule | commits d15db7b and after |
| 9 | 2026-10-17 | OpenAI and Claude connections failing | done, owner confirmed both connect | commit 17f5312 |
| 10 | 2026-10-17 | More AI magic once an AI is connected | designed, not built | docs/DESIGN-AI-PRESENCE.md |
| 11 | 2026-10-17 | The top bar must run in the background with regular checks against defence strategies | done (hourly cycle, playbook-grounded fishy flow); the window's content is being redesigned under #15 | docs/DESIGN-WATCH.md |
| 12 | 2026-10-17 | Chat-first home when an AI is connected; no chat without one | designed, not built | docs/DESIGN-CHAT.md |
| 13 | 2026-10-17 | "I know, leave it alone" per finding, e.g. disk encryption | designed, not built | docs/DESIGN-ACCEPT.md |
| 14 | 2026-10-17 | Ask locked while Claude is connected | explained; owner decided AI is free once connected and the licence buys fixes, rechecks and the watch; real signing key shipped and a licence issued to the owner | done: AI free once connected, the licence buys fixes beyond the free three, Check again and the watch; key in 37c55c7 |
| 15 | 2026-10-17 | The menu bar window is not nice or useful; it needs AI | designed, not built | docs/DESIGN-WATCH-WINDOW.md |
| 16 | 2026-10-17 | In general the AI magic is missing | in progress: #10, #12, #13 and #15 are the pieces; build starts when the gate workflow has stopped editing the tree | this ledger |
| 17 | 2026-10-17 | Keep track of every task; nothing left undone | done, this file | docs/TASKS.md |
| 18 | 2026-10-17 | Import any UI element worth reusing from the Mineral kit | done: the prototype was already ported class for class (docs/DESIGN-MINERAL.md section 1); added the site hero's rings as `Hero kind="rings"` (available, not mounted) and the editable DMG and app-icon sources | apps/desktop/src/components/Hero.tsx, apps/desktop/brand/mineral/README.md |
| 19 | 2026-10-17 | The top bar app is not showing any more | explained: the watch is licence-only since #14 and this Mac had no key pasted; a key was issued for the owner (session talos-labs-95, /tmp/talos-owner-licence.txt), and the one from #14 works too | watch-settings.json `licensed`, tray.rs `set_state` |
| 20 | 2026-10-17 | A better chat interface, like a modern agent-driven app | designed, build next with #12 (talos-labs-95); index docs/DESIGN-ITERATION-4.md | docs/DESIGN-CHAT-UI.md with docs/DESIGN-CHAT.md |
| 21 | 2026-10-17 | More playful interactions | designed; building (talos-labs-95, first in the build order) | docs/DESIGN-PLAYFUL.md |
| 22 | 2026-10-17 | More threat-detection strategies | designed, not built; proposed for the watch owner session after #13 and #15 | docs/DESIGN-THREATS-V2.md |
| 23 | 2026-10-17 | More agentic capabilities | designed; part A (activity timeline) building (talos-labs-95), part B after the chat | docs/DESIGN-AGENT.md |
| 24 | 2026-10-17 | Interpretation of daily checks | designed, not built; after THREATS, same session | docs/DESIGN-DAILY.md |

## Standing items the owner must do or decide

- Back up `~/.talos/signing.key`. It is the only copy of the licence signing key.
- Sign and notarise with a Developer ID (docs/SIGNING.md). Until then the network signals of the watch read "couldn't check" and notifications arrive under Terminal's name.
- Choose a payment provider and wire the shop (docs/LICENSING.md).
- Decide the day-366 behaviour of a licence (deferred).
- Answer the open questions in docs/DESIGN-AI-PRESENCE.md section 9, docs/DESIGN-CHAT.md and docs/DESIGN-ACCEPT.md, or accept their defaults, which the build will take.

## Verified by the owner on a real Mac

- ChatGPT and Claude sign-in and connection (2026-10-17).
- The menu bar icon, its window and "Check now" (2026-10-17).

## Not yet verified by anyone on a real Mac

- A full fishy flow on a real change (only the demo).
- Notifications in a signed build.
- The watch's first real model call through Claude or ChatGPT.
- The AI-presence, chat and accept features (not built).
