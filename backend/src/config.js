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
  // treat as a passphrase and derive a deterministic 32-byte key
  return scryptSync(raw, "borderless-pay:enc:v1", 32);
}
const encKey = resolveEncKey();

// --- CORS ---
const corsRaw = process.env.BP_CORS_ORIGINS;
const corsOrigins = corsRaw
  ? corsRaw.split(",").map((s) => s.trim()).filter(Boolean)
  : (isProd ? [] : ["*"]);

export const config = {
  env: ENV,
  isProd,
  port: intEnv("PORT", 4000),
  dbPath: process.env.BP_DB || null,
  signingSecret,
  encKey,
  corsOrigins,
  trustProxy: process.env.BP_TRUST_PROXY === "true",
  bodyLimitBytes: intEnv("BP_BODY_LIMIT", 1048576),
  sessionTtlMs: intEnv("BP_SESSION_TTL_MS", 86400000),
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
};

export function configSummary() {
  return {
    env: config.env,
    port: config.port,
    persistence: config.dbPath ? "file" : "in-memory",
    corsOrigins: config.corsOrigins,
    trustProxy: config.trustProxy,
    signingSecretSet: Boolean(process.env.BP_SIGNING_SECRET),
    encKeySet: Boolean(process.env.BP_ENC_KEY),
  };
}
