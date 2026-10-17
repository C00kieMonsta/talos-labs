/**
 * The one place the "Why?" question is built (docs/DESIGN-CHAT.md, the Why chip). The watch
 * window's "Ask why this matters" link and the chat's chip and auto-send match all read it, so
 * the main webview can tell an authored question from a typed one by equality.
 */
export function askWhyQuestion(headline: string): string {
  const trimmed = headline.trim();
  if (trimmed.length === 0) throw new Error("invalid_input");
  const first = trimmed.charAt(0).toLowerCase();
  return `Why does ${first}${trimmed.slice(1)} matter?`;
}
