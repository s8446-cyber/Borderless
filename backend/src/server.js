// Zero-dependency HTTP server: REST API + static web client.
// Built only on Node's http/fs/crypto, hardened for production:
// - security headers (CSP, HSTS, frame/sniff protection) on every response
// - per-IP sliding-window rate limiting (global + stricter auth/payment tiers)
// - CORS allowlist, body-size limits, strict JSON parsing
// - request IDs + structured logging, with sanitized error responses
// - tamper-evident dual ledger + audit log, integrity-checked at /api/ready
// - graceful shutdown with a final durable persist
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize, sep } from "node:path";
import { randomUUID, randomBytes, timingSafeEqual } from "node:crypto";
import { networkInterfaces } from "node:os";

import { config, configSummary } from "./config.js";
import { logger } from "./logger.js";
import { Metrics } from "./metrics.js";
import { Store } from "./store.js";
import { DualLedger } from "./ledger.js";
import { AuditLog } from "./audit.js";
import { PaymentService } from "./payments.js";
import { checkTxnLimits } from "./limits.js";
import { runKyc, KYC_PROVIDER } from "./kyc.js";
import { createMailer, buildResetEmail } from "./mailer.js";
import { hashPin, hashPinAsync, verifyPinAsync, newToken, newRefreshToken, newResetToken, tokenLookupKey } from "./auth.js";
import { encryptField, decryptField } from "./crypto.js";
import { generateTotpSecret, verifyTotp, otpauthUri } from "./totp.js";
import { ApiError, RATES, listCurrencies, FEE_PCT } from "./fx.js";
import { sha256 } from "./ledger.js";
import { fromMinor, formatINR } from "./money.js";
import {
  RateLimiter, LoginGuard, securityHeaders, applyCors, clientIp,
  asString, asPin, asAmount, asEmail, asPassword,
} from "./security.js";
import { RiskEngine, maskName } from "./risk.js";
import { screenParty } from "./screening.js";
import { AmlMonitor, LRS_PURPOSES } from "./aml.js";
import { PspConnector, verifyWebhook } from "./psp.js";
import { OpsService } from "./ops.js";
import { registerDsrRoutes } from "./dsr.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PUBLIC = join(ROOT, "public");
const DB_PATH = config.dbPath || join(ROOT, "data", "db.json");

// Static service catalogs for the UPI-style domestic flows. These are
// directories of real Indian billers/operators (the equivalent of a BBPS
// catalog), NOT user data — a production integration swaps them for the live
// BBPS catalog without changing the API shape.
const BILLERS = [
  { category: "Electricity", names: ["Tata Power", "Adani Electricity", "BESCOM", "MSEDCL"] },
  { category: "Water", names: ["Delhi Jal Board", "BWSSB", "MCGM Water"] },
  { category: "Gas", names: ["Indane Gas", "HP Gas", "Mahanagar Gas"] },
  { category: "Broadband", names: ["ACT Fibernet", "JioFiber", "Airtel Xstream"] },
  { category: "DTH", names: ["Tata Play", "Airtel Digital TV", "Dish TV"] },
  { category: "Credit Card", names: ["HDFC Card", "ICICI Card", "SBI Card"] },
];
const OPERATORS = ["Airtel", "Jio", "Vi", "BSNL"];

// Current policy versions. Consent is recorded against these, so a future
// policy change can re-prompt users whose accepted version is older.
const POLICY_VERSIONS = { tos: "1.0", privacy: "1.0" };

