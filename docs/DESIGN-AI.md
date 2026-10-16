# Talos Labs AI design: your own AI, connected once

v0.3 made the app drive. This document adds the AI the owner wants under it: the person connects the AI they already pay for, ChatGPT or Claude, once, in the browser, and Talos Labs uses it for explanations, the suggested order and Ask. No API key, no second subscription, nothing typed in Terminal. Apple Intelligence stays as the no-account option on Macs that have it.

This document extends `docs/DESIGN-V03.md` and `docs/DESIGN-MINERAL.md`. The security model in `docs/SECURITY-MODEL.md` does not change: the model still receives only the derived document (ids, statuses, counts, the profile), still never runs anything, and its output is still validated before it is shown. Rust still binds every argument and the webview still never writes a command. What changes is who the model is and the sentence "Nothing leaves your Mac", which becomes conditional (section 7).

The owner's brief, which this design serves and does not re-open: "Talos lets you connect to one AI provider you already use, to avoid having to use an API key or buy another AI subscription, such that Talos is super seamless. You pay a one-year licence key that costs 24 euro per year and you fully get to use it with your AI subscriptions." Both developers and non-developers use this. Facts about providers below were checked on 2026-10-16.

Decisions taken where the brief left room:

- **No AI step in Welcome.** v0.3's three taps to a report stay. The connect screen is offered the first time the person opens "Explain this", as a row on the end screen, and in Settings. It is never on the path: no step waits on it.
- **One provider at a time.** "Your AI" is one of ChatGPT, Claude or On this Mac. Switching replaces, it does not add. Developer mode keeps the Claude API key and Ollama as extra providers, unchanged.
- **Connecting is free; explanations follow the free three.** Connecting costs Talos Labs nothing, so the free version may connect and gets explanations for the same three fixes it may apply. The licence unlocks explanations for everything, the suggested order and Ask. This keeps one rule for what is free. The owner has not yet decided what happens after the licence year ends; nothing here depends on that.
- **The sign-in page is always the provider's own, in the browser.** Talos Labs never draws a field for a ChatGPT or Claude password, and never shows an API key field outside Developer mode. For Claude the sign-in belongs to Anthropic's own Claude Code program (section 9); Talos Labs starts it and never sees the result.
- **Honest about what is not available.** Each provider has policy and approval conditions outside the owner's control (section 9). A provider that cannot be offered in a given build is shown as "Not available yet", never hidden and never faked.

## 1. Providers

| Your AI | Who can use it | How the connection works | Where the model runs |
|---|---|---|---|
| ChatGPT | ChatGPT Plus and Pro | "Sign in with ChatGPT" in the browser; the usage counts against the person's ChatGPT plan | OpenAI |
| Claude | Claude Pro and Max | Talos Labs fetches Anthropic's Claude Code program, starts its sign-in in the browser; the usage counts against the person's Claude plan | Anthropic |
| On this Mac | Apple silicon with Apple Intelligence on | nothing to connect (v0.2) | this Mac |

Developer mode only, unchanged from v0.2: Claude with an API key, Ollama at `127.0.0.1:11434`.

Free ChatGPT and free Claude plans are not covered by either route. The connect screen says which plans are needed before the person leaves for the browser.

## 2. Information architecture

**Guided shell.**

- "Explain this" (the v0.3 disclosure on batch, fix and show-me-where steps) gains a not-connected body (section 4). It is the main entry point. The disclosure is rendered whenever AI is not switched off, so a person with no AI connected still sees "Explain this" and learns there what it would take.
- A new guided screen, **Connect**, reached from the disclosure, from the end screen and from Settings. It is a screen in the guided shell, not a plan step: it has no progress line, it does not count, and leaving it returns to where the person was.
- The end screen gains one row, "Get things explained" (section 4), when no AI is connected and the person has not said "Not now" in the last 14 days.

**Expert shell.** The v0.2 `AiCard` gains the provider states in section 3. Ask's header sentence names the provider. Settings' "AI explanations" section becomes "Your AI" (section 5).

**Memory.** `GuidedMemory` gains `aiAskedAt: string | null` (ISO), written by "Not now" on the Connect screen and on the end-screen row. Only a date.

**Settings.** `explainer.provider` gains `"chatgpt"`; `"apple"` is renamed in the UI to "On this Mac" and keeps its stored value. `explainer.aiEnabled` stays the one switch that turns AI off.

