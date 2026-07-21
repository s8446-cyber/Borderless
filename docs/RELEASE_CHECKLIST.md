# Borderless Pay — V1 Release Checklist

The go-live runbook for the **first production deployment**. Everything in
"Code & build" is **done and verified**; "Deploy-time" items need YOUR infra
accounts and credentials. Nothing here moves real money — V1 is the hardened,
demo-data product (real rails/KYC come with the sponsor-bank integration).

---

## A. Code & build — DONE ✅ (verified this release)
- [x] **97/97 backend + 24/24 mobile automated tests** pass (unit + security + auth + consent + UPI-QR + mailer + hardening + observability + Postgres + full HTTP journey)
- [x] All source files syntax-checked (`npm run check`)
- [x] **Release smoke suite** (`npm run smoke <url>`) — 23 live assertions pass against a production-mode server
- [x] **Fail-closed** verified: production boot refuses without `BP_SIGNING_SECRET` + `BP_ENC_KEY`
- [x] **PostgreSQL persistence** verified: full journey + **process restart** with balance, sessions, and ledger/audit integrity all durable
- [x] Security headers (CSP, HSTS, frame/sniff/COOP/CORP) present on every response
- [x] Auth: email+password (scrypt, enumeration-safe, lockout), TOTP 2FA (RFC-vector tested), password reset with session revocation
- [x] Trust: public Merkle proof endpoint + standalone `/verify.html` verifier
- [x] Versions stamped: backend **1.1.0**; mobile **1.0.0** (`package.json` + `app.json`); PWA cache `v4`
- [x] CI at repo root runs tests + Postgres service + Docker build on every push

## B. Deploy-time — founder actions (each has an exact command/pointer)

### B1. Secrets (generate fresh, store in the platform's secret manager — never in git)
```bash
openssl rand -hex 48   # → BP_SIGNING_SECRET   (payment authorization HMAC)
openssl rand -hex 32   # → BP_ENC_KEY          (AES-256-GCM field encryption)
openssl rand -hex 32   # → BP_METRICS_TOKEN    (Prometheus scrape auth)
```
- [ ] Set all three on the host (Fly secrets / Render env / Docker secrets)
- [ ] **Keep `BP_SIGNING_SECRET` stable forever** — rotating it invalidates verification of historical receipt signatures (keep old keys to verify old receipts). Documented in `SECURITY.md`.

### B2. Environment
- [ ] `BP_ENV=production` and `NODE_ENV=production`
- [ ] `BP_CORS_ORIGINS=https://your-real-frontend` (empty = same-origin only; never `*` in prod)
- [ ] `BP_TRUST_PROXY=true` (behind Fly/Render/Nginx so rate limiting reads `X-Forwarded-For`)
- [ ] Persistence: **`BP_PG_URL`** → managed **India-region** Postgres (RBI data-localisation). Build the image with `--build-arg WITH_PG=true`. Without it, `BP_DB` file store is used (single-instance only).
- [ ] Email: `BP_EMAIL_PROVIDER=resend|sendgrid` + `BP_EMAIL_API_KEY` + `BP_EMAIL_FROM` (SPF/DKIM-verified domain) + `BP_APP_ORIGIN` — password-reset tokens are undeliverable without this (loud boot warning)

### B3. Database (if using Postgres — recommended)
- [ ] Provision managed Postgres in an India region; enable encryption at rest + PITR backups
- [ ] App connects as a least-privilege role; grant **INSERT+SELECT only** on `ledger_blocks` / `audit_entries` (append-only integrity — see `db/schema.sql`)
- [ ] Confirm a test restore from backup

### B4. TLS & network
- [ ] HTTPS enforced at the platform edge (Fly/Render do this; else Nginx/Caddy in front)
- [ ] HSTS is emitted automatically in production
- [ ] Health check wired to **`/api/ready`** (verifies integrity, not just liveness) — configs already set this

### B5. Observability
- [ ] Point Prometheus at `GET /api/metrics` with the `BP_METRICS_TOKEN` bearer
- [ ] Load the alert rules from [`RUNBOOK.md`](./RUNBOOK.md) §1 (integrity failure = SEV-1)
- [ ] Confirm structured JSON logs are shipping to your log store

### B6. Go-live verification (run against the LIVE url)
```bash
cd backend && npm run smoke https://your-live-host BP_METRICS_TOKEN_VALUE
```
- [ ] All 23 assertions pass → deployment is release-healthy
- [ ] `curl https://your-live-host/api/ready` returns `ready:true`

## C. Legal/compliance gates before REAL money (not required for V1 demo launch)
Tracked in [`COMPLIANCE.md`](./COMPLIANCE.md) / [`BANK_ENGAGEMENT_PACK.md`](./BANK_ENGAGEMENT_PACK.md):
sponsor AD Cat-I bank + PA-CB, FIU-IND, licensed KYC, ToS/Privacy/grievance
officer, independent pen-test ([`PENTEST_SCOPE.md`](./PENTEST_SCOPE.md)). V1 ships
with the **demo/simulated** rails and an explicit "no real money" stance.

## D. Rollback
- File store: restore the last `db.json` backup, redeploy previous image, verify `/api/ready`.
- Postgres: point to the last good snapshot / PITR timestamp; the append-only mirrors + published anchors prove exactly where a good state ends. Full procedure in [`RUNBOOK.md`](./RUNBOOK.md) §3.1 & §4.
