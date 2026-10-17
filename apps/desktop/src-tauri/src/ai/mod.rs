//! AI: the on-device `talos-ai` helper (Apple), the Claude plan route through Claude Code and
//! the ChatGPT route through "Sign in with ChatGPT". Streaming commands share the `ai:stream` event.

pub mod chatgpt_oauth;
pub mod chatgpt_watch;
pub mod claude_code;
pub mod claude_stream;
pub mod engine;
pub mod partial_json;
pub mod protocol;
pub mod provider;
pub mod schemas;
pub mod sidecar;

#[cfg(test)]
mod engine_tests;
#[cfg(test)]
mod protocol_tests;

use engine::Engine;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

pub use engine::{Availability, GenerateRequest, StreamPayload, Timeouts};
pub use protocol::Task;

pub const STREAM_EVENT: &str = "ai:stream";

/// The tasks a webview may name. The watch task is built by Rust's own loop and never from the
/// webview (SECURITY-MODEL, "Your AI"); a request naming it is refused before any engine sees it.
pub fn webview_task(task: Task) -> Result<(), String> {
    if task == Task::Watch {
        return Err("invalid_input".to_string());
    }
    Ok(())
}

/// Managed Tauri state; the engine is shared with the blocking worker threads.
pub struct AiState {
    engine: Arc<Engine>,
}

impl Default for AiState {
    fn default() -> Self {
        let engine = Arc::new(Engine::new(Timeouts::default()));
        let sweeper = Arc::clone(&engine);
        // Kills the helper after 300 s without a request.
        let _ = std::thread::Builder::new()
            .name("talos-ai-idle".into())
            .spawn(move || {
                loop {
                    std::thread::sleep(Duration::from_secs(15));
                    sweeper.idle_sweep();
                }
            });
        AiState { engine }
    }
}

impl AiState {
    pub fn engine(&self) -> Arc<Engine> {
        Arc::clone(&self.engine)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamKind {
    Partial,
    Done,
    Error,
}

#[tauri::command]
pub async fn ai_availability(
    window: tauri::Window,
    state: State<'_, AiState>,
    fresh: bool,
) -> Result<Availability, String> {
    crate::commands::guard::check(&window, crate::commands::guard::Callers::MainOnly)?;
    let engine = state.engine();
    tauri::async_runtime::spawn_blocking(move || engine.availability(fresh))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_generate(
    window: tauri::Window,
    app: AppHandle,
    state: State<'_, AiState>,
    request: GenerateRequest,
) -> Result<(), String> {
    crate::commands::guard::check(&window, crate::commands::guard::Callers::MainOnly)?;
    webview_task(request.task)?;
    let engine = state.engine();
    let emit = move |payload: StreamPayload| {
        let _ = app.emit(STREAM_EVENT, payload);
    };
    tauri::async_runtime::spawn_blocking(move || engine.generate(request, &emit))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn ai_cancel(
    window: tauri::Window,
    state: State<'_, AiState>,
    id: String,
) -> Result<(), String> {
    crate::commands::guard::check(&window, crate::commands::guard::Callers::MainOnly)?;
    state.engine.cancel(&id);
    Ok(())
}

/// The Claude plan route; same `ai:stream` payloads as `ai_generate`.
#[tauri::command]
pub async fn claude_generate(
    window: tauri::Window,
    app: AppHandle,
    state: State<'_, provider::Providers>,
    request: GenerateRequest,
) -> Result<(), String> {
    crate::commands::guard::check(&window, crate::commands::guard::Callers::MainOnly)?;
    webview_task(request.task)?;
    let dir = crate::commands::app_data_dir(&app)?;
    let claude = Arc::clone(&state.claude);
    let emit = move |payload: StreamPayload| {
        let _ = app.emit(STREAM_EVENT, payload);
    };
    tauri::async_runtime::spawn_blocking(move || {
        claude.generate(&claude_code::Dirs::under(&dir), request, &emit)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn claude_cancel(
    window: tauri::Window,
    state: State<'_, provider::Providers>,
    id: String,
) -> Result<(), String> {
    crate::commands::guard::check(&window, crate::commands::guard::Callers::MainOnly)?;
    state.claude.cancel(&id);
    Ok(())
}

#[tauri::command]
pub async fn claude_code_info(
    window: tauri::Window,
    app: AppHandle,
    state: State<'_, provider::Providers>,
) -> Result<claude_code::ClaudeCodeInfo, String> {
    crate::commands::guard::check(&window, crate::commands::guard::Callers::MainOnly)?;
    let dir = crate::commands::app_data_dir(&app)?;
    let claude = Arc::clone(&state.claude);
    tauri::async_runtime::spawn_blocking(move || claude.info(&claude_code::Dirs::under(&dir)))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_webview_may_name_every_task_but_watch() {
        assert_eq!(webview_task(Task::Explain), Ok(()));
        assert_eq!(webview_task(Task::Prioritise), Ok(()));
        assert_eq!(webview_task(Task::Ask), Ok(()));
        assert_eq!(webview_task(Task::Watch), Err("invalid_input".to_string()));
        let request: GenerateRequest =
            serde_json::from_str(r#"{"id":"abc","task":"watch","instructions":"","prompt":""}"#)
                .unwrap();
        assert_eq!(
            request.task,
            Task::Watch,
            "the wire form deserialises; the command refuses it"
        );
    }
}
