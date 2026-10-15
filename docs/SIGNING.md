# Signing and notarisation (macOS)

Status: not wired up in v0.1. CI builds web assets only and never signs. Nothing here runs until the owner has an Apple Developer Program membership and a certificate. Until then every build is unsigned and must not be distributed.

## Why an unsigned security tool will not be trusted

Talos Labs asks for Full Disk Access and Automation. macOS and the user both decide whether to grant that by looking at who signed the app.

- Gatekeeper refuses unsigned and un-notarised apps downloaded from the internet. Since macOS 15 there is no Control-click Open override; the user has to find "Open Anyway" in Privacy & Security, which most people will not do, and should not do, for a tool that then asks for Full Disk Access.
- A security tool that asks for broad permissions while unsigned looks exactly like malware. The user has no way to check who made it.
- TCC grants are tied to the code signature. Ad-hoc signatures change on every build, so an unsigned build can lose its permissions after a rebuild.
- Notarisation means Apple scanned the binary and the hardened runtime is on. A stapled ticket lets Gatekeeper verify that offline.

## Certificate

Type: Developer ID Application. Not "Apple Development" (development only) and not "Mac App Distribution" (App Store only). It needs a paid Apple Developer Program membership and can only be created by the Account Holder or an Admin.

1. developer.apple.com > Certificates, Identifiers & Profiles > Certificates > + > Developer ID Application. Or Xcode > Settings > Accounts > Manage Certificates.
2. Install it in the login keychain of the build machine.
3. Confirm it is visible:

   ```sh
   security find-identity -v -p codesigning
   # 1) ABCD... "Developer ID Application: Your Name (TEAMID)"
   ```

The quoted name is the signing identity. The ten-character code in brackets is the team id.

For CI, export the certificate with its private key as a `.p12` with a password, base64-encode the file and store the string and the password as repository secrets. Never commit the `.p12`.

## Environment variables

Tauri 2 reads these during `tauri build`. Names verified on 2026-10-15 against https://tauri.app/distribute/sign/macos/ and the installed `@tauri-apps/cli` 2.12.3.

Signing:

| Variable | Meaning |
|---|---|
| `APPLE_SIGNING_IDENTITY` | The identity name, for example `Developer ID Application: Your Name (TEAMID)`. Alternative to `bundle.macOS.signingIdentity`. |
| `APPLE_CERTIFICATE` | Base64 of the `.p12`. CI only. Tauri imports it into a temporary keychain and infers the identity from it. |
| `APPLE_CERTIFICATE_PASSWORD` | Password of the `.p12`. |
| `KEYCHAIN_PASSWORD` | Password for the temporary keychain Tauri creates on CI. |

Notarisation, with either an Apple ID or an App Store Connect API key:

| Variable | Meaning |
|---|---|
| `APPLE_ID` | Apple account email. |
| `APPLE_PASSWORD` | An app-specific password generated at appleid.apple.com, not the account password. |
| `APPLE_TEAM_ID` | The team id. Required together with `APPLE_ID`. |
| `APPLE_API_ISSUER` | Issuer id from App Store Connect > Integrations > API keys. |
| `APPLE_API_KEY` | Key id from the same table. |
| `APPLE_API_KEY_PATH` | Path to the downloaded `.p8` private key. |

With no signing variable and no `signingIdentity` in the config, Tauri skips signing. With a signing identity but no notarisation variables, Tauri signs and skips notarisation.

## tauri.conf.json

The `bundle.macOS` keys that matter. Defaults are from the config schema shipped with the installed CLI.

```json
"bundle": {
  "macOS": {
    "minimumSystemVersion": "26.0",
    "hardenedRuntime": true,
    "entitlements": null,
    "signingIdentity": null,
    "providerShortName": null
  }
}
```

- `minimumSystemVersion`: default `10.13`. The catalog's Settings paths and the collector commands were verified on macOS 26 and 27 (`docs/RULES.md`, `docs/DESIGN.md` section 8), so set it to `26.0` before the first release. The owner decides the final value.
- `hardenedRuntime`: default `true`. Notarisation requires it. Leave it on.
- `entitlements`: default none. The app runs no JIT and loads no unsigned code, so no entitlements file is expected. One open point: under the hardened runtime an app that sends Apple Events may need `com.apple.security.automation.apple-events`. The login-items collector sends them through a child `osascript` process. If a signed build is denied without a prompt, add an entitlements plist with that key set to true and point `entitlements` at it. Not yet verified on a signed build.
- `signingIdentity`: same as `APPLE_SIGNING_IDENTITY`. Keep it `null` in the committed config and use the variable, so the repo carries no team-specific value.
- `providerShortName`: only needed when the Apple ID belongs to more than one team.
- `Info.plist`: a file at `apps/desktop/src-tauri/Info.plist` is merged into the bundle. It must carry `NSAppleEventsUsageDescription`, otherwise macOS denies the login-items collector without prompting.

`bundle.targets` is `all` in the scaffold. For macOS distribution `app` and `dmg` are enough: `pnpm desktop:build -- --bundles app,dmg`.

## Flow

```sh
export APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_PASSWORD="xxxx-xxxx-xxxx-xxxx"
export APPLE_TEAM_ID="TEAMID"
pnpm desktop:build
```

What Tauri does, in order:

1. Runs `beforeBuildCommand` (`pnpm build`) to produce the web assets.
2. Compiles the release binary.
3. Assembles `Talos Labs.app` under `apps/desktop/src-tauri/target/release/bundle/macos/`.
4. Signs the app with `codesign`, hardened runtime on, secure timestamp.
5. Builds the DMG and signs it.
6. Submits to Apple with `xcrun notarytool submit --wait`, using the Apple ID or API key variables.
7. Staples the ticket onto the app and the DMG with `xcrun stapler staple`.

The first notarisation of a new bundle id can take hours. `tauri build --skip-stapling` submits without waiting; later builds should staple again. `tauri build --no-sign` skips signing for a local test build.

Check the result:

```sh
cd apps/desktop/src-tauri
codesign -dv --verbose=2 "target/release/bundle/macos/Talos Labs.app"
spctl -a -vv -t install "target/release/bundle/macos/Talos Labs.app"   # expect source=Notarized Developer ID
xcrun stapler validate "target/release/bundle/macos/Talos Labs.app"
```

## CI

Not in v0.1. When added: a separate workflow on tags, `macos-latest`, the certificate and passwords as repository secrets mapped to the variables above, `pnpm desktop:build`, then upload the DMG as a release asset. The job in `.github/workflows/ci.yml` never signs and never bundles.
