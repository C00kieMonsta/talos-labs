import { describe, expect, it } from "vitest";
import { LICENSE_PUBLIC_KEY_HEX } from "./public-key";
import { generateTestKeyPair, signBytes } from "./test-keys";
import { createVerifier } from "./verifier";

const pair = generateTestKeyPair();
const message = new TextEncoder().encode('{"product":"talos-desktop","v":1}');

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

  it("refuses a public key that is not 64 hex characters", () => {
    expect(() => createVerifier("abc")).toThrow();
  });

  it("ships a placeholder public key that differs from any test key", () => {
    expect(LICENSE_PUBLIC_KEY_HEX).toMatch(/^[0-9a-f]{64}$/);
    expect(LICENSE_PUBLIC_KEY_HEX).not.toBe(pair.publicKeyHex);
  });
});
