//! Secret patterns in a fixed list of shell and tool config files. Only pattern name and line are kept.

use std::io::Read;
use std::path::Path;
use std::sync::LazyLock;
use std::sync::atomic::AtomicBool;

use regex::{Regex, RegexSet};

use super::{check_cancel, home, is_not_found, lit, lit_set};
use crate::collect::{Fail, to_section};
use crate::state::{Dotfiles, SecretHit, SecretPattern, Section};

pub const FILES: [&str; 9] = [
    ".zshrc",
    ".bashrc",
    ".zprofile",
    ".profile",
    ".env",
    ".npmrc",
    ".netrc",
    ".aws/credentials",
    ".docker/config.json",
];

pub const MAX_BYTES: u64 = 1024 * 1024;

/// Name and value groups let `scan_text` reject variables that hold a location or a header name.
const GENERIC_ASSIGNMENT: &str = r#"(?i)(?:^|[\s;])(?:export\s+)?([A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*)\s*[=:]\s*['"]?([^\s'"$]{8,})"#;

/// Variable name suffixes that mean "where the secret lives", not the secret.
const LOCATION_SUFFIXES: [&str; 8] = [
    "_DIR", "_FILE", "_PATH", "_HEADER", "_NAME", "_STORE", "_CMD", "_COMMAND",
];

