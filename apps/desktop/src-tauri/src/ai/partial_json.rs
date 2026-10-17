//! Completes the JSON a model has streamed so far: unfinished containers are closed, an unfinished
//! key, literal, number or escape is dropped, a partial string stays as text. Mirrors
//! packages/core/src/explainer/partial-json.ts; the shared fixture pins the two together.

use serde_json::{Map, Value};

const MAX_DEPTH: usize = 64;

enum Outcome {
    Value(Value),
    /// The input ended inside this value; the caller closes up with what it has.
    End,
    Invalid,
}

struct Reader<'a> {
    s: &'a [u8],
    pos: usize,
}

struct Str {
    text: String,
    complete: bool,
}

impl<'a> Reader<'a> {
    fn new(s: &'a str) -> Self {
        Reader {
            s: s.as_bytes(),
            pos: 0,
        }
    }

    fn at_end(&self) -> bool {
        self.pos >= self.s.len()
    }

    fn peek(&self) -> Option<u8> {
        self.s.get(self.pos).copied()
    }

    /// A truncated token consumes the rest of the input.
    fn truncated(&mut self) -> Outcome {
        self.pos = self.s.len();
        Outcome::End
    }

    fn skip_ws(&mut self) {
        while self.peek().is_some_and(|b| b.is_ascii_whitespace()) {
            self.pos += 1;
        }
    }

    fn value(&mut self, depth: usize) -> Outcome {
        self.skip_ws();
        let Some(c) = self.peek() else {
            return Outcome::End;
        };
        if depth > MAX_DEPTH {
            return Outcome::Invalid;
        }
        match c {
            b'{' => self.object(depth),
            b'[' => self.array(depth),
            b'"' => Outcome::Value(Value::String(self.string().text)),
            b't' => self.literal("true", Value::Bool(true)),
            b'f' => self.literal("false", Value::Bool(false)),
            b'n' => self.literal("null", Value::Null),
            b'-' | b'0'..=b'9' => self.number(),
            _ => Outcome::Invalid,
        }
    }

    fn literal(&mut self, word: &str, value: Value) -> Outcome {
        let rest = self
            .s
            .get(self.pos..(self.pos + word.len()).min(self.s.len()))
            .unwrap_or(&[]);
        if rest == word.as_bytes() {
            self.pos += word.len();
            return Outcome::Value(value);
        }
        if word.as_bytes().starts_with(rest) && self.pos + rest.len() >= self.s.len() {
            self.truncated()
        } else {
            Outcome::Invalid
        }
    }

