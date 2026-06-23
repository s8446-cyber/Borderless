// Authentication & cryptographic signing primitives (built-in crypto only).
//  - PINs are stored as salted scrypt hashes (versioned), never in plaintext.
//  - Session tokens are random 256-bit values (expiry enforced by the server).
//  - Each settled payment is signed with HMAC-SHA256 over its canonical fields,
//    giving a verifiable, tamper-evident authorization signature.
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";
import { config } from "./config.js";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

export function hashPin(pin) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(pin), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }).toString("hex");
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt, hash].join("$");
}

export function verifyPin(pin, stored) {
  if (!stored) return false;
  let salt, hash, N = 16384, r = 8, p = 1;
  if (stored.startsWith("scrypt$")) {
    const parts = stored.split("$");
    N = Number(parts[1]); r = Number(parts[2]); p = Number(parts[3]);
    salt = parts[4]; hash = parts[5];
  } else if (stored.includes(":")) {
    const parts = stored.split(":");
    salt = parts[0]; hash = parts[1];
  } else {
    return false;
  }
  if (!salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  let candidate;
  try {
    candidate = scryptSync(String(pin), salt, expected.length, { N, r, p });
  } catch {
    return false;
  }
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function newToken() {
  return "tok_" + randomBytes(32).toString("hex");
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
