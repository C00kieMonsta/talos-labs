//! Host facts from `sw_vers`.

use std::sync::atomic::AtomicBool;

use super::run;
use crate::collect::current_arch;
use crate::exec::Bin;
use crate::state::{Host, Os};

/// Parses `sw_vers` into (ProductVersion, BuildVersion).
pub fn parse_sw_vers(text: &str) -> Option<(String, Option<String>)> {
    let mut version = None;
    let mut build = None;
    for line in text.lines() {
        if let Some((key, value)) = line.split_once(':') {
            match key.trim() {
                "ProductVersion" => version = Some(value.trim().to_owned()),
                "BuildVersion" => build = Some(value.trim().to_owned()),
                _ => {}
            }
        }
    }
    version.map(|v| (v, build))
}

pub fn collect(cancel: &AtomicBool) -> Host {
    let (os_version, os_build) = run(Bin::SwVers, &[], cancel)
        .ok()
        .and_then(|out| parse_sw_vers(&out.stdout))
        .unwrap_or_else(|| ("unknown".to_owned(), None));
    Host {
        os: Os::Macos,
        os_version,
        os_build,
        arch: current_arch(),
        collector_version: env!("CARGO_PKG_VERSION").to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sw_vers() {
        let text = "ProductName:\t\tmacOS\nProductVersion:\t\t27.0.1\nBuildVersion:\t\t26A434\n";
        assert_eq!(
            parse_sw_vers(text),
            Some(("27.0.1".to_owned(), Some("26A434".to_owned())))
        );
        assert_eq!(parse_sw_vers("garbage"), None);
    }
}
