# Changelog

All notable changes to Borderless Pay. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/); versioning is
[SemVer](https://semver.org/).

## [1.5.0] — Contacts & notifications permission pop-ups + payment-auth re-audit (mobile)

### Added (mobile)
- **Contacts permission — real OS Allow/Deny pop-up**, in-context: tapping "From phone" in the People row shows a priming explanation, then the system contacts dialog (`expo-contacts`). Granted → a contact picker (matched on-device, nothing uploaded); denied → demo contacts + manual entry still work; permanently denied → open-settings guidance. `WRITE_CONTACTS` is blocked.
- **Notifications permission — real OS Allow/Deny pop-up**, offered once after the first successful payment (never at launch), fully optional (`expo-notifications`).
- Each permission fires its **own** system dialog at point-of-use with a plain-language reason — camera, contacts, and notifications now all follow this pattern.

### Fixed (mobile) — payment authentication re-audit
- **Biometric gate was cosmetic**: `authenticateAsync()` was called but its result ignored — a failed/cancelled Face ID still let you enter the PIN. Now a failed biometric **blocks the PIN pad** with retry/cancel; success (or no enrolled biometric) unlocks it. Clear "checking / failed / passed" states shown.
- **Double-charge hardening**: PIN entry moved out of an impure `setState` updater (which could double-fire under React's dev double-invocation and mint two idempotency keys) into a pure updater + a single `useEffect` trigger guarded by an in-flight ref; failures reset the guard for a clean retry.

## [1.4.2] — Mobile runtime fixes: dead policy links in demo, stale-build visibility (mobile 1.4.2 → shown on-screen)

### Fixed (mobile)
- **Demo mode opened dead policy URLs**: "Read the Terms / Privacy Policy" launched the browser at the (nonexistent) backend URL because Android reports http links as openable — the inline-summary fallback never fired. Demo mode now shows the informed-consent summary directly; real-backend mode opens the hosted documents with the same fallback.
- **Stale native config = missing camera permission**: the one-step `run-on-phone` scripts now run `expo prebuild --clean`, guaranteeing new native config (like the camera-permission plugin) is always applied over an old generated `android/` folder.

### Added (mobile)
- **Build stamp on the welcome screen** (`v1.4.2 · demo mode / live backend: <url>`): instantly reveals a stale installed build — the #1 cause of "my updates aren't showing on the phone".
- README: a prominent **"Seeing an OLD version?"** rescue box (uninstall old APK, `npm install` after pull, `prebuild:clean`, Metro `-c`) with a one-command full reset.

## [1.4.1] — Prototype parity

The single-file prototype (`prototype/index.html`) had been frozen since day one while the product evolved through 13 PRs. Brought to full parity:

### Added (prototype)
- **Real cryptography**: receipts now append to a genuine SHA-256 hash-chained mini-ledger (browser Web Crypto, same block format as the backend) — the old `rndHex()` decorative hashes are gone. New **"Verify this receipt independently"** button recomputes the chain on-device with a green/red verdict; tamper detection verified.
- **Consent-gated onboarding**: versioned Terms/Privacy checkbox (unchecked by default) with an in-prototype policy summary modal; "Get started" disabled until accepted.
- **Settings parity**: 2FA (TOTP) row, device-bound sessions row, PIN-lockout note, "Sign out of ALL devices", "Close account & erase my data" (double-confirmed), Terms/Privacy row.
- Camera honesty note on the scan screen (prototype simulates; live app scans real UPI QRs, permission asked in-context).

### Fixed (prototype)
- Over-claiming security copy corrected: "end-to-end encryption / mTLS" → "TLS in transit · AES-256-GCM at rest · signed receipts" (matches `SECURITY.md`).

## [1.4.0] — Gap-closure audit: auth UI, silent renewal, CI smoke, offline consent

Relentless full-repo audit; five gaps found and closed:

### Added
- **Web app: complete account-security UI** — the email+password/2FA system finally has a face: *Create account with email* (consent-gated), *Sign in* (with automatic TOTP step-up when the server demands it), *Forgot password* → single-use reset token → new password (revokes all sessions), and a **🔐 Security screen**: TOTP enrollment (secret + otpauth URI for Google Authenticator/Authy, verify-to-enable) and *Sign out of ALL devices*.
- **Web app: silent session renewal** — expired sessions rotate the refresh token once and retry transparently; no more mid-demo stranding.
- **CI: release smoke suite runs on every push** — boots a production-mode server on Postgres and runs all 19 live assertions; PWA client JS now syntax-checked in CI too.
- **Offline consent** — `terms.html`/`privacy.html` precached by the service worker (cache v5).
- **Marketing site**: DPDP-appropriate consent note under the waitlist form (what's stored, no sharing, deletion on request).

### Fixed
- Re-linking a bank account no longer stacks duplicate demo collect-requests (seed is once-per-user).
- International scan screens now say "Demo corridor merchant" — no fake "verified" claims anywhere.

## [1.3.0] — Real QR scanning (mobile 1.3.0)

### Added
- **Mobile: real camera QR scanning** (`expo-camera`) — scans actual UPI payment QRs (`upi://pay…`), auto-fills payee, amount, and note into the payment review. Permission asked **in-context** with a priming card ("camera only while you scan; nothing captured or stored"); denied → manual UPI-ID entry and a demo QR keep everything working (emulators/Expo Go/web included). Camera configured **without** microphone; `RECORD_AUDIO` remains blocked.
- **Web app: real camera QR scanning** where the browser supports `BarcodeDetector` (Chrome/Edge/Android) — same UPI parsing rules; camera stream is always stopped on navigation; demo QR fallback everywhere else.
- **Hardened UPI QR parser** (`mobile/src/upi.js`, mirrored in the web app): validates VPA format, refuses non-INR currency, rejects negative/absurd/sub-paisa amounts, strips control characters, caps display fields — QR contents are treated as hostile input. CI-guarded (14+ cases) including a lock-step check that web and mobile use the identical VPA rule.
- **Web app: Close account & erase my data** link (DPDP parity with mobile) + Privacy/Terms footer links.

## [1.2.0] — Consent & data-rights architecture (DPDP Act 2023)

### Added
- **Enforced, versioned consent**: account creation (demo KYC and email+password) is refused with `consent_required` unless the user explicitly accepts the Terms of Service and Privacy Policy; accepted versions + timestamp are recorded on the user and in the tamper-evident audit chain. `GET /api/policies` exposes current versions for re-prompt detection.
- **Policy documents in-app**: `/terms.html` and `/privacy.html` (v1.0, DPDP-structured templates marked for counsel finalization), linked from the web and mobile consent screens; mobile shows inline summaries when offline.
- **Consent withdrawal / erasure**: `POST /api/account/close` — profile PII erased (name, email, credentials, PIN hash, bank link), all sessions/refresh tokens revoked, closure audited; transaction records retained **pseudonymously** (PMLA/RBI retention). Mobile UI: account menu → Close account (double-confirmed).
- **Least-privilege device permissions** (`mobile/app.json`): only biometrics declared (with purpose strings); mic/storage/overlay permissions **explicitly blocked**; contacts/location/ad identifiers never collected. Policy + store-submission mapping in `docs/PRIVACY_CONSENT.md`.

### Changed
- Release smoke suite now asserts consent enforcement; suite grows to **71 tests**.

## [1.1.0] — Mobile trust parity (mobile app 1.1.0; backend unchanged)

The mobile app now carries the full trust story — piece-for-piece parity with
the web app and backend, in **both** demo and real-backend modes.

### Added (mobile)
- **🔎 Verify this receipt independently** on every receipt: recomputes the Merkle inclusion proof with a pure-JS, on-device **SHA-256** (validated against `node:crypto` on 510 vectors — React Native has no Web Crypto). Also validated against a live real-backend proof.
- **Real hash-chained ledger in the demo simulator**: blocks and anchors are genuinely SHA-256 hash-chained (identical block format to the backend), `/api/ledger/proof/:index` served offline, and `ledger/verify` actually recomputes the chain — the flagship demo is real cryptography, not theater.
- **Log out** (server-side revocation in real mode; clean-slate reset in demo).
- Demo security parity with the backend: **wrong-PIN lockout** (5 attempts), **single-use 60-second quotes**.

### Fixed (mobile)
- Expired quotes no longer strand the user — a fresh quote is fetched automatically.
- Demo `requests/pay` replay now returns the *original* receipt (was falling back to the most recent payment).

## [1.0.0] — V1 release

First production-ready release: a hardened, fully-tested payments platform
running on **demo/simulated rails** (no real money — real bank rails and
licensed KYC arrive with the sponsor-bank integration, tracked in
`docs/COMPLIANCE.md`).

### Added
- **Payments:** cross-border merchant pay (mid-market FX, flat 0.5%, ₹2 floor / ₹500 cap, zero markup), P2P send abroad, domestic UPI-style (phone / VPA / bank / QR, ₹0 fee), bills, recharge, collect requests — all idempotent.
- **Trust:** hash-chained dual settlement ledger + Merkle public anchors (pluggable publisher), hash-chained audit log, HMAC-signed receipts, double-entry legs with a zero-sum invariant enforced at append time, public Merkle inclusion proofs (`/api/ledger/proof/:index`) and a standalone client-side verifier page (`/verify.html`).
- **Auth & accounts:** email+password (scrypt, enumeration-safe login, shared lockout), **TOTP 2FA** (RFC 6238, secrets encrypted at rest), password reset with full session revocation; device-bound sessions; refresh-token rotation with reuse/theft detection; logout + revoke-all.
- **Security:** AES-256-GCM field encryption, tiered per-IP rate limiting, strict CSP/HSTS/frame/sniff/COOP/CORP headers, CORS allowlist, body-size caps, fail-closed production config, secret-redacting structured logs, per-transaction + daily velocity limits.
- **Persistence:** atomic file store (default) **and PostgreSQL** (`BP_PG_URL`) with durable snapshots + append-only ledger/audit mirrors; maintenance sweep GCs expired sessions, refresh & reset tokens, quotes, and idempotency keys.
- **Observability:** Prometheus metrics (`/api/metrics`, token-gated), liveness (`/api/health`) + integrity readiness (`/api/ready`); incident runbook.
- **Clients:** installable PWA web app; React Native (Expo) mobile app with biometric + PIN, keystore-backed device ID, silent session renewal.
- **Ops & docs:** Dockerfile (non-root, healthcheck, optional `pg`), Fly/Render/Compose configs, root CI (tests + Postgres service + Docker build), release smoke suite (`npm run smoke`), and a full document set (security audit, compliance roadmap, bank-engagement pack, pen-test RFP, mobile hardening, production-readiness, release checklist).

### Build tooling
- Android builds work with **any JDK 17+** (auto-aligns the Gradle wrapper).

### Tests
- **68 automated tests**, all passing, run in CI on every push.

### Known limitations (by design for V1)
- Bank debit/payout rails, KYC/sanctions screening, and the public-chain anchor writer are **simulated** — integration points are ready. Transactional email (reset tokens / receipts) needs a provider. Multi-instance deployments need Redis-backed rate-limit/lockout state.
