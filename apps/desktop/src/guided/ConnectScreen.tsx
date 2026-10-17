import { useEffect, useId, useState } from "react";
import { ICONS } from "../app/icons";
import { Icon } from "../components/Icon";
import type { ConnectOffered, ConnectProvider, ConnectStage } from "../scan/ai-connect";
import { useConnect } from "../scan/ai-connect";
import { useGuidedHero } from "./GuidedShell";
import { StepFrame } from "./StepFrame";
import { CONNECT, CONNECTING, CONNECT_FAILED } from "./copy";

/** A row of the radiogroup: the two subscription providers and the no-account option. */
export type ConnectRow = ConnectProvider | "apple";

const ROW_ORDER: readonly ConnectRow[] = ["chatgpt", "claude_plan", "apple"];
const ROW_ICONS = { chatgpt: ICONS.extensions, claude_plan: ICONS.extensions, apple: ICONS.mac } as const;

interface RowState {
  readonly key: ConnectRow;
  readonly enabled: boolean;
}

/** ChatGPT and Claude are always listed (disabled when the build cannot offer them); On this Mac only when the Mac can run it. */
export function connectRows(offered: ConnectOffered): readonly RowState[] {
  return ROW_ORDER.filter((key) => key !== "apple" || offered.apple).map((key) => ({ key, enabled: offered[key] }));
}

/** The spinner line under a connecting headline. */
function ConnectStatus({ text }: { text: string }) {
  return (
    <p className="guided-connect-status" role="status">
      <Icon icon={ICONS.spinner} className="spin" />
      <span>{text}</span>
    </p>
  );
}

function failedCopy(stage: Extract<ConnectStage, { kind: "failed" }>): { title: string; body: string } {
  switch (stage.outcome) {
    case "closed":
      return CONNECT_FAILED.closed;
    case "timeout":
      return CONNECT_FAILED.timeout;
    case "plan_not_eligible":
      return { title: CONNECT_FAILED.plan_not_eligible.title, body: CONNECT_FAILED.plan_not_eligible.body[stage.provider] };
    case "provider_unavailable":
      return { title: CONNECT_FAILED.provider_unavailable.title[stage.provider], body: CONNECT_FAILED.provider_unavailable.body };
    case "fetch_failed":
      return { title: CONNECTING.fetchFailedTitle, body: CONNECTING.fetchFailedBody };
  }
}

/**
 * The Connect screen (DESIGN-AI section 4): a radiogroup of the AIs the person may use, then the
 * connecting, done and failed screens. It lives in the guided shell without a progress line and
 * never counts as a step; the controller takes the person back where they came from.
 */
export function ConnectScreen() {
  const connect = useConnect();
  const { ensureOffered } = connect;
  useGuidedHero(false, true);
  useEffect(() => {
    ensureOffered();
  }, [ensureOffered]);
  const titleId = useId();
  const [picked, setPicked] = useState<ConnectRow | null>(null);
  const { stage, offered } = connect;

  if (stage.kind === "fetching") {
    // Headline, sentence and the status line only (DESIGN-AI section 4): Cancel comes with the browser screen.
    return (
      <StepFrame progress={null} title={CONNECTING.fetchTitle} body={<p>{CONNECTING.fetchBody}</p>} className="guided-connect">
        <ConnectStatus text={CONNECTING.fetchStatus} />
      </StepFrame>
    );
  }
  if (stage.kind === "waiting") {
    return (
      <StepFrame progress={null} title={CONNECTING.opened[stage.provider]} body={<p>{CONNECTING.body}</p>} className="guided-connect" link={{ label: CONNECT.cancel, onClick: connect.cancel }}>
        <ConnectStatus text={CONNECTING.status} />
      </StepFrame>
    );
  }
  if (stage.kind === "done") {
    return <StepFrame progress={null} title={CONNECT.done[stage.provider]} done className="guided-connect" />;
  }
  if (stage.kind === "failed") {
    const copy = failedCopy(stage);
    const primary = stage.outcome === "plan_not_eligible" ? { label: CONNECT.chooseAnother, onClick: connect.chooseAnother } : { label: CONNECT.tryAgain, onClick: connect.tryAgain };
    return <StepFrame progress={null} title={copy.title} body={<p>{copy.body}</p>} className="guided-connect" primary={primary} link={{ label: CONNECT.notNow, onClick: connect.notNow }} />;
  }

  const rows = offered === null ? [] : connectRows(offered);
  const firstEnabled = rows.find((row) => row.enabled)?.key ?? null;
  // Until start() answers the chosen row stays selected and the primary is disabled.
  const starting = stage.kind === "starting" ? stage.provider : null;
  // The default is the first row that can be connected; a pick survives only while that row stays enabled.
  const selected = starting ?? (picked !== null && rows.some((row) => row.key === picked && row.enabled) ? picked : firstEnabled);
  const primary =
    selected === null
      ? null
      : {
          label: CONNECT.primary[selected],
          disabled: starting !== null,
          onClick: () => (selected === "apple" ? connect.useThisMac() : connect.start(selected)),
        };
  return (
    <StepFrame progress={null} title={CONNECT.title} titleId={titleId} body={<p>{CONNECT.body}</p>} className="guided-connect" primary={primary} link={{ label: CONNECT.notNow, onClick: connect.notNow, disabled: starting !== null }}>
      {offered === null ? (
        <ConnectStatus text={CONNECT.loading} />
      ) : (
        <>
          <div className="guided-choice" role="radiogroup" aria-labelledby={titleId}>
            {rows.map((row) => (
              <label key={row.key} className="guided-choice-row" aria-disabled={row.enabled ? undefined : "true"}>
                <input type="radio" name="ai-provider" value={row.key} checked={selected === row.key} disabled={!row.enabled || starting !== null} onChange={() => setPicked(row.key)} />
                <Icon icon={ROW_ICONS[row.key]} size={20} className="guided-choice-icon" />
                <span className="guided-choice-text">{CONNECT.rows[row.key]}</span>
                <span className="guided-choice-plan">{row.enabled ? CONNECT.plans[row.key] : CONNECT.notAvailable}</span>
              </label>
            ))}
          </div>
          {starting !== null && <ConnectStatus text={CONNECT.loading} />}
        </>
      )}
    </StepFrame>
  );
}
