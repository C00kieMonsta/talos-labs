//! JSON-lines protocol spoken with the `talos-ai` helper. One object per line in each direction.

use serde::{Deserialize, Serialize};
use std::io::{self, BufRead};

/// Longest line the reader accepts; longer lines are dropped whole.
pub const MAX_LINE_BYTES: usize = 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Task {
    Explain,
    Prioritise,
    Ask,
    /// The watch task: the model rates and picks ids; no partials.
    Watch,
    /// The chat task: Claude Code only. The helper has no chat case, so the engine refuses it.
    Chat,
}

/// A request written to the helper's stdin.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum Request {
    Availability {
        id: String,
    },
    #[serde(rename_all = "camelCase")]
    Generate {
        id: String,
        task: Task,
        instructions: String,
        prompt: String,
        max_tokens: u32,
    },
    Cancel {
        id: String,
    },
    Shutdown,
}

/// The helper's own availability answer; `HelperUnavailable` is added on the Rust side.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HelperAvailability {
    Available,
    DeviceNotEligible,
    AppleIntelligenceNotEnabled,
    ModelNotReady,
}

/// An event read from the helper's stdout.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "lowercase")]
pub enum Event {
    Availability {
        id: String,
        state: HelperAvailability,
    },
    Partial {
        id: String,
        json: serde_json::Value,
    },
    Done {
        id: String,
        json: serde_json::Value,
    },
    Error {
        id: String,
        code: String,
    },
}

impl Event {
    pub fn id(&self) -> &str {
        match self {
            Event::Availability { id, .. }
            | Event::Partial { id, .. }
            | Event::Done { id, .. }
            | Event::Error { id, .. } => id,
        }
    }
}

/// Reads newline-delimited lines from a stream that may deliver them in arbitrary chunks.
pub struct LineReader<R: BufRead> {
    inner: R,
    buf: Vec<u8>,
}

#[derive(Debug)]
pub enum Line {
    /// A complete line without its newline.
    Text(String),
    /// A line longer than `MAX_LINE_BYTES`, dropped whole.
    TooLong,
    /// Not valid UTF-8, dropped.
    NotUtf8,
    /// The stream closed. A trailing partial line without a newline is discarded.
    Eof,
}

impl<R: BufRead> LineReader<R> {
    pub fn new(inner: R) -> Self {
        LineReader {
            inner,
            buf: Vec::new(),
        }
    }

    pub fn next_line(&mut self) -> io::Result<Line> {
        self.buf.clear();
        let mut too_long = false;
        loop {
            let chunk = self.inner.fill_buf()?;
            if chunk.is_empty() {
                return Ok(Line::Eof);
            }
            let (take, found) = match chunk.iter().position(|b| *b == b'\n') {
                Some(pos) => (pos + 1, true),
                None => (chunk.len(), false),
            };
            if !too_long {
                let body = chunk.get(..take - usize::from(found)).unwrap_or(&[]);
                if self.buf.len() + body.len() > MAX_LINE_BYTES {
                    too_long = true;
                    self.buf.clear();
                } else {
                    self.buf.extend_from_slice(body);
                }
            }
            self.inner.consume(take);
            if found {
                if too_long {
                    return Ok(Line::TooLong);
                }
                let mut text = std::mem::take(&mut self.buf);
                if text.last() == Some(&b'\r') {
                    text.pop();
                }
                return Ok(String::from_utf8(text).map_or(Line::NotUtf8, Line::Text));
            }
        }
    }

    /// The next parseable event, skipping blank, malformed, over-long and non-UTF-8 lines.
    pub fn next_event(&mut self) -> io::Result<Option<Event>> {
        loop {
            match self.next_line()? {
                Line::Eof => return Ok(None),
                Line::TooLong | Line::NotUtf8 => continue,
                Line::Text(text) => {
                    if text.trim().is_empty() {
                        continue;
                    }
                    if let Ok(event) = serde_json::from_str::<Event>(&text) {
                        return Ok(Some(event));
                    }
                }
            }
        }
    }
}

/// Serialises a request as one line with its newline.
pub fn encode(request: &Request) -> Result<String, serde_json::Error> {
    let mut line = serde_json::to_string(request)?;
    line.push('\n');
    Ok(line)
}
