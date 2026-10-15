//! Browser hand-off to the user's own Claude or ChatGPT account. The frontend sends an assistant id
//! and the prompt text; the URL is chosen and encoded here, so the webview never passes a URL.

/// Longest prompt the frontend may hand over, in characters. Matches core's `buildBrowserPrompt` cap.
pub const MAX_PROMPT_CHARS: usize = 6000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Assistant {
    Claude,
    ChatGpt,
}

impl Assistant {
    /// Exact ids only; anything else is unknown.
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "claude" => Some(Assistant::Claude),
            "chatgpt" => Some(Assistant::ChatGpt),
            _ => None,
        }
    }

    pub fn base_url(self) -> &'static str {
        match self {
            Assistant::Claude => "https://claude.ai/new?q=",
            Assistant::ChatGpt => "https://chatgpt.com/?q=",
        }
    }
}

/// Percent-encodes every byte except the RFC 3986 unreserved set: A-Z a-z 0-9 - _ . ~
pub fn percent_encode(text: &str) -> String {
    let mut out = String::with_capacity(text.len() * 3);
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// The URL to open, or the message the command rejects with.
pub fn assistant_url(assistant: &str, prompt: &str) -> Result<String, String> {
    let assistant = Assistant::parse(assistant).ok_or_else(|| "unknown assistant".to_owned())?;
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err("prompt too long".to_owned());
    }
    Ok(format!("{}{}", assistant.base_url(), percent_encode(prompt)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_unreserved_characters_and_encodes_the_rest() {
        assert_eq!(percent_encode("AZaz09-_.~"), "AZaz09-_.~");
        assert_eq!(percent_encode("a b"), "a%20b");
        assert_eq!(percent_encode("line\nnext"), "line%0Anext");
        assert_eq!(percent_encode("q=1&r=2/#?+"), "q%3D1%26r%3D2%2F%23%3F%2B");
        assert_eq!(percent_encode("é"), "%C3%A9");
        assert_eq!(percent_encode(""), "");
    }

    #[test]
    fn builds_the_claude_and_chatgpt_urls() {
        assert_eq!(
            assistant_url("claude", "Explain my results: 2 fail").unwrap(),
            "https://claude.ai/new?q=Explain%20my%20results%3A%202%20fail"
        );
        assert_eq!(assistant_url("chatgpt", "TL-MAC-001").unwrap(), "https://chatgpt.com/?q=TL-MAC-001");
    }

    #[test]
    fn rejects_an_unknown_assistant() {
        for name in ["", "Claude", "gemini", "claude ", "chatgpt\n"] {
            assert_eq!(assistant_url(name, "x"), Err("unknown assistant".to_owned()), "{name:?}");
        }
    }

    #[test]
    fn rejects_a_prompt_over_the_cap_and_accepts_one_at_it() {
        let at_cap = "é".repeat(MAX_PROMPT_CHARS);
        assert!(assistant_url("claude", &at_cap).is_ok());
        let over = "a".repeat(MAX_PROMPT_CHARS + 1);
        assert_eq!(assistant_url("claude", &over), Err("prompt too long".to_owned()));
        assert_eq!(assistant_url("chatgpt", &over), Err("prompt too long".to_owned()));
    }

    #[test]
    fn checks_the_assistant_before_the_prompt() {
        let over = "a".repeat(MAX_PROMPT_CHARS + 1);
        assert_eq!(assistant_url("nope", &over), Err("unknown assistant".to_owned()));
    }
}