export function buildApp({ dbPath = DB_PATH, store: injectedStore, mailer: injectedMailer, riskOptions, amlOptions, pspTransport } = {}) {
  // Persistence backend: an injected store (e.g. PgStore) wins; otherwise the
  // file-backed reference store.
  const store = injectedStore || new Store(dbPath);
  // One-time migration: rehash any legacy PLAINTEXT token keys (tok_/rtk_/prt_)
  // to their SHA-256 lookup form, so no live session/refresh/reset credential
  // is ever stored at rest (a leaked snapshot is not replayable).
  migrateTokenKeys(store);
  // Outbound email (password-reset delivery). Injected in tests; built from
  // config otherwise (console transport in dev, real provider in prod).
  const mailer = injectedMailer || createMailer(config, { log: logger });
  const ledger = new DualLedger(store.data.ledger);
  const audit = new AuditLog(store.data.audit);
  const guard = new LoginGuard(store, config.lockout);
  // Payment-domain services: risk engine (payee-name verification,
  // beneficiary cooling, device caps, fraud scoring), AML monitor (SoF, LRS,
  // CTR/STR, transaction monitoring) and the PSP connector (settlement state
  // machine + timeout recovery). riskOptions/amlOptions override policy
  // thresholds and pspTransport injects a fake PSP — test hooks only.
  const risk = new RiskEngine(store, { ...config.risk, ...(riskOptions || {}) });
  const aml = new AmlMonitor(store, audit, { ...config.aml, ...(amlOptions || {}) });
  const psp = new PspConnector({ ...config.psp, transport: pspTransport });
  const payments = new PaymentService(store, ledger, {
    guard,
    audit,
    limitsCheck: checkTxnLimits,
    settlementMode: config.settlementMode,
    risk,
    screening: screenParty,
    aml,
    psp,
  });

  // persist ledger + audit back into the store on every save
  const persist = () => {
    store.data.ledger = ledger.toJSON();
    store.data.audit = audit.toJSON();
    store.persist();
  };

  // Ops back office: maker-checker action queue, dispute resolution,
  // reconciliation and settlement-break tracking.
  const ops = new OpsService({ store, payments, ledger, audit, aml, guard });

  // Device risk context: hash the presented device id and track first-seen,
  // so brand-new devices get tighter caps and fraud-score weight while young.
  function deviceContext(req, userId) {
    const presented = req.headers["x-device-id"];
    if (!presented) return null;
    const deviceHash = sha256(String(presented));
    if (!store.data.devices) store.data.devices = {};
    if (!store.data.devices[userId]) store.data.devices[userId] = {};
    let rec = store.data.devices[userId][deviceHash];
    if (!rec) {
      rec = { firstSeen: Date.now() };
      store.data.devices[userId][deviceHash] = rec;
    }
    return { deviceHash, isNew: Date.now() - rec.firstSeen < risk.newDeviceWindowMs };
  }

  // Apply an authenticated PSP webhook event (replay-protected by eventId).
  function applyPspEvent(event) {
    const eventId = typeof event.eventId === "string" && event.eventId ? event.eventId.slice(0, 80) : null;
    if (!eventId) throw new ApiError(400, "bad_event", "eventId required");
    if (!store.data.webhookSeen) store.data.webhookSeen = {};
    if (store.data.webhookSeen[eventId]) return { ok: true, replayed: true };
    let outcome = null;
    if (event.type === "settlement.settled") outcome = "settled";
    else if (event.type === "settlement.failed") outcome = "failed";
    else throw new ApiError(400, "bad_event", "Unsupported event type");
    const out = payments.resolvePsp({ paymentId: String(event.paymentId || ""), outcome, via: "webhook" });
    store.data.webhookSeen[eventId] = Date.now();
    persist();
    return { ok: true, status: out.status, alreadyFinal: Boolean(out.alreadyFinal) };
  }

  // A throwaway scrypt hash used to equalize login work when an email is
  // unknown. Without it, password verification short-circuits for non-existent
  // accounts and returns measurably faster than for real ones, leaking which
  // emails are registered (account enumeration by timing). Verifying against
  // this dummy makes both paths do the same scrypt work. Value is irrelevant
  // (never a real credential); it just needs to be a valid stored-hash shape.
  const DUMMY_PASS_HASH = hashPin("bp:login-timing-equalizer:" + randomUUID());

  const globalLimiter = new RateLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.max });
  const authLimiter = new RateLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.authMax });
  const paymentLimiter = new RateLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.paymentMax });
  const metrics = new Metrics();
  const limiterFor = (path) => {
    if (/^\/api\/(payments|transfers|upi|bills|recharge|topup)/.test(path) || /^\/api\/requests\/pay$/.test(path)) return paymentLimiter;
    if (/^\/api\/(accounts\/link|waitlist|sessions|auth|account\/(close|export|profile))/.test(path)) return authLimiter;
    return null;
  };

  const routes = [];
  const add = (method, pattern, handler) => routes.push({ method, pattern, handler });

  // ---- health & readiness ----
  add("GET", /^\/api\/health$/, async () => ({ ok: true, ts: Date.now() }));
  add("GET", /^\/api\/ready$/, async () => {
    const l = ledger.verify();
    const a = audit.verify();
    if (!l.ok || !a.ok) throw new ApiError(503, "not_ready", "integrity check failed");
    return { ready: true, ledger: l, audit: a };
  });

  add("GET", /^\/api\/currencies$/, async () => ({
    homeCurrency: "INR", feePct: FEE_PCT, rates: RATES, currencies: listCurrencies(),
  }));

  // Public, honest metadata: which settlement mode this deployment runs in.
  // Clients render a visible SANDBOX badge from this — transparency is a
  // feature, not a footnote.
  add("GET", /^\/api\/meta$/, async () => ({
    name: "Borderless Pay",
    settlementMode: config.settlementMode,
    kycProvider: config.kycProvider,
    policies: POLICY_VERSIONS,
  }));

  // ---- marketing-site early-access waitlist ----
  add("GET", /^\/api\/waitlist\/count$/, async () => ({ count: store.data.waitlist.length }));
  add("POST", /^\/api\/waitlist$/, async (req, body) => {
    const email = asEmail(body.email);
    store.data.waitlist = store.data.waitlist || [];
    if (!store.data.waitlist.some((w) => w.email === email)) {
      store.data.waitlist.push({ email, ts: Date.now() });
      audit.append("waitlist_signup", { domain: email.split("@")[1] });
      persist();
    }
    return { ok: true, count: store.data.waitlist.length };
  });

  // Who am I — the caller's own profile + onboarding state. This is how a
  // fresh sign-in on a new device restores the user (real name for the
  // greeting, whether a bank is linked, KYC status) instead of guessing.
  // Returns only the caller's own data; no secrets.
  add("GET", /^\/api\/me$/, async (req) => {
    const userId = requireAuth(req, store);
    const u = store.data.users[userId] || {};
    return {
      userId,
      name: u.name || null,
      email: u.email || null,
      country: u.country || null,
      kyc: u.kyc ? { status: u.kyc.status } : null,
      bankLinked: Boolean(store.data.accounts[userId]),
      consent: u.consent ? { tosVersion: u.consent.tosVersion, privacyVersion: u.consent.privacyVersion } : null,
    };
  });

  function issueSession(userId, deviceHash) {
    const now = Date.now();
    const token = newToken();
    // Tokens are stored ONLY as SHA-256 lookup hashes at rest — the raw token
    // exists client-side only, so a leaked store snapshot is not replayable.
    store.data.sessions[tokenLookupKey(token)] = { userId, exp: now + config.sessionTtlMs, createdAt: now, deviceHash: deviceHash || null };
    const refreshToken = newRefreshToken();
    store.data.refresh[tokenLookupKey(refreshToken)] = { userId, deviceHash: deviceHash || null, exp: now + config.refreshTtlMs, createdAt: now };
    return { token, refreshToken };
  }

  function credentialsByUser(userId) {
    for (const [email, cred] of Object.entries(store.data.credentials)) {
      if (cred.userId === userId) return { email, cred };
    }
    return null;
  }

  // Explicit, versioned user consent (DPDP Act 2023). Account creation is
  // refused without it, and what was accepted (and when) is recorded on the
  // user and in the tamper-evident audit log.
  function requireConsent(body) {
    const c = body.consent;
    if (!c) throw new ApiError(400, "consent_required", "You must accept the Terms of Service and Privacy Policy to continue");
    return {
      acceptedAt: Date.now(),
      tosVersion: (c && c.tosVersion) || POLICY_VERSIONS.tos,
      privacyVersion: (c && c.privacyVersion) || POLICY_VERSIONS.privacy,
    };
  }

  // Current policy versions + where the documents live (clients link these).
  add("GET", /^\/api\/policies$/, async () => ({
    versions: POLICY_VERSIONS,
    documents: { terms: "/terms.html", privacy: "/privacy.html" },
  }));

  // ---- Email + password authentication (the ONLY account-creation path) ----
  // Accounts exist exclusively behind a password: scrypt-hashed credentials,
  // lockout-guarded login, optional TOTP 2FA (secret AES-256-GCM-encrypted at
  // rest), and a password-reset flow that revokes every session on completion.
  // KYC screening runs inside signup via the pluggable provider registry
  // (src/kyc.js) — there is no passwordless account-creation endpoint.
  add("POST", /^\/api\/auth\/signup$/, async (req, body) => {
    const email = asEmail(body.email);
    const password = asPassword(body.password);
    asString(body.fullName, "fullName", { max: 120 });
    const country = asString(body.country, "country", { required: false, max: 60 }) || "IN";
    const consent = requireConsent(body);
    if (store.data.credentials[email]) throw new ApiError(409, "email_taken", "An account with this email already exists");
    const kyc = runKyc({ fullName: body.fullName, documentId: "email:" + email, country });
    const userId = "usr_" + randomUUID();
    store.data.users[userId] = { id: userId, name: body.fullName, email, country, kyc, consent };
    store.data.credentials[email] = { userId, passHash: await hashPinAsync(password), totpSecretEnc: null, totpEnabled: false, createdAt: Date.now() };
    const deviceId = asString(body.deviceId, "deviceId", { required: false, max: 200 });
    const issued = issueSession(userId, deviceId ? sha256(deviceId) : null);
    audit.append("user_signed_up", { userId, domain: email.split("@")[1], kycStatus: kyc.status, consent: { tosVersion: consent.tosVersion, privacyVersion: consent.privacyVersion } });
    persist();
    return { userId, ...issued, kyc };
  });

  // Account closure (DPDP data-principal rights: consent withdrawal + erasure).
  // Profile PII is erased and every session revoked. Transaction records are
  // retained PSEUDONYMOUSLY (userId only) — PMLA/RBI record-retention rules
  // require it, and the hash-chained ledger cannot be rewritten by design.
  add("POST", /^\/api\/account\/close$/, async (req, body) => {
    const userId = requireAuth(req, store);
    const found = credentialsByUser(userId);
    if (found) {
      // Recent reauthentication (irreversible action): a bearer token alone
      // is not enough to close an account — the caller must prove the
      // password. Failures count toward the login lockout scope.
      guard.assertNotLocked(userId, "login");
      const password = asString(body.password, "password", { max: 200 });
      if (!(await verifyPinAsync(password, found.cred.passHash))) {
        const r = guard.recordFail(userId, "login");
        audit.append("account_close_reauth_failed", { userId, locked: r.locked });
        persist();
        throw new ApiError(401, "reauth_required", "Enter your current password to close your account");
      }
      guard.recordSuccess(userId, "login");
    }
    if (found) delete store.data.credentials[found.email];
    delete store.data.pins[userId];
    delete store.data.accounts[userId];
    for (const [id, r] of Object.entries(store.data.requests || {})) {
      if (r.userId === userId) delete store.data.requests[id];
    }
    // keep a pseudonymous shell so ledger references stay resolvable
    store.data.users[userId] = { id: userId, closed: true, closedAt: Date.now() };
    const revoked = revokeAllForUser(userId);
    audit.append("account_closed", { userId, revoked });
    persist();
    return {
      ok: true,
      note: "Your profile data has been erased and all sessions revoked. Pseudonymous transaction records are retained as required by law (PMLA/RBI record retention).",
    };
  });

  add("POST", /^\/api\/auth\/login$/, async (req, body) => {
    const email = asEmail(body.email);
    const password = asString(body.password, "password", { max: 200 });
    const cred = store.data.credentials[email];
    if (cred) guard.assertNotLocked(cred.userId, "login");
    // Uniform error AND uniform work whether the email or the password is
    // wrong — no account enumeration. When the email is unknown we still run a
    // scrypt verification against a dummy hash so the response time doesn't
    // reveal that the account exists. Verification is called unconditionally
    // (no short-circuit) for the same reason, and runs on the async scrypt so
    // a login burst cannot monopolize the event loop. Password failures count
    // toward the "login" lockout scope only (PIN and TOTP are independent).
    const passOk = await verifyPinAsync(password, cred ? cred.passHash : DUMMY_PASS_HASH);
    if (!cred || !passOk) {
      if (cred) {
        const r = guard.recordFail(cred.userId, "login");
        audit.append("login_failed", { userId: cred.userId, locked: r.locked });
        persist();
      }
      throw new ApiError(401, "bad_credentials", "Invalid email or password");
    }
    if (cred.totpEnabled) {
      guard.assertNotLocked(cred.userId, "totp");
      const given = body.totp === undefined || body.totp === null ? "" : String(body.totp);
      if (!given) throw new ApiError(401, "totp_required", "Two-factor authentication code required");
      // A single-use recovery code is accepted in place of a TOTP code (the
      // documented lost-authenticator path). TOTP failures count toward
      // their own "totp" lockout scope.
      const usedRecovery = consumeRecoveryCode(cred, given);
      if (!usedRecovery && !verifyTotp(decryptField(cred.totpSecretEnc), given)) {
        const r = guard.recordFail(cred.userId, "totp");
        audit.append("totp_failed", { userId: cred.userId, locked: r.locked });
        persist();
        throw new ApiError(401, "bad_totp", "Invalid two-factor code");
      }
      if (usedRecovery) {
        audit.append("totp_recovery_code_used", { userId: cred.userId, remaining: (cred.recoveryCodes || []).length });
      }
      guard.recordSuccess(cred.userId, "totp");
    }
    guard.recordSuccess(cred.userId, "login");
    const deviceId = asString(body.deviceId, "deviceId", { required: false, max: 200 });
    const issued = issueSession(cred.userId, deviceId ? sha256(deviceId) : null);
    audit.append("login", { userId: cred.userId, totp: Boolean(cred.totpEnabled) });
    persist();
    return { userId: cred.userId, ...issued };
  });

  // TOTP 2FA — setup returns the secret + otpauth:// URI for authenticator
  // apps; a correct code must be proven before 2FA becomes enforced.
  add("POST", /^\/api\/auth\/2fa\/setup$/, async (req) => {
    const userId = requireAuth(req, store);
    const found = credentialsByUser(userId);
    if (!found) throw new ApiError(409, "no_credentials", "No password credentials found for this account");
    const secret = generateTotpSecret();
    found.cred.totpSecretEnc = encryptField(secret);
    found.cred.totpEnabled = false; // enforced only after a verified code
    audit.append("totp_setup", { userId });
    persist();
    return { secret, otpauth: otpauthUri(secret, found.email) };
  });

  add("POST", /^\/api\/auth\/2fa\/enable$/, async (req, body) => {
    const userId = requireAuth(req, store);
    const found = credentialsByUser(userId);
    if (!found || !found.cred.totpSecretEnc) throw new ApiError(409, "no_2fa_setup", "Run 2FA setup first");
    if (!verifyTotp(decryptField(found.cred.totpSecretEnc), String(body.code || ""))) {
      throw new ApiError(401, "bad_totp", "Invalid two-factor code");
    }
    found.cred.totpEnabled = true;
    // Single-use recovery codes (returned exactly once; stored only as
    // SHA-256 hashes) so a lost authenticator doesn't permanently lock the
    // account. Each code is consumable at login or 2FA-disable.
    const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(5).toString("hex"));
    found.cred.recoveryCodes = recoveryCodes.map((c) => sha256(c));
    audit.append("totp_enabled", { userId });
    persist();
    return { ok: true, totpEnabled: true, recoveryCodes };
  });

  // Disable TOTP 2FA. Requires the account password AND a current TOTP code
  // or an unused recovery code — a stolen bearer token alone can never strip
  // 2FA from an account.
  add("POST", /^\/api\/auth\/2fa\/disable$/, async (req, body) => {
    const userId = requireAuth(req, store);
    const found = credentialsByUser(userId);
    if (!found || !found.cred.totpEnabled) throw new ApiError(409, "no_2fa", "Two-factor authentication is not enabled");
    guard.assertNotLocked(userId, "login");
    const password = asString(body.password, "password", { max: 200 });
    if (!(await verifyPinAsync(password, found.cred.passHash))) {
      const r = guard.recordFail(userId, "login");
      audit.append("totp_disable_reauth_failed", { userId, locked: r.locked });
      persist();
      throw new ApiError(401, "bad_credentials", "Invalid password");
    }
    guard.recordSuccess(userId, "login");
    guard.assertNotLocked(userId, "totp");
    const given = String(body.code || "");
    const usedRecovery = consumeRecoveryCode(found.cred, given);
    if (!usedRecovery && !verifyTotp(decryptField(found.cred.totpSecretEnc), given)) {
      const r = guard.recordFail(userId, "totp");
      audit.append("totp_failed", { userId, locked: r.locked });
      persist();
      throw new ApiError(401, "bad_totp", "Invalid two-factor or recovery code");
    }
    guard.recordSuccess(userId, "totp");
    found.cred.totpEnabled = false;
    found.cred.totpSecretEnc = null;
    found.cred.recoveryCodes = [];
    audit.append("totp_disabled", { userId });
    persist();
    return { ok: true, totpEnabled: false };
  });

  // Authenticated password change. Requires the CURRENT password (recent
  // reauthentication), applies the full password policy to the new one, and
  // revokes every OTHER session plus all refresh tokens — the session making
  // the change stays alive; any stolen parallel session dies immediately.
  add("POST", /^\/api\/auth\/password\/change$/, async (req, body) => {
    const userId = requireAuth(req, store);
    const found = credentialsByUser(userId);
    if (!found) throw new ApiError(409, "no_credentials", "No password credentials found for this account");
    guard.assertNotLocked(userId, "login");
    const current = asString(body.currentPassword, "currentPassword", { max: 200 });
    const next = asPassword(body.newPassword);
    if (!(await verifyPinAsync(current, found.cred.passHash))) {
      const r = guard.recordFail(userId, "login");
      audit.append("password_change_failed", { userId, locked: r.locked });
      persist();
      throw new ApiError(401, "bad_credentials", "Current password is incorrect");
    }
    guard.recordSuccess(userId, "login");
    if (current === next) throw new ApiError(400, "same_password", "New password must be different from the current password");
    found.cred.passHash = await hashPinAsync(next);
    // Revoke everything except the session that made this change.
    const keep = tokenLookupKey(bearerToken(req));
    let revoked = 0;
    for (const [t, s] of Object.entries(store.data.sessions)) {
      if ((typeof s === "string" ? s : s.userId) === userId && t !== keep) { delete store.data.sessions[t]; revoked++; }
    }
    for (const [t, r] of Object.entries(store.data.refresh)) {
      if (r.userId === userId) { delete store.data.refresh[t]; revoked++; }
    }
    audit.append("password_changed", { userId, revokedOtherSessions: revoked });
    persist();
    return { ok: true, revokedOtherSessions: revoked };
  });

  // Password reset. The response is uniform whether or not the account exists
  // (no enumeration). The token is DELIVERED by the mailer (Resend/SendGrid in
  // production, console transport in dev) and never returned by the API in
  // production; in development it is additionally returned so the full flow is
  // testable without an email provider. A delivery failure is logged and
  // audited but never changes the response (no delivery oracle).
  add("POST", /^\/api\/auth\/password\/reset-request$/, async (req, body) => {
    const email = asEmail(body.email);
    const cred = store.data.credentials[email];
    const out = { ok: true };
    if (cred) {
      const token = newResetToken();
      // stored under its SHA-256 lookup key — never in plaintext at rest
      store.data.resets[tokenLookupKey(token)] = { email, exp: Date.now() + 1800000 }; // 30 min
      audit.append("password_reset_requested", { userId: cred.userId });
      logger.info("password_reset_token_issued", { userId: cred.userId }); // token itself never logged
      if (mailer.active) {
        const msg = buildResetEmail({ origin: config.appOrigin, token, ttlMinutes: 30 });
        const r = await mailer.send({ to: email, ...msg });
        if (r.sent) {
          audit.append("password_reset_email_sent", { userId: cred.userId, provider: r.provider });
        } else {
          logger.error("password_reset_email_failed", { userId: cred.userId, provider: r.provider, error: r.error });
          audit.append("password_reset_email_failed", { userId: cred.userId, provider: r.provider, error: r.error });
        }
      } else if (config.isProd) {
        // No mailer in production: the token exists but cannot reach the user.
        logger.error("password_reset_email_undeliverable", { userId: cred.userId, hint: "set BP_EMAIL_PROVIDER + BP_EMAIL_API_KEY" });
      }
      if (!config.isProd) out.resetToken = token; // dev convenience only
      persist();
    }
    return out;
  });

  add("POST", /^\/api\/auth\/password\/reset$/, async (req, body) => {
    const token = asString(body.token, "token", { max: 200 });
    const password = asPassword(body.newPassword);
    const tokenKey = tokenLookupKey(token);
    const rec = store.data.resets[tokenKey];
    if (!rec || Date.now() > rec.exp) {
      delete store.data.resets[tokenKey];
      persist();
      throw new ApiError(401, "bad_reset_token", "Invalid or expired reset token");
    }
    const cred = store.data.credentials[rec.email];
    if (!cred) throw new ApiError(401, "bad_reset_token", "Invalid or expired reset token");
    cred.passHash = await hashPinAsync(password);
    delete store.data.resets[tokenKey];
    const revoked = revokeAllForUser(cred.userId); // a reset kills every live session
    guard.recordSuccess(cred.userId, "login"); // clear any login lockout so the user can log in
    audit.append("password_reset_completed", { userId: cred.userId, revoked });
    persist();
    return { ok: true };
  });

  function revokeAllForUser(userId) {
    let revoked = 0;
    for (const [t, s] of Object.entries(store.data.sessions)) {
      if ((typeof s === "string" ? s : s.userId) === userId) { delete store.data.sessions[t]; revoked++; }
    }
    for (const [t, r] of Object.entries(store.data.refresh)) {
      if (r.userId === userId) { delete store.data.refresh[t]; revoked++; }
    }
    return revoked;
  }

  // Rotate a refresh token (G-3): the old token is retired and a fresh
  // access+refresh pair is issued. Reusing an already-rotated refresh token is
  // treated as a theft signal — ALL of that user's sessions are revoked.
  add("POST", /^\/api\/sessions\/refresh$/, async (req, body) => {
    const rt = asString(body.refreshToken, "refreshToken", { max: 200 });
    const rtKey = tokenLookupKey(rt);
    const rec = store.data.refresh[rtKey];
    if (!rec) throw new ApiError(401, "bad_refresh_token", "Unknown refresh token");
    if (rec.rotatedTo) {
      // reuse of a rotated token → assume compromise, kill everything
      const revoked = revokeAllForUser(rec.userId);
      audit.append("refresh_reuse_detected", { userId: rec.userId, revoked });
      persist();
      throw new ApiError(401, "refresh_reused", "Refresh token reuse detected; all sessions revoked");
    }
    if (Date.now() > rec.exp) {
      delete store.data.refresh[rtKey];
      persist();
      throw new ApiError(401, "refresh_expired", "Refresh token expired, please re-authenticate");
    }
    if (rec.deviceHash) {
      const deviceId = asString(body.deviceId, "deviceId", { required: false, max: 200 });
      if (!deviceId || sha256(deviceId) !== rec.deviceHash) {
        audit.append("refresh_device_mismatch", { userId: rec.userId });
        persist();
        throw new ApiError(401, "device_mismatch", "Refresh token is bound to a different device");
      }
    }
    const issued = issueSession(rec.userId, rec.deviceHash);
    rec.rotatedTo = tokenLookupKey(issued.refreshToken); // marker only — the new record's lookup key, never the live token
    audit.append("session_refreshed", { userId: rec.userId });
    persist();
    return issued;
  });

  // Logout: explicit session revocation (the token is dead server-side immediately)
  add("POST", /^\/api\/logout$/, async (req) => {
    const userId = requireAuth(req, store);
    delete store.data.sessions[tokenLookupKey(bearerToken(req))];
    audit.append("logout", { userId });
    persist();
    return { ok: true };
  });

  // Revoke ALL sessions + refresh tokens for the caller (G-3) — the "log me
  // out everywhere" panic button after a lost or compromised device.
  add("POST", /^\/api\/sessions\/revoke-all$/, async (req) => {
    const userId = requireAuth(req, store);
    const revoked = revokeAllForUser(userId);
    audit.append("sessions_revoked_all", { userId, revoked });
    persist();
    return { ok: true, revoked };
  });

  // Link bank account. Balances always start at ZERO — money only ever enters
  // through the explicit, audited /api/topup flow (no invented funds, no
  // seeded data). Re-linking updates the bank details but never touches an
  // existing balance.
  add("POST", /^\/api\/accounts\/link$/, async (req, body) => {
    const userId = requireAuth(req, store);
    const bank = asString(body.bank, "bank", { max: 80 });
    const existing = store.data.accounts[userId];
    store.data.accounts[userId] = {
      bank,
      maskedNumber: asString(body.maskedNumber, "maskedNumber", { required: false, max: 40 }) || ("\u2022\u2022\u2022\u2022" + Math.floor(1000 + Math.random() * 9000)),
      currency: "INR",
      balanceMinor: existing ? existing.balanceMinor : 0,
      accountRefEnc: body.accountNumber ? encryptField(String(body.accountNumber)) : (existing ? existing.accountRefEnc : null),
    };
    if (body.pin) store.data.pins[userId] = await hashPinAsync(asPin(body.pin));
    audit.append("account_linked", { userId, bank });
    persist();
    const a = store.data.accounts[userId];
    return { bank: a.bank, maskedNumber: a.maskedNumber, balance: fromMinor(a.balanceMinor), balanceMinor: a.balanceMinor };
  });

  // Add money to the balance (the ONLY funding path). PIN-authorized,
  // idempotent, velocity-limited in its own daily bucket, double-entry
  // balanced against the funding account, and stamped with the settlement
  // mode so a sandbox credit can never masquerade as real money.
  add("POST", /^\/api\/topup$/, async (req, body) => {
    const userId = requireAuth(req, store);
    asPin(body.pin);
    asAmount(body.amount, "amount");
    const out = payments.topup({
      userId, pin: body.pin, amountINR: Number(body.amount),
      sourceOfFunds: body.sourceOfFunds,
      idempotencyKey: req.headers["idempotency-key"],
    });
    persist();
    return { replayed: out.replayed, receipt: decorate(out.receipt) };
  });

  add("GET", /^\/api\/accounts$/, async (req) => {
    const userId = requireAuth(req, store);
    const a = store.data.accounts[userId];
    if (!a) throw new ApiError(404, "no_account", "No account linked");
    return { bank: a.bank, maskedNumber: a.maskedNumber, balanceMinor: a.balanceMinor, balance: fromMinor(a.balanceMinor) };
  });

  // Quote (cross-border)
  add("POST", /^\/api\/quotes$/, async (req, body) => {
    asString(body.currency, "currency", { max: 8 });
    asAmount(body.localAmount, "localAmount");
    const q = payments.quote(body.currency, Number(body.localAmount));
    return { ...q, amount: fromMinor(q.amountMinor), fee: fromMinor(q.feeMinor), total: fromMinor(q.totalMinor) };
  });

  // Execute cross-border payment (idempotent via Idempotency-Key header)
  add("POST", /^\/api\/payments$/, async (req, body) => {
    const userId = requireAuth(req, store);
    asPin(body.pin);
    const out = payments.execute({
      userId,
      quoteId: asString(body.quoteId, "quoteId", { max: 80 }),
      pin: body.pin,
      merchant: body.merchant,
      purposeCode: body.purposeCode ? asString(body.purposeCode, "purposeCode", { max: 12 }) : undefined,
      pan: body.pan ? asString(body.pan, "pan", { max: 12 }) : undefined,
      device: deviceContext(req, userId),
      idempotencyKey: req.headers["idempotency-key"],
    });
    persist();
    return { replayed: out.replayed, receipt: decorate(out.receipt) };
  });

  add("GET", /^\/api\/payments$/, async (req) => {
    const userId = requireAuth(req, store);
    return { payments: payments.history(userId).map(decorate) };
  });

  // ---- P2P transfers ----
  add("POST", /^\/api\/transfers\/quote$/, async (req, body) => {
    requireAuth(req, store);
    asString(body.recipientCurrency, "recipientCurrency", { max: 8 });
    asAmount(body.sendAmount, "sendAmount");
    const q = payments.quoteTransfer(body.recipientCurrency, Number(body.sendAmount));
    return { ...q, sendAmount: fromMinor(q.sendAmountMinor), fee: fromMinor(q.feeMinor), total: fromMinor(q.totalMinor) };
  });

  add("POST", /^\/api\/transfers$/, async (req, body) => {
    const userId = requireAuth(req, store);
    asPin(body.pin);
    const out = payments.transfer({
      userId,
      quoteId: asString(body.quoteId, "quoteId", { max: 80 }),
      pin: body.pin,
      recipient: body.recipient,
      purposeCode: body.purposeCode ? asString(body.purposeCode, "purposeCode", { max: 12 }) : undefined,
      pan: body.pan ? asString(body.pan, "pan", { max: 12 }) : undefined,
      device: deviceContext(req, userId),
      idempotencyKey: req.headers["idempotency-key"],
    });
    persist();
    return { replayed: out.replayed, receipt: decorate(out.receipt) };
  });

  // ---- Domestic payments (UPI-style: phone / UPI ID / bank / scan; instant, zero fee) ----
  add("POST", /^\/api\/upi\/pay$/, async (req, body) => {
    const userId = requireAuth(req, store);
    asPin(body.pin);
    asAmount(body.amount, "amount");
    const out = payments.payDomestic({
      userId, pin: body.pin, amountINR: Number(body.amount),
      payee: body.payee, kind: (body.payee && body.payee.kind) || "upi",
      device: deviceContext(req, userId),
      idempotencyKey: req.headers["idempotency-key"],
    });
    persist();
    return { replayed: out.replayed, receipt: decorate(out.receipt) };
  });

  // Bill payments (electricity, water, gas, broadband, DTH, etc.)
  add("POST", /^\/api\/bills\/pay$/, async (req, body) => {
    const userId = requireAuth(req, store);
    asPin(body.pin);
    asAmount(body.amount, "amount");
    const biller = body.biller || {};
    const out = payments.payDomestic({
      userId, pin: body.pin, amountINR: Number(body.amount),
      payee: { name: biller.name || biller.category || "Biller", type: "bill", category: biller.category, consumerId: biller.consumerId },
      kind: "bill", device: deviceContext(req, userId),
      idempotencyKey: req.headers["idempotency-key"],
    });
    persist();
    return { replayed: out.replayed, receipt: decorate(out.receipt) };
  });

  // Mobile / DTH recharge
  add("POST", /^\/api\/recharge$/, async (req, body) => {
    const userId = requireAuth(req, store);
    asPin(body.pin);
    asAmount(body.amount, "amount");
    const rc = body.recharge || {};
    const out = payments.payDomestic({
      userId, pin: body.pin, amountINR: Number(body.amount),
      payee: { name: (rc.operator || "Operator") + " " + (rc.number || ""), type: "recharge", operator: rc.operator, number: rc.number, plan: rc.plan },
      kind: "recharge", device: deviceContext(req, userId),
      idempotencyKey: req.headers["idempotency-key"],
    });
    persist();
    return { replayed: out.replayed, receipt: decorate(out.receipt) };
  });

  // ---- Collect requests (request money) ----
  add("POST", /^\/api\/requests$/, async (req, body) => {
    const userId = requireAuth(req, store);
    asAmount(body.amount, "amount");
    const r = payments.createRequest({ userId, fromName: body.fromName, amountINR: Number(body.amount), note: body.note });
    persist();
    return { request: { ...r, amount: fromMinor(r.amountMinor) } };
  });

  add("GET", /^\/api\/requests$/, async (req) => {
    const userId = requireAuth(req, store);
    return { requests: payments.listRequests(userId).map((r) => ({ ...r, amount: fromMinor(r.amountMinor) })) };
  });

  add("POST", /^\/api\/requests\/pay$/, async (req, body) => {
    const userId = requireAuth(req, store);
    asPin(body.pin);
    const out = payments.payRequest({ userId, requestId: asString(body.requestId, "requestId", { max: 80 }), pin: body.pin, device: deviceContext(req, userId), idempotencyKey: req.headers["idempotency-key"] });
    persist();
    return { replayed: out.replayed, receipt: decorate(out.receipt) };
  });

  // Recent payees — REAL data, derived from the caller's own transaction
  // history (most recent first, deduplicated). New accounts correctly get an
  // empty list; there is no fake directory anywhere.
  add("GET", /^\/api\/contacts$/, async (req) => {
    const userId = requireAuth(req, store);
    const seen = new Set();
    const payees = [];
    for (const p of payments.history(userId)) {
      let entry = null;
      if (p.kind === "p2p" && p.recipient && p.recipient.name) {
        entry = { name: p.recipient.name, phone: null, vpa: null };
      } else if (p.domestic && p.payee && p.payee.name &&
        ["upi", "phone", "contact", "merchant", "bank", "request"].includes(p.payee.type)) {
        entry = { name: p.payee.name, phone: p.payee.phone || null, vpa: p.payee.vpa || null };
      }
      if (!entry) continue;
      const key = (entry.vpa || entry.phone || entry.name).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const parts = entry.name.trim().split(/\s+/);
      entry.initials = ((parts[0][0] || "") + (parts[1] ? parts[1][0] : "")).toUpperCase();
      payees.push(entry);
      if (payees.length >= 8) break;
    }
    return { contacts: payees };
  });

  // Service catalogs (billers / operators) for the domestic flows.
  // ---- Payment-domain: LRS catalog, payee verification, disputes ----

  // LRS purpose-code catalog + documentation thresholds (cross-border).
  add("GET", /^\/api\/lrs\/purposes$/, async () => ({
    purposes: Object.entries(LRS_PURPOSES).map(([code, label]) => ({ code, label })),
    docThresholdMinor: aml.lrsDocThresholdMinor,
    annualCapMinor: aml.lrsAnnualCapMinor,
  }));

  // Payee-name verification ("verify before you pay"). Returns only a MASKED
  // registered name so the endpoint can't be used to harvest account names.
  add("POST", /^\/api\/payees\/verify$/, async (req, body) => {
    requireAuth(req, store);
    const v = risk.verifyPayeeName(body.payee || {});
    return { result: v.result, registeredName: v.registeredName ? maskName(v.registeredName) : null };
  });

  // Customer disputes: open + list own cases. Resolution is ops-only
  // (maker-checker) through the back office.
  add("POST", /^\/api\/disputes$/, async (req, body) => {
    const userId = requireAuth(req, store);
    const dispute = ops.openDispute({
      userId,
      paymentId: asString(body.paymentId, "paymentId", { max: 80 }),
      reason: asString(body.reason, "reason", { required: false, max: 400 }) || "unspecified",
    });
    persist();
    return { dispute };
  });
  add("GET", /^\/api\/disputes$/, async (req) => {
    const userId = requireAuth(req, store);
    return { disputes: ops.listDisputes(userId) };
  });

  // ---- DSR (DPDP data-principal rights): data-access export + correction ----
  // POST /api/account/export and POST /api/account/profile (src/dsr.js).
  // Both require recent password reauthentication, sit on the stricter auth
  // rate-limit tier (limiterFor above), and complete the rights triad next to
  // consent withdrawal + erasure (POST /api/account/close).
  registerDsrRoutes({ add, store, guard, audit, persist, payments, ops, requireAuth, credentialsByUser });

  // ---- Operations back office (ops-token gated, maker-checker) ----
  add("GET", /^\/api\/ops\/overview$/, async (req) => { requireOps(req); return ops.overview(); });
  add("GET", /^\/api\/ops\/alerts$/, async (req) => { requireOps(req); return { alerts: (store.data.aml || {}).alerts || [] }; });
  add("GET", /^\/api\/ops\/reports$/, async (req) => { requireOps(req); return { reports: (store.data.aml || {}).reports || [] }; });
  add("GET", /^\/api\/ops\/holds$/, async (req) => {
    requireOps(req);
    return { holds: Object.entries(store.data.riskHolds || {}).map(([paymentId, h]) => ({ paymentId, ...h })) };
  });
  add("GET", /^\/api\/ops\/disputes$/, async (req) => { requireOps(req); return { disputes: Object.values(store.data.disputes || {}) }; });
  add("GET", /^\/api\/ops\/actions$/, async (req) => { requireOps(req); return { actions: Object.values((store.data.ops || {}).actions || {}) }; });
  add("POST", /^\/api\/ops\/actions$/, async (req, body) => {
    const actor = requireOps(req);
    const action = ops.createAction({ type: asString(body.type, "type", { max: 40 }), params: body.params || {}, makerId: actor });
    persist();
    return { action };
  });
  add("POST", /^\/api\/ops\/actions\/approve$/, async (req, body) => {
    const actor = requireOps(req);
    const action = ops.approveAction({ actionId: asString(body.actionId, "actionId", { max: 80 }), checkerId: actor });
    persist();
    return { action };
  });
  add("POST", /^\/api\/ops\/actions\/reject$/, async (req, body) => {
    const actor = requireOps(req);
    const action = ops.rejectAction({ actionId: asString(body.actionId, "actionId", { max: 80 }), checkerId: actor, reason: body.reason || body.note });
    persist();
    return { action };
  });
  add("POST", /^\/api\/ops\/recon\/run$/, async (req) => {
    requireOps(req);
    const out = ops.reconcile();
    persist();
    return out;
  });
  add("GET", /^\/api\/ops\/recon\/breaks$/, async (req) => { requireOps(req); return { breaks: (store.data.recon || {}).breaks || [] }; });
  add("POST", /^\/api\/ops\/recon\/breaks\/resolve$/, async (req, body) => {
    const actor = requireOps(req);
    const resolved = ops.resolveBreak({ breakId: asString(body.breakId, "breakId", { max: 80 }), note: body.note, actor });
    persist();
    return { break: resolved };
  });
  add("POST", /^\/api\/ops\/psp\/recover$/, async (req) => {
    requireOps(req);
    const out = payments.recoverPspPending();
    persist();
    return out;
  });

  add("GET", /^\/api\/billers$/, async () => ({ billers: BILLERS }));
  add("GET", /^\/api\/operators$/, async () => ({ operators: OPERATORS }));

  // Ledger inspection / integrity verification. NOTE: this is an unauthenticated
  // endpoint, so it must never expose transaction contents. We return only the
  // head's index + hash (for chain-tip verification) and the public anchors
  // (Merkle roots + simulated public-chain tx hashes — no PII).
  add("GET", /^\/api\/ledger$/, async () => ({
    blocks: ledger.blocks.length, anchors: ledger.anchors.length,
    auditEntries: audit.entries.length,
    head: { index: ledger.head.index, hash: ledger.head.hash },
    anchorList: ledger.anchors,
  }));
  add("GET", /^\/api\/ledger\/verify$/, async () => ledger.verify());
  add("GET", /^\/api\/audit\/verify$/, async () => audit.verify());

  // Merkle inclusion proof for a settlement block (G-4). PUBLIC and PII-free:
  // returns only hashes — the block hash from a receipt, the sibling path, and
  // the anchor root — so anyone can independently verify that a receipt's
  // settlement is committed under a published anchor.
  add("GET", /^\/api\/ledger\/proof\/\d+$/, async (req, body, url) => {
    const index = Number(url.pathname.split("/").pop());
    const p = ledger.proof(index);
    if (!p) throw new ApiError(404, "not_anchored", "Block not found or not anchored yet");
    return p;
  });

  // ---- request handling ----
  const server = createServer(async (req, res) => {
    const requestId = logger.requestId();
    const ip = clientIp(req);
    const t0 = Date.now();
    securityHeaders(res);
    applyCors(req, res);
    try {
      if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname;

      if (path.startsWith("/api/")) {
        // Record every API request's route/status/latency at response time.
        // The label is a STABLE route, never the raw path: an unmatched path is
        // fully attacker-controlled, so folding it into a single "unmatched"
        // bucket prevents metric-cardinality memory exhaustion (a flood of
        // distinct /api/ paths would otherwise allocate one series each).
        let routeLabel = "/api/unmatched";
        if (path !== "/api/metrics") {
          res.on("finish", () => metrics.recordHttp(req.method, routeLabel, res.statusCode, Date.now() - t0));
        }

        // Prometheus scrape endpoint (G-7). Text format, not JSON. In
        // production it requires the BP_METRICS_TOKEN bearer; if none is
        // configured in prod the endpoint stays hidden (fail-closed).
        if (path === "/api/metrics") {
          if (config.metricsToken) {
            if (bearerToken(req) !== config.metricsToken) return send(res, 401, { error: "unauthorized" }, requestId);
          } else if (config.isProd) {
            return send(res, 404, { error: "not_found" }, requestId);
          }
          res.statusCode = 200;
          res.setHeader("content-type", "text/plain; version=0.0.4; charset=utf-8");
          res.end(metrics.render({ ledger, audit, store }));
          return;
        }

        const gl = globalLimiter.check(ip);
        if (!gl.ok) return rateLimited(res, gl.retryAfter, requestId, ip, path, "global");
        const tier = limiterFor(path);
        if (tier) {
          const tl = tier.check(ip);
          if (!tl.ok) return rateLimited(res, tl.retryAfter, requestId, ip, path, "tier");
        }

        // PSP settlement webhook. The HMAC signature is verified over the RAW
        // request bytes BEFORE parsing (re-serialization can't bypass it) and
        // replays are rejected by eventId. Fail-closed: without a configured
        // webhook secret the endpoint does not exist.
        if (path === "/api/webhooks/psp") {
          if (!config.webhookSecret) return send(res, 404, { error: "not_found" }, requestId);
          if (req.method !== "POST") { res.setHeader("allow", "POST"); return send(res, 405, { error: "method_not_allowed" }, requestId); }
          const raw = await readRawBody(req);
          verifyWebhook({
            secret: config.webhookSecret,
            timestamp: req.headers["x-psp-timestamp"],
            signature: req.headers["x-psp-signature"],
            rawBody: raw,
          });
          let event;
          try { event = JSON.parse(raw || "{}"); }
          catch { throw new ApiError(400, "bad_json", "Invalid JSON body"); }
          routeLabel = "/api/webhooks/psp";
          return send(res, 200, applyPspEvent(event), requestId);
        }

        const matching = routes.filter((r) => r.pattern.test(path));
        if (!matching.length) return send(res, 404, { error: "not_found", path }, requestId);
        // The path matched a known route pattern — safe to record its
        // normalized (ID-collapsed) form as the metrics label.
        routeLabel = metrics.route(path);
        const match = matching.find((r) => r.method === req.method);
        if (!match) {
          res.setHeader("allow", matching.map((r) => r.method).join(", "));
          return send(res, 405, { error: "method_not_allowed" }, requestId);
        }
        const body = req.method === "POST" ? await readBody(req) : {};
        const result = await match.handler(req, body, url, { ip, requestId });
        // Durability-before-ACK: money-moving handlers have already called
        // persist(). For the async Postgres store, AWAIT the durable write
        // before returning success — so a crash can never lose a payment the
        // client was told settled. If the durable write failed, flush()
        // rejects and this becomes a 500 (no false "success"). The file store
        // has no flush() and is already synchronous, so this is a no-op there.
        if (result && result.receipt && typeof store.flush === "function") await store.flush();
        // business metrics: count fresh settlements (idempotent replays excluded)
        if (result && result.receipt && result.replayed === false) metrics.recordPayment(result.receipt);
        return send(res, 200, result, requestId);
      }
      return serveStatic(res, url.pathname);
    } catch (err) {
      if (err instanceof ApiError) return send(res, err.status, { error: err.code, message: err.message }, requestId);
      logger.error("unhandled_error", { requestId, ip, message: String(err && err.message), stack: err && err.stack });
      const payload = config.isProd
        ? { error: "internal", requestId }
        : { error: "internal", message: String(err && err.message), requestId };
      return send(res, 500, payload, requestId);
    }
  });

  function rateLimited(res, retryAfter, requestId, ip, path, scope) {
    metrics.recordRateLimited();
    audit.append("rate_limited", { ip, path, scope });
    persist();
    res.setHeader("retry-after", String(retryAfter));
    return send(res, 429, { error: "rate_limited", retryAfter }, requestId);
  }

  // Maintenance sweep (G-2): expired sessions are actively removed (not just
  // lazily on touch), expired quotes are dropped, and rate-limiter buckets are
  // compacted — so long-running processes don't grow without bound.
  function sweepExpired(now = Date.now()) {
    let sessions = 0;
    for (const [token, sess] of Object.entries(store.data.sessions)) {
      const exp = typeof sess === "string" ? null : sess.exp;
      if (exp && exp < now) {
        delete store.data.sessions[token];
        sessions++;
      }
    }
    let refresh = 0;
    for (const [token, rec] of Object.entries(store.data.refresh || {})) {
      if (rec.exp && rec.exp < now) {
        delete store.data.refresh[token];
        refresh++;
      }
    }
    let resets = 0;
    for (const [token, rec] of Object.entries(store.data.resets || {})) {
      if (rec.exp && rec.exp < now) {
        delete store.data.resets[token];
        resets++;
      }
    }
    const quotes = payments.sweepQuotes(now);
    // Idempotency keys exist to absorb short-lived retries; once their payment
    // has been settled for >24h they only leak memory/storage. GC them (the
    // receipt itself is permanent — only the retry-dedupe key is dropped).
    let idem = 0;
    for (const [key, paymentId] of Object.entries(store.data.idempotency || {})) {
      const p = store.data.payments[paymentId];
      if (!p || (p.settledAt || p.createdAt || 0) < now - config.idemTtlMs) {
        delete store.data.idempotency[key];
        idem++;
      }
    }
    // Webhook replay-guard entries only need to outlive the signature
    // tolerance window; GC them after 24h.
    let webhooks = 0;
    for (const [eventId, ts] of Object.entries(store.data.webhookSeen || {})) {
      if (ts < now - 86400000) {
        delete store.data.webhookSeen[eventId];
        webhooks++;
      }
    }
    // Re-query the PSP for in-doubt payments whose backoff timer elapsed.
    const pspSweep = payments.recoverPspPending(now);
    globalLimiter.sweep(now);
    authLimiter.sweep(now);
    paymentLimiter.sweep(now);
    if (sessions || refresh || resets || quotes || idem || webhooks) persist();
    return { sessions, refresh, resets, quotes, idem, webhooks, pspRecovered: pspSweep.recovered };
  }
  const sweepTimer = setInterval(() => {
    const { sessions, refresh, quotes, idem } = sweepExpired();
    if (sessions || refresh || quotes || idem) logger.info("maintenance_sweep", { sessions, refresh, quotes, idem });
  }, config.sweepIntervalMs);
  sweepTimer.unref();
  server.on("close", () => clearInterval(sweepTimer));

  return { server, store, ledger, payments, audit, metrics, sweepExpired, ops, risk, aml, psp };
}

