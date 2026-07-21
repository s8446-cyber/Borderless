# Security review — cross-verification & remediation (v1.3.x)

This document responds, point by point, to the 5 "critical blockers" raised in
external review. Every claim was **reproduced against the actual code** before
any fix; where a claim was correct it is marked **CONFIRMED**. Each item states
exactly **what changed in code (and was verified)** versus **what remains** and
why (native-build / production-infra / partner work that cannot be honestly
"done" from this repo alone). No item is marked resolved on assumption.

---

## 1. Production Android permitted cleartext HTTP — CONFIRMED → **FIXED**

**Verified:** `mobile/plugins/with-cleartext-http.js` set
`android:usesCleartextTraffic="true"` on the **main** manifest, so *every*
variant including **release** permitted plain `http://`.

**Fixed (this change), verified:**
- The plugin now sets `usesCleartextTraffic="false"` by default and installs an
  Android **network security config** (`res/xml/network_security_config.xml`)
  whose `base-config` sets `cleartextTrafficPermitted="false"`. **HTTPS is
  required in release.**
- http still works for the LAN dev workflow via Android's `<debug-overrides>`
  (debug builds only) — release builds ignore it.
- **Certificate / public-key pinning is wired:** setting
  `EXPO_PUBLIC_API_PIN` / `EXPO_PUBLIC_API_PIN_BACKUP` / `EXPO_PUBLIC_API_PIN_DOMAIN`
  at prebuild emits a `<pin-set>` with a **backup pin**. Pin values are your
  server's SPKI SHA-256 (deployment-specific) — the exact `openssl` command is
  in `mobile/SECURITY.md`; nothing is hardcoded or guessed.
- A single explicit escape hatch (`EXPO_PUBLIC_ALLOW_CLEARTEXT=true`) exists for
  a controlled http pilot; it is **off by default** and must never be set for a
  store build.
- **Verification:** unit-rendered both config outputs — default → base-config
  `false`, no pin-set; opt-in+pins → base-config `true` + a 2-entry pin-set.
  Manifest mutation produces `usesCleartextTraffic="false"` +
  `networkSecurityConfig="@xml/network_security_config"`.

**Remaining (native/device):** supply the real production pins and verify TLS +
pinning on a physical device against the HTTPS backend (tracked, `mobile/SECURITY.md`).

---

## 2. Obsolete/vulnerable mobile stack + misleading README — CONFIRMED → **README fixed; SDK upgrade scoped honestly**

**Verified exactly:** Expo SDK **51** / RN **0.74.5**. `npm audit` →
**27 vulnerabilities: 1 critical (`tar`), 12 high (incl. `@xmldom/xmldom`,
`@expo/cli`, `cacache`), 13 moderate, 1 low.** The README called these
"harmless". `npm ci` currently succeeds (the lockfile was resynced in an earlier
pass), but the advisories are real.

**Fixed (this change):**
- Removed the "**harmless**" framing from `mobile/README.md` §0 and the two root
  `README.md` notes. They now state the real counts, that these sit in the Expo
  SDK 51 / RN 0.74 graph (mostly build tooling but **not** dismissible), and that
  the **only correct remedy is upgrading to a supported Expo SDK**, then
  regenerating native projects + lockfile and **re-auditing**.

**Remaining (migration, cannot be verified without a native build):** the SDK
major upgrade itself (SDK 51 → a supported release, RN 0.74 → current). This
changes API surfaces and must be validated by a full prebuild + device build,
so it is **not** claimed done here — it is a tracked release blocker in
`mobile/SECURITY.md` and `docs/PRODUCTION_READINESS.md`. Doing it "properly"
means: upgrade → `expo prebuild --clean` → regenerate `package-lock.json` →
re-run `npm audit` → reassess every remaining advisory on the new tree.

---

## 3. No real payment integrations; misleading "settled/instant" labels — CONFIRMED → **labels fixed; rails remain simulated by design**

**Verified:** `payments.js` only mutates internal balances; `ledger.js`
generates a local `0x…` anchor; `kyc.js` auto-approves; biller/operator catalogs
are static; `/api/topup` credits balance with no external funds. Receipts were
labelled `status:"settled"` and the UI said "Instant". A sandbox badge existed
but the transactional copy still implied real movement.

**Fixed (this change), verified live in a real browser (PWA walkthrough 30/30)
and via Expo web export (mobile):** in **sandbox** mode both clients now say,
prominently and on the actual money surfaces:
- Balance card → **"🧪 Test balance · no real money"**
- Receipts → header **"Simulated: Paid/Sent/Added …"**, subtitle **"🧪 no real
  money moved"**, settlement row **"🧪 Simulated · no real funds moved"**
