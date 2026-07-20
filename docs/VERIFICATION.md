# Borderless Pay — Full-System Verification Report

## v1.3.0 — Real-data posture (current release)

**Scope:** the demo-removal / sandbox-settlement release: backend API + PWA, mobile app, docs, and every changed flow.
**Method:** everything below was **executed, not reviewed** — real servers, real HTTP journeys, real bundles. Re-runnable: each check maps to a command in this repo.

| # | Check | Result |
|---|---|---|
| 1 | Backend test suite (`cd backend && npm test`) — incl. 8 new top-up / no-fake-data / payees / meta tests | ✓ **89 pass / 4 Postgres self-skip / 0 fail** (93 total; CI runs the 4 against Postgres 16) |
| 2 | Syntax: every backend `src/`, `test/`, `public/` JS (`node --check`) | ✓ clean |
| 3 | Production smoke suite (`scripts/release-smoke.sh`, live server in `BP_ENV=production`) — asserts ₹0 opening balance, unfunded-402, sandbox-stamped top-up, the removed passwordless endpoint (404), and `/api/me` profile restore | ✓ **23/23 assertions** |
| 4 | Full HTTP E2E journey (the exact client call sequence): meta disclosure → email signup → link (₹0) → unfunded pay refused → top-up (idempotent, sandbox-stamped) → UPI pay → cross-border with user-entered merchant → public Merkle proof → payees-from-history → refresh rotation → ledger/audit integrity | ✓ 13/13 checks |
| 5 | Ledger invariant: top-up legs are zero-sum against `funding:sandbox`; `/api/ready` passes after every new flow | ✓ verified |
| 6 | Velocity isolation: a maxed day of top-ups does NOT consume the spending allowance (and vice versa) | ✓ verified |
| 7 | Cross-user isolation: payees derive strictly from the caller's own history | ✓ verified |
| 8 | Mobile unit tests (`cd mobile && npm test`) | ✓ **20/20** |
| 9 | Mobile: `App.js` + all `src/` modules parse (Babel, JSX-aware) after the demo-mode excision | ✓ clean |
| 10 | Mobile full bundle: `expo export --platform web` compiles the real `App.js` with zero errors | ✓ exported |
| 11 | Zero-fake-data sweep: no `demo.js`, no seeded contacts/requests, no invented balances, no demo-QR in release paths (`grep` sweep across app code) | ✓ clean |
| 12 | Fail-closed: `BP_SETTLEMENT_MODE=live` refuses to boot without a licensed PSP adapter | ✓ refuses (by construction in `config.js`) |
| 13 | Shell scripts (`release-smoke.sh`) `bash -n` | ✓ clean |
| 14 | Sign-in lifecycle E2E: passwordless endpoint 404 → signup on phone-1 → sign-in on phone-2 restores real name + `bankLinked` via `/api/me` → expired access token silently renewed by refresh rotation (no password re-entry) → fully-revoked session correctly lands on welcome, never a signed-out home | ✓ 10/10 checks |

**Result: 14/14 check groups passed · 0 defects.**

Known non-code items (unchanged, tracked, not defects): sandbox KYC provider and simulated anchor writer await licensed vendors (`docs/COMPLIANCE.md`); Terms/Privacy v1.0 templates pending counsel; transactional email provider account; physical-device pass for biometric/camera dialogs; Docker build validated in CI.

---

## v1.2.0 and earlier — Historical report

**Scope (as of v1.2.0):** every surface (backend/API, PWA web client, mobile app, marketing site, prototype — the prototype and mobile demo mode were removed in v1.3.0), every build path, every claimed feature.
**Method:** everything below was **executed, not reviewed** — real servers, real Postgres, real prebuilds, real cryptographic recomputation.
**Result: 19/19 check groups passed · 0 defects · 1 suspicion investigated and cleared.**

| # | Check | Result |
|---|---|---|
| 0 | Merge-conflict markers anywhere in the repo | ✓ none |
| 1 | Backend test suite (with PostgreSQL) | ✓ **75/75** |
| 2 | Syntax: every backend `src/`, `test/`, `public/` JS + shell scripts | ✓ clean |
| 3 | Service worker: every precached shell file exists | ✓ 11/11 |
| 4 | Web app: every `data-action` button has a handler (dead-button scan) | ✓ none dead |
| 5 | Production smoke, **file store** (19 live assertions incl. consent, device binding, idempotency, Merkle proof, theft response, metrics gating) | ✓ 19/19 |
| 6 | Production smoke, **PostgreSQL** | ✓ 19/19 |
| 7 | Mobile: 14 JS files parse (JSX-aware) · JSON configs valid · dependency matrix = Expo SDK 51 **exact** · `expo prebuild` zero warnings | ✓ all |
| 8 | Mobile demo-mode e2e: consent gate, settle, idempotent replay, on-device receipt verification, 5-fail lockout, logout | ✓ 6/6 |
| 9 | JDK matrix (17 / 21 / 24 accepted, Gradle auto-aligned) · preflight doctor · live.js backend detection | ✓ all |
| 10 | Prototype: embedded JS parses; real SHA-256 chain logic | ✓ clean |
| 11 | CI workflow YAML validity | ✓ valid |
| 12 | `config.js` ↔ `.env.example` parity (no undocumented/phantom env vars) | ✓ perfect |
| 13 | Store schema: `DEFAULT()` covers every key the code touches | ✓ all 13 keys |
| 14 | Live-mode e2e: the mobile app's exact API sequence (headers, device-id, idempotency) against a running backend — KYC→link→pay→**verify proof**→logout | ✓ green |
| 15 | Fail-closed: production boot **refuses** without secrets | ✓ refuses |
| 16 | Shell scripts (`release-smoke.sh`, `run-on-phone.sh`) `bash -n` | ✓ clean |
| 17 | Marketing-site embedded JS parses | ✓ clean |
| 18 | PostgreSQL restart durability: pay → SIGTERM → restart → balance, session, ledger/audit integrity all survive | ✓ survives |
| 19 | UPI parser hostile-input spot-check + doc test-count consistency | ✓ clean |

## API contract cross-check (client ↔ server)
- All **20** web-app API paths exist on the backend ✓
- All **13** mobile API paths exist on the backend ✓
- The demo simulator covers every path the mobile app can reach in demo mode ✓

## Suspicion investigated and cleared
`/api/sessions/refresh` is absent from the mobile demo simulator. **Verified correct-by-design with evidence:** the refresh call lives inside `real()` in `mobile/src/api.js` (the raw-fetch path) and is unreachable in demo mode, where tokens never expire. Not a defect.

## Known non-code items (unchanged, tracked, not defects)
Simulated bank rails / KYC / anchor writer (await sponsor-bank licensing — `docs/COMPLIANCE.md`) · Terms/Privacy v1.0 templates pending counsel finalization + a named grievance officer · transactional email provider · physical-device pass for biometric/camera/permission dialogs (requires real hardware) · Docker base-image pull untestable in the verification sandbox (Dockerfile config verified; CI builds it).

## How to re-run the essentials
```bash
cd backend && npm test                          # 85 tests (+ cd mobile && npm test — 14 more)
npm run smoke http://localhost:4000 [token]     # 19 live assertions vs a running server
cd ../mobile && npm run doctor                  # environment preflight
npm run live:check                              # backend connectivity probe
```