## 3. One state machine for every provider

`AiAvailability` (v0.2) grows so one `AiCard`, one Explain disclosure and one Settings row serve every provider.

| state | meaning | who reports it |
|---|---|---|
| `available` | ready to explain | all |
| `not_connected` | no provider chosen, or the chosen one has no sign-in | chatgpt, claude |
| `connecting` | the browser is open for sign-in; for Claude also while the program is fetched | chatgpt, claude |
| `needs_sign_in` | the sign-in expired or was revoked | chatgpt, claude |
| `limit_reached` | the plan's allowance is used up for now; `until` when the provider says | chatgpt, claude |
| `plan_not_eligible` | the account's plan does not include this (a free ChatGPT or Claude account) | chatgpt, claude |
| `provider_unavailable` | the provider could not be reached or answered with an error | chatgpt, claude |
| `not_offered` | this build cannot offer the provider (section 9) | chatgpt, claude |
| `device_not_eligible`, `apple_intelligence_not_enabled`, `model_not_ready`, `helper_unavailable` | v0.2, unchanged | apple |
| `locked` | the gate says this explanation is paid | all, after availability |
| `off` | the AI switch is off | all |

Precedence is as in v0.2: availability before the lock, so an unlicensed person on a Mac that cannot run Apple Intelligence sees the honest state. `locked` renders only when the state would otherwise be `available`.

Probes: ChatGPT and Claude are probed lazily when the first AI surface mounts, never during onboarding or the scan; `connecting` re-probes every 2 s while the window is unfocused and for 10 s after focus returns, for at most 10 min, the same schedule as the permission flow.

## 4. Screens and copy

Every string below is under the v0.3 banned-word test (`apps/desktop/src/guided/copy.ts`). Rule ids are for this document only.

### "Explain this", not connected

The disclosure opens to:

> Talos Labs can explain each of these using the AI you already pay for, ChatGPT or Claude. Nothing to install and no extra cost.
> Connect my AI · Not now

"Connect my AI" opens the Connect screen. "Not now" closes the disclosure and writes `aiAskedAt`; the disclosure stays on later steps (it is small), but the end-screen row is skipped for 14 days.

On a Mac where Apple Intelligence is available the sentence ends "ChatGPT, Claude, or Apple Intelligence on this Mac."

### Connect

> **Which AI do you use?**
> I'll use it to explain what I find, in plain words. I send it a short summary of the check-up, never your files, passwords or your computer's name.
> ○ ChatGPT · Plus or Pro
> ○ Claude · Pro or Max
> ○ On this Mac · Apple Intelligence, no account
> [Connect ChatGPT]
> Not now

Rows are a `radiogroup` at `--text-guided-list` with the kit's 20 px icon slot (kit `extensions` for ChatGPT and Claude until the owner approves provider marks; kit `mac` for On this Mac). The primary's label follows the selection: "Connect ChatGPT", "Connect Claude", "Use this Mac". The default selection is the first row that is not `not_offered`; a `not_offered` row is disabled and reads "Not available yet" in place of its plan line. "On this Mac" is hidden on a Mac that reports `device_not_eligible`; when it is the only row, the screen is not offered at all and the v0.2 honest card shows instead.

Provider marks: the design uses the names "ChatGPT" and "Claude" as plain text. Logos are not used until their trademark terms have been read; the kit's own icons carry the rows.

"Use this Mac" sets the provider to `apple` and returns with the tick "Done. I'll explain things on this Mac." The Apple Intelligence states (`apple_intelligence_not_enabled` and so on) then render as in v0.2.

### Connecting, ChatGPT

> **I've opened ChatGPT in your browser.**
> Sign in there and say yes when it asks. Then come back here.
> ⟳ I'll notice when you're done.
> Cancel

The spinner line is `role="status"`. The browser page is OpenAI's own. On return with a token: tick, "Done. ChatGPT is connected.", 1400 ms, then back to the screen the person came from (the step's disclosure now open and streaming, the end screen, or Settings).

### Connecting, Claude

Two status lines, in order, because the program may have to be fetched first:

> **Getting Claude ready.**
> I'm fetching Claude's own helper from Anthropic. This happens once.
> ⟳ About a minute.

then

