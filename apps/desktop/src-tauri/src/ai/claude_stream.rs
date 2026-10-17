//! Reads Claude Code's `--output-format stream-json` lines and classifies its result errors.
//! Only codes leave this module; the message text is matched and dropped.

use serde_json::Value;

/// One parsed line. Everything the run does not act on is `Other`.
#[derive(Debug, Clone, PartialEq)]
pub enum Parsed {
    /// A piece of the StructuredOutput tool input (`input_json_delta`).
    Delta(String),
    /// The final line: the structured output, or why there is none.
    Result(Result<Value, StreamError>),
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamError {
    pub subtype: String,
    pub message: String,
}

/// The `ai:stream` error code plus the reset time when a limit message names one.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Classified {
    pub code: &'static str,
    pub until: Option<String>,
}

pub fn parse_line(line: &str) -> Parsed {
    let Ok(value) = serde_json::from_str::<Value>(line) else {
        return Parsed::Other;
    };
    match value.get("type").and_then(Value::as_str) {
        Some("stream_event") => parse_stream_event(&value),
        Some("result") => Parsed::Result(parse_result(&value)),
        _ => Parsed::Other,
    }
}

fn parse_stream_event(value: &Value) -> Parsed {
    let Some(event) = value.get("event") else {
        return Parsed::Other;
    };
    if event.get("type").and_then(Value::as_str) != Some("content_block_delta") {
        return Parsed::Other;
    }
    let Some(delta) = event.get("delta") else {
        return Parsed::Other;
    };
    if delta.get("type").and_then(Value::as_str) != Some("input_json_delta") {
        return Parsed::Other;
    }
    match delta.get("partial_json").and_then(Value::as_str) {
        Some(text) => Parsed::Delta(text.to_owned()),
        None => Parsed::Other,
    }
}

fn parse_result(value: &Value) -> Result<Value, StreamError> {
    let subtype = value
        .get("subtype")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    if subtype == "success" {
        if let Some(output) = value.get("structured_output")
            && output.is_object()
        {
            return Ok(output.clone());
        }
        return Err(StreamError {
            subtype: "no_structured_output".to_owned(),
            message: String::new(),
        });
    }
    let mut parts: Vec<String> = Vec::new();
    for key in ["result", "error", "message"] {
        if let Some(text) = value.get(key).and_then(Value::as_str) {
            parts.push(text.to_owned());
        }
    }
    if let Some(errors) = value.get("errors").and_then(Value::as_array) {
        parts.extend(errors.iter().filter_map(Value::as_str).map(str::to_owned));
    }
    Err(StreamError {
        subtype,
        message: parts.join(" "),
    })
}

/// Maps a result error to the code the webview knows. Subtype first, then the message.
pub fn classify(error: &StreamError, now: chrono::DateTime<chrono::Local>) -> Classified {
    if error.subtype == "error_max_turns" {
        return Classified {
            code: "provider_unavailable",
            until: None,
        };
    }
    let text = error.message.to_lowercase();
    if text.contains("limit") || text.contains("usage") {
        return Classified {
            code: "limit_reached",
            until: parse_reset_time(&text, now),
        };
    }
    if text.contains("log in")
        || text.contains("login")
        || text.contains("auth")
        || text.contains("token")
    {
        return Classified {
            code: "needs_sign_in",
            until: None,
        };
    }
    if text.contains("subscription") || text.contains("plan") {
        return Classified {
            code: "plan_not_eligible",
            until: None,
        };
    }
    Classified {
        code: "provider_unavailable",
        until: None,
    }
}

