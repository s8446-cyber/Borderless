# Changelog

All notable changes to Borderless Pay. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versioning is
[SemVer](https://semver.org/).

## [1.3.0] — Real-data posture: zero fake data, sandbox settlement, Add money

The "nothing here pretends" release. Every demo artifact is gone from the
product; what remains is real accounts, real cryptography, real persistence,
and an **honestly labelled sandbox settlement mode** that fail-closes into
live rails until the licensed integrations exist. Backend + mobile → **1.3.0**.

### Removed (fake things, everywhere)
- **₹2,50,000 invented opening balance** — balances now start at **₹0**;
  `openingBalance` is no longer accepted by `/api/accounts/link`, and
  re-linking a bank **preserves** the existing balance instead of resetting it.
- **Seeded fake contact directory** (Ananya/Rohan/Priya/Vikram/Sara with fake
  VPAs) — `/api/contacts` now returns **recent payees derived from the
  caller's own transaction history** (deduplicated, newest first, per-user
  isolated; new accounts correctly get an empty list).
- **Auto-seeded fake incoming request** ("Rohan Mehta, ₹450, Dinner split").
- **Mobile standalone demo mode** — `src/demo.js` (421 lines) and the
  `EXPO_PUBLIC_DEMO` switch are deleted; the app always talks to a real
  backend. The lock screen's demo-PIN fallback and demo-state persistence
  (document storage tier + `expo-file-system` dependency) went with it.
- **"Use demo QR (Cafe Coffee Day)"** — release builds always scan a real QR
  or take manual UPI-ID entry; a clearly-labelled **sample QR exists only in
  dev builds** (`__DEV__`) for camera-less emulators.
- **Fixed fake corridor merchants** ("Al Masa Restaurant ~ AED 80" etc.) — the
  cross-border flow now takes a **real merchant name and amount** from the
  user (corridor metadata keeps only flags/symbols/example placeholders).
- **`prototype/`** (single-file clickable mock) — superseded by the real PWA
  and mobile app; removed so no sponsor ever mistakes a mock for the product.
- Name-only "quick demo" onboarding in both clients — onboarding is now a
  full **email + password sign-up** (scrypt, lockout, consent-gated) on web
  and mobile alike.

### Added
- **`POST /api/topup` — Add money, the ONLY funding path.** PIN-authorized,
  idempotent, velocity-limited in its **own daily bucket** (a day of top-ups
  can't consume the spending allowance, and vice versa), booked as zero-sum
  double-entry legs against `funding:sandbox`, HMAC-signed, audited, and
  stamped with the settlement mode. Full **Add money** UI in the web PWA and
  the mobile app (home tile + zero-balance onboarding card + receipt).
- **Explicit settlement mode** (`BP_SETTLEMENT_MODE`, default `sandbox`).
  Every receipt now carries `settlementMode`; `live` is **fail-closed** — the
  server refuses to boot until a licensed PSP / sponsor-bank adapter is
  integrated and named in `BP_PSP_PROVIDER`. Production boot loudly warns
  while on sandbox rails.
- **`GET /api/meta`** — public, honest deployment disclosure (settlement mode,
  KYC provider, policy versions). Both clients render a visible **🧪 Sandbox**
  badge from it, and receipts show a "Settlement: 🧪 Sandbox (simulated
  rails)" row.
- **Mobile email sign-up** (`/api/auth/signup`) with consent, plus a visible
  warning when a **release** build is still pointing at the local-dev fallback
  instead of a configured `EXPO_PUBLIC_API_BASE`.
- **8 new backend tests** (`test/topup.test.js`): zero-fake-data guarantees,
  top-up PIN/amount/limit enforcement, ledger zero-sum invariant, payee
  derivation + cross-user isolation, `/api/meta`, unfunded-402.

### Changed
- Release smoke suite now asserts the ₹0 start, the unfunded-402, and the
  sandbox-stamped top-up (21 assertions, all green in production mode).
- Terms/Privacy templates, READMEs, and the production-readiness checklist
  rewritten from "demo product" language to the precise **sandbox settlement**
  posture; test counts updated (**93 backend / 20 mobile**).
