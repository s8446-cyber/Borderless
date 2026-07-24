import test from "node:test";
import assert from "node:assert/strict";
import { humanError } from "../src/errors.js";

test("maps known machine codes to friendly copy", () => {
  assert.ok(humanError("insufficient_funds").toLowerCase().includes("balance"));
  assert.ok(humanError("wallet_locked").toLowerCase().includes("locked"));
  assert.ok(humanError("incorrect_pin").toLowerCase().includes("pin"));
  assert.ok(humanError("session_expired").toLowerCase().includes("sign in"));
  assert.ok(humanError("unauthorized").toLowerCase().includes("sign in"));
  assert.ok(humanError("rate_limited").toLowerCase().includes("wait"));
  assert.ok(humanError("quote_expired").toLowerCase().includes("quote"));
  assert.ok(humanError("sanctions_blocked").toLowerCase().includes("support"));
  assert.ok(humanError("cooling_period").toLowerCase().includes("24 hours"));
  assert.ok(humanError("payee_unverified").toLowerCase().includes("verify"));
});

test("accepts error objects (message property)", () => {
  const result = humanError({ message: "insufficient_funds" });
  assert.ok(result.toLowerCase().includes("balance"));
});

test("passes through already-human sentences", () => {
  const human = "The store is temporarily unavailable. Please try later.";
  assert.equal(humanError(human), human);
});

test("never exposes API paths", () => {
  const r = humanError("POST /api/auth/login \u2022 lockout-guarded, optional TOTP 2FA");
  assert.ok(!r.includes("/api/"), "result must not leak endpoint: " + r);
});

test("never exposes bare snake_case codes for unknown codes", () => {
  const r = humanError("some_weird_internal_code");
  assert.ok(!r.includes("some_weird_internal_code"), r);
});

test("falls back to generic when empty", () => {
  assert.ok(humanError(""));
  assert.ok(humanError(null));
  assert.ok(humanError(undefined));
});

test("uses caller-supplied fallback when provided", () => {
  const fb = "Custom fallback message.";
  assert.equal(humanError("", fb), fb);
  assert.equal(humanError("unknown_code_xyz", fb), fb);
});
