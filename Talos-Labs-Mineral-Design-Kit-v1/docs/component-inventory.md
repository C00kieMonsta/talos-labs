# Component inventory and application scope

## Guided (primary — v0.3)

Welcome, expanded Reads / Never reads, automatic 17-area scanning, stopped state, since-last-time, plan and expanded list, single fix, batch confirmation, batch working, batch success, show-me-where, watching, backup question, just-in-time browser permission, paywall, partial end, and clean end. A sample of these states is available in the interactive study.

Component set: `GuidedHeader`, `Progress`, `PrimaryAction`, `SecondaryLink`, `RuleList`, `StatusLine`, `PermissionInstructions`, `LicenceKeyField`, `EndSummary`, `AIExplainDisclosure`, `ScanRow`.

Required implementation variants beyond these representative studies: batch partial/cancel/wrong password/timeout; single fix failed and still-failing; watcher stale, passed and expired; reopen-needed permission, permission denied; paywall key valid/invalid; AI writing, failed and unavailable; reduced motion and developer disclosures.

## Detailed (secondary — v0.2)

Overview and score card; Findings groups and filters; Finding detail, evidence and fix cards; Ask; Settings. Their states and exact copy should remain aligned with the full product source. App preview provides representative Overview, Findings, detail, Ask and Settings. Do not introduce unrelated permission requests during Welcome.

## CSS rules

- Native shell: 1100×760 default, 900×600 minimum, toolbar 52 px.
- Guided content: one column, maximum 560 px, top padding 72 px (responsive at 600 px height).
- Expert sidebar: 220 px; content scroll only.
- Type: native macOS sizes for expert screens (13 pt body), 26/17/16/14 pt guided.
- Buttons: 44 px guided; max one primary per step.
- Always show unknown readings as *Couldn't check*. Incomplete score is explicitly labelled.
- Status must have a word and icon; accent cannot double as severity.
- Use macOS native privilege dialogs, never a fake password field.
- AI claims are on-device, optional and labelled *Not verified*.