- Web PWA: welcome screen leads with account creation; camera-less QR path
  offers manual entry (no fake merchant card); forgot-password copy no longer
  says "demo environment"; service-worker cache bumped to v6.

## [1.2.0] — Mobile app 1.1.0: professional relaunch, app lock, sign-in

A co-founder-level cross-check of the mobile app against how professional
payments apps behave, and the fixes for every gap found. Backend unchanged
(1.1.0); mobile `package.json`/`app.json` → **1.1.0**.

### Added (mobile)
- **Persistent sessions — onboard once** (`src/session.js`, `src/storage.js`):
  live-mode tokens persist **only** in the OS keystore/keychain
  (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), rotated in place on silent refresh, and
  erased on logout / account closure / refresh-token death. Killing and
  reopening the app resumes where you belong (lock screen, or the bank-link
  step if onboarding was interrupted) instead of restarting KYC.
- **Demo-mode state persistence** (`src/demo.js` export/import + `expo-file-system`):
  the standalone wallet (account, PIN hash, history, the real hash-chained
  ledger) survives restarts. Restores are **tamper-refusing**: the chain is
  re-verified at import and a corrupt snapshot resets to first run. Demo PIN
  is now stored as a SHA-256 hash, never plaintext. In the browser sim,
  localStorage stands in for private storage — a reload is an app relaunch.
- **App lock** (`App.js`): returning users unlock with Face ID / fingerprint /
  device credential (auto-prompted), payment-PIN fallback in demo mode
  (sharing the payments lockout counter), "Not you? Sign out" escape hatch,
  and **auto-relock** after >60 s in the background.
- **Email sign-in** (live mode): `POST /api/auth/login` from the welcome
  screen, with TOTP 2FA step-up and routing to bank-link or home depending on
  account state.
- **Confirm-PIN + quality rules** (`src/pin.js`): new PINs are entered twice;
  repeated digits, ascending/descending sequences and keypad-line patterns are
  rejected with an explanation.
- **Quote rate-lock countdown**: a visible 60-second timer on both quote
  screens; at zero the pay button swaps to "get a fresh quote".
- **Android back handling + back headers**: hardware back navigates the screen
  graph (blocked during settlement, exits only from home/welcome); every
  sub-screen gained a back chevron; the payment PIN pad gained a cancel.
- **Session-expiry recovery**: a dead refresh token signs the user out cleanly
  (persisted session wiped, one clear alert) instead of stranding them.
- **Mobile tests**: 10 new (24 total) — PIN quality rules and demo-state
  persistence round-trip / tamper-refusal / single-use-quote non-restore.

### Fixed / hardened (mobile)
- A mistyped payment PIN now retries **in place** on the auth screen (server
  lockout still applies) instead of bouncing to the form.
- `npm run live` and `npm run sim` now clear Metro's cache: stale transform
  caches could silently bake the previous mode's `EXPO_PUBLIC_*` values into
  the bundle (verified live builds shipping demo mode; `--clear` fixes it).
- User-invoked refreshes (Activity tab, "See all") surface connection errors
  instead of failing silently; background refreshes never throw.
- Removed an unreachable web branch in the native scanner screen; renamed the
  misleading "Slide to pay/send" labels on tap buttons to "Pay/Send securely".

## [1.1.0] — Deploy-ready hardening

Closes every remaining code-completable item on the production-readiness
checklist; what's left before real money is exclusively partner/credential
work (sponsor bank, licensed KYC vendor, email-provider account, pen test).

### Added
- **Transactional email delivery** (`backend/src/mailer.js`, zero-dependency):
  password-reset tokens are now actually delivered — `BP_EMAIL_PROVIDER=resend`
  or `sendgrid` (HTTPS JSON APIs via built-in `fetch`), `console` transport for
  development. Fail-closed in production: `console` is refused, a real provider
  without `BP_EMAIL_API_KEY` refuses to boot. Delivery failures are logged +
  audited but never change the API response (no enumeration/delivery oracle).
  New env: `BP_EMAIL_PROVIDER`, `BP_EMAIL_API_KEY`, `BP_EMAIL_FROM`,
  `BP_APP_ORIGIN`.
