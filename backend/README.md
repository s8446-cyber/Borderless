# Borderless Pay — Backend & Web Client (v1.0)

A secure payments platform that lets a user pay **directly from their home bank**
— both **cross-border** (real mid-market FX, flat 0.5% fee, no hidden markup) and
**domestic** (UPI-style: pay contacts, scan, bills, recharge, request money — zero
fee). Email+password accounts with **TOTP 2FA**, device-bound sessions, and
enforced DPDP consent. Built with a **zero-dependency core** (Node.js built-ins;
`pg` is an optional driver) and hardened for production.

> Companion apps: a React Native (Expo) mobile app and an installable PWA web
> client (in `public/`).

## Quick start

```bash
node src/server.js     # http://localhost:4000  (serves API + web client)
npm test               # 75 tests (core + security + auth + consent + UPI-QR + hardening + observability + Postgres + HTTP e2e)
```

### Persistence backends
- **Default:** in-memory (nothing set) or atomic file store (`BP_DB=/path/db.json`). Zero dependencies.
- **Production:** PostgreSQL — set `BP_PG_URL=postgres://user:pass@host:5432/db` and install the optional driver (`npm install pg`). State snapshots plus **append-only ledger/audit mirrors** land in Postgres (`src/store-pg.js`); tables are created automatically. Docker: build with `--build-arg WITH_PG=true`.
- The Postgres test suite runs automatically when `BP_PG_TEST_URL` is set (CI provisions a Postgres 16 service); it skips gracefully otherwise.

## What’s inside

```
src/
  server.js     HTTP server: REST API + static client, security middleware
  config.js     validated, fail-closed runtime configuration
  money.js      integer minor-unit money math (no floats)
  fx.js         FX rates, fee policy, quotes (cross-border + P2P)
  ledger.js     hash-chained dual ledger (settlement + Merkle public anchor)
  audit.js      hash-chained, tamper-evident audit log
  auth.js       scrypt PIN hashing + HMAC payment signatures + tokens
  crypto.js     AES-256-GCM field encryption at rest
  security.js   rate limiting, login lockout, headers, CORS, validators
  limits.js     per-txn + daily velocity limits
  kyc.js        KYC / sanctions screening (stub)
  totp.js       TOTP 2FA (RFC 6238, zero-dep, RFC-vector tested)
  payments.js   orchestration: auth, idempotency, limits, ledger, audit
  store.js      atomic file-backed JSON store (reference persistence)
  store-pg.js   PostgreSQL persistence: snapshot + append-only ledger/audit mirrors
  metrics.js    zero-dependency Prometheus metrics registry
public/         installable PWA web client (+ /verify.html public proof explorer, /terms.html, /privacy.html)
db/schema.sql   PostgreSQL target schema
scripts/        release-smoke.sh (live end-to-end smoke suite)
test/           core · security · auth · consent · upi · hardening · sessions · metrics · pg · api (75 tests)
```

## Security highlights

- Money stored/computed in **integer paise** (no float errors).
- **scrypt** PIN hashes, **HMAC-SHA256** payment signatures, **AES-256-GCM**
  encryption of account numbers at rest.
- **Hash-chained** settlement ledger + audit log with `/api/ready`,
  `/api/ledger/verify`, `/api/audit/verify` integrity endpoints.
- **Rate limiting**, **failed-PIN lockout**, **idempotency**, **transaction &
  daily velocity limits**.
- Strict **CSP**, **HSTS**, frame/sniff protection, **CORS allowlist**.
- **Fail-closed** config (won’t boot in prod without secrets), sanitized errors,
  structured logs with secret redaction, graceful shutdown.

See **SECURITY.md** for the full threat model and **DEPLOYMENT.md** for shipping
(Docker, Fly.io, Render, systemd) and ops.

## Key API endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | liveness |
| GET | `/api/ready` | readiness + ledger/audit integrity |
| GET | `/api/metrics` | Prometheus metrics (token-gated in prod) |
| GET | `/api/policies` | current Terms/Privacy versions |
| POST | `/api/kyc/verify` | quick-demo KYC + create user (consent required) |
| POST | `/api/auth/signup` · `/api/auth/login` | email+password accounts (consent required) |
| POST | `/api/auth/2fa/setup` · `/api/auth/2fa/enable` | TOTP two-factor |
| POST | `/api/auth/password/reset-request` · `/api/auth/password/reset` | password reset |
| POST | `/api/sessions/refresh` · `/api/sessions/revoke-all` · `/api/logout` | session lifecycle |
| POST | `/api/account/close` | consent withdrawal + PII erasure |
| POST | `/api/accounts/link` | link bank, set PIN |
| POST | `/api/quotes` · `/api/payments` | cross-border quote + pay |
| POST | `/api/transfers/quote` · `/api/transfers` | cross-border P2P |
| POST | `/api/upi/pay` · `/api/bills/pay` · `/api/recharge` | domestic (UPI-style) |
| POST | `/api/requests` · `/api/requests/pay` | request / pay money |
| POST | `/api/waitlist` · GET `/api/waitlist/count` | marketing-site early-access signups |
| GET | `/api/ledger` · `/api/ledger/verify` · `/api/audit/verify` | integrity |
| GET | `/api/ledger/proof/:index` | public Merkle inclusion proof (PII-free) |

Money-moving endpoints accept an `Idempotency-Key` header.

## Note

This is a complete, working reference implementation. Before handling real money
you must integrate a licensed PSP/bank partner and a real KYC/sanctions provider,
and complete the regulatory/licensing steps (handled separately).
