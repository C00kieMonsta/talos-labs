import { describe, expect, it } from "vitest";
import { LICENSE_PUBLIC_KEY_HEX } from "./public-key";
import {
  forgedSmallOrderSignature,
  generateTestKeyPair,
  IDENTITY_PUBLIC_KEY_HEX,
  signBytes,
  ZERO_PUBLIC_KEY_HEX,
} from "./test-keys";
import { createVerifier, createVerifierOrRejectAll, rejectAll } from "./verifier";

const pair = generateTestKeyPair();
const message = new TextEncoder().encode('{"product":"talos-desktop","v":1}');
const forged = forgedSmallOrderSignature();

describe("createVerifier", () => {
  it("accepts a node:crypto Ed25519 signature over the same bytes", () => {
    const verify = createVerifier(pair.publicKeyHex);
    expect(verify(message, signBytes(message, pair.privateKey))).toBe(true);
  });

  it("rejects a signature once a message byte changes", () => {
    const verify = createVerifier(pair.publicKeyHex);
    const signature = signBytes(message, pair.privateKey);
    const tampered = new Uint8Array(message);
    tampered[0] = tampered[0]! ^ 0x01;
    expect(verify(tampered, signature)).toBe(false);
  });

  it("rejects a signature made with another key", () => {
    const other = generateTestKeyPair();
    const verify = createVerifier(pair.publicKeyHex);
    expect(verify(message, signBytes(message, other.privateKey))).toBe(false);
  });

  it("returns false instead of throwing on a malformed signature", () => {
    const verify = createVerifier(pair.publicKeyHex);
    expect(verify(message, new Uint8Array(3))).toBe(false);
  });

  it("rejects the (R = B, S = 1) forgery for a real key", () => {
    const verify = createVerifier(pair.publicKeyHex);
    expect(verify(message, forged)).toBe(false);
  });

  it("refuses a public key that is not 64 hex characters", () => {
    expect(() => createVerifier("abc")).toThrow();
  });

  it("refuses small-order public keys at construction", () => {
    expect(() => createVerifier(ZERO_PUBLIC_KEY_HEX)).toThrow(/small-order/);
    expect(() => createVerifier(IDENTITY_PUBLIC_KEY_HEX)).toThrow(/small-order/);
  });

  it("refuses a key that is not a point on the curve", () => {
    // y = 2 has no square root for x on ed25519.
    expect(() => createVerifier("02" + "00".repeat(31))).toThrow(/valid Ed25519 point/);
  });
});

describe("createVerifierOrRejectAll", () => {
  it("returns the strict verifier for a usable key", () => {
    const verify = createVerifierOrRejectAll(pair.publicKeyHex);
    expect(verify(message, signBytes(message, pair.privateKey))).toBe(true);
    expect(verify(message, forged)).toBe(false);
  });

  it("rejects the forgery for small-order keys instead of accepting it", () => {
    for (const hex of [ZERO_PUBLIC_KEY_HEX, IDENTITY_PUBLIC_KEY_HEX]) {
      const verify = createVerifierOrRejectAll(hex);
      expect(verify).toBe(rejectAll);
      expect(verify(message, forged)).toBe(false);
      expect(verify(new TextEncoder().encode("other"), forged)).toBe(false);
    }
  });

  it("never accepts the forgery for the compiled-in key, placeholder or not", () => {
    const verify = createVerifierOrRejectAll(LICENSE_PUBLIC_KEY_HEX);
    expect(verify(message, forged)).toBe(false);
  });
});

describe("LICENSE_PUBLIC_KEY_HEX", () => {
  it("ships a placeholder public key that differs from any test key", () => {
    expect(LICENSE_PUBLIC_KEY_HEX).toMatch(/^[0-9a-f]{64}$/);
    expect(LICENSE_PUBLIC_KEY_HEX).not.toBe(pair.publicKeyHex);
  });
});
