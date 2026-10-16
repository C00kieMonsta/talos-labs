//! Software Update preferences from `defaults read`.

use std::sync::atomic::AtomicBool;

use super::defaults;
use crate::collect::{Fail, to_section};
use crate::state::{Section, Tri, Updates};

pub const SOFTWARE_UPDATE_DOMAIN: &str = "/Library/Preferences/com.apple.SoftwareUpdate";
pub const COMMERCE_DOMAIN: &str = "/Library/Preferences/com.apple.commerce";

/// `dump` is the `defaults read` output of the SoftwareUpdate domain (empty when the domain is missing).
/// `commerce_auto_update` is the printed value of `com.apple.commerce AutoUpdate`, or None when missing.
pub fn parse_software_update(dump: &str, commerce_auto_update: Option<&str>) -> Updates {
    let map = defaults::parse_dump(dump);
    let config = defaults::bool_of(&map, "ConfigDataInstall");
    let critical = defaults::bool_of(&map, "CriticalUpdateInstall");
    let responses = match (config, critical) {
        (None, None) => Tri::Unset,
        (Some(false), _) | (_, Some(false)) => Tri::False,
        _ => Tri::True,
    };
    // RecommendedUpdates lists what is pending; LastUpdatesAvailable is a counter that stays at 1 after the install.
    let pending_count = match defaults::array_len(dump, "RecommendedUpdates") {
        Some(n) => Some(n as u64),
        None => map.get("LastUpdatesAvailable").and_then(|v| v.parse().ok()),
    };
    Updates {
        pending_count,
        last_check_at: map
            .get("LastSuccessfulDate")
            .and_then(|v| defaults::date_to_iso(v)),
        last_result_code: map.get("LastResultCode").and_then(|v| v.parse().ok()),
        automatic_check: defaults::tri(&map, "AutomaticCheckEnabled"),
        automatic_download: defaults::tri(&map, "AutomaticDownload"),
        auto_install_os: defaults::tri(&map, "AutomaticallyInstallMacOSUpdates"),
        auto_install_security_responses: responses,
        app_store_auto_update: Tri::from(commerce_auto_update.and_then(defaults::as_bool)),
    }
}

fn inner(cancel: &AtomicBool) -> Result<Updates, Fail> {
    let dump = defaults::read_domain(SOFTWARE_UPDATE_DOMAIN, "SoftwareUpdate", cancel)?
        .unwrap_or_default();
    let commerce = defaults::read_key(COMMERCE_DOMAIN, "AutoUpdate", "commerce", cancel)?;
    Ok(parse_software_update(&dump, commerce.as_deref()))
}

pub fn collect(cancel: &AtomicBool) -> Section<Updates> {
    to_section(inner(cancel))
}

#[cfg(test)]
mod tests {
    use super::*;

    const CAPTURED: &str = include_str!("../../../tests/fixtures/softwareupdate.txt");

    #[test]
    fn parses_captured_dump_without_automatic_check_key() {
        let u = parse_software_update(CAPTURED, Some("0"));
        assert_eq!(
            u.pending_count,
            Some(0),
            "RecommendedUpdates is empty although LastUpdatesAvailable is 1"
        );
        assert_eq!(u.last_check_at.as_deref(), Some("2026-10-15T08:56:56.000Z"));
        assert_eq!(u.last_result_code, Some(2));
        assert_eq!(u.automatic_check, Tri::Unset);
        assert_eq!(u.automatic_download, Tri::True);
        assert_eq!(u.auto_install_os, Tri::True);
        assert_eq!(u.auto_install_security_responses, Tri::True);
        assert_eq!(u.app_store_auto_update, Tri::False);
    }

    /// The captured dump with one entry in `RecommendedUpdates`, in the shape `defaults read` prints it.
    const PENDING: &str = "{\n    AutomaticDownload = 1;\n    LastResultCode = 2;\n    LastSuccessfulDate = \"2026-10-15 08:56:56 +0000\";\n    LastUpdatesAvailable = 1;\n    RecommendedUpdates =     (\n                {\n            \"Display Name\" = \"macOS Tahoe 27.1\";\n            \"Display Version\" = \"27.1\";\n            Identifier = \"MSU_UPDATE_26B74_patch_27.1_minor\";\n            \"Product Key\" = \"MSU_UPDATE_26B74_patch_27.1_minor\";\n        }\n    );\n    SplatEnabled = 1;\n}\n";

    #[test]
    fn pending_count_comes_from_recommended_updates() {
        assert_eq!(parse_software_update(PENDING, None).pending_count, Some(1));
        let two = PENDING.replace("        }\n    );", "        },\n                {\n            \"Display Name\" = \"Safari 27.1\";\n        }\n    );");
        assert_eq!(parse_software_update(&two, None).pending_count, Some(2));
        let counter_only = parse_software_update("{\n    LastUpdatesAvailable = 1;\n}\n", None);
        assert_eq!(
            counter_only.pending_count,
            Some(1),
            "the counter is the fallback when the list is absent"
        );
        let counter_zero = parse_software_update("{\n    LastUpdatesAvailable = 0;\n}\n", None);
        assert_eq!(counter_zero.pending_count, Some(0));
        assert_eq!(
            parse_software_update("{\n    SplatEnabled = 1;\n}\n", None).pending_count,
            None
        );
    }

    #[test]
    fn automatic_check_key_present() {
        let u = parse_software_update("{\n    AutomaticCheckEnabled = 1;\n}\n", None);
        assert_eq!(u.automatic_check, Tri::True);
        let u = parse_software_update("{\n    AutomaticCheckEnabled = 0;\n}\n", Some("1"));
        assert_eq!(u.automatic_check, Tri::False);
        assert_eq!(u.app_store_auto_update, Tri::True);
    }

    #[test]
    fn security_responses_fold_four_combinations() {
        let both_missing = parse_software_update("{\n}\n", None);
        assert_eq!(both_missing.auto_install_security_responses, Tri::Unset);
        let one_false = parse_software_update(
            "{\n    ConfigDataInstall = 1;\n    CriticalUpdateInstall = 0;\n}\n",
            None,
        );
        assert_eq!(one_false.auto_install_security_responses, Tri::False);
        let other_false = parse_software_update("{\n    ConfigDataInstall = 0;\n}\n", None);
        assert_eq!(other_false.auto_install_security_responses, Tri::False);
        let both_true = parse_software_update(
            "{\n    ConfigDataInstall = 1;\n    CriticalUpdateInstall = 1;\n}\n",
            None,
        );
        assert_eq!(both_true.auto_install_security_responses, Tri::True);
        let one_true = parse_software_update("{\n    CriticalUpdateInstall = 1;\n}\n", None);
        assert_eq!(one_true.auto_install_security_responses, Tri::True);
    }

    #[test]
    fn missing_domain_gives_unset_and_null_count() {
        let u = parse_software_update("", None);
        assert_eq!(u.pending_count, None);
        assert_eq!(u.last_check_at, None);
        assert_eq!(u.automatic_download, Tri::Unset);
        assert_eq!(u.app_store_auto_update, Tri::Unset);
    }
}
