import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeAmount, amountIssue, vpaIssue, ifscIssue,
  normalizePhone, phoneIssue, accountIssue, accountsMatch,
  nameIssue, consumerIdIssue,
} from "../src/validation.js";

// sanitizeAmount
test("sanitizeAmount: strips non-numeric, caps 2 decimals", () => {
  assert.equal(sanitizeAmount("1,23,456.789"), "123456.78");
  assert.equal(sanitizeAmount("abc12.5xyz"), "12.5");
  assert.equal(sanitizeAmount("007"), "7");
  assert.equal(sanitizeAmount(".5"), "0.5");
  assert.equal(sanitizeAmount("12.3.4"), "12.34");
  assert.equal(sanitizeAmount(""), "");
  assert.equal(sanitizeAmount(null), "");
});

// amountIssue
test("amountIssue: valid amounts", () => {
  assert.equal(amountIssue("10"), null);
  assert.equal(amountIssue("999.99"), null);
  assert.equal(amountIssue("1"), null);
});
test("amountIssue: invalid inputs", () => {
  assert.equal(amountIssue(""), "amount_empty");
  assert.equal(amountIssue("abc"), "amount_invalid");
  assert.equal(amountIssue("0"), "amount_invalid");
  assert.equal(amountIssue("-5"), "amount_invalid");
  assert.equal(amountIssue("1.999"), "amount_invalid");
  assert.equal(amountIssue("0.5"), "amount_too_small"); // default min=1
  assert.equal(amountIssue("10000001"), "amount_too_large");
});
test("amountIssue: balance check", () => {
  assert.equal(amountIssue("500", { balance: 1000 }), null);
  assert.equal(amountIssue("1500", { balance: 1000 }), "amount_exceeds_balance");
});

// vpaIssue
test("vpaIssue: valid VPAs", () => {
  for (const v of ["a@bank", "user.name@upi", "01@paytm", "test-user@icici"]) {
    assert.equal(vpaIssue(v), null, v);
  }
});
test("vpaIssue: invalid VPAs", () => {
  for (const v of ["", "noatsign", "@bank", "a@1bank", "a b@bank"]) {
    assert.ok(vpaIssue(v), v + " should fail");
  }
});

// ifscIssue
test("ifscIssue: valid IFSC codes", () => {
  assert.equal(ifscIssue("HDFC0001234"), null);
  assert.equal(ifscIssue("SBIN0000001"), null);
  assert.equal(ifscIssue("icic0abc123"), null); // case-insensitive
});
test("ifscIssue: invalid IFSC codes", () => {
  assert.ok(ifscIssue(""));
  assert.ok(ifscIssue("HDFC1001234")); // 5th char must be 0
  assert.ok(ifscIssue("HDC0001234")); // only 3 letters at start
  assert.ok(ifscIssue("HDFC00012"));  // too short
});

// normalizePhone
test("normalizePhone: strips +91, leading 0, non-digits", () => {
  assert.equal(normalizePhone("+91 98765 43210"), "9876543210");
  assert.equal(normalizePhone("09876543210"), "9876543210");
  assert.equal(normalizePhone("919876543210"), "9876543210");
  assert.equal(normalizePhone("9876543210"), "9876543210");
});
test("phoneIssue: valid and invalid phones", () => {
  assert.equal(phoneIssue("9876543210"), null);
  assert.equal(phoneIssue("+91 9876543210"), null);
  assert.ok(phoneIssue("1234567890")); // starts with 1
  assert.ok(phoneIssue("98765")); // too short
});

// accountIssue
test("accountIssue: 9-18 digits accepted", () => {
  assert.equal(accountIssue("123456789"), null);
  assert.equal(accountIssue("123456789012345678"), null);
});
test("accountIssue: invalid", () => {
  assert.ok(accountIssue(""));
  assert.ok(accountIssue("12345678")); // 8 digits only
  assert.ok(accountIssue("1234567890123456789")); // 19 digits
  assert.ok(accountIssue("12345abc"));
});

// accountsMatch
test("accountsMatch: matches and mismatches", () => {
  assert.ok(accountsMatch("123456789", "123456789"));
  assert.ok(accountsMatch("123 456", "123456")); // whitespace stripped
  assert.ok(!accountsMatch("123456789", "987654321"));
  assert.ok(!accountsMatch("", ""));
});

// nameIssue
test("nameIssue", () => {
  assert.equal(nameIssue("Naveen"), null);
  assert.ok(nameIssue(""));
  assert.ok(nameIssue("x"));
});

// consumerIdIssue
test("consumerIdIssue", () => {
  assert.equal(consumerIdIssue("ACC123"), null);
  assert.equal(consumerIdIssue("DEL-2024/01"), null);
  assert.ok(consumerIdIssue(""));
  assert.ok(consumerIdIssue("abc")); // < 4 chars
  assert.ok(consumerIdIssue("abc 123")); // space
});
