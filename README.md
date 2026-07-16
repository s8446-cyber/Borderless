# Borderless Pay

**Version 1.0** · One app to pay, send, and request money — at home in India and across borders — at the real mid-market exchange rate with a flat 0.5% fee and zero hidden FX markup.

Borderless Pay lets an Indian traveler pay a foreign merchant or send money abroad directly from their home bank account, with the recipient receiving local currency. Domestic India-to-India payments work too, at ₹0 fee. Every transaction is recorded on a tamper-evident dual ledger and protected by triple-layer security.

> **For testers:** nothing here moves real money. Everything runs locally with demo data. Jump to **[Testing guide](#-testing-guide-read-this-first)**. Full change history: [`CHANGELOG.md`](./CHANGELOG.md).

---

## Repository layout

| Folder | What it is | Stack |
|---|---|---|
| [`backend/`](./backend) | Production API + installable web app (PWA): FX engine, dual ledger, KYC, payments (cross-border, P2P, domestic, requests), auth, crypto, audit, limits, rate limiting | Node.js (zero-dependency core) |
| [`mobile/`](./mobile) | Native mobile app (iOS + Android) | React Native / Expo |
| [`site/`](./site) | Marketing landing page + waitlist | HTML / CSS / JS |
| [`prototype/`](./prototype) | Single-file clickable prototype of the mobile experience | HTML / CSS / JS |

There are **four things you can run**. The backend and the mobile app are the real product; the site and prototype are standalone HTML you just open in a browser.

---

## ✅ Testing guide (read this first)

### Prerequisites
- **Node.js 18+** and **npm** (check: `node -v`). Needed for the backend and to install the mobile app.
- A modern **browser** (Chrome/Edge/Safari) for the web app, site, and prototype.
- **Only for running the mobile app natively:** Android Studio (Android) or Xcode (macOS/iOS). See [`mobile/README.md`](./mobile/README.md). You do **not** need these to test the web app.

> **No real bank, card, money, or accounts are involved anywhere.** KYC auto-approves, balances are fake (you start with ₹2,50,000), and "settlement" is simulated.

### The fastest way to see the whole product (no phone, no Android Studio)
The backend **also serves the full app as an installable web app (PWA)** at `http://localhost:4000`.

```bash
cd backend
npm install
npm start            # serves API + web app on http://localhost:4000
```
Open **http://localhost:4000** in your browser. For the best experience, open your browser's **device/responsive mode** (Chrome/Edge: F12 → the phone icon) and pick a phone size — the UI is designed phone-first.

Stop the server with `Ctrl+C`.

### Demo login / what to enter
The fastest path has **no signup or password**:
1. **Enter any name** → accept the **Terms/Privacy consent** → tap **Verify identity (KYC)** (auto-approves instantly).
2. **Pick a bank** and **set a 4-digit PIN** → tap **Link account**. **Remember this PIN** — you'll use it to authorize every payment. You start with a balance of **₹2,50,000**.
3. You're on the home screen.

**Or exercise the full account system (web app):** *Create account with email* → email + password (scrypt-hashed, lockout-protected) → then from **home → 🔐 Security** enable **TOTP 2FA** (works with Google Authenticator/Authy), test *Sign out of ALL devices*, or run the *Forgot password* flow (reset revokes every session). Sessions renew silently via rotating refresh tokens.

### Tester walkthrough (try all of this)
Run through these to exercise every feature. Each payment asks for the **PIN you set**.

- **Domestic (₹0 fee, instant):**
  - **To phone / To UPI ID / To bank** — enter any details + an amount → PIN → see the receipt.
  - **Scan QR** — **real camera scanning of any UPI QR** (`upi://pay…`): on a phone the mobile app asks for camera access in-context and auto-fills payee + amount; the web app scans with the camera in Chrome/Edge (BarcodeDetector). A **demo QR** button (Cafe Coffee Day) works everywhere — emulators, denied camera, unsupported browsers.
  - **Recharge** and **Pay bills** (Electricity / DTH / etc.) — pick a biller/operator + amount → PIN.
  - **Request money** — create a request; also a sample **incoming request (Rohan, ₹450)** is waiting on the home screen — tap **Pay** to clear it.
- **International (0.5% fee, no FX markup):**
  - **Pay abroad** — choose a corridor (UAE / Singapore / France / Nepal), "scan", review the transparent rate + fee, PIN, receipt.
  - **Send abroad** — pick the recipient's currency + an INR amount, see exactly what they receive, PIN.
- **Trust features:**
  - On any receipt, note the **settlement ledger hash**, **public anchor**, and **HMAC signature**.
  - On the receipt, tap **🔎 Verify this receipt independently** — the app recomputes the Merkle proof client-side.
  - Open **`/verify.html`** (the public verifier) — paste any receipt's block index + hash and verify it **without logging in**.
  - Tap **Verify** (home screen) → confirms the ledger is intact and tamper-free.
- **Security checks worth trying:** enter a **wrong PIN** (it's rejected; 5 wrong tries locks the account for a while); your balance only ever decreases by the exact amount shown.

### Run the automated test suite
```bash
cd backend
npm test             # 75 tests: unit + security + auth + consent + UPI-QR + hardening + observability + Postgres + full HTTP e2e
```
All 75 should pass. This is the strongest proof the wiring is correct.

---

## 📱 Testing the mobile app

Full, step-by-step instructions (Android Studio, Xcode, and Expo Go) are in **[`mobile/README.md`](./mobile/README.md)**. Short version:

### 🖥️ Run the mobile app in a browser — zero install (fastest of all)
The **actual** React Native app runs in any browser via `react-native-web` — the real `App.js`, not a copy. Perfect for a quick look, a demo, or an investor who won't install anything:
```bash
cd mobile
npm install
npm run sim          # builds the app for web and serves it at http://localhost:8080
```
Open **http://localhost:8080** and use device/responsive mode (F12 → phone icon) for the phone-shaped view. Runs in demo mode — onboard, pay, and tap **Verify this receipt independently** (real on-device SHA-256). *(Live camera QR scanning needs a real device; the demo QR button works here.)*

**Easiest — on your own phone with Expo Go (no Android Studio):**
```bash
cd mobile
npm install
npm run doctor       # verifies your environment (Node, Java 17+, SDK) with exact fixes
npm start            # scan the QR code with the Expo Go app
```

### 🔌 Test the mobile app against the REAL backend (two terminals)
This is how you exercise **everything we've built** — the mobile UI driving the real API, ledger, auth, and consent, end to end:

```bash
# Terminal 1 — the backend
cd backend
npm start                    # API on :4000; prints its LAN URLs

# Terminal 2 — the mobile app, wired to it
cd mobile
npm run live                 # auto-finds the backend, turns demo mode OFF, starts Expo
```
`npm run live` probes your LAN IP first (so a **physical phone on the same Wi-Fi** can reach the backend), verifies `/api/health`, and launches Expo with the right settings — no env vars, no code edits. If the backend isn't running it tells you exactly what to do. **Verify you're live:** the welcome screen's build stamp reads `live backend: http://<your-ip>:4000` instead of `demo mode`. Quick connectivity check without launching: `npm run live:check`.

**Native build in Android Studio:**
```bash
cd mobile
npm install
npm run prebuild     # generates the native android/ + ios/ projects (and auto-aligns Gradle with your JDK — any Java 17+ works, no JDK 17 install needed)
npm run run:android  # builds with Gradle and launches on an emulator/device
```
…or open the generated **`mobile/android`** folder in Android Studio and press ▶.

Notes for testers:
- The mobile app defaults to **`DEMO_MODE: true`** (`mobile/src/config.js`), so it runs **fully standalone** — no backend needed. Same demo flow as above.
- The `npm install` message about **"N vulnerabilities"** is from Expo's dev tooling and is **harmless** — do **not** run `npm audit fix --force` (it breaks the Expo build). Details in `mobile/README.md`.
- To make the mobile app talk to the **real backend** instead of the simulator, set `DEMO_MODE: false`; the API URL is chosen automatically per platform (Android emulator → `10.0.2.2`, iOS → `localhost`, real phone → set your PC's LAN IP).

---

## 🌐 Testing the marketing site

Just open **`site/index.html`** in a browser — the waitlist works standalone (saved locally) so you can demo it with no setup.

To test the site **wired to the live backend** (real waitlist + live FX rates), start the backend (`cd backend && npm start`) and open:
```
site/index.html?api=http://localhost:4000
```
The dev backend allows any origin, so the signup form will hit `POST /api/waitlist` and the FX strip will load from `/api/currencies`.

## 🖱️ Prototype

Open **`prototype/index.html`** in any browser — a single-file clickable mock of the mobile experience, no install required. It mirrors the real product: consent-gated onboarding, a REAL SHA-256 hash-chained ledger computed in your browser (tap **Verify this receipt independently** on any receipt), 2FA/device-binding/erasure rows in settings, and honest demo labels.

---

## How the pieces connect

```
                       ┌─────────────────────────────┐
  Browser  ───────────▶│  backend (Node, :4000)      │
  (web app/PWA)        │   • REST API  /api/*         │
                       │   • serves the web app (PWA) │
  Mobile app  ────────▶│   • dual ledger + audit      │
  (Expo, real mode)    └─────────────────────────────┘
                                  ▲
  Marketing site  ────────────────┘  (waitlist + FX, when reachable)

  Mobile app (DEMO_MODE: true)  ──▶  built-in simulator (src/demo.js), no server
```
Same FX math, fee policy, and dual-ledger logic across every client.

## Core principles

- **Direct home-bank debit** — pay/send straight from your Indian bank account.
- **Mid-market FX** — the same rate you see on Google, no markup baked in.
- **Flat 0.5% fee** on cross-border (₹2 floor, ₹500 cap); **₹0** on domestic UPI.
- **Full transparency** — every receipt shows the rate used, the fee, and "FX markup: none".
- **Triple security** — biometric + device-bound key + PIN on the client (plus optional TOTP 2FA on email accounts); TLS in transit; signed, hash-chained dual ledger at rest.
- **Your data, your control** — explicit versioned consent (DPDP Act 2023); close your account in-app to erase your profile anytime.
- **Least-privilege permissions** — camera, contacts, and notifications are each requested only in-context, with an OS Allow/Deny prompt; nothing else is collected.

---

## Troubleshooting

- **`npm start` fails with "port 4000 in use"** → stop the other process or run on another port: `PORT=4100 npm start` (then open `http://localhost:4100`).
- **Web app loads but actions do nothing** → make sure you completed onboarding (KYC → link bank + PIN) first; open the browser console (F12) for any message.
- **Mobile app can't reach the backend** → on Android, `localhost` points at the emulator, not your PC. Keep `DEMO_MODE: true`, or use the auto-selected `10.0.2.2` (real mode). See `mobile/README.md`.
- **"N vulnerabilities" after `npm install` in `mobile/`** → expected, harmless dev-tooling advisories; don't `--force` fix them.
- **Forgot your demo PIN** → just stop the server and `npm start` again (in-memory by default), or re-onboard with a new name.

---

## Security & compliance

Security and regulatory trust are first-class here. Key documents:

- **[Security policy / responsible disclosure](./SECURITY.md)** — how to report a vulnerability.
- **[Internal security audit report](./docs/SECURITY_AUDIT.md)** — STRIDE threat model, controls, and found-and-fixed findings (CI: 75 tests).
- **[Engineering threat model & controls](./backend/SECURITY.md)** — the in-code defenses.
- **[Regulatory & compliance roadmap](./docs/COMPLIANCE.md)** — RBI PA-CB, FEMA/LRS, sponsor bank, FIU-IND/PMLA, DPDP Act 2023, PCI scope.
- **[Production readiness checklist](./docs/PRODUCTION_READINESS.md)** — done vs. required before real-money launch.
- **[Full-system verification report](./docs/VERIFICATION.md)** — 19/19 executed check groups, zero defects.
- **[Operations & incident response runbook](./docs/RUNBOOK.md)** — observability surface, alert rules, per-scenario playbooks.
- **[Mobile hardening posture](./mobile/SECURITY.md)** — implemented controls vs. native-build-time items.
- **[Sponsor bank & PA-CB engagement pack](./docs/BANK_ENGAGEMENT_PACK.md)** — the document to open the bank conversation.
- **[Pen-test scope & RFP](./docs/PENTEST_SCOPE.md)** — ready to send to CERT-In empanelled firms.
- **[Investor brief](./docs/INVESTOR_BRIEF.md)** — the trust-as-moat thesis.

> **Honest stance:** this is a hardened pre-production build with a documented
> security posture and a credible licensing path — **not** a claim of zero
> vulnerabilities or current authorization. Independent penetration testing and
> RBI/bank approvals are explicit, tracked pre-launch steps.

## Status

This is a working prototype / pre-production build. Real-money operation requires regulatory approvals (RBI PA-CB authorization, sponsor AD-Cat-I bank partnership, FIU-IND registration, full KYC/AML), which are out of scope of this codebase.

## License

Proprietary — All rights reserved. © 2026 Borderless Pay.
