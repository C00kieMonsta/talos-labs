import { generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decodeBase64Url, encodeBase64Url, decodeUtf8, encodeUtf8 } from "../../src/license/base64url";
import { parseLicense } from "../../src/license/parse";
import type { LicensePayload, SignatureVerifier } from "../../src/ports/license-port";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const other = generateKeyPairSync("ed25519");

function verifierFor(key: KeyObject): SignatureVerifier {
  return (message, signature) => verify(null, Buffer.from(message), key, Buffer.from(signature));
}

const verifier = verifierFor(publicKey);
const BUILD_DATE = "2026-10-15";
const NONE = new Set<string>();

const PAYLOAD: LicensePayload = {
  v: 1,
  lid: "01J9ZK3M8Q4N7V2X5W6Y8A0B1C",
  product: "talos-desktop",
  plan: "personal",
  seats: 1,
  issuedAt: "2026-10-15",
  updatesUntil: "2027-10-15",
  tag: "d648b243",
};

function canonical(payload: object): string {
  const record = payload as Record<string, unknown>;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    sorted[key] = record[key];
  }
  return JSON.stringify(sorted);
}

function issue(payload: object, key: KeyObject = privateKey): string {
  const bytes = Buffer.from(canonical(payload), "utf8");
  const signature = sign(null, bytes, key);
  return `TL1.${bytes.toString("base64url")}.${signature.toString("base64url")}`;
}

describe("base64url and utf8 helpers", () => {
  it("round-trips bytes of every length", () => {
    for (let n = 0; n < 70; n += 1) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 0xff);
      const encoded = encodeBase64Url(bytes);
      expect(encoded).toBe(Buffer.from(bytes).toString("base64url"));
      expect(decodeBase64Url(encoded)).toEqual(bytes);
      expect(decodeBase64Url(`${encoded}${"=".repeat((4 - (encoded.length % 4)) % 4)}`)).toEqual(bytes);
    }
  });

  it("rejects bad characters and bad lengths", () => {
    expect(decodeBase64Url("ab+c")).toBeNull();
    expect(decodeBase64Url("ab/c")).toBeNull();
    expect(decodeBase64Url("a")).toBeNull();
    expect(decodeBase64Url("ab c")).toBeNull();
  });

  it("round-trips UTF-8 and rejects malformed bytes", () => {
    const text = "Talos £ ünïcode 😀";
    expect(decodeUtf8(encodeUtf8(text))).toBe(text);
    expect(encodeUtf8(text)).toEqual(Uint8Array.from(Buffer.from(text, "utf8")));
    expect(decodeUtf8(Uint8Array.from([0xff]))).toBeNull();
    expect(decodeUtf8(Uint8Array.from([0xc3]))).toBeNull();
    expect(decodeUtf8(Uint8Array.from([0xed, 0xa0, 0x80]))).toBeNull();
  });
});

