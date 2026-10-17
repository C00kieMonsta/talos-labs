//! The five output schemas handed to Claude Code as `--json-schema`. Rust holds them so the
//! webview never names a schema; tests/explainer_schemas_contract.rs pins them to the core fixture.

use super::protocol::Task;

pub const EXPLAIN: &str = r#"{"type":"object","additionalProperties":false,"required":["ruleId","whyItMattersForYou","whatCouldHappen","urgency"],"properties":{"ruleId":{"type":"string","minLength":1,"maxLength":32},"whyItMattersForYou":{"type":"string"},"whatCouldHappen":{"type":"string"},"urgency":{"type":"string","enum":["today","this_week","when_convenient"]}}}"#;

pub const PRIORITISE: &str = r#"{"type":"object","additionalProperties":false,"required":["order","reasons","startWith"],"properties":{"order":{"type":"array","items":{"type":"string","minLength":1,"maxLength":32}},"reasons":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["ruleId","reason"],"properties":{"ruleId":{"type":"string","minLength":1,"maxLength":32},"reason":{"type":"string"}}}},"startWith":{"type":"array","items":{"type":"string","minLength":1,"maxLength":32}}}}"#;

pub const ASK: &str = r#"{"type":"object","additionalProperties":false,"required":["answer","relatedRuleIds","outsideScope"],"properties":{"answer":{"type":"string"},"relatedRuleIds":{"type":"array","items":{"type":"string","minLength":1,"maxLength":32}},"outsideScope":{"type":"boolean"}}}"#;

/// WATCH_JSON_SCHEMA in packages/core/src/explainer/schemas.ts.
pub const WATCH: &str = r#"{"type":"object","additionalProperties":false,"required":["rating","ratingReason","basedOn","probes","actions"],"properties":{"rating":{"type":"string","enum":["calm","keep_an_eye","act_now"]},"ratingReason":{"type":"string","maxLength":120},"basedOn":{"type":"array","maxItems":6,"items":{"type":"string","minLength":1,"maxLength":48}},"probes":{"type":"array","maxItems":3,"items":{"type":"object","additionalProperties":false,"required":["probeId","reason"],"properties":{"probeId":{"type":"string","minLength":1,"maxLength":48},"reason":{"type":"string","maxLength":300}}}},"actions":{"type":"array","maxItems":3,"items":{"type":"object","additionalProperties":false,"required":["actionId","sentence"],"properties":{"actionId":{"type":"string","minLength":1,"maxLength":48},"sentence":{"type":"string","maxLength":300}}}}}}"#;

/// CHAT_JSON_SCHEMA in packages/core/src/explainer/schemas.ts: the closed intent kinds and a nullable ruleId.
pub const CHAT: &str = r#"{"type":"object","additionalProperties":false,"required":["reply","relatedRuleIds","outsideScope","intents"],"properties":{"reply":{"type":"string"},"relatedRuleIds":{"type":"array","items":{"type":"string","minLength":1,"maxLength":32}},"outsideScope":{"type":"boolean"},"intents":{"type":"array","maxItems":3,"items":{"type":"object","additionalProperties":false,"required":["kind","ruleId"],"properties":{"kind":{"type":"string","enum":["fix_rule","fix_batch","show_where","explain_rule","open_details","show_list","rescan","change_ai","snooze_rule","accept_rule","open_watch"]},"ruleId":{"type":["string","null"],"minLength":1,"maxLength":32}}}}}}"#;

/// The schema text for a task, as one line of JSON.
pub fn for_task(task: Task) -> &'static str {
    match task {
        Task::Explain => EXPLAIN,
        Task::Prioritise => PRIORITISE,
        Task::Ask => ASK,
        Task::Watch => WATCH,
        Task::Chat => CHAT,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_schema_is_a_closed_object() {
        for task in [
            Task::Explain,
            Task::Prioritise,
            Task::Ask,
            Task::Watch,
            Task::Chat,
        ] {
            let schema: serde_json::Value = serde_json::from_str(for_task(task)).unwrap();
            assert_eq!(schema["type"], "object");
            assert_eq!(schema["additionalProperties"], false);
            assert!(schema["required"].as_array().is_some_and(|r| !r.is_empty()));
        }
    }

    #[test]
    fn the_chat_schema_closes_the_intent_kinds_and_allows_a_null_rule_id() {
        let schema: serde_json::Value = serde_json::from_str(CHAT).unwrap();
        let intent = &schema["properties"]["intents"]["items"];
        assert_eq!(schema["properties"]["intents"]["maxItems"], 3);
        assert_eq!(intent["additionalProperties"], false);
        assert_eq!(
            intent["properties"]["kind"]["enum"]
                .as_array()
                .map(Vec::len),
            Some(11)
        );
        assert_eq!(
            intent["properties"]["ruleId"]["type"],
            serde_json::json!(["string", "null"])
        );
    }
}
