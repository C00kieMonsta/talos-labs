import { SEVERITY_ICONS } from "../app/icons";
import { Icon } from "../components/Icon";
import { GuidedList } from "../guided/GuidedList";
import { PLAN, SINCE } from "../guided/copy";
import type { ChatMessage } from "./state";

type App = Extract<ChatMessage, { kind: "app" }>;

/** The app's own voice: headline, the urgent line, sentences, the since rows and the end groups. Authored copy only. */
export function ChatApp({ message, headlineRef }: { message: App; headlineRef?: (el: HTMLHeadingElement | null) => void }) {
  const { headline, body, urgent, rows, groups, since } = message;
  return (
    <div className="chat-app" data-label={message.label}>
      {since !== null && rows.length > 0 && <p className="chat-meta">{SINCE.title}</p>}
      {since !== null && rows.length > 0 && <GuidedList rows={rows} />}
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
