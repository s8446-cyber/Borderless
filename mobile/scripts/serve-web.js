#!/usr/bin/env node
// Serve the exported web build of the mobile app (dist/) on a local port so it
// can be opened in ANY browser — zero install, the real React Native app via
// react-native-web. Used by `npm run sim` (which exports first).
//   node scripts/serve-web.js [port]
const http = require("node:http");
const { readFile } = require("node:fs/promises");
const { existsSync } = require("node:fs");
const { join, normalize, extname } = require("node:path");

const DIST = join(__dirname, "..", "dist");
const PORT = Number(process.argv[2] || process.env.PORT || 8080);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".ico": "image/x-icon", ".png": "image/png", ".svg": "image/svg+xml", ".map": "application/json", ".ttf": "font/ttf", ".woff": "font/woff", ".woff2": "font/woff2" };

if (!existsSync(DIST)) {
  console.error("No dist/ found. Build first:  npx expo export --platform web");
  process.exit(1);
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/index.html";
    let full = normalize(join(DIST, rel));
    if (!full.startsWith(DIST)) { res.statusCode = 403; return res.end("forbidden"); }
    if (!existsSync(full)) full = join(DIST, "index.html"); // SPA fallback
    const data = await readFile(full);
    res.setHeader("content-type", MIME[extname(full)] || "application/octet-stream");
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.end("not found");
  }
}).listen(PORT, () => {
  console.log("\nBorderless Pay — mobile app (web build) running at:");
  console.log("  http://localhost:" + PORT + "\n");
  console.log("Open it in any browser. It's the real React Native app (react-native-web),");
  console.log("in demo mode — onboard, pay, and tap 'Verify this receipt independently'.\n");
});
