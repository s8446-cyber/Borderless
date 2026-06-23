# Borderless Pay — Backend & Web Client

A secure payments platform that lets a user pay **directly from their home bank**
— both **cross-border** (real mid-market FX, flat 0.5% fee, no hidden markup) and
**domestic** (UPI-style: pay contacts, scan, bills, recharge, request money — zero
fee). Built with **zero runtime dependencies** (Node.js built-ins only) and
hardened for production.

> Companion apps: a React Native (Expo) mobile app and an installable PWA web
> client (in `public/`).

## Quick start

```bash
node src/server.js     # http://localhost:4000  (serves API + web client)
npm test               # 27 tests (core + security)
```

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
  payments.js   orchestration: auth, idempotency, limits, ledger, audit
  store.js      atomic file-backed JSON store (Postgres-swappable)
public/         installable PWA web client
test/           core.test.js + security.test.js
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
| POST | `/api/kyc/verify` | KYC + create user (returns token) |
| POST | `/api/accounts/link` | link bank, set PIN |
| POST | `/api/quotes` · `/api/payments` | cross-border quote + pay |
| POST | `/api/transfers/quote` · `/api/transfers` | cross-border P2P |
| POST | `/api/upi/pay` · `/api/bills/pay` · `/api/recharge` | domestic (UPI-style) |
| POST | `/api/requests` · `/api/requests/pay` | request / pay money |
| GET | `/api/ledger` · `/api/ledger/verify` · `/api/audit/verify` | integrity |

Money-moving endpoints accept an `Idempotency-Key` header.

## Note

This is a complete, working reference implementation. Before handling real money
you must integrate a licensed PSP/bank partner and a real KYC/sanctions provider,
and complete the regulatory/licensing steps (handled separately).
