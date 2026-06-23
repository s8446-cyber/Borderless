# Borderless Pay

**One app to pay, send, and request money — at home in India and across borders — at the real mid-market exchange rate with a flat 0.5% fee and zero hidden FX markup.**

Borderless Pay lets an Indian traveler pay a foreign merchant or send money abroad directly from their home bank account, with the recipient receiving local currency. Domestic India-to-India payments work too, at ₹0 fee. Every transaction is recorded on a tamper-evident dual ledger and protected by triple-layer security.

---

## Repository layout

| Folder | What it is | Stack |
|---|---|---|
| [`backend/`](./backend) | Production API + PWA: FX engine, dual ledger, KYC, payments (cross-border, P2P, domestic, requests), auth, crypto, audit, limits, rate limiting | Node.js (zero-dependency core) |
| [`mobile/`](./mobile) | Native mobile app (iOS + Android) | React Native / Expo |
| [`prototype/`](./prototype) | Single-file interactive clickable prototype of the full mobile experience | HTML / CSS / JS |
| [`site/`](./site) | Marketing landing page + waitlist | HTML / CSS / JS |

---

## Core principles

- **Direct home-bank debit** — pay/send straight from your Indian bank account.
- **Mid-market FX** — the same rate you see on Google, no markup baked in.
- **Flat 0.5% fee** on cross-border (₹2 floor, ₹500 cap); **₹0** on domestic UPI.
- **Full transparency** — every receipt shows the rate used, the fee, and "FX markup: none".
- **Triple security** — biometric + device-bound key + PIN on the client; TLS + mTLS + HSM-style key handling in transit; signed, hash-chained dual ledger at rest.

---

## Quick start

### Backend
```bash
cd backend
npm install
npm test        # 27 tests, security suite included
npm start       # serves API + PWA on PORT (default 4000)
```

### Mobile
```bash
cd mobile
npm install
npx expo start
```

### Prototype
Open `prototype/index.html` in any browser.

### Site
Open `site/index.html` in any browser.

---

## Status

This is a working prototype / pre-production build. Real-money operation requires regulatory approvals (RBI PA-CB authorization, sponsor AD-Cat-I bank partnership, FIU-IND registration, full KYC/AML), which are out of scope of this codebase. See the project's regulatory roadmap for details.

## License

Proprietary — All rights reserved. © 2026 Borderless Pay.
