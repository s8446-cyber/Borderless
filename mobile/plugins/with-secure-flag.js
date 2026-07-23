// Expo config plugin — set Android FLAG_SECURE on the main Activity.
//
// Addresses part of the "financial-app hardening" blocker: FLAG_SECURE tells
// Android to exclude the app's windows from screenshots, screen recording, and
// the recent-apps thumbnail, and blocks non-secure displays (screen mirroring).
// For a payments app this protects the PIN pad, balances, and receipts from
// casual capture and from screen-scraping malware/overlays that rely on
// screenshotting.
//
// This is the code-completable half of the mobile-hardening list. The
// remaining items — Play Integrity, Apple App Attest, root/jailbreak
// detection, TLS pinning at runtime, overlay/tapjacking + accessibility-abuse
// detection, RASP, and a fraud/risk engine — require native SDKs and/or
// server-side services and are tracked (with status) in mobile/SECURITY.md.
//
// iOS has no exact FLAG_SECURE equivalent; sensitive-view masking on
// background/snapshot is tracked as a native item in mobile/SECURITY.md.
//
// Zero new dependencies: @expo/config-plugins ships inside the expo package.
const { withMainActivity } = require("@expo/config-plugins");

const IMPORT_LINE = "import android.view.WindowManager";
const FLAG_LINE =
  "getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);";
const FLAG_LINE_KT =
  "window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)";

module.exports = function withSecureFlag(config) {
  return withMainActivity(config, (cfg) => {
    let src = cfg.modResults.contents;
    const isKotlin = cfg.modResults.language === "kt";

    if (src.includes("FLAG_SECURE")) return cfg; // idempotent

    // Ensure the WindowManager import is present.
    if (!src.includes(IMPORT_LINE)) {
      src = src.replace(
        /(^package .*$)/m,
        `$1\n\n${IMPORT_LINE}${isKotlin ? "" : ";"}`
      );
    }

    // Insert the FLAG_SECURE call at the top of onCreate(...).
    const flag = isKotlin ? FLAG_LINE_KT : FLAG_LINE;
    // Match the onCreate body opening brace and inject right after super.onCreate(...).
    const superCall = isKotlin
      ? /(super\.onCreate\([^)]*\)\s*)/
      : /(super\.onCreate\([^)]*\);\s*)/;
    if (superCall.test(src)) {
      src = src.replace(superCall, `$1${flag}\n    `);
    }

    cfg.modResults.contents = src;
    return cfg;
  });
};
