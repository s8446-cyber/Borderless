# 📱 Borderless Pay — Mobile App (React Native / Expo) · v1.3

The native **Android + iOS** app for Borderless Pay: pay at home and abroad
straight from your bank at the real mid-market rate with a flat 0.5% fee,
secured by biometrics + PIN (with optional TOTP 2FA) and a cryptographic dual
ledger.

**What's in v1.0:** cross-border pay/send, domestic UPI (phone/VPA/bank/**real
camera QR scan**), bills, recharge, request money · biometric-gated PIN
authorization · on-device receipt verification · enforced consent + in-app
account erasure · in-context OS permission prompts (camera / contacts /
notifications) · runs on **any JDK 17+**.

**New in v1.3 — real-data posture, zero fake anything:**
- **No demo mode.** The app always talks to a real backend; the standalone
  simulator and every piece of seeded fake data are gone.
- **Real accounts:** onboarding is a full email + password sign-up
  (scrypt-hashed, lockout-protected), with sign-in + TOTP 2FA for returning users.
- **Balances start at ₹0** and are funded only through the new **➕ Add money**
  flow — every credit books through the double-entry ledger and the receipt is
  honestly stamped **🧪 sandbox** until licensed rails go live.
- **Recent payees are your own history** (no fake contact directory), the
  cross-border flow takes a **real merchant name + amount**, and the sample QR
  exists **only in dev builds**.

**From v1.1 — the app relaunches like a professional payments app:**
- **You onboard ONCE.** Your session persists in the OS keystore/keychain —
  killing and reopening the app lands on a **lock screen**, not on sign-up.
- **App lock:** Face ID / fingerprint / device credential to open,
  auto-prompted on launch, and the app **re-locks** after >60 s in the
  background.
- **Safer PIN creation:** enter twice to confirm; guessable PINs (0000-style,
  1234-style sequences, keypad lines) are rejected with an explanation.
