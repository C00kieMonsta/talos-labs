use super::protocol::*;
use std::io::{self, BufRead, Read};

/// Hands out at most `n` bytes per read so lines arrive in pieces.
struct Chunked<'a> {
    data: &'a [u8],
    n: usize,
    buf: Vec<u8>,
}

impl Read for Chunked<'_> {
    fn read(&mut self, out: &mut [u8]) -> io::Result<usize> {
        let take = self.n.min(out.len()).min(self.data.len());
        out[..take].copy_from_slice(&self.data[..take]);
        self.data = &self.data[take..];
        Ok(take)
    }
}

impl BufRead for Chunked<'_> {
    fn fill_buf(&mut self) -> io::Result<&[u8]> {
        if self.buf.is_empty() {
            let take = self.n.min(self.data.len());
            self.buf = self.data[..take].to_vec();
            self.data = &self.data[take..];
        }
        Ok(&self.buf)
    }
    fn consume(&mut self, amt: usize) {
        self.buf.drain(..amt);
    }
}

fn chunked(data: &[u8], n: usize) -> LineReader<Chunked<'_>> {
    LineReader::new(Chunked {
        data,
        n,
        buf: Vec::new(),
    })
}

#[test]
fn requests_serialise_as_the_helper_expects() {
    let generate = Request::Generate {
        id: "g7".into(),
        task: Task::Explain,
        instructions: "i".into(),
        prompt: "p".into(),
        max_tokens: 600,
    };
    assert_eq!(
        encode(&generate).unwrap(),
        "{\"op\":\"generate\",\"id\":\"g7\",\"task\":\"explain\",\"instructions\":\"i\",\"prompt\":\"p\",\"maxTokens\":600}\n"
    );
    assert_eq!(
        encode(&Request::Availability { id: "a1".into() }).unwrap(),
        "{\"op\":\"availability\",\"id\":\"a1\"}\n"
    );
    assert_eq!(
        encode(&Request::Cancel { id: "g7".into() }).unwrap(),
        "{\"op\":\"cancel\",\"id\":\"g7\"}\n"
    );
    assert_eq!(
        encode(&Request::Shutdown).unwrap(),
        "{\"op\":\"shutdown\"}\n"
    );
    let back: Request = serde_json::from_str(encode(&generate).unwrap().trim()).unwrap();
    assert_eq!(back, generate);
}

#[test]
fn events_round_trip() {
    let lines = [
        r#"{"id":"a1","event":"availability","state":"available"}"#,
        r#"{"id":"a1","event":"availability","state":"model_not_ready"}"#,
        r#"{"id":"g7","event":"partial","json":{"whyItMattersForYou":"Your disk holds"}}"#,
        r#"{"id":"g7","event":"done","json":{"ruleId":"TL-MAC-001","urgency":"today"}}"#,
        r#"{"id":"g7","event":"error","code":"guardrail"}"#,
    ];
    let events: Vec<Event> = lines
        .iter()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(
        events[0],
        Event::Availability {
            id: "a1".into(),
            state: HelperAvailability::Available
        }
    );
    assert_eq!(
        events[1],
        Event::Availability {
            id: "a1".into(),
            state: HelperAvailability::ModelNotReady
        }
    );
    assert!(
        matches!(&events[2], Event::Partial { id, json } if id == "g7" && json["whyItMattersForYou"] == "Your disk holds")
    );
    assert!(matches!(&events[3], Event::Done { id, .. } if id == "g7"));
    assert_eq!(
        events[4],
        Event::Error {
            id: "g7".into(),
            code: "guardrail".into()
        }
    );
    for (line, event) in lines.iter().zip(&events) {
        let again: Event = serde_json::from_str(&serde_json::to_string(event).unwrap()).unwrap();
        assert_eq!(&again, event, "{line}");
        assert_eq!(event.id(), if line.contains("a1") { "a1" } else { "g7" });
    }
}

#[test]
fn reader_handles_partial_chunks_and_crlf() {
    let data = b"{\"id\":\"a\",\"event\":\"error\",\"code\":\"x\"}\r\n\n{\"id\":\"b\",\"event\":\"error\",\"code\":\"y\"}\ntail";
    for n in [1, 3, 7, 64, 4096] {
        let mut reader = chunked(data, n);
        assert_eq!(
            reader.next_event().unwrap(),
            Some(Event::Error {
                id: "a".into(),
                code: "x".into()
            }),
            "n={n}"
        );
        assert_eq!(
            reader.next_event().unwrap(),
            Some(Event::Error {
                id: "b".into(),
                code: "y".into()
            }),
            "n={n}"
        );
        assert_eq!(reader.next_event().unwrap(), None, "n={n}");
    }
}

#[test]
fn reader_drops_over_long_malformed_and_non_utf8_lines() {
    let mut data = vec![b'x'; MAX_LINE_BYTES + 1];
    data.push(b'\n');
    data.extend_from_slice(
        b"not json\n\xff\xfe\n{\"id\":\"z\",\"event\":\"error\",\"code\":\"ok\"}\n",
    );
    let mut reader = chunked(&data, 8192);
    assert!(matches!(reader.next_line().unwrap(), Line::TooLong));
    assert!(matches!(reader.next_line().unwrap(), Line::Text(t) if t == "not json"));
    assert!(matches!(reader.next_line().unwrap(), Line::NotUtf8));
    assert!(matches!(reader.next_line().unwrap(), Line::Text(_)));
    assert!(matches!(reader.next_line().unwrap(), Line::Eof));
    let mut reader = chunked(&data, 8192);
    assert_eq!(
        reader.next_event().unwrap(),
        Some(Event::Error {
            id: "z".into(),
            code: "ok".into()
        })
    );
    let exact = vec![b'y'; MAX_LINE_BYTES];
    let mut reader = chunked(&exact, 65536);
    assert!(
        matches!(reader.next_line().unwrap(), Line::Eof),
        "a partial line at EOF is discarded"
    );
}
