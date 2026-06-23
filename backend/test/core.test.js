import test from "node:test";
import assert from "node:assert/strict";
import { createQuote, createP2PQuote, isQuoteValid, FEE_MIN_MINOR } from "../src/fx.js";
import { DualLedger, merkleRoot, sha256 } from "../src/ledger.js";
import { hashPin, verifyPin, signPayment, verifyPaymentSignature } from "../src/auth.js";
import { Store } from "../src/store.js";
import { PaymentService } from "../src/payments.js";
import { runKyc } from "../src/kyc.js";

test("FX quote: mid-market, explicit fee, no markup", () => {
  const q = createQuote("AED", 80);
  assert.equal(q.rate, 23.20);
  assert.equal(q.fxMarkupMinor, 0);
  assert.equal(q.amountMinor, Math.round(80 * 23.2 * 100)); // 185600
  assert.equal(q.feeMinor, Math.round(q.amountMinor * 0.005)); // 928
  assert.equal(q.totalMinor, q.amountMinor + q.feeMinor);
});

test("FX fee floor applies to tiny amounts", () => {
  const q = createQuote("NPR", 1); // 0.625 INR -> tiny
  assert.equal(q.feeMinor, FEE_MIN_MINOR);
});

test("quote expiry", () => {
  const q = createQuote("EUR", 10);
  assert.ok(isQuoteValid(q, q.createdAt));
  assert.ok(!isQuoteValid(q, q.expiresAt + 1));
});

test("dual ledger: append, anchor, verify", () => {
  const l = new DualLedger({ anchorEvery: 2 });
  l.append({ type: "settlement", paymentId: "p1" });
  const r2 = l.append({ type: "settlement", paymentId: "p2" });
  assert.ok(r2.anchor, "anchor published after 2 blocks");
  const v = l.verify();
  assert.equal(v.ok, true);
});

test("dual ledger: tampering is detected", () => {
  const l = new DualLedger();
  l.append({ type: "settlement", paymentId: "p1", totalMinor: 1000 });
  l.blocks[1].txn.totalMinor = 1; // tamper
  const v = l.verify();
  assert.equal(v.ok, false);
});

test("merkle root deterministic", () => {
  const leaves = ["a", "b", "c"].map(sha256);
  assert.equal(merkleRoot(leaves), merkleRoot(leaves));
});

test("PIN hashing round-trip", () => {
  const h = hashPin("1234");
  assert.ok(verifyPin("1234", h));
  assert.ok(!verifyPin("9999", h));
});

test("payment signature verifies and rejects tampering", () => {
  const f = { paymentId: "pay_1", userId: "u1", currency: "AED", localAmount: 80, amountMinor: 185600, feeMinor: 928, totalMinor: 186528, settlementHash: "abc" };
  const sig = signPayment(f);
  assert.ok(verifyPaymentSignature(f, sig));
  assert.ok(!verifyPaymentSignature({ ...f, totalMinor: 1 }, sig));
});

test("KYC verifies and blocks sanctions", () => {
  assert.equal(runKyc({ fullName: "Aarav Shah", documentId: "X1", country: "IN" }).status, "verified");
  assert.equal(runKyc({ fullName: "Blocked Person", documentId: "X1", country: "IN" }).status, "rejected");
});

test("end-to-end payment + idempotency + balance", () => {
  const store = new Store(null);
  const svc = new PaymentService(store, new DualLedger());
  const userId = "usr_test";
  store.data.users[userId] = { id: userId, name: "Aarav", country: "IN", kyc: { status: "verified" } };
  store.data.accounts[userId] = { bank: "HDFC", currency: "INR", balanceMinor: 1000000 }; // ₹10,000
  store.data.pins[userId] = hashPin("4321");

  const q = svc.quote("AED", 80);
  const first = svc.execute({ userId, quoteId: q.quoteId, pin: "4321", idempotencyKey: "k1" });
  assert.equal(first.replayed, false);
  assert.equal(first.receipt.status, "settled");
  assert.equal(store.data.accounts[userId].balanceMinor, 1000000 - q.totalMinor);

  // replay with same key -> no double charge
  const replay = svc.execute({ userId, quoteId: q.quoteId, pin: "4321", idempotencyKey: "k1" });
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt.paymentId, first.receipt.paymentId);
  assert.equal(store.data.accounts[userId].balanceMinor, 1000000 - q.totalMinor);
});

test("payment rejects wrong PIN and insufficient funds", () => {
  const store = new Store(null);
  const svc = new PaymentService(store, new DualLedger());
  const userId = "u";
  store.data.users[userId] = { id: userId, kyc: { status: "verified" } };
  store.data.accounts[userId] = { balanceMinor: 100, currency: "INR" };
  store.data.pins[userId] = hashPin("1111");
  const q = svc.quote("AED", 80);
  assert.throws(() => svc.execute({ userId, quoteId: q.quoteId, pin: "0000" }), (e) => e.code === "bad_pin");
  assert.throws(() => svc.execute({ userId, quoteId: q.quoteId, pin: "1111" }), (e) => e.code === "insufficient_funds");
});

