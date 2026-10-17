import type { COVERAGE } from "./copy";

/**
 * "Experts call these": the MITRE ATT&CK tactics per group of the "What I watch" screen
 * (docs/DESIGN-THREATS-V2.md section 4a, row 5). MITRE's own vocabulary and spelling, quoted
 * as is, kept outside copy.ts so the banned-word walk never reads it.
 */
export const COVERAGE_EXPERTS: Readonly<Record<keyof typeof COVERAGE.groups, string>> = {
  firewalls: "Command and Control (TA0011), Lateral Movement (TA0008)",
  settings: "Defense Evasion (TA0005), Persistence (TA0003)",
  access: "Initial Access (TA0001), Privilege Escalation (TA0004), Credential Access (TA0006)",
  malware: "Execution (TA0002), Persistence (TA0003)",
  updates: "Impact (TA0040)",
};
