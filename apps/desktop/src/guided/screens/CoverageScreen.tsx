import { Fragment, useId } from "react";
import type { ProbeId, UnavailableProbe, WatchInterval } from "@talos/core";
import { useApp } from "../../app/context";
import { WATCH_PROBE_LABELS } from "../../app/labels";
import type { Router } from "../../app/router";
import { watchActive } from "../../app/gate";
import { useWatchController } from "../../watch/watch-controller";
import { COVERAGE_EXPERTS } from "../coverage-experts";
import { COVERAGE } from "../copy";
import { GuidedShell } from "../GuidedShell";

/**
 * "What I watch" (docs/DESIGN-THREATS-V2.md section 4a): every probe once, grouped by the five
 * Cyber Essentials controls, with the reason a probe could not be read in brackets, the authored
 * gaps, and the ATT&CK tactics under a disclosure. Nothing here runs anything.
 */

export type CoverageGroupKey = keyof typeof COVERAGE.groups;

/** Every PROBE_ID exactly once, in the order the screen draws them (Contract F). */
export const COVERAGE_GROUPS: Readonly<Record<CoverageGroupKey, readonly ProbeId[]>> = {
  firewalls: ["probe.firewall", "probe.listeners", "probe.hosts", "probe.network_config"],
  settings: ["probe.platform_integrity", "probe.malware_protection", "probe.lockdown_mode", "probe.shell_startup", "probe.profiles", "probe.system_extensions", "probe.scheduled_jobs", "probe.hooks"],
  access: ["probe.accounts", "probe.sudo_config", "probe.remote_access", "probe.file_sharing", "probe.exposure", "probe.ssh_keys", "probe.logins"],
  malware: ["probe.persistence", "probe.persistence_signatures", "probe.apps", "probe.app_signatures", "probe.library_apps"],
  updates: ["probe.updates", "probe.backup", "probe.host_metrics"],
};

/** Probes the full check runs a few times a day, never the sweep. */
export const OUTSIDE_SWEEP: readonly ProbeId[] = ["probe.library_apps"];

/** The two pseudo-rows: things the full check reads that are not a probe. */
export const LOGIN_ITEMS_ROW = "login items";
export const BROWSER_ADDONS_ROW = "browser add-ons";

export const COVERAGE_GROUP_KEYS: readonly CoverageGroupKey[] = ["firewalls", "settings", "access", "malware", "updates"];

export interface CoverageRow {
  readonly label: string;
  /** The bracketed note: a reason the probe could not be read, or "a few times a day"; null for a plain row. */
  readonly note: string | null;
}

export interface CoverageGroupModel {
  readonly key: CoverageGroupKey;
  readonly title: string;
  readonly rows: readonly CoverageRow[];
}

export type CoverageGap = keyof typeof COVERAGE.gaps;

export interface CoverageModel {
  readonly intro: string;
  /** The one link, licensed with the watch off. */
  readonly turnOn: boolean;
  readonly groups: readonly CoverageGroupModel[];
  readonly gaps: readonly CoverageGap[];
}

export interface CoverageInput {
  readonly licensed: boolean;
  readonly enabled: boolean;
  readonly everyMinutes: WatchInterval | number;
  readonly unavailable: readonly UnavailableProbe[];
  readonly signedBuild: boolean;
  readonly fullDiskAccess: boolean;
}

function intervalWord(everyMinutes: number): string {
  const words: Readonly<Record<number, string>> = COVERAGE.interval;
  return words[everyMinutes] ?? COVERAGE.interval[60];
}

function probeRow(probeId: ProbeId, unavailable: readonly UnavailableProbe[]): CoverageRow {
  const label = WATCH_PROBE_LABELS[probeId];
  const row = unavailable.find((entry) => entry.probeId === probeId);
  if (row !== undefined) return { label, note: COVERAGE.reason[row.reason] };
  return { label, note: OUTSIDE_SWEEP.includes(probeId) ? COVERAGE.fewTimesADay : null };
}

