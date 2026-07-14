// UPI QR parser tests — guards mobile/src/upi.js (the single source of truth;
// the web app carries a mirrored copy with identical rules). The mobile
// package is CommonJS-flagged for Metro, so we load the ESM source by text.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../mobile/src/upi.js", import.meta.url), "utf8").replace(/^export /m, "");
const parseUpiQr = new Function(src + "; return parseUpiQr;")();

// keep the web copy in lock-step: its validation regex must match mobile's
const webSrc = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("UPI QR: parses real-world merchant and P2P codes", () => {
  const m = parseUpiQr("upi://pay?pa=ccd@icici&pn=Cafe%20Coffee%20Day&am=250.00&cu=INR&tn=Table+4");
  assert.deepEqual(m, { vpa: "ccd@icici", name: "Cafe Coffee Day", amount: 250, note: "Table 4" });
  const p = parseUpiQr("upi://pay?pa=rohan@bpl&pn=Rohan");
  assert.equal(p.vpa, "rohan@bpl");
  assert.equal(p.amount, null);
  assert.equal(parseUpiQr("UPI://PAY?pa=x@ybl&pn=X").vpa, "x@ybl", "case-insensitive scheme + short VPA");
});

test("UPI QR: hostile and malformed payloads are rejected", () => {
  for (const bad of [
    "https://evil.example/phish",            // not a UPI URI
    "upi://pay?pn=NoVpa&am=1",               // missing payee VPA
    "upi://pay?pa=not-a-vpa",                // invalid VPA
    "upi://pay?pa=a b@bank",                 // spaces in VPA
    "upi://pay?pa=x@ybl&am=10&cu=USD",       // non-INR — refuse rather than mischarge
    "upi://pay?pa=x@ybl&am=-5",              // negative amount
    "upi://pay?pa=x@ybl&am=1.005",           // sub-paisa precision
    "upi://pay?pa=x@ybl&am=99999999999",     // absurd amount
    "", null, undefined,
  ]) {
    assert.equal(parseUpiQr(bad), null, "must reject: " + String(bad).slice(0, 40));
  }
});

test("UPI QR: display fields are sanitized and capped", () => {
  assert.equal(parseUpiQr("upi://pay?pa=x@ybl&pn=A%0AB").name, "AB", "control chars stripped");
  assert.equal(parseUpiQr("upi://pay?pa=x@ybl&pn=" + "A".repeat(500)).name.length, 80, "name capped");
  assert.equal(parseUpiQr("upi://pay?pa=x@ybl").name, "x@ybl", "name falls back to VPA");
});

test("UPI QR: web app's mirrored parser uses the identical VPA rule", () => {
  const rule = String.raw`/^[a-z0-9][a-z0-9.\-_]{0,63}@[a-z][a-z0-9]{1,63}$/i`;
  assert.ok(src.includes(rule), "mobile parser contains the canonical VPA rule");
  assert.ok(webSrc.includes(rule), "web copy contains the same VPA rule — keep them in lock-step");
});
