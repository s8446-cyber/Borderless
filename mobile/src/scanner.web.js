// Camera QR scanner — WEB build (react-native-web, used by `npm run sim`).
//
// We deliberately do NOT import expo-camera on web. Its web implementation
// builds a Web Worker that loads jsQR from a hardcoded CDN
// (`https://cdn.jsdelivr.net/npm/jsqr@1.2.0/...`) at *import time* — so it
// throws a page error on every load (even the welcome screen) and cannot work
// offline or under a strict CSP. Pulling third-party script into a payments app
// at runtime is also undesirable on its own.
//
// The browser simulation handles scanning with a dedicated, self-contained
// panel in App.js (simulated camera-permission prompt + demo UPI QR), so these
// stubs exist only so App.js can import the scanner from a single path on every
// platform. Live camera QR scanning remains a real-device feature.
export function CameraView() {
  return null;
}

const WEB_CAM_PERM = { granted: false, canAskAgain: true, status: "undetermined" };

export function useCameraPermissions() {
  return [WEB_CAM_PERM, async () => WEB_CAM_PERM];
}
