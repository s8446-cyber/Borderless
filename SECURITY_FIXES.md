# Borderless — Security fixes (backend)

This package contains a fixed copy of `backend/` addressing the auth/session and
crypto findings that were verified as OPEN in the security review, plus a
regression test suite (`backend/test/security-fixes.test.js`, 8 tests, all passing
on Node 24 with `node --test`).

## Files with functional changes

| File | Change |
|---|---|
| `src/auth.js` | Added `hashPinAsync` / `verifyPinAsync` (promisified scrypt — request paths no longer block the event loop) and `tokenLookupKey(token)` = SHA-256 hex, used to key all tokens at rest. Sync functions kept for compatibility. |
| `src/security.js` | `LoginGuard` is now **scoped**: failures/locks are tracked per `(userId, scope)` with scopes `login`, `pin`, `totp` — a login lockout no longer locks the payment PIN and vice versa. Password policy strengthened: configurable min length, ~50-entry common-password denylist (rejects `password123` etc.), repeated-character rejection. |
| `src/config.js` | Fixed-salt fix: in production a passphrase-derived encryption key now **requires** `BP_ENC_SALT` (min 16 chars) — boot fails otherwise; the legacy fixed salt survives only in dev. Added `BP_PASSWORD_MIN_LENGTH` (default 8). |
| `src/payments.js` | PIN authorization uses the dedicated `"pin"` lockout scope. |
| `src/server.js` | See below. |
| `test/security-fixes.test.js` | New regression suite. |

## server.js changes

1. **Tokens hashed at rest** — session, refresh, and password-reset tokens are stored under `sha256(token)`; the raw token exists client-side only. A leaked DB snapshot is no longer replayable. Lookup (`requireAuth`, refresh, logout, reset) hashes the presented token.
2. **Boot-time migration** — `migrateTokenKeys(store)` re-keys any legacy plaintext `tok_`/`rtk_`/`prt_` records to their hash (idempotent; live clients keep working).
3. **Scoped lockouts wired through** — login failures → `login` scope, TOTP failures → `totp` scope, PIN failures → `pin` scope (payments.js).
4. **Async scrypt on auth paths** — signup, login, reset, account close, password change, 2FA disable all use `verifyPinAsync`/`hashPinAsync` (CPU-exhaustion fix). The dummy-hash timing equalizer for unknown emails is preserved.
5. **NEW: `POST /api/auth/password/change`** — requires the current password (login-scope guarded), applies full password policy, rejects same-password, revokes **all other sessions and all refresh tokens** (the calling session survives). Audited.
6. **NEW: `POST /api/auth/2fa/disable`** — requires password **and** a TOTP code or unused recovery code; clears the secret and codes. A stolen bearer token alone can never strip 2FA. Audited.
7. **NEW: TOTP recovery codes** — `2fa/enable` returns 10 single-use codes (shown once; stored as SHA-256 hashes). Accepted in the `totp` field at login and the `code` field at disable; consumption is audited with remaining count.
8. **Account closure reauthentication** — `POST /api/account/close` now requires `{ password }` when credentials exist (401 `reauth_required` otherwise), guarded by the login scope.
9. **Refresh rotation kept intact** — `rotatedTo` stores the *new* record's lookup hash (never a live raw token); reuse detection still revokes everything.
10. **Password reset** — token stored hashed; completing a reset re-hashes the password asynchronously and clears the login lockout.

## New/changed API surface

- `POST /api/auth/password/change` `{ currentPassword, newPassword }` → `{ ok, revokedOtherSessions }`
- `POST /api/auth/2fa/disable` `{ password, code }` → `{ ok, totpEnabled: false }`
- `POST /api/auth/2fa/enable` now additionally returns `recoveryCodes: string[10]` (display once)
- `POST /api/account/close` now requires `{ password }`
- Login accepts a recovery code in the `totp` field

## Posture notes (verified, intentionally not "fixed" in code)

- **CSRF**: not applicable as-is — the API is bearer-token only, sets no cookies, and CORS is allowlisted. CSRF defenses become necessary only if cookie auth is ever added.
- **Rate limiting / lockouts in process memory**: real, documented limitation for multi-replica deployments; needs a shared store (e.g. Redis) — cannot be fixed inside this zero-dependency backend without adding infrastructure.
- **PIN verification on payment paths** stays synchronous scrypt: it is short, per-request work behind the payment rate-limit tier and the `pin` lockout scope. All *unauthenticated* scrypt paths are async.
- **Lockout-state migration**: pre-existing bare-`userId` fail/lock entries become inert (new keys are `scope:userId`); users mid-lockout at upgrade time are effectively unlocked once.

## How to apply

Copy `backend/src/*.js`, `backend/test/security-fixes.test.js` over the repo, then:

```
cd backend
npm run check     # node --check every file
node --test test/security-fixes.test.js
```

Note: files were reconstructed from the repo with normalized (2-space) indentation, so
diffs against origin are whitespace-noisy; `src/mailer.js` is byte-identical to origin
(git blob SHA verified). Review the semantic changes in the files listed above.
