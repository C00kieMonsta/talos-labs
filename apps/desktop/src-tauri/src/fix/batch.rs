//! Fix-all batches: one password dialog for every admin item, then the user-level items one by one.

use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::Serialize;

use super::catalog::{FIX_CATALOG, batchable, spec_for};
use super::plan::{PLAN_TTL, Plan, PlanLine, Running};
use super::privileged::{self, MARKER_BASE};
use super::run::{self, FixPhase, FixStatus};
use super::{FixChoice, FixError};
use crate::state::SectionKey;

pub struct BatchPlan {
    pub id: String,
    /// In run order: admin items in catalog order, then user-level items in catalog order.
    pub items: Vec<Plan>,
    /// Items the preview refused one by one, kept for the wire shape.
    pub excluded: Vec<BatchExcluded>,
    pub created: Instant,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchItemWire {
    pub rule_id: String,
    pub lines: Vec<PlanLine>,
    pub recheck: Vec<&'static str>,
    pub previous: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchExcluded {
    pub rule_id: String,
    pub error: FixError,
}

/// The wire shape returned by `fix_preview_batch`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchPlanWire {
    pub plan_id: String,
    pub items: Vec<BatchItemWire>,
    /// Items the preview refused one by one (precondition_changed), so the UI can route them elsewhere.
    pub excluded: Vec<BatchExcluded>,
    pub needs_password: bool,
    /// Union of every item's recheck, in SectionKey::ALL order.
    pub recheck: Vec<&'static str>,
    pub expires_at: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemStatus {
    Done,
    Failed,
    NotRun,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchItemOutcome {
    pub rule_id: String,
    pub status: ItemStatus,
    /// Failed only.
    pub error: Option<FixError>,
    /// Failed only: 0-based step within the item, when a marker named it.
    pub step: Option<usize>,
}

impl BatchItemOutcome {
    fn done(rule: &str) -> Self {
        BatchItemOutcome {
            rule_id: rule.to_owned(),
            status: ItemStatus::Done,
            error: None,
            step: None,
        }
    }

    fn failed(rule: &str, error: FixError, step: Option<usize>) -> Self {
        BatchItemOutcome {
            rule_id: rule.to_owned(),
            status: ItemStatus::Failed,
            error: Some(error),
            step,
        }
    }

    fn not_run(rule: &str) -> Self {
        BatchItemOutcome {
            rule_id: rule.to_owned(),
            status: ItemStatus::NotRun,
            error: None,
            step: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchOutcome {
    /// Every item Done.
    pub ok: bool,
    pub items: Vec<BatchItemOutcome>,
    /// The dialog itself failed (cancelled, wrong_password, timeout): nothing ran, every item is NotRun.
    pub error: Option<FixError>,
}

impl BatchOutcome {
    fn from_items(items: Vec<BatchItemOutcome>, error: Option<FixError>) -> Self {
        let ok = error.is_none() && items.iter().all(|i| i.status == ItemStatus::Done);
        BatchOutcome { ok, items, error }
    }
}

impl BatchPlan {
    pub fn expired(&self) -> bool {
        self.created.elapsed() > PLAN_TTL
    }

    pub fn needs_password(&self) -> bool {
        self.items.iter().any(|p| p.spec.needs_password())
    }

    /// Union of every item's recheck, in `SectionKey::ALL` order.
    pub fn recheck(&self) -> Vec<&'static str> {
        SectionKey::ALL
            .iter()
            .filter(|key| self.items.iter().any(|p| p.spec.recheck.contains(key)))
            .map(|key| key.as_str())
            .collect()
    }

    pub fn wire(&self) -> BatchPlanWire {
        let remaining = PLAN_TTL.saturating_sub(self.created.elapsed());
        let expires =
            chrono::Utc::now() + chrono::Duration::from_std(remaining).unwrap_or_default();
        BatchPlanWire {
            plan_id: self.id.clone(),
            items: self
                .items
                .iter()
                .map(|p| BatchItemWire {
                    rule_id: p.spec.rule.to_owned(),
                    lines: p.lines(),
                    recheck: p.spec.recheck.iter().map(|k| k.as_str()).collect(),
                    previous: p.previous.clone(),
                })
                .collect(),
            excluded: self.excluded.clone(),
            needs_password: self.needs_password(),
            recheck: self.recheck(),
            expires_at: expires.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        }
    }
}

fn catalog_index(rule: &str) -> usize {
    FIX_CATALOG
        .iter()
        .position(|s| s.rule == rule)
        .unwrap_or(usize::MAX)
}

/// Builds every item through `run::preview(rule, &FixChoice::None)`, then applies the batch rules.
pub fn preview_batch(rules: &[String]) -> Result<BatchPlan, FixError> {
    let mut seen: Vec<&str> = Vec::new();
    for rule in rules {
        let spec = spec_for(rule).ok_or(FixError::NotInCatalog)?;
        if !batchable(spec) || seen.contains(&spec.rule) {
            return Err(FixError::InvalidChoice);
        }
        seen.push(spec.rule);
    }
    let mut items = Vec::new();
    let mut excluded = Vec::new();
    for rule in rules {
        match run::preview(rule, &FixChoice::None) {
            Ok(plan) => items.push(plan),
            Err(FixError::PreconditionChanged) => excluded.push(BatchExcluded {
                rule_id: rule.clone(),
                error: FixError::PreconditionChanged,
            }),
            Err(err) => return Err(err),
        }
    }
    if items.is_empty() {
        return Err(FixError::InvalidChoice);
    }
    items.sort_by_key(|p| (!p.spec.needs_password(), catalog_index(p.spec.rule)));
    Ok(BatchPlan {
        id: super::plan::new_id(),
        items,
        excluded,
        created: Instant::now(),
    })
}

/// One subshell per item; every command silenced; one report line per item.
pub fn item_block(index: usize, lines: &[String]) -> String {
    let silenced = lines
        .iter()
        .map(|l| format!("{{ {l}; }} >/dev/null 2>&1"))
        .collect::<Vec<_>>()
        .join("; ");
    format!("( {silenced} ); echo R {index} $?")
}

/// Ordered item blocks, then `exit 0` so the script's own status is always success and stdout comes back.
pub fn batch_script(blocks: &[String]) -> Vec<String> {
    blocks
        .iter()
        .cloned()
        .chain(std::iter::once("exit 0".to_owned()))
        .collect()
}

/// "R <item> <code>" lines, split on CR, LF or CRLF; anything else is ignored. None when an item has no line.
pub fn parse_markers(stdout: &str, items: usize) -> Vec<Option<i32>> {
    let mut codes = vec![None; items];
    for line in stdout.split(['\r', '\n']) {
        let mut parts = line.trim().split(' ');
        let (Some("R"), Some(index), Some(code), None) =
            (parts.next(), parts.next(), parts.next(), parts.next())
        else {
            continue;
        };
        let (Ok(index), Ok(code)) = (index.parse::<usize>(), code.parse::<i32>()) else {
            continue;
        };
        if let Some(slot) = codes.get_mut(index) {
            *slot = Some(code);
        }
    }
    codes
}

/// ADMIN_TIMEOUT plus 15 s per admin item: 17 items give 375 s.
pub fn batch_timeout(admin_items: usize) -> Duration {
    privileged::batch_timeout(admin_items)
}

/// "Talos Labs wants to fix 3 things on this Mac."
pub fn prompt_for_batch(count: usize) -> String {
    let noun = if count == 1 { "thing" } else { "things" };
    format!("Talos Labs wants to fix {count} {noun} on this Mac.")
}

/// (step index, tokens, tolerated exit) per concrete command, as `run::apply` builds them.
fn item_steps(plan: &Plan) -> Vec<(usize, Vec<String>, Option<i32>)> {
    plan.spec
        .steps
        .iter()
        .enumerate()
        .flat_map(|(i, step)| {
            plan.bound
                .commands(step)
                .into_iter()
                .map(move |tokens| (i, tokens, step.tolerate_exit))
        })
        .collect()
}

pub(super) fn item_lines(plan: &Plan) -> Vec<String> {
    item_steps(plan)
        .iter()
        .map(|(i, tokens, tolerate)| privileged::shell_line(*i, tokens, *tolerate))
        .collect()
}

pub(super) fn outcome_for_code(rule: &str, code: Option<i32>) -> BatchItemOutcome {
    match code {
        Some(0) => BatchItemOutcome::done(rule),
        Some(c) if (MARKER_BASE..MARKER_BASE + 10).contains(&c) => BatchItemOutcome::failed(
            rule,
            FixError::CommandFailed,
            Some((c - MARKER_BASE) as usize),
        ),
        _ => BatchItemOutcome::failed(rule, FixError::CommandFailed, None),
    }
}

fn set(slots: &mut [Option<BatchItemOutcome>], index: usize, outcome: BatchItemOutcome) {
    if let Some(slot) = slots.get_mut(index) {
        *slot = Some(outcome);
    }
}

pub(super) fn settle(
    plan: &BatchPlan,
    slots: Vec<Option<BatchItemOutcome>>,
    error: Option<FixError>,
) -> BatchOutcome {
    let items = plan
        .items
        .iter()
        .zip(slots)
        .map(|(p, slot)| slot.unwrap_or_else(|| BatchItemOutcome::not_run(p.spec.rule)))
        .collect();
    BatchOutcome::from_items(items, error)
}

/// Runs a started batch: preconditions, one admin dialog, then the user-level items. `Err` means nothing ran.
pub fn apply_batch(
    plan: &BatchPlan,
    running: &Arc<Running>,
    emit: &dyn Fn(FixStatus),
) -> Result<BatchOutcome, FixError> {
    let mut slots: Vec<Option<BatchItemOutcome>> = vec![None; plan.items.len()];
    for (i, item) in plan.items.iter().enumerate() {
        if let Some(pre) = item.spec.precondition
            && !run::precondition_holds(pre)
        {
            set(
                &mut slots,
                i,
                BatchItemOutcome::failed(item.spec.rule, FixError::PreconditionChanged, None),
            );
        }
    }
    let pending =
        |slots: &[Option<BatchItemOutcome>], i: usize| slots.get(i).is_some_and(|s| s.is_none());
    let to_run = plan
        .items
        .iter()
        .enumerate()
        .filter(|(i, _)| pending(&slots, *i))
        .count();
    let status = |phase: FixPhase, step: usize, of: usize, item: Option<usize>| {
        emit(FixStatus {
            plan_id: plan.id.clone(),
            phase,
            step,
            of,
            item,
        })
    };
    let admin: Vec<(usize, &Plan)> = plan
        .items
        .iter()
        .enumerate()
        .filter(|(i, p)| pending(&slots, *i) && p.spec.needs_password())
        .collect();
    if !admin.is_empty() {
        let blocks: Vec<String> = admin
            .iter()
            .map(|(i, p)| item_block(*i, &item_lines(p)))
            .collect();
        let script = batch_script(&blocks);
        status(FixPhase::WaitingForPassword, 1, 1, None);
        let prompt = prompt_for_batch(to_run);
        match privileged::run_admin_batch(&script, &prompt, batch_timeout(admin.len()), running) {
            Ok(done) => {
                let codes = parse_markers(&done.stdout, plan.items.len());
                for (i, p) in &admin {
                    set(
                        &mut slots,
                        *i,
                        outcome_for_code(p.spec.rule, codes.get(*i).copied().flatten()),
                    );
                }
            }
            Err((err, _)) => return Ok(settle(plan, slots, Some(err))),
        }
    }
    for (i, item) in plan.items.iter().enumerate() {
        if !pending(&slots, i) {
            continue;
        }
        if running.cancelled() {
            set(&mut slots, i, BatchItemOutcome::not_run(item.spec.rule));
            continue;
        }
        let of = item.spec.steps.len();
        let mut outcome = BatchItemOutcome::done(item.spec.rule);
        for (j, tokens, tolerate) in item_steps(item) {
            status(FixPhase::Running, j + 1, of, Some(i));
            let result = privileged::run_user(&tokens, running).and_then(|done| {
                if done.status == Some(0) || (done.status.is_some() && done.status == tolerate) {
                    Ok(())
                } else {
                    Err(FixError::CommandFailed)
                }
            });
            if let Err(err) = result {
                outcome = BatchItemOutcome::failed(item.spec.rule, err, Some(j));
                break;
            }
        }
        set(&mut slots, i, outcome);
    }
    Ok(settle(plan, slots, None))
}
