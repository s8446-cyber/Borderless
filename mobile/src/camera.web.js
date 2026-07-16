// Web stub for the camera surface. The web build never renders CameraView
// (App.js takes the manual/demo-QR path on web), so these are inert — but
// exporting them keeps App.js's import identical across platforms AND keeps
// expo-camera (which eagerly fetches a QR decoder from a CDN on web) out of
// the web bundle entirely.
export function CameraView() {
  return null;
}

// Mirrors expo-camera's useCameraPermissions() shape: [permission, request].
// On web it reports "not granted, can't ask" so any accidental use falls back
// gracefully; App.js already short-circuits the whole camera path on web.
export function useCameraPermissions() {
  const permission = { granted: false, canAskAgain: false, status: "undetermined" };
  const request = async () => permission;
  return [permission, request];
}
