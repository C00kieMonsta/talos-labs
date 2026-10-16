import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONTINUE_KEY, parseContinue, readContinue, writeContinue } from "./continue";

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe("talos.continue", () => {
  it("accepts the v0.2 bare string and both JSON kinds", () => {
    expect(parseContinue("fda")).toEqual({ kind: "fda" });
    expect(parseContinue('{"kind":"fda"}')).toEqual({ kind: "fda" });
    expect(parseContinue('{"kind":"guided"}')).toEqual({ kind: "guided" });
    expect(parseContinue(null)).toBeNull();
    expect(parseContinue("nonsense")).toBeNull();
    expect(parseContinue('{"kind":"other"}')).toBeNull();
    expect(parseContinue("[1]")).toBeNull();
  });

  it("reads and clears the note", () => {
    writeContinue({ kind: "guided" });
    expect(localStorage.getItem(CONTINUE_KEY)).toBe('{"kind":"guided"}');
    expect(readContinue()).toEqual({ kind: "guided" });
    expect(localStorage.getItem(CONTINUE_KEY)).toBeNull();
    expect(readContinue()).toBeNull();
  });
});
