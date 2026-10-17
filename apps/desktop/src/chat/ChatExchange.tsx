import type { ReactNode } from "react";
import { exchangeLabel } from "@talos/core";
import { CHAT } from "../guided/copy";

/** One person turn and everything that answered it; an app-started exchange is named "Talos Labs" plus its headline, so two never share a name. */
export function ChatExchange({ person, headline, children }: { person: string | null; headline?: string | null; children: ReactNode }) {
  const strings = { you: CHAT.exchangeYou, app: CHAT.exchangeApp };
  const label = person === null && typeof headline === "string" && headline.length > 0 ? exchangeLabel(headline, { ...strings, you: `${CHAT.exchangeApp}:` }) : exchangeLabel(person, strings);
  return (
    <section className="chat-exchange" aria-label={label}>
      {children}
    </section>
  );
}