> **I've opened Claude in your browser.**
> Sign in there and say yes when it asks. Then come back here.
> ⟳ I'll notice when you're done.
> Cancel

The fetch shows no percentage (section 9 says why). A fetch that fails: "**I couldn't fetch Claude's helper.** Check your internet connection and try again." with Try again · Not now. When the helper is already on the Mac the first screen is skipped.

### Connect failures

| state after the attempt | headline | sentence | button · link |
|---|---|---|---|
| the browser page was closed, or Cancel | You stopped before signing in. | Nothing was connected. | Try again · Not now |
| `plan_not_eligible` | That account's plan doesn't include this. | ChatGPT Plus or Pro is needed. (or: Claude Pro or Max is needed.) | Choose another · Not now |
| `provider_unavailable` | ChatGPT didn't answer. | Nothing was connected. Try again in a little while. | Try again · Not now |
| 10 min with no return | I stopped waiting. | Nothing was connected. | Try again · Not now |

"Choose another" returns to the Connect screen with the failed row still selectable. "Not now" writes `aiAskedAt` and goes back.

### Explain, after connecting

The v0.3 panel, with the model text streaming field by field and the Stop link. The badge under the text names the provider: "Written by ChatGPT. Not verified." / "Written by Claude. Not verified." / the v0.2 "Written on this Mac by Apple Intelligence. Not verified."

When the state changes under the person, the panel body says so in one line with one text button:

| state | line | button |
|---|---|---|
| `needs_sign_in` | ChatGPT signed me out. | Sign in again |
| `limit_reached` | Your ChatGPT allowance is used up for now. It comes back on its own. (with `until`: "It comes back at 18:00.") | none |
| `provider_unavailable` | ChatGPT didn't answer. | Try again |
| `locked` | Explaining everything is in the full version. | Unlock (opens the paywall step) |

The authored explanation (`whyItMatters` from the catalogue) is always shown on the Details screen, so a failed or locked AI never leaves the person with nothing.

### End screen row

Under the groups of the v0.3 end screen and before "Check again", when `not_connected` and `aiAskedAt` is absent or older than 14 days:

> Get things explained · Connect the AI you already use ›

One `button.guided-end-row` with the kit `extensions` icon. It opens Connect; Connect's "Not now" writes `aiAskedAt`. The row is never the "Do this next" card.

### Paywall step

The v0.3 paywall gains the AI line and the price. `£PRICE` becomes `€24 a year`.

> **There are 4 more things to fix.**
> The full version does them all, explains everything with your own AI, and lets you ask questions.
> • (the locked headlines, as in v0.3)
> [Buy the full version, €24 a year]
> [Paste your licence key          ]
> Not now

The v0.3 sentence "One payment, yours to keep." is removed, because the price is yearly. The shop page and the FAQ in the design kit's `website/` say "one-time purchase" and "no subscription"; they are wrong under this price and must be rewritten with the owner's final wording before launch (section 10).

### Ask

The header sentence: "Questions are answered from this report only. Answered by ChatGPT. Not verified." The composer is disabled with the Connect row above it when `not_connected`: "Connect your AI to ask questions." with a Connect button (expert shell, so a real button is allowed). Everything else is v0.2.

### Overview `AiCard`

| state | copy | action |
|---|---|---|
| `not_connected` | "Get the order explained by the AI you already use." | Connect my AI |
| `connecting` | "Waiting for you to sign in to ChatGPT in your browser." | Cancel |
| `needs_sign_in` | "ChatGPT signed me out." | Sign in again |
| `limit_reached` | "Your ChatGPT allowance is used up for now. It comes back on its own." | none |
| `plan_not_eligible` | "That ChatGPT account's plan doesn't include this. Plus or Pro is needed." | Choose another |
| `provider_unavailable` | "ChatGPT didn't answer." | Try again |
| `not_offered` | "ChatGPT isn't available in this version yet." | Choose another |

The v0.2 rows for the Apple states, `available_idle`, `streaming`, `ready`, `failed` and `locked` are unchanged. "Connect my AI" and "Choose another" open the Connect screen in the guided shell and return to the Overview afterwards.

## 5. Settings: "Your AI"

Replaces the v0.2 "AI explanations" section, in the same grouped style.

