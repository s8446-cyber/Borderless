# Security Overview — Borderless Pay

This document describes the security controls built into the Borderless Pay
backend. It is an engineering reference, not legal/compliance advice (the user
handles regulatory/licensing matters).

## Threat model (what we defend against)

| Threat | Control |
| --- | --- |
| Stolen DB file / data-at-rest exposure | Raw account numbers encrypted with AES-256-GCM; PINs stored only as salted scrypt hashes; secrets never persisted. |
| Retroactive tampering with money records | Hash-chained settlement ledger + Merkle public anchors + hash-chained audit log; `/api/ready` and `/api/*/verify` detect any edit. |
| Forged payment authorization | Every settled payment is HMAC-SHA256 signed over its canonical fields. |
| Brute-forcing PINs | Per-user lockout after N failed attempts (configurable); constant-time PIN comparison. |
| Request flooding / DoS | Per-IP sliding-window rate limiting, with stricter tiers for auth and payment endpoints; body-size cap. |
| Double-spend / duplicate submits | Idempotency keys on all money-moving endpoints; atomic balance debit before ledger write. |
| Fat-finger / account draining | Per-transaction min/max + daily total + daily count velocity limits. |
| XSS / clickjacking / sniffing | Strict CSP (`script-src 'self'`, no inline JS), `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP/CORP. |
| TLS downgrade | HSTS (preload) in production; force-HTTPS at the platform layer (Fly/Render). |
| CSRF / hostile origins | CORS allowlist (same-origin by default in prod); bearer-token auth (not cookies). |
| Session theft / replay | Random 256-bit tokens with server-enforced expiry. |
| Misconfiguration in prod | Fail-closed config: the process refuses to start without `BP_SIGNING_SECRET` and `BP_ENC_KEY`. |
| Information leakage via errors | Sanitized error responses in production (no stack traces / internal messages); structured logs with secret redaction. |
| Corrupt persistence | Atomic writes (tmp + rename, mode 0600) and corrupt-file quarantine on startup. |

## Cryptography

- **PIN storage:** scrypt (N=16384, r=8, p=1, 64-byte key), versioned format
  `scrypt$N$r$p$salt$hash`. Legacy `salt:hash` hashes still verify.
- **Authorization signatures:** HMAC-SHA256 over `paymentId | userId | currency |
  localAmount | amountMinor | feeMinor | totalMinor | settlementHash`.
- **Field encryption:** AES-256-GCM (authenticated), format `v1:iv:tag:ciphertext`.
- **Ledger/audit integrity:** SHA-256 hash chains + Merkle roots.
- **Comparisons:** `timingSafeEqual` for PINs, signatures, and tokens.

## Money handling

- All amounts are stored and computed in integer **minor units** (paise) — never
  floats — to eliminate rounding/precision bugs.
- Balance is debited atomically before the ledger entry is written.
- Quotes expire (default 60s) and are single-use.

## Secrets management

- Provide `BP_SIGNING_SECRET` and `BP_ENC_KEY` via environment / platform secret
  store (Fly secrets, Render env, Docker secrets). Never commit them.
- Generate: `openssl rand -hex 48` (signing), `openssl rand -hex 32` (enc key).
- Rotating `BP_ENC_KEY` requires re-encrypting existing encrypted fields; rotating
  `BP_SIGNING_SECRET` invalidates verification of historical signatures (keep old
  keys for verification if you rotate).

## Verifying integrity in production

```bash
curl https://YOUR_HOST/api/ready          # 200 only if ledger + audit verify
curl https://YOUR_HOST/api/ledger/verify  # settlement chain
curl https://YOUR_HOST/api/audit/verify   # audit chain
```

## Known limitations (by design, for a reference implementation)

- File-backed JSON store. For real scale/HA, swap `src/store.js` for Postgres
  behind the same interface and move rate-limit/lockout state to Redis.
- The “public chain anchor” is simulated (hash anchoring), not a live L1/L2 broadcast.
- KYC/sanctions screening is a stub; wire a real provider before going live.
- Bank debit / payout rails are simulated; integrate a licensed PSP/bank partner.

## Reporting

Report vulnerabilities privately to the security owner before public disclosure.
