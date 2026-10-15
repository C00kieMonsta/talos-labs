import type { Evidence } from "../../domain/finding";
import type { Rule } from "../../domain/rule";
import { ev, fail, MACOS_ONLY, pass, section } from "../helpers";

export const SECRET_PATTERN_VOCABULARY: readonly string[] = [
  "aws_access_key_id",
  "aws_secret_access_key",
  "github_token",
  "npm_token",
  "netrc_password",
  "private_key_block",
  "llm_api_key",
  "slack_token",
  "docker_auth",
  "generic_secret_assignment",
];

export const TL_MAC_031: Rule = {
  id: "TL-MAC-031",
  title: "No password or key is stored in a plain-text config file",
  failTitle: "A password or key is stored in a plain-text config file",
  severity: "high",
  category: "developer",
  cis: null,
  os: MACOS_ONLY,
  requires: ["dotfiles"],
  evidenceKeys: ["hitCount", "unreadableCount", "pattern", "hitPath", "line"],
  evidenceVocabulary: { pattern: SECRET_PATTERN_VOCABULARY },
  explanation:
    "A shell start-up file (.zshrc, .bashrc, .zprofile, .profile, .env) or a tool's own config file (.npmrc, .netrc, .aws/credentials, .docker/config.json) contains what looks like a password, API key or access token. These files are plain text, get copied into backups and dotfile repositories, and can be read by any program running as you, so a secret in them is easy to leak. Only the kind of secret and the line number were recorded, never the value.",
  fix: {
    summary: "Move the secret into the Keychain or swap it for a short-lived credential, then rotate the old one.",
    settingsPath: null,
    settingsPane: null,
    commands: [],
    steps: [
      "Open the file listed in the evidence and go to the line shown.",
      "If it is a shell start-up file (.zshrc, .bashrc, .zprofile, .profile, .env): move the value into the macOS Keychain or a password manager, then delete the line.",
      "If it is a tool's own config file (.npmrc, .netrc, .aws/credentials, .docker/config.json): do not delete the line, or the tool stops working. Replace the long-lived secret instead: aws configure sso for AWS; for npm an environment reference such as _authToken=${NPM_TOKEN} with a granular, expiring token; a credential helper (credsStore set to osxkeychain) for Docker; gh auth login or the osxkeychain git credential helper in place of a token in .netrc. The check does not flag ${VAR} references.",
      "Treat the old secret as exposed: create a new one with the service that issued it and revoke the old one.",
      "Run chmod 600 on the file and keep it out of dotfile repositories and unencrypted backups.",
    ],
    verify: "Run the check-up again; the hit count is 0.",
    effort: "ten_minutes",
    sideEffects: "workflow",
  },
  evaluate(state) {
    const data = section(state, "dotfiles");
    const evidence: Evidence[] = [
      ev.number("hitCount", "Secrets found", data.hits.length, "count"),
      ev.number("unreadableCount", "Files that could not be read", data.unreadable.length, "count"),
    ];
    for (const hit of data.hits) {
      evidence.push(ev.enum("pattern", "Kind of secret", hit.pattern));
      evidence.push(ev.path("hitPath", "File", hit.path));
      evidence.push(ev.number("line", "Line", hit.line, null));
    }
    return data.hits.length === 0 ? pass(evidence) : fail(evidence);
  },
};