/// "resets 3pm", "resets at 18:30" or "resets at 3:15 pm" after a "reset" word, to the next such
/// clock time in local time as ISO 8601. None when nothing parses.
pub fn parse_reset_time(lowercase: &str, now: chrono::DateTime<chrono::Local>) -> Option<String> {
    use chrono::{Duration, NaiveTime, TimeZone, Timelike};
    let idx = lowercase.find("reset")?;
    let tail = lowercase.get(idx..)?;
    let re = regex::Regex::new(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?").ok()?;
    let caps = re.captures(tail)?;
    let mut hour: u32 = caps.get(1)?.as_str().parse().ok()?;
    let minute: u32 = caps
        .get(2)
        .map(|m| m.as_str().parse().unwrap_or(0))
        .unwrap_or(0);
    let meridiem = caps.get(3).map(|m| m.as_str());
    match meridiem {
        Some("pm") if hour < 12 => hour += 12,
        Some("am") if hour == 12 => hour = 0,
        None if caps.get(2).is_none() => return None,
        _ => {}
    }
    let time = NaiveTime::from_hms_opt(hour, minute, 0)?;
    let today = now.date_naive().and_time(time);
    let mut at = chrono::Local.from_local_datetime(&today).single()?;
    if at <= now.with_nanosecond(0)? {
        at += Duration::days(1);
    }
    Some(at.to_rfc3339_opts(chrono::SecondsFormat::Secs, true))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const DELTA_1: &str = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"ruleId\":\"TL-MAC-00"}},"session_id":"s","uuid":"u"}"#;
    const DELTA_2: &str = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"1\",\"whyItMattersForYou\":\"Any"}},"session_id":"s","uuid":"u"}"#;
    const TEXT: &str = r#"{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Let me"}},"session_id":"s","uuid":"u"}"#;
    const START: &str = r#"{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"StructuredOutput","input":{}}}}"#;
    const SYSTEM: &str = r#"{"type":"system","subtype":"init","cwd":"/tmp/x","session_id":"s","tools":["StructuredOutput"],"mcp_servers":[],"model":"claude-sonnet-4-5","permissionMode":"default","slash_commands":[],"apiKeySource":"none"}"#;
    const SUCCESS: &str = r#"{"type":"result","subtype":"success","is_error":false,"duration_ms":4000,"num_turns":2,"result":"","session_id":"s","total_cost_usd":0,"structured_output":{"ruleId":"TL-MAC-001","whyItMattersForYou":"Anyone with the disk can read it.","whatCouldHappen":"Loss.","urgency":"today"}}"#;
    const MAX_TURNS: &str = r#"{"type":"result","subtype":"error_max_turns","is_error":true,"num_turns":2,"session_id":"s"}"#;
    const EXEC_ERROR: &str = r#"{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["You've hit your limit · resets 3pm (Europe/Brussels)"],"session_id":"s"}"#;

    #[test]
    fn deltas_carry_only_the_tool_input() {
        assert_eq!(
            parse_line(DELTA_1),
            Parsed::Delta("{\"ruleId\":\"TL-MAC-00".into())
        );
        assert_eq!(parse_line(TEXT), Parsed::Other);
        assert_eq!(parse_line(START), Parsed::Other);
        assert_eq!(parse_line(SYSTEM), Parsed::Other);
        assert_eq!(parse_line("not json"), Parsed::Other);
        assert_eq!(parse_line(""), Parsed::Other);
    }

    #[test]
    fn the_sample_stream_yields_snapshots_and_one_done() {
        let mut buffer = String::new();
        let mut snapshots = Vec::new();
        let mut done = None;
        for line in [SYSTEM, START, DELTA_1, TEXT, DELTA_2, SUCCESS] {
            match parse_line(line) {
                Parsed::Delta(d) => {
                    buffer.push_str(&d);
                    if let Some(obj) = super::super::partial_json::complete_object(&buffer) {
                        snapshots.push(Value::Object(obj));
                    }
                }
                Parsed::Result(r) => done = Some(r),
                Parsed::Other => {}
            }
        }
        assert_eq!(
            snapshots,
            [
                json!({ "ruleId": "TL-MAC-00" }),
                json!({ "ruleId": "TL-MAC-001", "whyItMattersForYou": "Any" }),
            ]
        );
        let output = done.unwrap().unwrap();
        assert_eq!(output["ruleId"], "TL-MAC-001");
        assert_eq!(output["urgency"], "today");
    }

    #[test]
    fn a_success_without_structured_output_is_an_error() {
        let line = r#"{"type":"result","subtype":"success","result":"I cannot."}"#;
        assert_eq!(
            parse_line(line),
            Parsed::Result(Err(StreamError {
                subtype: "no_structured_output".into(),
                message: String::new()
            }))
        );
    }

    fn at(h: u32, m: u32) -> chrono::DateTime<chrono::Local> {
        use chrono::TimeZone;
        chrono::Local
            .with_ymd_and_hms(2026, 10, 16, h, m, 0)
            .single()
            .unwrap()
    }

    fn err(subtype: &str, message: &str) -> StreamError {
        StreamError {
            subtype: subtype.into(),
            message: message.into(),
        }
    }

    #[test]
    fn errors_classify_by_subtype_then_message() {
        let now = at(10, 0);
        assert_eq!(
            parse_line(MAX_TURNS),
            Parsed::Result(Err(err("error_max_turns", "")))
        );
        assert_eq!(
            classify(&err("error_max_turns", "usage limit"), now).code,
            "provider_unavailable"
        );
        let Parsed::Result(Err(limit)) = parse_line(EXEC_ERROR) else {
            panic!("expected an error result");
        };
        let classified = classify(&limit, now);
        assert_eq!(classified.code, "limit_reached");
        let until = classified.until.unwrap();
        assert!(until.starts_with("2026-10-16T15:00:00"), "{until}");
        assert_eq!(
            classify(
                &err("error_during_execution", "Not logged in. Please run /login"),
                now
            )
            .code,
            "needs_sign_in"
        );
        assert_eq!(
            classify(
                &err("error_during_execution", "Invalid authentication token"),
                now
            )
            .code,
            "needs_sign_in"
        );
        assert_eq!(
            classify(
                &err("error_during_execution", "This feature needs a Max plan"),
                now
            )
            .code,
            "plan_not_eligible"
        );
        assert_eq!(
            classify(&err("error_during_execution", "ECONNRESET"), now).code,
            "provider_unavailable"
        );
        assert_eq!(
            classify(&err("no_structured_output", ""), now).code,
            "provider_unavailable"
        );
    }

    #[test]
    fn reset_times_roll_to_tomorrow_and_need_a_clock_word() {
        let now = at(16, 0);
        let until = parse_reset_time("limit · resets 3pm (europe/brussels)", now).unwrap();
        assert!(until.starts_with("2026-10-17T15:00:00"), "{until}");
        let until = parse_reset_time("limit resets at 18:30", now).unwrap();
        assert!(until.starts_with("2026-10-16T18:30:00"), "{until}");
        let until = parse_reset_time("resets at 12:05 am", now).unwrap();
        assert!(until.starts_with("2026-10-17T00:05:00"), "{until}");
        assert_eq!(parse_reset_time("limit resets in 5 hours", now), None);
        assert_eq!(parse_reset_time("usage limit", now), None);
    }
}
