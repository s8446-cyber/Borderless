# Borderless Pay

**Version 1.3** · One app to pay, send, and request money — at home in India and across borders — at the real mid-market exchange rate with a flat 0.5% fee and zero hidden FX markup.

Borderless Pay lets an Indian traveler pay a foreign merchant or send money abroad directly from their home bank account, with the recipient receiving local currency. Domestic India-to-India payments work too, at ₹0 fee. Every transaction is recorded on a tamper-evident dual ledger and protected by triple-layer security.

> **Honest posture — sandbox settlement.** Borderless Pay runs its production
> codebase against **simulated settlement rails** until the RBI PA-CB
> authorization, sponsor-bank partnership, and licensed KYC vendor are in
> place. There is **zero fake data** anywhere: accounts are real (email +
> scrypt-hashed password), balances start at **₹0** and are funded only
> through the explicit, ledger-recorded **Add money** flow, payees come from
> your own history, and **every receipt is cryptographically signed and
> stamped `sandbox`**. Flipping to live rails is *fail-closed*: the server
> refuses to boot in `live` mode until a real PSP adapter is integrated.
> Full change history: [`CHANGELOG.md`](./CHANGELOG.md).

---

## Repository layout

| Folder | What it is | Stack |
|---|---|---|
| [`backend/`](./backend) | Production API + installable web app (PWA): FX engine, dual ledger, KYC, payments (top-up, cross-border, P2P, domestic, requests), auth, crypto, audit, limits, rate limiting | Node.js (zero-dependency core) |
| [`mobile/`](./mobile) | Native mobile app (iOS + Android) | React Native / Expo |
| [`site/`](./site) | Marketing landing page + waitlist | HTML / CSS / JS |

There are **three things you can run**. The backend (with its web app) and the mobile app are the product; the site is standalone HTML you just open in a browser.

---

## ✅ Testing guide (read this first)

### Prerequisites
- **Node.js 20+** and **npm** (check: `node -v`). Needed for the backend and to install the mobile app.
- A modern **browser** (Chrome/Edge/Safari) for the web app and site.
- **Only for running the mobile app natively:** Android Studio (Android) or Xcode (macOS/iOS). See [`mobile/README.md`](./mobile/README.md). You do **not** need these to test the web app.

> **No real money moves in sandbox mode.** KYC runs through the sandbox
> provider (auto-approves; a licensed vendor drops into `backend/src/kyc.js`),
> and settlement is simulated — which is exactly what every receipt says.

### The fastest way to see the whole product (no phone, no Android Studio)
The backend **also serves the full app as an installable web app (PWA)** at `http://localhost:4000`.

```bash
cd backend
npm install
npm start            # serves API + web app on http://localhost:4000
```
Open **http://localhost:4000** in your browser. For the best experience, open your browser's **device/responsive mode** (Chrome/Edge: F12 → the phone icon) and pick a phone size — the UI is designed phone-first.

Stop the server with `Ctrl+C`.

### Create your account
1. **Create your account** — name, email, password (8+ chars; scrypt-hashed, lockout-protected) + the **Terms/Privacy consent** (recorded and versioned).
2. **Pick a bank** and **set a 4-digit payment PIN** → **Link account**. **Remember this PIN** — it authorizes every payment.
3. **Add money** — your balance starts at **₹0**. Tap **➕ Add money**, enter an amount, authorize with your PIN. The credit books through the same double-entry ledger as every payment and the receipt is stamped **sandbox**.
4. You're funded and on the home screen.

**Also worth exercising:** from **home → 🔐 Security** enable **TOTP 2FA** (works with Google Authenticator/Authy), test *Sign out of ALL devices*, or run the *Forgot password* flow (reset revokes every session). Sessions renew silently via rotating refresh tokens.

### Tester walkthrough (try all of this)
Run through these to exercise every feature. Each payment asks for the **PIN you set**.

- **Add money first** — an unfunded account is correctly refused (`402 insufficient_funds`) if it tries to pay.
- **Domestic (₹0 fee, instant):**
  - **To phone / To UPI ID / To bank** — enter the payee details + an amount → PIN → see the receipt.
  - **Scan QR** — **real camera scanning of any UPI QR** (`upi://pay…`): on a phone the mobile app asks for camera access in-context and auto-fills payee + amount; the web app scans with the camera in Chrome/Edge (BarcodeDetector). No camera? Enter the UPI ID manually.
  - **Recharge** and **Pay bills** (Electricity / DTH / etc.) — pick a biller/operator + amount → PIN. (Biller/operator lists are static service catalogs, like a BBPS directory — not user data.)
  - **Request money** — create a request and track it under Activity.
  - **People** — after you pay someone, they appear as a recent payee (derived from *your own* history; new accounts correctly show nobody).
