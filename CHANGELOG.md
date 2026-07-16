# Changelog

All notable changes to Borderless Pay. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versioning is
[SemVer](https://semver.org/).

## [1.0.0] — Version 1

### Run in a browser (dev/testing convenience — no version bump)
- **`cd mobile && npm run sim`** compiles the real React Native `App.js` to web via `react-native-web` and serves it — zero install, full demo flow including on-device receipt verification. `npm run web` runs the hot-reload dev server. Verified end-to-end headlessly (onboarding → domestic + cross-border payment → receipt → independent Merkle verification) against the exported build.


The complete Version 1 of Borderless Pay: a hardened, fully-tested payments
platform running on **demo/simulated rails** (no real money — real bank rails
and licensed KYC arrive with the sponsor-bank integration, tracked in
`docs/COMPLIANCE.md`). All four surfaces — backend/PWA, mobile app, marketing
site, and prototype — share the same features, math, and honest posture.

### Payments
- Cross-border merchant pay (mid-market FX, flat 0.5%, ₹2 floor / ₹500 cap, zero markup), P2P "send abroad", domestic UPI-style (phone / VPA / bank / **real QR scan**), bills, recharge, and collect requests — all idempotent, all integer minor-unit math (no floats).

### Trust & integrity
- Hash-chained dual settlement ledger + Merkle public anchors (pluggable publisher), hash-chained audit log, HMAC-signed receipts, double-entry legs with a zero-sum invariant enforced at append time.
- **Public Merkle inclusion proofs** (`/api/ledger/proof/:index`) + a standalone client-side verifier page (`/verify.html`); in-app "Verify this receipt independently" on web, mobile (on-device SHA-256), and the prototype.

### Accounts & security
- Email+password accounts (scrypt, enumeration-safe login, shared lockout), **TOTP 2FA** (RFC 6238, secrets AES-256-GCM encrypted), password reset with full session revocation; quick-demo KYC path for testers.
- Device-bound sessions; refresh-token rotation with reuse/theft detection; logout + revoke-all; silent session renewal on web and mobile.
- AES-256-GCM field encryption, tiered per-IP rate limiting, strict CSP/HSTS/frame/sniff/COOP/CORP headers, CORS allowlist, body-size caps, fail-closed production config, secret-redacting logs, per-transaction + daily velocity limits.

### Consent & data rights (DPDP Act 2023)
- Enforced, versioned, audited consent gate on all account creation; in-app Terms (`/terms.html`) and Privacy Policy (`/privacy.html`); `GET /api/policies` versions endpoint.
- Consent withdrawal / erasure via `POST /api/account/close` (profile PII erased, sessions revoked, transaction records retained pseudonymously per PMLA/RBI).

### Mobile (React Native / Expo, JDK-17+ friendly)
- Biometric-gated → PIN payment authorization (biometric result actually enforced); keystore-backed device ID; on-device receipt verification.
- **In-context OS permission pop-ups**, each individual: camera (QR scan), contacts (pay a contact — on-device match, read-only), notifications (post-payment, optional). Unused permissions explicitly blocked.
- Builds on **any JDK 17+** (auto-aligns the Gradle wrapper); a preflight **doctor** (`npm run doctor`) catches environment issues before the build; welcome-screen build stamp; exact Expo SDK 51 dependency matrix.

### Persistence, observability, ops
- Atomic file store (default) **and PostgreSQL** (`BP_PG_URL`) with durable snapshots + append-only ledger/audit mirrors; maintenance sweep GCs expired sessions, refresh/reset tokens, quotes, and idempotency keys.
- Prometheus metrics (`/api/metrics`, token-gated), liveness (`/api/health`) + integrity readiness (`/api/ready`); incident runbook; release smoke suite (`npm run smoke`).
- Dockerfile (non-root, healthcheck, optional `pg`), Fly/Render/Compose configs, root CI (tests + Postgres service + Docker build + smoke).

### Quality
- **75 automated backend tests** (unit + security + auth + consent + UPI-QR + hardening + observability + Postgres + full HTTP journey) + 19 live release-smoke assertions, run in CI on every push.

### Documentation
Security audit, compliance roadmap, bank-engagement pack, pen-test RFP, mobile hardening posture, privacy/consent architecture, production-readiness checklist, operations runbook, and release checklist.

### Known limitations (by design for V1)
- Bank debit/payout rails, KYC/sanctions screening, and the public-chain anchor writer are **simulated** — integration points are ready. Transactional email (reset tokens / receipts) needs a provider. Multi-instance deployments need Redis-backed rate-limit/lockout state. Terms/Privacy are v1.0 templates pending counsel finalization + a named grievance officer.