describe("parseLicense", () => {
  it("accepts a valid key", () => {
    const state = parseLicense(issue(PAYLOAD), verifier, BUILD_DATE, NONE);
    expect(state).toEqual({ status: "valid", payload: PAYLOAD });
  });

  it("accepts a key with surrounding whitespace and a build dated on updatesUntil", () => {
    expect(parseLicense(`  ${issue(PAYLOAD)}\n`, verifier, "2027-10-15", NONE).status).toBe("valid");
  });

  it("rejects a tampered payload byte with signature", () => {
    const key = issue(PAYLOAD);
    const [prefix, payload, signature] = key.split(".");
    const chars = [...(payload ?? "")];
    const at = Math.floor(chars.length / 2);
    chars[at] = chars[at] === "A" ? "B" : "A";
    expect(parseLicense(`${prefix}.${chars.join("")}.${signature}`, verifier, BUILD_DATE, NONE)).toEqual({
      status: "invalid",
      reason: "signature",
    });
  });

  it("rejects a key signed with another private key, and a verifier with the wrong public key", () => {
    expect(parseLicense(issue(PAYLOAD, other.privateKey), verifier, BUILD_DATE, NONE)).toEqual({ status: "invalid", reason: "signature" });
    expect(parseLicense(issue(PAYLOAD), verifierFor(other.publicKey), BUILD_DATE, NONE)).toEqual({ status: "invalid", reason: "signature" });
  });

  it("treats a throwing verifier as a signature failure", () => {
    const throwing: SignatureVerifier = () => {
      throw new Error("no sha512");
    };
    expect(parseLicense(issue(PAYLOAD), throwing, BUILD_DATE, NONE)).toEqual({ status: "invalid", reason: "signature" });
  });

  it("rejects updatesUntil before the build date with build_too_new", () => {
    expect(parseLicense(issue(PAYLOAD), verifier, "2027-10-16", NONE)).toEqual({ status: "invalid", reason: "build_too_new" });
    expect(parseLicense(issue({ ...PAYLOAD, updatesUntil: "2026-10-14" }), verifier, BUILD_DATE, NONE)).toEqual({
      status: "invalid",
      reason: "build_too_new",
    });
  });

  it("rejects a revoked lid", () => {
    expect(parseLicense(issue(PAYLOAD), verifier, BUILD_DATE, new Set([PAYLOAD.lid]))).toEqual({ status: "invalid", reason: "revoked" });
  });

  it("rejects the wrong product and the wrong version", () => {
    expect(parseLicense(issue({ ...PAYLOAD, product: "talos-cloud" }), verifier, BUILD_DATE, NONE)).toEqual({ status: "invalid", reason: "product" });
    expect(parseLicense(issue({ ...PAYLOAD, v: 2 }), verifier, BUILD_DATE, NONE)).toEqual({ status: "invalid", reason: "version" });
  });

  it("rejects garbage input with format", () => {
    for (const garbage of ["garbage", "TL1.abc", "TL2.a.b", "TL1..", "TL1.!!.!!", `TL1.${"A".repeat(20)}.${"A".repeat(20)}`, "a.b.c.d"]) {
      expect(parseLicense(garbage, verifier, BUILD_DATE, NONE), garbage).toEqual({ status: "invalid", reason: "format" });
    }
  });

  it("rejects a signed payload that is not valid JSON or not a licence shape", () => {
    const sign1 = (text: string) => {
      const bytes = Buffer.from(text, "utf8");
      return `TL1.${bytes.toString("base64url")}.${sign(null, bytes, privateKey).toString("base64url")}`;
    };
    expect(parseLicense(sign1("not json"), verifier, BUILD_DATE, NONE)).toEqual({ status: "invalid", reason: "format" });
    expect(parseLicense(sign1("[1]"), verifier, BUILD_DATE, NONE)).toEqual({ status: "invalid", reason: "format" });
    expect(parseLicense(issue({ ...PAYLOAD, seats: "one" }), verifier, BUILD_DATE, NONE)).toEqual({ status: "invalid", reason: "format" });
    expect(parseLicense(issue({ ...PAYLOAD, plan: "enterprise" }), verifier, BUILD_DATE, NONE)).toEqual({ status: "invalid", reason: "format" });
    expect(parseLicense(issue({ ...PAYLOAD, updatesUntil: "next year" }), verifier, BUILD_DATE, NONE)).toEqual({ status: "invalid", reason: "format" });
  });

  it("returns none for an empty key", () => {
    expect(parseLicense("", verifier, BUILD_DATE, NONE)).toEqual({ status: "none" });
    expect(parseLicense("   ", verifier, BUILD_DATE, NONE)).toEqual({ status: "none" });
  });

  it("never calls the verifier for a malformed key", () => {
    let calls = 0;
    const counting: SignatureVerifier = () => {
      calls += 1;
      return true;
    };
    parseLicense("TL1.not-base64!.sig", counting, BUILD_DATE, NONE);
    expect(calls).toBe(0);
  });
});