- **Navigation that behaves:** every sub-screen has a back chevron and the
  Android hardware back button navigates (it never silently exits mid-flow;
  settlement can't be backed out of).
- **Honest quotes:** a visible 60-second rate-lock countdown; when it hits
  zero the pay button becomes "get a fresh quote". A mistyped payment PIN now
  retries in place instead of bouncing you back to the form.
- **Session expiry handled:** if the refresh token dies, you're signed out
  cleanly with an explanation — never stranded on failing screens.

**Trust features on-device:** every receipt carries a settlement-ledger hash,
public anchor, HMAC signature, and its **settlement mode**, and the
**🔎 Verify this receipt independently** button recomputes the Merkle inclusion
proof with **on-device SHA-256** — genuine cryptography, no trust in the app
required. Wrong-PIN lockout (5 attempts), single-use 60-second quotes,
idempotent payments, and server-side logout are all enforced by the backend.

> ## 🖥️ Run it in a BROWSER — no phone, no Android Studio
>
> The real app runs in any browser via `react-native-web` (same `App.js`).
> Start the backend first — the app talks to it like on a phone:
> ```bash
> # Terminal 1                      # Terminal 2
> cd backend && npm start           cd mobile && npm install && npm run sim
> ```
> Opens at **http://localhost:8080** — create an account, add money, pay,
> verify a receipt (real on-device SHA-256). Use the browser's phone/responsive
> mode for the true phone shape. `npm run web` gives the hot-reload dev
> version instead.
>
> Session tokens are deliberately **never written to browser storage** (the
> keystore tier is in-memory on web), so reloading the page starts a clean
> session — sign in again with your email to continue with the same account.
>
> **The whole experience is testable in the browser.** Native-only OS
> interactions that a browser can't provide are faithfully **simulated on
> screen** (clearly labelled *"simulated in browser"*): the Face ID / biometric
> authorization sheet, and the in-context permission prompts for contacts and
> notifications. So you can walk auth, the permission UX, the consent checkbox,
> log out / close account, and both domestic and cross-border payments end to
> end — no phone required.
>
> **QR scanning is REAL in the browser too.** If the browser has a camera
> (your laptop's webcam, or a phone's camera), **Scan QR** opens the live
> camera — the browser asks for permission in-context — and decodes any
> physical UPI QR on-device (native `BarcodeDetector` on phones, a locally
> bundled `jsqr` everywhere else; no CDN, works offline) through the same
> hardened `upi://pay…` parser as the native app. No camera at all? In dev
> builds only, a clearly-labelled sample QR can be routed through that same
> parser; release builds always use a real QR or manual UPI-ID entry.
> **Tip — live camera from a phone's browser:** cameras need a secure context
> (https or localhost), so plain `http://<pc-ip>:8080` won't offer one. With
> the phone on USB: `adb reverse tcp:8080 tcp:8080`, then open
> `http://localhost:8080` on the phone — the phone's real camera scans real
> UPI QRs inside the sim.

> ## 🔌 Want the app to hit the REAL backend? (two terminals)
>
> ```bash
> # Terminal 1                      # Terminal 2
> cd backend && npm start           cd mobile && npm run live
> ```
> `npm run live` auto-discovers the backend on your LAN (physical phones on the
> same Wi-Fi included), verifies `/api/health`, and starts Expo pointed at it —
> zero configuration. The welcome screen's build stamp confirms it:
> `http://<your-ip>:4000 · 🧪 sandbox rails`. Backend not running? The script
> tells you exactly what to start. (`npm run live:check` = probe only.)
> Different port: `BP_PORT=4100 npm run live`.

> ## 🔄 Seeing an OLD version? (your changes/updates not showing on the phone)
>
> The welcome screen shows a **build stamp** (e.g. `v1.3.0 · http://…:4000`). If it
> doesn't match `mobile/package.json`, you're running a **stale build**. In order
> of likelihood:
>
> 1. **Old APK still installed** — a previously built release app does NOT
>    update itself. Uninstall it on the phone (long-press → uninstall, or
>    `adb uninstall com.borderlesspay.app`), then rebuild: `npm run phone`.
> 2. **Dependencies not installed after pulling** — new features add packages
>    (e.g. `expo-camera`). Always run **`npm install`** after `git pull`.
> 3. **Stale native project** — new native config (like the camera permission)
>    lives in the generated `android/` folder. The one-step scripts now run
>    `expo prebuild --clean` automatically; if building manually, run
>    **`npm run prebuild:clean`** after pulling changes that touch `app.json`.
> 4. **Metro cache** (Expo Go / dev builds) — restart with **`npx expo start -c`**.
>
> Quick full reset that fixes all of the above:
> ```bash
> cd mobile
> adb uninstall com.borderlesspay.app   # if a release build was installed
> npm install && npm run prebuild:clean && npm run phone
> ```

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

The app always talks to a **real backend** (`src/config.js` picks the local-dev
address automatically; `npm run live` wires up a LAN backend for physical
phones). Start it first: `cd backend && npm start`.

---

## 0. About the `npm install` warning (the "33 vulnerabilities")

That message is **normal and not an error** — `npm install` succeeded. The
advisories come from Expo's **build/development tooling** (deep transitive
dependencies), not from code that ships in or runs inside your app.

- ✅ Safe to ignore for development.
- ❌ **Do NOT run `npm audit fix --force`** — it installs versions incompatible
  with Expo SDK 51 and will break the build.

---

## ☕ Set up Java (JDK **17 or newer**) — required for every Android build

Android builds (`npm run phone`, `run:android`, Gradle, Android Studio) need a
JDK. **Any JDK 17+ works: 17, 21, 22, 23, 24 …** — you do **not** need to
install 17 specifically for this app.

> **How that works:** the only thing that ever pinned us to a specific JDK was
> the Gradle version inside the generated `android/` project. All build entry
> points (`npm run phone`, `run:android`, `prebuild`, the `run-on-phone`
> scripts) now run `scripts/java-compat.js` automatically: it detects the Java
> you actually have and, when it's newer than the stock Gradle supports
> (22/23/24), aligns the Gradle wrapper to a matching version. The app's
> bytecode target stays 17 — newer JDKs compile it natively. To check your
> setup at any time: `npm run java:check`.

Missing or **too-old** Java (8/11) is still the most common build error.
Typical messages:

- `ERROR: JAVA_HOME is set to an invalid directory ...`
- `JAVA_HOME is not set and no 'java' command could be found in your PATH`
- `Android Gradle plugin requires Java 17 to run. You are currently using Java 11/8`
- `Unsupported class file major version 65/61/52` · `invalid source release: 17`

### Fix on Windows (PowerShell)

**1. See what you have** (anything `17` or higher is fine):
```powershell
java -version
echo $env:JAVA_HOME
```

