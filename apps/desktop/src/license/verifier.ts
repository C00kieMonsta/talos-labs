import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import type { SignatureVerifier } from "@talos/core";

// noble's sync verify needs a sync SHA-512 configured once.
ed.hashes.sha512 = sha512;

const HEX_32_BYTES = /^[0-9a-fA-F]{64}$/;

/** Wraps ed.verify(signature, message, publicKey) into the (message, signature) shape core expects. */
export function createVerifier(publicKeyHex: string): SignatureVerifier {
  if (!HEX_32_BYTES.test(publicKeyHex)) {
    throw new Error("Licence public key must be 64 hex characters");
  }
  const publicKey = ed.etc.hexToBytes(publicKeyHex);
  return (message, signature) => {
    try {
      return ed.verify(signature, message, publicKey);
    } catch {
      return false;
    }
  };
}
