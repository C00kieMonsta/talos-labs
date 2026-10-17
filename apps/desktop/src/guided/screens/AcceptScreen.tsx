import type { RuleId } from "@talos/core";
import type { GuidedController } from "../state";
import { GuidedList } from "../GuidedList";
import { StepFrame } from "../StepFrame";
import { ACCEPT } from "../copy";
import { guidedFor } from "../plan";

export interface AcceptScreenProps {
  /** The rules whose Later count reached LATER_ASK_COUNT; one or more. */
  readonly ruleIds: readonly RuleId[];
  readonly progress: { readonly done: number; readonly of: number };
  readonly devId: string;
  /** The Explain disclosure stays for a single-rule step; a batch has none. */
  readonly explainRuleId: RuleId | null;
  readonly notice: string | null;
  readonly controller: GuidedController;
}

/** "Shall I stop asking about this?" (DESIGN-ACCEPT.md section 2): one primary, one link, the headlines listed on a batch. */
export function AcceptScreen({ ruleIds, progress, devId, explainRuleId, notice, controller }: AcceptScreenProps) {
  const many = ruleIds.length > 1;
  const rows = ruleIds.map((id) => ({ key: id, text: guidedFor(id).headline, icon: "bullet" as const }));
  return (
    <StepFrame
      progress={progress}
      devId={devId}
      title={many ? ACCEPT.titleMany : ACCEPT.title}
      body={<p>{many ? ACCEPT.bodyMany : ACCEPT.body}</p>}
      primary={{ label: ACCEPT.primary, onClick: controller.keepAsking }}
      link={{ label: many ? ACCEPT.linkMany : ACCEPT.link, onClick: controller.accept }}
      explainRuleId={many ? null : explainRuleId}
      notice={notice}
      className="guided-ask-accept"
    >
      {many && <GuidedList rows={rows} />}
    </StepFrame>
  );
}