    fn number(&mut self) -> Outcome {
        let start = self.pos;
        while self
            .peek()
            .is_some_and(|b| matches!(b, b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9'))
        {
            self.pos += 1;
        }
        let text = std::str::from_utf8(self.s.get(start..self.pos).unwrap_or(&[])).unwrap_or("");
        if is_number(text)
            && let Ok(value) = serde_json::from_str::<Value>(text)
        {
            return Outcome::Value(value);
        }
        // Only a prefix that could still grow into a number is a truncation.
        if self.at_end() && could_be_number(text) {
            self.truncated()
        } else {
            Outcome::Invalid
        }
    }

    /// `complete` is false when the input ended inside the string or inside an escape.
    fn string(&mut self) -> Str {
        self.pos += 1;
        let mut text = String::new();
        while let Some(c) = self.peek() {
            if c == b'"' {
                self.pos += 1;
                return Str {
                    text,
                    complete: true,
                };
            }
            if c == b'\\' {
                let Some(e) = self.s.get(self.pos + 1).copied() else {
                    break;
                };
                if e == b'u' {
                    let hex = self.s.get(self.pos + 2..self.pos + 6).unwrap_or(&[]);
                    let code = std::str::from_utf8(hex)
                        .ok()
                        .filter(|h| h.len() == 4)
                        .and_then(|h| u32::from_str_radix(h, 16).ok());
                    let Some(code) = code else {
                        break;
                    };
                    text.push(char::from_u32(code).unwrap_or(char::REPLACEMENT_CHARACTER));
                    self.pos += 6;
                    continue;
                }
                let simple = match e {
                    b'"' => '"',
                    b'\\' => '\\',
                    b'/' => '/',
                    b'b' => '\u{8}',
                    b'f' => '\u{c}',
                    b'n' => '\n',
                    b'r' => '\r',
                    b't' => '\t',
                    _ => break,
                };
                text.push(simple);
                self.pos += 2;
                continue;
            }
            // Copy one whole UTF-8 scalar so a multi-byte character is never split.
            let width = utf8_width(c);
            let bytes = self.s.get(self.pos..self.pos + width).unwrap_or(&[]);
            match std::str::from_utf8(bytes) {
                Ok(piece) if bytes.len() == width => {
                    text.push_str(piece);
                    self.pos += width;
                }
                _ => break,
            }
        }
        self.truncated();
        Str {
            text,
            complete: false,
        }
    }

    fn object(&mut self, depth: usize) -> Outcome {
        self.pos += 1;
        let mut out = Map::new();
        let mut expect = Expect::KeyOrClose;
        loop {
            self.skip_ws();
            let Some(c) = self.peek() else {
                return Outcome::Value(Value::Object(out));
            };
            if c == b'}' && expect != Expect::Key {
                self.pos += 1;
                return Outcome::Value(Value::Object(out));
            }
            if c == b',' && expect == Expect::CommaOrClose {
                self.pos += 1;
                expect = Expect::Key;
                continue;
            }
            if expect == Expect::CommaOrClose || c != b'"' {
                return Outcome::Invalid;
            }
            let key = self.string();
            if !key.complete {
                return Outcome::Value(Value::Object(out));
            }
            self.skip_ws();
            match self.peek() {
                None => return Outcome::Value(Value::Object(out)),
                Some(b':') => self.pos += 1,
                Some(_) => return Outcome::Invalid,
            }
            match self.value(depth + 1) {
                Outcome::End => return Outcome::Value(Value::Object(out)),
                Outcome::Invalid => return Outcome::Invalid,
                Outcome::Value(v) => {
                    out.insert(key.text, v);
                }
            }
            expect = Expect::CommaOrClose;
        }
    }

    fn array(&mut self, depth: usize) -> Outcome {
        self.pos += 1;
        let mut out = Vec::new();
        let mut expect = Expect::KeyOrClose;
        loop {
            self.skip_ws();
            let Some(c) = self.peek() else {
                return Outcome::Value(Value::Array(out));
            };
            if c == b']' && expect != Expect::Key {
                self.pos += 1;
                return Outcome::Value(Value::Array(out));
            }
            if c == b',' && expect == Expect::CommaOrClose {
                self.pos += 1;
                expect = Expect::Key;
                continue;
            }
            if expect == Expect::CommaOrClose {
                return Outcome::Invalid;
            }
            match self.value(depth + 1) {
                Outcome::End => return Outcome::Value(Value::Array(out)),
                Outcome::Invalid => return Outcome::Invalid,
                Outcome::Value(v) => out.push(v),
            }
            expect = Expect::CommaOrClose;
        }
    }
}

/// Shared by objects (key) and arrays (value): what may come next.
#[derive(PartialEq, Eq, Clone, Copy)]
enum Expect {
    KeyOrClose,
    Key,
    CommaOrClose,
}

fn utf8_width(first: u8) -> usize {
    match first {
        0x00..=0x7f => 1,
        0xc0..=0xdf => 2,
        0xe0..=0xef => 3,
        0xf0..=0xf7 => 4,
        _ => 1,
    }
}

/// `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?`
fn is_number(text: &str) -> bool {
    let mut rest = text.strip_prefix('-').unwrap_or(text);
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    if digits == 0 || (digits > 1 && rest.starts_with('0')) {
        return false;
    }
    rest = rest.get(digits..).unwrap_or("");
    if let Some(frac) = rest.strip_prefix('.') {
        let n = frac.bytes().take_while(u8::is_ascii_digit).count();
        if n == 0 {
            return false;
        }
        rest = frac.get(n..).unwrap_or("");
    }
    if let Some(exp) = rest.strip_prefix(['e', 'E']) {
        let exp = exp.strip_prefix(['-', '+']).unwrap_or(exp);
        let n = exp.bytes().take_while(u8::is_ascii_digit).count();
        if n == 0 {
            return false;
        }
        rest = exp.get(n..).unwrap_or("");
    }
    rest.is_empty()
}

/// `-?[0-9]*\.?[0-9]*([eE][-+]?[0-9]*)?`
fn could_be_number(text: &str) -> bool {
    let mut rest = text.strip_prefix('-').unwrap_or(text);
    rest = rest.trim_start_matches(|c: char| c.is_ascii_digit());
    if let Some(after) = rest.strip_prefix('.') {
        rest = after.trim_start_matches(|c: char| c.is_ascii_digit());
    }
    if let Some(exp) = rest.strip_prefix(['e', 'E']) {
        let exp = exp.strip_prefix(['-', '+']).unwrap_or(exp);
        rest = exp.trim_start_matches(|c: char| c.is_ascii_digit());
    }
    rest.is_empty()
}

/// The value described by `prefix`, or None when nothing usable has arrived or the text cannot
/// start a JSON document.
pub fn complete_prefix(prefix: &str) -> Option<Value> {
    let mut reader = Reader::new(prefix);
    let value = match reader.value(0) {
        Outcome::Value(v) => v,
        Outcome::End | Outcome::Invalid => return None,
    };
    reader.skip_ws();
    if !reader.at_end() {
        return None;
    }
    Some(value)
}

/// `complete_prefix` restricted to objects, which is all the stream ever carries.
pub fn complete_object(prefix: &str) -> Option<Map<String, Value>> {
    match complete_prefix(prefix)? {
        Value::Object(map) => Some(map),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn closes_what_is_open_and_keeps_partial_strings() {
        assert_eq!(complete_prefix("{"), Some(json!({})));
        assert_eq!(complete_prefix("{\"a\":\"he"), Some(json!({ "a": "he" })));
        assert_eq!(
            complete_prefix("{\"a\":\"hello\",\"b\":"),
            Some(json!({ "a": "hello" }))
        );
        assert_eq!(complete_prefix("{\"a\":tr"), Some(json!({})));
        assert_eq!(complete_prefix("{\"a\":12"), Some(json!({ "a": 12 })));
        assert_eq!(complete_prefix("{\"a\":1.5e"), Some(json!({})));
        assert_eq!(
            complete_prefix("{\"a\":\"caf\\u00e9 au lait"),
            Some(json!({ "a": "café au lait" }))
        );
        assert_eq!(
            complete_prefix("{\"a\":\"caf\\u00e"),
            Some(json!({ "a": "caf" }))
        );
        assert_eq!(
            complete_prefix("{\"a\":\"héllo wör"),
            Some(json!({ "a": "héllo wör" }))
        );
    }

    #[test]
    fn refuses_what_cannot_be_json() {
        for bad in [
            "",
            "   ",
            "{\"a\":}",
            "{\"a\":1,}",
            "{a:1}",
            "abc",
            "{\"a\":1}{",
        ] {
            assert_eq!(complete_prefix(bad), None, "{bad:?}");
        }
        assert_eq!(complete_prefix(&"[".repeat(200)), None);
    }

    #[test]
    fn complete_object_drops_scalars_and_arrays() {
        assert!(complete_object("\"text").is_none());
        assert!(complete_object("[1").is_none());
        assert_eq!(
            complete_object("{\"x\":1").map(Value::Object),
            Some(json!({ "x": 1 }))
        );
    }

    #[test]
    fn every_prefix_of_a_document_is_an_object_of_string_prefixes() {
        let full = json!({
            "ruleId": "TL-MAC-001",
            "whyItMattersForYou": "Readable by anyone. \"Quoted\" and \\ slashed. Café.",
            "urgency": "today"
        });
        let text = serde_json::to_string(&full).unwrap();
        assert_eq!(complete_prefix(&text), Some(full.clone()));
        for i in 1..text.len() {
            if !text.is_char_boundary(i) {
                continue;
            }
            let Some(partial) = complete_prefix(text.get(..i).unwrap_or("")) else {
                continue;
            };
            let map = partial.as_object().unwrap();
            for (key, v) in map {
                let final_text = full[key].as_str().unwrap();
                assert!(final_text.starts_with(v.as_str().unwrap()), "{key} at {i}");
            }
        }
    }
}
