import { afterEach, describe, expect, it, vi } from "vitest";
import { DEV_MACHINE, MACOS_CATALOG, buildExplainerSystemPrompt, evaluate, explainTurns, responsesRequestBody, toExplainerContext } from "@talos/core";
import type { Explanation, SystemState } from "@talos/core";
import { DEFAULT_SETTINGS } from "../settings";
import { CHATGPT_PARTIAL_EVERY_MS, CHATGPT_RESPONSES_URL, ChatGptExplainerAdapter, LIMIT_TTL_MS } from "./chatgpt-explainer";
import { TEST_CONTEXT, TEST_REPORT, VALID_ANSWER, VALID_EXPLANATION, VALID_PRIORITISATION } from "./test-fixtures";

const NOW = "2026-10-16T12:00:00.000Z";
const TOKEN = "eyJ-secret-access-token-7f3a";

/** The sentinel sits in a display-only string that the derived document must drop. */
const SENTINEL = "SENTINEL_LOGIN_ITEM_7f3a";
const SENTINEL_STATE: SystemState = {
  ...DEV_MACHINE,
  sections: { ...DEV_MACHINE.sections, loginItems: { status: "ok", data: { count: 3, names: ["Docker", "Raycast", SENTINEL] } } },
};
const sentinelReport = evaluate(SENTINEL_STATE, MACOS_CATALOG, { now: NOW, os: "macos" });
const sentinelContext = toExplainerContext(sentinelReport, MACOS_CATALOG, DEFAULT_SETTINGS.profile);

function sse(events: readonly string[]): Response {
  const encoder = new TextEncoder();
  const chunks = events.map((e) => encoder.encode(e));
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[i];
      i += 1;
      if (next === undefined) controller.close();
      else controller.enqueue(next);
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function delta(text: string): string {
  return `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n`;
}

function completed(value: unknown): string {
  const text = JSON.stringify(value);
  return `event: response.completed\ndata: ${JSON.stringify({ type: "response.completed", response: { output: [{ type: "message", content: [{ type: "output_text", text }] }] } })}\n\n`;
}

/** A complete answer streamed in pieces, so the adapter sees partial JSON. */
function streamed(value: unknown, pieces = 3): string[] {
  const text = JSON.stringify(value);
  const size = Math.ceil(text.length / pieces);
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(delta(text.slice(i, i + size)));
  out.push(completed(value));
  return out;
}

function errorResponse(status: number, body: unknown = { error: { code: "x", message: "no" } }): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Behaves like a real fetch on abort: rejects at once if already aborted, else when the signal fires. */
function hangUntilAborted(_url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init?.signal;
    if (signal?.aborted) {
      reject(new Error("aborted"));
      return;
    }
    signal?.addEventListener("abort", () => reject(new Error("aborted")));
  });
}

interface Harness {
  adapter: ChatGptExplainerAdapter;
  fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
  invoke: ReturnType<typeof vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<unknown>>>;
  sentBodies(): string[];
  sentInit(i?: number): RequestInit;
}

function harness(options: { model?: string; tokenModel?: string; tokenError?: string; status?: string; clock?: () => string } = {}): Harness {
  const fetchMock = vi.fn<typeof fetch>();
  const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
    if (cmd === "chatgpt_token") {
      if (options.tokenError !== undefined) throw options.tokenError;
      void args;
      return { accessToken: TOKEN, expiresAt: "2026-10-16T13:00:00.000Z", model: options.tokenModel ?? "gpt-5-account" };
    }
    if (cmd === "ai_provider_status") return { state: options.status ?? "available", until: null };
    return undefined;
  });
  const adapter = new ChatGptExplainerAdapter({
    reportSource: async () => TEST_REPORT,
    invoke,
    fetchImpl: fetchMock,
    now: options.clock ?? (() => NOW),
    ...(options.model === undefined ? {} : { model: options.model }),
  });
  return {
    adapter,
    fetchMock,
    invoke,
    sentBodies: () => fetchMock.mock.calls.map((c) => String((c[1] as RequestInit).body)),
    sentInit: (i = 0) => fetchMock.mock.calls[i]?.[1] as RequestInit,
  };
}

