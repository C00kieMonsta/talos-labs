import { useRef } from "react";
import type { ScanReport, SectionKey } from "@talos/core";
import { SECTION_KEYS } from "@talos/core";
import { ICONS, SECTION_ICONS } from "../app/icons";
import { SECTION_LABELS, SECTION_PROGRESS_LABELS } from "../app/labels";
import { Icon } from "../components/Icon";
import { GUIDED_SECTION_LABELS } from "../guided/copy";
import type { PacerView, RowState } from "../scan/useScanPacer";

export const PROMPTING_ROW_COPY = "macOS is asking whether Talos Labs may read your login items";
export const PREPARING_COPY = "Preparing your report";

const CHECKPOINTS = new Set([6, 12, SECTION_KEYS.length]);

/** fail and review counts per section, attributed to the first required section. */
function countsFor(report: ScanReport | null): Record<SectionKey, { fail: number; review: number }> {
  const out = {} as Record<SectionKey, { fail: number; review: number }>;
  for (const key of SECTION_KEYS) out[key] = { fail: 0, review: 0 };
  if (report === null) return out;
  for (const finding of report.findings) {
    const key = finding.requires[0];
    if (key === undefined) continue;
    if (finding.status === "fail") out[key].fail += 1;
    else if (finding.status === "review") out[key].review += 1;
  }
  return out;
}

export function subline(pacer: PacerView): string {
  if (pacer.phase !== "areas") return PREPARING_COPY;
  return pacer.revealed === 0 ? "Starting" : `${pacer.revealed} of ${SECTION_KEYS.length} areas`;
}

/** The expert counter: attention and review. The guided one counts only the things it will fix. */
export function counterText(found: PacerView["found"], guided = false): string {
  if (guided) {
    if (found.attention === 0) return "Nothing found yet";
    return found.attention === 1 ? "1 thing to fix so far" : `${found.attention} things to fix so far`;
  }
  if (found.attention === 0 && found.review === 0) return "Nothing found yet";
  const review = found.review > 0 ? `, ${found.review} worth a look` : "";
  return `${found.attention} found so far${review}`;
}

function statusLine(state: RowState, counts: { fail: number; review: number }): { icon: keyof typeof ICONS | null; text: string; spin?: boolean } {
  switch (state) {
    case "pending":
      return { icon: null, text: "" };
    case "checking":
      return { icon: "spinner", text: "Checking", spin: true };
    case "prompting":
      return { icon: "spinner", text: "", spin: true };
    case "checked":
      return { icon: "check", text: "Checked" };
    case "fine":
      return { icon: "check", text: "Fine" };
    case "attention":
      return { icon: "warning", text: `${counts.fail} to look at` };
    case "review":
      return { icon: "eye", text: `${counts.review} worth a look` };
    case "unavailable":
      return { icon: "question", text: "Couldn't check" };
  }
}

/** The guided dot: passed in success, active in rust, found in the critical colour, the rest hollow. */
function dotFor(state: RowState): "pending" | "active" | "passed" | "found" | "review" | "unavailable" {
  switch (state) {
    case "pending":
      return "pending";
    case "checking":
    case "prompting":
      return "active";
    case "checked":
    case "fine":
      return "passed";
    case "attention":
      return "found";
    case "review":
      return "review";
    case "unavailable":
      return "unavailable";
  }
}

/** The body under the "Checking your Mac" toolbar: bar, subline, counter and the 17 paced rows. */
export function Scanning({ pacer, report, guided = false }: { pacer: PacerView; report: ScanReport | null; guided?: boolean }) {
  const counts = countsFor(report);
  const line = subline(pacer);
  // Screen readers hear three checkpoints and the preparing line, not every reveal.
  const announced = useRef("");
  if (pacer.phase !== "areas" || CHECKPOINTS.has(pacer.revealed)) announced.current = line;
  const dimmed = pacer.phase !== "areas";
  const percent = Math.round(pacer.progress * 100);
  const progressLabels = guided ? GUIDED_SECTION_LABELS : SECTION_PROGRESS_LABELS;
  const bar = (
    <div className="progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Check-up progress">
      <div style={{ width: `${percent}%` }} />
    </div>
  );

  return (
    <main className={guided ? "screen scanning scanning-guided" : "screen scanning"} aria-busy={pacer.phase !== "done"}>
      {!guided && bar}
      <div className="scanning-head">
        <p className="scanning-subline">{line}</p>
        <p className="counter-tile">
          <span key={pacer.found.attention} className="counter-number">
            {counterText(pacer.found, guided)}
          </span>
        </p>
      </div>
      {guided && bar}
      <span role="status" className="visually-hidden">
        {announced.current}
      </span>
      <ol className={dimmed ? "progress-list progress-dimmed" : "progress-list"} aria-label="Progress by area">
        {SECTION_KEYS.map((key) => {
          const state = pacer.rows[key];
          const status = statusLine(state, counts[key]);
          const label = state === "prompting" ? PROMPTING_ROW_COPY : state === "checking" ? progressLabels[key] : SECTION_LABELS[key];
          return (
            <li key={key} className={`progress-item progress-${state}`} data-section={key}>
              {guided ? <span className={`scan-dot scan-dot-${dotFor(state)}`} aria-hidden="true" /> : <Icon icon={SECTION_ICONS[key]} />}
              <span className="progress-label">{label}</span>
              <span className="progress-status">
                {status.icon === null ? (
                  <span className="progress-dot" aria-hidden="true" />
                ) : (
                  !guided && <Icon icon={ICONS[status.icon]} className={status.spin === true ? "spin" : undefined} />
                )}
                {status.text.length > 0 && <span>{status.text}</span>}
              </span>
            </li>
          );
        })}
        {dimmed && !guided && (
          <li className="progress-item progress-preparing" data-section="preparing">
            <Icon icon={ICONS.spinner} className="spin" />
            <span className="progress-label">{PREPARING_COPY}</span>
          </li>
        )}
      </ol>
      {dimmed && guided && (
        <div className="scan-summary">
          <p className="guided-status">
            <Icon icon={ICONS.spinner} size={16} className="spin" />
            <span>{PREPARING_COPY}</span>
          </p>
        </div>
      )}
    </main>
  );
}