function decorate(r) {
  return {
    ...r,
    amount: fromMinor(r.amountMinor),
    fee: fromMinor(r.feeMinor),
    total: fromMinor(r.totalMinor),
    totalFormatted: formatINR(r.totalMinor),
  };
}

function bearerToken(req) {
  const h = req.headers["authorization"] || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

// Constant-time string comparison via hashing (length-independent).
function timingSafeEqualStr(a, b) {
  return timingSafeEqual(Buffer.from(sha256(String(a)), "hex"), Buffer.from(sha256(String(b)), "hex"));
}

// Operations back-office auth. Fail-closed: without a configured ops token
// the endpoints do not exist (404). Every call must present the ops bearer
// token AND identify the human operator (x-ops-actor) so maker-checker
// separation is enforceable and every action is attributable in the audit log.
function requireOps(req) {
  if (!config.opsToken) throw new ApiError(404, "not_found", "Not found");
  const tok = bearerToken(req);
  if (!tok || !timingSafeEqualStr(tok, config.opsToken)) {
    throw new ApiError(401, "unauthorized", "Missing or invalid ops token");
  }
  const actor = String(req.headers["x-ops-actor"] || "").trim().slice(0, 80);
  if (!actor) throw new ApiError(400, "ops_actor_required", "x-ops-actor header required");
  return actor;
}

function requireAuth(req, store) {
  const token = bearerToken(req);
  // Sessions are keyed by sha256(token) at rest — hash the presented bearer
  // to look it up. Constant work either way; no plaintext token ever touches
  // the store.
  const tokenKey = token ? tokenLookupKey(token) : null;
  const sess = tokenKey ? store.data.sessions[tokenKey] : null;
  if (!sess) throw new ApiError(401, "unauthorized", "Missing or invalid token");
  const userId = typeof sess === "string" ? sess : sess.userId;
  const exp = typeof sess === "string" ? null : sess.exp;
  if (exp && Date.now() > exp) {
    delete store.data.sessions[tokenKey];
    throw new ApiError(401, "session_expired", "Session expired, please re-authenticate");
  }
  if (!userId) throw new ApiError(401, "unauthorized", "Missing or invalid token");
  // Device binding (G-3): a session created with a deviceId only works from
  // that device. Sessions created without one behave as before.
  const deviceHash = typeof sess === "string" ? null : sess.deviceHash;
  if (deviceHash) {
    const presented = req.headers["x-device-id"];
    if (!presented || sha256(String(presented)) !== deviceHash) {
      throw new ApiError(401, "device_mismatch", "Session is bound to a different device");
    }
  }
  return userId;
}

// Raw request body reader (size-capped). The PSP webhook verifies its HMAC
// over these exact bytes BEFORE parsing, so the signature check can never be
// bypassed by JSON re-serialization differences.
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    req.on("data", (c) => {
      bytes += c.length;
      if (bytes > config.bodyLimitBytes) {
        reject(new ApiError(413, "payload_too_large", "Request body too large"));
        req.destroy();
        return;
      }
      data += c;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function readBody(req) {
  const data = await readRawBody(req);
  if (!data) return {};
  try { return JSON.parse(data); }
  catch { throw new ApiError(400, "bad_json", "Invalid JSON body"); }
}

function send(res, status, obj, requestId) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (requestId) res.setHeader("x-request-id", requestId);
  res.end(JSON.stringify(obj));
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon" };
async function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const full = normalize(join(PUBLIC, rel));
  // Boundary-exact prefix check: PUBLIC + sep, so a sibling directory whose
  // name merely STARTS with "public" (e.g. public-backup/) can never be read.
  if (full !== PUBLIC && !full.startsWith(PUBLIC + sep)) { res.statusCode = 403; return res.end("forbidden"); }
  try {
    const data = await readFile(full);
    res.statusCode = 200;
    res.setHeader("content-type", MIME[extname(full)] || "application/octet-stream");
    res.setHeader("cache-control", extname(full) === ".html" ? "no-cache" : "public, max-age=3600");
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.setHeader("content-type", "text/plain");
    res.end("Not found");
  }
}

// Collect this machine's LAN IPv4 URLs so a phone on the same Wi-Fi knows where
// to point EXPO_PUBLIC_API_BASE (the server already listens on all interfaces).
function lanUrls(port) {
  const urls = [];
  const ifaces = networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const ni of ifaces[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) urls.push("http" + "://" + ni.address + ":" + port);
    }
  }
  return urls;
}

