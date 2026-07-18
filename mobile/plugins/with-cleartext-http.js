// Expo config plugin: allow cleartext (http://) traffic on Android in ALL
// build variants — including RELEASE builds.
//
// WHY: Expo's template only sets android:usesCleartextTraffic="true" in the
// DEBUG manifest. Android 9+ (API 28) blocks http:// by default, so the
// documented phone recipe — a RELEASE build pointed at the LAN backend
// (EXPO_PUBLIC_API_BASE=http://192.168.x.x:4000, `npm run phone`) — failed on
// every modern phone with "Network request failed". Demo mode hid it (no
// network); live mode on a real device hit it immediately.
//
// SECURITY: this is a development/pilot-phase setting. Before store release
// the backend moves behind HTTPS and this flips to certificate pinning with
// usesCleartextTraffic=false — tracked in mobile/SECURITY.md ("Required at
// native-build time", item 1).
//
// Zero new dependencies: @expo/config-plugins ships inside the expo package.
const { withAndroidManifest } = require("@expo/config-plugins");

module.exports = function withCleartextHttp(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application && cfg.modResults.manifest.application[0];
    if (app) app.$["android:usesCleartextTraffic"] = "true";
    return cfg;
  });
};
