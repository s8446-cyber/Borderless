# Borderless Pay Mobile — Security Posture & Hardening Path (G-6)

Honest split between **implemented now** and **required at native-build time**
(items that need EAS/native configuration and a physical-device test matrix —
they cannot be meaningfully verified from JS alone, so we don't pretend).

## Implemented in this codebase ✅

| Control | Where | Notes |
|---|---|---|
| App lock at launch + auto-lock | `App.js` (`expo-local-authentication`) | A returning user must pass Face ID / fingerprint / device credential (payment PIN in demo mode) before seeing any data; backgrounding for >60 s re-locks |
| Biometric gate + payment PIN | `App.js` (`expo-local-authentication`) | PIN verified **server-side** (scrypt, lockout after 5 fails) — the client never decides |
| PIN quality + confirmation | `src/pin.js`, `App.js` | New PINs are entered twice and trivially guessable ones (0000…9999, sequences, keypad lines) are rejected before they reach the server |
| Device-bound sessions | `src/device.js`, `src/api.js` | Per-install device ID kept in the OS keystore/keychain (`expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`); the server binds the session to its SHA-256 and rejects other devices |
| Refresh-token rotation | `src/api.js` | Silent one-shot renewal on session expiry; server revokes **all** sessions if a rotated token is ever replayed (theft signal). A dead refresh token signs the user out cleanly and wipes the persisted session |
| Tokens only in the keystore | `src/api.js`, `src/session.js`, `src/storage.js` | Access/refresh tokens live in memory while running; the persisted copy (for app-lock relaunch) sits **only** in the OS keystore/keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`), never in AsyncStorage/files, and is erased on logout, account closure and refresh-token death. In the browser sim, live tokens are memory-only |
| Tamper-refusing state restore | `src/demo.js` | Demo-mode state persisted across launches is re-verified at import (full hash-chain walk); a tampered snapshot resets to first run instead of restoring a corrupt wallet |
| No secrets in the bundle | whole app | The app holds no API keys or signing material; everything sensitive is server-side |
| Idempotent payments | `src/api.js` + backend | `Idempotency-Key` per attempt — a retried request can never double-charge |

## Required at native-build time ⬜ (tracked, not claimed)

These go into the EAS/native build **before store release**, with verification
on the physical-device matrix:

1. **Certificate pinning / network security config**
   - Android: `android.networkSecurityConfig` pinning the API's leaf/intermediate SPKI hashes; flip `usesCleartextTraffic` back to **false**. (It is currently **explicitly enabled for all variants** via `plugins/with-cleartext-http.js` so LAN/pilot phones can reach the plain-http dev backend — Expo's template only enabled it for debug, which silently broke live mode in release builds. Once the backend is behind HTTPS, delete that plugin and pin.)
   - iOS: `NSAppTransportSecurity` with pinned certificates (or TrustKit via config plugin).
   - Ship a pin-rotation plan (dual pins: current + next) *before* enabling — a bad pin bricks the app.
2. **Root / jailbreak detection** — `jail-monkey` (dev client / prebuild required). Policy: warn + disable payments on compromised devices, never silently degrade.
3. **Device attestation** — **Play Integrity API** (Android) and **App Attest** (iOS): server issues a nonce at session start, verifies the attestation verdict before allowing payment routes. Backend hook lands with the rails abstraction.
4. **Screen-capture & overlay protection** — `FLAG_SECURE` on Android for PIN/receipt screens; obscured-screen detection on iOS.
5. **Code obfuscation & tamper detection** — R8/ProGuard config for release; integrity check of the JS bundle hash at startup.
6. **Store & signing custody** — signing keys in a managed KMS (EAS-managed credentials acceptable initially), staged rollouts, crash/ANR monitoring.

## Threat notes

- **Stolen phone, unlocked:** the app itself is locked — opening it demands Face ID / fingerprint / device credential, and payments still require the PIN (server-verified, lockout-protected) on top.
- **Stolen token (network MITM before pinning ships):** session is device-bound — replay from another device fails with `device_mismatch`. TLS is mandatory in production regardless.
- **Cloned app / emulator farm:** blocked by attestation (item 3) once enabled; device binding raises the cost meanwhile.
- **Compromised device (root):** out of scope for pure JS — this is exactly why items 2–5 are release blockers for real money, per `docs/PRODUCTION_READINESS.md`.
