//! Stands in for the talos-ai helper in tests. TALOS_AI_FAKE picks the script.
//!
//! Scripts: ok (default), availability:<state>, error:<code>, crash, hang, wait_cancel, ignore_cancel, hang_availability.

use std::io::{BufRead, Write};

fn say(line: &str) {
    let mut out = std::io::stdout().lock();
    let _ = out.write_all(line.as_bytes());
    let _ = out.write_all(b"\n");
    let _ = out.flush();
}

fn field<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let start = line.find(&format!("\"{key}\":\""))? + key.len() + 4;
    let rest = line.get(start..)?;
    rest.find('"').and_then(|end| rest.get(..end))
}

fn main() {
    let script = std::env::var("TALOS_AI_FAKE").unwrap_or_else(|_| "ok".into());
    let stdin = std::io::stdin();
    let mut waiting_cancel: Option<String> = None;
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let id = field(&line, "id").unwrap_or("").to_owned();
        let op = field(&line, "op").unwrap_or("");
        match op {
            "shutdown" => std::process::exit(0),
            "availability" => {
                if script == "hang_availability" {
                    continue;
                }
                let state = script.strip_prefix("availability:").unwrap_or("available");
                say(&format!(
                    "{{\"id\":\"{id}\",\"event\":\"availability\",\"state\":\"{state}\"}}"
                ));
            }
            "cancel" => {
                if script == "ignore_cancel" {
                    continue;
                }
                if waiting_cancel.take().as_deref() == Some(id.as_str()) {
                    say(&format!(
                        "{{\"id\":\"{id}\",\"event\":\"error\",\"code\":\"cancelled\"}}"
                    ));
                }
            }
            "generate" => {
                if let Some(code) = script.strip_prefix("error:") {
                    say(&format!(
                        "{{\"id\":\"{id}\",\"event\":\"error\",\"code\":\"{code}\"}}"
                    ));
                    continue;
                }
                match script.as_str() {
                    "hang" => continue,
                    "crash" => {
                        say(&format!(
                            "{{\"id\":\"{id}\",\"event\":\"partial\",\"json\":{{\"whyItMattersForYou\":\"Your\"}}}}"
                        ));
                        std::process::exit(3);
                    }
                    "wait_cancel" | "ignore_cancel" => {
                        say(&format!(
                            "{{\"id\":\"{id}\",\"event\":\"partial\",\"json\":{{\"answer\":\"Half\"}}}}"
                        ));
                        waiting_cancel = Some(id);
                    }
                    _ => {
                        say("this line is not json");
                        say(&format!(
                            "{{\"id\":\"{id}\",\"event\":\"partial\",\"json\":{{\"whyItMattersForYou\":\"Your\"}}}}"
                        ));
                        say(&format!(
                            "{{\"id\":\"{id}\",\"event\":\"partial\",\"json\":{{\"whyItMattersForYou\":\"Your disk\"}}}}"
                        ));
                        say(&format!(
                            "{{\"id\":\"{id}\",\"event\":\"done\",\"json\":{{\"ruleId\":\"TL-MAC-001\",\"whyItMattersForYou\":\"Your disk\",\"whatCouldHappen\":\"Loss\",\"urgency\":\"today\"}}}}"
                        ));
                    }
                }
            }
            _ => say("{\"id\":\"\",\"event\":\"error\",\"code\":\"bad_request\"}"),
        }
    }
}
