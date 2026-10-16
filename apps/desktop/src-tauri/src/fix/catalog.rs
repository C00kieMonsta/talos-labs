//! The command table. Every literal is checked against a pattern by a test; the webview picks a row, never a string.

use serde::Serialize;

use crate::state::SectionKey;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Privilege {
    User,
    Admin,
}

/// Binaries the fix engine may run. Separate from exec::Bin so collectors cannot name them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FixBin {
    Socketfilterfw,
    Defaults,
    Sysadminctl,
    Sharing,
    Launchctl,
    Kickstart,
    Chmod,
    SshKeygen,
}

impl FixBin {
    pub const ALL: [FixBin; 8] = [
        FixBin::Socketfilterfw,
        FixBin::Defaults,
        FixBin::Sysadminctl,
        FixBin::Sharing,
        FixBin::Launchctl,
        FixBin::Kickstart,
        FixBin::Chmod,
        FixBin::SshKeygen,
    ];

    pub fn path(self) -> &'static str {
        match self {
            FixBin::Socketfilterfw => "/usr/libexec/ApplicationFirewall/socketfilterfw",
            FixBin::Defaults => "/usr/bin/defaults",
            FixBin::Sysadminctl => "/usr/sbin/sysadminctl",
            FixBin::Sharing => "/usr/sbin/sharing",
            FixBin::Launchctl => "/bin/launchctl",
            FixBin::Kickstart => {
                "/System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart"
            }
            FixBin::Chmod => "/bin/chmod",
            FixBin::SshKeygen => "/usr/bin/ssh-keygen",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Arg {
    Lit(&'static str),
    /// 022: the share name bound from Rust's own `sharing -l -f json` listing.
    ShareName,
    /// 029, 030: a key path from Rust's own `ssh::scan_keys` listing.
    KeyPath,
    /// 030: `$HOME/.ssh`, computed.
    SshDir,
    /// 029: zero or two tokens from the bound key's format.
    KeyFormatFlags,
}

impl Arg {
    /// The placeholder shown in plan lines and the JSON dump.
    pub fn placeholder(self) -> &'static str {
        match self {
            Arg::Lit(text) => text,
            Arg::ShareName => "<share>",
            Arg::KeyPath => "<key>",
            Arg::SshDir => "<~/.ssh>",
            Arg::KeyFormatFlags => "<format>",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Step {
    pub bin: FixBin,
    pub args: &'static [Arg],
    pub privilege: Privilege,
    /// An exit status that still counts as success (launchctl bootout exits 3 when the service is not loaded).
    pub tolerate_exit: Option<i32>,
    /// Run once per bound path (chmod 600 per key) rather than once.
    pub per_key: bool,
}

const fn admin(bin: FixBin, args: &'static [Arg]) -> Step {
    Step {
        bin,
        args,
        privilege: Privilege::Admin,
        tolerate_exit: None,
        per_key: false,
    }
}

const fn user(bin: FixBin, args: &'static [Arg]) -> Step {
    Step {
        bin,
        args,
        privilege: Privilege::User,
        tolerate_exit: None,
        per_key: false,
    }
}

/// What the webview must pick before a plan can be built.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Choice {
    None,
    Share,
    SshKey,
    AllSshKeys,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Secret {
    None,
    NewPassphrase,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reversible {
    InApp(&'static str),
    InSettings(&'static str),
    No,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Precondition {
    RemoteManagementOff,
}

/// A read-only command run at preview time. Never admin.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Read {
    pub bin: FixBin,
    pub args: &'static [Arg],
}

#[derive(Debug, Clone, Copy)]
pub struct FixSpec {
    pub rule: &'static str,
    pub steps: &'static [Step],
    pub choice: Choice,
    pub secret: Secret,
    pub precondition: Option<Precondition>,
    pub reversible: Reversible,
    pub recheck: &'static [SectionKey],
    /// 013: a read-only user-level command run at preview; its digits become `FixPlan.previous`.
    pub previous: Option<Read>,
    /// Documentation and test oracle, e.g. "firewall.enabled == true".
    pub expect: &'static str,
}

impl FixSpec {
    pub fn needs_password(&self) -> bool {
        self.steps.iter().any(|s| s.privilege == Privilege::Admin)
    }

    pub fn needs_passphrase(&self) -> bool {
        self.secret == Secret::NewPassphrase
    }

    pub fn reversible_text(&self) -> Option<&'static str> {
        match self.reversible {
            Reversible::InApp(text) | Reversible::InSettings(text) => Some(text),
            Reversible::No => None,
        }
    }
}

const SU: &str = "/Library/Preferences/com.apple.SoftwareUpdate";
const FIREWALL: &[SectionKey] = &[SectionKey::Firewall];
const UPDATES: &[SectionKey] = &[SectionKey::Updates];
const ACCOUNTS: &[SectionKey] = &[SectionKey::Accounts];
const REMOTE: &[SectionKey] = &[SectionKey::RemoteAccess, SectionKey::Listeners];
const SSH: &[SectionKey] = &[SectionKey::Ssh];

const fn plain(
    rule: &'static str,
    steps: &'static [Step],
    reversible: Reversible,
    recheck: &'static [SectionKey],
    expect: &'static str,
) -> FixSpec {
    FixSpec {
        rule,
        steps,
        choice: Choice::None,
        secret: Secret::None,
        precondition: None,
        reversible,
        recheck,
        previous: None,
        expect,
    }
}

pub static FIX_CATALOG: &[FixSpec] = &[
    plain(
        "TL-MAC-002",
        &[admin(
            FixBin::Socketfilterfw,
            &[Arg::Lit("--setglobalstate"), Arg::Lit("on")],
        )],
        Reversible::InApp("/usr/libexec/ApplicationFirewall/socketfilterfw --setglobalstate off"),
        FIREWALL,
        "firewall.enabled == true",
    ),
    plain(
        "TL-MAC-003",
        &[admin(
            FixBin::Socketfilterfw,
            &[Arg::Lit("--setstealthmode"), Arg::Lit("on")],
        )],
        Reversible::InApp("/usr/libexec/ApplicationFirewall/socketfilterfw --setstealthmode off"),
        FIREWALL,
        "firewall.stealthMode == true",
    ),
    plain(
        "TL-MAC-007",
        &[
            admin(
                FixBin::Defaults,
                &[
                    Arg::Lit("write"),
                    Arg::Lit(SU),
                    Arg::Lit("AutomaticCheckEnabled"),
                    Arg::Lit("-bool"),
                    Arg::Lit("true"),
                ],
            ),
            admin(
                FixBin::Defaults,
                &[
                    Arg::Lit("write"),
                    Arg::Lit(SU),
                    Arg::Lit("AutomaticDownload"),
                    Arg::Lit("-bool"),
                    Arg::Lit("true"),
                ],
            ),
        ],
        Reversible::InSettings("System Settings > General > Software Update > Automatic Updates"),
        UPDATES,
        "updates.automaticCheck == true && updates.automaticDownload == true",
    ),
    plain(
        "TL-MAC-008",
        &[admin(
            FixBin::Defaults,
            &[
                Arg::Lit("write"),
                Arg::Lit(SU),
                Arg::Lit("AutomaticallyInstallMacOSUpdates"),
                Arg::Lit("-bool"),
                Arg::Lit("true"),
            ],
        )],
        Reversible::InSettings("System Settings > General > Software Update > Automatic Updates"),
        UPDATES,
        "updates.automaticallyInstallMacOSUpdates == true",
    ),
    plain(
        "TL-MAC-009",
        &[
            admin(
                FixBin::Defaults,
                &[
                    Arg::Lit("write"),
                    Arg::Lit(SU),
                    Arg::Lit("ConfigDataInstall"),
                    Arg::Lit("-bool"),
                    Arg::Lit("true"),
                ],
            ),
            admin(
                FixBin::Defaults,
                &[
                    Arg::Lit("write"),
                    Arg::Lit(SU),
                    Arg::Lit("CriticalUpdateInstall"),
                    Arg::Lit("-bool"),
                    Arg::Lit("true"),
                ],
            ),
        ],
        Reversible::InSettings("System Settings > General > Software Update > Automatic Updates"),
        UPDATES,
        "updates.configDataInstall == true && updates.criticalUpdateInstall == true",
    ),
    plain(
        "TL-MAC-011",
        &[admin(
            FixBin::Defaults,
            &[
                Arg::Lit("write"),
                Arg::Lit("/Library/Preferences/com.apple.commerce"),
                Arg::Lit("AutoUpdate"),
                Arg::Lit("-bool"),
                Arg::Lit("true"),
            ],
        )],
        Reversible::InSettings("App Store > Settings > Automatic Updates"),
        UPDATES,
        "updates.appStoreAutoUpdate == true",
    ),
    FixSpec {
        rule: "TL-MAC-013",
        steps: &[user(
            FixBin::Defaults,
            &[
                Arg::Lit("-currentHost"),
                Arg::Lit("write"),
                Arg::Lit("com.apple.screensaver"),
                Arg::Lit("idleTime"),
                Arg::Lit("-int"),
                Arg::Lit("1200"),
            ],
        )],
        choice: Choice::None,
        secret: Secret::None,
        precondition: None,
        reversible: Reversible::InApp(
            "/usr/bin/defaults -currentHost write com.apple.screensaver idleTime -int <previous>",
        ),
        recheck: &[SectionKey::ScreenLock],
        previous: Some(Read {
            bin: FixBin::Defaults,
            args: &[
                Arg::Lit("-currentHost"),
                Arg::Lit("read"),
                Arg::Lit("com.apple.screensaver"),
                Arg::Lit("idleTime"),
            ],
        }),
        expect: "screenLock.idleTimeSeconds <= 1200",
    },
    plain(
        "TL-MAC-015",
        &[admin(
            FixBin::Sysadminctl,
            &[Arg::Lit("-guestAccount"), Arg::Lit("off")],
        )],
        Reversible::InApp("/usr/sbin/sysadminctl -guestAccount on"),
        ACCOUNTS,
        "accounts.guestEnabled == false",
    ),
    plain(
        "TL-MAC-016",
        &[admin(
            FixBin::Sysadminctl,
            &[Arg::Lit("-autologin"), Arg::Lit("off")],
        )],
        Reversible::InSettings("System Settings > Users & Groups > Automatic login"),
        ACCOUNTS,
        "accounts.autoLoginUser == null",
    ),
    plain(
        "TL-MAC-019",
        &[
            admin(
                FixBin::Launchctl,
                &[Arg::Lit("disable"), Arg::Lit("system/com.openssh.sshd")],
            ),
            Step {
                tolerate_exit: Some(3),
                ..admin(
                    FixBin::Launchctl,
                    &[Arg::Lit("bootout"), Arg::Lit("system/com.openssh.sshd")],
                )
            },
        ],
        Reversible::InSettings("System Settings > General > Sharing > Remote Login"),
        REMOTE,
        "remoteAccess.ssh.serviceLoaded == false",
    ),
    FixSpec {
        precondition: Some(Precondition::RemoteManagementOff),
        ..plain(
            "TL-MAC-020",
            &[
                admin(
                    FixBin::Launchctl,
                    &[
                        Arg::Lit("disable"),
                        Arg::Lit("system/com.apple.screensharing"),
                    ],
                ),
                Step {
                    tolerate_exit: Some(3),
                    ..admin(
                        FixBin::Launchctl,
                        &[
                            Arg::Lit("bootout"),
                            Arg::Lit("system/com.apple.screensharing"),
                        ],
                    )
                },
            ],
            Reversible::InSettings("System Settings > General > Sharing > Screen Sharing"),
            REMOTE,
            "remoteAccess.screenSharing.serviceLoaded == false",
        )
    },
    plain(
        "TL-MAC-021",
        &[admin(
            FixBin::Kickstart,
            &[
                Arg::Lit("-deactivate"),
                Arg::Lit("-configure"),
                Arg::Lit("-access"),
                Arg::Lit("-off"),
            ],
        )],
        Reversible::InSettings("System Settings > General > Sharing > Remote Management"),
        REMOTE,
        "remoteAccess.remoteManagement.serviceLoaded == false",
    ),
    FixSpec {
        choice: Choice::Share,
        ..plain(
            "TL-MAC-022",
            &[admin(
                FixBin::Sharing,
                &[
                    Arg::Lit("-e"),
                    Arg::ShareName,
                    Arg::Lit("-g"),
                    Arg::Lit("000"),
                ],
            )],
            Reversible::InSettings("System Settings > General > Sharing > File Sharing"),
            &[SectionKey::FileSharing, SectionKey::Listeners],
            "fileSharing.shares[path].guestAccess == false",
        )
    },
    FixSpec {
        choice: Choice::SshKey,
        secret: Secret::NewPassphrase,
        ..plain(
            "TL-MAC-029",
            &[user(
                FixBin::SshKeygen,
                &[
                    Arg::Lit("-p"),
                    Arg::KeyFormatFlags,
                    Arg::Lit("-f"),
                    Arg::KeyPath,
                ],
            )],
            Reversible::No,
            SSH,
            "ssh.keys[path].encrypted == true",
        )
    },
    FixSpec {
        choice: Choice::AllSshKeys,
        ..plain(
            "TL-MAC-030",
            &[
                user(FixBin::Chmod, &[Arg::Lit("700"), Arg::SshDir]),
                Step {
                    per_key: true,
                    ..user(FixBin::Chmod, &[Arg::Lit("600"), Arg::KeyPath])
                },
            ],
            Reversible::InApp("/bin/chmod <previous mode> <path>, recorded in the plan"),
            SSH,
            "ssh.dirMode == 700 && every ssh.keys[].mode == 600",
        )
    },
];

pub fn spec_for(rule: &str) -> Option<&'static FixSpec> {
    FIX_CATALOG.iter().find(|spec| spec.rule == rule)
}

/// Which catalog rows may join a batch: no choice to make, no secret, no pty.
/// 002, 003, 007, 008, 009, 011, 013, 015, 016, 019, 020, 021, 030. A test pins the set.
pub fn batchable(spec: &FixSpec) -> bool {
    matches!(spec.choice, Choice::None | Choice::AllSshKeys) && spec.secret == Secret::None
}

/// The tokens `KeyFormatFlags` can expand to, keyed by format.
pub const KEY_FORMAT_FLAGS: [(&str, &[&str]); 3] = [
    ("openssh", &[]),
    ("pem", &["-m", "PEM"]),
    ("pkcs8", &["-m", "PKCS8"]),
];

/// The table as JSON: rule, lines with placeholders, privilege, choice, needsPassword, needsPassphrase, recheck.
pub fn dump_json() -> String {
    let entries: Vec<serde_json::Value> = FIX_CATALOG
        .iter()
        .map(|spec| {
            let lines: Vec<serde_json::Value> = spec
                .steps
                .iter()
                .map(|step| {
                    let text = std::iter::once(step.bin.path()).chain(step.args.iter().map(|a| a.placeholder())).collect::<Vec<_>>().join(" ");
                    serde_json::json!({ "text": text, "privilege": step.privilege, "tolerateExit": step.tolerate_exit, "perKey": step.per_key })
                })
                .collect();
            serde_json::json!({
                "rule": spec.rule,
                "lines": lines,
                "choice": spec.choice,
                "needsPassword": spec.needs_password(),
                "needsPassphrase": spec.needs_passphrase(),
                "recheck": spec.recheck.iter().map(|k| k.as_str()).collect::<Vec<_>>(),
                "reversible": spec.reversible_text(),
                "expect": spec.expect,
                "batchable": batchable(spec),
            })
        })
        .collect();
    serde_json::to_string_pretty(&entries).unwrap_or_else(|_| "[]".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    const LITERAL: &str = r"^[A-Za-z0-9._/:=+-]+$";

    #[test]
    fn every_literal_matches_the_pattern_and_every_binary_exists() {
        let lit = regex::Regex::new(LITERAL).unwrap();
        for spec in FIX_CATALOG {
            for step in spec.steps {
                for arg in step.args {
                    if let Arg::Lit(text) = arg {
                        assert!(lit.is_match(text), "{}: {text:?}", spec.rule);
                    }
                }
            }
            if let Some(read) = spec.previous {
                assert_eq!(read.bin, FixBin::Defaults);
                for arg in read.args {
                    let Arg::Lit(text) = arg else {
                        panic!("{}: previous reads take literals only", spec.rule)
                    };
                    assert!(lit.is_match(text), "{}: {text:?}", spec.rule);
                }
            }
        }
        for (_, tokens) in KEY_FORMAT_FLAGS {
            for token in tokens {
                assert!(lit.is_match(token), "{token:?}");
            }
        }
        for bin in FixBin::ALL {
            assert!(std::path::Path::new(bin.path()).exists(), "{}", bin.path());
        }
    }

    #[test]
    fn rules_are_unique_and_slots_match_choices() {
        let mut rules: Vec<_> = FIX_CATALOG.iter().map(|s| s.rule).collect();
        rules.sort_unstable();
        rules.dedup();
        assert_eq!(rules.len(), FIX_CATALOG.len());
        for spec in FIX_CATALOG {
            let args: Vec<Arg> = spec
                .steps
                .iter()
                .flat_map(|s| s.args.iter().copied())
                .collect();
            let has = |needle: Arg| args.contains(&needle);
            match spec.choice {
                Choice::None => {
                    assert!(!has(Arg::ShareName) && !has(Arg::KeyPath), "{}", spec.rule)
                }
                Choice::Share => assert!(has(Arg::ShareName), "{}", spec.rule),
                Choice::SshKey => assert!(
                    has(Arg::KeyPath) && has(Arg::KeyFormatFlags),
                    "{}",
                    spec.rule
                ),
                Choice::AllSshKeys => {
                    assert!(has(Arg::KeyPath) && has(Arg::SshDir), "{}", spec.rule)
                }
            }
            for step in spec.steps {
                assert!(
                    !step.per_key || step.args.contains(&Arg::KeyPath),
                    "{}: per_key needs KeyPath",
                    spec.rule
                );
            }
        }
        assert!(spec_for("TL-MAC-002").is_some());
        assert!(spec_for("TL-MAC-001").is_none());
    }

    #[test]
    fn batchable_is_the_thirteen_rule_set() {
        let set: Vec<&str> = FIX_CATALOG
            .iter()
            .filter(|s| batchable(s))
            .map(|s| s.rule)
            .collect();
        assert_eq!(
            set,
            [
                "TL-MAC-002",
                "TL-MAC-003",
                "TL-MAC-007",
                "TL-MAC-008",
                "TL-MAC-009",
                "TL-MAC-011",
                "TL-MAC-013",
                "TL-MAC-015",
                "TL-MAC-016",
                "TL-MAC-019",
                "TL-MAC-020",
                "TL-MAC-021",
                "TL-MAC-030",
            ]
        );
        assert!(!batchable(spec_for("TL-MAC-022").unwrap()));
        assert!(!batchable(spec_for("TL-MAC-029").unwrap()));
        let dump: serde_json::Value = serde_json::from_str(&dump_json()).unwrap();
        assert_eq!(dump[0]["batchable"], true);
    }
}
