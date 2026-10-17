//! Request validation, the availability cache and the one-at-a-time generate loop.

use super::protocol::{Event, HelperAvailability, Request, Task};
use super::sidecar::{RecvError, Sidecar, Writer, helper_path};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

pub const MAX_INSTRUCTIONS_CHARS: usize = 3000;
pub const MAX_PROMPT_CHARS: usize = 8000;
pub const MAX_TOKENS: u32 = 600;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Availability {
    Available,
    DeviceNotEligible,
    AppleIntelligenceNotEnabled,
    ModelNotReady,
    HelperUnavailable,
}

impl Availability {
    /// How long a probe result stays valid; `None` means for the whole session.
    pub fn ttl(self) -> Option<Duration> {
        match self {
            Availability::DeviceNotEligible => None,
            Availability::Available => Some(Duration::from_secs(600)),
            Availability::ModelNotReady | Availability::AppleIntelligenceNotEnabled => {
                Some(Duration::from_secs(30))
            }
            Availability::HelperUnavailable => Some(Duration::from_secs(10)),
        }
    }
}

impl From<HelperAvailability> for Availability {
    fn from(state: HelperAvailability) -> Self {
        match state {
            HelperAvailability::Available => Availability::Available,
            HelperAvailability::DeviceNotEligible => Availability::DeviceNotEligible,
            HelperAvailability::AppleIntelligenceNotEnabled => {
                Availability::AppleIntelligenceNotEnabled
            }
            HelperAvailability::ModelNotReady => Availability::ModelNotReady,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct GenerateRequest {
    pub id: String,
    pub task: Task,
    pub instructions: String,
    pub prompt: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamPayload {
    pub id: String,
    pub kind: super::StreamKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub json: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    /// ISO time when a `limit_reached` error knows when the allowance returns.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub until: Option<String>,
}

impl StreamPayload {
    pub(crate) fn partial(id: &str, json: serde_json::Value) -> Self {
        StreamPayload {
            id: id.to_owned(),
            kind: super::StreamKind::Partial,
            json: Some(json),
            code: None,
            until: None,
        }
    }
    pub(crate) fn done(id: &str, json: serde_json::Value) -> Self {
        StreamPayload {
            id: id.to_owned(),
            kind: super::StreamKind::Done,
            json: Some(json),
            code: None,
            until: None,
        }
    }
    pub(crate) fn error(id: &str, code: &str) -> Self {
        StreamPayload {
            id: id.to_owned(),
            kind: super::StreamKind::Error,
            json: None,
            code: Some(code.to_owned()),
            until: None,
        }
    }
    pub(crate) fn error_until(id: &str, code: &str, until: Option<String>) -> Self {
        StreamPayload {
            until,
            ..Self::error(id, code)
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct Timeouts {
    pub availability: Duration,
    pub first_partial: Duration,
    pub whole: Duration,
    pub cancel_ack: Duration,
    pub idle: Duration,
}

impl Default for Timeouts {
    fn default() -> Self {
        Timeouts {
            availability: Duration::from_secs(5),
            first_partial: Duration::from_secs(25),
            whole: Duration::from_secs(90),
            cancel_ack: Duration::from_secs(2),
            idle: Duration::from_secs(300),
        }
    }
}

/// The request being streamed, kept outside the sidecar lock so `cancel` can reach stdin.
struct InFlight {
    id: String,
    task: Task,
    writer: Writer,
    cancel_sent: Option<Instant>,
}

/// How long the person's request waits for a cancelled watch call to let go of the helper.
const YIELD_WAIT: Duration = Duration::from_secs(5);

pub struct Engine {
    timeouts: Timeouts,
    sidecar: Mutex<Option<Sidecar>>,
    cached: Mutex<Option<(Availability, Instant)>>,
    busy: AtomicBool,
    inflight: Mutex<Option<InFlight>>,
}

/// Checks `^[a-z0-9]{1,16}$`.
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 16
        && id
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

pub fn validate(request: &GenerateRequest) -> Result<(), String> {
    if !valid_id(&request.id) {
        return Err("invalid_id".into());
    }
    if request.instructions.chars().count() > MAX_INSTRUCTIONS_CHARS {
        return Err("instructions_too_long".into());
    }
    if request.prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err("prompt_too_long".into());
    }
    Ok(())
}

fn kill_helper(guard: &mut Option<Sidecar>) {
    if let Some(sidecar) = guard.take() {
        sidecar.kill();
    }
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

impl Engine {
    pub fn new(timeouts: Timeouts) -> Self {
        Engine {
            timeouts,
            sidecar: Mutex::new(None),
            cached: Mutex::new(None),
            busy: AtomicBool::new(false),
            inflight: Mutex::new(None),
        }
    }

    pub fn cached(&self) -> Option<Availability> {
        let cached = lock(&self.cached);
        let (state, at) = (*cached)?;
        match state.ttl() {
            None => Some(state),
            Some(ttl) if at.elapsed() < ttl => Some(state),
            Some(_) => None,
        }
    }

    fn remember(&self, state: Availability) -> Availability {
        *lock(&self.cached) = Some((state, Instant::now()));
        state
    }

    pub fn availability(&self, fresh: bool) -> Availability {
        if let Some(state) = self.cached().filter(|_| !fresh) {
            return state;
        }
        if self.busy.load(Ordering::SeqCst) {
            // A generation is running, so the model is evidently usable.
            return (*lock(&self.cached))
                .map(|(state, _)| state)
                .unwrap_or(Availability::Available);
        }
        let mut guard = lock(&self.sidecar);
        let state = self.probe(&mut guard);
        self.remember(state)
    }

    fn probe(&self, guard: &mut Option<Sidecar>) -> Availability {
        let Some(sidecar) = Self::ensure(guard) else {
            return Availability::HelperUnavailable;
        };
        let id = "avail".to_owned();
        if sidecar
            .send(&Request::Availability { id: id.clone() })
            .is_err()
        {
            kill_helper(guard);
            return Availability::HelperUnavailable;
        }
        let deadline = Instant::now() + self.timeouts.availability;
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            match sidecar.recv(left) {
                Ok(Event::Availability { id: got, state }) if got == id => return state.into(),
                Ok(_) => continue,
                Err(_) => {
                    kill_helper(guard);
                    return Availability::HelperUnavailable;
                }
            }
        }
    }

    fn ensure(guard: &mut Option<Sidecar>) -> Option<&mut Sidecar> {
        if guard.as_mut().is_some_and(|s| !s.is_alive()) {
            kill_helper(guard);
        }
        if guard.is_none() {
            match Sidecar::spawn(&helper_path()) {
                Ok(sidecar) => *guard = Some(sidecar),
                Err(err) => {
                    eprintln!("talos-ai: cannot spawn {}: {err}", helper_path().display());
                    return None;
                }
            }
        }
        guard.as_mut()
    }

    /// True while a request streams.
    pub fn is_busy(&self) -> bool {
        self.busy.load(Ordering::SeqCst)
    }

    /// Takes the busy slot. The person's request wins over the watch's: an in-flight watch call
    /// is cancelled and the slot waited for, briefly; anything else answers `busy`.
    fn take_slot(&self, task: Task) -> Result<(), String> {
        if !self.busy.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        if task == Task::Watch || !self.yield_watch() {
            return Err("busy".into());
        }
        Ok(())
    }

    /// Cancels an in-flight watch call and waits for the slot; false when nothing yielded.
    fn yield_watch(&self) -> bool {
        let watch_id = lock(&self.inflight)
            .as_ref()
            .filter(|f| f.task == Task::Watch)
            .map(|f| f.id.clone());
        let Some(id) = watch_id else {
            return false;
        };
        self.cancel(&id);
        let deadline = Instant::now() + YIELD_WAIT;
        while Instant::now() < deadline {
            if !self.busy.swap(true, Ordering::SeqCst) {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        false
    }

    /// Streams one request; events go to `emit`. Returns once the stream has ended.
    pub fn generate(
        &self,
        request: GenerateRequest,
        emit: &dyn Fn(StreamPayload),
    ) -> Result<(), String> {
        validate(&request)?;
        self.take_slot(request.task)?;
        let result = self.run(&request, emit);
        *lock(&self.inflight) = None;
        self.busy.store(false, Ordering::SeqCst);
        result
    }

    fn run(&self, request: &GenerateRequest, emit: &dyn Fn(StreamPayload)) -> Result<(), String> {
        let id = request.id.as_str();
        let mut guard = lock(&self.sidecar);
        let Some(sidecar) = Self::ensure(&mut guard) else {
            self.remember(Availability::HelperUnavailable);
            emit(StreamPayload::error(id, "internal"));
            return Ok(());
        };
        *lock(&self.inflight) = Some(InFlight {
            id: id.to_owned(),
            task: request.task,
            writer: sidecar.writer(),
            cancel_sent: None,
        });
        let line = Request::Generate {
            id: id.to_owned(),
            task: request.task,
            instructions: request.instructions.clone(),
            prompt: request.prompt.clone(),
            max_tokens: MAX_TOKENS,
        };
        if sidecar.send(&line).is_err() {
            kill_helper(&mut guard);
            self.remember(Availability::HelperUnavailable);
            emit(StreamPayload::error(id, "internal"));
            return Ok(());
        }
        let started = Instant::now();
        let mut first_deadline = (!matches!(request.task, Task::Prioritise | Task::Watch))
            .then(|| started + self.timeouts.first_partial);
        let whole_deadline = started + self.timeouts.whole;
        loop {
            if self
                .cancel_sent_at(id)
                .is_some_and(|sent| sent.elapsed() >= self.timeouts.cancel_ack)
            {
                kill_helper(&mut guard);
                emit(StreamPayload::error(id, "cancelled"));
                return Ok(());
            }
            let now = Instant::now();
            if now >= whole_deadline || first_deadline.is_some_and(|d| now >= d) {
                kill_helper(&mut guard);
                emit(StreamPayload::error(id, "internal"));
                return Ok(());
            }
            match sidecar.recv(Duration::from_millis(50)) {
                Err(RecvError::Timeout) => continue,
                Err(RecvError::Closed) => {
                    kill_helper(&mut guard);
                    self.remember(Availability::HelperUnavailable);
                    emit(StreamPayload::error(id, "internal"));
                    return Ok(());
                }
                Ok(event) if event.id() != id => continue,
                Ok(Event::Availability { .. }) => continue,
                Ok(Event::Partial { json, .. }) => {
                    first_deadline = None;
                    emit(StreamPayload::partial(id, json));
                }
                Ok(Event::Done { json, .. }) => {
                    emit(StreamPayload::done(id, json));
                    return Ok(());
                }
                Ok(Event::Error { code, .. }) => {
                    emit(StreamPayload::error(id, &code));
                    return Ok(());
                }
            }
        }
    }

    fn cancel_sent_at(&self, id: &str) -> Option<Instant> {
        lock(&self.inflight)
            .as_ref()
            .filter(|f| f.id == id)
            .and_then(|f| f.cancel_sent)
    }

    /// Asks the helper to stop `id`; a no-op when nothing by that id is running.
    pub fn cancel(&self, id: &str) {
        let mut inflight = lock(&self.inflight);
        let Some(current) = inflight
            .as_mut()
            .filter(|f| f.id == id && f.cancel_sent.is_none())
        else {
            return;
        };
        current.cancel_sent = Some(Instant::now());
        let _ = current.writer.send(&Request::Cancel { id: id.to_owned() });
    }

    /// Kills the helper once it has sat idle past the limit. Skipped while a request holds it.
    pub fn idle_sweep(&self) -> bool {
        let Ok(mut guard) = self.sidecar.try_lock() else {
            return false;
        };
        if guard
            .as_ref()
            .is_some_and(|s| s.idle_for() >= self.timeouts.idle)
        {
            if let Some(sidecar) = guard.take() {
                sidecar.shutdown(Duration::from_millis(500));
            }
            return true;
        }
        false
    }

    pub fn helper_pid(&self) -> Option<u32> {
        lock(&self.sidecar).as_ref().map(Sidecar::pid)
    }
}