**2. Locate a JDK 17+.** You already have one inside Android Studio (`jbr` —
recent versions ship JBR 21, which is perfect). Run these — the one that
prints **True** is your path:
```powershell
Test-Path "C:\Program Files\Android\Android Studio\jbr\bin\java.exe"
Test-Path "$env:LOCALAPPDATA\Programs\Android Studio\jbr\bin\java.exe"
```
No Android Studio? Install any modern JDK, e.g. `winget install Microsoft.OpenJDK.21`
(or 17 — both work; the path is like `C:\Program Files\Microsoft\jdk-21.x.x`).

**3. Point `JAVA_HOME` at it (permanent + this window) and verify 17+:**
```powershell
$jdk = "C:\Program Files\Android\Android Studio\jbr"   # use YOUR path from step 2
[Environment]::SetEnvironmentVariable("JAVA_HOME", $jdk, "User")
$env:JAVA_HOME = $jdk
$env:Path = "$env:JAVA_HOME\bin;$env:Path"
java -version          # 17 or anything newer is good
```

**4. Close and reopen the terminal / VS Code** (so the change is picked up), then:
```powershell
cd mobile
npm run phone
```

### Fix on macOS / Linux
```bash
# macOS (Homebrew): brew install --cask temurin      # latest LTS; temurin@17 also fine
# Linux (Debian/Ubuntu): sudo apt install default-jdk   # or openjdk-21-jdk / openjdk-17-jdk
export JAVA_HOME="$(/usr/libexec/java_home 2>/dev/null || echo /usr/lib/jvm/default-java)"
export PATH="$JAVA_HOME/bin:$PATH"
java -version   # 17 or newer
```

### If the build still complains about the Java version
- **Gradle / `npm run phone` use `JAVA_HOME`, *not* the `java` on PATH.** Make
  sure `JAVA_HOME` points at a real JDK 17+ install:
  `& "$env:JAVA_HOME\bin\java.exe" -version` (Windows) / `"$JAVA_HOME/bin/java" -version`.
- **`winget install` does not change `JAVA_HOME`.** Set it explicitly:
  ```powershell
  # Find the JDK winget installed, set JAVA_HOME to it, and put it first on PATH (this window):
  $jdk = (Get-ChildItem "C:\Program Files\Microsoft" -Directory -Filter "jdk-*" | Select-Object -First 1).FullName
  & "$jdk\bin\java.exe" -version                        # confirm 17+
  [Environment]::SetEnvironmentVariable("JAVA_HOME", $jdk, "User")
  $env:JAVA_HOME = $jdk; $env:Path = "$jdk\bin;" + $env:Path
  ```
- To see which JDK wins on your PATH: `where.exe java` (Windows) / `which java`.
- If you generated `android/` earlier with a different JDK, re-align it:
  `npm run prebuild` (safe, non-destructive) — or `npm run prebuild:clean` to regenerate.
- Java **25+** is newer than our tested range (17–24): the compat script still
  tries a best-effort alignment, but if the build fails, use any JDK 17–24.

### Notes
- **Android Studio's ▶** uses its own *Gradle JDK* (not your shell's `JAVA_HOME`).
  Set it in **Settings → Build, Execution, Deployment → Build Tools → Gradle →
  Gradle JDK** — pick any 17+ (the bundled `jbr` is fine). If you use a JDK
  newer than 21 there, run `npm run prebuild` once first so the wrapper is
  aligned before Android Studio syncs.
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

> **✅ Check your setup in 2 seconds:** `cd mobile && npm install && npm run doctor`
> — it verifies Node, Java (any 17+), the Android SDK, and a connected
> device/emulator, and prints an exact fix for anything missing **before** you
> start a build. `npm run phone` runs it automatically too, so testers never
> hit a cryptic Gradle error with no explanation.

2. **Android Studio** (Hedgehog or newer). During setup, install via
   *Settings → Languages & Frameworks → Android SDK*:
   - **Android SDK Platform** (API 34)
   - **Android SDK Build-Tools**
   - **Android SDK Platform-Tools**
   - **Android Emulator** + at least one **virtual device** (e.g. Pixel 7, API 34)
3. **JDK 17 or newer** — required by Gradle/RN 0.74 (any of 17/21/22/23/24;
   the build auto-aligns Gradle to your JDK — see the Java section above).
   Android Studio **bundles one** (its `jbr` folder), so you usually don't
   install Java separately — you just point `JAVA_HOME` at it. Set `JAVA_HOME`
   to the folder whose `bin\java.exe` exists, and add `%JAVA_HOME%\bin` to
   `PATH`. Verify with `java -version` → `17` or higher.
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
   → choose the embedded **jbr** or any JDK **17+** → **OK**. (Using a JDK newer
   than 21? Run `npm run prebuild` once first so the Gradle wrapper is aligned.)