// One-time, idempotent migration for stores created before token-at-rest
// hashing: any session/refresh/reset record still keyed by its PLAINTEXT
// token (recognizable by the tok_/rtk_/prt_ prefixes) is re-keyed under
// sha256(token). Live clients keep working — the raw token they hold now
// resolves via its lookup hash — and the plaintext key is gone from disk on
// the next persist.
function migrateTokenKeys(store) {
  const maps = [["sessions", "tok_"], ["refresh", "rtk_"], ["resets", "prt_"]];
  let migrated = 0;
  for (const [name, prefix] of maps) {
    const m = store.data[name];
    if (!m) continue;
    for (const key of Object.keys(m)) {
      if (key.startsWith(prefix)) {
        m[tokenLookupKey(key)] = m[key];
        delete m[key];
        migrated++;
      }
    }
  }
  if (migrated) {
    logger.info("token_keys_migrated_to_hashes", { migrated });
    store.persist();
  }
  return migrated;
}

// Normalize and consume a single-use 2FA recovery code. Returns true only if
// a stored (hashed) code matched; the matched code is removed immediately so
// it can never be replayed.
function consumeRecoveryCode(cred, given) {
  const norm = String(given || "").replace(/[\s-]/g, "").toLowerCase();
  if (!norm || !/^[0-9a-f]{10}$/.test(norm) || !Array.isArray(cred.recoveryCodes)) return false;
  const h = sha256(norm);
  const i = cred.recoveryCodes.indexOf(h);
  if (i === -1) return false;
  cred.recoveryCodes.splice(i, 1);
  return true;
}

