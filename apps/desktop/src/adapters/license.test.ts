import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LICENSE_PUBLIC_KEY_HEX } from "../license/public-key";
import { forgeKey, generateTestKeyPair, issueKey, ZERO_PUBLIC_KEY_HEX } from "../license/test-keys";
import { createVerifier, createVerifierOrRejectAll } from "../license/verifier";
import { LicenseAdapter } from "./license";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);
const pair = generateTestKeyPair();
const verify = createVerifier(pair.publicKeyHex);

const PAYLOAD = {
  v: 1,
  lid: "01TESTLICENCE0000000000000",
  product: "talos-desktop",
  plan: "personal",
  seats: 1,
  issuedAt: "2026-10-15",
  updatesUntil: "2027-10-15",
  tag: "ab12cd34",
} as const;

const VALID_KEY = issueKey(PAYLOAD, pair.privateKey);
const BUILD_DATE = "2026-10-15";

function stored(value: string | null): void {
  invokeMock.mockImplementation(async (cmd: string) => (cmd === "license_read" ? value : undefined));
}

function adapter(revoked: ReadonlySet<string> = new Set(), buildDate = BUILD_DATE): LicenseAdapter {
  return new LicenseAdapter(verify, buildDate, revoked);
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe("LicenseAdapter.current", () => {
  it("is none when nothing is stored", async () => {
    stored(null);
    expect(await adapter().current()).toEqual({ status: "none" });
    expect(invokeMock).toHaveBeenCalledWith("license_read");
  });

  it("is none when the stored value is blank", async () => {
    stored("   ");
    expect(await adapter().current()).toEqual({ status: "none" });
  });

  it("re-verifies a stored key and returns its payload", async () => {
    stored(`  ${VALID_KEY}\n`);
    expect(await adapter().current()).toEqual({ status: "valid", payload: PAYLOAD });
  });

  it("rejects a stored key whose payload no longer matches the signature", async () => {
    stored(issueKey({ ...PAYLOAD, seats: 50 }, pair.privateKey, PAYLOAD));
    const state = await adapter().current();
    expect(state).toEqual({ status: "invalid", reason: "signature" });
  });

  it("rejects a key signed by another private key", async () => {
    const other = generateTestKeyPair();
    stored(issueKey(PAYLOAD, other.privateKey));
    expect(await adapter().current()).toEqual({ status: "invalid", reason: "signature" });
  });

  it("rejects a key when the build is newer than updatesUntil", async () => {
    stored(VALID_KEY);
    expect(await adapter(new Set(), "2027-10-16").current()).toEqual({ status: "invalid", reason: "build_too_new" });
  });

  it("rejects a revoked licence id", async () => {
    stored(VALID_KEY);
    expect(await adapter(new Set([PAYLOAD.lid])).current()).toEqual({ status: "invalid", reason: "revoked" });
  });

  it("rejects garbage without throwing", async () => {
    stored("not-a-key");
    const state = await adapter().current();
    expect(state.status).toBe("invalid");
  });
});

describe("LicenseAdapter.install", () => {
  it("verifies, stores the trimmed key and returns valid", async () => {
    stored(null);
    const state = await adapter().install(`  ${VALID_KEY}  `);
    expect(state).toEqual({ status: "valid", payload: PAYLOAD });
    expect(invokeMock).toHaveBeenCalledWith("license_write", { key: VALID_KEY });
  });

  it("does not store an invalid key", async () => {
    stored(null);
    const state = await adapter().install("TL1.garbage.garbage");
    expect(state.status).toBe("invalid");
    expect(invokeMock).not.toHaveBeenCalledWith("license_write", expect.anything());
  });

  it("does not store a key for the wrong product", async () => {
    stored(null);
    const state = await adapter().install(issueKey({ ...PAYLOAD, product: "other" }, pair.privateKey));
    expect(state).toEqual({ status: "invalid", reason: "product" });
    expect(invokeMock).not.toHaveBeenCalledWith("license_write", expect.anything());
  });
});

describe("LicenseAdapter with a small-order or placeholder public key", () => {
  const FORGED_KEY = forgeKey({ ...PAYLOAD, lid: "FORGED", plan: "business", seats: 999, updatesUntil: "2099-12-31" });

  it("does not install a key minted without the private key against the zero placeholder", async () => {
    stored(null);
    const state = await new LicenseAdapter(createVerifierOrRejectAll(ZERO_PUBLIC_KEY_HEX), BUILD_DATE, new Set()).install(
      FORGED_KEY,
    );
    expect(state).toEqual({ status: "invalid", reason: "signature" });
    expect(invokeMock).not.toHaveBeenCalledWith("license_write", expect.anything());
  });

  it("re-validates a stored forged key as invalid against the zero placeholder", async () => {
    stored(FORGED_KEY);
    const state = await new LicenseAdapter(createVerifierOrRejectAll(ZERO_PUBLIC_KEY_HEX), BUILD_DATE, new Set()).current();
    expect(state).toEqual({ status: "invalid", reason: "signature" });
  });

  it("rejects the forged key with the compiled-in key, whatever it currently is", async () => {
    stored(FORGED_KEY);
    const state = await new LicenseAdapter(createVerifierOrRejectAll(LICENSE_PUBLIC_KEY_HEX), BUILD_DATE, new Set()).current();
    expect(state).toEqual({ status: "invalid", reason: "signature" });
  });

  it("rejects the forged key with a real key", async () => {
    stored(FORGED_KEY);
    expect(await adapter().current()).toEqual({ status: "invalid", reason: "signature" });
  });
});

describe("LicenseAdapter.remove", () => {
  it("deletes the stored key", async () => {
    stored(null);
    await adapter().remove();
    expect(invokeMock).toHaveBeenCalledWith("license_delete");
  });
});
