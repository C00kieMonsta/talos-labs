import { afterEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { EvidenceTable, formatValue } from "./EvidenceTable";

afterEach(cleanup);

describe("formatValue", () => {
  it("turns enum tokens into plain words", () => {
    expect(formatValue({ kind: "enum", value: "filevault" })).toBe("FileVault");
    expect(formatValue({ kind: "enum", value: "time_machine" })).toBe("Time Machine");
    expect(formatValue({ kind: "enum", value: "xprotect" })).toBe("XProtect");
    expect(formatValue({ kind: "enum", value: "chrome" })).toBe("Chrome");
    expect(formatValue({ kind: "enum", value: "github_token" })).toBe("GitHub token");
    expect(formatValue({ kind: "enum", value: "none" })).toBe("None");
  });

  it("reads Tri settings like bool rows, with unset named as the macOS default", () => {
    expect(formatValue({ kind: "enum", value: "true" })).toBe("Yes");
    expect(formatValue({ kind: "enum", value: "false" })).toBe("No");
    expect(formatValue({ kind: "enum", value: "unset" })).toBe("Not set (macOS default)");
    expect(formatValue({ kind: "bool", value: true })).toBe("Yes");
  });

  it("falls back to capitalised words for a token it does not know", () => {
    expect(formatValue({ kind: "enum", value: "some_new_value" })).toBe("Some new value");
  });
});

describe("EvidenceTable", () => {
  it("renders the labelled rows", () => {
    render(
      createElement(EvidenceTable, {
        evidence: [
          { key: "method", label: "Backup method", value: { kind: "enum", value: "time_machine" } },
          { key: "keyPath", label: "Key", value: { kind: "path", value: "/Users/a/.ssh/id_ed25519" } },
        ],
      }),
    );
    expect(screen.getByRole("row", { name: /Backup method Time Machine/ })).toBeTruthy();
    expect(document.querySelector("td.mono")?.textContent).toBe("/Users/a/.ssh/id_ed25519");
  });
});