// start when run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let store;
  if (config.pgUrl) {
    const { PgStore } = await import("./store-pg.js");
    store = await PgStore.create(config.pgUrl);
    logger.info("postgres_persistence_active", {});
  }
  const app = buildApp({ store });
  const PORT = config.port;
  app.server.listen(PORT, () => {
    const lan = lanUrls(PORT);
    logger.info("server_listening", { port: PORT, localUrl: `http://localhost:${PORT}`, lanUrls: lan, ...configSummary() });
    // Loud, honest boot warnings: these are the two integrations that MUST be
    // real before real-money launch. The process still runs (demo/staging
    // deployments are legitimate) but nobody can miss the state.
    if (config.isProd && config.settlementMode === "sandbox") {
      logger.warn("sandbox_settlement_in_production", { message: "BP_SETTLEMENT_MODE=sandbox — money movement is SIMULATED and every receipt is stamped 'sandbox'. Real rails require a licensed PSP/sponsor-bank adapter (config fail-closes live mode without one)." });
    }
    if (config.isProd && KYC_PROVIDER === "sandbox") {
      logger.warn("kyc_sandbox_in_production", { message: "BP_KYC_PROVIDER=sandbox auto-approves KYC — do NOT launch real money on this. Integrate a licensed provider (see src/kyc.js)." });
    }
    if (config.isProd && !config.emailProvider) {
      logger.warn("email_not_configured", { message: "No BP_EMAIL_PROVIDER set — password-reset tokens cannot be delivered. Set BP_EMAIL_PROVIDER=resend|sendgrid with BP_EMAIL_API_KEY." });
    }
    if (lan.length) {
      logger.info("mobile_hint", {
        message: "On a phone (same Wi-Fi), set EXPO_PUBLIC_API_BASE to one of lanUrls before starting the app",
        example: `EXPO_PUBLIC_API_BASE=${lan[0]}`,
      });
    }
  });
  const shutdown = (signal) => {
    logger.info("shutting_down", { signal });
    app.server.close(async () => {
      try {
        app.store.data.ledger = app.ledger.toJSON();
        app.store.data.audit = app.audit.toJSON();
        app.store.persist();
        if (app.store.flush) await app.store.flush(); // durable (PgStore)
        if (app.store.close) await app.store.close();
      } catch (e) { logger.error("shutdown_persist_failed", { message: String(e && e.message) }); }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