- Quote/compose → **"🧪 Simulated · no funds moved"** in place of "Instant"

These render off the live `GET /api/meta` `settlementMode`, so they disappear
automatically only when a deployment genuinely runs live rails.

**Remaining (by design, not a defect):** the rails themselves (UPI/bank/BBPS/
recharge/cross-border/PSP), real KYC, and public-chain anchoring are simulated
until the licensed integrations exist — `BP_SETTLEMENT_MODE=live` is
**fail-closed** (server refuses to boot without a PSP adapter). Tracked in
`docs/COMPLIANCE.md` / `docs/PRODUCTION_READINESS.md`.

---

## 4. PostgreSQL persistence unsafe for money — CONFIRMED → **durability + single-writer FIXED; normalized ledger scoped**

**Verified:** `store-pg.js` wrote a single JSON snapshot via **fire-and-forget
write-behind**; the API returned `200` before the row was durable, and nothing
stopped two instances clobbering the shared snapshot.

**Fixed (this change), verified against a real PostgreSQL 16:**
- **Durability-before-ACK:** money-moving requests now `await store.flush()`
  before returning success (`server.js`); `flush()` **rejects** if the durable
  write failed, turning a lost write into a `500` — never a false `200`. A crash
  can no longer lose a payment the client was told settled.
- **Single-writer, fail-closed:** on startup `PgStore.create()` takes a Postgres
  **session-level advisory lock**; a second writer instance **refuses to boot**
  instead of overwriting shared state. This makes "multiple instances overwrite
  each other" impossible.
- **Verification (real PG 16):** new tests in `backend/test/pg.test.js` prove a
  second writer is refused, that a flushed write survives restart, and that
  `flush()` rejects on write failure. Full suite **99/99 with Postgres** (93 +
  6 pg tests), file-store path unaffected.

**Remaining (larger migration, tracked):** a **normalized, per-row transactional
schema** (accounts/journal/idempotency tables) where balance-check + debit +
journal insert + receipt commit in **one serializable transaction with row
locks** — required for true horizontal scale-out. The advisory lock guarantees
correctness *today* by admitting exactly one writer; the normalized schema is
the scale-out follow-up in `docs/PRODUCTION_READINESS.md`. `ON CONFLICT DO
NOTHING` on the append-only mirrors is intentional (idempotent re-mirroring of
immutable, hash-chained rows) — the hash chain + `/api/ready` still detect any
divergence.

---

## 5. Mobile financial-app hardening absent — CONFIRMED → **screenshot protection + cleartext/pinning shipped; attestation/RASP scoped**

**Verified:** the controls were listed as pending in `mobile/SECURITY.md`.

**Fixed (this change):**
- **Screen-capture / recording / recents-thumbnail protection:** new
  `plugins/with-secure-flag.js` sets Android **`FLAG_SECURE`** on the main
  Activity — protecting the PIN pad, balances and receipts, and blocking the
  screen-scraping that overlay/remote-control malware relies on.
- **Cleartext blocked + TLS pinning wired** (see item 1).
- `mobile/SECURITY.md` updated to move these to "implemented" and to keep an
  honest, explicit list of what still requires native SDKs / server services.

**Remaining (native SDK / server, cannot be shipped from JS alone):** Play
Integrity, Apple App Attest, root/jailbreak detection, runtime TLS-pinning
activation with real pins, iOS snapshot masking, overlay/tapjacking +
accessibility-abuse (remote-control scam) detection, RASP/obfuscation, and a
server-side **fraud/risk engine with suspicious-payee warnings**. These are the
GPay/PhonePe-class baseline and are tracked as release blockers in
`mobile/SECURITY.md` §"Required at native-build time" and
`docs/PRODUCTION_READINESS.md`.

---

## Summary

| # | Blocker | Status |
|---|---|---|
| 1 | Cleartext HTTP in release | **Fixed** — cleartext blocked by default + NSC + pinning wired; device verification pending |
| 2 | Obsolete stack / vulns / README | **README fixed** (honest counts, no "harmless"); SDK upgrade scoped as a tracked migration |
| 3 | Misleading "settled/instant" labels | **Fixed** — "Simulated / Test balance / No funds moved" throughout both clients (verified live); rails simulated by design & fail-closed |
| 4 | Unsafe Postgres for money | **Fixed** — durable-before-ACK + fail-closed single-writer (verified on PG 16); normalized transactional schema is the scale-out follow-up |
| 5 | Mobile hardening absent | **Partially fixed** — FLAG_SECURE + cleartext/pinning shipped; attestation/root-detection/RASP/fraud-engine tracked |

Nothing above is marked done without an executed verification, and every
remaining item is named with the reason it cannot be completed from this repo.
