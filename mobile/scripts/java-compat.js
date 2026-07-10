#!/usr/bin/env node
// Borderless Pay mobile — Java 17+ compatibility aligner.
//
// Goal: the Android build should work with WHATEVER modern JDK is installed
// (17, 21, 22, 23, 24, ...) — nobody should have to install JDK 17 just for
// this app.
//
// How: the thing that pins the JDK is not our code — it's the GRADLE version
// inside the generated android/ project. Each Gradle release only *runs* on
// JDKs up to a certain major version:
//
//   Java 17–21  → the Expo template's stock Gradle already works (no change)
//   Java 22     → needs Gradle >= 8.8
//   Java 23     → needs Gradle >= 8.10.2
//   Java 24     → needs Gradle >= 8.14.2
//   Java 25+    → needs Gradle >= 9.1.0 (beyond our tested range — warned)
//
// The app's bytecode target stays Java 17 (set by the React Native template's
// compileOptions) — newer JDKs compile 17-target bytecode natively, so ONLY
// the wrapper version needs aligning.
//
// Usage:
//   node scripts/java-compat.js           # check Java, patch android/ wrapper if needed
//   node scripts/java-compat.js --check   # only verify Java >= 17 (pre-flight)
//
// Runs automatically from `npm run prebuild` / `run:android` / run-on-phone
// scripts. Zero dependencies. Safe to re-run (idempotent).
const { spawnSync } = require("node:child_process");
const { readFileSync, writeFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");

const ANDROID_DIR = join(__dirname, "..", "android");
const WRAPPER = join(ANDROID_DIR, "gradle", "wrapper", "gradle-wrapper.properties");

// Minimum Gradle able to RUN on a given JDK major (only majors above the
// stock template's range need entries).
const MIN_GRADLE_FOR_JAVA = { 22: "8.8", 23: "8.10.2", 24: "8.14.2" };
const GRADLE_FOR_UNKNOWN_FUTURE = "9.1.0"; // Java 25+
const MAX_TESTED_JAVA = 24;

function findJavaBinary() {
  const home = (process.env.JAVA_HOME || "").trim();
  if (home) {
    const exe = join(home, "bin", process.platform === "win32" ? "java.exe" : "java");
    if (existsSync(exe)) return { exe, source: "JAVA_HOME (" + home + ")" };
    console.warn("⚠ JAVA_HOME is set but has no java binary: " + home + " — falling back to PATH");
  }
  return { exe: "java", source: "PATH" };
}

function javaMajor() {
  const { exe, source } = findJavaBinary();
  // `java -version` prints to STDERR; capture both streams
  const r = spawnSync(exe, ["-version"], { encoding: "utf8" });
  const out = (r.stderr || "") + (r.stdout || "");
  if (r.error || !/version/.test(out)) {
    console.error("✗ Could not run java (" + source + "). Install any JDK 17 or newer:");
    console.error("    https://adoptium.net  (Temurin) — or use Android Studio's bundled 'jbr'");
    process.exit(1);
  }
  const m = String(out).match(/version "(\d+)(?:\.(\d+))?/);
  if (!m) {
    console.error("✗ Could not parse Java version from: " + String(out).split("\n")[0]);
    process.exit(1);
  }
  const major = Number(m[1]) === 1 ? Number(m[2]) : Number(m[1]); // "1.8" style → 8
  return { major, source, raw: String(out).split("\n")[0].trim() };
}

function cmpVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const { major, source, raw } = javaMajor();
  console.log("• Detected Java " + major + " via " + source + "  [" + raw + "]");

  if (major < 17) {
    console.error("✗ Java " + major + " is too old for Android builds (React Native needs 17+).");
    console.error("  Install any JDK 17 OR NEWER — e.g. https://adoptium.net — no need for exactly 17.");
    process.exit(1);
  }
  console.log("✓ Java " + major + " is supported (17+). No downgrade to 17 required.");
  if (checkOnly) return;

  const needed = major <= 21 ? null : MIN_GRADLE_FOR_JAVA[major] || GRADLE_FOR_UNKNOWN_FUTURE;
  if (major > MAX_TESTED_JAVA) {
    console.warn("⚠ Java " + major + " is newer than this project's tested range (17–" + MAX_TESTED_JAVA + ").");
    console.warn("  Best-effort Gradle alignment will be applied; if the build fails, use any JDK 17–" + MAX_TESTED_JAVA + ".");
  }
  if (!needed) {
    console.log("✓ Stock Gradle already supports Java " + major + " — nothing to patch.");
    return;
  }

  if (!existsSync(WRAPPER)) {
    console.log("• android/ not generated yet — run `npx expo prebuild` first; this script runs again automatically.");
    return;
  }

  const props = readFileSync(WRAPPER, "utf8");
  const m = props.match(/distributionUrl=.*gradle-([\d.]+)-(bin|all)\.zip/);
  if (!m) {
    console.warn("⚠ Could not parse " + WRAPPER + " — leaving it unchanged.");
    return;
  }
  const current = m[1];
  if (cmpVersions(current, needed) >= 0) {
    console.log("✓ Gradle " + current + " already supports Java " + major + " — nothing to patch.");
    return;
  }
  const updated = props.replace(
    /distributionUrl=.*gradle-[\d.]+-(bin|all)\.zip/,
    "distributionUrl=https\\://services.gradle.org/distributions/gradle-" + needed + "-$1.zip"
  );
  writeFileSync(WRAPPER, updated);
  console.log("✓ Gradle wrapper aligned for Java " + major + ": " + current + " → " + needed);
  console.log("  (bytecode target stays 17; only the build tool version changed)");
}

main();
