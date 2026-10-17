//! The ChatGPT call for the watch task, made from Rust: the Responses API body is a port of
//! core's `watchRequestBody` (fixtures/watch-cases.json pins both), sent non-streaming with the
//! token the Keychain holds, to the same endpoint the webview uses for the other tasks. The
//! only input is a `WatchContext`; the kill switch is honoured before any Keychain read.

use std::path::Path;

use chrono::Utc;
use serde_json::{Map, Value};

use super::chatgpt_oauth::{self, Http, Keychain, Store, Ureq};
use super::schemas;
use crate::watch::context::render;
use crate::watch::types::WatchContext;

pub const RESPONSES_URL: &str = "https://api.openai.com/v1/responses";
pub const MAX_OUTPUT_TOKENS: u32 = 1200;
/// `buildWatchInstructions()`, read from the core fixture so both sides stay equal.
pub const INSTRUCTIONS: &str =
    include_str!("../../../../../packages/core/fixtures/watch-instructions.txt");

const UNSUPPORTED_IN_STRICT: [&str; 8] = [
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minimum",
    "maximum",
    "pattern",
    "format",
];

fn walk(value: &Value) -> Value {
    match value {
        Value::Array(items) => Value::Array(items.iter().map(walk).collect()),
        Value::Object(map) => Value::Object(strip(map)),
        other => other.clone(),
    }
}

/// The schema without the keywords OpenAI's strict mode rejects; property names are not keywords.
fn strip(schema: &Map<String, Value>) -> Map<String, Value> {
    let mut out = Map::new();
    for (key, value) in schema {
        if UNSUPPORTED_IN_STRICT.contains(&key.as_str()) {
            continue;
        }
        if key == "properties"
            && let Value::Object(props) = value
        {
            let mut stripped = Map::new();
            for (name, sub) in props {
                stripped.insert(name.clone(), walk(sub));
            }
            out.insert(key.clone(), Value::Object(stripped));
            continue;
        }
        out.insert(key.clone(), walk(value));
    }
    out
}

/// `WATCH_JSON_SCHEMA` stripped for strict mode.
pub fn strict_schema() -> Value {
    serde_json::from_str::<Value>(schemas::WATCH)
        .ok()
        .as_ref()
        .map(walk)
        .unwrap_or(Value::Null)
}

/// The POST body: `responsesRequestBody("watch", model, instructions, watchTurns(context),
/// { stream: false, maxOutputTokens: 1200 })`.
pub fn body(model: &str, instructions: &str, context: &WatchContext) -> Value {
    serde_json::json!({
        "model": model,
        "instructions": instructions,
        "input": [{ "role": "user", "content": render(context) }],
        "store": false,
        "stream": false,
        "max_output_tokens": MAX_OUTPUT_TOKENS,
        "reasoning": { "effort": "low" },
        "text": { "format": { "type": "json_schema", "name": "watch", "schema": strict_schema(), "strict": true } },
    })
}

/// The first `output_text` of a plain (non-streaming) reply, parsed as JSON.
pub fn parse_reply(text: &str) -> Option<Value> {
    let reply: Value = serde_json::from_str(text).ok()?;
    let outputs = reply.get("output")?.as_array()?;
    for item in outputs {
        let Some(content) = item.get("content").and_then(Value::as_array) else {
            continue;
        };
        for part in content {
            if part.get("type").and_then(Value::as_str) == Some("output_text")
                && let Some(text) = part.get("text").and_then(Value::as_str)
            {
                return serde_json::from_str(text).ok();
            }
        }
    }
    None
}

/// Makes the call with injectable parts. `not_offered` comes first, before the store is read.
pub fn call_with(
    offered: bool,
    store: &dyn Store,
    http: &dyn Http,
    dir: &Path,
    context: &WatchContext,
) -> Result<Value, String> {
    if !offered {
        return Err("not_offered".to_owned());
    }
    let model = chatgpt_oauth::read_host_state(dir).model;
    if model.is_empty() {
        return Err("no_model".to_owned());
    }
    let tokens = chatgpt_oauth::current_tokens(store, http, Utc::now(), false)
        .map_err(|e| e.code().to_owned())?;
    let request = body(&model, INSTRUCTIONS, context);
    let reply = http
        .post_json_bearer(RESPONSES_URL, &tokens.access, &request)
        .ok_or_else(|| "provider_unavailable".to_owned())?;
    match reply.status {
        200 => parse_reply(&reply.body).ok_or_else(|| "rejected_output".to_owned()),
        401 => Err("needs_sign_in".to_owned()),
        429 => Err("limit_reached".to_owned()),
        _ => Err("provider_unavailable".to_owned()),
    }
}

