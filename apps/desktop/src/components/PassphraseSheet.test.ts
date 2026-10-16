// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PassphraseForm, passphraseProblem } from "./PassphraseSheet";

afterEach(cleanup);

describe("PassphraseForm", () => {
  it("puts Cancel and the submit on one row when a sheet passes onCancel, and only the submit otherwise", () => {
    const onCancel = vi.fn();
    render(createElement(PassphraseForm, { keyPath: "/Users/a/.ssh/id_ed25519", onSubmit: vi.fn(), onCancel }));
    expect(document.querySelectorAll(".sheet-actions").length).toBe(1);
    const names = Array.from(document.querySelectorAll(".sheet-actions button")).map((b) => b.textContent);
    expect(names).toEqual(["Cancel", "Add passphrase"]);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
    cleanup();
    render(createElement(PassphraseForm, { keyPath: null, onSubmit: vi.fn(), submitLabel: "Lock the key" }));
    expect(Array.from(document.querySelectorAll(".sheet-actions button")).map((b) => b.textContent)).toEqual(["Lock the key"]);
  });

  it("submits only a passphrase that passes the rule", () => {
    const onSubmit = vi.fn();
    render(createElement(PassphraseForm, { keyPath: null, onSubmit }));
    fireEvent.change(screen.getByLabelText("New passphrase"), { target: { value: "short" } });
    fireEvent.change(screen.getByLabelText("Repeat it"), { target: { value: "short" } });
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe(passphraseProblem("short", "short"));
    fireEvent.change(screen.getByLabelText("New passphrase"), { target: { value: "correct horse battery" } });
    fireEvent.change(screen.getByLabelText("Repeat it"), { target: { value: "correct horse battery" } });
    fireEvent.submit(document.querySelector("form") as HTMLFormElement);
    expect(onSubmit).toHaveBeenCalledWith("correct horse battery");
  });
});
