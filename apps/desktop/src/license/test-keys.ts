import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import * as ed from "@noble/ed25519";

/** A throwaway Ed25519 pair for tests. Never the shipped key. */
export interface TestKeyPair {
  readonly publicKeyHex: string;
  readonly privateKey: KeyObject;
}

export function generateTestKeyPair(): TestKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  // The raw 32-byte key is the tail of the SPKI DER encoding.
  const spki = publicKey.export({ type: "spki", format: "der" });
  const raw = spki.subarray(spki.length - 32);
  return { publicKeyHex: Buffer.from(raw).toString("hex"), privateKey };
}

export function signBytes(message: Uint8Array, privateKey: KeyObject): Uint8Array {
  return new Uint8Array(sign(null, message, privateKey));
}

/** The all-zero placeholder key. A small-order point. */
export const ZERO_PUBLIC_KEY_HEX = "00".repeat(32);

/** The identity point, encoded. Also small order. */
export const IDENTITY_PUBLIC_KEY_HEX = "01" + "00".repeat(31);

/**
 * R = base point, S = 1. Under ZIP215 this verifies for any message against any
 * small-order public key, because [8]S·B = [8]R and [8]·A = 0. No private key needed.
 */
export function forgedSmallOrderSignature(): Uint8Array {
  const signature = new Uint8Array(64);
  signature.set(ed.Point.BASE.toBytes(), 0);
  signature[32] = 1;
  return signature;
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

/** Canonical JSON: sorted keys, UTF-8. Matches what the keygen signs. */
export function canonicalJson(payload: Readonly<Record<string, unknown>>): string {
  const sorted = Object.fromEntries(Object.entries(payload).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return JSON.stringify(sorted);
}

/** Builds TL1.<payload>.<signature>; a separate signedPayload lets a test tamper the body. */
export function issueKey(
  payload: Readonly<Record<string, unknown>>,
  privateKey: KeyObject,
  signedPayload: Readonly<Record<string, unknown>> = payload,
): string {
  const bytes = new TextEncoder().encode(canonicalJson(payload));
  const signedBytes = new TextEncoder().encode(canonicalJson(signedPayload));
  const signature = signBytes(signedBytes, privateKey);
  return `TL1.${base64url(bytes)}.${base64url(signature)}`;
}

/** A key anyone can mint without the private key. Only a small-order public key would accept it. */
export function forgeKey(payload: Readonly<Record<string, unknown>>): string {
  const bytes = new TextEncoder().encode(canonicalJson(payload));
  return `TL1.${base64url(bytes)}.${base64url(forgedSmallOrderSignature())}`;
}
