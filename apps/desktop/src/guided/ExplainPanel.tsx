import { useEffect, useState } from "react";
import type { RuleId } from "@talos/core";
import { useApp } from "../app/context";
import { EXPLAINER_FAILURE_LABELS } from "../app/labels";
import { ModelText } from "../components/ModelText";
import { EXPLAIN } from "./copy";
import { guidedFor } from "./plan";

/** "Explain this": streams explain(ruleId) through the v0.2 chokepoint. Never on the path; collapses on advance. */
export function ExplainPanel({ ruleId, others = [] }: { ruleId: RuleId; others?: readonly RuleId[] }) {
  const { scan } = useApp();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<RuleId>(ruleId);
  useEffect(() => {
    setOpen(false);
    setTarget(ruleId);
  }, [ruleId]);
  useEffect(() => {
    if (open) void scan.explain(target);
  }, [open, target, scan]);
  const explain = scan.scan.kind === "ready" || scan.scan.kind === "rechecking" ? scan.scan.explain : { kind: "off" as const };
  const streaming = explain.kind === "running" && explain.target === target;
  const partial = streaming ? explain.partial : null;
  const ready = explain.kind === "ready" || explain.kind === "failed" ? explain.byRule[target] : undefined;
  const failed = explain.kind === "failed" && explain.target === target ? explain.reason : null;
  const text = ready?.whyItMattersForYou ?? partial?.whyItMattersForYou ?? null;
  return (
    <details className="guided-explain" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{EXPLAIN.open}</summary>
      {open && (
        <div className="guided-explain-body">
          {text !== null && <ModelText text={text} caret={streaming} />}
          {streaming && (
            <p className="guided-meta" role="status">
              Writing{" "}
              <button type="button" className="link-button" onClick={() => scan.stopExplain()}>
                {EXPLAIN.stop}
              </button>
            </p>
          )}
          {failed !== null && <p className="guided-meta">{EXPLAINER_FAILURE_LABELS[failed]}</p>}
          {others.length > 0 && (
            <p className="guided-explain-others">
              {others.map((id) => (
                <button key={id} type="button" className="link-button" onClick={() => setTarget(id)} aria-pressed={target === id}>
                  {guidedFor(id).headline}
                </button>
              ))}
            </p>
          )}
        </div>
      )}
    </details>
  );
}
