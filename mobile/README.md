# 📱 Borderless Pay — Mobile App (React Native / Expo)

The native **Android + iOS** app for Borderless Pay: pay at home and abroad
straight from your bank at the real mid-market rate with a flat 0.5% fee,
secured by biometrics + PIN and a cryptographic dual ledger.

It's an **Expo** app, so you can run it three ways depending on what you have:

| You want to… | Use | Need Android Studio / Xcode? |
|---|---|---|
| Try it fastest on your own phone | **Expo Go** (`npm start`) | No |
| Open & debug the native project in **Android Studio** | **Prebuild → `run:android`** | Yes (Android) |
| Open & debug in **Xcode** | **Prebuild → `run:ios`** | Yes (macOS + Xcode) |

The app defaults to **`DEMO_MODE: true`** (`src/config.js`), so it runs fully
standalone with a built-in simulator — **no backend required** for a first test.

---

## 0. About the `npm install` warning (the "33 vulnerabilities")

That message is **normal and not an error** — `npm install` succeeded. The
advisories come from Expo's **build/development tooling** (deep transitive
dependencies), not from code that ships in or runs inside your app.

- ✅ Safe to ignore for development.
- ❌ **Do NOT run `npm audit fix --force`** — it installs versions incompatible
  with Expo SDK 51 and will break the build.

---

## 1. Run in Android Studio (what you asked for)

### Prerequisites (one-time)
1. **Node.js 18+** and **Git**.
2. **Android Studio** (Hedgehog or newer). During setup, install via
   *Settings → Languages & Frameworks → Android SDK*:
   - **Android SDK Platform** (API 34)
   - **Android SDK Build-Tools**
   - **Android SDK Platform-Tools**
   - **Android Emulator** + at least one **virtual device** (e.g. Pixel 7, API 34)
3. **JDK 17** (Android Studio bundles one; if asked, point `JAVA_HOME` at it).
4. Make sure `ANDROID_HOME` is set (Android Studio usually does this):
   - Windows: `C:\Users\<you>\AppData\Local\Android\Sdk`
   - macOS: `~/Library/Android/sdk`

### Steps
```bash
cd mobile
npm install

# 1) Generate the native android/ (and ios/) projects from app.json:
npm run prebuild            # = npx expo prebuild

# 2a) EASIEST — build, install and launch on a running emulator/device:
npm run run:android         # = npx expo run:android
```

`run:android` compiles the native app with Gradle (using your Android Studio
SDK) and installs it on a booted emulator or a USB-connected phone. Start an
emulator first from Android Studio's **Device Manager**, or plug in a phone with
**USB debugging** enabled.

**2b) Or open the project directly in Android Studio:**
1. After `npm run prebuild`, open Android Studio → **Open** → select the
   **`mobile/android`** folder (not `mobile`). Let Gradle sync finish.
2. In a terminal, start the JS bundler: `npx expo start --dev-client`
3. Press the green **▶ Run** button in Android Studio (pick your emulator/device).

> If Gradle sync ever gets stuck, run `npm run prebuild:clean` to regenerate the
> native folder from scratch, then re-open `mobile/android`.

---

## 2. Run on iOS (Xcode, macOS only)

```bash
cd mobile
npm install
npm run prebuild
npm run run:ios             # builds + launches the iOS simulator
# or: open mobile/ios/*.xcworkspace in Xcode and press ▶
```

---

## 3. Run with Expo Go (no Android Studio / Xcode)

```bash
cd mobile
npm install
npm start                   # = expo start
```

- **On your phone:** install **Expo Go** (Play Store / App Store) and scan the QR.
- **iOS simulator:** press `i`. **Android emulator:** press `a`.

---

## Demo mode vs. real backend

Edit `src/config.js`:

- `DEMO_MODE: true` (default) — runs standalone via the built-in simulator
  (`src/demo.js`). No server needed.
- `DEMO_MODE: false` — talks to the real **Borderless Pay backend**. `API_BASE`
  is chosen automatically per platform:
  - **Android emulator** → `http://10.0.2.2:4000` (the emulator's alias for your
    PC's `localhost` — using `localhost` here is the #1 mistake).
  - **iOS simulator** → `http://localhost:4000`.
  - **Real phone** → set `API_BASE` to your computer's LAN IP, e.g.
    `http://192.168.1.10:4000`, and make sure the phone is on the same Wi-Fi.

  Then run the backend on your PC:
  ```bash
  cd ../backend && npm start    # serves the API on :4000
  ```

---

## What's native here

- Real React Native screens & navigation (no WebView, no browser).
- **Biometric authorization** via `expo-local-authentication` (Face ID / fingerprint).
- Native PIN pad, scanner UI, settlement animation, and receipt.
- **Corridor switcher** on Pay-abroad (UAE / Singapore / France / Nepal).
- Talks to the same REST API as the web client; identical FX + dual-ledger logic.

## Structure

```
App.js              all screens + navigation + state
app.json            Expo config (icons, splash, iOS/Android ids, plugins)
src/config.js       API base (platform-aware) + demo-mode switch
src/theme.js        design tokens + corridor / biller directories
src/api.js          API client (real backend or simulator)
src/demo.js         standalone simulator (mirrors the backend)
src/ui.js           native UI primitives (Card, Row, PinPad, Avatar, …)
src/format.js       currency formatting
assets/             app icon + splash
```

## Troubleshooting

- **"SDK location not found" / Gradle can't find the SDK** → set `ANDROID_HOME`
  (see prerequisites) and create `mobile/android/local.sdk.dir` via Android
  Studio's first sync, or re-run `npm run prebuild`.
- **App opens but can't reach the backend** → you're likely on Android using
  `localhost`. Keep `DEMO_MODE: true`, or use `10.0.2.2` (handled automatically
  when `DEMO_MODE` is false).
- **Build cache weirdness after upgrades** → `npm run prebuild:clean`, then in
  `mobile/android` run *Build → Clean Project* in Android Studio.
- **Don't** commit the generated `android/` and `ios/` folders — they're
  git-ignored and regenerated by `prebuild`.
```
