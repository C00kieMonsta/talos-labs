//! AI: the on-device `talos-ai` helper (Apple), the Claude plan route through Claude Code and
//! the ChatGPT route through "Sign in with ChatGPT". Streaming commands share the `ai:stream` event.

pub mod chatgpt_oauth;
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
    state: State<'_, AiState>,
    fresh: bool,
) -> Result<Availability, String> {
    let engine = state.engine();
    tauri::async_runtime::spawn_blocking(move || engine.availability(fresh))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn ai_generate(
    app: AppHandle,
    state: State<'_, AiState>,
    request: GenerateRequest,
) -> Result<(), String> {
    let engine = state.engine();
    let emit = move |payload: StreamPayload| {
        let _ = app.emit(STREAM_EVENT, payload);
    };
    tauri::async_runtime::spawn_blocking(move || engine.generate(request, &emit))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn ai_cancel(state: State<'_, AiState>, id: String) {
    state.engine.cancel(&id);
}

/// The Claude plan route; same `ai:stream` payloads as `ai_generate`.
#[tauri::command]
pub async fn claude_generate(
    app: AppHandle,
    state: State<'_, provider::Providers>,
    request: GenerateRequest,
) -> Result<(), String> {
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
pub fn claude_cancel(state: State<'_, provider::Providers>, id: String) {
    state.claude.cancel(&id);
}

#[tauri::command]
pub async fn claude_code_info(
    app: AppHandle,
    state: State<'_, provider::Providers>,
) -> Result<claude_code::ClaudeCodeInfo, String> {
    let dir = crate::commands::app_data_dir(&app)?;
    let claude = Arc::clone(&state.claude);
    tauri::async_runtime::spawn_blocking(move || claude.info(&claude_code::Dirs::under(&dir)))
        .await
        .map_err(|e| e.to_string())
}
