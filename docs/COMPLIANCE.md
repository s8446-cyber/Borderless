# Borderless Pay — Regulatory & Compliance Roadmap (India + cross-border)

**Purpose:** Give investors, a sponsor bank, and regulators an honest, structured
view of the licensing and compliance path to operate legally in India and across
borders.

> **Status:** Pre-production. Borderless Pay does **not** move real money today.
> This document is a roadmap, not a claim of current authorization. Nothing here
> is legal advice; engage Indian fintech counsel and your sponsor bank before launch.

---

## 1. What we are (and how we must be regulated)

Borderless Pay combines two regulated activities:

1. **Domestic payments (India→India, UPI-style).** Handled through a **sponsor
   bank + PSP / PA (Payment Aggregator)** relationship — we do not hold funds; we
   orchestrate bank-rail payments. Falls under the **RBI PA/PG guidelines (2020,
   as amended)** and operates over **UPI/IMPS/NEFT via NPCI** through the partner.
2. **Cross-border collections & remittances.** Regulated under **FEMA**, the
   **RBI Payment Aggregator – Cross Border (PA-CB) framework (Oct 2023)**, and the
   **Liberalised Remittance Scheme (LRS)** for outbound personal remittances, in
   partnership with an **AD Category-I bank**.

We deliberately design as a **technology + orchestration layer on top of a
licensed bank/PSP**, which is the fastest compliant route to market for a startup.

---

## 2. Authorizations & registrations required (the checklist)

| # | Requirement | Authority | Status |
|---|---|---|---|
| 1 | **PA-CB authorization** (Import/Export categories as applicable) | RBI | ⬜ To apply (via/with sponsor bank) |
| 2 | **Payment Aggregator (domestic) authorization** or operate under a licensed PA | RBI | ⬜ Partner-led |
| 3 | **Sponsor / AD Category-I bank partnership** (settlement, escrow, LRS) | Partner bank | ⬜ In discussion |
| 4 | **FIU-IND registration** + PMLA reporting (STR/CTR) | FIU-IND | ⬜ Required pre-launch |
| 5 | **GST / company (Pvt Ltd) + MCA filings** | MCA | ⬜ Standard incorporation |
| 6 | **DPDP Act 2023** data-protection compliance program | MeitY / DPB | ⬜ Program drafted (see §4) |
| 7 | **PCI-DSS** scope assessment (if any card data is touched) | PCI SSC / QSA | ⬜ Scope-minimization first (see §5) |
| 8 | **Escrow / nodal account** per RBI PA rules | Sponsor bank | ⬜ Partner-led |

Legend: ⬜ planned · 🟨 in progress · ✅ done

---

## 3. AML / CFT / KYC program

Required before any real transaction:
- **Customer Due Diligence (CDD)** + **e-KYC** (Aadhaar OTP / DigiLocker / CKYC)
  via a licensed KYC provider; **V-CIP** for higher tiers.
- **Sanctions / PEP screening** (UN, OFAC, MHA lists) at onboarding and on an
  ongoing basis. *(Code today has a stub interface — `backend/src/kyc.js` — built
  to be swapped for a real provider.)*
- **Transaction monitoring** with risk rules + thresholds; **STR/CTR** filing to
  FIU-IND; record-keeping per PMLA (5 years).
- **Tiered limits** aligned to KYC level (the engine already enforces per-txn and
  daily velocity limits — `backend/src/limits.js`).
- **Travel Rule** data for cross-border flows.

---

## 4. Data protection (DPDP Act 2023) & data localisation

- **RBI data-localisation (2018):** all payment data stored **in India**;
  cross-border transaction data may be processed abroad but the copy stays onshore.
- **DPDP Act 2023:** lawful basis + consent management, purpose limitation, data
  principal rights (access/correction/erasure), breach notification to the Data
  Protection Board, and a Consent Manager integration.
- **Engineering already aligned:** field-level AES-256-GCM encryption of sensitive
  identifiers, PIN hashing, secret redaction in logs, and least-data audit entries
  (e.g., waitlist logs only the email domain). Production adds KMS/HSM, RBAC,
  retention schedules, and DSR tooling.

---

## 5. PCI-DSS posture

Primary strategy is **scope minimization**: Borderless debits **bank accounts**
(UPI/account rails), not cards, so cardholder data is avoided where possible. If
card acceptance is added, it is via a **PCI-DSS Level 1 PSP** with tokenization so
raw PAN never touches our systems (keeping us to **SAQ-A** scope).

---

## 6. Phased go-to-market (compliant sequencing)

- **Phase 0 — Now (pre-production):** reference build, internal security audit,
  this roadmap, sponsor-bank & PSP conversations, incorporation.
- **Phase 1 — Sandbox:** integrate licensed KYC + PSP/sponsor bank in test;
  optionally apply to the **RBI Regulatory Sandbox**; independent pen test.
- **Phase 2 — Limited live (domestic):** operate domestic flows under the partner
  PA license with capped limits and full AML monitoring.
- **Phase 3 — Cross-border live:** activate PA-CB + LRS flows with the AD-Cat-I
  bank once authorization is in place.

---

## 7. What an investor / sponsor bank should take away

- The product is **architected for regulation from day one** (orchestration over a
  licensed partner, not an unlicensed money-transmitter design).
- The hard compliance primitives that startups usually retrofit — transparent FX,
  immutable signed ledger, velocity limits, encryption, auditability — are **already
  in the codebase**.
- The remaining items are **known, sequenced, and partner-dependent**, not unknowns.
