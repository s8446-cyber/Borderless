import test from "node:test";
import assert from "node:assert/strict";
import { buildReceiptShareText, receiptRecipient } from "../src/receiptText.js";

const INTL_RECEIPT = {
  kind: "p2p",
  domestic: false,
  recipient: { name: "Lakshmi S" },
  amount: 2000,
  total: 2050,
  fee: 50,
  recipientAmount: 91.5,
  currency: "AED",
  rate: "22.40",
  reference: "TXN-INTL-001",
  status: "completed",
  settlementMode: "live",
  settlement: { hash: "abc123" },
  anchor: { publicTxHash: "def456" },
  signature: "sig" + "x".repeat(60),
};

const DOM_RECEIPT = {
  kind: "p2p",
  domestic: true,
  payee: { name: "Ravi Kumar" },
  amount: 500,
  total: 500,
  fee: 0,
  currency: "INR",
  reference: "TXN-DOM-001",
  status: "completed",
  settlementMode: "upi",
};

const TOPUP_RECEIPT = {
  kind: "topup",
  domestic: true,
  total: 1000,
  fee: 0,
  currency: "INR",
  reference: "TXN-TOP-001",
  status: "completed",
};

test("receiptRecipient: returns correct name per type", () => {
  assert.equal(receiptRecipient(INTL_RECEIPT), "Lakshmi S");
  assert.equal(receiptRecipient(DOM_RECEIPT), "Ravi Kumar");
  assert.equal(receiptRecipient(TOPUP_RECEIPT), "Your Borderless balance");
  assert.equal(receiptRecipient(null), "");
});

test("international receipt: hierarchy is recipient \u2192 amount \u2192 rate \u2192 fee \u2192 total \u2192 status \u2192 help \u2192 tech", () => {
  const text = buildReceiptShareText(INTL_RECEIPT, { fundingLabel: "Savings \u2022\u20221234" });
  const idx = (s) => text.indexOf(s);
  assert.ok(idx("Lakshmi S") > -1, "recipient present");
  assert.ok(idx("They received") > -1, "recipient amount present");
  assert.ok(idx("Rate:") > -1, "rate present");
  assert.ok(idx("Fee:") > -1, "fee present");
  assert.ok(idx("Total debit:") > -1, "total present");
  assert.ok(idx("Savings \u2022\u20221234") > -1, "funding account present");
  assert.ok(idx("Get help") > -1, "help action present");
  // Technical details come AFTER help
  assert.ok(idx("Technical verification") > idx("Get help"), "tech after help");
  assert.ok(idx("abc123") > idx("Technical verification"), "hash after tech header");
  // Recipient must appear before total
  assert.ok(idx("Lakshmi S") < idx("Total debit:"));
});

test("domestic receipt: no rate line, free fee", () => {
  const text = buildReceiptShareText(DOM_RECEIPT);
  assert.ok(!text.includes("Rate:"), "no rate for domestic");
  assert.ok(text.includes("\u20b90 (free)"), "zero fee shown");
  assert.ok(text.includes("Ravi Kumar"));
});

test("topup receipt: correct verb and recipient", () => {
  const text = buildReceiptShareText(TOPUP_RECEIPT);
  assert.ok(text.includes("Added"));
  assert.ok(text.includes("Borderless balance"));
});

test("no tech section when no hash/sig present", () => {
  const text = buildReceiptShareText({ ...DOM_RECEIPT, settlement: undefined, anchor: undefined, signature: undefined });
  assert.ok(!text.includes("Technical verification"));
});

test("signature is truncated to 40 chars + ellipsis", () => {
  const text = buildReceiptShareText(INTL_RECEIPT);
  // sig + 40 x's, then ellipsis
  assert.ok(text.includes("sig" + "x".repeat(37) + "\u2026"));
});

test("null input returns empty string", () => {
  assert.equal(buildReceiptShareText(null), "");
});
