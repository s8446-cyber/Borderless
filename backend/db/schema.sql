-- Borderless Pay — PostgreSQL target schema (production data layer)
-- ---------------------------------------------------------------
-- This is the migration target for the reference JSON Store (src/store.js).
-- Table/column semantics mirror the store keys 1:1 so the adapter is a
-- mechanical port. Deployment requirements (see docs/PRODUCTION_READINESS.md):
--   * hosted in India (RBI data-localisation), encryption at rest, PITR backups
--   * app connects as a least-privilege role (no DDL, no superuser)
--   * sensitive values (account_ref_enc) remain AES-256-GCM app-layer encrypted
--     — the database never sees them in plaintext.

CREATE TABLE users (
  id            TEXT PRIMARY KEY,             -- usr_<uuid>
  name          TEXT NOT NULL,
  country       TEXT NOT NULL,
  kyc           JSONB NOT NULL,               -- { status, level, checks, checkedAt }
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  user_id          TEXT PRIMARY KEY REFERENCES users(id),
  bank             TEXT NOT NULL,
  masked_number    TEXT NOT NULL,
  currency         TEXT NOT NULL DEFAULT 'INR',
  balance_minor    BIGINT NOT NULL CHECK (balance_minor >= 0),
  account_ref_enc  TEXT                        -- app-layer AES-256-GCM ("v1:iv:tag:ct")
);

CREATE TABLE pins (
  user_id   TEXT PRIMARY KEY REFERENCES users(id),
  pin_hash  TEXT NOT NULL                      -- versioned scrypt ("scrypt$N$r$p$salt$hash")
);

CREATE TABLE sessions (
  token        TEXT PRIMARY KEY,               -- tok_<random 256-bit>
  user_id      TEXT NOT NULL REFERENCES users(id),
  device_hash  TEXT,                           -- sha256(deviceId), null = unbound
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_exp_idx  ON sessions (expires_at);  -- maintenance sweep

CREATE TABLE refresh_tokens (
  token        TEXT PRIMARY KEY,               -- rtk_<random 256-bit>
  user_id      TEXT NOT NULL REFERENCES users(id),
  device_hash  TEXT,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  rotated_to   TEXT                            -- sha256 marker of successor; non-null = retired
);
CREATE INDEX refresh_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_exp_idx  ON refresh_tokens (expires_at);

CREATE TABLE quotes (
  quote_id    TEXT PRIMARY KEY,                -- q_<uuid>
  body        JSONB NOT NULL,                  -- full quote (rate, fee, totals, kind)
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX quotes_exp_idx ON quotes (expires_at);

CREATE TABLE payments (
  payment_id  TEXT PRIMARY KEY,                -- pay_<uuid>
  user_id     TEXT NOT NULL REFERENCES users(id),
  receipt     JSONB NOT NULL,                  -- full signed receipt
  total_minor BIGINT NOT NULL,
  settled_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX payments_user_settled_idx ON payments (user_id, settled_at DESC); -- history + daily limits

CREATE TABLE idempotency (
  scoped_key  TEXT PRIMARY KEY,                -- "<userId>:<Idempotency-Key>" (per-user scoping)
  payment_id  TEXT NOT NULL REFERENCES payments(payment_id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE requests (
  id          TEXT PRIMARY KEY,                -- req_<uuid>
  user_id     TEXT NOT NULL REFERENCES users(id),
  from_name   TEXT NOT NULL,
  amount_minor BIGINT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL CHECK (status IN ('pending','paid')),
  direction   TEXT NOT NULL CHECK (direction IN ('incoming','outgoing')),
  payment_id  TEXT REFERENCES payments(payment_id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX requests_user_idx ON requests (user_id, created_at DESC);

CREATE TABLE waitlist (
  email       TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Failed-PIN lockout state (LoginGuard). In multi-instance production this
-- moves to Redis; the table exists for single-writer deployments.
CREATE TABLE login_security (
  user_id      TEXT PRIMARY KEY REFERENCES users(id),
  fail_times   BIGINT[] NOT NULL DEFAULT '{}', -- epoch ms of failures in window
  locked_until TIMESTAMPTZ
);

-- Ledger A: append-only hash-chained settlement blocks. APPEND-ONLY is
-- enforced at the role level: the app role gets INSERT + SELECT only
-- (no UPDATE/DELETE), so tampering requires DBA access — which the hash
-- chain + published anchors still expose.
CREATE TABLE ledger_blocks (
  index       BIGINT PRIMARY KEY,
  ts          BIGINT NOT NULL,                 -- epoch ms (hashed field — keep exact)
  txn         JSONB NOT NULL,                  -- includes double-entry legs
  prev_hash   TEXT NOT NULL,
  hash        TEXT NOT NULL UNIQUE
);

-- Ledger B: published Merkle anchors over block ranges.
CREATE TABLE ledger_anchors (
  anchor_id     TEXT PRIMARY KEY,              -- anc_<n>
  from_index    BIGINT NOT NULL,
  to_index      BIGINT NOT NULL,
  merkle_root   TEXT NOT NULL,
  public_tx_hash TEXT NOT NULL,                -- real public-chain tx in production
  published_at  TIMESTAMPTZ NOT NULL
);

-- Hash-chained audit log (append-only, same role policy as ledger_blocks).
CREATE TABLE audit_entries (
  index      BIGINT PRIMARY KEY,
  ts         BIGINT NOT NULL,
  event      TEXT NOT NULL,
  data       JSONB NOT NULL DEFAULT '{}',
  prev_hash  TEXT NOT NULL,
  hash       TEXT NOT NULL UNIQUE
);
