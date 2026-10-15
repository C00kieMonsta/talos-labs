# Licensing

One-off purchase, offline key, no account. Core parses and checks the key; the desktop adapter supplies the Ed25519 verifier and the public key.

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
| `plan` | `"personal"` or `"business"` | informational in v0.1, shown in About, not enforced |
| `seats` | number | informational in v0.1 |
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

The result is a `LicenseState`: `none`, `invalid` with the reason, or `valid` with the payload. `entitled(state, feature)` is true for every `Feature` when the state is `valid` and false otherwise.

The desktop adapter stores the raw key string in `<app data>/license.key` through Tauri commands and re-verifies it on every launch. No account, no server, no phone-home, no hardware binding.

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

This is accepted. The price is one-off and the app is read-only; the goal is to stop casual sharing and forging, not a determined attacker.

## updatesUntil

`updatesUntil` is compared with the build date, compiled into the app by a Vite `define` in `apps/desktop/vite.config.ts`. The system clock plays no part, so moving the clock back does nothing.

- A build dated on or before `updatesUntil` accepts the key indefinitely.
- A build dated after it reports `build_too_new`. The user keeps the older build and its key. A new key is only needed to run newer builds.

So "one-off purchase" means every build released within the window, typically twelve months from purchase.

## Free tier

Free, with no key: the full scan, the score and grade, every finding with its title, status, evidence and authored explanation, and the complete fix for the three highest-point failing findings. Ties break by catalog order. Fixes for `review` findings are always free and do not count towards the three. FileVault is the only critical rule and always lands in the top three when it fails, so nobody is left unencrypted because they did not pay.

`freeFixRuleIds(report)` in core computes the free set. The gate is a UI check in `apps/desktop`; core always produces the full report.

Paid (`Feature`):

- `all_fixes`: the fix for every finding.
- `recheck`: single-section re-collection ("I've done this, check again"), for every finding including the three free ones.
- `explainer`: the AI explanation, prioritisation and follow-up questions.

## Not in v0.1

Payment provider, checkout, key delivery email, licence server, seat enforcement, hardware binding.
