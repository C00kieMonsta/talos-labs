use super::StreamKind;
use super::engine::*;
use super::protocol::Task;
use super::sidecar::HELPER_ENV;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

/// Builds the fake helper once and returns its path.
fn fake_bin() -> PathBuf {
    static PATH: OnceLock<PathBuf> = OnceLock::new();
    PATH.get_or_init(|| {
        if let Some(path) = std::env::var_os("TALOS_AI_FAKE_BIN") {
            return PathBuf::from(path);
        }
        let exe = std::env::current_exe().unwrap();
        let profile_dir = exe.parent().unwrap().parent().unwrap().to_path_buf();
        let status = std::process::Command::new(env!("CARGO"))
            .args(["build", "--bin", "talos-ai-fake", "--target-dir"])
            .arg(profile_dir.parent().unwrap())
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .status()
            .unwrap();
        assert!(status.success(), "building talos-ai-fake");
        let path = profile_dir.join("talos-ai-fake");
        assert!(path.exists(), "{}", path.display());
        path
    })
    .clone()
}

/// Serialises tests that set process-wide env vars.
fn env_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|p| p.into_inner())
}

struct Fake {
    _guard: std::sync::MutexGuard<'static, ()>,
}

fn fake(script: &str) -> Fake {
    let guard = env_lock();
    // Env is read at spawn time only, under this lock.
    unsafe {
        std::env::set_var(HELPER_ENV, fake_bin());
        std::env::set_var("TALOS_AI_FAKE", script);
    }
    Fake { _guard: guard }
}

fn quick() -> Timeouts {
    Timeouts {
        availability: Duration::from_millis(500),
        first_partial: Duration::from_millis(500),
        whole: Duration::from_secs(3),
        cancel_ack: Duration::from_millis(300),
        idle: Duration::from_millis(200),
    }
}

fn request(id: &str, task: Task) -> GenerateRequest {
    GenerateRequest {
        id: id.into(),
        task,
        instructions: "i".into(),
        prompt: "p".into(),
    }
}

fn collect(engine: &Engine, req: GenerateRequest) -> (Result<(), String>, Vec<StreamPayload>) {
    let events = Mutex::new(Vec::new());
    let result = engine.generate(req, &|p| events.lock().unwrap().push(p));
    (result, events.into_inner().unwrap())
}

#[test]
fn validation_rejects_bad_ids_and_long_text() {
    for id in ["", "A1", "abc-1", "x".repeat(17).as_str(), "é"] {
        assert_eq!(
            validate(&request(id, Task::Ask)),
            Err("invalid_id".into()),
            "{id:?}"
        );
    }
    assert!(valid_id("a1") && valid_id(&"z".repeat(16)));
    let mut req = request("ok1", Task::Explain);
    req.instructions = "x".repeat(MAX_INSTRUCTIONS_CHARS + 1);
    assert_eq!(validate(&req), Err("instructions_too_long".into()));
    req.instructions.clear();
    req.prompt = "y".repeat(MAX_PROMPT_CHARS + 1);
    assert_eq!(validate(&req), Err("prompt_too_long".into()));
    req.prompt.clear();
    assert_eq!(validate(&req), Ok(()));
}

#[test]
fn chat_never_reaches_the_helper() {
    let _f = fake("availability:available");
    let engine = Engine::new(quick());
    let (result, events) = collect(&engine, request("c9", Task::Chat));
    assert_eq!(result, Err("invalid_input".into()));
    assert!(events.is_empty());
    assert!(!engine.is_busy());
    // The slot is free and no helper was spawned for it: the next request runs as usual.
    assert_eq!(engine.availability(false), Availability::Available);
}

