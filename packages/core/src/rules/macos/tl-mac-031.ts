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
  title: "No passwords or keys in shell config files",
  severity: "high",
  category: "developer",
  cis: null,
  os: MACOS_ONLY,
  requires: ["dotfiles"],
  evidenceKeys: ["hitCount", "unreadableCount", "pattern", "hitPath", "line"],
  evidenceVocabulary: { pattern: SECRET_PATTERN_VOCABULARY },
  explanation:
    "A file that your Terminal reads on every start, such as .zshrc or .aws/credentials, contains what looks like a password, API key or access token. These files are plain text, get copied into backups and dotfile repositories, and are read by every tool you run, so a secret in them is easy to leak. Only the kind of secret and the line number were recorded, never the value.",
  fix: {
    summary: "Move the secret out of the file into the Keychain or a password manager, then rotate it.",
    settingsPath: null,
    settingsPane: null,
    commands: [],
    steps: [
      "Open the file listed in the evidence and go to the line shown.",
      "Move the value into the macOS Keychain, a password manager, or the tool's own credential store (for example aws configure or gh auth login).",
      "Treat the secret as exposed: create a new one with the service that issued it and revoke the old one.",
      "Delete the line from the file and save it.",
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
