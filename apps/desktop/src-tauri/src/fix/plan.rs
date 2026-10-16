//! Plans built at preview, stored under a random id for five minutes, and run by id only.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use super::FixError;
use super::batch::{BatchPlan, BatchPlanWire};
use super::catalog::{Arg, FixSpec, Privilege, Step};

pub const PLAN_TTL: Duration = Duration::from_secs(5 * 60);

/// Everything Rust bound from its own listings. Lives in memory only; never returned to the webview.
#[derive(Debug, Clone, Default)]
pub struct Bound {
    pub share_name: Option<String>,
    pub key_paths: Vec<PathBuf>,
    pub ssh_dir: Option<PathBuf>,
    pub key_format_flags: &'static [&'static str],
    /// 030: the modes before the change, kept so the plan documents its own reversal.
    pub previous_modes: Vec<(PathBuf, String)>,
}

impl Bound {
    /// The argument tokens of a step, with slots filled. `key` picks the path for per-key steps.
    pub fn args(&self, step: &Step, key: Option<&PathBuf>) -> Vec<String> {
        let first_key = key.or_else(|| self.key_paths.first());
        let mut out = Vec::new();
        for arg in step.args {
            match arg {
                Arg::Lit(text) => out.push((*text).to_owned()),
                Arg::ShareName => out.push(self.share_name.clone().unwrap_or_default()),
                Arg::KeyPath => out.push(
                    first_key
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                ),
                Arg::SshDir => out.push(
                    self.ssh_dir
                        .as_ref()
                        .map(|p| p.to_string_lossy().into_owned())
                        .unwrap_or_default(),
                ),
                Arg::KeyFormatFlags => {
                    out.extend(self.key_format_flags.iter().map(|t| (*t).to_owned()))
                }
            }
        }
        out
    }

    /// Program path followed by the arguments, one entry per concrete invocation of the step.
    pub fn commands(&self, step: &Step) -> Vec<Vec<String>> {
        let with_program = |args: Vec<String>| {
            std::iter::once(step.bin.path().to_owned())
                .chain(args)
                .collect::<Vec<_>>()
        };
        if step.per_key {
            self.key_paths
                .iter()
                .map(|key| with_program(self.args(step, Some(key))))
                .collect()
        } else {
            vec![with_program(self.args(step, None))]
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PlanLine {
    pub text: String,
    pub privilege: Privilege,
}

/// The wire shape returned by `fix_preview`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixPlan {
    pub plan_id: String,
    pub rule_id: String,
    pub lines: Vec<PlanLine>,
    pub needs_password: bool,
    pub needs_passphrase: bool,
    pub recheck: Vec<&'static str>,
    pub reversible: Option<&'static str>,
    /// 013: the idle time before the fix, digits only; null when unset.
    pub previous: Option<String>,
    /// ISO 8601, five minutes after preview.
    pub expires_at: String,
}

/// A stored plan: the spec, what was bound and when it stops being valid.
#[derive(Debug, Clone)]
pub struct Plan {
    pub id: String,
    pub spec: &'static FixSpec,
    pub bound: Bound,
    pub previous: Option<String>,
    pub created: Instant,
}

impl Plan {
    pub fn new(spec: &'static FixSpec, bound: Bound, previous: Option<String>) -> Self {
        Plan {
            id: new_id(),
            spec,
            bound,
            previous,
            created: Instant::now(),
        }
    }

    pub fn expired(&self) -> bool {
        self.created.elapsed() > PLAN_TTL
    }

    pub fn lines(&self) -> Vec<PlanLine> {
        self.spec
            .steps
            .iter()
            .flat_map(|step| {
                self.bound
                    .commands(step)
                    .into_iter()
                    .map(|tokens| PlanLine {
                        text: tokens.join(" "),
                        privilege: step.privilege,
                    })
            })
            .collect()
    }

    pub fn wire(&self) -> FixPlan {
        let remaining = PLAN_TTL.saturating_sub(self.created.elapsed());
        let expires =
            chrono::Utc::now() + chrono::Duration::from_std(remaining).unwrap_or_default();
        FixPlan {
            plan_id: self.id.clone(),
            rule_id: self.spec.rule.to_owned(),
            lines: self.lines(),
            needs_password: self.spec.needs_password(),
            needs_passphrase: self.spec.needs_passphrase(),
            recheck: self.spec.recheck.iter().map(|k| k.as_str()).collect(),
            reversible: self.spec.reversible_text(),
            previous: self.previous.clone(),
            expires_at: expires.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        }
    }
}

/// 32 hex characters from the OS random source.
pub fn new_id() -> String {
    let bytes: [u8; 16] = rand::random();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Shared with the running thread: a cancel flag and the pid to kill on cancel.
#[derive(Debug, Default)]
pub struct Running {
    pub plan_id: String,
    pub cancel: AtomicBool,
    pub child_pid: Mutex<Option<u32>>,
}

impl Running {
    pub fn cancelled(&self) -> bool {
        self.cancel.load(Ordering::SeqCst)
    }

    /// Sets the flag and kills the child if one is recorded.
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::SeqCst);
        if let Some(pid) = self.child_pid.lock().ok().and_then(|p| *p) {
            // SAFETY: a plain kill(2) on a pid this process spawned and still owns.
            unsafe {
                libc::kill(pid as libc::pid_t, libc::SIGKILL);
            }
        }
    }
}

/// A single plan or a batch, in the one map. The two apply commands each reject the other kind.
pub enum Stored {
    Single(Plan),
    Batch(BatchPlan),
}

impl Stored {
    pub fn id(&self) -> &str {
        match self {
            Stored::Single(p) => &p.id,
            Stored::Batch(b) => &b.id,
        }
    }

