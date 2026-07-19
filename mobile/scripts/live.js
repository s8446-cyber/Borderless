#!/usr/bin/env node
// Borderless Pay mobile — run the app against the local backend.
//
//   Terminal 1:  cd backend && npm start        (the API, port 4000)
//   Terminal 2:  cd mobile  && npm run live     (this script)
//
// It auto-discovers the backend (LAN IP first — so a physical phone on the
// same Wi-Fi can reach it — then localhost), verifies /api/health, and
// launches Expo with EXPO_PUBLIC_API_BASE set.
// No code edits, no env-var juggling. `--check` verifies without launching.
//
// Zero dependencies.
const { networkInterfaces } = require("node:os");
const { spawn } = require("node:child_process");
const http = require("node:http");

const PORT = process.env.BP_PORT || "4000";
const checkOnly = process.argv.includes("--check");

function lanIps() {
  const out = [];
  const ifs = networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const ni of ifs[name] || []) {
      if (ni.family === "IPv4" && !ni.internal) out.push(ni.address);
    }
  }
  return out;
}

function healthy(base) {
  return new Promise((resolve) => {
    const req = http.get(base + "/api/health", { timeout: 2500 }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => resolve(res.statusCode === 200 && /"ok"\s*:\s*true/.test(d)));
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

(async () => {
  console.log("\nBorderless Pay — live mode (mobile <-> real backend)\n");
  // LAN IPs first: a physical phone can reach those; localhost is the fallback
  // (fine for iOS simulator; Android emulator users should keep the LAN IP).
  const candidates = [...lanIps().map((ip) => "http://" + ip + ":" + PORT), "http://localhost:" + PORT];
  let base = null;
  for (const c of candidates) {
    process.stdout.write("  probing " + c + " ... ");
    if (await healthy(c)) { console.log("OK - backend is up"); base = c; break; }
    console.log("-");
  }
  if (!base) {
    console.error("\nX No backend found on port " + PORT + ".");
    console.error("  Start it in ANOTHER terminal first:");
    console.error("      cd backend && npm start");
    console.error("  then re-run:  npm run live");
    console.error("  (different port? BP_PORT=4100 npm run live)\n");
    process.exit(1);
  }

  console.log("\nBACKEND READY");
  console.log("  API base : " + base);
  console.log("  Every action in the app hits this real backend");
  if (base.includes("localhost")) {
    console.log("  NOTE: no LAN IP responded - a PHYSICAL phone cannot reach 'localhost'.");
    console.log("        Ensure your PC and phone are on the same Wi-Fi, or use `adb reverse tcp:" + PORT + " tcp:" + PORT + "`.");
  } else {
    console.log("  Phone    : same Wi-Fi as this PC -> scan the QR with Expo Go");
  }
  console.log("  Verify   : the welcome screen's build stamp will show '" + base + "'\n");
  if (checkOnly) process.exit(0);

  const env = { ...process.env, EXPO_PUBLIC_API_BASE: base };
  // --clear: Metro's transform cache does NOT reliably invalidate when
  // EXPO_PUBLIC_* env vars change, so a previous session could otherwise
  // serve a stale bundle pointing at the wrong backend.
  const child = spawn("npx expo start --clear", { stdio: "inherit", env, shell: true });
  child.on("exit", (code) => process.exit(code === null ? 0 : code));
})();