- **International (0.5% fee, no FX markup):**
  - **Pay abroad** — choose a currency corridor (AED / SGD / EUR / NPR), enter the merchant and the amount they charge, review the transparent rate + fee, PIN, receipt.
  - **Send abroad** — pick the recipient's currency + an INR amount, see exactly what they receive, PIN.
- **Trust features:**
  - On any receipt, note the **settlement ledger hash**, **public anchor**, **HMAC signature** — and the honest **Settlement: 🧪 Sandbox** row.
  - On the receipt, tap **🔎 Verify this receipt independently** — the app recomputes the Merkle proof client-side.
  - Open **`/verify.html`** (the public verifier) — paste any receipt's block index + hash and verify it **without logging in**.
  - Tap **Verify** (home screen) → confirms the ledger is intact and tamper-free.
  - `GET /api/meta` — the deployment publicly discloses its settlement mode; the 🧪 badge in both apps renders from it.
- **Security checks worth trying:** enter a **wrong PIN** (it's rejected; 5 wrong tries locks the account for a while); your balance only ever changes by the exact amount shown, always through the ledger.

### Run the automated test suite
```bash
cd backend
npm test             # 93 tests: unit + security + auth + consent + UPI-QR + mailer + top-up/no-fake-data + hardening + observability + Postgres + full HTTP e2e
```
All 93 should pass (4 Postgres tests self-skip without a live database; CI runs them against Postgres 16). This is the strongest proof the wiring is correct.

---

## 📱 Testing the mobile app

Full, step-by-step instructions (Android Studio, Xcode, and Expo Go) are in **[`mobile/README.md`](./mobile/README.md)**. Short version:

### 🔌 Run the mobile app against the backend (two terminals)
```bash
# Terminal 1 — the backend
cd backend
npm start                    # API on :4000; prints its LAN URLs

# Terminal 2 — the mobile app, wired to it
cd mobile
npm install
npm run live                 # auto-finds the backend and starts Expo pointed at it
```
`npm run live` probes your LAN IP first (so a **physical phone on the same Wi-Fi** can reach the backend), verifies `/api/health`, and launches Expo with the right settings — no env vars, no code edits. If the backend isn't running it tells you exactly what to do. **Verify the wiring:** the welcome screen's build stamp shows the backend URL (and `🧪 sandbox rails`). Quick connectivity check without launching: `npm run live:check`.

### 🖥️ Run the mobile app in a browser — zero install
The **actual** React Native app runs in any browser via `react-native-web` — the real `App.js`, not a copy:
```bash
cd backend && npm start      # Terminal 1 — the app talks to this
cd mobile && npm run sim     # Terminal 2 — builds for web, serves at http://localhost:8080
```
Open **http://localhost:8080** and use device/responsive mode (F12 → phone icon) for the phone-shaped view. *(Live camera QR scanning needs a real device or a browser with camera access.)*

**On your own phone with Expo Go (no Android Studio):**
```bash
cd mobile
npm install
npm run doctor       # verifies your environment (Node, Java 17+, SDK) with exact fixes
npm run live         # requires the backend running (Terminal 1)
```

**Native build in Android Studio:**
```bash
cd mobile
npm install
npm run prebuild     # generates the native android/ + ios/ projects (auto-aligns Gradle with your JDK — any Java 17+ works)
npm run run:android  # builds with Gradle and launches on an emulator/device
```
…or open the generated **`mobile/android`** folder in Android Studio and press ▶.

Notes for testers:
- The mobile app **always talks to a real backend** — there is no standalone demo mode. For local dev it auto-targets `10.0.2.2` (Android emulator) / `localhost` (iOS); for anything else set `EXPO_PUBLIC_API_BASE` (release builds show a visible warning if you forget).
- The `npm install` message about **"N vulnerabilities"** is from Expo's dev tooling and is **harmless** — do **not** run `npm audit fix --force` (it breaks the Expo build). Details in `mobile/README.md`.
- Run the mobile unit tests with `cd mobile && npm test` (20 tests: UPI QR parser, on-device SHA-256 + Merkle fold, PIN quality, INR formatting).

---

## 🌐 Testing the marketing site

Just open **`site/index.html`** in a browser — the waitlist works standalone (saved locally) so you can demo it with no setup.

To test the site **wired to the live backend** (real waitlist + live FX rates), start the backend (`cd backend && npm start`) and open:
```
site/index.html?api=http://localhost:4000
```
The dev backend allows any origin, so the signup form will hit `POST /api/waitlist` and the FX strip will load from `/api/currencies`.

---

## How the pieces connect

```
                       ┌─────────────────────────────┐
  Browser  ───────────▶│  backend (Node, :4000)      │
  (web app/PWA)        │   • REST API  /api/*         │
                       │   • serves the web app (PWA) │
  Mobile app  ────────▶│   • dual ledger + audit      │
  (Expo)               │   • sandbox settlement rails │
                       └─────────────────────────────┘
                                  ▲
  Marketing site  ────────────────┘  (waitlist + FX, when reachable)
```
Same FX math, fee policy, and dual-ledger logic across every client — one backend, no simulators.

## Core principles

- **Zero fake data** — balances start at ₹0 and are funded only through the audited Add-money flow; payees come from your own history; every receipt discloses its settlement mode.
- **Direct home-bank debit** — pay/send straight from your Indian bank account (via sponsor-bank rails at launch).
- **Mid-market FX** — the same rate you see on Google, no markup baked in.
- **Flat 0.5% fee** on cross-border (₹2 floor, ₹500 cap); **₹0** on domestic UPI.
- **Full transparency** — every receipt shows the rate used, the fee, "FX markup: none", and the settlement mode.
- **Triple security** — biometric + device-bound key + PIN on the client (plus optional TOTP 2FA); TLS in transit; signed, hash-chained dual ledger at rest.
- **Your data, your control** — explicit versioned consent (DPDP Act 2023); close your account in-app to erase your profile anytime.
- **Least-privilege permissions** — camera, contacts, and notifications are each requested only in-context, with an OS Allow/Deny prompt; nothing else is collected.
- **Fail-closed everywhere** — production refuses to boot without secrets; live settlement refuses to boot without a licensed PSP adapter; unknown KYC providers refuse to boot.

---

## Troubleshooting

- **`npm start` fails with "port 4000 in use"** → stop the other process or run on another port: `PORT=4100 npm start` (then open `http://localhost:4100`).
- **Web app loads but actions do nothing** → make sure you completed onboarding (create account → link bank + PIN) first; open the browser console (F12) for any message.
- **"Insufficient funds" on your first payment** → that's correct behavior: balances start at ₹0. Tap **➕ Add money** first.
- **Mobile app can't reach the backend** → on Android, `localhost` points at the emulator, not your PC. Use `npm run live` (it picks the right address automatically), or set `EXPO_PUBLIC_API_BASE` to your PC's LAN IP. See `mobile/README.md`.
- **"N vulnerabilities" after `npm install` in `mobile/`** → expected, harmless dev-tooling advisories; don't `--force` fix them.
- **Forgot your PIN** → re-link your bank from a fresh sign-in to set a new PIN (your balance is preserved), or reset the dev server (`npm start` with the default in-memory store) and re-onboard.

---

## Security & compliance

Security and regulatory trust are first-class here. Key documents:

- **[Security policy / responsible disclosure](./SECURITY.md)** — how to report a vulnerability.
- **[Internal security audit report](./docs/SECURITY_AUDIT.md)** — STRIDE threat model, controls, and found-and-fixed findings.
- **[Engineering threat model & controls](./backend/SECURITY.md)** — the in-code defenses.
- **[Regulatory & compliance roadmap](./docs/COMPLIANCE.md)** — RBI PA-CB, FEMA/LRS, sponsor bank, FIU-IND/PMLA, DPDP Act 2023, PCI scope.
- **[Production readiness checklist](./docs/PRODUCTION_READINESS.md)** — done vs. required before real-money launch.
- **[Full-system verification report](./docs/VERIFICATION.md)** — executed check groups, zero defects.
- **[Operations & incident response runbook](./docs/RUNBOOK.md)** — observability surface, alert rules, per-scenario playbooks.
- **[Mobile hardening posture](./mobile/SECURITY.md)** — implemented controls vs. native-build-time items.
- **[Sponsor bank & PA-CB engagement pack](./docs/BANK_ENGAGEMENT_PACK.md)** — the document to open the bank conversation.
- **[Pen-test scope & RFP](./docs/PENTEST_SCOPE.md)** — ready to send to CERT-In empanelled firms.
- **[Investor brief](./docs/INVESTOR_BRIEF.md)** — the trust-as-moat thesis.

> **Honest stance:** this is a hardened pre-production build with a documented
> security posture and a credible licensing path — **not** a claim of zero
> vulnerabilities or current authorization. Independent penetration testing and
> RBI/bank approvals are explicit, tracked pre-launch steps, and settlement
> stays in fail-closed sandbox mode until they land.

## Status

This is a launch-ready sandbox build. Real-money operation requires regulatory approvals (RBI PA-CB authorization, sponsor AD-Cat-I bank partnership, FIU-IND registration, licensed KYC/AML vendor), which are tracked in [`docs/PRODUCTION_READINESS.md`](./docs/PRODUCTION_READINESS.md). The codebase fail-closes live settlement until they are in place.

## License

Proprietary — All rights reserved. © 2026 Borderless Pay.
