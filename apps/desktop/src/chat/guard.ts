import { PATH_LIKE, PORT_LIKE, containsCommandText } from "@talos/core";

/** The composer's guard (docs/DESIGN-CHAT.md "Person turns", check 1): a path, a port or a command never reaches the envelope. */
export function machineText(draft: string): boolean {
  return PATH_LIKE.test(draft) || PORT_LIKE.test(draft) || containsCommandText(draft);
}

/** True when the text holds at least one letter or digit, so a lone comma or a blank line is never sent. */
export function hasWords(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}
