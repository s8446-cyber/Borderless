// UPI QR parser tests — QR contents are untrusted input, so the parser is the
// mobile app's first line of defense. Run with: npm test (node --test).
import test from "node:test";
import assert from "node:assert/strict";
import { parseUpiQr } from "../src/upi.js";

test("parses a full NPCI merchant QR (pa/pn/am/tn/cu)", () => {
  const r = parseUpiQr("upi://pay?pa=cafe.ccd@hdfcbank&pn=Cafe%20Coffee%20Day&am=245.50&cu=INR&tn=Table%204");
  assert.deepEqual(r, { vpa: "cafe.ccd@hdfcbank", name: "Cafe Coffee Day", amount: 245.5, note: "Table 4" });
});

test("amount is optional; name falls back to the VPA", () => {
  const r = parseUpiQr("upi://pay?pa=rohan@bpl");
  assert.equal(r.vpa, "rohan@bpl");
  assert.equal(r.name, "rohan@bpl");
  assert.equal(r.amount, null);
  assert.equal(r.note, "");
});

test("scheme is case-insensitive; '+' decodes to space", () => {
  const r = parseUpiQr("UPI://PAY?pa=a@icici&pn=Priya+Nair");
  assert.equal(r.name, "Priya Nair");
});

test("rejects non-UPI payloads outright", () => {
  assert.equal(parseUpiQr("https://example.com/pay?pa=a@b"), null);
  assert.equal(parseUpiQr("upi://collect?pa=a@b"), null);
  assert.equal(parseUpiQr(""), null);
  assert.equal(parseUpiQr(null), null);
  assert.equal(parseUpiQr(undefined), null);
});

test("rejects malformed or dangerous VPAs", () => {
  assert.equal(parseUpiQr("upi://pay?pa="), null, "empty VPA");
  assert.equal(parseUpiQr("upi://pay?pa=no-handle"), null, "missing @handle");
  assert.equal(parseUpiQr("upi://pay?pa=@bank"), null, "missing local part");
  assert.equal(parseUpiQr("upi://pay?pa=a@1bank"), null, "handle must start with a letter");
  assert.equal(parseUpiQr("upi://pay?pa=" + "x".repeat(80) + "@bank"), null, "local part too long");
  assert.equal(parseUpiQr("upi://pay?pa=a b@bank"), null, "whitespace in VPA");
});

test("refuses non-INR currency instead of mischarging", () => {
  assert.equal(parseUpiQr("upi://pay?pa=a@bank&cu=USD"), null);
  assert.ok(parseUpiQr("upi://pay?pa=a@bank&cu=INR"));
  assert.ok(parseUpiQr("upi://pay?pa=a@bank&cu=inr"), "currency check is case-insensitive");
});

test("rejects invalid amounts (zero, negative, NaN, absurd, >2 decimals)", () => {
  for (const am of ["0", "-5", "abc", "10000001", "1.999"]) {
    assert.equal(parseUpiQr(`upi://pay?pa=a@bank&am=${am}`), null, `am=${am}`);
  }
  assert.equal(parseUpiQr("upi://pay?pa=a@bank&am=1.99").amount, 1.99);
  assert.equal(parseUpiQr("upi://pay?pa=a@bank&am=450").amount, 450);
});

test("strips control characters and caps display fields", () => {
  const r = parseUpiQr("upi://pay?pa=a@bank&pn=Evil%0A%0DName&tn=" + encodeURIComponent("x".repeat(500)));
  assert.equal(r.name, "EvilName");
  assert.equal(r.note.length, 120);
});

test("survives malformed percent-encoding without throwing", () => {
  const r = parseUpiQr("upi://pay?pa=a@bank&pn=%E0%A4%");
  assert.ok(r, "keeps the raw value when decodeURIComponent fails");
});
