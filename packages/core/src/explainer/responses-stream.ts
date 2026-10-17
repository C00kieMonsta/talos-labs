/**
 * Server-sent events from the OpenAI Responses API, reduced to what the ChatGPT adapter acts on.
 * Pure string work; the adapter owns the fetch and the abort.
 */

/** Splits a buffer on blank lines. rest is the unfinished block to prepend to the next chunk. */
export function splitSseEvents(buffer: string): { events: string[]; rest: string } {
  const normalised = buffer.replace(/\r\n/g, "\n");
  const parts = normalised.split("\n\n");
  const rest = parts.pop() ?? "";
  return { events: parts.filter((block) => block.trim().length > 0), rest };
}

export type ResponsesEvent =
  | { readonly type: "text_delta"; readonly delta: string }
  | { readonly type: "completed"; readonly text: string }
  | { readonly type: "failed"; readonly code: string }
  | { readonly type: "other" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function fields(block: string): { event: string | null; data: string | null } {
  let event: string | null = null;
  const data: string[] = [];
  for (const raw of block.split("\n")) {
    if (raw.startsWith(":")) continue;
    const colon = raw.indexOf(":");
    const name = colon === -1 ? raw : raw.slice(0, colon);
    let value = colon === -1 ? "" : raw.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (name === "event") event = value;
    else if (name === "data") data.push(value);
  }
  return { event, data: data.length === 0 ? null : data.join("\n") };
}

/** Every output_text part of a completed response, in order. */
function outputText(response: unknown): string {
  if (!isRecord(response) || !Array.isArray(response["output"])) return "";
  let text = "";
  for (const item of response["output"]) {
    if (!isRecord(item) || !Array.isArray(item["content"])) continue;
    for (const part of item["content"]) {
      if (isRecord(part) && part["type"] === "output_text" && typeof part["text"] === "string") text += part["text"];
    }
  }
  return text;
}

function errorCode(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  return str(value["code"]) ?? str(value["type"]) ?? fallback;
}

/** null when the block carries no data or data that is not JSON. */
export function parseResponsesEvent(block: string): ResponsesEvent | null {
  const { event, data } = fields(block);
  if (data === null) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    return null;
  }
  if (!isRecord(payload)) return null;
  const type = str(payload["type"]) ?? event;
  switch (type) {
    case "response.output_text.delta":
      return { type: "text_delta", delta: str(payload["delta"]) ?? "" };
    case "response.completed":
      return { type: "completed", text: outputText(payload["response"]) };
    case "response.failed": {
      const response = payload["response"];
      return { type: "failed", code: errorCode(isRecord(response) ? response["error"] : undefined, "failed") };
    }
    case "response.incomplete":
      return { type: "failed", code: "incomplete" };
    case "error":
      return { type: "failed", code: str(payload["code"]) ?? errorCode(payload["error"], "error") };
    default:
      return { type: "other" };
  }
}

export interface ResponsesError {
  readonly code: string | null;
  /** ISO when the body says when the allowance comes back; else null. */
  readonly until: string | null;
}

const UNIT_MS: Readonly<Record<string, number>> = { s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000, m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000, h: 3_600_000, hr: 3_600_000, hrs: 3_600_000, hour: 3_600_000, hours: 3_600_000 };
const TRY_AGAIN = /try again in (\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?|[smh])\b/i;

function isoFromEpoch(value: number): string | null {
  const ms = value > 1e12 ? value : value * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function isoFromString(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function untilFrom(error: Record<string, unknown>, now: string): string | null {
  for (const key of ["resets_at", "reset_at"]) {
    const value = error[key];
    if (typeof value === "number" && Number.isFinite(value)) return isoFromEpoch(value);
    if (typeof value === "string") {
      const iso = isoFromString(value);
      if (iso !== null) return iso;
    }
  }
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) return null;
  const seconds = error["resets_in_seconds"];
  if (typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0) return new Date(nowMs + seconds * 1000).toISOString();
  const message = str(error["message"]);
  if (message === null) return null;
  const match = TRY_AGAIN.exec(message);
  if (match === null) return null;
  const amount = Number(match[1]);
  const unit = UNIT_MS[(match[2] ?? "").toLowerCase()];
  if (unit === undefined || !Number.isFinite(amount)) return null;
  return new Date(nowMs + amount * unit).toISOString();
}

/** The code and, when the body says so, when to try again. A body that is not JSON gives nulls. */
export function parseResponsesError(bodyText: string, now: string): ResponsesError {
  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    return { code: null, until: null };
  }
  if (!isRecord(payload)) return { code: null, until: null };
  const error = isRecord(payload["error"]) ? payload["error"] : payload;
  const code = str(error["code"]) ?? str(error["type"]) ?? null;
  return { code, until: untilFrom(error, now) };
}
