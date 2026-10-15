export type LicensePlan = "personal" | "business";

/** Signed as canonical JSON (sorted keys, UTF-8). */
export interface LicensePayload {
  readonly v: 1;
  /** Licence id, ULID. Shown in About so a leaked key is traceable. */
  readonly lid: string;
  readonly product: "talos-desktop";
  readonly plan: LicensePlan;
  readonly seats: number;
  /** ISO date, YYYY-MM-DD. */
  readonly issuedAt: string;
  /** ISO date. Builds dated after this do not accept the key. */
  readonly updatesUntil: string;
  /** First 8 hex chars of sha256(lowercased buyer email). Not the email. */
  readonly tag: string;
}

export type LicenseInvalidReason =
  | "format"
  | "signature"
  | "product"
  | "version"
  | "build_too_new"
  | "revoked";

export type LicenseState =
  | { readonly status: "none" }
  | { readonly status: "invalid"; readonly reason: LicenseInvalidReason }
  | { readonly status: "valid"; readonly payload: LicensePayload };

export type Feature = "explainer" | "all_fixes" | "recheck";

/** Injected by the adapter so core license policy is testable without crypto. */
export type SignatureVerifier = (message: Uint8Array, signature: Uint8Array) => boolean;

export interface LicensePort {
  current(): Promise<LicenseState>;
  /** Verifies offline and stores the key on success. */
  install(key: string): Promise<LicenseState>;
  remove(): Promise<void>;
}