4. After a clean sync the toolbar shows an **`app`** run configuration (the
   *"Add Configuration"* text disappears).
5. Create/start a device: **Device Manager** → **Create Device** → Pixel 7 →
   system image **API 34** → start it (▶). Or plug in a phone with USB debugging.
6. **Start the JS bundler and leave it running** in a terminal: `npx expo start`.
   The debug app loads its JavaScript from this dev server.
7. Pick your device in the dropdown and press the green **▶ Run**. It builds,
   installs, launches, and connects to Metro. Have the backend running too
   (`cd backend && npm start`) — the emulator reaches it automatically at
   `10.0.2.2:4000`.

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

That's it — the app opens straight to the interface. Point it at your backend
when building (`EXPO_PUBLIC_API_BASE`, see the next section) — release builds
show a visible warning if it's still on the local-dev fallback. To get a
shareable **APK file**, after the build it's at:

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
are defined in [`eas.json`](./eas.json). **Always set `EXPO_PUBLIC_API_BASE` to
your deployed backend URL for preview/production builds** (e.g.
`eas build -p android --profile production` with the env var exported, or add it
to the profile's `env` block) — release builds display a visible warning if
they're still pointing at the local-dev fallback.

> Use a **debug** run (`npm run run:android` / Android Studio ▶) only when you're
> actively editing code and want live reload — that one needs Metro running.

---

## Pointing the app at a backend

The app always talks to a real backend. For emulators/simulators the address is
picked automatically; for a physical phone or a deployed backend, set one env
var when you start/build the app (it's inlined by Expo):

```powershell
$env:EXPO_PUBLIC_API_BASE="http://192.168.1.5:4000"   # your PC's LAN IP (see below)
# or, for a production build:
$env:EXPO_PUBLIC_API_BASE="https://api.your-deployment.example"
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
   npm run run:android:release
   ```
   The app installs, opens straight to the UI, and every action hits your real
   backend. **No Metro, no `adb reverse`, no red screen.**

### Alternative: over USB with `adb reverse` (no Wi-Fi / no firewall changes)
Maps the phone's own `localhost` to your PC, for both the backend and Metro:
```powershell
cd C:\app\Borderless-main\Borderless-main\mobile
$env:EXPO_PUBLIC_API_BASE="http://localhost:4000"
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
src/config.js       API base (platform-aware, env-overridable)
src/theme.js        design tokens + corridor metadata / service catalogs
src/api.js          API client (device-bound sessions, silent renewal)
src/ui.js           native UI primitives (Card, Row, PinPad, Avatar, …)
src/format.js       currency formatting
test/               automated tests (see below)
assets/             app icon + splash
```

## Automated tests

The security-critical pure logic has its own test suite — no Expo, emulator,
or even `npm install` required:

```bash
cd mobile
npm test        # node --test — 24 tests
```

Covered: the **UPI QR parser** (hostile-input matrix: malformed VPAs, non-INR
currencies, bad amounts, control characters, broken percent-encoding), the
**on-device SHA-256** (FIPS 180-4 vectors + cross-checked against
`node:crypto`), the **Merkle proof fold** (must reproduce the backend's exact
math — this is what makes "Verify this receipt independently" honest),
**INR formatting**, and the **payment-PIN quality rules** (every repeated-digit
and sequential PIN, keypad lines). CI runs these on every push.

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
  java -version            # 17 or newer is good
  ```
  **Close and reopen the terminal / VS Code**, then re-run `npm run run:android`.
  If no path returned True, install any **JDK 17+** (e.g. Temurin/Microsoft OpenJDK 17 or 21)
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
- **App opens but can't reach the backend** → you're likely on a physical
  phone, where `localhost`/`10.0.2.2` point at the phone. Set
  `EXPO_PUBLIC_API_BASE` to your PC's LAN IP (or use `npm run live`, which
  picks it automatically).
- **Build cache weirdness after upgrades** → `npm run prebuild:clean`, then in
  `mobile/android` run *Build → Clean Project* in Android Studio.
- **Don't** commit the generated `android/` and `ios/` folders — they're
  git-ignored and regenerated by `prebuild`.
