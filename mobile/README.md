# 📱 Borderless Pay — Mobile App (React Native / Expo)

The native **Android + iOS** app for Borderless Pay: pay at home and abroad
straight from your bank at the real mid-market rate with a flat 0.5% fee,
secured by biometrics + PIN and a cryptographic dual ledger.

> ## ⚡ Seeing the red _"Unable to load script" / "Could not connect to development server"_ screen?
>
> That's a **debug** build trying to download JavaScript from **Metro** (`localhost:8081`).
> Pressing **▶ in Android Studio** (or `npm run run:android`) builds *debug*, which
> needs Metro running — that's why it keeps happening.
>
> **Fix — build the RELEASE app once (JS bundled in, opens with no Metro):**
> ```bash
> cd mobile
> npm install
> npm run phone          # = expo run:android --variant release
> ```
> Windows one-click: `powershell -ExecutionPolicy Bypass -File .\run-on-phone.ps1`
> (macOS/Linux: `./run-on-phone.sh`). Have your phone plugged in with **USB
> debugging on** (check `adb devices`). The app installs and **opens by itself —
> no Metro, no `adb reverse`, no red screen.**
>
> Only use the debug run (`npm run run:android`) when you're actively editing code
> and want live reload — and keep its Metro window open.

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

## ☕ Set up Java (JDK 17) — required for every Android build

Android builds (`npm run phone`, `run:android`, Gradle, Android Studio) need
**JDK 17** — *exactly* 17, not 8 / 11 / 21. Wrong or missing Java is the most
common build error. Typical messages:

- `ERROR: JAVA_HOME is set to an invalid directory ...`
- `JAVA_HOME is not set and no 'java' command could be found in your PATH`
- `Android Gradle plugin requires Java 17 to run. You are currently using Java 21/11/8`
- `Unsupported class file major version 65/61/52` · `invalid source release: 17`
- `Could not determine java version from '21.0.x'`

### Fix on Windows (PowerShell)

**1. See what you have** (you want `17.x`):
```powershell
java -version
echo $env:JAVA_HOME
```

**2. Locate a JDK 17.** You already have one inside Android Studio (`jbr`).
Run these — the one that prints **True** is your path:
```powershell
Test-Path "C:\Program Files\Android\Android Studio\jbr\bin\java.exe"
Test-Path "$env:LOCALAPPDATA\Programs\Android Studio\jbr\bin\java.exe"
```
No Android Studio JDK? Install a standalone one: `winget install Microsoft.OpenJDK.17`
(then its path is like `C:\Program Files\Microsoft\jdk-17.x.x`).

**3. Point `JAVA_HOME` at it (permanent + this window) and verify 17:**
```powershell
$jdk = "C:\Program Files\Android\Android Studio\jbr"   # use YOUR path from step 2
[Environment]::SetEnvironmentVariable("JAVA_HOME", $jdk, "User")
$env:JAVA_HOME = $jdk
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
java -version          # must now print openjdk version "17.x"
```

**4. Close and reopen the terminal / VS Code** (so the change is picked up), then:
```powershell
cd mobile
npm run phone
```

### Fix on macOS / Linux
```bash
# macOS (Homebrew): brew install --cask temurin@17
# Linux (Debian/Ubuntu): sudo apt install openjdk-17-jdk
export JAVA_HOME="$(/usr/libexec/java_home -v 17 2>/dev/null || echo /usr/lib/jvm/java-17-openjdk-amd64)"
export PATH="$JAVA_HOME/bin:$PATH"
java -version   # 17.x
```

### If `java -version` still shows the wrong version (e.g. 23) after installing 17
This is normal — it means another JDK is **earlier on your PATH**. Two facts:
- **Gradle / `npm run phone` use `JAVA_HOME`, *not* the `java` on PATH.** So the
  real fix is to point `JAVA_HOME` at a true **17**, even if `java -version`
  prints something else in a fresh terminal.
- **`winget install Microsoft.OpenJDK.17` does not change `JAVA_HOME`** and may
  not win on PATH. Set it explicitly:
  ```powershell
  # Find the JDK 17 winget installed, set JAVA_HOME to it, and put it first on PATH (this window):
  $jdk = (Get-ChildItem "C:\Program Files\Microsoft" -Directory -Filter "jdk-17*" | Select-Object -First 1).FullName
  & "$jdk\bin\java.exe" -version                        # confirm 17.0.x
  [Environment]::SetEnvironmentVariable("JAVA_HOME", $jdk, "User")
  $env:JAVA_HOME = $jdk; $env:Path = "$jdk\bin;" + $env:Path
  java -version                                          # now 17 in this window
  ```
