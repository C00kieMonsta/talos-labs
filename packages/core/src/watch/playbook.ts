import type { RuleId, SettingsPane } from "../domain/finding";
import type { ActionId, Rating, SignalId, WatchActionId } from "../ports/watch-port";
import { GATED_SIGNALS, PAIR_SIGNALS, STAND_ALONE_SIGNALS } from "./signals";

/**
 * The playbook catalogue from docs/DESIGN-WATCH.md section 4. Every suggested action is a row
 * here and nowhere else. Rust watch/playbook.rs holds the same rows; fixtures/playbook.json pins both.
 */

export type PlaybookSource =
  | "N3"
  | "N2"
  | "C-SR"
  | "C-MC"
  | "C-TR"
  | "S-HB"
  | "S-504"
  | "NCSC"
  | "A-PSG"
  | "A-ACCT"
  | "A-PS1"
  | "A-PS-ACCT"
  | "A-PS-LDM"
  | "A-LDM"
  | "A-LOGIN"
  | "CIS";

export type PlaybookKind =
  | { readonly kind: "fix"; readonly spec: RuleId | WatchActionId }
  | { readonly kind: "pane"; readonly pane: SettingsPane }
  | { readonly kind: "reveal"; readonly rule: "TL-MAC-023" | "TL-MAC-024" }
  | { readonly kind: "recheck" }
  | { readonly kind: "advise" };

export interface PlaybookAction {
  readonly id: ActionId;
  readonly source: PlaybookSource;
  /** Source name and step number only, e.g. "CISA #StopRansomware v3.0, Part 2, step 1". */
  readonly step: string;
  /** Opened only from Details, from Rust, by action id. */
  readonly url: string;
  readonly kind: PlaybookKind;
  /** The lowest rating at which the row may be suggested. */
  readonly floor: Rating;
  /** The AI-off map; also the validator's relevance check. */
  readonly triggers: readonly SignalId[];
  /** Authored, under the banned-word test. */
  readonly title: string;
  /** One authored sentence paraphrasing the step. */
  readonly whatExpertsDo: string;
  /** The PICERL phase word, shown under Details. */
  readonly phase: string;
  /** The NIST SP 800-61 Rev. 3 outcome id, shown under Details. */
  readonly outcome: string;
}

export const PLAYBOOK_URLS: Readonly<Record<PlaybookSource, string>> = {
  N3: "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-61r3.pdf",
  N2: "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-61r2.pdf",
  "C-SR": "https://www.cisa.gov/sites/default/files/2025-03/StopRansomware-Guide%20508.pdf",
  "C-MC": "https://www.cisa.gov/news-events/news/protecting-against-malicious-code",
  "C-TR": "https://www.cisa.gov/sites/default/files/publications/trojan-recovery.pdf",
  "S-HB": "https://www.sans.org/white-papers/33901/",
  "S-504": "https://www.sans.org/media/score/504-incident-response-cycle.pdf",
  NCSC: "https://www.ncsc.gov.uk/guidance/mitigating-malware-and-ransomware-attacks",
  "A-PSG": "https://support.apple.com/guide/security/protecting-against-malware-sec469d47bd8/web",
  "A-ACCT": "https://support.apple.com/en-us/102560",
  "A-PS1": "https://support.apple.com/guide/personal-safety/checklist-1-limit-device-and-account-access-ipsb8deced49/web",
  "A-PS-ACCT": "https://support.apple.com/guide/personal-safety/keep-your-apple-account-secure-ips7d5628cc5/web",
  "A-PS-LDM": "https://support.apple.com/guide/personal-safety/harden-your-devices-with-lockdown-mode-ipsd5baf79d0/web",
  "A-LDM": "https://support.apple.com/en-us/105120",
  "A-LOGIN": "https://support.apple.com/guide/mac-help/change-login-items-extensions-settings-mtusr003/mac",
  CIS: "https://www.cisecurity.org/benchmark/apple_os",
};

/** Every signal that can put the watch into act now. */
const ALARM: readonly SignalId[] = [...STAND_ALONE_SIGNALS, ...GATED_SIGNALS, ...PAIR_SIGNALS];

const PERSISTENCE: readonly SignalId[] = [
  "sig.persistence_set",
  "sig.persistence_new",
  "sig.persistence_unsigned",
  "sig.persistence_in_temp_or_hidden",
  "sig.helper_tools_count",
  "sig.login_items_count",
  "sig.cron_lines",
  "sig.at_jobs",
  "sig.legacy_startup_count",
  "sig.launch_label_masquerade",
  "sig.launch_label_masquerade_unsigned",
];

const APPS: readonly SignalId[] = ["sig.app_set", "sig.app_new_unquarantined", "sig.app_new_unsigned", "sig.library_apps_count"];

