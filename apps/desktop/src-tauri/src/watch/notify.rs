//! The one notification the app ever sends: on a transition into act now, once per item id,
//! never for a gated item, never when the notify switch is off. The body is a fixed headline
//! from the FISHY set plus one fixed tail; no program name, port or path is ever in it
//! (docs/DESIGN-WATCH.md section 5). fixtures/watch-cases.json pins the headlines to copy.ts.

use std::collections::BTreeMap;

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::signals::parse_ms;
use super::{FishyKind, SignalId};

pub const NOTIFIED_EVENT: &str = "watch:notified";
pub const TAIL: &str = "Open me to see what experts suggest.";
const DAY_MS: i64 = 24 * 60 * 60 * 1000;

pub const HEADLINE_PERSISTENCE: &str = "A new program started running on its own";
pub const HEADLINE_LISTENER: &str = "A new program is waiting for calls from the network";
pub const HEADLINE_GUARD: &str = "A built-in safety guard was switched off";
pub const HEADLINE_REMOTE: &str = "Remote access to your Mac was turned on";
pub const HEADLINE_ADMIN: &str = "A new admin account was added";
pub const HEADLINE_DNS: &str = "The way your Mac finds websites changed";
pub const HEADLINE_BACKUP: &str = "Your backups were switched off";

pub fn headline(kind: FishyKind) -> &'static str {
    match kind {
        FishyKind::Persistence => HEADLINE_PERSISTENCE,
        FishyKind::Listener => HEADLINE_LISTENER,
        FishyKind::Guard => HEADLINE_GUARD,
        FishyKind::Remote => HEADLINE_REMOTE,
        FishyKind::Admin => HEADLINE_ADMIN,
        FishyKind::Dns => HEADLINE_DNS,
        FishyKind::Backup => HEADLINE_BACKUP,
    }
}

/// The notification body: the item's headline, a full stop, then the fixed tail.
pub fn body_for(kind: FishyKind) -> String {
    format!("{}. {}", headline(kind), TAIL)
}

/// Whether to send for `signal`: once per item id, at most one in any 24 h unless a different
/// item, never gated, never when the switch is off. `notified` is the ledger from watch.json.
pub fn should_notify(
    notified: &BTreeMap<SignalId, String>,
    signal: SignalId,
    gated: bool,
    notify: bool,
    now_ms: i64,
) -> bool {
    if !notify || gated || notified.contains_key(&signal) {
        return false;
    }
    let latest = notified
        .iter()
        .filter_map(|(id, at)| parse_ms(at).map(|ms| (*id, ms)))
        .max_by_key(|(_, ms)| *ms);
    !matches!(latest, Some((id, ms)) if id == signal && now_ms - ms < DAY_MS)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotifiedPayload {
    pub signal_id: SignalId,
}

/// Sends the banner through the tray module and emits `watch:notified` whether the banner was
/// delivered or fell back to the window. Returns true when the banner call succeeded.
pub fn send(app: &AppHandle, signal: SignalId, kind: FishyKind) -> bool {
    let delivered = crate::tray::send_notification(app, &body_for(kind)).is_ok();
    let _ = app.emit(NOTIFIED_EVENT, NotifiedPayload { signal_id: signal });
    delivered
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: &str = "2026-10-17T12:00:00.000Z";

    fn ms(text: &str) -> i64 {
        parse_ms(text).unwrap()
    }

    #[test]
    fn the_body_is_the_headline_plus_the_fixed_tail() {
        assert_eq!(
            body_for(FishyKind::Persistence),
            "A new program started running on its own. Open me to see what experts suggest."
        );
        for kind in FishyKind::ALL {
            let body = body_for(*kind);
            assert!(
                body.ends_with(&format!(". {TAIL}")),
                "two sentences: {body}"
            );
            assert!(
                !body.contains('/') && !body.contains(':'),
                "no path or port can be in a body"
            );
        }
    }

    #[test]
    fn once_per_item_never_gated_never_when_off() {
        let empty = BTreeMap::new();
        assert!(should_notify(
            &empty,
            SignalId::PersistenceNew,
            false,
            true,
            ms(NOW)
        ));
        assert!(
            !should_notify(&empty, SignalId::PersistenceNew, true, true, ms(NOW)),
            "gated"
        );
        assert!(
            !should_notify(&empty, SignalId::PersistenceNew, false, false, ms(NOW)),
            "switch off"
        );
        let mut ledger = BTreeMap::new();
        ledger.insert(
            SignalId::PersistenceNew,
            "2026-10-10T12:00:00.000Z".to_owned(),
        );
        assert!(
            !should_notify(&ledger, SignalId::PersistenceNew, false, true, ms(NOW)),
            "never repeated for the same item"
        );
        assert!(
            should_notify(&ledger, SignalId::Sip, false, true, ms(NOW)),
            "a different item may notify"
        );
    }

    #[test]
    fn the_24_hour_rule_with_a_fake_clock() {
        let mut ledger = BTreeMap::new();
        ledger.insert(SignalId::Sip, "2026-10-17T11:00:00.000Z".to_owned());
        assert!(!should_notify(&ledger, SignalId::Sip, false, true, ms(NOW)));
        assert!(
            !should_notify(
                &ledger,
                SignalId::Sip,
                false,
                true,
                ms("2026-10-19T12:00:00.000Z")
            ),
            "still never for the same id"
        );
        assert!(
            should_notify(&ledger, SignalId::Gatekeeper, false, true, ms(NOW)),
            "a different item within the day is allowed"
        );
        ledger.insert(SignalId::Gatekeeper, "bad date".to_owned());
        assert!(
            should_notify(&ledger, SignalId::HiddenUserCount, false, true, ms(NOW)),
            "an unparseable entry does not block"
        );
    }
}
