#!/usr/bin/env node
// Borderless Pay mobile — preflight doctor.
// Runs the environment checks that most often make `expo run:android` fail for
// testers, and prints a CLEAR, actionable fix for each — BEFORE the multi-
// minute Gradle build starts and dies with a cryptic stack trace.
//
//   node scripts/doctor.js          # full report (exit 1 if a blocker is found)
//   node scripts/doctor.js --soft   # never exit non-zero (informational)
//
// Zero dependencies. Safe to run anywhere.
const { execFileSync, spawnSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const { join } = require("node:path");

const soft = process.argv.includes("--soft");
let blockers = 0;
let warnings = 0;
const ok = (m) => console.log("  \x1b[32m✓\x1b[0m " + m);
const warn = (m) => { warnings++; console.log("  \x1b[33m•\x1b[0m " + m); };
const bad = (m) => { blockers++; console.log("  \x1b[31m✗\x1b[0m " + m); };

console.log("\nBorderless Pay — mobile preflight\n");

// 1. Node version (Expo SDK 51 needs Node 18+)
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= 18) ok("Node " + process.versions.node + " (18+ required)");
else bad("Node " + process.versions.node + " is too old — install Node 18 or newer from https://nodejs.org");

// 2. Dependencies installed
if (existsSync(join(__dirname, "..", "node_modules", "expo"))) ok("Dependencies installed (node_modules present)");
else bad("Dependencies not installed — run: npm install");

// 3. Java (only needed for Android builds) — ANY JDK 17+ is fine
function javaMajorFrom(exe) {
  const r = spawnSync(exe, ["-version"], { encoding: "utf8" });
  const out = (r.stderr || "") + (r.stdout || "");
  if (r.error || !/version/.test(out)) return null;
  const m = out.match(/version "(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  return Number(m[1]) === 1 ? Number(m[2]) : Number(m[1]);
}
const jh = (process.env.JAVA_HOME || "").trim();
let javaMajor = null, javaSrc = "";
if (jh) {
  const exe = join(jh, "bin", process.platform === "win32" ? "java.exe" : "java");
  if (existsSync(exe)) { javaMajor = javaMajorFrom(exe); javaSrc = "JAVA_HOME"; }
  else warn("JAVA_HOME is set but has no java binary: " + jh);
}
if (javaMajor === null) { javaMajor = javaMajorFrom("java"); if (javaMajor !== null) javaSrc = "PATH"; }
if (javaMajor === null) {
  warn("Java not found. Only needed to BUILD the Android app. Install ANY JDK 17+ (https://adoptium.net) or use Android Studio's bundled JBR, then set JAVA_HOME.");
} else if (javaMajor < 17) {
  bad("Java " + javaMajor + " is too old for Android builds. Install ANY JDK 17 OR NEWER (17/21/24 all work) and point JAVA_HOME at it. No need for exactly 17.");
} else {
  ok("Java " + javaMajor + " via " + javaSrc + " — supported (any 17+ works; the build auto-aligns Gradle)");
}

// 4. Android SDK (only for native builds)
const androidHome = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || "";
if (androidHome && existsSync(androidHome)) {
  ok("Android SDK at " + androidHome);
  // 5. A device/emulator connected? (adb is optional to have on PATH)
  const adb = join(androidHome, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
  const adbBin = existsSync(adb) ? adb : "adb";
  try {
    const out = execFileSync(adbBin, ["devices"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const devices = out.split("\n").slice(1).filter((l) => /\tdevice$/.test(l.trim()));
    if (devices.length) ok(devices.length + " device/emulator connected");
    else warn("No device/emulator detected. Start an emulator or plug in a phone with USB debugging ON, then re-check with: adb devices");
  } catch {
    warn("Couldn't run adb. Ensure an emulator is running or a phone is connected (USB debugging ON).");
  }
} else {
  warn("ANDROID_HOME not set. Needed only to build/run natively. Install Android Studio; it sets the SDK path (typically ~/Android/Sdk or %LOCALAPPDATA%\\Android\\Sdk).");
}

console.log("");
if (blockers) {
  console.log("\x1b[31m" + blockers + " blocker(s)\x1b[0m and " + warnings + " note(s). Fix the blockers above, then run `npm run phone` again.\n");
  if (!soft) process.exit(1);
} else if (warnings) {
  console.log("\x1b[32mNo blockers.\x1b[0m " + warnings + " note(s) above are only relevant if you're building the native Android app.\n");
} else {
  console.log("\x1b[32mAll clear — you're ready to build. Run: npm run phone\x1b[0m\n");
}