    pub fn expired(&self) -> bool {
        match self {
            Stored::Single(p) => p.expired(),
            Stored::Batch(b) => b.expired(),
        }
    }

    /// For `fix_apply`: a batch id is `plan_expired` on the single path.
    pub fn into_single(self) -> Result<Plan, FixError> {
        match self {
            Stored::Single(p) => Ok(p),
            Stored::Batch(_) => Err(FixError::PlanExpired),
        }
    }

    /// For `fix_apply_batch`: a single id is `plan_expired` on the batch path.
    pub fn into_batch(self) -> Result<BatchPlan, FixError> {
        match self {
            Stored::Batch(b) => Ok(b),
            Stored::Single(_) => Err(FixError::PlanExpired),
        }
    }
}

/// Managed Tauri state for the fix engine.
#[derive(Default)]
pub struct PlanStore {
    plans: Mutex<HashMap<String, Stored>>,
    running: Mutex<Option<Arc<Running>>>,
}

impl PlanStore {
    pub fn insert(&self, plan: Plan) -> FixPlan {
        let wire = plan.wire();
        self.store(Stored::Single(plan));
        wire
    }

    pub fn insert_batch(&self, plan: BatchPlan) -> BatchPlanWire {
        let wire = plan.wire();
        self.store(Stored::Batch(plan));
        wire
    }

    fn store(&self, stored: Stored) {
        if let Ok(mut plans) = self.plans.lock() {
            plans.retain(|_, p| !p.expired());
            plans.insert(stored.id().to_owned(), stored);
        }
    }

    /// Marks the plan running and takes it out of the store. A run already in flight is `busy`
    /// and leaves the plan in place; unknown or expired ids are `plan_expired`. An id runs once.
    pub fn start(&self, id: &str) -> Result<(Stored, Arc<Running>), FixError> {
        let mut running = self.running.lock().map_err(|_| FixError::Busy)?;
        if running.is_some() {
            return Err(FixError::Busy);
        }
        let plan = self
            .plans
            .lock()
            .ok()
            .and_then(|mut plans| plans.remove(id))
            .ok_or(FixError::PlanExpired)?;
        if plan.expired() {
            return Err(FixError::PlanExpired);
        }
        let handle = Arc::new(Running {
            plan_id: id.to_owned(),
            ..Running::default()
        });
        *running = Some(Arc::clone(&handle));
        Ok((plan, handle))
    }

    pub fn finish(&self, id: &str) {
        if let Ok(mut running) = self.running.lock()
            && running.as_ref().is_some_and(|r| r.plan_id == id)
        {
            *running = None;
        }
    }

    pub fn cancel(&self, id: &str) {
        if let Ok(running) = self.running.lock()
            && let Some(handle) = running.as_ref()
            && handle.plan_id == id
        {
            handle.cancel();
        }
    }

    pub fn is_running(&self) -> bool {
        self.running.lock().is_ok_and(|r| r.is_some())
    }
}
