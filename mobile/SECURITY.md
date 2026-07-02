# Borderless Pay Mobile — Security Posture & Hardening Path (G-6)

Honest split between **implemented now** and **required at native-build time**
(items that need EAS/native configuration and a physical-device test matrix —
they cannot be meaningfully verified from JS alone, so we don't pretend).

## Implemented in this codebase ✅

| Control | Where | Notes |
|---|---|---|
| Biometric gate + payment PIN | `App.js` (`expo-local-authentication`) | PIN verified **server-side** (scrypt, lockout after 5 fails) — the client never decides |
| Device-bound sessions | `src/device.js`, `src/api.js` | Per-install device ID kept in the OS keystore/keychain (`expo-secure-store`, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`); the server binds the session to its SHA-256 and rejects other devices |
| Refresh-token rotation | `src/api.js` | Silent one-shot renewal on session expiry; server revokes **all** sessions if a rotated token is ever replayed (theft signal) |
| Tokens never touch disk | `src/api.js` | Access/refresh tokens are memory-only; only the device ID persists (in the keystore, not AsyncStorage) |
| No secrets in the bundle | whole app | The app holds no API keys or signing material; everything sensitive is server-side |
| Idempotent payments | `src/api.js` + backend | `Idempotency-Key` per attempt — a retried request can never double-charge |

## Required at native-build time ⬜ (tracked, not claimed)

These go into the EAS/native build **before store release**, with verification
on the physical-device matrix:

1. **Certificate pinning / network security config**
   - Android: `expo-build-properties` → `android.networkSecurityConfig` pinning the API's leaf/intermediate SPKI hashes; `usesCleartextTraffic: false` in release.
   - iOS: `NSAppTransportSecurity` with pinned certificates (or TrustKit via config plugin).
   - Ship a pin-rotation plan (dual pins: current + next) *before* enabling — a bad pin bricks the app.
2. **Root / jailbreak detection** — `jail-monkey` (dev client / prebuild required). Policy: warn + disable payments on compromised devices, never silently degrade.
3. **Device attestation** — **Play Integrity API** (Android) and **App Attest** (iOS): server issues a nonce at session start, verifies the attestation verdict before allowing payment routes. Backend hook lands with the rails abstraction.
4. **Screen-capture & overlay protection** — `FLAG_SECURE` on Android for PIN/receipt screens; obscured-screen detection on iOS.
5. **Code obfuscation & tamper detection** — R8/ProGuard config for release; integrity check of the JS bundle hash at startup.
6. **Store & signing custody** — signing keys in a managed KMS (EAS-managed credentials acceptable initially), staged rollouts, crash/ANR monitoring.

## Threat notes

- **Stolen phone, unlocked:** payments still require the PIN (server-verified, lockout-protected). Biometric re-prompt gates the app itself.
- **Stolen token (network MITM before pinning ships):** session is device-bound — replay from another device fails with `device_mismatch`. TLS is mandatory in production regardless.
- **Cloned app / emulator farm:** blocked by attestation (item 3) once enabled; device binding raises the cost meanwhile.
- **Compromised device (root):** out of scope for pure JS — this is exactly why items 2–5 are release blockers for real money, per `docs/PRODUCTION_READINESS.md`.
