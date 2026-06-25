# Borderless Pay — Investor Brief

> One-pager for investors and accelerators (incl. YC). Figures are illustrative;
> the product is a working pre-production build. Not an offer of securities.

## The problem
Indians pay **3–5%** in hidden FX markup and fees every time they pay or send
money abroad — buried in marked-up exchange rates and opaque "conversion" charges.
Domestic UPI is free and instant; the moment money crosses a border, it isn't.

## The product
**One app to pay, send, and request money — at home and across borders —** straight
from the user's bank account, at the **real mid-market rate** with a **flat 0.5%
fee** (₹0 domestic) and an itemized, verifiable receipt for every transaction.

- Domestic UPI-style payments (phone / UPI ID / bank / QR), bills, recharge, requests
- Cross-border pay & send with the recipient amount shown **before** confirming
- Every payment HMAC-signed and written to a tamper-evident dual ledger

## Why we win: trust is the moat
Cross-border fintech is won on **trust and compliance**, not features. We built the
hard parts first:
- **Transparent economics** (mid-market FX, explicit fee, "FX markup: none").
- **Bank-grade security, in code today:** triple-layer auth, AES-256-GCM at rest,
  hash-chained signed ledger + audit, rate-limiting, velocity limits, fail-closed
  config. See [`docs/SECURITY_AUDIT.md`](./SECURITY_AUDIT.md) (34 automated tests; a
  real found-and-fixed audit trail).
- **Regulation-first architecture:** an orchestration layer over a licensed sponsor
  bank / PSP — the compliant, fastest route to market. See
  [`docs/COMPLIANCE.md`](./COMPLIANCE.md).

## Why now
RBI's **PA-CB framework (Oct 2023)** created a clear, licensable path for
cross-border payment startups for the first time. UPI rails + Aadhaar e-KYC make
onboarding and domestic settlement cheap and instant. The regulatory door is open.

## Market
India is the **world's largest remittance recipient (~US$120B+/yr)** and a fast-
growing outbound-spend market (travel, education, freelancing, SaaS). Even a thin,
honest 0.5% on a sliver of cross-border flow is a large, defensible business.

## Status & traction signals
- Working full-stack build: hardened API, installable web app (PWA), native
  mobile app, marketing site with a wired waitlist.
- Internal security audit complete; CI green (34 tests).
- Pre-revenue; in sponsor-bank / PSP conversations.

## What we're raising for (use of funds)
1. **Licensing & partnerships** — sponsor (AD Cat-I) bank + PSP + PA-CB application.
2. **Compliance** — licensed KYC/AML, FIU-IND pipeline, DPDP program.
3. **Security hardening to launch** — independent pen test, KMS/HSM, Postgres/Redis,
   bug bounty (all itemized in [`docs/PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md)).
4. **Team** — payments/compliance hires.

## The honest part
We are pre-license and pre-revenue, and we don't claim otherwise. What's
de-risked is the **build and the security/compliance design** — usually the part
that sinks fintech startups. The remaining work is well-scoped, partner-dependent,
and exactly what this round funds.

**Contact:** founders@borderlesspay.app
