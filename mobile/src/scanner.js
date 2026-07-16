// Camera QR scanner — native (iOS / Android) build.
// Re-exports the real expo-camera primitives. Metro picks `scanner.web.js`
// instead when bundling for web (see that file for why).
export { CameraView, useCameraPermissions } from "expo-camera";