const REMOTE: readonly SignalId[] = ["sig.remote_access_on", "sig.authorized_keys_changed", "sig.sshd_config_changed", "sig.remote_logins"];

const GUARDS: readonly SignalId[] = ["sig.gatekeeper", "sig.sip", "sig.xprotect_present", "sig.xprotect_scans_enabled", "sig.xprotect_version", "sig.boot_args_set"];

function row(
  id: ActionId,
  source: PlaybookSource,
  step: string,
  kind: PlaybookKind,
  floor: Rating,
  triggers: readonly SignalId[],
  title: string,
  whatExpertsDo: string,
  phase: string,
  outcome: string,
): PlaybookAction {
  return { id, source, step, url: PLAYBOOK_URLS[source], kind, floor, triggers, title, whatExpertsDo, phase, outcome };
}

/** The 26 rows in section 4 order, then the two CIS rows of DESIGN-THREATS-V2 section 6. */
export const PLAYBOOK: readonly PlaybookAction[] = [
  row("act.disconnect_network", "C-SR", "CISA #StopRansomware v3.0, Part 2, step 1", { kind: "fix", spec: "watch.wifi_off" }, "act_now", ALARM, "Cut it off from the internet", "Experts cut the machine off from the network first, before anything else.", "containment", "RS.MI-01"),
  row("act.block_incoming", "C-SR", "CISA #StopRansomware v3.0, Part 2, step 1", { kind: "fix", spec: "watch.block_incoming" }, "act_now", ALARM, "Block incoming connections", "When the cable cannot be pulled, experts stop what the machine accepts from the network.", "containment", "RS.MI-01"),
  row("act.do_not_power_off", "C-SR", "CISA #StopRansomware v3.0, Part 2, step 2", { kind: "advise" }, "act_now", ALARM, "Keep the Mac running", "Experts keep the machine on so the trace of what happened is not lost.", "containment", "RS.AN-07"),
  row("act.note_what_you_saw", "N2", "NIST SP 800-61 (2012 edition), section 3.3.2", { kind: "advise" }, "keep_an_eye", ALARM, "Write down what you saw", "Experts note what they saw and when, and delete nothing.", "containment", "RS.AN-07"),
  row("act.do_not_wait", "N2", "NIST SP 800-61 (2012 edition), section 3.3.1", { kind: "advise" }, "act_now", ALARM, "Do not wait", "Experts say a delay lets an attacker go further.", "containment", "RS.MI-01"),
  row("act.stop_background_program", "C-SR", "CISA #StopRansomware v3.0, Part 2, step 11", { kind: "fix", spec: "watch.stop_user_agent" }, "act_now", ["sig.persistence_set", "sig.persistence_new", "sig.persistence_unsigned", "sig.persistence_in_temp_or_hidden", "sig.listener_new_ports"], "Stop the program", "Experts stop the program from running and keep the file for a closer look.", "eradication", "RS.MI-01"),
  row("act.review_background_programs", "N3", "NIST SP 800-61 (2025), RS.MI-02", { kind: "pane", pane: "login_items" }, "keep_an_eye", [...PERSISTENCE, ...APPS], "Keep it from starting again", "Experts remove the entry that starts the program, then check the list again.", "eradication", "RS.MI-02"),
  row("act.turn_off_remote_access", "C-SR", "CISA #StopRansomware v3.0, Part 2, step 13", { kind: "fix", spec: "TL-MAC-019" }, "keep_an_eye", REMOTE, "Turn off remote access", "Experts close the ways in from outside before cleaning up.", "containment", "RS.MI-02"),
  row("act.stop_guest_sharing", "N3", "NIST SP 800-61 (2025), RS.MI-02", { kind: "fix", spec: "TL-MAC-022" }, "keep_an_eye", ["sig.guest_share", "sig.share_count"], "Stop guest sharing", "Experts close shared folders that anyone can reach.", "eradication", "RS.MI-02"),
  row("act.turn_on_firewall", "N2", "NIST SP 800-61 (2012 edition), section 3.3.4", { kind: "fix", spec: "TL-MAC-002" }, "keep_an_eye", ["sig.firewall"], "Turn the firewall on", "Experts tighten what the machine accepts from the network.", "recovery", "RC"),
  row("act.turn_on_builtin_protection", "A-PSG", "Apple Platform Security, Protecting against malware in macOS", { kind: "pane", pane: "security" }, "keep_an_eye", GUARDS, "Turn built-in protection back on", "Experts make sure the Mac's own protection is on before anything else.", "recovery", "RC"),
  row("act.report", "C-SR", "CISA #StopRansomware v3.0, Part 2, step 7", { kind: "advise" }, "keep_an_eye", ALARM, "Tell someone", "Experts tell the police, a cyber security centre, or their IT person.", "identification", "RS.CO-03"),
  row("act.change_passwords", "C-SR", "CISA #StopRansomware v3.0, Part 2, step 17", { kind: "advise" }, "act_now", ALARM, "Change your passwords", "Experts change passwords once the machine is clean, from another device.", "recovery", "RC"),
  row("act.review_apple_account_devices", "A-ACCT", "Apple, If you think your Apple Account has been compromised", { kind: "advise" }, "act_now", ALARM, "Check your Apple Account devices", "Experts remove any device they do not know from the account.", "recovery", "RC"),
  row("act.turn_on_2fa", "A-ACCT", "Apple, If you think your Apple Account has been compromised", { kind: "advise" }, "act_now", ALARM, "Turn on two-factor sign-in", "Experts add a second step to signing in.", "recovery", "RC"),
  row("act.scan_or_reinstall", "C-TR", "CISA, Recovering from a Trojan Horse or Virus, steps 4 and 5", { kind: "advise" }, "act_now", ALARM, "Wipe and reinstall if unsure", "Experts wipe the Mac and reinstall macOS when cleaning cannot be trusted.", "eradication", "RS.MI-02"),
  row("act.check_backup_before_restore", "N3", "NIST SP 800-61 (2025), RC.RP-03", { kind: "pane", pane: "time_machine" }, "act_now", ALARM, "Check a backup before restoring", "Experts restore only from a backup made before the trouble, and check it first.", "recovery", "RC.RP-03"),
  row("act.update_now", "N2", "NIST SP 800-61 (2012 edition), section 3.3.4", { kind: "pane", pane: "software_update" }, "keep_an_eye", [...ALARM, "sig.pending_updates"], "Install the update", "Experts install waiting updates so the same way in is closed.", "recovery", "RC"),
  row("act.do_not_pay", "C-SR", "CISA #StopRansomware v3.0, Part 2", { kind: "advise" }, "act_now", ALARM, "Do not pay", "Experts say paying gives no guarantee of getting anything back.", "containment", "RS.MI-01"),
  row("act.lockdown_mode", "A-LDM", "Apple, About Lockdown Mode", { kind: "advise" }, "keep_an_eye", [...ALARM, "sig.lockdown_mode"], "Consider Lockdown Mode", "Apple offers it for the very few people who may be singled out.", "recovery", "RC"),
  row("act.reconnect_and_watch", "N2", "NIST SP 800-61 (2012 edition), section 3.3.4", { kind: "fix", spec: "watch.wifi_on" }, "keep_an_eye", ALARM, "Turn Wi-Fi back on", "Experts plug back in and watch the machine more closely for a while.", "recovery", "RC.RP-04"),
  row("act.lessons_learned", "N2", "NIST SP 800-61 (2012 edition), section 3.4.1", { kind: "advise" }, "keep_an_eye", ALARM, "Look back at what happened", "Experts look back within two weeks at what to watch for next time.", "lessons learned", "ID.IM"),
  row("act.run_full_checkup", "N3", "NIST SP 800-61 (2025), DE.CM-09", { kind: "recheck" }, "keep_an_eye", ALARM, "Run a full check-up", "Experts check the whole machine against what it looked like before.", "identification", "DE.CM-09"),
  row("act.get_help", "C-TR", "CISA, Recovering from a Trojan Horse or Virus, step 1", { kind: "advise" }, "keep_an_eye", [...ALARM, "sig.path_dir_writable_count", "sig.library_apps_count"], "Get help", "Experts call the people whose job it is: Apple Support, a repair shop, or IT.", "identification", "RS.CO-03"),
  row("act.limit_airdrop", "CIS", "Apple macOS 26 Benchmark, section 2.3.1.1", { kind: "pane", pane: "airdrop" }, "keep_an_eye", ["sig.airdrop_everyone"], "Limit AirDrop to people you know", "Experts set AirDrop to Contacts Only, so no one nearby can push files to the Mac.", "containment", "RS.MI-02"),
  row("act.stop_internet_sharing", "CIS", "Apple macOS 26 Benchmark, section 2.3.3.7", { kind: "pane", pane: "sharing" }, "keep_an_eye", ["sig.internet_sharing_on"], "Turn Internet Sharing off", "Experts turn Internet Sharing off unless the Mac is meant to hand out its connection.", "containment", "RS.MI-02"),
];

export function playbookRow(id: ActionId): PlaybookAction | undefined {
  return PLAYBOOK.find((r) => r.id === id);
}

/** The JSON written to packages/core/fixtures/playbook.json. Keys stay in declaration order. */
export function playbookJson(): string {
  return `${JSON.stringify(PLAYBOOK, null, 2)}\n`;
}
