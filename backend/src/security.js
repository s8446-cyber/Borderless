// Runtime security primitives: rate limiting, login lockout, security headers,
// CORS, input validation, and client-IP extraction.
import { config } from "./config.js";
import { ApiError } from "./fx.js";

// Sliding-window, in-memory rate limiter.
export class RateLimiter {
  constructor(opts) {
    this.windowMs = opts.windowMs;
    this.max = opts.max;
    this.hits = new Map();
  }
  check(key, now = Date.now()) {
    const arr = (this.hits.get(key) || []).filter((t) => now - t < this.windowMs);
    arr.push(now);
    this.hits.set(key, arr);
    if (arr.length > this.max) {
      const retryAfter = Math.ceil((this.windowMs - (now - arr[0])) / 1000);
      return { ok: false, retryAfter };
    }
    return { ok: true, remaining: this.max - arr.length };
  }
  sweep(now = Date.now()) {
    for (const [k, arr] of this.hits) {
      const fresh = arr.filter((t) => now - t < this.windowMs);
      if (fresh.length) this.hits.set(k, fresh);
      else this.hits.delete(k);
    }
  }
}

// Per-user failed-attempt lockout, backed by the store so it survives
// restarts. Lockouts are SCOPED ("login", "totp", "pin") so password, 2FA and
// payment-PIN failures accumulate and lock independently — a password-guessing
// burst cannot be used to lock a victim out of payments, and vice versa.
export class LoginGuard {
  constructor(store, opts) {
    this.store = store;
    this.maxFails = opts.maxFails;
    this.windowMs = opts.windowMs;
    this.lockMs = opts.lockMs;
  }
  _sec() {
    const d = this.store.data;
    if (!d.security) d.security = { fails: {}, locks: {} };
    return d.security;
  }
  _key(userId, scope) {
    return String(scope || "auth") + ":" + String(userId);
  }
  _norm(scope, now) {
    // Backward compatible: callers may pass (userId, now) with a numeric
    // second argument, or (userId, scope, now) with an explicit scope string.
    if (typeof scope === "number") return { scope: "auth", now: scope };
    return { scope: scope || "auth", now: now === undefined ? Date.now() : now };
  }
  assertNotLocked(userId, scopeOrNow, maybeNow) {
    const { scope, now } = this._norm(scopeOrNow, maybeNow);
    const s = this._sec();
    const key = this._key(userId, scope);
    const until = s.locks[key];
    if (until && until > now) {
      throw new ApiError(423, "account_locked", "Too many failed attempts. Try again in " + Math.ceil((until - now) / 1000) + "s");
    }
    if (until && until <= now) {
      delete s.locks[key];
      delete s.fails[key];
    }
  }
  recordFail(userId, scopeOrNow, maybeNow) {
    const { scope, now } = this._norm(scopeOrNow, maybeNow);
    const s = this._sec();
    const key = this._key(userId, scope);
    const arr = (s.fails[key] || []).filter((t) => now - t < this.windowMs);
    arr.push(now);
    s.fails[key] = arr;
    let locked = false;
    if (arr.length >= this.maxFails) {
      s.locks[key] = now + this.lockMs;
      locked = true;
    }
    return { fails: arr.length, locked };
  }
  recordSuccess(userId, scope = "auth") {
    const s = this._sec();
    const key = this._key(userId, scope);
    delete s.fails[key];
    delete s.locks[key];
  }
}

export function securityHeaders(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(self)");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  if (config.isProd) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
  }
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "form-action 'self'",
    ].join("; ")
  );
}

export function applyCors(req, res) {
  const origin = req.headers["origin"];
  const allowed = config.corsOrigins;
  if (allowed.includes("*")) {
    res.setHeader("Access-Control-Allow-Origin", "*");
  } else if (origin && allowed.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization, idempotency-key, x-device-id");
  res.setHeader("Access-Control-Max-Age", "600");
}

export function clientIp(req) {
  if (config.trustProxy) {
    const xff = req.headers["x-forwarded-for"];
    if (xff) return String(xff).split(",")[0].trim();
  }
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

// ---- input validators ----
export function asString(v, name, opts) {
  const o = opts || {};
  const max = o.max || 512;
  const isRequired = o.required !== false;
  if (v === null || v === undefined || v === "") {
    if (isRequired) throw new ApiError(400, "missing_field", name + " is required");
    return "";
  }
  if (typeof v !== "string") throw new ApiError(400, "bad_field", name + " must be a string");
  if (v.length > max) throw new ApiError(400, "field_too_long", name + " is too long");
  return v;
}

export function asAmount(v, name) {
  const n = Number(v);
  const label = name || "amount";
  if (!Number.isFinite(n)) throw new ApiError(400, "bad_amount", label + " must be a number");
  if (n <= 0) throw new ApiError(400, "bad_amount", label + " must be greater than zero");
  if (n > 1e9) throw new ApiError(400, "bad_amount", label + " exceeds the maximum");
  if (Math.round(n * 100) !== Number((n * 100).toFixed(6))) {
    throw new ApiError(400, "bad_amount", label + " supports at most 2 decimal places");
  }
  return n;
}

export function asPin(v) {
  const s = String(v === null || v === undefined ? "" : v);
  if (!/^[0-9]{4,6}$/.test(s)) throw new ApiError(400, "bad_pin_format", "PIN must be 4 to 6 digits");
  return s;
}

// Denylist of extremely common passwords (all >= 8 chars, lowercase). This is
// a lightweight offline screen — production should ALSO screen against a
// breached-corpus service such as the k-anonymity HIBP range API.
const COMMON_PASSWORDS = new Set([
  "password", "password1", "password12", "password123", "password1234",
  "passw0rd", "p@ssw0rd", "p@ssword", "password!", "password@123",
  "12345678", "123456789", "1234567890", "12345678910", "87654321",
  "11111111", "00000000", "11223344", "123123123", "123321123",
  "qwertyuiop", "qwerty123", "qwerty1234", "1q2w3e4r", "1q2w3e4r5t",
  "q1w2e3r4", "zaq12wsx", "qazwsxedc", "asdfghjkl", "asdf1234",
  "iloveyou", "sunshine", "princess", "football", "baseball",
  "superman", "whatever", "trustno1", "letmein1", "welcome1",
  "welcome123", "admin123", "administrator", "abc12345", "abcd1234",
  "monkey12", "dragon12", "master123", "shadow12", "michael1",
  "jessica1", "charlie1", "aa123456", "internet", "computer",
  "borderless", "borderless1",
]);

export function asPassword(v) {
  const s = asString(v, "password", { max: 200 });
  const min = config.passwordMinLength || 8;
  if (s.length < min) throw new ApiError(400, "weak_password", "Password must be at least " + min + " characters");
  if (COMMON_PASSWORDS.has(s.toLowerCase()) || /^(.)\1+$/.test(s)) {
    throw new ApiError(400, "weak_password", "This password is too common or predictable — choose a different one");
  }
  return s;
}

export function asEmail(v) {
  const s = asString(v, "email", { max: 254 }).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) throw new ApiError(400, "bad_email", "Enter a valid email address");
  return s;
}
