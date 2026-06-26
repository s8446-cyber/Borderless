# Borderless Pay — Internal Security Audit Report

**Classification:** Confidential · Share under NDA with investors, sponsor banks, and auditors
**Audit type:** White-box source review + threat modeling + automated test verification
**Scope:** `backend/` (API, FX engine, dual ledger, auth, crypto) and `mobile/` client
**Status of product:** Pre-production reference build (no real money movement yet)

> **Honest disclaimer.** This is an *internal* audit. It does not replace an
> independent third-party penetration test, a formal code audit, or the security
> reviews required for RBI authorization and PCI-DSS. Those are scheduled items in
> [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md). No system is "zero
> vulnerability"; what we demonstrate here is a disciplined, defense-in-depth
> design, an explicit threat model, and a found-and-fixed track record.

---

## 1. Methodology

1. **Threat modeling** using STRIDE across every trust boundary (client ↔ API,
   API ↔ store, API ↔ ledger).
2. **Manual source review** of all security-relevant modules.
3. **Abuse-case testing** encoded as automated tests (`backend/test/*`), run on
   every push via CI. Current suite: **34 tests, all passing** (unit + security +
   full HTTP end-to-end journey).
4. **Severity** rated with CVSS v3.1 qualitative bands.

---

## 2. STRIDE threat model & controls

| Threat | Vector | Control in code |
|---|---|---|
| **S**poofing | Forged identity / session | Random 256-bit bearer tokens, server-enforced expiry (`auth.js`, `server.js:requireAuth`). |
| **T**ampering | Edit money records / quotes | Hash-chained settlement ledger + Merkle anchors + hash-chained audit log (`ledger.js`, `audit.js`); server-side quotes (client sends only `quoteId`); HMAC-signed receipts (`auth.js`). |
| **R**epudiation | "I didn't authorize that" | Per-payment HMAC-SHA256 signature over canonical fields; immutable audit trail. |
| **I**nformation disclosure | Read others' data / secrets | Per-user idempotency scoping (Finding F-1), authenticated account/history endpoints, AES-256-GCM field encryption at rest, secret-redacting logger, sanitized prod errors. |
| **D**enial of service | Flooding / draining | Per-IP sliding-window rate limiting with stricter auth/payment tiers, body-size cap, per-txn + daily velocity limits (`security.js`, `limits.js`). |
| **E**levation of privilege | Act as another user | Token→userId binding on every authed route; ownership checks on user-scoped objects (Finding F-3). |

---

## 3. Findings (this audit cycle)

All findings below were **identified and remediated in this cycle**, each with a
regression test.

### F-1 — Cross-user receipt disclosure via global idempotency keys · **High** (CVSS 3.1: 7.1)
- **Issue:** Idempotency keys were stored in a global namespace. An authenticated
  user replaying another user's `Idempotency-Key` received that user's full
  receipt (amounts, balance-after, signature) before any ownership/PIN check.
- **Fix:** Keys are namespaced per `userId` and the stored receipt's owner is
  re-verified before return (`payments.js:_idem` / `scopedIdem`).
- **Test:** `security.test.js` → "idempotency keys are scoped per user".

### F-2 — Unauthenticated transaction-PII leak at `GET /api/ledger` · **Medium** (CVSS 3.1: 5.3)
- **Issue:** The public ledger endpoint returned the full head block, including
  `txn` (userId, amount, merchant) — exposing the most recent transaction to any
  unauthenticated caller.
- **Fix:** Endpoint now returns only the head **index + hash** plus public anchors
  (Merkle roots / public-chain tx hashes — no PII), preserving verifiability.
- **Test:** `api.test.js` asserts `head.txn === undefined` for an unauthenticated call.

### F-3 — IDOR in `payRequest` (collect requests) · **Low/Medium** (CVSS 3.1: 4.3)
- **Issue:** `payRequest` did not verify the collect request belonged to the
  caller, allowing cross-user status mutation.
- **Fix:** Ownership check (`r.userId === userId`), returning a generic 404 to
  avoid enumeration (`payments.js:payRequest`).
- **Test:** `security.test.js` → "payRequest rejects a collect request owned by another user".

---

## 4. Cryptography & money-handling controls (verified)

- **PIN storage:** scrypt (N=16384, r=8, p=1), versioned `scrypt$N$r$p$salt$hash`; constant-time compare.
- **Authorization signatures:** HMAC-SHA256 over `paymentId|userId|currency|localAmount|amountMinor|feeMinor|totalMinor|settlementHash`.
- **Field encryption at rest:** AES-256-GCM (authenticated), `v1:iv:tag:ciphertext`; account numbers never stored in plaintext.
- **Integrity:** SHA-256 hash chains for ledger + audit; Merkle anchors; `/api/ready` fails closed on any integrity break.
- **Money math:** integer minor units only (no floats); atomic balance debit before ledger write; single-use 60s quotes.
- **Fail-closed config:** process refuses to boot in production without `BP_SIGNING_SECRET` and `BP_ENC_KEY`.

---

## 5. Test coverage (abuse cases encoded in CI)

| Area | Tests |
|---|---|
| FX correctness, fee floor/cap, quote expiry | ✓ |
| Dual ledger append/anchor/verify + tamper detection | ✓ |
| Audit chain tamper detection + persistence | ✓ |
| PIN hashing (incl. legacy), wrong-PIN rejection, lockout | ✓ |
| Payment signature verify + tamper rejection | ✓ |
| Idempotency (per-user scoping) + no double-charge | ✓ |
| Transaction min/max + daily velocity limits | ✓ |
| Rate limiter window behavior | ✓ |
| Field encryption round-trip + GCM tamper detection | ✓ |
| Input validators (PIN, amount, email, string) | ✓ |
| IDOR / cross-user access | ✓ |
| Unauthenticated endpoint PII non-disclosure | ✓ |
| Full HTTP journey (onboard→pay→send→domestic→bills→request→verify) | ✓ |

---

## 6. Residual risks & required external validation

These are **known, by design for a pre-production reference build**, and are
tracked in [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md):

1. **Independent penetration test + source audit** — not yet performed (required pre-launch).
2. **Secrets in an HSM/KMS** — currently env-provided; production needs managed KMS/HSM + rotation.
3. **Datastore** — file-backed JSON reference store; production needs Postgres (encryption, RBAC, backups, PITR) + Redis for rate-limit/lockout state.
4. **KYC/AML** — provider is a stub; production needs a licensed KYC/sanctions/PEP provider and FIU-IND-aligned monitoring.
5. **Bank/PSP rails** — simulated; production needs a licensed PSP / sponsor bank.
6. **Public-chain anchoring** — simulated hash anchor; optional real L1/L2 broadcast.

## 7. Recommendation

The codebase demonstrates a strong, defense-in-depth security posture appropriate
for the current stage. Before handling real funds we recommend, in order: (a) an
independent pen test, (b) a managed KMS/HSM migration, (c) the Postgres/Redis
hardening, and (d) launching a private bug-bounty. Each is a tracked line item, not
an open-ended unknown.
