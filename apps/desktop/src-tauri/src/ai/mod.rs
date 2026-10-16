//! On-device AI: the `talos-ai` helper, its availability cache and the streaming commands.

pub mod engine;
pub mod protocol;
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
