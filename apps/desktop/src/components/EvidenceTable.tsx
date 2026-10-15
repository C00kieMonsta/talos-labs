import type { Evidence, EvidenceValue } from "@talos/core";
import { EVIDENCE_VALUE_LABELS } from "../app/labels";

const UNIT_LABELS = {
  count: "",
  seconds: " s",
  hours: " h",
  days: " days",
  port: "",
  chars: " characters",
} as const;

/** Plain words for an enum token the labels map does not know: "some_value" becomes "Some value". */
function fallbackLabel(token: string): string {
  const words = token.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatValue(value: EvidenceValue): string {
  switch (value.kind) {
    case "bool":
      return value.value ? "Yes" : "No";
    case "number":
      return value.unit === null ? String(value.value) : `${value.value}${UNIT_LABELS[value.unit]}`;
    case "enum":
      return EVIDENCE_VALUE_LABELS[value.value] ?? fallbackLabel(value.value);
    case "version":
    case "path":
    case "text":
      return value.value;
  }
}

export function EvidenceTable({ evidence }: { evidence: readonly Evidence[] }) {
  if (evidence.length === 0) return <p className="muted">Nothing extra was recorded for this check.</p>;
  return (
    <table className="evidence">
      <caption className="visually-hidden">What was found</caption>
      <thead>
        <tr>
          <th scope="col">What</th>
          <th scope="col">Value</th>
        </tr>
      </thead>
      <tbody>
        {evidence.map((entry, index) => (
          <tr key={`${entry.key}-${index}`}>
            <th scope="row">{entry.label}</th>
            <td className={entry.value.kind === "path" ? "mono" : undefined}>{formatValue(entry.value)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
