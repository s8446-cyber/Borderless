// Centralized, validated runtime configuration.
// Fail-closed in production: required secrets MUST be present or the process
// refuses to start. In development, safe ephemeral defaults are generated so
// the reference app still runs out of the box.
import { randomBytes, scryptSync } from "node:crypto";

const ENV = (process.env.BP_ENV || process.env.NODE_ENV || "development").toLowerCase();
const isProd = ENV === "production";

function required(name) {
  const v = process.env[name];
  if (v && v.trim()) return v.trim();
  if (isProd) throw new Error("FATAL config: " + name + " must be set in production");
  return null;
}

function intEnv(name, def) {
  const v = process.env[name];
  if (v === undefined || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : def;
}

// --- secrets ---
let signingSecret = required("BP_SIGNING_SECRET");
if (!signingSecret) signingSecret = "dev-ephemeral-" + randomBytes(24).toString("hex");

function resolveEncKey() {
  const raw = required("BP_ENC_KEY");
  if (!raw) return randomBytes(32);
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
  // Treat as a passphrase and derive a deterministic 32-byte key.
  // A passphrase-derived key needs a per-deployment salt: with a fixed,
  // public salt an attacker who obtains a data snapshot can precompute
  // dictionaries offline. Production therefore REQUIRES either a raw 64-hex
  // key or a unique BP_ENC_SALT (fail-closed). The legacy fixed salt is only
  // accepted in development so existing dev data keeps decrypting.
  const salt = (process.env.BP_ENC_SALT || "").trim();
  if (salt && salt.length < 16) {
    throw new Error("FATAL config: BP_ENC_SALT must be at least 16 characters");
  }
  if (isProd && !salt) {
    throw new Error(
      "FATAL config: BP_ENC_KEY is a passphrase but BP_ENC_SALT is not set. In production, " +
      "either set BP_ENC_KEY to 64 hex characters (a raw 32-byte key) or set a unique, " +
      "per-deployment BP_ENC_SALT (>= 16 characters) for passphrase derivation."
    );
  }
  return scryptSync(raw, salt || "borderless-pay:enc:v1", 32);
}
const encKey = resolveEncKey();

// --- transactional email (password reset delivery) ---
// In production, "console" (which logs message bodies) is refused, and a real
// provider requires its API key — both fail-closed at boot, like the secrets.
const emailProvider = (process.env.BP_EMAIL_PROVIDER || "").trim().toLowerCase() || (isProd ? null : "console");
if (isProd && emailProvider === "console") {
  throw new Error("FATAL config: BP_EMAIL_PROVIDER=console logs email bodies and is not allowed in production");
}
const emailApiKey = (process.env.BP_EMAIL_API_KEY || "").trim() || null;
if (isProd && emailProvider && !emailApiKey) {
  throw new Error("FATAL config: BP_EMAIL_PROVIDER=" + emailProvider + " requires BP_EMAIL_API_KEY in production");
}

// --- KYC provider selection ---
// "sandbox" simulates document/liveness/sanctions checks (auto-approve). A
// licensed provider adapter registers itself in kyc.js under a new name and is
// selected here — no other code changes needed.
const kycProvider = (process.env.BP_KYC_PROVIDER || "sandbox").trim().toLowerCase();

// --- Settlement mode ---
// "sandbox": money movement is SIMULATED end-to-end and every receipt says so.
// Balances are funded through the explicit /api/topup flow (no invented
// money), the double-entry ledger balances against the funding:sandbox
// account, and clients render a visible SANDBOX badge. This is the honest
// pre-license posture: real code, real crypto, real persistence — no
// pretend money.
// "live": real rails. Fail-closed — refuses to boot until a licensed PSP /
// sponsor-bank adapter is integrated and named in BP_PSP_PROVIDER, so nobody
// can flip a flag and pretend simulated settlement is real.
const settlementMode = (process.env.BP_SETTLEMENT_MODE || "sandbox").trim().toLowerCase();
if (!["sandbox", "live"].includes(settlementMode)) {
  throw new Error("FATAL config: BP_SETTLEMENT_MODE must be 'sandbox' or 'live', got '" + settlementMode + "'");
}
if (settlementMode === "live") {
  const psp = (process.env.BP_PSP_PROVIDER || "").trim().toLowerCase();
  if (!psp) {
    throw new Error(
      "FATAL config: BP_SETTLEMENT_MODE=live requires a licensed PSP / sponsor-bank integration " +
      "(set BP_PSP_PROVIDER to a registered adapter). No adapter is integrated yet — " +
      "run in sandbox mode until the RBI PA-CB authorization and bank partnership are in place."
    );
  }
  throw new Error(
    "FATAL config: no PSP adapter named '" + psp + "' is registered. " +
    "Live settlement is fail-closed until a real rails integration lands."
  );
}

// --- CORS ---
const corsRaw = process.env.BP_CORS_ORIGINS;
const corsOrigins = corsRaw
  ? corsRaw.split(",").map((s) => s.trim()).filter(Boolean)
  : (isProd ? [] : ["*"]);

// --- operations back office & PSP webhooks ---
// Both fail closed in production: without an explicitly provisioned ops token
// / webhook secret the corresponding endpoints do not exist (404), so neither
// back-office money actions nor webhook-driven settlement can be reached
// unauthenticated. Development gets a fixed ops token and a per-process
// webhook secret so the flows are exercisable out of the box.
const opsToken = (process.env.BP_OPS_TOKEN || "").trim() || (isProd ? null : "ops-dev-token");
const webhookSecret = (process.env.BP_WEBHOOK_SECRET || "").trim() || (isProd ? null : "whsec-dev-" + signingSecret.slice(-16));

export const config = {
  env: ENV,
  isProd,
  port: intEnv("PORT", 4000),
  dbPath: process.env.BP_DB || null,
  pgUrl: (process.env.BP_PG_URL || "").trim() || null, // Postgres persistence (overrides file store)
  signingSecret,
  encKey,
  corsOrigins,
  trustProxy: process.env.BP_TRUST_PROXY === "true",
  metricsToken: (process.env.BP_METRICS_TOKEN || "").trim() || null,
  emailProvider,
  emailApiKey,
  emailFrom: (process.env.BP_EMAIL_FROM || "").trim() || "Borderless Pay <no-reply@borderlesspay.app>",
  appOrigin: (process.env.BP_APP_ORIGIN || "").trim() || null, // public URL used in emails
  kycProvider,
  settlementMode,
  bodyLimitBytes: intEnv("BP_BODY_LIMIT", 1048576),
  sessionTtlMs: intEnv("BP_SESSION_TTL_MS", 86400000),
  refreshTtlMs: intEnv("BP_REFRESH_TTL_MS", 2592000000), // refresh-token lifetime (30 days)
  sweepIntervalMs: intEnv("BP_SWEEP_INTERVAL_MS", 300000), // maintenance GC cadence (5 min)
  idemTtlMs: intEnv("BP_IDEM_TTL_MS", 86400000), // idempotency-key retention after settlement (24h)
  passwordMinLength: intEnv("BP_PASSWORD_MIN_LENGTH", 8), // raise per deployment policy
  rateLimit: {
    windowMs: intEnv("BP_RL_WINDOW_MS", 60000),
    max: intEnv("BP_RL_MAX", 120),
    authMax: intEnv("BP_RL_AUTH_MAX", 20),
    paymentMax: intEnv("BP_RL_PAYMENT_MAX", 30),
  },
  lockout: {
    maxFails: intEnv("BP_LOCK_MAX_FAILS", 5),
    windowMs: intEnv("BP_LOCK_WINDOW_MS", 900000),
    lockMs: intEnv("BP_LOCK_MS", 900000),
  },
  limits: {
    perTxnMinMinor: intEnv("BP_TXN_MIN_MINOR", 100),
    perTxnMaxMinor: intEnv("BP_TXN_MAX_MINOR", 20000000),
    intlPerTxnMaxMinor: intEnv("BP_INTL_TXN_MAX_MINOR", 50000000),
    dailyTotalMaxMinor: intEnv("BP_DAILY_TOTAL_MAX_MINOR", 100000000),
    dailyCountMax: intEnv("BP_DAILY_COUNT_MAX", 100),
  },
  // Pre-transaction risk policy (payee cooling, device caps, fraud scoring).
  risk: {
    coolingMs: intEnv("BP_RISK_COOLING_MS", 86400000), // 24h beneficiary cooling window
    coolingCapMinor: intEnv("BP_RISK_COOLING_CAP_MINOR", 2500000), // ₹25,000 to a new beneficiary during cooling
    newDeviceWindowMs: intEnv("BP_RISK_NEW_DEVICE_WINDOW_MS", 86400000),
    newDeviceDailyCapMinor: intEnv("BP_RISK_NEW_DEVICE_DAILY_CAP_MINOR", 5000000), // ₹50,000/day from a first-day device
    reviewScore: intEnv("BP_RISK_REVIEW_SCORE", 70), // fraud score ⇒ hold for ops review
    blockScore: intEnv("BP_RISK_BLOCK_SCORE", 90), // fraud score ⇒ refuse outright
  },
  // AML / regulatory policy. Defaults sit above the sandbox per-transaction
  // limits; deployments that raise BP_TXN_MAX_MINOR tune these to their
  // compliance program.
  aml: {
    ctrThresholdMinor: intEnv("BP_AML_CTR_THRESHOLD_MINOR", 100000000), // ₹10,00,000 single txn → CTR
    velocityAlertMinor: intEnv("BP_AML_VELOCITY_ALERT_MINOR", 50000000), // ₹5,00,000 outbound/day → alert
    sofThresholdMinor: intEnv("BP_AML_SOF_THRESHOLD_MINOR", 50000000), // ₹5,00,000 top-up → source of funds
    lrsDocThresholdMinor: intEnv("BP_LRS_DOC_THRESHOLD_MINOR", 70000000), // ₹7,00,000 → purpose code + PAN
    lrsAnnualCapMinor: intEnv("BP_LRS_ANNUAL_CAP_MINOR", 2100000000), // ≈ USD 250,000 equivalent per FY
  },
  // PSP connector behavior (timeout recovery backoff).
  psp: {
    timeoutMs: intEnv("BP_PSP_TIMEOUT_MS", 5000),
    maxAttempts: intEnv("BP_PSP_MAX_ATTEMPTS", 5),
    retryBaseMs: intEnv("BP_PSP_RETRY_BASE_MS", 60000),
  },
  opsToken,
  webhookSecret,
};

export function configSummary() {
  return {
    env: config.env,
    port