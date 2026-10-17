# Licensing

A yearly licence, €24 a year, as an offline key with no account. What happens on day 366 (whether the key keeps working for the version it was bought with, or the paid features lock again) is an open decision of the owner; nothing below depends on it, and `updatesUntil` is the only date the app reads. Core parses and checks the key; the desktop adapter supplies the Ed25519 verifier and the public key.

## Key format

`TL1.<base64url(payload)>.<base64url(signature)>`, about 210 characters.

- `TL1` is the format prefix.
- `payload` is canonical JSON (keys sorted, UTF-8, no whitespace), base64url without padding.
- `signature` is Ed25519 over the exact payload bytes carried in the key. The verifier never re-serialises, so the issuing side and the app cannot disagree about the bytes.

## Payload

| Field | Type | Meaning |
|---|---|---|
| `v` | `1` | payload version |
| `lid` | ULID | licence id. Shown in About. Used by the revocation list. |
| `product` | `"talos-desktop"` | |
| `plan` | `"personal"` or `"business"` | informational in v0.2, shown in About, not enforced |
| `seats` | number | informational in v0.2 |
| `issuedAt` | `YYYY-MM-DD` | |
| `updatesUntil` | `YYYY-MM-DD` | last build date the key accepts |
| `tag` | 8 hex chars | first 8 hex characters of `sha256(lowercased buyer email)` |

The email is never in the key. `tag` is enough to match a leaked key against the order list.

## Validation

`parseLicense(key, verify, buildDate, revoked)` in `packages/core/src/license/parse.ts` checks, in order:

1. Format: three dot-separated parts, prefix `TL1`, both parts decode. Failure: `format`.
2. Signature, through the injected `SignatureVerifier`. Failure: `signature`.
3. Payload parses as JSON with `v: 1` (failure: `version`) and `product: "talos-desktop"` (failure: `product`).
4. `updatesUntil >= buildDate`. Failure: `build_too_new`.
5. `lid` not in the revocation set. Failure: `revoked`.

The result is a `LicenseState`: `none`, `invalid` with the reason, or `valid` with the payload. `entitled(state, feature)` is true for every `Feature` (`all_fixes`, `recheck`, `watch`) when the state is `valid` and false otherwise.

The desktop adapter stores the raw key string in `<app data>/license.key` through Tauri commands and re-verifies it on every launch. No account, no server, no phone-home, no hardware binding.

## Entering a key

There is no licence form. `LicenceField` (`apps/desktop/src/components/LicenceField.tsx`) is one component rendered inline wherever a lock appears: the fix card, the paywall step and the Licence section of Settings. One input, placeholder "Paste your licence key", `autoFocus` when it replaces a button.

- Paste detection. On `paste` or `input`, a trimmed value matching `/^TL1\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{60,}$/` is verified after a 300 ms debounce with no button press. A value that does not match keeps an "Activate" button.
- `checking` disables the field.
- `valid`: "Licensed. Updates until <updatesUntil>" for 800 ms, then the lock is replaced by the content it hid (the fix card, the AI card) and focus moves to it. The sidebar pill reads "Licensed".
- `invalid`: the reason labels from the table above sit under the field with `role="alert"`; focus stays in the field.
- "Buy a licence" calls the `open_buy_page` command, which opens one fixed URL chosen in Rust, `https://taloslabs.si/shop`; the webview never passes a URL. The field stays where it is so the key can be pasted on return. The caption reads "Opens the Talos Labs shop in your browser. Your key arrives by email; paste it here." That web link is the one step outside the app.

The demo build accepts `TL1.DEMO` for typed entry and a second key that matches the paste regex, so the QA harness exercises both paths (`apps/desktop/qa/README.md`). The behaviour is specified in DESIGN-V02.md section 6, "Licence entry".

### The paywall step (v0.3)

The guided check-up has one more place for the key: the paywall step. It appears once per run, after the free steps and never before the first of them, when the plan holds locked rules. The screen reads "There are N more things to fix." with the locked rules' guided headlines, a "Buy the full version, €24 a year" button (the button calls `open_buy_page` as above), the same `LicenceField` inline, and a "Not now" link.

- On `valid`: "Thank you. Carrying on." for 800 ms, then the locked rules are planned by `planLocked` and appended to the run, and the next step opens. The field stays in place while the shop is open in the browser, so the key can be pasted on return.
- "Not now" writes `paywallSnoozedUntil = now + 14 days` into the guided memory and goes to the end screen, where the locked rules are counted under "in the full version". The paywall is absent from every plan for those 14 days; the rules stay locked and are still listed.
- The free set the check-up works with is frozen when the report lands (`GuidedPlan.freeFixes`): fixing one of the free three does not promote a fourth rule into the free set during that run. `freeFixRuleIds` is unchanged; the expert screens keep reading the live gate.

The copy and the step shape are in DESIGN-V03.md section 1, "Step type: paywall", and section 7.

## Keygen

`scripts/keygen/keygen.ts` sits outside the workspace packages and uses `node:crypto` only.

