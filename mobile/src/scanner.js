// Camera QR scanner — native (iOS / Android) build.
// Re-exports the real expo-camera primitives. Metro picks `scanner.web.js`
// instead when bundling for web (see that file for why).
export { CameraView, useCameraPermissions } from "expo-camera";

// Web-only exports (see scanner.web.js). Never rendered on native — these
// stubs only keep the import surface identical across platforms.
export function webCameraCapable() {
  return false;
}
export function WebQrScanner() {
  return null;
}
