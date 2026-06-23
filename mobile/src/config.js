// Borderless Pay mobile — runtime configuration.
export const CONFIG = {
  // Point this at your running backend. For a real phone on the same Wi-Fi,
  // use your computer's LAN IP, e.g. "http://192.168.1.10:4000".
  API_BASE: "http://localhost:4000",

  // When true, the app runs FULLY STANDALONE with a built-in simulator — no
  // backend needed. Flip to false to talk to the real Node backend above.
  DEMO_MODE: true,
};
