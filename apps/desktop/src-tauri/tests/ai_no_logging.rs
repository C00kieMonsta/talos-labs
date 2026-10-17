//! The provider modules parse sign-in output and token bodies; none of them may print anything.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::path::Path;

const FILES: [&str; 4] = [
    "src/ai/provider.rs",
    "src/ai/claude_code.rs",
    "src/ai/claude_stream.rs",
    "src/ai/chatgpt_oauth.rs",
];

#[test]
fn no_print_macros_outside_tests() {
    for file in FILES {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join(file);
        let text = std::fs::read_to_string(&path).unwrap();
        // The in-module test block may print; the code before it may not. The split is on the
        // test module itself, not the attribute: a `#[cfg(test)]` helper earlier in the file must
        // not shrink the scanned body.
        let marker = "#[cfg(test)]\nmod tests";
        let at = text
            .find(marker)
            .unwrap_or_else(|| panic!("{file}: no `{marker}` block"));
        let (body, tests) = text.split_at(at);
        assert!(
            !body.contains("mod tests"),
            "{file}: an earlier `mod tests` would hide code from this check"
        );
        // The test module must be the last item: every column-zero line after the marker is its
        // own braces or blank, so no production code sits below it unscanned.
        for line in tests.lines().skip(2) {
            assert!(
                line.is_empty() || line.starts_with(' ') || line == "}",
                "{file}: `{line}` after `mod tests` is outside the test module"
            );
        }
        for (number, line) in body.lines().enumerate() {
            for needle in ["println!", "eprintln!", "dbg!"] {
                assert!(
                    !line.contains(needle),
                    "{file}:{}: {needle} is not allowed here",
                    number + 1
                );
            }
        }
    }
}
