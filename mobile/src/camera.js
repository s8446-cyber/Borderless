// Native camera surface — re-exports expo-camera as-is (Android / iOS).
// Metro picks camera.web.js instead on web, so expo-camera (and its CDN-based
// QR decoder) is never imported into the web bundle.
export { CameraView, useCameraPermissions } from "expo-camera";