- **KYC provider registry** (`backend/src/kyc.js`): the provider is selected
  with `BP_KYC_PROVIDER` (default `sandbox`); unknown names are fatal at boot;
  production running the sandbox logs a prominent warning. A licensed vendor
  (Onfido/Sumsub/HyperVerge/IDfy…) integrates as a one-entry registry adapter.
- **Mobile automated test suite** (`mobile/test/`, `npm test`): 14 tests pin
  the security-critical pure logic — the UPI QR parser (hostile-input matrix),
  the on-device SHA-256 against FIPS 180-4 + `node:crypto` vectors, the Merkle
  proof fold against the backend's exact math, and INR formatting.
- **CI**: new `mobile` job (runs the mobile tests, no Expo install needed) and
  a runtime **dependency-audit gate** (`npm audit --omit=dev --audit-level=high`).

### Fixed / hardened
- **Static file serving** now uses a boundary-exact prefix check
  (`public/ + sep`), so a sibling directory whose name merely starts with
  "public" can never be served; regression-tested with encoded traversal probes.
- **Boot honesty**: production startup loudly warns when KYC is still the
  sandbox or no email provider is configured.

### Tests
- Backend 75 → **85** (mailer unit + provider payloads + fail-never-throw +
  e2e reset-by-email journey + no-oracle check + traversal probes); mobile
  0 → **14**. Total **99**.

### UX hardening (from running the real app through edge cases)
- **Balance-aware confirmation** (mobile): the cross-border pay/send confirm screens and the domestic compose screen now detect when the total exceeds your balance and show a clear "Insufficient balance — you have ₹X" message with a "Change amount" action, instead of letting you authorize and *then* failing at the server ("fail early, not late"). The backend guard remains the source of truth.
- **Name required at onboarding** (mobile + web): identity verification no longer proceeds with a blank name (it previously substituted a hidden default, causing a "there 👋 / AS" greeting mismatch). The greeting and avatar are now always consistent with the entered name.

## [1.0.0] — Version 1

### Run in a browser (dev/testing convenience — no version bump)
- **`cd mobile && npm run sim`** compiles the real React Native `App.js` to web via `react-native-web` and serves it — zero install, full demo flow including on-device receipt verification. `npm run web` runs the hot-reload dev server. Verified end-to-end headlessly (onboarding → domestic + cross-border payment → receipt → independent Merkle verification) against the exported build.
- **Full native-experience simulation in the browser.** `react-native-web` ships `Alert.alert` as a no-op and provides no OS biometric/permission prompts, which previously left large parts of the app silent or dead in `npm run sim` (error toasts, the consent warning, wrong-PIN feedback, the Verify-ledger result, and the **Log out / Close account** confirmations, whose callbacks never fired). Added a cross-platform alert (`src/alert.js`) — real OS alert on device, themed in-app modal on web — plus faithful **simulated OS prompts** for the biometric authorization sheet and the camera / contacts / notifications permissions (each labelled *"simulated in browser"*, and **remembered for the session** like the real OS: asked once in-context, never nags, denial degrades gracefully). Native devices are unchanged. Also removed a hidden third-party dependency: `expo-camera`'s web build loaded `jsQR` from a CDN at import time (a page error on every load, broken offline/under CSP) — the camera scanner is now gated to native via a platform-specific module (`src/scanner.js` / `src/scanner.web.js`; supersedes the interim `src/camera.*` split). Native Android/iOS camera scanning is unchanged (CAMERA permission still declared).
- **Real QR scanning in the browser sim.** `Scan QR` in the web build now opens the **live camera** whenever the browser has one (the browser's own in-context permission prompt), decoding physical UPI QRs on-device — native `BarcodeDetector` where available (phones), locally bundled `jsqr` elsewhere — through the same hardened `upi://pay…` parser as native; invalid QRs are rejected with a visible warning and scanning continues. No camera → a clearly-labelled simulated scan that still routes a demo UPI payload through the real parser. Verified end-to-end by feeding real QR images to headless Chromium as a fake camera device (valid QR with amount → decoded → prefilled → settled ₹245.50; non-UPI QR → rejected; no device → graceful fallback).
- **Request-money copy fix (all modes):** the compose card said "You pay ₹X" with "Speed: Instant" when *requesting* money; it now reads "You request ₹X" with "Status: Pending until paid".


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
