//! A read-only sweep on this Mac. Ignored by default: it runs every probe binary once and
//! prints which probes read unavailable (the socket table is empty under an ad-hoc build).
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::time::Duration;

use talos_desktop_lib::watch::probes::{run_sweep, sweep_probes};

#[test]
#[ignore]
fn a_live_sweep_runs_every_probe_read_only() {
    let outcomes = run_sweep(&sweep_probes(), Duration::from_secs(60));
    assert_eq!(outcomes.len(), sweep_probes().len());
    for outcome in &outcomes {
        match &outcome.result {
            Ok(list) => eprintln!("{}: {} signals", outcome.probe.as_str(), list.len()),
            Err(reason) => eprintln!("{}: unavailable ({reason:?})", outcome.probe.as_str()),
        }
    }
    let ok = outcomes.iter().filter(|o| o.result.is_ok()).count();
    assert!(
        ok >= outcomes.len() - 3,
        "{ok} of {} probes read",
        outcomes.len()
    );
}
