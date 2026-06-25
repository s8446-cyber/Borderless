// Borderless Pay mobile — runtime configuration.
import { Platform } from "react-native";

// The Android emulator can't reach your computer on "localhost" — that points at
// the emulator itself. It reaches the host machine via the special alias
// 10.0.2.2. iOS simulators can use localhost directly. For a REAL phone on the
// same Wi-Fi, set this to your computer's LAN IP, e.g. "http://192.168.1.10:4000".
const DEV_HOST = Platform.OS === "android" ? "10.0.2.2" : "localhost";

export const CONFIG = {
  API_BASE: `http://${DEV_HOST}:4000`,

  // When true, the app runs FULLY STANDALONE with a built-in simulator — no
  // backend needed (great for a first run in an emulator). Flip to false to
  // talk to the real Node backend at API_BASE above.
  DEMO_MODE: true,
};
