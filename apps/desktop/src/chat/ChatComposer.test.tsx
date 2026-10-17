// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CHAT_LIMITS } from "@talos/core";
import { CHAT, EXPLAIN } from "../guided/copy";
import { CHAT_NEAR_LIMIT, ChatComposer } from "./ChatComposer";
import type { ChatComposerProps } from "./ChatComposer";
import type { ChatComposer as ComposerState } from "./state";

afterEach(cleanup);

function mount(overrides: Partial<ChatComposerProps> = {}) {
  const props: ChatComposerProps = {
    state: { kind: "ready" },
    streaming: false,
    draft: null,
    onDraftConsumed: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    onNavigate: vi.fn(),
    onNearLimit: vi.fn(),
    onEscape: vi.fn(),
    ...overrides,
  };
  render(createElement(ChatComposer, props));
  return props;
}

const field = () => screen.getByLabelText(CHAT.message) as HTMLTextAreaElement;

describe("ChatComposer", () => {
  it("Enter sends the trimmed draft and clears it; Shift+Enter adds a line; whitespace cannot be sent", () => {
    const props = mount();
    fireEvent.change(field(), { target: { value: "   " } });
    expect((screen.getByLabelText(CHAT.send) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(props.onSend).not.toHaveBeenCalled();
    fireEvent.change(field(), { target: { value: "Why does the disk matter?" } });
    fireEvent.keyDown(field(), { key: "Enter", shiftKey: true });
    expect(props.onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(props.onSend).toHaveBeenCalledWith("Why does the disk matter?");
    expect(field().value).toBe("");
  });

  it("Escape stops while streaming and otherwise asks for the newest headline; it never clears the draft", () => {
    const ready = mount();
    fireEvent.change(field(), { target: { value: "keep me" } });
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(ready.onEscape).toHaveBeenCalledTimes(1);
    expect(ready.onStop).not.toHaveBeenCalled();
    expect(field().value).toBe("keep me");
    cleanup();
    const busy = mount({ state: { kind: "busy" }, streaming: true });
    expect(field().readOnly).toBe(true);
    expect(screen.getByLabelText(CHAT.stop)).not.toBeNull();
    expect(screen.queryByLabelText(CHAT.send)).toBeNull();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(busy.onStop).toHaveBeenCalledTimes(1);
  });

  it("shows the counter from 59 left, describes the field with it and says so once per crossing", () => {
    const props = mount();
    const max = CHAT_LIMITS.maxQuestionChars;
    fireEvent.change(field(), { target: { value: "a".repeat(max - CHAT_NEAR_LIMIT) } });
    expect(screen.queryByText("60 left")).toBeNull();
    expect(field().getAttribute("aria-describedby")).toBeNull();
    fireEvent.change(field(), { target: { value: "a".repeat(max - CHAT_NEAR_LIMIT + 1) } });
    const count = screen.getByText("59 left");
    expect(field().getAttribute("aria-describedby")).toBe(count.id);
    expect(props.onNearLimit).toHaveBeenCalledTimes(1);
    expect(props.onNearLimit).toHaveBeenCalledWith(59);
    fireEvent.change(field(), { target: { value: "a".repeat(max - 10) } });
    expect(props.onNearLimit).toHaveBeenCalledTimes(1);
    expect(field().maxLength).toBe(max);
  });

  it("replaces the field with the reason and its one link under a limit or a sign-out, and keeps Send hidden", () => {
    const limit: ComposerState = { kind: "limit", provider: "chatgpt", until: null };
    const props = mount({ state: limit });
    expect(screen.queryByLabelText(CHAT.message)).toBeNull();
    expect(screen.queryByLabelText(CHAT.send)).toBeNull();
    expect(screen.getByText(`${EXPLAIN.limit.chatgpt} ${EXPLAIN.limitBack}`)).not.toBeNull();
    cleanup();
    mount({ state: { kind: "signed_out", provider: "claude_plan" }, onNavigate: props.onNavigate });
    expect(document.querySelector(".chat-composer-state")?.textContent).toContain(EXPLAIN.signedOut.claude_plan);
    fireEvent.click(screen.getByText(EXPLAIN.signInAgain));
    expect(props.onNavigate).toHaveBeenCalledWith({ name: "connect", returnTo: { name: "chat" } });
    cleanup();
    mount({ state: { kind: "did_not_answer", provider: "chatgpt" } });
    expect(screen.getByLabelText(CHAT.message)).not.toBeNull();
  });

  it("takes a draft into the field once and grows to four rows at most", () => {
    const props = mount({ draft: "why does the disk matter" });
    expect(field().value).toBe("why does the disk matter");
    expect(props.onDraftConsumed).toHaveBeenCalledTimes(1);
    fireEvent.change(field(), { target: { value: "a\nb\nc\nd\ne\nf" } });
    expect(field().rows).toBe(4);
  });
});