test("P2P quote: INR principal in, recipient amount out, fee on principal", () => {
  const q = createP2PQuote("AED", 1000); // send ₹1000 to an AED recipient
  assert.equal(q.kind, "p2p");
  assert.equal(q.sendAmountMinor, 100000);
  assert.equal(q.feeMinor, Math.round(100000 * 0.005)); // 500
  assert.equal(q.totalMinor, 100500);
  assert.equal(q.fxMarkupMinor, 0);
  assert.equal(q.recipientAmount, Math.round((1000 / 23.20) * 100) / 100);
});

test("end-to-end P2P transfer + idempotency + balance debit", () => {
  const store = new Store(null);
  const svc = new PaymentService(store, new DualLedger());
  const userId = "usr_p2p";
  store.data.users[userId] = { id: userId, name: "Aarav", country: "IN", kyc: { status: "verified" } };
  store.data.accounts[userId] = { bank: "HDFC", currency: "INR", balanceMinor: 1000000 }; // ₹10,000
  store.data.pins[userId] = hashPin("4321");

  const q = svc.quoteTransfer("AED", 1000);
  const first = svc.transfer({ userId, quoteId: q.quoteId, pin: "4321", idempotencyKey: "t1", recipient: { name: "Sara", country: "AE" } });
  assert.equal(first.replayed, false);
  assert.equal(first.receipt.kind, "p2p");
  assert.equal(first.receipt.status, "settled");
  assert.equal(first.receipt.recipient.name, "Sara");
  assert.equal(store.data.accounts[userId].balanceMinor, 1000000 - q.totalMinor);

  // replay with same key -> no double send
  const replay = svc.transfer({ userId, quoteId: q.quoteId, pin: "4321", idempotencyKey: "t1", recipient: { name: "Sara", country: "AE" } });
  assert.equal(replay.replayed, true);
  assert.equal(replay.receipt.paymentId, first.receipt.paymentId);
  assert.equal(store.data.accounts[userId].balanceMinor, 1000000 - q.totalMinor);
});

test("P2P transfer rejects wrong PIN", () => {
  const store = new Store(null);
  const svc = new PaymentService(store, new DualLedger());
  const userId = "u";
  store.data.users[userId] = { id: userId, kyc: { status: "verified" } };
  store.data.accounts[userId] = { balanceMinor: 1000000, currency: "INR" };
  store.data.pins[userId] = hashPin("1111");
  const q = svc.quoteTransfer("AED", 1000);
  assert.throws(() => svc.transfer({ userId, quoteId: q.quoteId, pin: "0000" }), (e) => e.code === "bad_pin");
});

test("domestic UPI payment: zero fee, exact debit, instant", () => {
  const store = new Store(null);
  const svc = new PaymentService(store, new DualLedger());
  const userId = "usr_dom";
  store.data.users[userId] = { id: userId, name: "Aarav", country: "IN", kyc: { status: "verified" } };
  store.data.accounts[userId] = { bank: "HDFC", currency: "INR", balanceMinor: 500000 }; // ₹5,000
  store.data.pins[userId] = hashPin("4321");

  const out = svc.payDomestic({ userId, pin: "4321", amountINR: 250, payee: { name: "Priya Nair", type: "upi" }, kind: "upi", idempotencyKey: "d1" });
  assert.equal(out.replayed, false);
  assert.equal(out.receipt.kind, "upi");
  assert.equal(out.receipt.domestic, true);
  assert.equal(out.receipt.feeMinor, 0);
  assert.equal(out.receipt.totalMinor, 25000);
  assert.equal(store.data.accounts[userId].balanceMinor, 500000 - 25000);

  // idempotent replay -> no double charge
  const replay = svc.payDomestic({ userId, pin: "4321", amountINR: 250, payee: { name: "Priya Nair", type: "upi" }, kind: "upi", idempotencyKey: "d1" });
  assert.equal(replay.replayed, true);
  assert.equal(store.data.accounts[userId].balanceMinor, 500000 - 25000);
});

test("domestic payment rejects wrong PIN and bad amount", () => {
  const store = new Store(null);
  const svc = new PaymentService(store, new DualLedger());
  const userId = "u";
  store.data.users[userId] = { id: userId, kyc: { status: "verified" } };
  store.data.accounts[userId] = { balanceMinor: 100000, currency: "INR" };
  store.data.pins[userId] = hashPin("1111");
  assert.throws(() => svc.payDomestic({ userId, pin: "0000", amountINR: 100, payee: { name: "X" } }), (e) => e.code === "bad_pin");
  assert.throws(() => svc.payDomestic({ userId, pin: "1111", amountINR: 0, payee: { name: "X" } }), (e) => e.code === "bad_amount");
});

test("collect request: create then pay debits payer", () => {
  const store = new Store(null);
  const svc = new PaymentService(store, new DualLedger());
  const userId = "usr_req";
  store.data.users[userId] = { id: userId, kyc: { status: "verified" } };
  store.data.accounts[userId] = { balanceMinor: 200000, currency: "INR" };
  store.data.pins[userId] = hashPin("2222");
  const r = svc.createRequest({ userId, fromName: "Rohan", amountINR: 450, note: "Dinner" });
  assert.equal(r.status, "pending");
  assert.equal(svc.listRequests(userId).length, 1);
  const out = svc.payRequest({ userId, requestId: r.id, pin: "2222", idempotencyKey: "rq1" });
  assert.equal(out.receipt.kind, "request");
  assert.equal(store.data.accounts[userId].balanceMinor, 200000 - 45000);
  assert.equal(svc.listRequests(userId)[0].status, "paid");
});
