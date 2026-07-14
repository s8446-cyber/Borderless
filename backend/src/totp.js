// TOTP two-factor authentication (RFC 6238 / RFC 4226) — built only on
// node:crypto. Secrets are stored AES-256-GCM-encrypted at rest and verified
// with constant-time comparison and a ±1-step clock-drift window.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s) {
  const clean = String(s).toUpperCase().replace(/=+$/g, "").replace(/\s/g, "");
  let bits = 0, value = 0;
  const out = [];
  for (const c of clean) {
    const idx = B32.indexOf(c);
    if (idx === -1) throw new Error("invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20)); // 160-bit secret per RFC 4226
}

// HOTP (RFC 4226): HMAC-SHA1 over the big-endian counter, dynamic truncation.
export function hotp(secretB32, counter, digits = 6) {
  const key = base32Decode(secretB32);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", key).update(msg).digest();
  const off = h[h.length - 1] & 0x0f;
  const code =
    ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 10 ** digits).padStart(digits, "0");
}

export function totp(secretB32, { time = Date.now(), step = 30, digits = 6 } = {}) {
  return hotp(secretB32, Math.floor(time / 1000 / step), digits);
}

// Constant-time verify with a ±window steps drift allowance.
export function verifyTotp(secretB32, code, { time = Date.now(), step = 30, digits = 6, window = 1 } = {}) {
  const given = String(code || "");
  if (!new RegExp(`^\\d{${digits}}$`).test(given)) return false;
  const counter = Math.floor(time / 1000 / step);
  let ok = false;
  for (let w = -window; w <= window; w++) {
    const expected = hotp(secretB32, counter + w, digits);
    const a = Buffer.from(expected);
    const b = Buffer.from(given);
    if (a.length === b.length && timingSafeEqual(a, b)) ok = true; // no early exit
  }
  return ok;
}

export function otpauthUri(secretB32, account, issuer = "Borderless Pay") {
  return (
    "otpauth://totp/" + encodeURIComponent(issuer) + ":" + encodeURIComponent(account) +
    "?secret=" + secretB32 +
    "&issuer=" + encodeURIComponent(issuer) +
    "&algorithm=SHA1&digits=6&period=30"
  );
}
