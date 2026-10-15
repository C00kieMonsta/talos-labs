/**
 * Talos Labs licence keygen. Ed25519 through node:crypto, no dependencies.
 *
 *   keygen keypair --out <path> [--force]       write a PKCS8 PEM private key (mode 0600), print the raw public key as hex
 *   keygen issue --plan personal|business --seats N --email a@b.c --updates-until YYYY-MM-DD [--lid <ulid>] [--issued-at YYYY-MM-DD]
 *   keygen verify <key> [--public-key <hex>]    print the payload or the failure
 *
 * The private key path for issue and verify comes from TALOS_SIGNING_KEY.
 * Run with: pnpm exec tsx scripts/keygen/keygen.ts <command>
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  sign,
  verify,
  type KeyObject,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const PREFIX = "TL1";
const PRODUCT = "talos-desktop";
const PLANS = ["personal", "business"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** DER prefix for an Ed25519 SubjectPublicKeyInfo; the raw 32 bytes follow it. */
const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

type Args = { readonly positional: readonly string[]; readonly flags: ReadonlyMap<string, string | true> };

function parseArgs(argv: readonly string[]): Args {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags.set(arg.slice(2), next);
        i += 1;
      } else {
        flags.set(arg.slice(2), true);
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function requireFlag(args: Args, name: string): string {
  const value = args.flags.get(name);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`missing --${name}`);
  }
  return value;
}

function fail(message: string): never {
  console.error(`keygen: ${message}`);
  process.exit(1);
}

function rawPublicKeyHex(publicKey: KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" });
  return der.subarray(der.length - 32).toString("hex");
}

function publicKeyFromHex(hex: string): KeyObject {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error("--public-key must be 64 hex characters");
  }
  return createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, Buffer.from(hex, "hex")]),
    format: "der",
    type: "spki",
  });
}

function loadPrivateKey(): KeyObject {
  const path = process.env["TALOS_SIGNING_KEY"];
  if (path === undefined || path.length === 0) {
    throw new Error("TALOS_SIGNING_KEY is not set");
  }
  return createPrivateKey(readFileSync(path, "utf8"));
}

function ulid(now = Date.now()): string {
  let time = "";
  let t = now;
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const random = randomBytes(16);
  let rand = "";
  for (let i = 0; i < 16; i += 1) {
    rand += CROCKFORD[(random[i] ?? 0) % 32];
  }
  return time + rand;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function canonicalJson(value: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    sorted[key] = value[key];
  }
  return JSON.stringify(sorted);
}

function cmdKeypair(args: Args): void {
  const out = requireFlag(args, "out");
  if (existsSync(out) && args.flags.get("force") !== true) {
    throw new Error(`${out} exists; pass --force to overwrite`);
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  writeFileSync(out, pem, { mode: 0o600, flag: "w" });
  console.log(rawPublicKeyHex(publicKey));
}

function cmdIssue(args: Args): void {
  const plan = requireFlag(args, "plan");
  if (!PLANS.includes(plan as (typeof PLANS)[number])) {
    throw new Error(`--plan must be one of ${PLANS.join(", ")}`);
  }
  const seats = Number(requireFlag(args, "seats"));
  if (!Number.isInteger(seats) || seats < 1) {
    throw new Error("--seats must be a positive integer");
  }
  const email = requireFlag(args, "email").trim().toLowerCase();
  const updatesUntil = requireFlag(args, "updates-until");
  const issuedAt = typeof args.flags.get("issued-at") === "string" ? String(args.flags.get("issued-at")) : today();
  if (!ISO_DATE.test(updatesUntil) || !ISO_DATE.test(issuedAt)) {
    throw new Error("dates must be YYYY-MM-DD");
  }
  const lid = typeof args.flags.get("lid") === "string" ? String(args.flags.get("lid")) : ulid();
  const tag = createHash("sha256").update(email, "utf8").digest("hex").slice(0, 8);
  const payload = canonicalJson({ v: 1, lid, product: PRODUCT, plan, seats, issuedAt, updatesUntil, tag });
  const payloadBytes = Buffer.from(payload, "utf8");
  const signature = sign(null, payloadBytes, loadPrivateKey());
  console.log(`${PREFIX}.${payloadBytes.toString("base64url")}.${signature.toString("base64url")}`);
}

function cmdVerify(args: Args): void {
  const key = args.positional[1];
  if (key === undefined) {
    throw new Error("usage: verify <key> --public-key <hex>");
  }
  const hex = args.flags.get("public-key");
  const publicKey =
    typeof hex === "string" ? publicKeyFromHex(hex) : createPublicKey(loadPrivateKey());
  const parts = key.trim().split(".");
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    fail("invalid: format");
  }
  const payloadBytes = Buffer.from(parts[1] ?? "", "base64url");
  const signature = Buffer.from(parts[2] ?? "", "base64url");
  if (payloadBytes.length === 0 || signature.length !== 64) {
    fail("invalid: format");
  }
  if (!verify(null, payloadBytes, publicKey, signature)) {
    fail("invalid: signature");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(payloadBytes.toString("utf8"));
  } catch {
    fail("invalid: format");
  }
  if (typeof payload !== "object" || payload === null) {
    fail("invalid: format");
  }
  const record = payload as Record<string, unknown>;
  if (record["v"] !== 1) {
    fail("invalid: version");
  }
  if (record["product"] !== PRODUCT) {
    fail("invalid: product");
  }
  console.log(JSON.stringify(record, null, 2));
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0];
  try {
    switch (command) {
      case "keypair":
        cmdKeypair(args);
        return;
      case "issue":
        cmdIssue(args);
        return;
      case "verify":
        cmdVerify(args);
        return;
      default:
        fail("usage: keygen keypair --out <path> | issue --plan ... | verify <key> --public-key <hex>");
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

main();
