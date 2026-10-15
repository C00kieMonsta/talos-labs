import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import type { SignatureVerifier } from "@talos/core";

// noble's sync verify needs a sync SHA-512 configured once.
ed.hashes.sha512 = sha512;

const HEX_32_BYTES = /^[0-9a-fA-F]{64}$/;

/** Rejects every signature. The app runs unlicensed when no usable public key is compiled in. */
export const rejectAll: SignatureVerifier = () => false;

/**
 * Wraps ed.verify(signature, message, publicKey) into the (message, signature) shape core expects.
 * Strict RFC 8032 mode. noble's default ZIP215 mode accepts a forged signature for any small-order
 * key, and the all-zero placeholder key is one, so such keys are refused at construction.
 */
export function createVerifier(publicKeyHex: string): SignatureVerifier {
  if (!HEX_32_BYTES.test(publicKeyHex)) {
    throw new Error("Licence public key must be 64 hex characters");
  }
  const publicKey = ed.etc.hexToBytes(publicKeyHex);
  let point: ed.Point;
  try {
    point = ed.Point.fromBytes(publicKey);
  } catch {
    throw new Error("Licence public key is not a valid Ed25519 point");
  }
  if (point.isSmallOrder()) {
    throw new Error("Licence public key is a small-order point and cannot verify anything");
  }
  return (message, signature) => {
    try {
      return ed.verify(signature, message, publicKey, { zip215: false });
    } catch {
      return false;
    }
  };
}

/** createVerifier, but an unusable key leaves the app unlicensed instead of failing at startup. */
export function createVerifierOrRejectAll(publicKeyHex: string): SignatureVerifier {
  try {
    return createVerifier(publicKeyHex);
  } catch {
    return rejectAll;
  }
}