```sh
pnpm exec tsx scripts/keygen/keygen.ts keypair --out ~/.talos/signing.key
pnpm exec tsx scripts/keygen/keygen.ts issue --plan personal --seats 1 --email a@b.c --updates-until 2027-10-15
pnpm exec tsx scripts/keygen/keygen.ts verify <key>
```

- `keypair` writes the private key to `--out` and prints the raw 32-byte public key as hex.
- `issue` reads the private key path from `TALOS_SIGNING_KEY`, generates a ULID for `lid`, computes `tag` from the email, signs the canonical payload and prints the key. The email is used for the hash and then discarded.
- `verify` checks a key against the public key and prints the payload.

The private key never enters the repo. Keep it on one machine with an offline backup. If it is lost, every key issued so far still works, but no new keys can be issued for the shipped public key; the next build would have to ship a new public key and existing buyers would need re-issued keys.

## Public key

Paste the hex printed by `keypair` into `apps/desktop/src/license/public-key.ts` as `LICENSE_PUBLIC_KEY_HEX`. The adapter wraps `@noble/ed25519` around it with a synchronous SHA-512 from `@noble/hashes`. Tests generate a throwaway pair in-process and assert it differs from `LICENSE_PUBLIC_KEY_HEX`, so a test key cannot ship by accident.

The shipped placeholder is 64 zeros. That is a small-order Ed25519 point, for which noble's default ZIP215 mode would accept a forged signature, so `createVerifier` in `apps/desktop/src/license/verifier.ts` refuses it at construction and `createVerifierOrRejectAll` falls back to a verifier that rejects every signature. A build that still carries the placeholder validates no licence at all: every key reports `invalid` with reason `signature` and the app runs unlicensed. The placeholder fails closed. CI (`.github/workflows/ci.yml`) also fails on a tag ref while `public-key.ts` still holds the zeros.

## Revocation

`apps/desktop/src/license/revoked.ts` holds a set of `lid` strings. Add the `lid` of a leaked or refunded key. It takes effect in the next build. There is no online check, so a revoked key keeps working in builds released before the revocation.

## What offline validation can and cannot do

Can:

- Reject forged or edited keys. The private key never leaves the keygen machine.
- Reject keys for another product or an older payload version.
- Reject revoked keys in builds that know about the revocation.
- Trace a leaked key to a purchase through `lid` and `tag`, both shown in About.

Cannot:

- Stop one buyer giving the key to someone else.
- Bind the key to a machine. There is no hardware fingerprint, by design.
- Stop the device owner patching the app binary.
- Revoke in builds already installed.

This is accepted. The price is €24 a year and the app changes nothing the user could not change in System Settings; the goal is to stop casual sharing and forging, not a determined attacker.

## updatesUntil

`updatesUntil` is compared with the build date, compiled into the app by a Vite `define` in `apps/desktop/vite.config.ts`. The system clock plays no part, so moving the clock back does nothing.

- A build dated on or before `updatesUntil` accepts the key indefinitely.
- A build dated after it reports `build_too_new`. The user keeps the older build and its key. A new key is only needed to run newer builds.

So a key covers every build released within its window, typically twelve months from purchase. Whether the window and the licence year are the same thing, and what the app does once the year ends, is the open day-366 decision noted at the top.

## Free tier

Free, with no key: the full scan, the score and grade, every finding with its title, status, evidence and authored explanation, and the complete fix, including Apply and the away-watch, for the three highest-point failing findings. Ties break by catalog order. The recheck bundled into an Apply or a watch is free too. Fixes for `review` findings are always free and do not count towards the three. FileVault is the only critical rule and always lands in the top three when it fails, so nobody is left unencrypted because they did not pay. Connecting ChatGPT, Claude or On this Mac is free, and so is everything the AI does once connected: explanations for every finding, the suggested order, Ask, the plan and end readings (owner decision 2026-10-17; `gate.explainLocked` is always false).

`freeFixRuleIds(report)` in core computes the free set. The gate is a UI check in `apps/desktop`; core always produces the full report. The guided check-up receives that set once per report and freezes it in the plan (see "The paywall step" above); the gate is a product boundary, not a security one, and the fix engine binds and confirms every rule the same way on both sides of it.

Paid (`Feature`):

- `all_fixes`: the fix for every finding.
- `recheck`: the manual "Check again" on a finding, for every finding including the three free ones. The automatic recheck after an Apply or a watch is not gated.
- `watch`: the menu bar watch: the tray item, the timer and its notification; Settings shows no Watch section without it. The webview reports the flag to Rust through `watch_set_profile`; Rust never verifies a key (docs/DESIGN-WATCH.md section 11, note 48).

`explainer` was a `Feature` until 2026-10-17; the AI layer is free once connected (owner decision 2026-10-17).

## Not in v0.2 or v0.3

Payment provider, checkout, key delivery email, licence server, seat enforcement, hardware binding, and the day-366 behaviour (the price is €24 a year; DESIGN-AI.md).
