# Borderless Pay — Production Readiness Checklist

An honest, auditable view of what is **done (✅)**, **in progress (🟨)**, and
**required before real-money launch (⬜)**. Designed so a sponsor bank, auditor,
or investor can verify status against the code.

## Application security
- ✅ Strict CSP, HSTS (prod), frame/sniff protections, COOP/CORP
- ✅ Per-IP rate limiting (global + auth/payment tiers) + body-size cap
- ✅ scrypt PIN hashing, failed-attempt lockout, constant-time comparisons
- ✅ HMAC-signed payment receipts; hash-chained dual ledger + audit log
- ✅ AES-256-GCM field encryption at rest
- ✅ Per-user idempotency scoping; ownership checks (IDOR-safe); no PII on public endpoints
- ✅ Fail-closed config (refuses to boot in prod without secrets)
- ✅ Double-entry ledger legs (user/clearing/fee accounts) with the zero-sum invariant enforced at append time; `balances()` reconciliation fold
- ✅ Store-persisted quotes (survive restart / multi-instance); session revocation (`POST /api/logout`) + periodic GC of expired sessions & quotes
- ✅ Device-bound sessions + refresh-token rotation with reuse detection (theft → revoke all); `POST /api/sessions/revoke-all` "log out everywhere"
- ✅ Public Merkle inclusion proofs (`GET /api/ledger/proof/:index`, PII-free) — any third party can verify a receipt against a published anchor; anchor publisher is pluggable for a real public-chain writer; standalone public verifier page (`/verify.html`, client-side Web Crypto)
- ✅ Email+password accounts (scrypt, enumeration-safe login, lockout-guarded), **TOTP 2FA** (RFC 6238, secret AES-256-GCM-encrypted at rest), password reset with full session revocation
- ⬜ Transactional email provider (reset-token + receipt delivery — integration point ready, dev mode returns tokens)
- ✅ CI: 75 automated tests incl. security, platform-hardening, observability + Postgres persistence regressions + full HTTP journey
- ⬜ Independent third-party penetration test + source audit
- ⬜ Private bug-bounty program (policy ready in `SECURITY.md`)
- ⬜ SAST/DAST + dependency scanning in CI (zero runtime deps today keeps this small)

## Identity, secrets & keys
- ✅ Env-provided secrets with validation
- ⬜ Managed **KMS/HSM** for signing + encryption keys; documented **key rotation**
- ⬜ Secret manager (no secrets on disk/CI logs); short-lived credentials

## Data & persistence
- ✅ Atomic writes + corrupt-file quarantine (reference store)
- ✅ **PostgreSQL persistence adapter** (`backend/src/store-pg.js`): state snapshots + append-only ledger/audit mirrors, exactly-once across restarts, CI-tested against Postgres 16; target schema in [`backend/db/schema.sql`](../backend/db/schema.sql)
- ⬜ Managed India-region Postgres instance: encryption at rest, RBAC (INSERT+SELECT-only app role on mirror tables), PITR backups + tested restores
- ⬜ **Redis** for rate-limit/lockout/session state (multi-instance correctness)
- 🟨 Data retention + deletion (DSR): consent withdrawal + PII erasure implemented (`POST /api/account/close`, pseudonymous PMLA retention); full DSR tooling (access/correction exports) pending
- ⬜ RBI data-localisation: primary store in India

## Reliability & operations
- ✅ Liveness (`/api/health`) + readiness/integrity (`/api/ready`) endpoints
- ✅ Structured JSON logs with secret redaction; graceful shutdown
- ✅ Prometheus metrics endpoint (`/api/metrics`, token-gated in prod): traffic/latency by route, settlements, fee revenue, rate limits, chain-size & session gauges
- ✅ Incident response runbook with per-scenario playbooks ([`RUNBOOK.md`](./RUNBOOK.md))
- ✅ Containerized (Dockerfile, non-root, healthcheck); Fly/Render/Compose configs
- ⬜ Centralized logging/metrics/tracing infra + alerting (SLOs, on-call) — alert rules drafted in the runbook
- ⬜ Multi-AZ deployment, autoscaling, DR plan + tested restores
- ⬜ Status page

## Payments, KYC & money movement
- ✅ Transparent FX (mid-market, explicit fee), per-txn + daily velocity limits
- ⬜ Licensed **KYC/AML/sanctions** provider (replace `kyc.js` stub)
- ⬜ **PSP / sponsor (AD Cat-I) bank** integration for real rails + escrow/nodal
- ⬜ Reconciliation, chargeback/dispute, and settlement-break handling
- ⬜ FIU-IND STR/CTR reporting pipeline

## Compliance & legal
- 🟨 Regulatory roadmap documented ([`COMPLIANCE.md`](./COMPLIANCE.md))
- ⬜ RBI **PA-CB** authorization (with sponsor bank); domestic PA coverage
- ⬜ FIU-IND registration; DPDP program; PCI scope assessment
- 🟨 Terms of Service + Privacy Policy: v1.0 templates live in-app (`/terms.html`, `/privacy.html`) with enforced, versioned, audited consent + account-closure erasure ([`PRIVACY_CONSENT.md`](./PRIVACY_CONSENT.md)); counsel finalization + named grievance officer still required
- ⬜ SOC 2 Type II (post-launch trust signal)

## Mobile / client
- ✅ Biometric + PIN auth; standalone (release) build path; configurable backend
- ✅ Keystore-backed device ID + device-bound sessions; refresh-token rotation with silent renewal; tokens memory-only (see [`mobile/SECURITY.md`](../mobile/SECURITY.md))
- ✅ Web app: independent client-side Merkle receipt verification; device-bound sessions; explicit logout
- ⬜ Certificate pinning; jailbreak/root detection; Play Integrity / App Attest (build-time items tracked in [`mobile/SECURITY.md`](../mobile/SECURITY.md))
- ⬜ Store listings, signing key custody, staged rollouts

---

### How to read this
Everything marked ✅ is implemented and verifiable in this repository today.
Items marked ⬜ are **standard, expected pre-launch work** — most are
partner-dependent (bank/PSP/KYC) or infra (KMS/Postgres). None are blockers to a
seed investment; they are the use-of-funds plan.
