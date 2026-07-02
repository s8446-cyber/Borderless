# Borderless Pay — Sponsor Bank & PA-CB Engagement Pack

**Purpose:** everything needed to open (and survive) the conversation with an
AD Category-I sponsor bank and to assemble the RBI **PA-CB** application with
them. Built to be handed to a bank's fintech-partnerships and risk teams as-is.
Companion docs: [`COMPLIANCE.md`](./COMPLIANCE.md) (the regulatory map),
[`SECURITY_AUDIT.md`](./SECURITY_AUDIT.md), [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md).

> **Status honesty:** we are pre-authorization and pre-revenue. This pack does
> not claim otherwise — it demonstrates that the technology and controls are
> already built to bank standards, which is the fastest way to be taken
> seriously.

---

## 1. The one-paragraph pitch to the bank

Borderless Pay is a **technology and orchestration layer** on top of the bank's
licensed rails: domestic UPI/IMPS/NEFT through the bank's PA umbrella, and
cross-border collections/remittances under the bank's AD Cat-I authority within
the RBI PA-CB framework. We never hold funds — settlement flows through the
bank's escrow/nodal accounts. What we bring the bank: a compliance-first
codebase (tamper-evident dual ledger, externally verifiable Merkle-anchored
receipts, full audit trail, documented threat model, CI-enforced security
regression suite), a transparent-pricing consumer product that drives retail
FX volume, and zero core-banking integration risk (REST orchestration only).

## 2. What we ask from the bank

| # | Ask | Notes |
|---|---|---|
| 1 | Sponsor the **PA-CB application** (import + export categories as applicable) | We prepare the full technical annexes (§4) |
| 2 | **Escrow/nodal account** structure for domestic PA flows | Per RBI PA guidelines; reconciliation API access |
| 3 | **LRS processing** for outbound personal remittances | We handle LRS declaration capture + limits enforcement in-app |
| 4 | **FX dealing line** at interbank/mid-market with transparent spread billed to us | Our retail price stays mid-market + visible flat fee |
| 5 | Sandbox → pilot → production **API access** (payments, statements, recon files) | We adapt to the bank's formats (H2H/API/SFTP) |

## 3. What the bank will ask us — and our answers

| Bank question | Our answer | Evidence |
|---|---|---|
| Who holds customer funds? | The bank (escrow/nodal). We are orchestration only | Architecture docs |
| How is transaction integrity proven? | Hash-chained dual ledger + published Merkle anchors; any third party can verify a receipt without seeing transaction data | `GET /api/ledger/proof/:index`, `SECURITY_AUDIT.md` |
| KYC/AML? | Licensed provider integration point ready (interface in `kyc.js`); sanctions/PEP screening at onboarding + payment time; FIU-IND STR/CTR pipeline is a tracked pre-launch item | `COMPLIANCE.md` §2 |
| Transaction monitoring? | Per-txn + daily velocity limits enforced server-side; anomaly signals (failed PINs, refresh-token theft detection) in the tamper-evident audit log; Prometheus metrics for real-time monitoring | `limits.js`, `RUNBOOK.md` |
| Data protection? | AES-256-GCM field encryption, scrypt PIN hashing, DPDP program drafted, India data-localisation in the deployment plan | `PRODUCTION_READINESS.md` |
| What happens when your system disagrees with ours? | Append-only Postgres ledger mirrors + double-entry legs (every entry sums to zero) make reconciliation deterministic; settlement-break playbook in the runbook | `backend/db/schema.sql`, `RUNBOOK.md` |
| Security assurance? | Internal STRIDE audit with found-and-fixed record + CI regression suite; independent pen-test scheduled pre-pilot (scope ready: `PENTEST_SCOPE.md`) | CI badge, audit report |
| Business continuity? | Graceful-shutdown durability, atomic persistence, documented restore procedure; multi-AZ plan pre-launch | `RUNBOOK.md` §4 |

## 4. PA-CB application — technical annexes we prepare

1. **System architecture** — components, trust boundaries, data flows (domestic PA flow, import PA-CB flow, export PA-CB flow, LRS remittance flow).
2. **Information security policy** — from `backend/SECURITY.md` + `SECURITY_AUDIT.md`, mapped to RBI cyber-security framework controls.
3. **Data-localisation statement** — primary data store in India; what (if anything) crosses borders and why.
4. **Escrow reconciliation design** — T+0 internal ledger vs. bank statement matching; break detection and escalation.
5. **AML/CFT program** — KYC tiers, screening, monitoring rules, STR/CTR workflow, record retention (PMLA).
6. **Grievance redressal** — in-app + email + nodal grievance officer, RBI-CMS integration plan.
7. **Board-approved policies checklist** — merchant onboarding (import leg), refund/chargeback, outsourcing, BCP/DR.

## 5. Commercial model (proposed, negotiable)

- Consumer price: **mid-market FX + flat 0.5% (₹2 floor / ₹500 cap); ₹0 domestic**.
- Bank economics: FX spread at dealing line + per-transaction rail fees billed to Borderless Pay; escrow float remains with the bank.
- Volume story: transparent pricing is the acquisition engine — every receipt shows "FX markup: none", which incumbents structurally cannot match.

## 6. Pilot proposal (de-risked for the bank)

1. **Sandbox**: full flow against the bank's test APIs; bank security review of our stack.
2. **Closed pilot**: employees + waitlist cohort, hard caps (low per-txn/daily limits), 100% manual reconciliation review, weekly compliance reports to the bank.
3. **Limited launch**: caps raised stepwise on clean reconciliation + zero unresolved breaks; independent pen-test report delivered before this gate.
4. **General availability**: after PA-CB authorization and FIU-IND registration are in force.

## 7. Target sponsor banks (India, AD Cat-I with active fintech programs)

Evaluate on: fintech API maturity, PA-CB sponsorship appetite, escrow tooling,
FX desk pricing, and time-to-sandbox. Shortlist candidates typically include
banks with established BaaS/fintech partnership desks; selection is a
founder-level call — this pack is bank-agnostic by design.

## 8. Founder checklist to open the conversation

- [ ] Incorporate Pvt Ltd (if not done); MCA + GST basics in order
- [ ] Engage Indian fintech counsel (PA-CB application experience specifically)
- [ ] Pick 3 target banks; request fintech-partnership intro meetings
- [ ] Send this pack + `INVESTOR_BRIEF.md` ahead of the first meeting
- [ ] Commission the independent pen-test (`PENTEST_SCOPE.md`) so the report lands before pilot gate
