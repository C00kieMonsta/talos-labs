//! The three output schemas handed to Claude Code as `--json-schema`. Rust holds them so the
//! webview never names a schema; tests/explainer_schemas_contract.rs pins them to the core fixture.

use super::protocol::Task;

pub const EXPLAIN: &str = r#"{"type":"object","additionalProperties":false,"required":["ruleId","whyItMattersForYou","whatCouldHappen","urgency"],"properties":{"ruleId":{"type":"string","minLength":1,"maxLength":32},"whyItMattersForYou":{"type":"string"},"whatCouldHappen":{"type":"string"},"urgency":{"type":"string","enum":["today","this_week","when_convenient"]}}}"#;

pub const PRIORITISE: &str = r#"{"type":"object","additionalProperties":false,"required":["order","reasons","startWith"],"properties":{"order":{"type":"array","items":{"type":"string","minLength":1,"maxLength":32}},"reasons":{"type":"array","items":{"type":"object","additionalProperties":false,"required":["ruleId","reason"],"properties":{"ruleId":{"type":"string","minLength":1,"maxLength":32},"reason":{"type":"string"}}}},"startWith":{"type":"array","items":{"type":"string","minLength":1,"maxLength":32}}}}"#;

pub const ASK: &str = r#"{"type":"object","additionalProperties":false,"required":["answer","relatedRuleIds","outsideScope"],"properties":{"answer":{"type":"string"},"relatedRuleIds":{"type":"array","items":{"type":"string","minLength":1,"maxLength":32}},"outsideScope":{"type":"boolean"}}}"#;

/// The schema text for a task, as one line of JSON.
pub fn for_task(task: Task) -> &'static str {
    match task {
        Task::Explain => EXPLAIN,
        Task::Prioritise => PRIORITISE,
        Task::Ask => ASK,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_schema_is_a_closed_object() {
        for task in [Task::Explain, Task::Prioritise, Task::Ask] {
            let schema: serde_json::Value = serde_json::from_str(for_task(task)).unwrap();
            assert_eq!(schema["type"], "object");
            assert_eq!(schema["additionalProperties"], false);
            assert!(schema["required"].as_array().is_some_and(|r| !r.is_empty()));
        }
    }
}
