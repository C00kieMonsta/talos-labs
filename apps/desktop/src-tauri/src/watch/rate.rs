//! The pure rating rules from docs/DESIGN-WATCH.md section 3. Every function mirrors
//! `packages/core/src/watch/rate.ts`; tests/watch_cases_contract.rs pins both sides.

use std::collections::BTreeSet;

use super::signals::{
    GATED_SIGNALS, PAIR_SIGNALS, STAND_ALONE_SIGNALS, bad_flip, kind_of, pair_group, points,
    siblings,
};
use super::types::{RuleChange, WatchContext, WatchRule, WatchSignal};
use super::{FishyKind, Rating, Severity, SignalId};

const DAY_MINUTES: i64 = 24 * 60;

pub fn max_rating(a: Rating, b: Rating) -> Rating {
    if a.rank() >= b.rank() { a } else { b }
}

pub fn min_rating(a: Rating, b: Rating) -> Rating {
    if a.rank() <= b.rank() { a } else { b }
}

/// Changed, not acknowledged: the only signals that count.
fn active(signal: &WatchSignal) -> bool {
    signal.change != super::Change::Same && !signal.acknowledged
}

fn within_day(signal: &WatchSignal) -> bool {
    signal.minutes_since_change.is_none_or(|m| m <= DAY_MINUTES)
}

fn is_high(signal: &WatchSignal) -> bool {
    matches!(signal.severity, Severity::High | Severity::Critical)
}