const explainInput = { context: TEST_CONTEXT, ruleId: "TL-MAC-001" as const };
const instructions = buildExplainerSystemPrompt(MACOS_CATALOG);
/** TEST_CONTEXT with 001 marked as left alone by the person. */
const ACCEPTED_CONTEXT = { ...TEST_CONTEXT, findings: TEST_CONTEXT.findings.map((f) => (f.ruleId === "TL-MAC-001" ? { ...f, accepted: true } : f)) };
const PRIORITISATION_WITHOUT_001 = { order: ["TL-MAC-002", "TL-MAC-023"], reasons: [{ ruleId: "TL-MAC-002", reason: "The firewall is quick." }], startWith: ["TL-MAC-002"] } as const;

afterEach(() => vi.useRealTimers());

describe("ChatGptExplainerAdapter request shape", () => {
  it("posts the core request body byte for byte with the bearer token and SSE accept header", async () => {
    const h = harness();
    h.fetchMock.mockResolvedValueOnce(sse(streamed(VALID_EXPLANATION)));
    const result = await h.adapter.explain(explainInput);
    expect(result).toEqual({ ok: true, value: VALID_EXPLANATION });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(CHATGPT_RESPONSES_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", Accept: "text/event-stream" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.body).toBe(JSON.stringify(responsesRequestBody("explain", "gpt-5-account", instructions, explainTurns(explainInput))));
    expect(h.invoke).toHaveBeenCalledWith("chatgpt_token", { forceRefresh: false });
  });

  it("uses the Developer-mode model when set, else the account model from the token", async () => {
    const h = harness({ model: "gpt-5-mini" });
    h.fetchMock.mockResolvedValueOnce(sse(streamed(VALID_EXPLANATION)));
    await h.adapter.explain(explainInput);
    expect((JSON.parse(h.sentBodies()[0] ?? "") as { model: string }).model).toBe("gpt-5-mini");
    const blank = harness({ model: "  " });
    blank.fetchMock.mockResolvedValueOnce(sse(streamed(VALID_EXPLANATION)));
    await blank.adapter.explain(explainInput);
    expect((JSON.parse(blank.sentBodies()[0] ?? "") as { model: string }).model).toBe("gpt-5-account");
  });

  it("fails as provider_unavailable without a request when neither the override nor the token names a model", async () => {
    const h = harness({ tokenModel: "" });
    const result = await h.adapter.explain(explainInput);
    expect(result).toEqual({ ok: false, reason: "provider_unavailable" });
    expect(h.fetchMock).not.toHaveBeenCalled();
    const override = harness({ tokenModel: "", model: "gpt-5-mini" });
    override.fetchMock.mockResolvedValueOnce(sse(streamed(VALID_EXPLANATION)));
    await override.adapter.explain(explainInput);
    expect((JSON.parse(override.sentBodies()[0] ?? "") as { model: string }).model).toBe("gpt-5-mini");
  });

  it("sends only the derived document: a sentinel in a login item name never reaches the body", async () => {
    const h = harness();
    expect(JSON.stringify(sentinelReport)).toContain(SENTINEL);
    for (const call of [
      () => h.adapter.explain({ context: sentinelContext, ruleId: "TL-MAC-001" }),
      () => h.adapter.prioritise({ context: sentinelContext }),
      () => h.adapter.ask({ context: sentinelContext, history: [], question: "What first?" }),
    ]) {
      h.fetchMock.mockResolvedValueOnce(sse([completed({})]));
      await call();
    }
    const bodies = h.sentBodies();
    expect(bodies).toHaveLength(3);
    for (const body of bodies) {
      expect(body).not.toContain(SENTINEL);
      expect(body).not.toContain("Docker");
      expect(body).not.toContain(DEV_MACHINE.host.osBuild ?? "no-build");
      const parsed = JSON.parse(body) as { instructions: string; input: { content: string }[] };
      // The catalogue text lives in instructions only.
      expect(parsed.instructions).toBe(instructions);
      expect(JSON.stringify(parsed.input)).not.toContain("Why it matters:");
    }
  });

  it("does not keep the access token on the instance after the request", async () => {
    const h = harness();
    h.fetchMock.mockResolvedValueOnce(sse(streamed(VALID_EXPLANATION)));
    await h.adapter.explain(explainInput);
    expect(JSON.stringify(h.adapter)).not.toContain(TOKEN);
    expect(Object.values(h.adapter).some((v) => typeof v === "string" && v.includes(TOKEN))).toBe(false);
  });
});

describe("ChatGptExplainerAdapter streaming", () => {
  it("forwards partial snapshots in order, throttled, and validates the completed text", async () => {
    let t = Date.parse(NOW);
    const h = harness({ clock: () => new Date(t).toISOString() });
    const text = JSON.stringify(VALID_EXPLANATION);
    const cut = text.indexOf("whyItMattersForYou") + 30;
    const pieces = [delta(text.slice(0, cut)), delta(text.slice(cut, cut + 20)), delta(text.slice(cut + 20)), completed(VALID_EXPLANATION)];
    const encoder = new TextEncoder();
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = pieces[i];
        i += 1;
        t += CHATGPT_PARTIAL_EVERY_MS + 1;
        if (next === undefined) controller.close();
        else controller.enqueue(encoder.encode(next));
      },
    });
    h.fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
    const partials: Partial<Explanation>[] = [];
    const result = await h.adapter.explain(explainInput, { onPartial: (p) => partials.push(p) });
    expect(result).toEqual({ ok: true, value: VALID_EXPLANATION });
    expect(partials.length).toBeGreaterThanOrEqual(2);
    expect(partials[0]?.ruleId).toBe("TL-MAC-001");
    expect(String(partials[0]?.whyItMattersForYou)).toMatch(/^Anyone/);
    for (let k = 1; k < partials.length; k += 1) {
      expect(String(partials[k]?.whyItMattersForYou ?? "").length).toBeGreaterThanOrEqual(String(partials[k - 1]?.whyItMattersForYou ?? "").length);
    }
    expect(partials.at(-1)).toEqual(VALID_EXPLANATION);
  });

  it("validates prioritise against the eligible rule ids and ask against the report", async () => {
    const h = harness();
    h.fetchMock.mockResolvedValueOnce(sse(streamed(VALID_PRIORITISATION)));
    expect(await h.adapter.prioritise({ context: TEST_CONTEXT })).toEqual({ ok: true, value: VALID_PRIORITISATION });
    h.fetchMock.mockResolvedValueOnce(sse(streamed({ ...VALID_PRIORITISATION, order: ["TL-MAC-001"] })));
    expect((await h.adapter.prioritise({ context: TEST_CONTEXT })).ok).toBe(false);
    h.fetchMock.mockResolvedValueOnce(sse(streamed(VALID_ANSWER)));
    expect(await h.adapter.ask({ context: TEST_CONTEXT, history: [], question: "What first?" })).toEqual({ ok: true, value: VALID_ANSWER });
    const [, init] = h.fetchMock.mock.calls[0] as [string, RequestInit];
    expect((JSON.parse(String(init.body)) as { text: { format: { name: string } } }).text.format.name).toBe("prioritise");
  });

  it("a command-like partial aborts the stream and yields rejected_output", async () => {
    const h = harness();
    const bad = { ...VALID_EXPLANATION, whyItMattersForYou: "sudo rm -rf / now" };
    const text = JSON.stringify(bad);
    h.fetchMock.mockResolvedValueOnce(sse([delta(text.slice(0, 80)), delta(text.slice(80)), completed(bad)]));
    expect(await h.adapter.explain(explainInput)).toEqual({ ok: false, reason: "rejected_output" });
    expect(h.sentInit().signal?.aborted).toBe(true);
  });

  it("a response.failed or error event is provider_unavailable and is remembered", async () => {
    const h = harness();
    h.fetchMock.mockResolvedValueOnce(sse([delta("{"), 'event: error\ndata: {"type":"error","code":"server_error"}\n\n']));
    expect(await h.adapter.explain(explainInput)).toEqual({ ok: false, reason: "provider_unavailable" });
    expect(await h.adapter.availability()).toBe("provider_unavailable");
    expect(h.invoke).not.toHaveBeenCalledWith("ai_provider_status", expect.anything());
    expect(await h.adapter.availability(true)).toBe("available");
  });

  it("an abort maps to cancelled", async () => {
    const h = harness();
    h.fetchMock.mockImplementationOnce(hangUntilAborted);
    const controller = new AbortController();
    const pending = h.adapter.explain(explainInput, { signal: controller.signal });
    await vi.waitFor(() => expect(h.fetchMock).toHaveBeenCalledTimes(1));
    controller.abort();
    expect(await pending).toEqual({ ok: false, reason: "cancelled" });
    const already = harness();
    const aborted = new AbortController();
    aborted.abort();
    expect(await already.adapter.explain(explainInput, { signal: aborted.signal })).toEqual({ ok: false, reason: "cancelled" });
    expect(already.fetchMock).not.toHaveBeenCalled();
  });

  it("times out after 90 s", async () => {
    vi.useFakeTimers();
    const h = harness();
    h.fetchMock.mockImplementationOnce(hangUntilAborted);
    const pending = h.adapter.explain(explainInput);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(await pending).toEqual({ ok: false, reason: "timeout" });
  });
});

