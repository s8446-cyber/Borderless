// Authentication & cryptographic signing primitives (built-in crypto only).
// - PINs are stored as salted scrypt hashes (versioned), never in plaintext.
// - Session tokens are random 256-bit values (expiry enforced by the server).
//   Only SHA-256 lookup hashes of session/refresh/reset tokens are stored at
//   rest (see tokenLookupKey) so a leaked store snapshot cannot be replayed.
// - Async scrypt variants are provided for network-facing password paths so a
//   burst of login attempts cannot monopolize the event loop (CPU exhaustion).
// - Each settled payment is signed with HMAC-SHA256 over its canonical fields,
//   giving a verifiable, tamper-evident authorization signature.
import { scrypt, scryptSync, randomBytes, timingSafeEqual, createHmac, createHash } from "node:crypto";
import { promisify } from "node:util";
import { config } from "./config.js";

const scryptAsync = promisify(scrypt);

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPin(pin) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(pin), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }).toString("hex");
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt, hash].join("$");
}

// Async variant for request-time hashing (signup, password change/reset).
export async function hashPinAsync(pin) {
  const salt = randomBytes(16).toString("hex");
  const buf = await scryptAsync(String(pin), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt, buf.toString("hex")].join("$");
}

function parseStoredHash(stored) {
  if (!stored) return null;
  let salt, hash, N = 16384, r = 8, p = 1;
  if (stored.startsWith("scrypt$")) {
    const parts = stored.split("$");
    N = Number(parts[1]); r = Number(parts[2]); p = Number(parts[3]);
    salt = parts[4]; hash = parts[5];
  } else if (stored.includes(":")) {
    const parts = stored.split(":");
    salt = parts[0]; hash = parts[1];
  } else {
    return null;
  }
  if (!salt || !hash) return null;
  return { salt, hash, N, r, p };
}

export function verifyPin(pin, stored) {
  const parsed = parseStoredHash(stored);
  if (!parsed) return false;
  const expected = Buffer.from(parsed.hash, "hex");
  let candidate;
  try {
    candidate = scryptSync(String(pin), parsed.salt, expected.length, { N: parsed.N, r: parsed.r, p: parsed.p });
  } catch {
    return false;
  }
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// Async variant for request-time verification (login, reauthentication).
export async function verifyPinAsync(pin, stored) {
  const parsed = parseStoredHash(stored);
  if (!parsed) return false;
  const expected = Buffer.from(parsed.hash, "hex");
  let candidate;
  try {
    candidate = await scryptAsync(String(pin), parsed.salt, expected.length, { N: parsed.N, r: parsed.r, p: parsed.p });
  } catch {
    return false;
  }
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function newToken() {
  return "tok_" + randomBytes(32).toString("hex");
}

export function newRefreshToken() {
  return "rtk_" + randomBytes(32).toString("hex");
}

export function newResetToken() {
  return "prt_" + randomBytes(32).toString("hex");
}

// One-way lookup key for storing session/refresh/reset tokens at rest.
// The client keeps the raw token; the server stores only sha256(token), so a
// database/backup leak does not yield replayable credentials.
export function tokenLookupKey(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function signPayment(fields) {
  const canonical = [
    fields.paymentId, fields.userId, fields.currency,
    fields.localAmount, fields.amountMinor, fields.feeMinor,
    fields.totalMinor, fields.settlementHash,
  ].join("|");
  return createHmac("sha256", config.signingSecret).update(canonical).digest("hex");
}

export function verifyPaymentSignature(fields, signature) {
  const expected = signPayment(fields);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(String(signature), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
