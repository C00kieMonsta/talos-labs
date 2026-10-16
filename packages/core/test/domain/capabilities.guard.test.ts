import { describe, expect, it } from "vitest";
import { toCapabilities } from "../../src/domain/capabilities.guard";

describe("toCapabilities", () => {
  it("passes a well-formed answer through", () => {
    expect(toCapabilities({ fullDiskAccess: true, automation: "granted", bundled: true })).toEqual({ fullDiskAccess: true, automation: "granted", bundled: true });
    expect(toCapabilities({ fullDiskAccess: false, automation: "denied", bundled: false })).toEqual({ fullDiskAccess: false, automation: "denied", bundled: false });
    expect(toCapabilities({ fullDiskAccess: null, automation: null, bundled: true })).toEqual({ fullDiskAccess: null, automation: null, bundled: true });
  });

  it("reads each field on its own and treats a bad one as unknown", () => {
    expect(toCapabilities({ fullDiskAccess: "maybe", automation: "denied", bundled: false })).toEqual({ fullDiskAccess: null, automation: "denied", bundled: false });
    expect(toCapabilities({ fullDiskAccess: false, automation: "sometimes", bundled: true })).toEqual({ fullDiskAccess: false, automation: null, bundled: true });
  });

  it("counts a missing or malformed bundled flag as bundled", () => {
    expect(toCapabilities({ fullDiskAccess: false, automation: null })).toEqual({ fullDiskAccess: false, automation: null, bundled: true });
    expect(toCapabilities({ fullDiskAccess: false, automation: null, bundled: "no" })).toEqual({ fullDiskAccess: false, automation: null, bundled: true });
    expect(toCapabilities("nope")).toEqual({ fullDiskAccess: null, automation: null, bundled: true });
    expect(toCapabilities(null)).toEqual({ fullDiskAccess: null, automation: null, bundled: true });
  });
});
