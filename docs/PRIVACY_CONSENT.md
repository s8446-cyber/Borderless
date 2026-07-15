# Borderless Pay — Consent & Device-Permissions Architecture

How the app takes and records user consent (DPDP Act 2023) and how device
permissions are governed — the way professional, legally-operated apps do it.
Companion docs: [`COMPLIANCE.md`](./COMPLIANCE.md), [`PRODUCTION_READINESS.md`](./PRODUCTION_READINESS.md).

---

## 1. Consent (implemented ✅)

### The rules we follow
1. **No account without explicit consent.** Both account-creation paths (demo KYC and email+password signup) refuse with `400 consent_required` unless the user has affirmatively accepted — no pre-ticked boxes, no implied consent.
2. **Consent is informed.** The welcome screens (web + mobile) show a checkbox with links to the full **Terms of Service** (`/terms.html`) and **Privacy Policy** (`/privacy.html`). In standalone mobile demo mode (no server reachable) the key points are shown inline so consent is still informed.
3. **Consent is recorded and versioned.** What was accepted (`tosVersion`, `privacyVersion`) and when (`acceptedAt`) is stored on the user AND written to the tamper-evident audit chain. `GET /api/policies` exposes current versions so clients can detect when a re-prompt is needed after a material policy change.
4. **Consent is withdrawable.** `POST /api/account/close` (mobile UI: account menu → *Close account*, double-confirmed): profile PII is erased immediately (name, email, credentials, PIN hash, bank link), every session and refresh token is revoked, and the closure is audited. **Transaction records are retained pseudonymously** (user ID only) — PMLA/RBI record-retention requires it, and the hash-chained ledger is append-only by design. This split (erase the person, keep the pseudonymous financial record) is the standard reconciliation of DPDP erasure rights with financial record-keeping law.

### Where it lives in code
| Piece | Location |
|---|---|
| Enforcement + recording | `backend/src/server.js` (`requireConsent`, kyc/signup routes) |
| Policy documents (v1.0 templates for counsel) | `backend/public/terms.html`, `backend/public/privacy.html` |
| Versions endpoint | `GET /api/policies` |
| Erasure / closure | `POST /api/account/close` |
| Web consent UI | `backend/public/app.js` (welcome screen) |
| Mobile consent UI + closure UI | `mobile/App.js` |
| Demo-mode parity | `mobile/src/demo.js` |
| Tests | `backend/test/consent.test.js` (+ release smoke asserts refusal without consent) |

## 2. Device permissions (least-privilege policy)

### Principles
1. **Declare only what we use.** Unused permission declarations are a store-review red flag and a privacy smell.
2. **Ask in context, never up-front.** When a permission-needing feature ships, the request happens at the moment of use, preceded by a one-line explanation of *why* ("permission priming"). If denied, the feature degrades gracefully — the app never nags.
3. **Explain in the manifest.** Every iOS usage string states the concrete purpose.

### Current manifest (mobile `app.json`)
| Platform | Permission | Why | Status |
|---|---|---|---|
| iOS | Face ID (`NSFaceIDUsageDescription`) | Unlock + payment authorization | ✅ declared with purpose string |
| Android | `USE_BIOMETRIC`, `USE_FINGERPRINT` | Same | ✅ explicitly listed |
| Both | **Camera** (`expo-camera`) | Scanning UPI payment QRs only — in-context priming card → OS Allow/Deny; decode on-device; denied → manual entry | ✅ full allow/deny flow |
| Both | **Contacts** (`expo-contacts`, read-only) | Only when the user taps "Pay a contact from my phone" — priming Alert explains on-device matching → OS Allow/Deny pop-up; denied → demo contacts + manual entry still work; `WRITE_CONTACTS` **blocked** | ✅ full allow/deny flow |
| Both | **Notifications** (`expo-notifications`) | Payment receipts + security alerts — offered ONCE after the first successful payment (never at launch), OS Allow/Deny pop-up; fully optional | ✅ full allow/deny flow |
| Android | `RECORD_AUDIO`, `READ/WRITE_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW`, `WRITE_CONTACTS` | Not used | 🚫 **explicitly blocked** so no library can add them |
| Both | Location, ad identifiers | Not used, not collected | 🚫 never declared |

Each permission fires its **own** OS Allow/Deny dialog, at the moment the feature is used, preceded by a plain-language reason — the pattern the founder specified and that Google Play / App Store reviewers require.

### Payment authorization (re-audited)
The payment gate is **two independent factors, enforced in order**:
1. **Biometric** (`expo-local-authentication`) — Face ID / fingerprint prompt. A failed or cancelled biometric now genuinely **blocks the PIN pad** (previously the result was ignored). Devices with no enrolled biometric skip straight to the PIN.
2. **PIN** — verified **server-side** (scrypt, constant-time), with 5-attempt lockout. The client never decides correctness.
Double-submit is prevented by an in-flight guard AND per-attempt idempotency keys, so a fumbled tap can never double-charge.

## 3. Store-submission mapping (prepared answers)

**Google Play Data Safety form:** collects → name, email (account), user IDs (hashed device ID), financial transaction info; encrypted in transit ✅ and at rest (field-level AES-256-GCM) ✅; deletion mechanism ✅ (`account/close`); no sharing with third parties; no ads/tracking SDKs.

**Apple App Privacy label:** *Data linked to you* — contact info (name/email), financial info (transactions), identifiers (hashed device ID). *Data not collected* — location, contacts, browsing, purchases outside app, diagnostics tracking. Tracking: **none**.

## 4. Pre-launch legal gaps (tracked, not claimed)
- Policies are **v1.0 templates** — counsel must finalize before public launch (marked in the documents themselves).
- **Grievance officer** must be named (RBI + IT Rules) — placeholder present in both documents.
- Consent re-prompt UX on version bump: the versions endpoint enables it; the client re-prompt flow ships with the next policy revision.
