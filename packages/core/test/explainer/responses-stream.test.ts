import { describe, expect, it } from "vitest";
import { parseResponsesError, parseResponsesEvent, splitSseEvents } from "../../src/explainer/responses-stream";

const NOW = "2026-10-16T17:00:00.000Z";

function block(type: string, data: Record<string, unknown>): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}`;
}

describe("splitSseEvents", () => {
  it("splits on blank lines and keeps the unfinished block as rest", () => {
    const { events, rest } = splitSseEvents("event: a\ndata: {}\n\nevent: b\ndata: {}\n\nevent: c\ndata: {");
    expect(events).toEqual(["event: a\ndata: {}", "event: b\ndata: {}"]);
    expect(rest).toBe("event: c\ndata: {");
  });

  it("accepts CRLF and drops empty blocks", () => {
    const { events, rest } = splitSseEvents("data: 1\r\n\r\n\r\n\r\ndata: 2\r\n\r\n");
    expect(events).toEqual(["data: 1", "data: 2"]);
    expect(rest).toBe("");
  });

  it("returns everything as rest when no blank line has arrived", () => {
    expect(splitSseEvents("data: {\"a\":1}")).toEqual({ events: [], rest: 'data: {"a":1}' });
  });
});

describe("parseResponsesEvent", () => {
  it("maps output_text deltas", () => {
    expect(parseResponsesEvent(block("response.output_text.delta", { delta: "Hel" }))).toEqual({ type: "text_delta", delta: "Hel" });
  });

  it("concatenates the output_text parts of a completed response", () => {
    const data = {
      response: {
        output: [
          { type: "reasoning", summary: [] },
          { type: "message", content: [{ type: "output_text", text: '{"a":' }, { type: "refusal", refusal: "no" }, { type: "output_text", text: "1}" }] },
        ],
      },
    };
    expect(parseResponsesEvent(block("response.completed", data))).toEqual({ type: "completed", text: '{"a":1}' });
  });

  it("maps failed, incomplete and error events to failed with a code", () => {
    expect(parseResponsesEvent(block("response.failed", { response: { error: { code: "server_error", message: "x" } } }))).toEqual({ type: "failed", code: "server_error" });
    expect(parseResponsesEvent(block("response.failed", { response: {} }))).toEqual({ type: "failed", code: "failed" });
    expect(parseResponsesEvent(block("response.incomplete", { response: { incomplete_details: { reason: "max_output_tokens" } } }))).toEqual({ type: "failed", code: "incomplete" });
    expect(parseResponsesEvent(block("error", { code: "rate_limit_exceeded", message: "slow down" }))).toEqual({ type: "failed", code: "rate_limit_exceeded" });
    expect(parseResponsesEvent(block("error", { message: "slow down" }))).toEqual({ type: "failed", code: "error" });
  });

  it("uses the event name when the data has no type", () => {
    expect(parseResponsesEvent('event: response.output_text.delta\ndata: {"delta":"x"}')).toEqual({ type: "text_delta", delta: "x" });
  });

  it("returns other for unrelated events and null for comments or non-JSON data", () => {
    expect(parseResponsesEvent(block("response.created", { response: {} }))).toEqual({ type: "other" });
    expect(parseResponsesEvent(block("response.output_item.added", {}))).toEqual({ type: "other" });
    expect(parseResponsesEvent(": keep-alive")).toBeNull();
    expect(parseResponsesEvent("data: [DONE]")).toBeNull();
    expect(parseResponsesEvent("data: 42")).toBeNull();
  });

  it("joins multi-line data fields", () => {
    expect(parseResponsesEvent('data: {"type":"response.output_text.delta",\ndata: "delta":"ab"}')).toEqual({ type: "text_delta", delta: "ab" });
  });
});

describe("parseResponsesError", () => {
  it("reads the code from error.code, then error.type", () => {
    expect(parseResponsesError('{"error":{"code":"subscription_sharing_usage_limit_exceeded","message":"Limit."}}', NOW)).toEqual({
      code: "subscription_sharing_usage_limit_exceeded",
      until: null,
    });
    expect(parseResponsesError('{"error":{"type":"invalid_request_error","message":"Bad."}}', NOW).code).toBe("invalid_request_error");
    expect(parseResponsesError('{"code":"top_level"}', NOW).code).toBe("top_level");
  });

  it("gives nulls for a body that is not JSON or not an object", () => {
    expect(parseResponsesError("<html>", NOW)).toEqual({ code: null, until: null });
    expect(parseResponsesError("[1]", NOW)).toEqual({ code: null, until: null });
    expect(parseResponsesError("{}", NOW)).toEqual({ code: null, until: null });
  });

  it("takes until from resets_at (epoch seconds, epoch ms or ISO) and reset_at", () => {
    expect(parseResponsesError('{"error":{"code":"x","resets_at":1792000800}}', NOW).until).toBe("2026-10-14T18:00:00.000Z");
    expect(parseResponsesError('{"error":{"code":"x","resets_at":1792000800000}}', NOW).until).toBe("2026-10-14T18:00:00.000Z");
    expect(parseResponsesError('{"error":{"code":"x","reset_at":"2026-10-16T18:00:00Z"}}', NOW).until).toBe("2026-10-16T18:00:00.000Z");
  });

  it("takes until from resets_in_seconds relative to now", () => {
    expect(parseResponsesError('{"error":{"code":"x","resets_in_seconds":90}}', NOW).until).toBe("2026-10-16T17:01:30.000Z");
  });

  it("reads 'try again in <n>(s|m|h)' from the message", () => {
    expect(parseResponsesError('{"error":{"message":"Please try again in 30s."}}', NOW).until).toBe("2026-10-16T17:00:30.000Z");
    expect(parseResponsesError('{"error":{"message":"Rate limited. Try again in 5 minutes."}}', NOW).until).toBe("2026-10-16T17:05:00.000Z");
    expect(parseResponsesError('{"error":{"message":"try again in 1h"}}', NOW).until).toBe("2026-10-16T18:00:00.000Z");
    expect(parseResponsesError('{"error":{"message":"try again later"}}', NOW).until).toBeNull();
    expect(parseResponsesError('{"error":{"message":"try again in 1h"}}', "not a date").until).toBeNull();
  });
});