1. Row "Your AI": the provider name and a status pill: "Connected", "Needs sign-in", "Limit reached", "Not connected", "Ready" (On this Mac), "Not available yet". Trailing button: "Change" (opens Connect), and "Disconnect" when a ChatGPT or Claude sign-in exists. Disconnect clears the stored sign-in on this Mac (and, for Claude, Claude Code's own stored sign-in in Talos Labs' config folder); it does not delete the fetched program.
2. Switch "Explain things with my AI" (`explainer.aiEnabled`). Off hides every AI surface, as in v0.2.
3. One sentence: "Talos Labs sends your AI a short summary of the check-up: which things passed or failed, and how you use your Mac. Never file names, paths, passwords or your computer's name."
4. Developer mode, unchanged: provider radios gain "ChatGPT" and keep "Claude API key" and "Local Ollama"; the Keychain API key field; the model ids. A new read-only line shows the fetched Claude Code version and its signing identity, and the ChatGPT client id.

The About section's privacy sentence becomes conditional (section 7).

## 6. What the provider receives

Unchanged: the derived document from `packages/core/src/explainer/context.ts` (rule ids, statuses, severities, points, counts, enum values, the profile) plus the catalogue text for the rules involved. No path, process name, share name, file name, hostname or account name. The canary test in `packages/core` keeps proving it, and now runs against the ChatGPT and Claude adapters too. Output is schema-checked and command-text-checked before it is shown, and a rejected output removes the partial text and keeps the authored explanation, as in v0.2.

Two things are new and must be in the privacy page: the summary leaves the Mac, and the provider sees that the person uses Talos Labs. ChatGPT also records the app under the person's ChatGPT settings, where they can limit or remove it.

## 7. The privacy sentence

"Nothing leaves your Mac" is true for the check-up and the fixes, and true for AI only with On this Mac. The copy becomes:

- Welcome body (v0.3): unchanged, "I'll look at your Mac's safety settings and fix what I can. Nothing leaves your Mac." The check-up has not involved AI yet, and the Connect screen says what will be sent before anything is.
- Connect screen: the sentence in section 4.
- Settings and About: "Your check-up and your fixes never leave this Mac. With ChatGPT or Claude connected, Talos Labs sends them a short summary of the results and nothing else." With On this Mac: the v0.2 sentence.
- README, the website home, privacy page and FAQ: the same two-part statement. The FAQ answer "Does Talos Labs upload my report? No." is rewritten: the report is never uploaded; a summary is sent to the AI the person chose, and only then.

## 8. Rules

- The person signs in on the provider's own page in the browser. Talos Labs never draws a password field for ChatGPT, Claude or the Mac, and never shows an API key field outside Developer mode.
- One provider at a time. Switching replaces.
- AI is never on the path. No step, scan or fix waits on a connection, an explanation or a probe.
- Every AI text carries the provider's name and "Not verified".
- The app is complete with AI off, as in v0.2 and v0.3.
- No nagging: the end-screen row and the disclosure's "Not now" are honoured for 14 days; there is no banner, notification or badge about AI.
- A provider the build cannot offer is shown as "Not available yet", never hidden and never pretended.
- Plan limits are the provider's. Talos Labs shows the state and never retries on its own more than once.

## 9. Routes, for the implementers

Facts checked on 2026-10-16. Both routes have conditions outside the owner's control; the owner has chosen not to pursue approvals before the product works. The design therefore holds a `not_offered` state per provider so a build can ship with either one switched off.

**ChatGPT: Sign in with ChatGPT with plan usage.** Announced by OpenAI at DevDay 2026-09-29 for ChatGPT Plus and Pro. Desktop flow: OpenID Connect with PKCE (`S256`), loopback redirect on `127.0.0.1` (for example `http://127.0.0.1:1455/auth/callback`), scopes `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`, first registration with `client_id=dynamic_agent_client` and `agent_name_hint` set to the app name, after which the callback returns an issued `oaiapp_…` client id to store. Inference: `POST https://api.openai.com/v1/responses` with `Authorization: Bearer <access_token>`, `"store": false`, `"stream": true`, a model from the account's model list; wait for `response.completed`. Tokens live in the macOS Keychain through the existing `SecretStorePort`. Condition: open-source apps are self-serve; a closed-source, paid app needs OpenAI's approval in a limited trial. Until then the ChatGPT row is `not_offered` in release builds. Docs: `https://developers.openai.com/siwc/quickstart`, `/siwc/token-sharing-open-source/sign-in`, `/siwc/token-sharing-open-source/models-and-inference`.

