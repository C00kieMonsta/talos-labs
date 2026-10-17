//! The app ACL manifest: every command in commands.txt gets an `allow-<kebab>` and a `deny-<kebab>`
//! permission, so a window reaches only the commands its capability file names.

use tauri_build::{AppManifest, Attributes};

fn main() {
    println!("cargo:rerun-if-changed=commands.txt");
    let commands: Vec<&'static str> = include_str!("commands.txt")
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect();
    let commands: &'static [&'static str] = Box::leak(commands.into_boxed_slice());
    let manifest = AppManifest::new().commands(commands);
    if let Err(err) = tauri_build::try_build(Attributes::new().app_manifest(manifest)) {
        eprintln!("tauri build failed: {err}");
        std::process::exit(1);
    }
}
