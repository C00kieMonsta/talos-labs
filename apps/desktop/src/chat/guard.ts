import { PATH_LIKE, PORT_LIKE, containsCommandText } from "@talos/core";

/** The composer's guard (docs/DESIGN-CHAT.md "Person turns", check 1): a path, a port or a command never reaches the envelope. */
export function machineText(draft: string): boolean {
  return PATH_LIKE.test(draft) || PORT_LIKE.test(draft) || containsCommandText(draft);
}
