import { useId, useState } from "react";
import type { ActionId, FishyKind, WatchItem } from "@talos/core";
import { playbookRow } from "@talos/core";
import { ICONS } from "../../app/icons";
import { Icon } from "../../components/Icon";
import { StepFrame } from "../StepFrame";
import { FISHY, NEXT } from "../copy";
import { DetailsDisclosure } from "./DetailsDisclosure";
import { useFishyController } from "./controller";

export type ExpertRowKey = keyof typeof FISHY.experts.rows;

/** Expert row to playbook row, in screen order. */
export const EXPERT_ROWS: readonly { readonly key: ExpertRowKey; readonly actionId: ActionId }[] = [
  { key: "passwords", actionId: "act.change_passwords" },
  { key: "devices", actionId: "act.review_apple_account_devices" },
  { key: "twoFactor", actionId: "act.turn_on_2fa" },
  { key: "restore", actionId: "act.check_backup_before_restore" },
  { key: "doNotPay", actionId: "act.do_not_pay" },
  { key: "reinstall", actionId: "act.scan_or_reinstall" },
  { key: "report", actionId: "act.report" },
  { key: "update", actionId: "act.update_now" },
  { key: "lockdown", actionId: "act.lockdown_mode" },
];

/** The kind-led rows, drawn ahead of the base list; kept apart from EXPERT_ROWS, which FishyFlow.test.tsx pins to the base nine. */
export const LEAD_EXPERT_ROWS: readonly { readonly key: ExpertRowKey; readonly actionId: ActionId }[] = [
  { key: "limitAirdrop", actionId: "act.limit_airdrop" },
  { key: "stopSharing", actionId: "act.stop_internet_sharing" },
  { key: "getHelp", actionId: "act.get_help" },
];

/** The rows a kind leads with, each only when the item's playbook rows name its action. */
export const LEAD_ROWS: Readonly<Partial<Record<FishyKind, readonly ExpertRowKey[]>>> = {
  exposure: ["limitAirdrop", "stopSharing"],
  shell: ["getHelp"],
};

function actionOf(key: ExpertRowKey): ActionId | null {
  return [...EXPERT_ROWS, ...LEAD_EXPERT_ROWS].find((row) => row.key === key)?.actionId ?? null;
}

/**
 * The rows shown: the kind's lead rows the item's actions include, then the base list, where the do-not-pay row waits for the
 * ransom box and Lockdown Mode sits in the main list only for people who handle others' data.
 */
export function expertRows(ransomNote: boolean, handlesClientData: boolean, item: WatchItem | null = null): { readonly main: readonly ExpertRowKey[]; readonly more: readonly ExpertRowKey[] } {
  const lead = item === null ? [] : (LEAD_ROWS[item.kind] ?? []).filter((key) => {
    const actionId = actionOf(key);
    return actionId !== null && item.actionIds.includes(actionId);
  });
  const base = EXPERT_ROWS.map((row) => row.key).filter((key) => (key === "doNotPay" ? ransomNote : key === "lockdown" ? handlesClientData : true));
  return { main: [...lead, ...base], more: handlesClientData ? [] : ["lockdown"] };
}

function ExpertRow({ rowKey, item }: { rowKey: ExpertRowKey; item: WatchItem | null }) {
  const fishy = useFishyController();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const actionId = actionOf(rowKey);
  const playbook = actionId === null ? undefined : playbookRow(actionId);
  const copy = FISHY.experts.rows[rowKey];
  const chosen = item !== null && actionId !== null && item.actionIds.includes(actionId);
  // Advise rows carry the model's sentence when it picked this row, else the app's own word.
  const model = playbook?.kind.kind === "advise" ? { sentence: chosen ? item.modelSentence : null, provider: chosen ? item.modelProvider : null } : null;
  const pane = playbook?.kind.kind === "pane" ? playbook.kind.pane : null;
  return (
    <li>
      <button type="button" className="guided-end-row" aria-label={`${copy.text} ${FISHY.noticed.details}`} aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen((o) => !o)}>
        <Icon icon={ICONS.steps} size={20} className="guided-end-row-icon" />
        <span className="guided-end-row-text">{copy.text}</span>
        <Icon icon={ICONS.chevronRight} size={16} className="guided-end-row-chevron" />
      </button>
      {open && (
        <div id={panelId}>
          <DetailsDisclosure actionId={actionId} model={model} open>
            <p>{copy.details}</p>
            {pane !== null && (
              <button type="button" className="button button-small" onClick={() => fishy.showPane(pane)}>
                {NEXT.show}
              </button>
            )}
          </DetailsDisclosure>
        </div>
      )}
    </li>
  );
}

/** Screen 5: what experts do next, as rows that open their own Details. One primary, no link. */
export function ExpertsScreen({ item, handlesClientData }: { item: WatchItem | null; handlesClientData: boolean }) {
  const fishy = useFishyController();
  const titleId = useId();
  const { main, more } = expertRows(fishy.ransomNote, handlesClientData, item);
  return (
    <StepFrame progress={null} title={FISHY.experts.title} titleId={titleId} primary={{ label: FISHY.experts.primary, onClick: fishy.next }} className="guided-fishy guided-fishy-experts">
      <ul className="guided-end-list" role="list" aria-labelledby={titleId}>
        {main.map((key) => (
          <ExpertRow key={key} rowKey={key} item={item} />
        ))}
      </ul>
      {more.length > 0 && (
        <details className="guided-explain fishy-more">
          <summary>{FISHY.experts.more}</summary>
          <ul className="guided-end-list" role="list">
            {more.map((key) => (
              <ExpertRow key={key} rowKey={key} item={item} />
            ))}
          </ul>
        </details>
      )}
    </StepFrame>
  );
}