/** The whole screen as data, so the groups, the brackets and the gaps are testable without the DOM. */
export function coverageModel(input: CoverageInput): CoverageModel {
  const intro = !input.licensed ? COVERAGE.introUnlicensed : input.enabled ? COVERAGE.intro.replace("{interval}", intervalWord(input.everyMinutes)) : COVERAGE.introOff;
  const groups = COVERAGE_GROUP_KEYS.map((key): CoverageGroupModel => {
    const rows = COVERAGE_GROUPS[key].map((probeId) => probeRow(probeId, input.unavailable));
    if (key === "settings" && input.fullDiskAccess) rows.push({ label: BROWSER_ADDONS_ROW, note: COVERAGE.fewTimesADay });
    if (key === "malware") rows.push({ label: LOGIN_ITEMS_ROW, note: COVERAGE.fewTimesADay });
    return { key, title: COVERAGE.groups[key], rows };
  });
  const gaps = (Object.keys(COVERAGE.gaps) as CoverageGap[]).filter((gap) => (gap === "sockets" ? !input.signedBuild : gap === "browsers" ? !input.fullDiskAccess : true));
  return { intro, turnOn: input.licensed && !input.enabled, groups, gaps };
}

/** A signed build reads the socket table, so no probe reports unsigned_build. */
export function isSignedBuild(unavailable: readonly UnavailableProbe[]): boolean {
  return !unavailable.some((row) => row.reason === "unsigned_build");
}

/** Settings with the Watch section in view: App scrolls its own anchors, so the heading is found once Settings has drawn. */
export function openWatchSettings(router: Router): void {
  router.navigate({ name: "settings" });
  setTimeout(() => document.getElementById("watch-heading")?.scrollIntoView({ block: "start" }), 0);
}

export function CoverageScreen() {
  const { settings, gate, router, capabilities } = useApp();
  const watch = useWatchController();
  const state = watch.state;
  const model = coverageModel({
    licensed: !gate.watchLocked,
    enabled: state?.enabled ?? watchActive(settings, gate),
    everyMinutes: state?.everyMinutes ?? settings.watch.everyMinutes,
    unavailable: state?.unavailable ?? [],
    signedBuild: isSignedBuild(state?.unavailable ?? []),
    fullDiskAccess: capabilities?.fullDiskAccess === true,
  });
  const cannotId = useId();
  return (
    <div className="coverage">
      <p className="coverage-intro">{model.intro}</p>
      {model.turnOn && (
        <button type="button" className="guided-link coverage-turn-on" onClick={() => openWatchSettings(router)}>
          {COVERAGE.turnOn}
        </button>
      )}
      {model.groups.map((group) => (
        <section key={group.key} className="coverage-group" aria-labelledby={`coverage-${group.key}`}>
          <h2 id={`coverage-${group.key}`}>{group.title}</h2>
          <p>
            {group.rows.map((row, index) => (
              <Fragment key={row.label}>
                {index > 0 && <span className="coverage-dot" aria-hidden="true">{" · "}</span>}
                <span className="coverage-row">
                  {row.label}
                  {row.note !== null && <span className="coverage-reason"> ({row.note})</span>}
                </span>
              </Fragment>
            ))}
          </p>
        </section>
      ))}
      <section className="coverage-cannot" aria-labelledby={cannotId}>
        <h2 id={cannotId}>{COVERAGE.cannot}</h2>
        {model.gaps.map((gap) => (
          <p key={gap} className="coverage-gap">
            {COVERAGE.gaps[gap][0]} <span className="coverage-reason">{COVERAGE.gaps[gap][1]}</span>
          </p>
        ))}
      </section>
      <details className="coverage-experts">
        <summary>{COVERAGE.experts}</summary>
        <ul className="coverage-experts-list">
          {COVERAGE_GROUP_KEYS.map((key) => (
            <li key={key}>
              <span className="coverage-experts-group">{COVERAGE.groups[key]}</span> {COVERAGE_EXPERTS[key]}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/** The route: the shell with the title and one strip link, Back, which pops to where it was opened from. */
export function CoverageRoute() {
  const { router } = useApp();
  return (
    <GuidedShell title={COVERAGE.title} inactive={false} strip={{ links: [{ label: COVERAGE.back, onClick: () => router.back() }] }}>
      <CoverageScreen />
    </GuidedShell>
  );
}

/** Every probe id in the order drawn; the test pins it to PROBE_IDS as a set. */
export const COVERED_PROBE_IDS: readonly ProbeId[] = COVERAGE_GROUP_KEYS.flatMap((key) => COVERAGE_GROUPS[key]);
