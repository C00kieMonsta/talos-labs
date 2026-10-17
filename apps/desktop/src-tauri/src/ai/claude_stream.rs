//! Reads Claude Code's `--output-format stream-json` lines and classifies its result errors.
//! Only codes leave this module; the message text is matched and dropped.

use serde_json::Value;

/// One parsed line. Everything the run does not act on is `Other`.
#[derive(Debug, Clone, PartialEq)]
pub enum Parsed {
    /// A piece of the StructuredOutput tool input (`input_json_delta`).
    Delta(String),
    /// The final line of a turn: the structured output, or why there is none.
    Result(TurnResult),
    /// `system/api_retry`; `auth` when the failed attempt was `authentication_failed`.
    ApiRetry { auth: bool },
    /// `system/init` with the protocol capabilities the process advertises.
    Init { capabilities: Vec<String> },
    Other,
}

/// A `result` line. On a long-lived process every turn ends with one, naming the user message
/// it answers.
#[derive(Debug, Clone, PartialEq)]
pub struct TurnResult {
    pub outcome: Result<Value, StreamError>,
    pub user_message_uuid: Option<String>,
    pub result_index: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StreamError {
    pub subtype: String,
    pub message: String,
    /// `api_error_status`, read as a number or a numeric string.
    pub status: Option<u16>,
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
        Some("result") => Parsed::Result(TurnResult {
            outcome: parse_result(&value),
            user_message_uuid: value
                .get("user_message_uuid")
                .and_then(Value::as_str)
                .map(str::to_owned),
            result_index: value.get("result_index").and_then(Value::as_u64),
        }),
        Some("system") => parse_system(&value),
        _ => Parsed::Other,
    }
}

