// Borderless Pay mobile — runtime configuration.
import { Platform } from "react-native";

// ---- Point the app at a backend, or run fully standalone ----
// You can set BOTH of these WITHOUT editing code, using Expo public env vars
// (they're inlined when you start/build the app). In PowerShell, before the
// `npm run ...` command:
//
//   $env:EXPO_PUBLIC_API_BASE="http://192.168.1.5:4000"   # your PC's LAN IP (backend prints it)
//   $env:EXPO_PUBLIC_DEMO="false"                          # use the real backend
//
// If EXPO_PUBLIC_API_BASE is not set, we fall back to a sensible local default:
//   • Android EMULATOR  → http://10.0.2.2:4000   (the emulator's alias for your PC)
//   • iOS simulator     → http://localhost:4000
//   • A PHYSICAL phone  → 10.0.2.2 will NOT work. Either set EXPO_PUBLIC_API_BASE
//                         to your PC's LAN IP (same Wi-Fi), OR connect by USB and
//                         run `adb reverse tcp:4000 tcp:4000`, then set it to
//                         http://localhost:4000.
const ENV_BASE = (process.env.EXPO_PUBLIC_API_BASE || "").trim();
const DEFAULT_HOST = Platform.OS === "android" ? "10.0.2.2" : "localhost";

// Demo logic: honor EXPO_PUBLIC_DEMO if set; otherwise, providing an explicit
// API base implies you want the real backend (demo off).
const DEMO_ENV = (process.env.EXPO_PUBLIC_DEMO || "").trim().toLowerCase();
const DEMO_MODE = DEMO_ENV ? DEMO_ENV !== "false" : !ENV_BASE;

export const CONFIG = {
  API_BASE: ENV_BASE || `http://${DEFAULT_HOST}:4000`,
  DEMO_MODE,
};
