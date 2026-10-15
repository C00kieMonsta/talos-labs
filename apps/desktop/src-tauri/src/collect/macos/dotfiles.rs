//! Secret patterns in a fixed list of shell and tool config files. Only pattern name and line are kept.

use std::io::Read;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::LazyLock;

use regex::RegexSet;

use super::{check_cancel, home, is_not_found, lit_set};
use crate::collect::{to_section, Fail};
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

/// Pattern order is priority order: the first match on a line is the one reported.
pub const PATTERNS: [(SecretPattern, &str); 10] = [
    (SecretPattern::AwsAccessKeyId, r"(?i)\b(?:AKIA|ASIA)[0-9A-Z]{16}\b|(?i)aws_access_key_id\s*[=:]\s*['\x22]?[A-Z0-9]{16,}"),
    (SecretPattern::AwsSecretAccessKey, r"(?i)aws_secret_access_key\s*[=:]\s*['\x22]?[A-Za-z0-9/+=]{40}"),
    (SecretPattern::GithubToken, r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})\b"),
    (SecretPattern::NpmToken, r"_authToken\s*=\s*['\x22]?[A-Za-z0-9._-]{8,}|\bnpm_[A-Za-z0-9]{36}\b"),
    (SecretPattern::NetrcPassword, r"(?i)\bpassword\s+[^\s$'\x22]{4,}"),
    (SecretPattern::PrivateKeyBlock, r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    (SecretPattern::LlmApiKey, r"\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b|\bAIza[0-9A-Za-z_-]{35}\b"),
    (SecretPattern::SlackToken, r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"),
    (SecretPattern::DockerAuth, r#""auth"\s*:\s*"[A-Za-z0-9+/=]{20,}""#),
    (
        SecretPattern::GenericSecretAssignment,
        r#"(?i)(?:^|[\s;])(?:export\s+)?[A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|PASSWD|API_KEY|APIKEY|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*\s*[=:]\s*['"]?[^\s'"$]{8,}"#,
    ),
];

static SET: LazyLock<RegexSet> = LazyLock::new(|| {
    let patterns: Vec<&str> = PATTERNS.iter().map(|(_, p)| *p).collect();
    lit_set(&patterns)
});

/// Scans `text` line by line. Returns pattern and 1-based line number, never the match.
pub fn scan_text(path: &str, text: &str) -> Vec<SecretHit> {
    let mut hits = Vec::new();
    for (index, line) in text.lines().enumerate() {
        if let Some(first) = SET.matches(line).iter().next()
            && let Some((pattern, _)) = PATTERNS.get(first)
        {
            hits.push(SecretHit { path: path.to_owned(), pattern: *pattern, line: (index + 1) as u64 });
        }
    }
    hits
}

fn read_capped(path: &Path) -> std::io::Result<String> {
    let mut file = std::fs::File::open(path)?;
    let mut buf = Vec::new();
    file.by_ref().take(MAX_BYTES).read_to_end(&mut buf)?;
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

pub fn scan_home(home: &Path) -> Dotfiles {
    let mut scanned = Vec::new();
    let mut unreadable = Vec::new();
    let mut hits = Vec::new();
    for rel in FILES {
        let path = home.join(rel);
        let display = path.to_string_lossy().into_owned();
        match read_capped(&path) {
            Ok(text) => {
                hits.extend(scan_text(&display, &text));
                scanned.push(display);
            }
            Err(err) if is_not_found(&err) => {}
            Err(_) => unreadable.push(display),
        }
    }
    Dotfiles { scanned, unreadable, hits }
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
        assert_eq!(hits, vec![SecretHit { path: "/Users/x/.aws/credentials".into(), pattern: SecretPattern::AwsAccessKeyId, line: 3 }]);
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
            (SecretPattern::AwsSecretAccessKey, "aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"),
            (SecretPattern::GithubToken, "export GH=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij"),
            (SecretPattern::NpmToken, "//registry.npmjs.org/:_authToken=npm_abcdefghijklmnopqrstuvwxyz0123456789"),
            (SecretPattern::NetrcPassword, "machine api.example.com login me password hunter22"),
            (SecretPattern::PrivateKeyBlock, "-----BEGIN RSA PRIVATE KEY-----"),
            (SecretPattern::LlmApiKey, "export ANTHROPIC=sk-ant-api03-abcdefghijklmnopqrstuvwxyz"),
            (SecretPattern::SlackToken, "SLACK=xoxb-123456789012-abcdefghijkl"),
            (SecretPattern::DockerAuth, "      \"auth\": \"dXNlcjpwYXNzd29yZDEyMzQ1Ng==\""),
            (SecretPattern::GenericSecretAssignment, "export DATABASE_PASSWORD=correct-horse-battery"),
        ];
        for (pattern, line) in samples {
            let hits = scan_text("x", line);
            assert_eq!(hits.len(), 1, "{line}");
            assert_eq!(hits[0].pattern, pattern, "{line}");
        }
    }

    #[test]
    fn plain_config_lines_are_clean() {
        let text = "export PATH=$HOME/bin:$PATH\nalias ll='ls -la'\neval \"$(/opt/homebrew/bin/brew shellenv)\"\nexport EDITOR=vim\n";
        assert!(scan_text("x", text).is_empty());
    }

    #[test]
    fn scan_home_lists_scanned_and_skips_missing() {
        let dir = std::env::temp_dir().join(format!("talos-dotfiles-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join(".aws")).unwrap();
        std::fs::write(dir.join(".zshrc"), "export EDITOR=vim\n").unwrap();
        std::fs::write(dir.join(".aws/credentials"), "[default]\nregion = eu-west-1\naws_access_key_id = AKIAIOSFODNN7EXAMPLE\n").unwrap();
        let result = scan_home(&dir);
        assert_eq!(result.scanned.len(), 2);
        assert!(result.unreadable.is_empty());
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].line, 3);
        assert_eq!(result.hits[0].pattern, SecretPattern::AwsAccessKeyId);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
