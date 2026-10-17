import type { ReactNode } from "react";
import { exchangeLabel } from "@talos/core";
import { CHAT } from "../guided/copy";

/** One person turn and everything that answered it; app-started messages are exchanges with no person turn. */
export function ChatExchange({ person, children }: { person: string | null; children: ReactNode }) {
  return (
    <section className="chat-exchange" aria-label={exchangeLabel(person, { you: CHAT.exchangeYou, app: CHAT.exchangeApp })}>
      {children}
    </section>
  );
}