/// Pattern order is priority order: the first match on a line is the one reported.
/// AWS key ids are upper case only, so that alternative is case-sensitive.
pub const PATTERNS: [(SecretPattern, &str); 10] = [
    (
        SecretPattern::AwsAccessKeyId,
        r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|(?i)aws_access_key_id\s*[=:]\s*['\x22]?[A-Z0-9]{16,}",
    ),
    (
        SecretPattern::AwsSecretAccessKey,
        r"(?i)aws_secret_access_key\s*[=:]\s*['\x22]?[A-Za-z0-9/+=]{40}",
    ),
    (
        SecretPattern::GithubToken,
        r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b",
    ),
    (
        SecretPattern::NpmToken,
        r"_authToken\s*=\s*['\x22]?[A-Za-z0-9._-]{8,}|\bnpm_[A-Za-z0-9]{36}\b",
    ),
    (
        SecretPattern::NetrcPassword,
        r"(?i)\bpassword\s+[^\s$'\x22]{4,}",
    ),
    (
        SecretPattern::PrivateKeyBlock,
        r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
    ),
    (
        SecretPattern::LlmApiKey,
        r"\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b|\bAIza[0-9A-Za-z_-]{35}\b",
    ),
    (
        SecretPattern::SlackToken,
        r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b|hooks\.slack\.com/services/T[A-Z0-9]+/B[A-Z0-9]+/[A-Za-z0-9]{20,}",
    ),
    (
        SecretPattern::DockerAuth,
        r#""auth"\s*:\s*"[A-Za-z0-9+/=]{20,}""#,
    ),
    (SecretPattern::GenericSecretAssignment, GENERIC_ASSIGNMENT),
];

static SET: LazyLock<RegexSet> = LazyLock::new(|| {
    let patterns: Vec<&str> = PATTERNS.iter().map(|(_, p)| *p).collect();
    lit_set(&patterns)
});

static GENERIC_RE: LazyLock<Regex> = LazyLock::new(|| lit(GENERIC_ASSIGNMENT));

fn is_comment(line: &str) -> bool {
    line.trim_start().starts_with('#')
}

fn file_name(path: &str) -> &str {
    Path::new(path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
}

/// A generic assignment whose name or value points at a location is configuration, not a secret.
fn generic_assignment_is_secret(line: &str) -> bool {
    GENERIC_RE.captures_iter(line).any(|caps| {
        let name = caps.get(1).map_or("", |m| m.as_str()).to_ascii_uppercase();
        let value = caps.get(2).map_or("", |m| m.as_str());
        !LOCATION_SUFFIXES
            .iter()
            .any(|suffix| name.ends_with(suffix))
            && !value.starts_with(['~', '/'])
            && !value.starts_with("./")
    })
}

/// Whether a pattern that fired on `line` counts for the file at `path`.
/// The two prose-shaped patterns skip comment lines; a token in a comment is still a token.
fn applies(pattern: SecretPattern, path: &str, line: &str) -> bool {
    match pattern {
        SecretPattern::NetrcPassword => file_name(path) == ".netrc" && !is_comment(line),
        SecretPattern::GenericSecretAssignment => {
            !is_comment(line) && generic_assignment_is_secret(line)
        }
        _ => true,
    }
}

/// Scans `text` line by line. Returns pattern and 1-based line number, never the match.
pub fn scan_text(path: &str, text: &str) -> Vec<SecretHit> {
    let mut hits = Vec::new();
    for (index, line) in text.lines().enumerate() {
        let first = SET
            .matches(line)
            .iter()
            .filter_map(|i| PATTERNS.get(i).map(|(pattern, _)| *pattern))
            .find(|pattern| applies(*pattern, path, line));
        if let Some(pattern) = first {
            hits.push(SecretHit {
                path: path.to_owned(),
                pattern,
                line: (index + 1) as u64,
            });
        }
    }
    hits
}

/// (text, over_cap). Reads one byte past the cap so a file over it is known to be partial.
fn read_capped(path: &Path) -> std::io::Result<(String, bool)> {
    let mut file = std::fs::File::open(path)?;
    let mut buf = Vec::new();
    file.by_ref().take(MAX_BYTES + 1).read_to_end(&mut buf)?;
    let over_cap = buf.len() as u64 > MAX_BYTES;
    buf.truncate(MAX_BYTES as usize);
    Ok((String::from_utf8_lossy(&buf).into_owned(), over_cap))
}

pub fn scan_home(home: &Path) -> Dotfiles {
    let mut scanned = Vec::new();
    let mut unreadable = Vec::new();
    let mut hits = Vec::new();
    for rel in FILES {
        let path = home.join(rel);
        let display = path.to_string_lossy().into_owned();
        match read_capped(&path) {
            Ok((text, over_cap)) => {
                hits.extend(scan_text(&display, &text));
                // The first MiB of an over-cap file is checked, but the file is listed as not fully read.
                if over_cap {
                    unreadable.push(display)
                } else {
                    scanned.push(display)
                }
            }
            Err(err) if is_not_found(&err) => {}
            Err(_) => unreadable.push(display),
        }
    }
    Dotfiles {
        scanned,
        unreadable,
        hits,
    }
}

fn inner(cancel: &AtomicBool) -> Result<Dotfiles, Fail> {
    check_cancel(cancel)?;
    Ok(scan_home(&home()?))
}

pub fn collect(cancel: &AtomicBool) -> Section<Dotfiles> {
    to_section(inner(cancel))
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;

    #[test]
    fn set_compiles_every_pattern() {
        assert_eq!(SET.len(), PATTERNS.len());
    }

    #[test]
    fn fake_aws_key_reports_pattern_and_line_only() {
        let text = "[default]\nregion = eu-west-1\naws_access_key_id = AKIAIOSFODNN7EXAMPLE\n";
        let hits = scan_text("/Users/x/.aws/credentials", text);
        assert_eq!(
            hits,
            vec![SecretHit {
                path: "/Users/x/.aws/credentials".into(),
                pattern: SecretPattern::AwsAccessKeyId,
                line: 3
            }]
        );
        let json = serde_json::to_string(&hits).unwrap();
        assert!(!json.contains("AKIAIOSFODNN7EXAMPLE"));
        assert!(json.contains("\"line\":3"));
    }

    #[test]
    fn variable_references_do_not_match() {
        let text = "export AWS_SECRET_ACCESS_KEY=$AWS_SECRET\nexport GITHUB_TOKEN=\"${GH}\"\n//registry.npmjs.org/:_authToken=${NPM_TOKEN}\nexport OPENAI_API_KEY=$(cat ~/.key)\n";
        assert!(scan_text("x", text).is_empty());
    }

    #[test]
    fn each_pattern_matches_its_sample() {
        let samples = [
            (
                SecretPattern::AwsAccessKeyId,
                "/Users/x/.zshrc",
                "export AWS_KEY=AKIAIOSFODNN7EXAMPLE",
            ),
            (
                SecretPattern::AwsSecretAccessKey,
                "/Users/x/.aws/credentials",
                "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            ),
            (
                SecretPattern::GithubToken,
                "/Users/x/.zshrc",
                concat!("export GH=ghp", "_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"),
            ),
            (
                SecretPattern::NpmToken,
                "/Users/x/.npmrc",
                concat!(
                    "//registry.npmjs.org/:_authToken=npm",
                    "_abcdefghijklmnopqrstuvwxyz0123456789"
                ),
            ),
            (
                SecretPattern::NetrcPassword,
                "/Users/x/.netrc",
                "machine api.example.com login me password hunter22",
            ),
            (
                SecretPattern::NetrcPassword,
                "/Users/x/.netrc",
                "  password hunter22",
            ),
            (
                SecretPattern::PrivateKeyBlock,
                "/Users/x/.zshrc",
                "-----BEGIN RSA PRIVATE KEY-----",
            ),
            (
                SecretPattern::LlmApiKey,
                "/Users/x/.zshrc",
                concat!(
                    "export ANTHROPIC=sk-ant",
                    "-api03-abcdefghijklmnopqrstuvwxyz"
                ),
            ),
            (
                SecretPattern::SlackToken,
                "/Users/x/.zshrc",
                concat!("SLACK=xoxb", "-123456789012-abcdefghijkl"),
            ),
            (
                SecretPattern::SlackToken,
                "/Users/x/.zshrc",
                concat!(
                    "export SLACK_WEBHOOK_URL=https://hooks.slack.com/",
                    "services/T0000000/B0000000/XXXXXXXXXXXXXXXXXXXXXXXX"
                ),
            ),
            (
                SecretPattern::DockerAuth,
                "/Users/x/.docker/config.json",
                "      \"auth\": \"dXNlcjpwYXNzd29yZDEyMzQ1Ng==\"",
            ),
            (
                SecretPattern::GenericSecretAssignment,
                "/Users/x/.zshrc",
                "export DATABASE_PASSWORD=correct-horse-battery",
            ),
            (
                SecretPattern::GenericSecretAssignment,
                "/Users/x/.env",
                concat!("STRIPE_SECRET_KEY=sk_", "live_abcdefghijklmnopqrstuvwx"),
            ),
            (
                SecretPattern::GenericSecretAssignment,
                "/Users/x/.zshrc",
                concat!("export GITLAB_TOKEN=glpat", "-abcdefghijklmnopqrst"),
            ),
        ];
        for (pattern, path, line) in samples {
            let hits = scan_text(path, line);
            assert_eq!(hits.len(), 1, "{line}");
            assert_eq!(hits[0].pattern, pattern, "{line}");
        }
    }

    #[test]
    fn plain_config_lines_are_clean() {
        let lines = [
            "export PATH=$HOME/bin:$PATH",
            "alias ll='ls -la'",
            "eval \"$(/opt/homebrew/bin/brew shellenv)\"",
            "export EDITOR=vim",
            "# password manager alias",
            "# ssh-agent asks password once",
            "export PASSWORD_STORE_DIR=~/.password-store",
            "export SECRETS_DIR=/opt/secrets/dev",
            "export VAULT_TOKEN_FILE=/run/secrets/token",
            "export API_KEY_HEADER=X-Api-Key-Value",
            "export GITHUB_TOKEN_CMD=./bin/token",
            "export AWS_PROFILE=asiapacificsoutheast",
            "export AWS_REGION=ap-southeast-1",
            "set -o vi # password prompts stay in the terminal",
        ];
        for line in lines {
            assert!(scan_text("/Users/x/.zshrc", line).is_empty(), "{line}");
        }
        assert!(scan_text("/Users/x/.zshrc", &lines.join("\n")).is_empty());
    }

    #[test]
    fn netrc_grammar_only_counts_in_netrc() {
        let line = "machine api.example.com login me password hunter22";
        assert_eq!(scan_text("/Users/x/.netrc", line).len(), 1);
        assert!(scan_text("/Users/x/.zshrc", line).is_empty());
        assert!(scan_text("/Users/x/.netrc", "# password hunter22").is_empty());
    }

    #[test]
    fn comments_hide_prose_but_not_tokens() {
        assert!(
            scan_text(
                "/Users/x/.zshrc",
                "# export DATABASE_PASSWORD=correct-horse-battery"
            )
            .is_empty()
        );
        assert!(scan_text("/Users/x/.zshrc", "   # API_KEY=placeholder-value-here").is_empty());
        let token = scan_text(
            "/Users/x/.zshrc",
            concat!("# old: ghp", "_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"),
        );
        assert_eq!(token.len(), 1);
        assert_eq!(token[0].pattern, SecretPattern::GithubToken);
    }

    #[test]
    fn generic_assignment_rejects_locations_but_keeps_values() {
        assert!(generic_assignment_is_secret(
            "export DB_PASSWORD=correct-horse-battery"
        ));
        assert!(generic_assignment_is_secret(
            "db_password: correct-horse-battery"
        ));
        assert!(!generic_assignment_is_secret(
            "export DB_PASSWORD=/etc/db/password"
        ));
        assert!(!generic_assignment_is_secret(
            "export DB_PASSWORD=~/secrets/db"
        ));
        assert!(!generic_assignment_is_secret(
            "export DB_PASSWORD_FILE=supersecretvalue"
        ));
        assert!(!generic_assignment_is_secret(
            "export secret_store=supersecretvalue"
        ));
        assert!(
            generic_assignment_is_secret(
                "export A_DIR=/x; export DB_PASSWORD=correct-horse-battery"
            ),
            "the second assignment on the line counts"
        );
    }

    #[test]
    fn aws_key_id_prefix_is_case_sensitive() {
        assert!(scan_text("x", "export AWS_PROFILE=asiapacificsoutheast").is_empty());
        assert!(scan_text("x", "export K=akiaiosfodnn7example").is_empty());
        assert_eq!(
            scan_text("x", "export K=ASIAIOSFODNN7EXAMPLE")[0].pattern,
            SecretPattern::AwsAccessKeyId
        );
    }

    #[test]
    fn files_over_the_cap_are_listed_as_unreadable() {
        let dir = std::env::temp_dir().join(format!("talos-dotfiles-cap-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let mut big = String::from(concat!(
            "export GH=ghp",
            "_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij\n"
        ));
        while (big.len() as u64) <= MAX_BYTES {
            big.push_str("# filler line that keeps the shell startup slow and the file large\n");
        }
        big.push_str(concat!(
            "export GITHUB_TOKEN=ghp",
            "_ZYXWVUTSRQPONMLKJIHGFEDCBAzyxwvutsrqp\n"
        ));
        std::fs::write(dir.join(".zshrc"), &big).unwrap();
        let result = scan_home(&dir);
        let path = dir.join(".zshrc").to_string_lossy().into_owned();
        assert_eq!(
            result.unreadable,
            vec![path.clone()],
            "over the cap means not fully read"
        );
        assert!(result.scanned.is_empty());
        assert_eq!(
            result.hits.len(),
            1,
            "the part that was read is still scanned"
        );
        assert_eq!(result.hits[0].line, 1);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_home_lists_scanned_and_skips_missing() {
        let dir = std::env::temp_dir().join(format!("talos-dotfiles-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".aws")).unwrap();
        std::fs::write(dir.join(".zshrc"), "export EDITOR=vim\n").unwrap();
        std::fs::write(
            dir.join(".aws/credentials"),
            "[default]\nregion = eu-west-1\naws_access_key_id = AKIAIOSFODNN7EXAMPLE\n",
        )
        .unwrap();
        let result = scan_home(&dir);
        assert_eq!(result.scanned.len(), 2);
        assert!(result.unreadable.is_empty());
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].line, 3);
        assert_eq!(result.hits[0].pattern, SecretPattern::AwsAccessKeyId);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
