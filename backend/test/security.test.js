// Security-focused unit tests: rate limiting, account lockout, field encryption,
// audit-chain tamper detection, transaction limits, input validators, and PIN
// hashing (including legacy-format verification).
import { test } from "node:test";
import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";

import { RateLimiter, LoginGuard, asPin, asAmount, asString } from "../src/security.js";
import { encryptField, decryptField, isEncrypted, constantTimeEqual } from "../src/crypto.js";
import { AuditLog } from "../src/audit.js";
import { checkTxnLimits } from "../src/limits.js";
import { hashPin, verifyPin, signPayment, verifyPaymentSignature } from "../src/auth.js";

function fakeStore() {
  return { data: { security: { fails: {}, locks: {} }, payments: {} }, persist() {} };
}

test("rate limiter blocks after max within window", () => {
  const rl = new RateLimiter({ windowMs: 1000, max: 3 });
  const now = 1000;
  assert.equal(rl.check("ip1", now).ok, true);
  assert.equal(rl.check("ip1", now).ok, true);
  assert.equal(rl.check("ip1", now).ok, true);
  const blocked = rl.check("ip1", now);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter >= 1);
  // window slides: a request far in the future is allowed again
  assert.equal(rl.check("ip1", now + 2000).ok, true);
  // separate key is independent
  assert.equal(rl.check("ip2", now).ok, true);
});

test("login guard locks the account after repeated PIN failures", () => {
  const store = fakeStore();
  const g = new LoginGuard(store, { maxFails: 3, windowMs: 10000, lockMs: 10000 });
  const now = 5000;
  g.recordFail("u1", now);
  g.recordFail("u1", now);
  const third = g.recordFail("u1", now);
  assert.equal(third.locked, true);
  assert.throws(() => g.assertNotLocked("u1", now + 1), /account_locked|Too many/);
  // lock expires
  assert.doesNotThrow(() => g.assertNotLocked("u1", now + 20000));
  // success clears counters
  g.recordFail("u2", now);
  g.recordSuccess("u2");
  assert.equal((store.data.security.fails["u2"] || undefined), undefined);
});

test("field encryption round-trips and is authenticated", () => {
  const secret = "1234567890123456"; // a raw account number
  const blob = encryptField(secret);
  assert.ok(isEncrypted(blob));
  assert.notEqual(blob, secret);
  assert.equal(decryptField(blob), secret);
  // tampering with the ciphertext is detected by the GCM auth tag
  const parts = blob.split(":");
  const flipped = parts[3].slice(0, -1) + (parts[3].endsWith("a") ? "b" : "a");
  const tampered = [parts[0], parts[1], parts[2], flipped].join(":");
  assert.throws(() => decryptField(tampered));
  // null passes through
  assert.equal(encryptField(null), null);
  assert.equal(constantTimeEqual("abc", "abc"), true);
  assert.equal(constantTimeEqual("abc", "abd"), false);
});

test("audit log is hash-chained and tamper-evident", () => {
  const a = new AuditLog();
  a.append("payment_settled", { paymentId: "p1", totalMinor: 1000 });
  a.append("pin_failed", { userId: "u1" });
  assert.equal(a.verify().ok, true);
  // retroactively edit an entry -> chain breaks
  a.entries[1].data.totalMinor = 999999;
  assert.equal(a.verify().ok, false);
});

test("audit log survives serialize/deserialize", () => {
  const a = new AuditLog();
  a.append("e1", { x: 1 });
  const restored = new AuditLog(a.toJSON());
  assert.equal(restored.verify().ok, true);
  assert.equal(restored.entries.length, a.entries.length);
});

test("transaction limits enforce min, per-txn max, and reject bad amounts", () => {
  const store = fakeStore();
  // below minimum (min is 100 minor = 1.00)
  assert.throws(() => checkTxnLimits(store, "u1", 50, { intl: false }), /below the minimum/);
  // normal domestic amount ok
  assert.doesNotThrow(() => checkTxnLimits(store, "u1", 25000, { intl: false }));
  // exceeds domestic per-txn max (20000000 minor)
  assert.throws(() => checkTxnLimits(store, "u1", 20000001, { intl: false }), /exceeds the per-transaction/);
  // intl allows a higher ceiling
  assert.doesNotThrow(() => checkTxnLimits(store, "u1", 20000001, { intl: true }));
});

test("transaction limits enforce daily velocity cap", () => {
  const store = fakeStore();
  const now = Date.now();
  // seed payments near the daily total cap (100000000 minor)
  store.data.payments = {
    a: { userId: "u1", totalMinor: 99990000, settledAt: now },
  };
  assert.throws(() => checkTxnLimits(store, "u1", 20000, { intl: false }, now), /Daily transfer limit/);
});

test("input validators reject malformed input", () => {
  assert.equal(asPin("1234"), "1234");
  assert.equal(asPin("123456"), "123456");
  assert.throws(() => asPin("12"), /4 to 6 digits/);
  assert.throws(() => asPin("12ab"), /4 to 6 digits/);
  assert.equal(asAmount("100.50", "amount"), 100.5);
  assert.throws(() => asAmount("-5", "amount"), /must be/);
  assert.throws(() => asAmount("abc", "amount"), /must be/);
  assert.equal(asString("hello", "name"), "hello");
  assert.throws(() => asString("", "name"), /is required/);
  assert.throws(() => asString("x".repeat(9999), "name", { max: 10 }), /is too long/);
});

test("PIN hashing: versioned scrypt round-trip + legacy compatibility", () => {
  const stored = hashPin("4321");
  assert.ok(stored.startsWith("scrypt$"));
  assert.equal(verifyPin("4321", stored), true);
  assert.equal(verifyPin("0000", stored), false);
  // legacy "salt:hash" format (scrypt default params, 32-byte key) still verifies
  const salt = "deadbeef";
  const legacy = salt + ":" + scryptSync("4321", salt, 32).toString("hex");
  assert.equal(verifyPin("4321", legacy), true);
  assert.equal(verifyPin("9999", legacy), false);
});

test("payment signature verifies and rejects tampering", () => {
  const fields = { paymentId: "pay_1", userId: "u1", currency: "AED", localAmount: 80, amountMinor: 185600, feeMinor: 928, totalMinor: 186528, settlementHash: "abc" };
  const sig = signPayment(fields);
  assert.equal(verifyPaymentSignature(fields, sig), true);
  assert.equal(verifyPaymentSignature({ ...fields, totalMinor: 1 }, sig), false);
});
