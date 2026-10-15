import type {
  LicenseInvalidReason,
  LicensePayload,
  LicensePlan,
  LicenseState,
  SignatureVerifier,
} from "../ports/license-port";
import { decodeBase64Url, decodeUtf8 } from "./base64url";

export const LICENSE_PREFIX = "TL1";
export const LICENSE_PRODUCT = "talos-desktop";
export const ED25519_SIGNATURE_BYTES = 64;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PLANS: readonly LicensePlan[] = ["personal", "business"];

function invalid(reason: LicenseInvalidReason): LicenseState {
  return { status: "invalid", reason };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Splits a key into its payload and signature bytes, or null when the format is wrong. */
export function splitLicenseKey(key: string): { payload: Uint8Array; signature: Uint8Array } | null {
  const parts = key.trim().split(".");
  if (parts.length !== 3 || parts[0] !== LICENSE_PREFIX) {
    return null;
  }
  const payload = decodeBase64Url(parts[1] ?? "");
  const signature = decodeBase64Url(parts[2] ?? "");
  if (payload === null || signature === null || payload.length === 0) {
    return null;
  }
  if (signature.length !== ED25519_SIGNATURE_BYTES) {
    return null;
  }
  return { payload, signature };
}

type Shaped = { readonly ok: true; readonly payload: LicensePayload } | { readonly ok: false; readonly reason: LicenseInvalidReason };

function shapePayload(value: unknown): Shaped {
  if (!isRecord(value)) {
    return { ok: false, reason: "format" };
  }
  if (value["v"] !== 1) {
    return { ok: false, reason: "version" };
  }
  if (value["product"] !== LICENSE_PRODUCT) {
    return { ok: false, reason: "product" };
  }
  const lid = value["lid"];
  const plan = value["plan"];
  const seats = value["seats"];
  const issuedAt = value["issuedAt"];
  const updatesUntil = value["updatesUntil"];
  const tag = value["tag"];
  if (
    typeof lid !== "string" ||
    lid.length === 0 ||
    typeof plan !== "string" ||
    !PLANS.includes(plan as LicensePlan) ||
    typeof seats !== "number" ||
    !Number.isInteger(seats) ||
    seats < 1 ||
    typeof issuedAt !== "string" ||
    !ISO_DATE.test(issuedAt) ||
    typeof updatesUntil !== "string" ||
    !ISO_DATE.test(updatesUntil) ||
    typeof tag !== "string"
  ) {
    return { ok: false, reason: "format" };
  }
  return {
    ok: true,
    payload: {
      v: 1,
      lid,
      product: LICENSE_PRODUCT,
      plan: plan as LicensePlan,
      seats,
      issuedAt,
      updatesUntil,
      tag,
    },
  };
}

/**
 * Verifies a key offline. The signature covers the exact payload bytes carried
 * in the key, so nothing is re-serialised. buildDate is YYYY-MM-DD.
 */
export function parseLicense(
  key: string,
  verify: SignatureVerifier,
  buildDate: string,
  revoked: ReadonlySet<string>,
): LicenseState {
  if (key.trim().length === 0) {
    return { status: "none" };
  }
  const parts = splitLicenseKey(key);
  if (parts === null) {
    return invalid("format");
  }
  let verified: boolean;
  try {
    verified = verify(parts.payload, parts.signature) === true;
  } catch {
    verified = false;
  }
  if (!verified) {
    return invalid("signature");
  }
  const text = decodeUtf8(parts.payload);
  if (text === null) {
    return invalid("format");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return invalid("format");
  }
  const shaped = shapePayload(parsed);
  if (!shaped.ok) {
    return invalid(shaped.reason);
  }
  if (!ISO_DATE.test(buildDate) || shaped.payload.updatesUntil < buildDate) {
    return invalid("build_too_new");
  }
  if (revoked.has(shaped.payload.lid)) {
    return invalid("revoked");
  }
  return { status: "valid", payload: shaped.payload };
}