#[test]
fn availability_is_cached_until_it_expires() {
    let _f = fake("availability:model_not_ready");
    let engine = Engine::new(quick());
    assert_eq!(engine.cached(), None);
    assert_eq!(engine.availability(false), Availability::ModelNotReady);
    assert_eq!(engine.cached(), Some(Availability::ModelNotReady));
    assert_eq!(Availability::DeviceNotEligible.ttl(), None);
    assert_eq!(
        Availability::Available.ttl(),
        Some(Duration::from_secs(600))
    );
    assert_eq!(
        Availability::AppleIntelligenceNotEnabled.ttl(),
        Some(Duration::from_secs(30))
    );
    assert_eq!(
        Availability::HelperUnavailable.ttl(),
        Some(Duration::from_secs(10))
    );
    assert_eq!(engine.availability(true), Availability::ModelNotReady);
    let pid = engine.helper_pid();
    assert!(pid.is_some(), "the helper stays alive between probes");
    assert_eq!(
        serde_json::to_string(&Availability::AppleIntelligenceNotEnabled).unwrap(),
        "\"apple_intelligence_not_enabled\""
    );
}

#[test]
fn a_missing_helper_is_helper_unavailable_and_expires_after_ten_seconds() {
    let _g = env_lock();
    unsafe { std::env::set_var(HELPER_ENV, "/nonexistent/talos-ai") };
    let engine = Engine::new(quick());
    assert_eq!(engine.availability(false), Availability::HelperUnavailable);
    assert_eq!(engine.cached(), Some(Availability::HelperUnavailable));
    let (result, events) = collect(&engine, request("g1", Task::Explain));
    assert_eq!(result, Ok(()));
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].kind, StreamKind::Error);
    assert_eq!(events[0].code.as_deref(), Some("internal"));
}

#[test]
fn a_silent_helper_times_out_the_probe() {
    let _f = fake("hang_availability");
    let engine = Engine::new(quick());
    let started = Instant::now();
    assert_eq!(engine.availability(true), Availability::HelperUnavailable);
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(engine.helper_pid(), None, "the wedged helper is killed");
}

#[test]
fn generate_streams_partials_then_done() {
    let _f = fake("ok");
    let engine = Engine::new(quick());
    let (result, events) = collect(&engine, request("g7", Task::Explain));
    assert_eq!(result, Ok(()));
    let kinds: Vec<StreamKind> = events.iter().map(|e| e.kind).collect();
    assert_eq!(
        kinds,
        [StreamKind::Partial, StreamKind::Partial, StreamKind::Done]
    );
    assert!(events.iter().all(|e| e.id == "g7"));
    assert_eq!(
        events[1].json.as_ref().unwrap()["whyItMattersForYou"],
        "Your disk"
    );
    assert_eq!(events[2].json.as_ref().unwrap()["urgency"], "today");
    let json = serde_json::to_value(&events[2]).unwrap();
    assert_eq!(json["kind"], "done");
    assert!(json.get("code").is_none());
    assert_eq!(serde_json::to_value(&events[0]).unwrap()["kind"], "partial");
    let (_, again) = collect(&engine, request("g8", Task::Prioritise));
    assert_eq!(
        again.last().unwrap().kind,
        StreamKind::Done,
        "the helper is reused"
    );
}

#[test]
fn a_helper_error_is_forwarded_with_its_code() {
    let _f = fake("error:guardrail");
    let engine = Engine::new(quick());
    let (_, events) = collect(&engine, request("g1", Task::Ask));
    assert_eq!(
        events,
        [StreamPayload {
            id: "g1".into(),
            kind: StreamKind::Error,
            json: None,
            code: Some("guardrail".into()),
            until: None,
        }]
    );
    let json = serde_json::to_value(&events[0]).unwrap();
    assert_eq!(
        json,
        serde_json::json!({ "id": "g1", "kind": "error", "code": "guardrail" })
    );
}

