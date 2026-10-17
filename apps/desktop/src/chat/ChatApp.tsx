import { SEVERITY_ICONS } from "../app/icons";
import { Icon } from "../components/Icon";
import { GuidedList, RowIcon } from "../guided/GuidedList";
import { ACTIVITY, PLAN, SINCE } from "../guided/copy";
import type { ChatMessage, WalkChecklist } from "./state";
import { openWalkRow, visibleWalkRows } from "./walk";

type App = Extract<ChatMessage, { kind: "app" }>;

/** The "Do them all" checklist (DESIGN-AGENT 2c): the progress line, the live row and the next two as tappable rows, then "and {n} more". */
function WalkList({ checklist, onPromoteStep }: { checklist: WalkChecklist; onPromoteStep?: (stepId: string) => void }) {
  const { rows, more } = visibleWalkRows(checklist);
  return (
    <>
      <p className="chat-meta chat-walk-progress">{ACTIVITY.plan.progress.replace("{done}", String(checklist.done)).replace("{of}", String(checklist.of))}</p>
      <ul className="guided-list chat-walk" role="list">
        {rows.map((row) => (
          <li key={`${row.stepId}:${row.ruleId}`} className={`guided-row guided-row-${row.icon}`}>
            {row.icon === "pending" && openWalkRow(row) ? (
              <button type="button" className="guided-end-row chat-walk-row" onClick={() => onPromoteStep?.(row.stepId)}>
                <RowIcon icon="pending" />
                <span className="guided-row-text">
                  {row.text}
                  {row.tag !== undefined && <span className="guided-tag">{row.tag}</span>}
                </span>
              </button>
            ) : (
              <>
                <RowIcon icon={row.icon} />
                <span className="guided-row-text">
                  {row.text}
                  {row.tag !== undefined && <span className="guided-tag">{row.tag}</span>}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      {more > 0 && <p className="chat-meta chat-walk-more">{ACTIVITY.rows.more.replace("{n}", String(more))}</p>}
    </>
  );
}

/** The app's own voice: headline, the urgent line, sentences, the since rows and the end groups. Authored copy only. */
export function ChatApp({ message, headlineRef, onPromoteStep }: { message: App; headlineRef?: (el: HTMLHeadingElement | null) => void; onPromoteStep?: (stepId: string) => void }) {
  const { headline, body, urgent, rows, groups, since, lead, checklist } = message;
  return (
    <div className="chat-app" data-label={message.label}>
      {since !== null && rows.length > 0 && <p className="chat-meta">{SINCE.title}</p>}
      {since !== null && rows.length > 0 && <GuidedList rows={rows} />}
      {lead !== null && <p className="chat-app-lead">{lead}</p>}
      {headline !== null && (
        <h2 ref={headlineRef} className="chat-headline" tabIndex={-1}>
          {headline}
        </h2>
      )}
      {urgent && (
        <p className="guided-urgent">
          <Icon icon={SEVERITY_ICONS.critical} size={16} className="guided-urgent-icon" />
          <span>{PLAN.urgent}</span>
        </p>
      )}
      {body !== null && <p className="chat-app-body">{body}</p>}
      {checklist !== null && <WalkList checklist={checklist} onPromoteStep={onPromoteStep} />}
      {since === null && rows.length > 0 && <GuidedList rows={rows} />}
      {groups.map((group) => (
        <section key={group.label} className="chat-app-group" aria-label={group.label}>
          <p className="chat-meta">{group.label}</p>
          <GuidedList rows={group.rows} />
        </section>
      ))}
      {message.sourceLine !== null && <p className="chat-meta">{message.sourceLine}</p>}
    </div>
  );
}
