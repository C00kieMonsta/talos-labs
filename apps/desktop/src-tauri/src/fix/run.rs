//! Preview builds and binds a plan; apply runs one by id. Pre-run errors are `Err`, run-time errors are `FixOutcome`.

use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use serde::Serialize;
use zeroize::Zeroizing;

use super::catalog::{Choice, FixSpec, Precondition, Privilege, Secret, spec_for};
use super::plan::{Bound, Plan, Running};
use super::{FixChoice, FixError, FixOutcome, inputs, privileged, pty};
use crate::state::SshKey;

pub const STATUS_EVENT: &str = "fix:status";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FixPhase {
    WaitingForPassword,
    Running,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FixStatus {
    pub plan_id: String,
    pub phase: FixPhase,
    /// 1-based. The password dialog counts as step 1.
    pub step: usize,
    pub of: usize,
}

fn ssh_dir() -> Result<PathBuf, FixError> {
    dirs::home_dir()
        .map(|h| h.join(".ssh"))
        .ok_or(FixError::InvalidChoice)
}

#[cfg(target_os = "macos")]
fn fresh_keys(dir: &std::path::Path) -> Result<Vec<SshKey>, FixError> {
    crate::collect::macos::ssh::scan_keys(dir).map_err(|_| FixError::InvalidChoice)
}

#[cfg(not(target_os = "macos"))]
fn fresh_keys(_dir: &std::path::Path) -> Result<Vec<SshKey>, FixError> {
    Err(FixError::InvalidChoice)
}

fn fresh_shares() -> Result<String, FixError> {
    let tokens: Vec<String> = ["/usr/sbin/sharing", "-l", "-f", "json"]
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    let out = privileged::read_user(&tokens).map_err(|_| FixError::InvalidChoice)?;
    if out.status != Some(0) {
        return Err(FixError::InvalidChoice);
    }
    Ok(out.stdout)
}

/// True when the precondition still holds. A section that cannot be read counts as changed.
#[cfg(target_os = "macos")]
fn precondition_holds(pre: Precondition) -> bool {
    use crate::collect::{AnySection, collect_section};
    use crate::state::SectionKey;
    match pre {
        Precondition::RemoteManagementOff => matches!(
            collect_section(SectionKey::RemoteAccess, Arc::new(AtomicBool::new(false))),
            Ok(AnySection::RemoteAccess(section))
                if section.as_ok().is_some_and(|r| {
                    r.remote_management.as_ref().and_then(|m| m.service_loaded) != Some(true)
                })
        ),
    }
}

#[cfg(not(target_os = "macos"))]
fn precondition_holds(_pre: Precondition) -> bool {
    let _ = Arc::new(AtomicBool::new(false));
    false
}

fn bind(spec: &FixSpec, choice: &FixChoice) -> Result<Bound, FixError> {
    let mut bound = Bound::default();
    match (spec.choice, choice) {
        (Choice::None, FixChoice::None) => {}
        (Choice::Share, FixChoice::Share { path }) => {
            bound.share_name = Some(inputs::bind_share(path, &fresh_shares()?)?);
        }
        (Choice::SshKey, FixChoice::SshKey { path }) => {
            let dir = ssh_dir()?;
            let (key, flags) = inputs::bind_unencrypted_key(path, &fresh_keys(&dir)?, &dir)?;
            bound.key_paths = vec![key];
            bound.key_format_flags = flags;
        }
        (Choice::AllSshKeys, FixChoice::None) => {
            let dir = ssh_dir()?;
            let keys = inputs::bind_all_keys(&fresh_keys(&dir)?, &dir);
            bound.key_paths = keys.iter().map(|(p, _)| p.clone()).collect();
            bound.previous_modes = keys
                .into_iter()
                .filter_map(|(p, mode)| mode.map(|m| (p, m)))
                .collect();
            bound.ssh_dir = Some(dir.canonicalize().map_err(|_| FixError::InvalidChoice)?);
        }
        _ => return Err(FixError::InvalidChoice),
    }
    Ok(bound)
}

fn read_previous(spec: &FixSpec) -> Option<String> {
    let read = spec.previous?;
    let tokens: Vec<String> = std::iter::once(read.bin.path().to_owned())
        .chain(read.args.iter().map(|a| a.placeholder().to_owned()))
        .collect();
    let out = privileged::read_user(&tokens).ok()?;
    inputs::parse_previous(&out.stdout, out.status == Some(0))
}

/// Builds a plan: binds every slot from fresh listings and checks the precondition.
pub fn preview(rule: &str, choice: &FixChoice) -> Result<Plan, FixError> {
    let spec = spec_for(rule).ok_or(FixError::NotInCatalog)?;
    let bound = bind(spec, choice)?;
    if let Some(pre) = spec.precondition
        && !precondition_holds(pre)
    {
        return Err(FixError::PreconditionChanged);
    }
    Ok(Plan::new(spec, bound, read_previous(spec)))
}

/// Runs a started plan. `Err` means nothing ran.
pub fn apply(
    plan: &Plan,
    running: &Arc<Running>,
    passphrase: Option<Zeroizing<String>>,
    emit: &dyn Fn(FixStatus),
) -> Result<FixOutcome, FixError> {
    let spec = plan.spec;
    let passphrase = match spec.secret {
        Secret::None => None,
        Secret::NewPassphrase => {
            let value = passphrase.ok_or(FixError::InvalidInput)?;
            inputs::check_passphrase(&value)?;
            Some(value)
        }
    };
    if let Some(pre) = spec.precondition
        && !precondition_holds(pre)
    {
        return Err(FixError::PreconditionChanged);
    }
    let status = |phase: FixPhase, step: usize, of: usize| {
        emit(FixStatus {
            plan_id: plan.id.clone(),
            phase,
            step,
            of,
        })
    };
    let steps: Vec<(usize, Vec<String>, Option<i32>, Privilege)> = spec
        .steps
        .iter()
        .enumerate()
        .flat_map(|(i, step)| {
            plan.bound
                .commands(step)
                .into_iter()
                .map(move |tokens| (i, tokens, step.tolerate_exit, step.privilege))
        })
        .collect();
    let of = spec.steps.len();
    if spec.needs_password() {
        let lines: Vec<String> = steps
            .iter()
            .map(|(i, tokens, tolerate, _)| privileged::shell_line(*i, tokens, *tolerate))
            .collect();
        status(FixPhase::WaitingForPassword, 1, of);
        return Ok(
            match privileged::run_admin(&lines, &prompt_for(spec), running) {
                Ok(()) => FixOutcome::ok(),
                Err((err, step)) => FixOutcome::failed(err, step),
            },
        );
    }
    for (i, tokens, tolerate, _) in &steps {
        status(FixPhase::Running, i + 1, of);
        let result = match &passphrase {
            Some(secret) => run_pty(plan, tokens, secret, running),
            None => privileged::run_user(tokens, running).and_then(|done| {
                if done.status == Some(0) || (done.status.is_some() && done.status == *tolerate) {
                    Ok(())
                } else {
                    Err(FixError::CommandFailed)
                }
            }),
        };
        if let Err(err) = result {
            return Ok(FixOutcome::failed(err, Some(*i)));
        }
    }
    Ok(FixOutcome::ok())
}

fn run_pty(
    plan: &Plan,
    tokens: &[String],
    secret: &Zeroizing<String>,
    running: &Running,
) -> Result<(), FixError> {
    let key = plan
        .bound
        .key_paths
        .first()
        .ok_or(FixError::InvalidChoice)?;
    if !pty::still_unencrypted(key) {
        return Err(FixError::CommandFailed);
    }
    let (program, args) = tokens.split_first().ok_or(FixError::CommandFailed)?;
    pty::drive(
        &pty::Session {
            program,
            args,
            passphrase: secret,
            prompt_timeout: pty::PROMPT_TIMEOUT,
        },
        running,
    )
}

/// The sentence in macOS's password dialog.
pub fn prompt_for(spec: &FixSpec) -> String {
    let what = match spec.rule {
        "TL-MAC-002" => "turn the firewall on",
        "TL-MAC-003" => "turn stealth mode on",
        "TL-MAC-007" | "TL-MAC-008" | "TL-MAC-009" => "turn automatic updates on",
        "TL-MAC-011" => "turn App Store updates on",
        "TL-MAC-015" => "turn the Guest account off",
        "TL-MAC-016" => "turn automatic login off",
        "TL-MAC-019" => "turn Remote Login off",
        "TL-MAC-020" => "turn Screen Sharing off",
        "TL-MAC-021" => "turn Remote Management off",
        "TL-MAC-022" => "stop sharing a folder with everyone",
        _ => "change a setting",
    };
    format!("Talos Labs wants to {what}.")
}