describe("ChatGptExplainerAdapter HTTP map", () => {
  it("401: one forced refresh and one retry, then needs_sign_in cached", async () => {
    const h = harness();
    h.fetchMock.mockResolvedValueOnce(errorResponse(401)).mockResolvedValueOnce(errorResponse(401));
    expect(await h.adapter.explain(explainInput)).toEqual({ ok: false, reason: "needs_sign_in" });
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
    const tokenCalls = h.invoke.mock.calls.filter((c) => c[0] === "chatgpt_token").map((c) => c[1]);
    expect(tokenCalls).toEqual([{ forceRefresh: false }, { forceRefresh: true }]);
    expect(await h.adapter.availabilityDetail()).toEqual({ state: "needs_sign_in", until: null });
    // A fresh probe clears the cache and asks Rust.
    expect(await h.adapter.availability(true)).toBe("available");
  });

  it("401 then success: the retry carries the refreshed token", async () => {
    const h = harness();
    h.fetchMock.mockResolvedValueOnce(errorResponse(401)).mockResolvedValueOnce(sse(streamed(VALID_EXPLANATION)));
    expect(await h.adapter.explain(explainInput)).toEqual({ ok: true, value: VALID_EXPLANATION });
    expect(h.fetchMock).toHaveBeenCalledTimes(2);
  });

  it("429: limit_reached with until from the body, null when absent", async () => {
    const h = harness();
    h.fetchMock.mockResolvedValueOnce(errorResponse(429, { error: { code: "subscription_sharing_usage_limit_exceeded", message: "Try again in 2h" } }));
    expect(await h.adapter.explain(explainInput)).toEqual({ ok: false, reason: "limit_reached" });
    expect(await h.adapter.availabilityDetail()).toEqual({ state: "limit_reached", until: "2026-10-16T14:00:00.000Z" });
    expect(h.fetchMock).toHaveBeenCalledTimes(1);
    // A fresh probe (Disconnect, a new sign-in) drops the reset time too and takes Rust's answer.
    h.invoke.mockResolvedValueOnce({ state: "not_connected", until: null });
    expect(await h.adapter.availabilityDetail(true)).toEqual({ state: "not_connected", until: null });
    expect(await h.adapter.availabilityDetail()).toEqual({ state: "available", until: null });
    const bare = harness();
    bare.fetchMock.mockResolvedValueOnce(errorResponse(429, { error: { code: "subscription_sharing_usage_limit_exceeded" } }));
    expect(await bare.adapter.explain(explainInput)).toEqual({ ok: false, reason: "limit_reached" });
    expect(await bare.adapter.availabilityDetail()).toEqual({ state: "limit_reached", until: null });
    expect(await bare.adapter.availabilityDetail(true)).toEqual({ state: "available", until: null });
  });

  it("a limit with a time in the past no longer blocks, without a fresh probe", async () => {
    let t = Date.parse(NOW);
    const h = harness({ clock: () => new Date(t).toISOString() });
    h.fetchMock.mockResolvedValueOnce(errorResponse(429, { error: { code: "x", message: "try again in 1m" } }));
    await h.adapter.explain(explainInput);
    expect(await h.adapter.availabilityDetail()).toEqual({ state: "limit_reached", until: "2026-10-16T12:01:00.000Z" });
    expect(h.invoke).not.toHaveBeenCalledWith("ai_provider_status", expect.anything());
    t += 59_000;
    expect((await h.adapter.availabilityDetail()).state).toBe("limit_reached");
    // The allowance comes back on its own: once the reset time has passed a cached probe asks Rust.
    t += 2_000;
    expect(await h.adapter.availabilityDetail()).toEqual({ state: "available", until: null });
    expect(h.invoke).toHaveBeenLastCalledWith("ai_provider_status", { provider: "chatgpt", fresh: false });
    expect(await h.adapter.availabilityDetail()).toEqual({ state: "available", until: null });
  });

  it("a limit with no reset time is forgotten after the TTL, like the Rust cache", async () => {
    let t = Date.parse(NOW);
    const h = harness({ clock: () => new Date(t).toISOString() });
    h.fetchMock.mockResolvedValueOnce(errorResponse(429, { error: { code: "subscription_sharing_usage_limit_exceeded" } }));
    expect(await h.adapter.explain(explainInput)).toEqual({ ok: false, reason: "limit_reached" });
    t += LIMIT_TTL_MS - 1;
    expect(await h.adapter.availabilityDetail()).toEqual({ state: "limit_reached", until: null });
    expect(h.invoke).not.toHaveBeenCalledWith("ai_provider_status", expect.anything());
    t += 1;
    expect(await h.adapter.availabilityDetail()).toEqual({ state: "available", until: null });
    expect(h.invoke).toHaveBeenLastCalledWith("ai_provider_status", { provider: "chatgpt", fresh: false });
  });

  it("403: plan_not_eligible cached, the call reads as provider_unavailable", async () => {
    const h = harness();
    h.fetchMock.mockResolvedValueOnce(errorResponse(403, { error: { code: "subscription_sharing_user_not_eligible" } }));
    expect(await h.adapter.explain(explainInput)).toEqual({ ok: false, reason: "provider_unavailable" });
    expect(await h.adapter.availability()).toBe("plan_not_eligible");
    expect(h.invoke).not.toHaveBeenCalledWith("ai_provider_status", expect.anything());
    // A fresh probe takes Rust's answer, so a Disconnect is seen.
    h.invoke.mockResolvedValueOnce({ state: "plan_not_eligible", until: null });
    expect(await h.adapter.availability(true)).toBe("plan_not_eligible");
    expect(await h.adapter.availability()).toBe("plan_not_eligible");
    expect(await h.adapter.availability(true)).toBe("available");
  });

  it("400 unsupported_capability: one plain retry and plain bodies for the rest of the session", async () => {
    const h = harness();
    h.fetchMock
      .mockResolvedValueOnce(errorResponse(400, { error: { code: "subscription_sharing_unsupported_capability", message: "no" } }))
      .mockResolvedValueOnce(sse(streamed(VALID_EXPLANATION)))
      .mockResolvedValueOnce(sse(streamed(VALID_EXPLANATION)));
    expect(await h.adapter.explain(explainInput)).toEqual({ ok: true, value: VALID_EXPLANATION });
    expect(await h.adapter.explain(explainInput)).toEqual({ ok: true, value: VALID_EXPLANATION });
    const bodies = h.sentBodies();
    expect(bodies).toHaveLength(3);
    expect(bodies[0]).toContain('"reasoning"');
    expect(bodies[1]).toBe(JSON.stringify(responsesRequestBody("explain", "gpt-5-account", instructions, explainTurns(explainInput), { plainOutput: true })));
    expect(bodies[2]).toBe(bodies[1]);
    // Once plain, a second 400 is not retried again.
    h.fetchMock.mockResolvedValueOnce(errorResponse(400, { error: { code: "subscription_sharing_unsupported_capability" } }));
    expect(await h.adapter.explain(explainInput)).toEqual({ ok: false, reason: "provider_unavailable" });
    expect(h.fetchMock).toHaveBeenCalledTimes(4);
  });

  it("other 4xx, 5xx and network errors are provider_unavailable and cached until a fresh probe", async () => {
    for (const make of [() => errorResponse(500), () => errorResponse(418), () => errorResponse(400, { error: { code: "bad_request" } })]) {
      const h = harness();
      h.fetchMock.mockResolvedValueOnce(make());
      expect(await h.adapter.explain(explainInput)).toEqual({ ok: false, reason: "provider_unavailable" });
      expect(h.fetchMock).toHaveBeenCalledTimes(1);
      expect(await h.adapter.availability()).toBe("provider_unavailable");
      expect(await h.adapter.availability(true)).toBe("available");
    }
    const net = harness();
    net.fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await net.adapter.explain(explainInput)).toEqual({ ok: false, reason: "provider_unavailable" });
  });

  it("maps the chatgpt_token errors", async () => {
    expect(await harness({ tokenError: "not_connected" }).adapter.explain(explainInput)).toEqual({ ok: false, reason: "not_configured" });
    expect(await harness({ tokenError: "not_offered" }).adapter.explain(explainInput)).toEqual({ ok: false, reason: "not_configured" });
    const signedOut = harness({ tokenError: "needs_sign_in" });
    expect(await signedOut.adapter.explain(explainInput)).toEqual({ ok: false, reason: "needs_sign_in" });
    expect(await signedOut.adapter.availability()).toBe("needs_sign_in");
    const down = harness({ tokenError: "provider_unavailable" });
    expect(await down.adapter.explain(explainInput)).toEqual({ ok: false, reason: "provider_unavailable" });
    expect(await down.adapter.availability()).toBe("provider_unavailable");
    expect(signedOut.fetchMock).not.toHaveBeenCalled();
  });
});