**Claude: the person's own Claude Code, signed in with their plan.** Anthropic allows a product to run the unmodified Claude Code binary with the end user's own subscription under its Commercial Terms, and forbids apps that offer a Claude.ai login of their own, route plan credentials, or hold Claude tokens (`https://code.claude.com/docs/en/legal-and-compliance`, "Authentication and credential use"; `https://support.claude.com/en/articles/15036540`, updated 2026-10-07). Talos Labs therefore: fetches Anthropic's official build (URL and checksum to be taken from Anthropic's install documentation at build time) into Talos Labs' own application support folder; verifies `Developer ID Application: Anthropic PBC (Q6L2SF6YDW)` with `codesign` before every launch; runs it with `CLAUDE_CONFIG_DIR` pointing at a Talos-owned folder so the person's own Claude Code setup never loads; starts `claude auth login` under the existing pty (`fix/pty.rs`) so the browser opens and the stored sign-in lands in that folder; reads `claude auth status` (`authMethod: "claude.ai"`) as the probe. Explanations run `claude -p --safe-mode --disable-slash-commands --tools "" --allowedTools StructuredOutput --strict-mcp-config --system-prompt <talos> --max-turns 2 --no-session-persistence --permission-prompts none --output-format stream-json --verbose --include-partial-messages --json-schema <schema>` in an empty temporary directory, which was verified on Claude Code 2.1.287 on 2026-10-16: the only tool loaded is `StructuredOutput`, no MCP servers, no slash commands, no session file written, text streams as `content_block_delta`, exit 0 with `structured_output` matching the schema. `--bare` cannot be used because it ignores the plan sign-in. Minimum version 2.1.259 (`--permission-prompts`). Conditions: whether an app may start the sign-in for the person is not confirmed by Anthropic; the owner has chosen not to ask yet. The fetch has no reliable size, hence no percentage.

**Not chosen.** Codex CLI as a route for ChatGPT (would need an install and has no stated policy for commercial apps); Talos as a connector inside ChatGPT or Claude (the conversation would happen in their app); a Talos-hosted AI service (needs a server and an account, which the product does not have).

## 10. Copy that must change elsewhere

- `readme.md`: "the AI runs on this Mac" and "Nothing leaves" (section 7); "a desktop app you buy once" and the "Free and paid" section (yearly price, explanations in the full version).
- `docs/LICENSING.md`: the yearly price; the day-366 behaviour is an open decision.
- `docs/SECURITY-MODEL.md`: the two new network destinations and the Keychain item for ChatGPT.
- Design kit `website/shop.html` and `faq.html`: "one-time purchase", "no subscription", "£0", "Price to be confirmed"; the home page's AI claim ("optional on-device AI"). The kit is the designer's deliverable; these are listed for the owner, not edited here.
- `docs/DESIGN-BRIEF.md` is superseded by the kit and by this document; a note at its top says so.

## 11. Tests and shots

- `copy.test.ts`: every new guided string under the banned-word test.
- Core: the canary test against the ChatGPT and Claude adapters; a schema test for the stream parser of each.
- Desktop: `AiCard` renders every state in section 3; the Connect screen's radio group, disabled `not_offered` row, and label change; `aiAskedAt` honoured for 14 days on the end screen; Disconnect clears the Keychain item (demo secret store).
- Rust: signature check refuses an unsigned or differently signed binary; `CLAUDE_CONFIG_DIR` is set on every spawn; the spawn uses no shell.
- Harness, demo mode, light and dark, 900 and 1100: `guided-connect`, `guided-connect-chatgpt-waiting`, `guided-connect-claude-fetching`, `guided-connect-done`, `guided-connect-failed-*`, `guided-explain-not-connected`, `guided-end-connect-row`, `guided-paywall-yearly`, `settings-your-ai-*`, `ask-not-connected`, `overview-ai-*`. axe on each.
- Only on a real Mac: the real ChatGPT sign-in (needs the issued client id), the Claude fetch and sign-in, `codesign` on the fetched binary.

## 12. Out of scope

Payment and the licence year's end; Windows and Linux; provider logos; Codex, Gemini and other providers; a Talos-hosted service; using the AI to decide what to fix (the plan stays a pure function).
