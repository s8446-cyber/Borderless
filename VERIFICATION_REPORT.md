# Borderless — Finding-by-finding verification report

Every finding was cross-checked against the actual code at
`github.com/s8446-cyber/Borderless` (branch `main`, v1.3, last push 2026-07-23).
Verdicts: **FIXED IN REPO** (already addressed upstream), **CONFIRMED → FIXED HERE**
(was open; fixed in this package), **PARTIALLY OPEN**, **OPEN (out of scope)**,
**NOT CONFIRMED** (claim doesn't match the code).

## Critical blockers

| # | Finding | Verdict | Evidence |
|---|---|---|---|
| 1 | Release Android allows cleartext HTTP | **FIXED IN REPO** | Current `mobile/plugins/with-cleartext-http.js` sets `usesCleartextTraffic="false"` for release, uses a Network Security Config with `cleartextTrafficPermitted="false"` base + debug-overrides only, and wires certificate `<pin-set>` with a backup pin via `EXPO_PUBLIC_API_PIN`/`_BACKUP`/`_DOMAIN`. Cleartext requires an explicit dev opt-in (`EXPO_PUBLIC_ALLOW_CLEARTEXT`), off by default. `with-secure-flag.js` adds FLAG_SECURE. |
| 2 | Expo SDK 51 / RN 0.74.5 obsolete; 27 npm vulns; lockfile inconsistent | **PARTIALLY OPEN** | Still `expo ~51.0.28` / RN `0.74.5`. The SDK upgrade requires network access (npm registry, `npx expo prebuild`, EAS) — impossible from this sandbox. `mobile/README.md` §0 was softened but still says the advisories are "safe to ignore for development"; that wording should be narrowed to dev-tooling-only advisories with a tracked upgrade task. |
| 3 | No real payment integrations; simulated settlement | **FIXED AS DESIGNED / HONESTLY LABELED** | Live mode fail-closes without a licensed PSP adapter; every receipt is stamped `settlementMode`; `/api/topup` books a double-entry `funding:sandbox` leg (money is never invented silently); `/api/meta` exposes the mode for the client badge; loud boot warnings in prod for sandbox settlement and sandbox KYC. Real UPI/BBPS/bank rails require PSP/sponsor-bank licensing — not fixable in code. UI "Simulated / Test balance / No funds moved" labels are documented; the mobile UI files themselves were not audited here. |
| 4 | Postgres write-behind can ACK before durable | **FIXED IN REPO (durability); schema follow-up open** | The request handler awaits `store.flush()` for any response containing a receipt (durability-before-ACK), and PgStore uses an advisory lock for single-writer. Normalized tables + row-locked transactional debit remain a valid architectural follow-up for multi-instance scale. |
| 5 | Mobile hardening absent (Play Integrity, root detection, etc.) | **PARTIALLY FIXED, HONESTLY TRACKED** | `mobile/SECURITY.md` implements: app lock, server-side PIN, device-bound sessions, refresh rotation + reuse-revoke-all, Keystore-held tokens, FLAG_SECURE, cleartext off, pinning. Tracked as open: Play Integrity / App Attest, root/jailbreak detection, overlay defense, obfuscation verification, fraud/risk engine, suspicious-payee & accessibility-scam detection. These require native builds, device testing, and vendor services — not achievable from this environment. |

## High-risk: authentication & sessions

| Finding | Verdict | Resolution |
|---|---|---|
| Shared lockout for login/PIN/TOTP | **CONFIRMED → FIXED HERE** | `LoginGuard` scoped per `(userId, scope)`: `login` / `pin` / `totp`. Test proves a login lockout leaves PIN topup working. |
| Session/refresh tokens plaintext server-side | **CONFIRMED → FIXED HERE** | All tokens stored under `sha256(token)`; boot migration re-keys legacy records; tests assert no `tok_`/`rtk_`/`prt_` keys at rest. |
| Reset tokens stored plaintext | **CONFIRMED → FIXED HERE** | Hashed like the others; full reset flow tested. |
| No authenticated password change | **CONFIRMED → FIXED HERE** | New `/api/auth/password/change`; revokes other sessions + all refresh tokens; tested. |
| No TOTP disable / recovery codes | **CONFIRMED → FIXED HERE** | 10 single-use hashed recovery codes on enable; `/api/auth/2fa/disable` requires password + second factor; tested. |
| Account closure without reauth | **CONFIRMED → FIXED HERE** | Password now required; tested. |
| 8-char password minimum, no screening | **CONFIRMED → PARTIALLY FIXED HERE** | Configurable minimum, common-password denylist, repeat-char check. Full breached-password screening (e.g. HIBP k-anonymity) needs an external API — documented follow-up. |
| Synchronous scrypt CPU exhaustion | **CONFIRMED → FIXED HERE** | Async scrypt on all unauthenticated/auth-changing paths. |
| Device binding is client-generated | **CONFIRMED — OPEN (by design)** | `sha256(deviceId)` binding is best-effort; hardware attestation (Play Integrity/App Attest) is the tracked mobile item. |
| Silent unlock without local auth enrolled | **OPEN (mobile, out of scope)** | Native change in the app's lock screen flow; noted for the mobile backlog. |
| No CSRF protection | **NOT CONFIRMED** | Bearer-token-only API, no cookies, CORS allowlist — CSRF does not apply to this design. |
| Rate limiting process-memory only | **CONFIRMED — OPEN (documented)** | Needs shared infrastructure (Redis) for replicas; contradicts the zero-dependency constraint, so documented instead of code-fixed. |

## High-risk: cryptography & ledger

| Finding | Verdict | Resolution |
|---|---|---|
| Fixed scrypt salt for the encryption passphrase | **CONFIRMED → FIXED HERE** | Prod now requires `BP_ENC_SALT` (≥16 chars) or boot fails; legacy salt is dev-only. |
| HMAC receipts not independently verifiable | **CONFIRMED — OPEN (documented)** | True: HMAC needs the server secret. Asymmetric receipt signatures (Ed25519 + published key, with key IDs/rotation) are the right follow-up. |
| "Public anchor" is simulated | **CONFIRMED — TRUE & LABELED** | `ledger.js` marks the publisher pluggable and simulated; receipts/mode expose sandbox status; a real public-chain writer is a production integration. |
| Key rotation / key IDs absent | **CONFIRMED — OPEN (documented)** | Requires a key-management design (envelope encryption, versioned ciphertext prefix exists as `v1:`); follow-up. |
| Mobile verifies Merkle inclusion but not receipt authenticity | **CONFIRMED — OPEN (depends on asymmetric receipts above)** | The proof endpoint itself is public and PII-free (hashes only). |

## Test evidence (this package)

`backend/test/security-fixes.test.js` — 8/8 passing (Node 24, `node --test`):
tokens hashed at rest + refresh rotation/reuse detection; legacy key migration;
scoped lockouts (login locked, PIN still works); password change revoking other
sessions; reset flow with hashed tokens; 2FA recovery codes (single-use) +
disable flow; account-close reauth; weak-password rejection.

## What could NOT be done from this environment (honest limits)

- **Expo SDK / RN upgrade & lockfile regeneration** — requires npm registry access and native prebuilds (sandbox has no network).
- **Mobile hardening items** — require native modules, device builds, and vendor services (Play Integrity, App Attest).
- **Real payment/KYC rails** — require PSP/sponsor-bank/KYC-vendor licenses and credentials.
- **Pushing to GitHub** — the repo is not connected; apply the packaged files manually.
- Six unchanged modules (`store`, `audit`, `totp`, `fx`, `limits`, `money`) were re-transcribed and are validated by syntax check + the passing end-to-end suite (the TOTP tests interoperate with an independent RFC 6238 implementation), not byte-compared; `mailer.js` is byte-identical (git SHA verified).