fn parse_system(value: &Value) -> Parsed {
    match value.get("subtype").and_then(Value::as_str) {
        Some("init") => Parsed::Init {
            capabilities: value
                .get("capabilities")
                .and_then(Value::as_array)
                .map(|list| {
                    list.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default(),
        },
        Some("api_retry") => Parsed::ApiRetry {
            auth: value.get("error").and_then(Value::as_str) == Some("authentication_failed"),
        },
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

/// `api_error_status` is an int in the binary's own schema and a string in the SDK reference.
fn parse_status(value: &Value) -> Option<u16> {
    let raw = value.get("api_error_status")?;
    if let Some(n) = raw.as_u64() {
        return u16::try_from(n).ok();
    }
    raw.as_str()?.trim().parse().ok()
}

fn error_message(value: &Value) -> String {
    let mut parts: Vec<String> = Vec::new();
    for key in ["result", "error", "message"] {
        if let Some(text) = value.get(key).and_then(Value::as_str) {
            parts.push(text.to_owned());
        }
    }
    if let Some(errors) = value.get("errors").and_then(Value::as_array) {
        for entry in errors {
            if let Some(text) = entry.as_str() {
                parts.push(text.to_owned());
            } else if let Some(text) = entry.get("message").and_then(Value::as_str) {
                parts.push(text.to_owned());
            }
        }
    }
    parts.join(" ")
}

fn parse_result(value: &Value) -> Result<Value, StreamError> {
    let subtype = value
        .get("subtype")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let status = parse_status(value);
    // A failed API call can still be filed under `success`; the error flag wins.
    if value.get("is_error").and_then(Value::as_bool) == Some(true) {
        return Err(StreamError {
            subtype: if subtype == "success" {
                "api_error".to_owned()
            } else {
                subtype
            },
            message: error_message(value),
            status,
        });
    }
    if subtype == "success" {
        if let Some(output) = value.get("structured_output")
            && output.is_object()
        {
            return Ok(output.clone());
        }
        return Err(StreamError {
            subtype: "no_structured_output".to_owned(),
            message: String::new(),
            status,
        });
    }
    Err(StreamError {
        subtype,
        message: error_message(value),
        status,
    })
}

fn limit_words(text: &str) -> bool {
    text.contains("limit") || text.contains("usage")
}

/// Maps a result error to the code the webview knows. Status first, then subtype, then the message.
pub fn classify(error: &StreamError, now: chrono::DateTime<chrono::Local>) -> Classified {
    let text = error.message.to_lowercase();
    match error.status {
        Some(401) => {
            return Classified {
                code: "needs_sign_in",
                until: None,
            };
        }
        Some(429) => {
            return if limit_words(&text) {
                Classified {
                    code: "limit_reached",
                    until: parse_reset_time(&text, now),
                }
            } else {
                Classified {
                    code: "provider_unavailable",
                    until: None,
                }
            };
        }
        _ => {}
    }
    if error.subtype == "error_max_turns" {
        return Classified {
            code: "provider_unavailable",
            until: None,
        };
    }
    if limit_words(&text) {
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

    fn outcome(line: &str) -> Result<Value, StreamError> {
        match parse_line(line) {
            Parsed::Result(result) => result.outcome,
            other => panic!("expected a result, got {other:?}"),
        }
    }

    #[test]
    fn deltas_carry_only_the_tool_input() {
        assert_eq!(
            parse_line(DELTA_1),
            Parsed::Delta("{\"ruleId\":\"TL-MAC-00".into())
        );
        assert_eq!(parse_line(TEXT), Parsed::Other);
        assert_eq!(parse_line(START), Parsed::Other);
        assert_eq!(
            parse_line(SYSTEM),
            Parsed::Init {
                capabilities: Vec::new()
            }
        );
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
                Parsed::Result(r) => done = Some(r.outcome),
                Parsed::Other | Parsed::Init { .. } | Parsed::ApiRetry { .. } => {}
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
            outcome(line),
            Err(StreamError {
                subtype: "no_structured_output".into(),
                message: String::new(),
                status: None,
            })
        );
    }

    #[test]
    fn result_lines_carry_the_user_message_uuid_and_index() {
        let line = r#"{"type":"result","subtype":"success","is_error":false,"user_message_uuid":"0f2a-1","result_index":3,"structured_output":{"reply":"hi"}}"#;
        assert_eq!(
            parse_line(line),
            Parsed::Result(TurnResult {
                outcome: Ok(json!({ "reply": "hi" })),
                user_message_uuid: Some("0f2a-1".into()),
                result_index: Some(3),
            })
        );
        let Parsed::Result(bare) = parse_line(SUCCESS) else {
            panic!("a result");
        };
        assert_eq!(bare.user_message_uuid, None);
        assert_eq!(bare.result_index, None);
    }

    #[test]
    fn an_is_error_success_carries_the_message_and_status() {
        let now = at(10, 0);
        let number = r#"{"type":"result","subtype":"success","is_error":true,"api_error_status":401,"result":"API Error: 401 {\"type\":\"error\"}","user_message_uuid":"u1"}"#;
        let error = outcome(number).unwrap_err();
        assert_eq!(error.subtype, "api_error");
        assert_eq!(error.status, Some(401));
        assert!(error.message.starts_with("API Error: 401"));
        assert_eq!(classify(&error, now).code, "needs_sign_in");

        let string = r#"{"type":"result","subtype":"success","is_error":true,"api_error_status":"429","errors":[{"type":"api","message":"Rate limit: usage limit reached, resets 3pm"}]}"#;
        let error = outcome(string).unwrap_err();
        assert_eq!(error.status, Some(429));
        let classified = classify(&error, now);
        assert_eq!(classified.code, "limit_reached");
        assert!(classified.until.unwrap().starts_with("2026-10-16T15:00:00"));

        let bare_429 = r#"{"type":"result","subtype":"success","is_error":true,"api_error_status":429,"result":"Overloaded"}"#;
        let error = outcome(bare_429).unwrap_err();
        assert_eq!(classify(&error, now).code, "provider_unavailable");

        let bad = r#"{"type":"result","subtype":"success","is_error":true,"api_error_status":"400","result":"bad request"}"#;
        let error = outcome(bad).unwrap_err();
        assert_eq!(error.status, Some(400));
        assert_eq!(error.message, "bad request");
        assert_eq!(classify(&error, now).code, "provider_unavailable");

        let nonsense = r#"{"type":"result","subtype":"success","is_error":true,"api_error_status":"many"}"#;
        assert_eq!(outcome(nonsense).unwrap_err().status, None);
    }

    #[test]
    fn api_retry_lines_say_whether_auth_failed() {
        let auth = r#"{"type":"system","subtype":"api_retry","attempt":1,"max_retries":10,"retry_delay_ms":500,"error_status":401,"error":"authentication_failed","uuid":"x","session_id":"s"}"#;
        assert_eq!(parse_line(auth), Parsed::ApiRetry { auth: true });
        let overloaded = r#"{"type":"system","subtype":"api_retry","attempt":2,"error_status":529,"error":"overloaded"}"#;
        assert_eq!(parse_line(overloaded), Parsed::ApiRetry { auth: false });
        let other = r#"{"type":"system","subtype":"permission_denied"}"#;
        assert_eq!(parse_line(other), Parsed::Other);
    }

    #[test]
    fn init_lines_carry_capabilities() {
        let line = r#"{"type":"system","subtype":"init","capabilities":["interrupt_receipt_v1","interrupt_cancel_queued_v1",7],"session_id":"s"}"#;
        assert_eq!(
            parse_line(line),
            Parsed::Init {
                capabilities: vec![
                    "interrupt_receipt_v1".into(),
                    "interrupt_cancel_queued_v1".into()
                ]
            }
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
            status: None,
        }
    }

    #[test]
    fn errors_classify_by_subtype_then_message() {
        let now = at(10, 0);
        assert_eq!(outcome(MAX_TURNS), Err(err("error_max_turns", "")));
        assert_eq!(
            classify(&err("error_max_turns", "usage limit"), now).code,
            "provider_unavailable"
        );
        let limit = outcome(EXEC_ERROR).unwrap_err();
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
