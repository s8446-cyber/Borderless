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
- ✅ CI: 34 automated tests incl. security + full HTTP journey
- ⬜ Independent third-party penetration test + source audit
- ⬜ Private bug-bounty program (policy ready in `SECURITY.md`)
- ⬜ SAST/DAST + dependency scanning in CI (zero runtime deps today keeps this small)

## Identity, secrets & keys
- ✅ Env-provided secrets with validation
- ⬜ Managed **KMS/HSM** for signing + encryption keys; documented **key rotation**
- ⬜ Secret manager (no secrets on disk/CI logs); short-lived credentials

## Data & persistence
- ✅ Atomic writes + corrupt-file quarantine (reference store)
- ⬜ **PostgreSQL** (encryption at rest, RBAC, PITR backups, least-privilege)
- ⬜ **Redis** for rate-limit/lockout/session state (multi-instance correctness)
- ⬜ Data retention + deletion (DSR) tooling per DPDP Act
- ⬜ RBI data-localisation: primary store in India

## Reliability & operations
- ✅ Liveness (`/api/health`) + readiness/integrity (`/api/ready`) endpoints
- ✅ Structured JSON logs with secret redaction; graceful shutdown
- ✅ Containerized (Dockerfile, non-root, healthcheck); Fly/Render/Compose configs
- ⬜ Centralized logging/metrics/tracing + alerting (SLOs, on-call)
- ⬜ Multi-AZ deployment, autoscaling, DR plan + tested restores
- ⬜ Incident response runbook + status page

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
- ⬜ Terms of Service, Privacy Policy, grievance officer (RBI requirement)
- ⬜ SOC 2 Type II (post-launch trust signal)

## Mobile / client
- ✅ Biometric + PIN auth; standalone (release) build path; configurable backend
- ⬜ Certificate pinning; jailbreak/root detection; Play Integrity / App Attest
- ⬜ Store listings, signing key custody, staged rollouts

---

### How to read this
Everything marked ✅ is implemented and verifiable in this repository today.
Items marked ⬜ are **standard, expected pre-launch work** — most are
partner-dependent (bank/PSP/KYC) or infra (KMS/Postgres). None are blockers to a
seed investment; they are the use-of-funds plan.
