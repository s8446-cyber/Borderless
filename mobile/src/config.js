// Borderless Pay mobile — runtime configuration.
// The app ALWAYS talks to a real backend — there is no standalone demo mode.
import { Platform } from "react-native";

// ---- Point the app at a backend ----
// Set the backend URL WITHOUT editing code, using an Expo public env var
// (inlined when you start/build the app):
//
//   EXPO_PUBLIC_API_BASE="https://api.your-deployment.example"  npm start
//
// For local development, if EXPO_PUBLIC_API_BASE is not set we fall back to
// the local backend (`cd backend && npm start`):
//   • Android EMULATOR  → http://10.0.2.2:4000   (the emulator's alias for your PC)
//   • iOS simulator / web → http://localhost:4000
//   • A PHYSICAL phone  → 10.0.2.2 will NOT work. Either set EXPO_PUBLIC_API_BASE
//                         to your PC's LAN IP (same Wi-Fi; the backend prints it),
//                         OR connect by USB and run `adb reverse tcp:4000 tcp:4000`,
//                         then use http://localhost:4000.
//
// `npm run live` automates all of this (probes for the backend and launches
// with the right URL). Production builds MUST set EXPO_PUBLIC_API_BASE to the
// deployed backend URL — the app shows a visible warning if a release build
// is still pointing at the local-development fallback.
const ENV_BASE = (process.env.EXPO_PUBLIC_API_BASE || "").trim();
const DEFAULT_HOST = Platform.OS === "android" ? "10.0.2.2" : "localhost";

export const CONFIG = {
  API_BASE: ENV_BASE || `http://${DEFAULT_HOST}:4000`,
  // True when the app is running on the local-dev fallback rather than an
  // explicitly configured backend — release builds surface this loudly.
  USING_DEV_FALLBACK: !ENV_BASE,
};
