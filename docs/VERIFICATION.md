# Borderless Pay — Full-System Verification Report

**Scope:** every surface (backend/API, PWA web client, mobile app, marketing site, prototype), every build path, every claimed feature.
**Method:** everything below was **executed, not reviewed** — real servers, real Postgres, real prebuilds, real cryptographic recomputation. Re-runnable: each check maps to a command in this repo.
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
Simulated bank rails / KYC / anchor writer (await sponsor-bank licensing — `docs/COMPLIANCE.md`) · Terms/Privacy v1.0 templates pending counsel + named grievance officer · transactional email provider · physical-device pass for biometric/camera/permission dialogs (requires real hardware) · Docker base-image pull untestable in the verification sandbox (Dockerfile config verified; CI builds it).

## How to re-run the essentials
```bash
cd backend && npm test                          # 75 tests
npm run smoke http://localhost:4000 [token]     # 19 live assertions vs a running server
cd ../mobile && npm run doctor                  # environment preflight
npm run live:check                              # backend connectivity probe
```
