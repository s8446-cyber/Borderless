# Borderless Pay — one-step install onto a connected Android phone/emulator (Windows).
#
# Builds the RELEASE app (JavaScript bundled INSIDE the app), so it opens WITHOUT
# Metro and WITHOUT `adb reverse` — i.e. no "Unable to load script / Could not
# connect to development server" red screen.
#
# Usage (PowerShell, from the mobile folder):
#   .\run-on-phone.ps1
# If PowerShell blocks the script, run it once as:
#   powershell -ExecutionPolicy Bypass -File .\run-on-phone.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "Borderless Pay - building & installing the STANDALONE (release) app..." -ForegroundColor Cyan
Write-Host "(No Metro needed - the JavaScript is bundled into the app.)" -ForegroundColor DarkCyan
Write-Host ""

# Show connected devices (adb lives in %LOCALAPPDATA%\Android\Sdk\platform-tools)
try {
  adb devices
} catch {
  Write-Host "Note: 'adb' is not on PATH. Add %LOCALAPPDATA%\Android\Sdk\platform-tools to PATH." -ForegroundColor Yellow
}

if (-not (Test-Path "node_modules")) {
  Write-Host "Installing dependencies (first run)..." -ForegroundColor Yellow
  npm install
}

# Works with ANY JDK 17+ (17/21/22/23/24 ...): generate the native project,
# then auto-align the Gradle wrapper with whatever Java you have installed.
# --clean guarantees new native config (e.g. the camera permission plugin)
# is ALWAYS applied - a stale android/ folder is the #1 cause of 'my updates
# aren't showing on the phone'.
node scripts/doctor.js --soft
npx expo prebuild --clean
node scripts/java-compat.js

# Build + install + launch the release variant.
npx expo run:android --variant release

Write-Host ""
Write-Host "Done. The app should open by itself - no red screen, no Metro." -ForegroundColor Green
Write-Host "If it did not install: make sure your phone shows under 'adb devices' and USB debugging is ON." -ForegroundColor Green