describe("ChatGptExplainerAdapter availability", () => {
  it("asks ai_provider_status with the provider and fresh flag and passes until through", async () => {
    const h = harness({ status: "not_connected" });
    expect(await h.adapter.availability()).toBe("not_connected");
    expect(h.invoke).toHaveBeenCalledWith("ai_provider_status", { provider: "chatgpt", fresh: false });
    await h.adapter.availability(true);
    expect(h.invoke).toHaveBeenLastCalledWith("ai_provider_status", { provider: "chatgpt", fresh: true });
    h.invoke.mockResolvedValueOnce({ state: "limit_reached", until: "2026-10-16T18:00:00.000Z" });
    expect(await h.adapter.availabilityDetail()).toEqual({ state: "limit_reached", until: "2026-10-16T18:00:00.000Z" });
    h.invoke.mockResolvedValueOnce("nonsense");
    expect(await h.adapter.availability()).toBe("provider_unavailable");
    h.invoke.mockRejectedValueOnce("boom");
    expect(await h.adapter.availability()).toBe("provider_unavailable");
  });

  it("shared() returns one instance per model override", () => {
    const a = ChatGptExplainerAdapter.shared({ reportSource: async () => null, model: "" });
    const b = ChatGptExplainerAdapter.shared({ reportSource: async () => null, model: "" });
    const c = ChatGptExplainerAdapter.shared({ reportSource: async () => null, model: "gpt-5" });
    expect(a).toBe(b);
    expect(c).not.toBe(a);
    expect(c.id).toBe("chatgpt");
  });
});

describe("ChatGptExplainerAdapter and the rules the person chose to leave", () => {
  it("sends the explainer instructions with the accepted sentence, rejects an order that names an accepted rule and accepts one without it", async () => {
    const h = harness();
    h.fetchMock.mockResolvedValueOnce(sse(streamed(VALID_PRIORITISATION)));
    expect(await h.adapter.prioritise({ context: ACCEPTED_CONTEXT })).toEqual({ ok: false, reason: "rejected_output" });
    const [, init] = h.fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(String(init.body)) as { instructions: string; input: unknown };
    expect(sent.instructions).toBe(buildExplainerSystemPrompt(MACOS_CATALOG));
    expect(sent.instructions).toContain("A finding marked accepted");
    // The document the model saw carries no accepted row at all.
    expect(JSON.stringify(sent.input)).not.toContain("TL-MAC-001");
    h.fetchMock.mockResolvedValueOnce(sse(streamed(PRIORITISATION_WITHOUT_001)));
    expect(await h.adapter.prioritise({ context: ACCEPTED_CONTEXT })).toEqual({ ok: true, value: PRIORITISATION_WITHOUT_001 });
  });
});
