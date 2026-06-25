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
3. **JDK 17** — required by Gradle/RN 0.74. Android Studio **bundles one** (its
   `jbr` folder), so you usually don't install Java separately — you just point
   `JAVA_HOME` at it. Set `JAVA_HOME` to the folder whose `bin\java.exe` exists,
   and add `%JAVA_HOME%\bin` to `PATH`. Verify with `java -version` → `17.x`.
   (See the JAVA_HOME entry under [Troubleshooting](#troubleshooting) for the
   exact Windows commands — this is the most common first-run error.)
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

**2b) Or open the project directly in Android Studio (the ▶ button):**
1. After `npm run prebuild`, **File → Open** → select the **`mobile/android`**
   folder — **not** `mobile`. (`mobile` is the Expo/JS folder with no Android
   project, so the Run button would just say *"Add Configuration"*.) Click
   **Trust Project** if asked.
2. Wait for **Gradle Sync** to finish (bottom status bar; first run downloads
   Gradle + deps and can take several minutes). Accept any prompt to install
   missing SDK / Build-Tools.
3. Set the build JDK so it doesn't depend on your shell's `JAVA_HOME`:
   **Settings → Build, Execution, Deployment → Build Tools → Gradle → Gradle JDK**
   → choose **jbr-17 (Embedded JetBrains Runtime)** or any JDK 17 → **OK**.
4. After a clean sync the toolbar shows an **`app`** run configuration (the
   *"Add Configuration"* text disappears).
5. Create/start a device: **Device Manager** → **Create Device** → Pixel 7 →
   system image **API 34** → start it (▶). Or plug in a phone with USB debugging.
6. **Start the JS bundler and leave it running** in a terminal: `npx expo start`.
   The debug app loads its JavaScript from this dev server.
7. Pick your device in the dropdown and press the green **▶ Run**. It builds,
   installs, launches, and connects to Metro. It defaults to **DEMO_MODE**, so it
   runs standalone — no backend needed.

> - **"Add Configuration" won't go away** → you opened `mobile` instead of
>   `mobile/android`, or Gradle Sync hasn't finished/failed (fix the JDK in
>   step 3, then **File → Sync Project with Gradle Files**).
> - **Red screen "Could not connect to development server"** → Metro isn't
>   running (step 6); on a physical device also run `adb reverse tcp:8081 tcp:8081`.
> - **Gradle sync stuck after an upgrade** → `npm run prebuild:clean`, then
>   re-open `mobile/android`.

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

## 4. Install a standalone build that "just opens" (no Metro)

**This is the fix for the red _"Unable to load script" / "Could not connect to
development server"_ screen.** That screen appears because `npm run run:android`
and Android Studio's ▶ both produce a **debug** build, and a debug build never
contains the JavaScript — it downloads it from Metro at `localhost:8081` every
launch. A **release** build bundles the JS *inside* the app, so it opens
directly — no Metro, no `adb reverse`, nothing running on your PC.

### A) Local release build — nothing extra to install (recommended)
You already have everything (you built the debug app). One command builds the
release variant, installs it on your connected phone/emulator, and launches it:

```bash
cd C:\app\Borderless-main\Borderless-main\mobile
npm run run:android:release        # = expo run:android --variant release
```

That's it — the app opens straight to the interface in **DEMO_MODE** (standalone,
no backend). To get a shareable **APK file**, after the build it's at:

```
mobile\android\app\build\outputs\apk\release\app-release.apk
```
Copy that file to any phone and install it (enable *Install unknown apps*). It's
signed with the project's debug key — fine for testing, not for the Play Store.

> In **Android Studio** you can do the same: **Build → Select Build Variant →**
> set `app` to **release**, then press ▶. (Release doesn't use Metro.)

### B) Cloud build with EAS — best for sending to many testers
Produces a hosted APK with a download link/QR; needs a free Expo account:

```bash
npm i -g eas-cli
cd mobile
eas login
eas build -p android --profile preview   # installable .apk in the cloud
```
The `preview` (installable `.apk`) and `production` (Play Store `.aab`) profiles
are defined in [`eas.json`](./eas.json).

> Use a **debug** run (`npm run run:android` / Android Studio ▶) only when you're
> actively editing code and want live reload — that one needs Metro running.

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

- **`ERROR: JAVA_HOME is set to an invalid directory ...\Android Studio\jbr`** →
  Your `JAVA_HOME` points at a path that doesn't exist on your machine (Android
  Studio is installed elsewhere, or there's no JDK there). Fix it (PowerShell):
  ```powershell
  # 1) Find the real JDK — the line that prints True is your path:
  Test-Path "C:\Program Files\Android\Android Studio\jbr\bin\java.exe"
  Test-Path "$env:LOCALAPPDATA\Programs\Android Studio\jbr\bin\java.exe"
  # (or copy the "Gradle JDK" path from Android Studio →
  #  Settings → Build, Execution, Deployment → Build Tools → Gradle)

  # 2) Point JAVA_HOME at that folder (swap in the one that was True):
  $jdk = "C:\Program Files\Android\Android Studio\jbr"
  [Environment]::SetEnvironmentVariable("JAVA_HOME", $jdk, "User")
  $env:JAVA_HOME = $jdk; $env:Path = "$env:JAVA_HOME\bin;$env:Path"
  java -version            # should print openjdk version "17.x"
  ```
  **Close and reopen the terminal / VS Code**, then re-run `npm run run:android`.
  If no path returned True, install **JDK 17** (Microsoft OpenJDK or Temurin 17)
  and set `JAVA_HOME` to its folder.
- **App installs and opens but shows a red/blank screen — "Could not connect to
  development server" or "Unable to load script"** → the #1 thing testers hit. A
  **debug** build (from `npm run run:android` *or* Android Studio's ▶) does not
  contain the JS; it loads it from **Metro** on port 8081. Fix:
  1. Start Metro and leave it running: `npx expo start`.
  2. **On a physical phone, also run `adb reverse tcp:8081 tcp:8081`** — the
     phone's `localhost` is the phone itself, not your PC. (`adb devices` first;
     `adb` lives in `%LOCALAPPDATA%\Android\Sdk\platform-tools`.)
  3. Reload the app (shake the device → **Reload**).

  To skip Metro entirely so the app **just opens**, install a **release** build:
  `npm run run:android:release` (see *"Install a standalone build that just
  opens"* above). That's what you hand to testers.
- **"SDK location not found" / Gradle can't find the SDK** → set `ANDROID_HOME`
  to your SDK path, then reopen the terminal:
  ```powershell
  [Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
  ```
  Ensure **SDK Platform 34** + **Platform-Tools** are installed in Android
  Studio's SDK Manager. Re-running `npm run prebuild` also regenerates the
  project's `local.properties`.
- **App opens but can't reach the backend** → you're likely on Android using
  `localhost`. Keep `DEMO_MODE: true`, or use `10.0.2.2` (handled automatically
  when `DEMO_MODE` is false).
- **Build cache weirdness after upgrades** → `npm run prebuild:clean`, then in
  `mobile/android` run *Build → Clean Project* in Android Studio.
- **Don't** commit the generated `android/` and `ios/` folders — they're
  git-ignored and regenerated by `prebuild`.