- To see which JDK currently wins and remove it from PATH if you want `java` = 17
  everywhere: `where.exe java` (then drop that folder from the **System** Path).
- ⚠️ **Android Studio's bundled `jbr` is not always 17** — recent versions ship
  **JBR 21**, which RN/Expo rejects. Verify with
  `& "$env:JAVA_HOME\bin\java.exe" -version`; if it's not 17, use the Microsoft
  OpenJDK 17 path above instead.

### Notes
- **Android Studio's ▶** uses its own *Gradle JDK* (not your shell's `JAVA_HOME`).
  Set it too: **Settings → Build, Execution, Deployment → Build Tools → Gradle →
  Gradle JDK → 17** (pick the JDK 17 you installed, or `jbr` only if it reports 17).
- **Multiple JDKs installed?** Make sure `JAVA_HOME` points to 17 **and** that
  `%JAVA_HOME%\bin` is *first* on `PATH`, so `java` resolves to 17.
- **Last-resort override:** after `npm run prebuild`, you can force Gradle to use
  a specific JDK regardless of `JAVA_HOME` by adding this line to
  `android/gradle.properties` (note the escaped backslashes/colon):
  `org.gradle.java.home=C\:\\Program Files\\Microsoft\\jdk-17.0.19.10-hotspot`
  (it's regenerated by `prebuild --clean`, so prefer fixing `JAVA_HOME`).

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

By default the app is **standalone** (`DEMO_MODE` on) using the built-in
simulator (`src/demo.js`) — no server. To make the app talk to the **real
backend** you run on your PC, you don't edit code; set two env vars when you
start/build the app (they're inlined by Expo):

```powershell
$env:EXPO_PUBLIC_API_BASE="http://192.168.1.5:4000"   # your PC's LAN IP (see below)
$env:EXPO_PUBLIC_DEMO="false"
```

### Recommended: real backend on a physical phone, no Metro (release build)
This is the most reliable "it just works on my phone" path.

1. **Start the backend** on your PC:
   ```powershell
   cd C:\app\Borderless-main\Borderless-main\backend
   npm install
   npm start
   ```
   On startup it now prints its address, e.g.
   `"lanUrls": ["http://192.168.1.5:4000"]` — **use that IP**.
2. **Allow it through the Windows Firewall** (first run): when Windows prompts
   for Node.js, tick **Private networks → Allow**. (No prompt? Add an inbound
   rule for TCP port 4000 on Private.) Quick check: open
   `http://<that-LAN-IP>:4000/api/health` in your **phone's browser** — you
   should see `{"ok":true,...}`.
3. **Build + install the app** pointed at that backend (phone on the **same
   Wi-Fi**, connected by USB for install):
   ```powershell
   cd ..\mobile
   $env:EXPO_PUBLIC_API_BASE="http://192.168.1.5:4000"   # the IP from step 1
   $env:EXPO_PUBLIC_DEMO="false"
   npm run run:android:release
   ```
   The app installs, opens straight to the UI, and every action hits your real
   backend. **No Metro, no `adb reverse`, no red screen.**

### Alternative: over USB with `adb reverse` (no Wi-Fi / no firewall changes)
Maps the phone's own `localhost` to your PC, for both the backend and Metro:
```powershell
cd C:\app\Borderless-main\Borderless-main\mobile
$env:EXPO_PUBLIC_API_BASE="http://localhost:4000"
$env:EXPO_PUBLIC_DEMO="false"
npm run run:android                 # debug build (needs Metro)
adb reverse tcp:8081 tcp:8081       # Metro (JS)
adb reverse tcp:4000 tcp:4000       # your backend
```
Then reload the app. (Use the release recipe above if you'd rather not run Metro.)

### Auto defaults (when `EXPO_PUBLIC_API_BASE` is not set)
- **Android emulator** → `http://10.0.2.2:4000` (its alias for your PC).
- **iOS simulator** → `http://localhost:4000`.
- **Physical phone** → `10.0.2.2` does **not** work; set `EXPO_PUBLIC_API_BASE`
  (LAN IP) or use the `adb reverse` recipe above.

> The app uses bearer-token auth (not cookies) and the backend allows all
> origins in dev, so there's **no CORS issue** for the native app — if it can
> reach the IP/port, it works.

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
