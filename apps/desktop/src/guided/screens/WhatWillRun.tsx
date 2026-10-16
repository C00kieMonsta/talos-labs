import { useApp } from "../../app/context";
import { BATCH } from "../copy";

/** Developer mode: every plan line and its privilege once the preview lands. Never edits anything. */
export function WhatWillRun() {
  const { scan, settings } = useApp();
  const fixing = scan.scan.kind === "ready" ? scan.scan.fixing : null;
  if (fixing === null) return null;
  const lines = fixing.kind === "batch" ? fixing.plan.items.flatMap((item) => item.lines.map((line) => ({ ...line, ruleId: item.ruleId }))) : fixing.plan.lines.map((line) => ({ ...line, ruleId: fixing.plan.ruleId }));
  if (lines.length === 0) return null;
  return (
    <details className="guided-dev" open={settings.developer.showPlanExpanded}>
      <summary>{BATCH.whatWillRun}</summary>
      <ol className="plan-lines">
        {lines.map((line, index) => (
          <li key={index}>
            <code className="mono">{line.text}</code> <span className="pill">{line.privilege}</span> <span className="muted small">{line.ruleId}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}