/// The production call: the kill switch, the Keychain and ureq.
pub fn call(dir: &Path, context: &WatchContext) -> Result<Value, String> {
    call_with(chatgpt_oauth::offered(), &Keychain, &Ureq, dir, context)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::chatgpt_oauth::HttpReply;
    use std::cell::RefCell;
    use zeroize::Zeroizing;

    #[derive(Default)]
    struct Untouched {
        reads: RefCell<u32>,
    }

    impl Store for Untouched {
        fn get(&self, _name: &str) -> Result<Option<String>, String> {
            *self.reads.borrow_mut() += 1;
            Ok(None)
        }
        fn set(&self, _name: &str, _value: &str) -> Result<(), String> {
            Ok(())
        }
        fn delete(&self, _name: &str) -> Result<(), String> {
            Ok(())
        }
    }

    #[derive(Default)]
    struct NoHttp;

    impl Http for NoHttp {
        fn post_form(&self, _url: &str, _form: &[(&str, &str)]) -> Option<HttpReply> {
            None
        }
        fn get_bearer(&self, _url: &str, _token: &str) -> Option<HttpReply> {
            None
        }
        fn post_json_bearer(&self, _url: &str, _token: &str, _body: &Value) -> Option<HttpReply> {
            Some(HttpReply {
                status: 200,
                body: Zeroizing::new(String::new()),
            })
        }
    }

    fn context() -> WatchContext {
        crate::watch::context::to_watch_context(&crate::watch::context::ContextInput {
            previous_report: None,
            report: None,
            readings: &[],
            memory: &crate::watch::context::ContextMemory::default(),
            recent: &[],
            now: "2026-10-17T12:00:00.000Z",
            os: crate::state::Os::Macos,
            os_version: "27.0.1",
            profile: crate::watch::types::ExplainerProfile::default(),
            cycle: crate::watch::types::WatchCycle {
                index: 1,
                minutes_since_full_check: 0,
                minutes_since_last_change: None,
                probes_left: 3,
            },
            last_verdict: None,
        })
    }

    #[test]
    fn under_the_kill_switch_nothing_touches_the_store() {
        let store = Untouched::default();
        let dir = std::env::temp_dir().join("talos-watch-not-offered");
        let result = call_with(false, &store, &NoHttp, &dir, &context());
        assert_eq!(result, Err("not_offered".to_owned()));
        assert_eq!(*store.reads.borrow(), 0);
    }

    #[test]
    fn an_empty_model_refuses_before_the_keychain() {
        let store = Untouched::default();
        let dir = std::env::temp_dir().join(format!("talos-watch-no-model-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(
            call_with(true, &store, &NoHttp, &dir, &context()),
            Err("no_model".to_owned())
        );
        assert_eq!(*store.reads.borrow(), 0);
    }

    #[test]
    fn the_body_is_non_streaming_strict_and_carries_the_stripped_schema() {
        let body = body("gpt-test", "sys", &context());
        assert_eq!(body["stream"], false);
        assert_eq!(body["store"], false);
        assert_eq!(body["max_output_tokens"], 1200);
        assert_eq!(body["reasoning"]["effort"], "low");
        assert_eq!(body["text"]["format"]["name"], "watch");
        assert_eq!(body["text"]["format"]["strict"], true);
        let schema = &body["text"]["format"]["schema"];
        assert_eq!(schema["additionalProperties"], false);
        assert!(
            schema["properties"]["ratingReason"]
                .get("maxLength")
                .is_none()
        );
        assert!(schema["properties"]["basedOn"].get("maxItems").is_none());
        assert_eq!(
            schema["properties"]["rating"]["enum"]
                .as_array()
                .unwrap()
                .len(),
            3
        );
        assert!(
            body["input"][0]["content"]
                .as_str()
                .unwrap()
                .starts_with("{\"task\":\"watch\",\"context\":")
        );
        assert!(
            INSTRUCTIONS.ends_with("The ids are the only vocabulary.\n")
                || INSTRUCTIONS.ends_with("The ids are the only vocabulary.")
        );
    }

    #[test]
    fn replies_are_read_from_the_first_output_text() {
        let reply = r#"{"id":"resp_1","output":[{"type":"reasoning","summary":[]},{"type":"message","content":[{"type":"output_text","text":"{\"rating\":\"calm\",\"ratingReason\":\"\",\"basedOn\":[],\"probes\":[],\"actions\":[]}"}]}]}"#;
        let parsed = parse_reply(reply).unwrap();
        assert_eq!(parsed["rating"], "calm");
        assert!(parse_reply("{}").is_none());
        assert!(parse_reply("not json").is_none());
        assert!(
            parse_reply(r#"{"output":[{"content":[{"type":"output_text","text":"nope"}]}]}"#)
                .is_none()
        );
    }
}
