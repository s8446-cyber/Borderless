// Payment-PIN quality rules — the gate between a typo'd or guessable PIN and
// a locked wallet. Pure JS, so we test it exhaustively where it matters.
import test from "node:test";
import assert from "node:assert/strict";
import { pinIssue } from "../src/pin.js";

test("accepts ordinary 4-digit PINs", () => {
  for (const ok of ["1379", "2049", "8317", "9026", "1010", "7788", "1123"]) {
    assert.equal(pinIssue(ok), null, ok + " should be accepted");
  }
});

test("rejects non-4-digit input", () => {
  for (const bad of ["", "123", "12345", "abcd", "12a4", null, undefined, "12 4"]) {
    assert.ok(pinIssue(bad), JSON.stringify(bad) + " should be rejected");
  }
});

test("rejects repeated digits (0000…9999)", () => {
  for (let d = 0; d <= 9; d++) {
    const pin = String(d).repeat(4);
    assert.ok(pinIssue(pin), pin + " should be rejected");
  }
});

test("rejects ascending and descending runs", () => {
  for (const bad of ["0123", "1234", "2345", "3456", "4567", "5678", "6789", "9876", "8765", "7654", "6543", "5432", "4321", "3210"]) {
    assert.ok(pinIssue(bad), bad + " should be rejected");
  }
});

test("rejects the classic keypad-line PINs", () => {
  assert.ok(pinIssue("2580"));
  assert.ok(pinIssue("0852"));
});

test("near-sequences are allowed (only strict runs are blocked)", () => {
  for (const ok of ["1235", "1324", "9875", "1122"]) {
    assert.equal(pinIssue(ok), null, ok + " should be accepted");
  }
});
