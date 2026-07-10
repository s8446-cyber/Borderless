#!/usr/bin/env bash
# Borderless Pay — one-step install onto a connected Android phone/emulator (macOS/Linux).
# Builds the RELEASE app (JS bundled in) so it opens WITHOUT Metro / adb reverse —
# no "Unable to load script / Could not connect to development server" red screen.
#
# Usage (from the mobile folder):  ./run-on-phone.sh
set -e
cd "$(dirname "$0")"

echo ""
echo "Borderless Pay - building & installing the STANDALONE (release) app..."
echo "(No Metro needed - the JavaScript is bundled into the app.)"
echo ""

adb devices || echo "Note: 'adb' not on PATH (it's in \$ANDROID_HOME/platform-tools)."

[ -d node_modules ] || { echo "Installing dependencies (first run)..."; npm install; }

# Works with ANY JDK 17+ (17/21/22/23/24 ...): generate the native project,
# then auto-align the Gradle wrapper with whatever Java you have installed.
npx expo prebuild
node scripts/java-compat.js

npx expo run:android --variant release

echo ""
echo "Done. The app should open by itself - no red screen, no Metro."
