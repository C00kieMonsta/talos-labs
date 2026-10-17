//! The remote providers (ChatGPT, Claude plan): shared wire types, the one-at-a-time connect job
//! and the Tauri commands over `chatgpt_oauth` and `claude_code`.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use tauri_plugin_opener::OpenerExt;

use super::chatgpt_oauth::{self, ChatGpt};
use super::claude_code::{self, ClaudeCode};
use crate::commands::app_data_dir;

/// Same eight names as `PROVIDER_STATES` in packages/core.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderState {
    Available,
    NotConnected,
    Connecting,
    NeedsSignIn,
    LimitReached,
    PlanNotEligible,
    ProviderUnavailable,
    NotOffered,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProviderStatus {
    pub state: ProviderState,
    /// ISO time when `limit_reached` knows when the allowance returns; null otherwise.
    pub until: Option<String>,
}

impl ProviderStatus {
    pub fn plain(state: ProviderState) -> Self {
        ProviderStatus { state, until: None }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    Chatgpt,
    ClaudePlan,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Stage {
    Idle,
    Fetching,
    SigningIn,
    Done,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectOutcome {
    Closed,
    PlanNotEligible,
    ProviderUnavailable,
    Timeout,
    FetchFailed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ConnectPoll {
    pub stage: Stage,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outcome: Option<ConnectOutcome>,
}

impl ConnectPoll {
    pub const IDLE: ConnectPoll = ConnectPoll {
        stage: Stage::Idle,
        outcome: None,
    };
    pub fn stage(stage: Stage) -> Self {
        ConnectPoll {
            stage,
            outcome: None,
        }
    }
    pub fn failed(outcome: ConnectOutcome) -> Self {
        ConnectPoll {
            stage: Stage::Failed,
            outcome: Some(outcome),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct OfferedResponse {
    pub chatgpt: bool,
    #[serde(rename = "claude_plan")]
    pub claude_plan: bool,
    pub apple: bool,
}

/// How long a sign-in may stay open before it is given up as `timeout`.
pub const CONNECT_DEADLINE: Duration = Duration::from_secs(600);

pub(crate) fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// One sign-in at a time per provider. The worker thread writes the stage; the webview polls it.
#[derive(Debug)]
pub struct ConnectJob {
    poll: Mutex<ConnectPoll>,
    cancel: AtomicBool,
    alive: AtomicBool,
}

impl Default for ConnectJob {
    fn default() -> Self {
        ConnectJob {
            poll: Mutex::new(ConnectPoll::IDLE),
            cancel: AtomicBool::new(false),
            alive: AtomicBool::new(false),
        }
    }
}

impl ConnectJob {
    /// Claims the job; false while another sign-in runs.
    pub fn try_start(&self) -> bool {
        if self.alive.swap(true, Ordering::SeqCst) {
            return false;
        }
        self.cancel.store(false, Ordering::SeqCst);
        *lock(&self.poll) = ConnectPoll::IDLE;
        true
    }

    pub fn set(&self, poll: ConnectPoll) {
        *lock(&self.poll) = poll;
    }

    /// Records the final stage and releases the job.
    pub fn finish(&self, poll: ConnectPoll) {
        *lock(&self.poll) = poll;
        self.alive.store(false, Ordering::SeqCst);
    }

    pub fn poll(&self) -> ConnectPoll {
        *lock(&self.poll)
    }

    pub fn alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    pub fn cancel_flag(&self) -> &AtomicBool {
        &self.cancel
    }

    /// Asks a running job to stop; a job that already ended short of `done` reads as closed.
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        if !self.alive() {
            let mut poll = lock(&self.poll);
            if poll.stage != Stage::Done {
                *poll = ConnectPoll::failed(ConnectOutcome::Closed);
            }
        }
    }
}

/// Managed Tauri state for both providers.
pub struct Providers {
    pub chatgpt: Arc<ChatGpt>,
    pub claude: Arc<ClaudeCode>,
}

impl Default for Providers {
    fn default() -> Self {
        Providers {
            chatgpt: Arc::new(ChatGpt::default()),
            claude: Arc::new(ClaudeCode::default()),
        }
    }
}

/// The only page a connect may open: the OpenAI authorize endpoint. Claude's own program opens
/// its page itself.
pub fn browser_url_allowed(url: &str) -> bool {
    url.starts_with(&format!("{}?", chatgpt_oauth::AUTHORIZE_URL))
}

fn open_in_browser(app: &AppHandle, url: &str) -> Result<(), String> {
    if !browser_url_allowed(url) {
        return Err("url not allowed".to_owned());
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app_data_dir(app)
}

#[tauri::command]
pub async fn ai_provider_status(
    app: AppHandle,
    state: State<'_, Providers>,
    provider: Provider,
    fresh: bool,
) -> Result<ProviderStatus, String> {
    let dir = data_dir(&app)?;
    let chatgpt = Arc::clone(&state.chatgpt);
    let claude = Arc::clone(&state.claude);
    tauri::async_runtime::spawn_blocking(move || match provider {
        Provider::Chatgpt => chatgpt.status(&chatgpt_oauth::Keychain, &dir, fresh),
        Provider::ClaudePlan => claude.status(&claude_code::Dirs::under(&dir), fresh),
    })
    .await
    .map_err(|e| e.to_string())
}

/// "On this Mac" is hidden on a Mac that cannot run Apple Intelligence, so the Apple engine is
/// probed here rather than read from its cache: nothing else probes it while another provider is chosen.
#[tauri::command]
pub async fn ai_connect_offered(ai: State<'_, super::AiState>) -> Result<OfferedResponse, String> {
    let engine = ai.engine();
    let apple = tauri::async_runtime::spawn_blocking(move || {
        engine.availability(false) != super::Availability::DeviceNotEligible
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(OfferedResponse {
        chatgpt: chatgpt_oauth::offered(),
        claude_plan: claude_code::offered(),
        apple,
    })
}

/// Answers with the stage the job was seeded with (`signing_in`, or `fetching` when the Claude
/// helper is absent), so the webview shows the right screen before its first poll. Async because
/// the Claude start runs `codesign` before it answers, which must not block the main thread.
#[tauri::command]
pub async fn ai_connect_start(
    app: AppHandle,
    state: State<'_, Providers>,
    provider: Provider,
) -> Result<ConnectPoll, String> {
    let dir = data_dir(&app)?;
    let chatgpt = Arc::clone(&state.chatgpt);
    let claude = Arc::clone(&state.claude);
    tauri::async_runtime::spawn_blocking(move || match provider {
        Provider::Chatgpt => {
            let opener = app.clone();
            chatgpt.start(
                dir,
                Box::new(move |url: &str| open_in_browser(&opener, url)),
            )
        }
        Provider::ClaudePlan => claude.start(claude_code::Dirs::under(&dir)),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn ai_connect_poll(state: State<'_, Providers>, provider: Provider) -> ConnectPoll {
    match provider {
        Provider::Chatgpt => state.chatgpt.job.poll(),
        Provider::ClaudePlan => state.claude.job.poll(),
    }
}

#[tauri::command]
pub fn ai_connect_cancel(state: State<'_, Providers>, provider: Provider) {
    match provider {
        Provider::Chatgpt => state.chatgpt.job.cancel(),
        Provider::ClaudePlan => state.claude.job.cancel(),
    }
}

#[tauri::command]
pub async fn ai_disconnect(
    app: AppHandle,
    state: State<'_, Providers>,
    provider: Provider,
) -> Result<(), String> {
    let dir = data_dir(&app)?;
    let chatgpt = Arc::clone(&state.chatgpt);
    let claude = Arc::clone(&state.claude);
    tauri::async_runtime::spawn_blocking(move || match provider {
        Provider::Chatgpt => chatgpt.disconnect(&chatgpt_oauth::Keychain, &dir),
        Provider::ClaudePlan => claude.disconnect(&claude_code::Dirs::under(&dir)),
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_state_names_match_the_core_list() {
        let states = [
            ProviderState::Available,
            ProviderState::NotConnected,
            ProviderState::Connecting,
            ProviderState::NeedsSignIn,
            ProviderState::LimitReached,
            ProviderState::PlanNotEligible,
            ProviderState::ProviderUnavailable,
            ProviderState::NotOffered,
        ];
        let names: Vec<String> = states
            .iter()
            .map(|s| {
                serde_json::to_string(s)
                    .unwrap()
                    .trim_matches('"')
                    .to_owned()
            })
            .collect();
        assert_eq!(
            names,
            [
                "available",
                "not_connected",
                "connecting",
                "needs_sign_in",
                "limit_reached",
                "plan_not_eligible",
                "provider_unavailable",
                "not_offered",
            ]
        );
    }

    #[test]
    fn wire_shapes_are_pinned() {
        let status = serde_json::to_value(ProviderStatus::plain(ProviderState::Available)).unwrap();
        assert_eq!(
            status,
            serde_json::json!({ "state": "available", "until": null })
        );
        let offered = serde_json::to_value(OfferedResponse {
            chatgpt: true,
            claude_plan: false,
            apple: true,
        })
        .unwrap();
        assert_eq!(
            offered,
            serde_json::json!({ "chatgpt": true, "claude_plan": false, "apple": true })
        );
        assert_eq!(
            serde_json::to_value(ConnectPoll::stage(Stage::SigningIn)).unwrap(),
            serde_json::json!({ "stage": "signing_in" })
        );
        assert_eq!(
            serde_json::to_value(ConnectPoll::failed(ConnectOutcome::FetchFailed)).unwrap(),
            serde_json::json!({ "stage": "failed", "outcome": "fetch_failed" })
        );
        assert_eq!(
            serde_json::from_str::<Provider>("\"claude_plan\"").unwrap(),
            Provider::ClaudePlan
        );
        assert!(serde_json::from_str::<Provider>("\"claude\"").is_err());
    }

    #[test]
    fn a_job_runs_once_at_a_time_and_cancel_reads_as_closed() {
        let job = ConnectJob::default();
        assert_eq!(job.poll(), ConnectPoll::IDLE);
        assert!(job.try_start());
        assert!(!job.try_start(), "busy");
        job.set(ConnectPoll::stage(Stage::SigningIn));
        assert_eq!(job.poll().stage, Stage::SigningIn);
        job.cancel();
        assert!(job.cancelled());
        assert_eq!(
            job.poll().stage,
            Stage::SigningIn,
            "the thread reports the end"
        );
        job.finish(ConnectPoll::failed(ConnectOutcome::Closed));
        assert!(!job.alive());
        assert!(job.try_start());
        job.finish(ConnectPoll::stage(Stage::Done));
        job.cancel();
        assert_eq!(
            job.poll().stage,
            Stage::Done,
            "a finished sign-in stays done"
        );
        assert!(job.try_start());
        job.finish(ConnectPoll::stage(Stage::SigningIn));
        job.cancel();
        assert_eq!(
            job.poll(),
            ConnectPoll::failed(ConnectOutcome::Closed),
            "an ended job short of done reads as closed"
        );
    }

    #[test]
    fn only_the_authorize_page_may_open() {
        assert!(browser_url_allowed(
            "https://auth.openai.com/api/accounts/authorize?client_id=x"
        ));
        assert!(!browser_url_allowed(
            "https://auth.openai.com/api/accounts/authorize"
        ));
        assert!(!browser_url_allowed(
            "https://auth.openai.com.evil.example/?x"
        ));
        assert!(!browser_url_allowed("https://example.com/?x"));
    }
}
