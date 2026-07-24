// Field-level encryption for sensitive data at rest (linked account numbers,
// TOTP seeds). AES-256-GCM with a random 96-bit IV per value; versioned wire
// format "v1:<iv>:<tag>:<ciphertext>" (hex) so the scheme can evolve.
// Keys come from config (BP_ENC_KEY / BP_ENC_KEY_PREVIOUS); the rotation
// procedure is documented in docs/RUNBOOK.md §8.
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

const ALGO = "aes-256-gcm";

export function encryptField(plaintext, key = config.encKey) {
  if (plaintext === null || plaintext === undefined) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("hex"), tag.toString("hex"), ct.toString("hex")].join(":");
}

// Accepts a single key (Buffer) or an ordered list of candidate keys.
// By default it tries the CURRENT key first, then BP_ENC_KEY_PREVIOUS when
// set — this is what makes key rotation zero-downtime: reads keep working
// under both keys while scripts/rotate-enc-key.mjs re-encrypts every stored
// field under the new one. GCM authentication guarantees a wrong key can
// never silently "decrypt" to garbage — it throws.
export function decryptField(blob, keyOrKeys) {
  if (blob === null || blob === undefined) return null;
  const parts = String(blob).split(":");
  if (parts.length !== 4 || parts[0] !== "v1") {
    throw new Error("decryptField: unrecognized ciphertext format");
  }
  const keys = keyOrKeys === undefined
    ? [config.encKey, config.encKeyPrevious].filter(Boolean)
    : (Array.isArray(keyOrKeys) ? keyOrKeys.filter(Boolean) : [keyOrKeys]);
  if (keys.length === 0) throw new Error("decryptField: no decryption key available");
  const iv = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const ct = Buffer.from(parts[3], "hex");
  let lastErr = null;
  for (const key of keys) {
    try {
      const decipher = createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      return pt.toString("utf8");
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("decryptField: unable to decrypt");
}

export function isEncrypted(value) {
  return typeof value === "string" && value.startsWith("v1:") && value.split(":").length === 4;
}

export function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
