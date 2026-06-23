# 📱 Borderless Pay — Mobile App (React Native / Expo)

The native **Android + iOS** app for Borderless Pay: pay abroad straight from your
home bank at the mid-market rate with a flat 0.5% fee, secured by biometrics + PIN
and a cryptographic dual ledger.

## Run it

```bash
cd borderless-pay-mobile
npm install            # installs Expo + React Native
npx expo start         # opens the Expo dev tools
```

Then:

- **On your phone:** install **Expo Go** (App Store / Play Store) and scan the QR code.
- **iOS simulator:** press `i`. **Android emulator:** press `a`.

> Want a real installable build (APK / IPA)? Use EAS: `npx eas build -p android` (or `-p ios`).

## Two modes

Edit `src/config.js`:

- `DEMO_MODE: true` (default) — the app runs **fully standalone** using a built-in
  simulator (`src/demo.js`) that mirrors the backend. No server needed — great for
  trying it on a phone immediately.
- `DEMO_MODE: false` — the app talks to the real **Borderless Pay backend**
  (`../borderless-pay-app`). Set `API_BASE` to your computer's LAN IP, e.g.
  `http://192.168.1.10:4000`, and run the backend with `node src/server.js`.

## What's native here

- Real React Native screens & navigation (no WebView, no browser).
- **Biometric authorization** via `expo-local-authentication` (Face ID / fingerprint).
- Native PIN pad, scanner UI, settlement animation, and receipt.
- Country corridor switcher (UAE / Singapore / France / Nepal).
- Talks to the same REST API as the web client; identical FX + dual-ledger logic.

## Structure

```
App.js              all screens + navigation + state
src/config.js       API base + demo-mode switch
src/theme.js        colors + corridor definitions
src/api.js          API client (real backend or simulator)
src/demo.js         standalone simulator (mirrors the backend)
src/ui.js           native UI primitives (Card, Row, PinPad, etc.)
src/format.js       currency formatting
assets/             app icon + splash
```