fn flips(signal: &WatchSignal) -> bool {
    bad_flip(
        signal.signal_id,
        signal.value,
        signal.previous,
        signal.change,
    )
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bounds {
    pub floor: Rating,
    pub ceiling: Rating,
}

/// Floor is act_now on a stand-alone flip, a gated flip answered "No, I didn't", or two pair
/// signals from different listings (a gated flip counts as one) within 24 h; keep_an_eye on any high or medium change
/// within 24 h, an unanswered gate, a rule that appeared, or a signal that just became
/// unavailable. Ceiling is act_now only on an unacknowledged, ungated high change; keep_an_eye
/// on any unacknowledged change; calm otherwise.
pub fn bounds_for(signals: &[WatchSignal], rules: &[WatchRule]) -> Bounds {
    let live: Vec<&WatchSignal> = signals.iter().filter(|s| active(s)).collect();
    let stand_alone = live
        .iter()
        .any(|s| STAND_ALONE_SIGNALS.contains(&s.signal_id) && flips(s));
    let gate_answered_no = live
        .iter()
        .any(|s| GATED_SIGNALS.contains(&s.signal_id) && flips(s) && !s.gated);
    // The three persistence counters rise from one listing, so they count once.
    let pairs = live
        .iter()
        .filter(|s| {
            (PAIR_SIGNALS.contains(&s.signal_id) || GATED_SIGNALS.contains(&s.signal_id))
                && flips(s)
                && within_day(s)
        })
        .map(|s| pair_group(s.signal_id))
        .collect::<BTreeSet<SignalId>>()
        .len();
    let floor = if stand_alone || gate_answered_no || pairs >= 2 {
        Rating::ActNow
    } else if live
        .iter()
        .any(|s| (is_high(s) || s.severity == Severity::Medium) && within_day(s))
        || live.iter().any(|s| s.gated)
        || live
            .iter()
            .any(|s| s.freshness == super::Freshness::Unavailable)
        || rules.iter().any(|r| r.change == RuleChange::Appeared)
    {
        Rating::KeepAnEye
    } else {
        Rating::Calm
    };
    let ceiling = if live.iter().any(|s| is_high(s) && !s.gated) {
        Rating::ActNow
    } else if live.is_empty() {
        Rating::Calm
    } else {
        Rating::KeepAnEye
    };
    Bounds { floor, ceiling }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TopItem {
    pub signal_id: SignalId,
    pub kind: FishyKind,
    pub points: u32,
}

fn order_of(signal: SignalId) -> usize {
    SignalId::ALL
        .iter()
        .position(|s| *s == signal)
        .unwrap_or(usize::MAX)
}

/// True when a changed signal is worth a headline: readable, and for a signal with a bad
/// direction, flipped that way; a cleared change never is. Mirrors `headlineWorthy` in core.
fn headline_worthy(signal: &WatchSignal) -> bool {
    if signal.freshness == super::Freshness::Unavailable || signal.change == super::Change::Cleared
    {
        return false;
    }
    if super::signals::bad_direction(signal.signal_id).is_some() {
        return flips(signal);
    }
    true
}

/// The listing digests: a change to one is a headline only through a kinded sibling counter.
pub const LISTING_DIGESTS: [SignalId; 3] = [
    SignalId::PersistenceSet,
    SignalId::ListenerSet,
    SignalId::AppSet,
];

/// A listing digest is worth a headline only when a kinded counter from the same listing rose:
/// a removed launch item, a closed listener, an App Store install or a self-update is a change
/// to look at, never "a new program". Every other signal is worthy. Mirrors `listingWorthy` in core.
fn listing_worthy(signal: &WatchSignal, signals: &[WatchSignal]) -> bool {
    if !LISTING_DIGESTS.contains(&signal.signal_id) {
        return true;
    }
    let group = siblings(signal.signal_id);
    signals.iter().any(|s| {
        s.signal_id != signal.signal_id
            && group.contains(&s.signal_id)
            && kind_of(s.signal_id).is_some()
            && active(s)
            && flips(s)
    })
}

/// Kinded, changed, unacknowledged signals by points desc, then SignalId order, one per listing:
/// a new launch agent changes four signals and makes one item. A good flip or an unreadable probe
/// makes no item: the headlines all name a bad direction.
pub fn top_items(signals: &[WatchSignal]) -> Vec<TopItem> {
    let mut items: Vec<TopItem> = signals
        .iter()
        .filter(|s| active(s) && headline_worthy(s) && listing_worthy(s, signals))
        .filter_map(|s| {
            kind_of(s.signal_id).map(|kind| TopItem {
                signal_id: s.signal_id,
                kind,
                points: points(s.severity),
            })
        })
        .collect();
    items.sort_by_key(|item| (std::cmp::Reverse(item.points), order_of(item.signal_id)));
    let mut seen = BTreeSet::new();
    items.retain(|item| seen.insert(pair_group(item.signal_id)));
    items
}

/// The shown rating: max(floor, min(verdict.rating, ceiling)). The first cycle rates nothing,
/// and act_now needs at least one item to show.
pub fn rate_watch(context: &WatchContext, verdict: Option<Rating>) -> Rating {
    if context.cycle.index == 0 {
        return Rating::Calm;
    }
    let wanted = verdict.unwrap_or(context.floor);
    let rating = max_rating(context.floor, min_rating(wanted, context.ceiling));
    if rating == Rating::ActNow && top_items(&context.signals).is_empty() {
        return Rating::KeepAnEye;
    }
    rating
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hysteresis {
    pub rating: Rating,
    pub calm_streak: u32,
}

/// The rating rises at once and falls only after two consecutive lower cycles.
pub fn apply_hysteresis(previous: Rating, next: Rating, calm_streak: u32) -> Hysteresis {
    if next.rank() >= previous.rank() {
        return Hysteresis {
            rating: next,
            calm_streak: 0,
        };
    }
    let streak = calm_streak + 1;
    if streak >= 2 {
        return Hysteresis {
            rating: next,
            calm_streak: 0,
        };
    }
    Hysteresis {
        rating: previous,
        calm_streak: streak,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::watch::types::{PreviousValue, SignalValue};
    use crate::watch::{Change, Freshness};

    fn signal(
        id: SignalId,
        value: SignalValue,
        previous: Option<PreviousValue>,
        change: Change,
    ) -> WatchSignal {
        WatchSignal {
            signal_id: id,
            value,
            previous,
            change,
            severity: crate::watch::signals::severity(id),
            minutes_since_change: if change == Change::Same {
                None
            } else {
                Some(5)
            },
            freshness: Freshness::Fresh,
            acknowledged: false,
            gated: false,
        }
    }

    #[test]
    fn a_stand_alone_flip_floors_at_act_now() {
        let signals = [signal(
            SignalId::Sip,
            SignalValue::Bool(false),
            Some(PreviousValue::Bool(true)),
            Change::Changed,
        )];
        assert_eq!(
            bounds_for(&signals, &[]),
            Bounds {
                floor: Rating::ActNow,
                ceiling: Rating::ActNow
            }
        );
    }

    #[test]
    fn two_pair_signals_within_a_day_floor_at_act_now_but_one_only_looks() {
        let one = [signal(
            SignalId::PersistenceNew,
            SignalValue::Int(1),
            Some(PreviousValue::Int(0)),
            Change::Changed,
        )];
        assert_eq!(bounds_for(&one, &[]).floor, Rating::KeepAnEye);
        let two = [
            one[0].clone(),
            signal(
                SignalId::ListenerNewPorts,
                SignalValue::Int(1),
                Some(PreviousValue::Int(0)),
                Change::Changed,
            ),
        ];
        assert_eq!(bounds_for(&two, &[]).floor, Rating::ActNow);
        let mut old = two.clone();
        old[1].minutes_since_change = Some(DAY_MINUTES + 1);
        assert_eq!(
            bounds_for(&old, &[]).floor,
            Rating::KeepAnEye,
            "the second pair is older than a day"
        );
    }

    #[test]
    fn the_three_persistence_counters_from_one_listing_count_as_one_pair() {
        let lone = [
            signal(
                SignalId::PersistenceNew,
                SignalValue::Int(1),
                Some(PreviousValue::Int(0)),
                Change::Changed,
            ),
            signal(
                SignalId::PersistenceUnsigned,
                SignalValue::Int(1),
                Some(PreviousValue::Int(0)),
                Change::Changed,
            ),
            signal(
                SignalId::PersistenceInTempOrHidden,
                SignalValue::Int(1),
                Some(PreviousValue::Int(0)),
                Change::Changed,
            ),
        ];
        assert_eq!(
            bounds_for(&lone, &[]),
            Bounds {
                floor: Rating::KeepAnEye,
                ceiling: Rating::ActNow
            },
            "a lone unsigned temp item looks"
        );
        let mut corroborated = lone.to_vec();
        corroborated.push(signal(
            SignalId::DnsManual,
            SignalValue::Bool(true),
            Some(PreviousValue::Bool(false)),
            Change::Changed,
        ));
        assert_eq!(
            bounds_for(&corroborated, &[]).floor,
            Rating::ActNow,
            "a second listing acts"
        );
    }

    #[test]
    fn an_unanswered_gate_looks_and_a_no_answer_acts() {
        let mut gated = signal(
            SignalId::Firewall,
            SignalValue::Bool(false),
            Some(PreviousValue::Bool(true)),
            Change::Changed,
        );
        gated.gated = true;
        assert_eq!(
            bounds_for(std::slice::from_ref(&gated), &[]),
            Bounds {
                floor: Rating::KeepAnEye,
                ceiling: Rating::KeepAnEye
            }
        );
        gated.gated = false;
        assert_eq!(
            bounds_for(std::slice::from_ref(&gated), &[]),
            Bounds {
                floor: Rating::ActNow,
                ceiling: Rating::ActNow
            }
        );
    }

    #[test]
    fn an_acknowledged_change_counts_for_nothing_and_unavailable_is_never_calm() {
        let mut acked = signal(
            SignalId::Sip,
            SignalValue::Bool(false),
            Some(PreviousValue::Bool(true)),
            Change::Changed,
        );
        acked.acknowledged = true;
        assert_eq!(
            bounds_for(std::slice::from_ref(&acked), &[]),
            Bounds {
                floor: Rating::Calm,
                ceiling: Rating::Calm
            }
        );
        let mut gone = signal(
            SignalId::LoadAvg,
            SignalValue::Change(Change::Changed),
            None,
            Change::Changed,
        );
        gone.freshness = Freshness::Unavailable;
        assert_eq!(
            bounds_for(std::slice::from_ref(&gone), &[]).floor,
            Rating::KeepAnEye
        );
    }

    #[test]
    fn top_items_sort_by_points_then_signal_order_and_skip_unkinded() {
        let signals = [
            signal(
                SignalId::PendingUpdates,
                SignalValue::Int(1),
                Some(PreviousValue::Int(0)),
                Change::Changed,
            ),
            signal(
                SignalId::ShareCount,
                SignalValue::Int(2),
                Some(PreviousValue::Int(1)),
                Change::Changed,
            ),
            signal(
                SignalId::Firewall,
                SignalValue::Bool(false),
                Some(PreviousValue::Bool(true)),
                Change::Changed,
            ),
            signal(
                SignalId::PersistenceNew,
                SignalValue::Int(1),
                Some(PreviousValue::Int(0)),
                Change::Changed,
            ),
            signal(
                SignalId::Sip,
                SignalValue::Bool(true),
                Some(PreviousValue::Bool(true)),
                Change::Same,
            ),
        ];
        let ids: Vec<SignalId> = top_items(&signals).iter().map(|i| i.signal_id).collect();
        assert_eq!(
            ids,
            [
                SignalId::PersistenceNew,
                SignalId::Firewall,
                SignalId::ShareCount
            ]
        );
    }

    #[test]
    fn a_good_flip_a_cleared_change_and_an_unreadable_probe_make_no_item() {
        let good = [signal(
            SignalId::Firewall,
            SignalValue::Bool(true),
            Some(PreviousValue::Bool(false)),
            Change::Changed,
        )];
        assert!(
            top_items(&good).is_empty(),
            "the firewall came on: no headline"
        );
        assert_eq!(
            bounds_for(&good, &[]).floor,
            Rating::KeepAnEye,
            "but the change is still something to look at"
        );
        let cleared = [signal(
            SignalId::ShareCount,
            SignalValue::Int(1),
            Some(PreviousValue::Int(2)),
            Change::Cleared,
        )];
        assert!(top_items(&cleared).is_empty());
        let mut gone = signal(
            SignalId::ListenerSet,
            SignalValue::Change(Change::Changed),
            None,
            Change::Changed,
        );
        gone.freshness = Freshness::Unavailable;
        assert!(
            top_items(std::slice::from_ref(&gone)).is_empty(),
            "an unreadable probe is not a new listener"
        );
        let fewer = [signal(
            SignalId::AdminCount,
            SignalValue::Int(1),
            Some(PreviousValue::Int(2)),
            Change::Changed,
        )];
        assert!(
            top_items(&fewer).is_empty(),
            "an admin removed is not an admin added"
        );
    }

    #[test]
    fn one_listing_change_makes_one_item_under_its_highest_counter() {
        let one_agent = [
            signal(
                SignalId::PersistenceSet,
                SignalValue::Change(Change::Changed),
                None,
                Change::Changed,
            ),
            signal(
                SignalId::PersistenceNew,
                SignalValue::Int(1),
                Some(PreviousValue::Int(0)),
                Change::Changed,
            ),
            signal(
                SignalId::PersistenceUnsigned,
                SignalValue::Int(1),
                Some(PreviousValue::Int(0)),
                Change::Changed,
            ),
            signal(
                SignalId::PersistenceInTempOrHidden,
                SignalValue::Int(1),
                Some(PreviousValue::Int(0)),
                Change::Changed,
            ),
            signal(
                SignalId::ListenerSet,
                SignalValue::Change(Change::Changed),
                None,
                Change::Changed,
            ),
            signal(
                SignalId::ListenerNewPorts,
                SignalValue::Int(1),
                Some(PreviousValue::Int(0)),
                Change::Changed,
            ),
        ];
        let ids: Vec<SignalId> = top_items(&one_agent).iter().map(|i| i.signal_id).collect();
        assert_eq!(
            ids,
            [SignalId::PersistenceNew, SignalId::ListenerNewPorts],
            "four signals, one item per listing"
        );
        let mut acked = one_agent.to_vec();
        acked[1].acknowledged = true;
        let ids: Vec<SignalId> = top_items(&acked).iter().map(|i| i.signal_id).collect();
        assert_eq!(
            ids,
            [SignalId::PersistenceUnsigned, SignalId::ListenerNewPorts],
            "the next sibling stands in"
        );
    }

    #[test]
    fn a_removed_launch_item_or_a_closed_listener_makes_no_item() {
        let removed = [
            signal(
                SignalId::PersistenceSet,
                SignalValue::Change(Change::Changed),
                None,
                Change::Changed,
            ),
            signal(
                SignalId::PersistenceNew,
                SignalValue::Int(0),
                Some(PreviousValue::Int(0)),
                Change::Same,
            ),
        ];
        assert!(
            top_items(&removed).is_empty(),
            "a digest change with no counter up is not a new program"
        );
        assert_eq!(
            bounds_for(&removed, &[]).floor,
            Rating::KeepAnEye,
            "but it is still something to look at"
        );
        let closed = [signal(
            SignalId::ListenerSet,
            SignalValue::Change(Change::Changed),
            None,
            Change::Changed,
        )];
        assert!(top_items(&closed).is_empty());
        let hosts = [signal(
            SignalId::HostsChanged,
            SignalValue::Change(Change::Changed),
            None,
            Change::Changed,
        )];
        assert_eq!(
            top_items(&hosts).len(),
            1,
            "a lone stat digest still counts on any change"
        );
    }

    #[test]
    fn a_stat_digest_is_worthy_on_any_change_and_a_listing_only_through_a_kinded_sibling() {
        let zshrc = [signal(
            SignalId::ShellStartupChanged,
            SignalValue::Change(Change::Changed),
            None,
            Change::Changed,
        )];
        let items = top_items(&zshrc);
        assert_eq!(items.len(), 1, "a lone .zshrc change is one shell item");
        assert_eq!(items[0].kind, FishyKind::Shell);
        assert_eq!(
            bounds_for(&zshrc, &[]).floor,
            Rating::KeepAnEye,
            "one pair signal alone looks"
        );
        let mut with_agent = zshrc.to_vec();
        with_agent.push(signal(
            SignalId::PersistenceNew,
            SignalValue::Int(1),
            Some(PreviousValue::Int(0)),
            Change::Changed,
        ));
        assert_eq!(
            bounds_for(&with_agent, &[]).floor,
            Rating::ActNow,
            "a shell file and a new launch agent are two listings"
        );
        let app_store = [
            signal(
                SignalId::AppSet,
                SignalValue::Change(Change::Changed),
                None,
                Change::Changed,
            ),
            signal(
                SignalId::AppNewUnquarantined,
                SignalValue::Int(1),
                Some(PreviousValue::Int(0)),
                Change::Changed,
            ),
        ];
        assert!(
            top_items(&app_store).is_empty(),
            "an unquarantined bundle alone makes no item"
        );
        assert_eq!(bounds_for(&app_store, &[]).floor, Rating::KeepAnEye);
        let mut unsigned = app_store.to_vec();
        unsigned.push(signal(
            SignalId::AppNewUnsigned,
            SignalValue::Int(1),
            Some(PreviousValue::Int(0)),
            Change::Changed,
        ));
        let items = top_items(&unsigned);
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].signal_id, SignalId::AppNewUnsigned);
        assert_eq!(items[0].kind, FishyKind::App);
        assert_eq!(bounds_for(&unsigned, &[]).floor, Rating::KeepAnEye);
        unsigned.push(signal(
            SignalId::PersistenceNew,
            SignalValue::Int(1),
            Some(PreviousValue::Int(0)),
            Change::Changed,
        ));
        assert_eq!(bounds_for(&unsigned, &[]).floor, Rating::ActNow);
        let library = [signal(
            SignalId::LibraryAppsCount,
            SignalValue::Int(17),
            Some(PreviousValue::Int(16)),
            Change::Changed,
        )];
        assert!(top_items(&library).is_empty());
        let airdrop = [signal(
            SignalId::AirdropEveryone,
            SignalValue::Bool(true),
            Some(PreviousValue::Bool(false)),
            Change::Changed,
        )];
        assert_eq!(top_items(&airdrop).len(), 1);
        assert_eq!(
            bounds_for(&airdrop, &[]),
            Bounds {
                floor: Rating::KeepAnEye,
                ceiling: Rating::KeepAnEye
            },
            "AirDrop Everyone alone never acts"
        );
        let root = [signal(
            SignalId::AuthenticatedRoot,
            SignalValue::Bool(false),
            Some(PreviousValue::Bool(true)),
            Change::Changed,
        )];
        assert_eq!(bounds_for(&root, &[]).floor, Rating::ActNow);
        let masquerade = [
            signal(
                SignalId::PersistenceSet,
                SignalValue::Change(Change::Changed),
                None,
                Change::Changed,
            ),
            signal(
                SignalId::PersistenceNew,
                SignalValue::Int(1),
                Some(PreviousValue::Int(0)),
                Change::Changed,
            ),
            signal(
                SignalId::LaunchLabelMasqueradeUnsigned,
                SignalValue::Int(1),
                Some(PreviousValue::Int(0)),
                Change::Changed,
            ),
        ];
        assert_eq!(bounds_for(&masquerade, &[]).floor, Rating::ActNow);
        assert_eq!(top_items(&masquerade).len(), 1, "one listing, one item");
    }

    #[test]
    fn hysteresis_rises_at_once_and_falls_after_two_cycles() {
        assert_eq!(
            apply_hysteresis(Rating::Calm, Rating::ActNow, 0),
            Hysteresis {
                rating: Rating::ActNow,
                calm_streak: 0
            }
        );
        assert_eq!(
            apply_hysteresis(Rating::ActNow, Rating::Calm, 0),
            Hysteresis {
                rating: Rating::ActNow,
                calm_streak: 1
            }
        );
        assert_eq!(
            apply_hysteresis(Rating::ActNow, Rating::Calm, 1),
            Hysteresis {
                rating: Rating::Calm,
                calm_streak: 0
            }
        );
        assert_eq!(
            apply_hysteresis(Rating::KeepAnEye, Rating::KeepAnEye, 1),
            Hysteresis {
                rating: Rating::KeepAnEye,
                calm_streak: 0
            }
        );
        assert_eq!(
            max_rating(Rating::Calm, Rating::KeepAnEye),
            Rating::KeepAnEye
        );
        assert_eq!(
            min_rating(Rating::ActNow, Rating::KeepAnEye),
            Rating::KeepAnEye
        );
    }
}
