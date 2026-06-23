// Field-level encryption at rest (AES-256-GCM, authenticated) and a
// constant-time comparison helper. Sensitive values (e.g. raw account numbers)
// are never written to disk in plaintext.
import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

const ALGO = "aes-256-gcm";

// Returns "v1:<iv>:<tag>:<ciphertext>" (hex). null/undefined pass through.
export function encryptField(plaintext, key = config.encKey) {
  if (plaintext === null || plaintext === undefined) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("hex"), tag.toString("hex"), ct.toString("hex")].join(":");
}

export function decryptField(blob, key = config.encKey) {
  if (blob === null || blob === undefined) return null;
  const parts = String(blob).split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("invalid ciphertext format");
  const iv = Buffer.from(parts[1], "hex");
  const tag = Buffer.from(parts[2], "hex");
  const ct = Buffer.from(parts[3], "hex");
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

export function isEncrypted(v) {
  return typeof v === "string" && v.startsWith("v1:") && v.split(":").length === 4;
}

export function constantTimeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
