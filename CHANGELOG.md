# Changelog

All notable changes to Borderless Pay. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versioning is
[SemVer](https://semver.org/).

## [1.0.0] — V1 release

First production-ready release: a hardened, fully-tested payments platform
running on **demo/simulated rails** (no real money — real bank rails and
licensed KYC arrive with the sponsor-bank integration, tracked in
`docs/COMPLIANCE.md`).

### Added
- **Payments:** cross-border merchant pay (mid-market FX, flat 0.5%, ₹2 floor / ₹500 cap, zero markup), P2P send abroad, domestic UPI-style (phone / VPA / bank / QR, ₹0 fee), bills, recharge, collect requests — all idempotent.
- **Trust:** hash-chained dual settlement ledger + Merkle public anchors (pluggable publisher), hash-chained audit log, HMAC-signed receipts, double-entry legs with a zero-sum invariant enforced at append time, public Merkle inclusion proofs (`/api/ledger/proof/:index`) and a standalone client-side verifier page (`/verify.html`).
- **Auth & accounts:** email+password (scrypt, enumeration-safe login, shared lockout), **TOTP 2FA** (RFC 6238, secrets encrypted at rest), password reset with full session revocation; device-bound sessions; refresh-token rotation with reuse/theft detection; logout + revoke-all.
- **Security:** AES-256-GCM field encryption, tiered per-IP rate limiting, strict CSP/HSTS/frame/sniff/COOP/CORP headers, CORS allowlist, body-size caps, fail-closed production config, secret-redacting structured logs, per-transaction + daily velocity limits.
- **Persistence:** atomic file store (default) **and PostgreSQL** (`BP_PG_URL`) with durable snapshots + append-only ledger/audit mirrors; maintenance sweep GCs expired sessions, refresh & reset tokens, quotes, and idempotency keys.
- **Observability:** Prometheus metrics (`/api/metrics`, token-gated), liveness (`/api/health`) + integrity readiness (`/api/ready`); incident runbook.
- **Clients:** installable PWA web app; React Native (Expo) mobile app with biometric + PIN, keystore-backed device ID, silent session renewal.
- **Ops & docs:** Dockerfile (non-root, healthcheck, optional `pg`), Fly/Render/Compose configs, root CI (tests + Postgres service + Docker build), release smoke suite (`npm run smoke`), and a full document set (security audit, compliance roadmap, bank-engagement pack, pen-test RFP, mobile hardening, production-readiness, release checklist).

### Build tooling
- Android builds work with **any JDK 17+** (auto-aligns the Gradle wrapper).

### Tests
- **68 automated tests**, all passing, run in CI on every push.

### Known limitations (by design for V1)
- Bank debit/payout rails, KYC/sanctions screening, and the public-chain anchor writer are **simulated** — integration points are ready. Transactional email (reset tokens / receipts) needs a provider. Multi-instance deployments need Redis-backed rate-limit/lockout state.
