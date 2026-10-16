//! In-app fix engine. The webview picks a catalog row; Rust binds every argument from its own listings.

pub mod catalog;
pub mod inputs;
pub mod plan;
pub mod privileged;
pub mod pty;
pub mod reveal;
pub mod run;

#[cfg(test)]
mod tests_inputs;
#[cfg(test)]
mod tests_plan;
#[cfg(test)]
mod tests_privileged;
#[cfg(test)]
mod tests_pty;

use serde::{Deserialize, Serialize};

/// Every error the fix surface can report. Serialised as the snake_case string the frontend matches.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FixError {
    NotInCatalog,
    InvalidChoice,
    InvalidInput,
    PlanExpired,
    Busy,
    PreconditionChanged,
    Cancelled,
    WrongPassword,
    CommandFailed,
    Timeout,
}

impl FixError {
    pub fn as_str(self) -> &'static str {
        match self {
            FixError::NotInCatalog => "not_in_catalog",
            FixError::InvalidChoice => "invalid_choice",
            FixError::InvalidInput => "invalid_input",
            FixError::PlanExpired => "plan_expired",
            FixError::Busy => "busy",
            FixError::PreconditionChanged => "precondition_changed",
            FixError::Cancelled => "cancelled",
            FixError::WrongPassword => "wrong_password",
            FixError::CommandFailed => "command_failed",
            FixError::Timeout => "timeout",
        }
    }
}

impl From<FixError> for String {
    fn from(err: FixError) -> String {
        err.as_str().to_owned()
    }
}

/// The wire shape of what the webview chose. Paths are candidates only; Rust re-lists and matches.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FixChoice {
    None,
    Share { path: String },
    SshKey { path: String },
    Plist { path: String },
    File { path: String },
}

impl FixChoice {
    pub fn path(&self) -> Option<&str> {
        match self {
            FixChoice::None => None,
            FixChoice::Share { path }
            | FixChoice::SshKey { path }
            | FixChoice::Plist { path }
            | FixChoice::File { path } => Some(path),
        }
    }
}

/// Result of a run. Pre-run errors never reach this shape; they reject the invoke instead.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(untagged)]
pub enum FixOutcome {
    Ok {
        ok: bool,
    },
    Failed {
        ok: bool,
        error: FixError,
        step: Option<usize>,
    },
}

impl FixOutcome {
    pub fn ok() -> Self {
        FixOutcome::Ok { ok: true }
    }

    pub fn failed(error: FixError, step: Option<usize>) -> Self {
        FixOutcome::Failed {
            ok: false,
            error,
            step,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn choice_wire_shape_round_trips() {
        let json = serde_json::json!({ "kind": "share", "path": "/Users/alice/Public" });
        let choice: FixChoice = serde_json::from_value(json.clone()).unwrap();
        assert_eq!(
            choice,
            FixChoice::Share {
                path: "/Users/alice/Public".into()
            }
        );
        assert_eq!(serde_json::to_value(&choice).unwrap(), json);
        let none: FixChoice =
            serde_json::from_value(serde_json::json!({ "kind": "none" })).unwrap();
        assert_eq!(none, FixChoice::None);
        assert!(
            serde_json::from_value::<FixChoice>(serde_json::json!({ "kind": "all_ssh_keys" }))
                .is_err()
        );
    }

    #[test]
    fn outcome_and_error_serialise_to_the_contract() {
        assert_eq!(
            serde_json::to_value(FixOutcome::ok()).unwrap(),
            serde_json::json!({ "ok": true })
        );
        assert_eq!(
            serde_json::to_value(FixOutcome::failed(FixError::CommandFailed, Some(1))).unwrap(),
            serde_json::json!({ "ok": false, "error": "command_failed", "step": 1 })
        );
        assert_eq!(String::from(FixError::WrongPassword), "wrong_password");
    }
}