#[test]
fn a_crash_mid_stream_is_internal_and_marks_the_helper_unavailable() {
    let _f = fake("crash");
    let engine = Engine::new(quick());
    assert_eq!(engine.availability(false), Availability::Available);
    let (_, events) = collect(&engine, request("g2", Task::Explain));
    let kinds: Vec<StreamKind> = events.iter().map(|e| e.kind).collect();
    assert_eq!(kinds, [StreamKind::Partial, StreamKind::Error]);
    assert_eq!(events[1].code.as_deref(), Some("internal"));
    assert_eq!(engine.cached(), Some(Availability::HelperUnavailable));
    assert_eq!(engine.helper_pid(), None);
    assert_eq!(
        engine.availability(true),
        Availability::Available,
        "respawned on the next call"
    );
}

#[test]
fn a_hung_helper_hits_the_first_partial_timeout() {
    let _f = fake("hang");
    let engine = Engine::new(quick());
    let started = Instant::now();
    let (_, events) = collect(&engine, request("g3", Task::Explain));
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(events.last().unwrap().code.as_deref(), Some("internal"));
    assert_eq!(engine.helper_pid(), None);
}

fn cancel_scenario(script: &str) -> (Vec<StreamPayload>, Option<u32>, Duration) {
    let _f = fake(script);
    let engine = Arc::new(Engine::new(quick()));
    let events = Arc::new(Mutex::new(Vec::new()));
    let (worker, sink) = (Arc::clone(&engine), Arc::clone(&events));
    let handle = std::thread::spawn(move || {
        worker.generate(request("c1", Task::Ask), &|p| sink.lock().unwrap().push(p))
    });
    let deadline = Instant::now() + Duration::from_secs(5);
    while events.lock().unwrap().is_empty() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert_eq!(
        engine.generate(request("c2", Task::Ask), &|_| {}),
        Err("busy".into())
    );
    engine.cancel("zzz");
    let asked = Instant::now();
    engine.cancel("c1");
    handle.join().unwrap().unwrap();
    let took = asked.elapsed();
    let out = events.lock().unwrap().clone();
    (out, engine.helper_pid(), took)
}

#[test]
fn cancel_is_acknowledged_by_the_helper() {
    let (events, pid, took) = cancel_scenario("wait_cancel");
    let kinds: Vec<StreamKind> = events.iter().map(|e| e.kind).collect();
    assert_eq!(kinds, [StreamKind::Partial, StreamKind::Error]);
    assert_eq!(events[1].code.as_deref(), Some("cancelled"));
    assert!(pid.is_some(), "an acknowledged cancel keeps the helper");
    assert!(took < Duration::from_millis(250), "{took:?}");
}

#[test]
fn an_unacknowledged_cancel_kills_the_helper() {
    let (events, pid, took) = cancel_scenario("ignore_cancel");
    assert_eq!(events.last().unwrap().code.as_deref(), Some("cancelled"));
    assert_eq!(pid, None);
    assert!(
        took >= Duration::from_millis(300) && took < Duration::from_secs(2),
        "{took:?}"
    );
}

#[test]
fn idle_sweep_kills_the_helper_after_the_idle_limit() {
    let _f = fake("ok");
    let engine = Engine::new(quick());
    assert_eq!(engine.availability(true), Availability::Available);
    assert!(!engine.idle_sweep(), "fresh helper is kept");
    std::thread::sleep(Duration::from_millis(250));
    assert!(engine.idle_sweep());
    assert_eq!(engine.helper_pid(), None);
    assert!(!engine.idle_sweep(), "nothing left to sweep");
    assert_eq!(engine.availability(true), Availability::Available);
    assert!(engine.helper_pid().is_some(), "respawned on demand");
}

#[test]
#[ignore = "spawns the real talos-ai helper"]
fn real_helper_reports_availability() {
    let _g = env_lock();
    unsafe { std::env::remove_var(HELPER_ENV) };
    let engine = Engine::new(Timeouts::default());
    let state = engine.availability(true);
    println!(
        "talos-ai at {} reports {state:?}",
        super::sidecar::helper_path().display()
    );
    assert_ne!(state, Availability::HelperUnavailable);
}
