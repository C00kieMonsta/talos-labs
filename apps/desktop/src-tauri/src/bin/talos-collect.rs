//! Runs the collectors without a Tauri runtime and prints the SystemState JSON.
//! Usage: talos-collect [--section <key>]

use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use talos_desktop_lib::collect::{self, ProgressFn, ProgressStatus};
use talos_desktop_lib::state::SectionKey;

fn usage() -> ! {
    eprintln!("usage: talos-collect [--section <key>]");
    eprintln!(
        "keys: {}",
        SectionKey::ALL
            .iter()
            .map(|k| k.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    );
    std::process::exit(2);
}

fn print_json<T: serde::Serialize>(value: &T) {
    match serde_json::to_string_pretty(value) {
        Ok(text) => println!("{text}"),
        Err(err) => {
            eprintln!("serialise: {err}");
            std::process::exit(1);
        }
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cancel = Arc::new(AtomicBool::new(false));
    match args.as_slice() {
        [] => {
            let progress: Arc<ProgressFn> = Arc::new(|key, status| {
                let label = match status {
                    ProgressStatus::Started => "started",
                    ProgressStatus::Ok => "ok",
                    ProgressStatus::Unavailable => "unavailable",
                };
                eprintln!("{:<20} {}", key.as_str(), label);
            });
            match collect::collect_all(progress, cancel) {
                Ok(state) => print_json(&state),
                Err(err) => {
                    eprintln!("{err}");
                    std::process::exit(1);
                }
            }
        }
        [flag, key] if flag == "--section" => {
            let Some(key) = SectionKey::parse(key) else {
                usage()
            };
            match collect::collect_section(key, cancel) {
                Ok(section) => print_json(&section),
                Err(err) => {
                    eprintln!("{err}");
                    std::process::exit(1);
                }
            }
        }
        _ => usage(),
    }
}
