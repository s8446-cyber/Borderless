// End-to-end HTTP journey test — drives the real server over a socket through a
// complete user lifecycle, asserting balances, idempotency, and integrity at
// each step. This is the closest automated proof that every wired flow works.
import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/server.js";

async function withServer(fn) {
  const app = buildApp({ dbPath: null });
  await new Promise((resolve) => app.server.listen(0, resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let token = null;
  const call = async (path, { method = "GET", body, idem, auth } = {}) => {
    const headers = { "content-type": "application/json" };
    const bearer = auth === undefined ? token : auth;
    if (bearer) headers.authorization = "Bearer " + bearer;
    if (idem) headers["idempotency-key"] = idem;
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
  const setToken = (t) => (token = t);
  try {
    await fn({ call, setToken });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
}

test("full journey: onboard → pay → send → domestic → bills → request → verify", async () => {
  await withServer(async ({ call, setToken }) => {
    // --- KYC + session ---
    let r = await call("/api/kyc/verify", { method: "POST", body: { fullName: "Aarav Shah", documentId: "P1", country: "IN" } });
    assert.equal(r.status, 200);
    assert.equal(r.data.kyc.status, "verified");
    setToken(r.data.token);

    // --- link bank ---
    r = await call("/api/accounts/link", { method: "POST", body: { bank: "HDFC Bank", pin: "4321", openingBalance: 250000 } });
    assert.equal(r.status, 200);
    assert.equal(r.data.balance, 250000);
    let bal = 25000000; // minor units

    // --- cross-border pay + idempotency ---
    r = await call("/api/quotes", { method: "POST", body: { currency: "AED", localAmount: 80 } });
    const q1 = r.data;
    assert.equal(q1.fxMarkupMinor, 0);
    r = await call("/api/payments", { method: "POST", idem: "k1", body: { quoteId: q1.quoteId, pin: "4321", merchant: { name: "Al Masa", country: "AED" } } });
    assert.equal(r.data.receipt.status, "settled");
    assert.equal(r.data.receipt.kind, "payment");
    bal -= r.data.receipt.totalMinor;
    assert.equal(r.data.receipt.balanceAfterMinor, bal);
    // replay with same idempotency key → no double charge
    r = await call("/api/payments", { method: "POST", idem: "k1", body: { quoteId: q1.quoteId, pin: "4321", merchant: { name: "Al Masa", country: "AED" } } });
    assert.equal(r.data.replayed, true);
    assert.equal(r.data.receipt.balanceAfterMinor, bal);

    // --- wrong PIN is rejected and does not move money ---
    r = await call("/api/quotes", { method: "POST", body: { currency: "AED", localAmount: 10 } });
    const qBad = r.data;
    r = await call("/api/payments", { method: "POST", body: { quoteId: qBad.quoteId, pin: "0000", merchant: { name: "x", country: "AED" } } });
    assert.equal(r.status, 401);
    assert.equal(r.data.error, "bad_pin");

    // --- P2P transfer ---
    r = await call("/api/transfers/quote", { method: "POST", body: { recipientCurrency: "AED", sendAmount: 1000 } });
    const q2 = r.data;
    assert.equal(q2.kind, "p2p");
    r = await call("/api/transfers", { method: "POST", idem: "t1", body: { quoteId: q2.quoteId, pin: "4321", recipient: { name: "Sara", country: "AED" } } });
    assert.equal(r.data.receipt.kind, "p2p");
    bal -= r.data.receipt.totalMinor;
    assert.equal(r.data.receipt.balanceAfterMinor, bal);

    // --- domestic UPI (zero fee) ---
    r = await call("/api/upi/pay", { method: "POST", idem: "u1", body: { amount: 250, pin: "4321", payee: { kind: "upi", type: "phone", name: "Priya", phone: "+91" } } });
    assert.equal(r.data.receipt.kind, "upi");
    assert.equal(r.data.receipt.feeMinor, 0);
    bal -= 25000;
    assert.equal(r.data.receipt.balanceAfterMinor, bal);

    // --- bill ---
    r = await call("/api/bills/pay", { method: "POST", idem: "b1", body: { amount: 900, pin: "4321", biller: { category: "Electricity", name: "Tata Power", consumerId: "C1" } } });
    assert.equal(r.data.receipt.kind, "bill");
    bal -= 90000;
    assert.equal(r.data.receipt.balanceAfterMinor, bal);

    // --- recharge ---
    r = await call("/api/recharge", { method: "POST", idem: "rc1", body: { amount: 299, pin: "4321", recharge: { operator: "Airtel", number: "+91" } } });
    assert.equal(r.data.receipt.kind, "recharge");
    bal -= 29900;
    assert.equal(r.data.receipt.balanceAfterMinor, bal);

    // --- collect requests: pay the seeded incoming, then create an outgoing ---
    r = await call("/api/requests");
    const incoming = r.data.requests.find((x) => x.direction === "incoming" && x.status === "pending");
    assert.ok(incoming, "a seeded incoming request should exist after linking");
    r = await call("/api/requests/pay", { method: "POST", idem: "rq1", body: { requestId: incoming.id, pin: "4321" } });
    assert.equal(r.data.receipt.kind, "request");
    bal -= Math.round(incoming.amount * 100);
    assert.equal(r.data.receipt.balanceAfterMinor, bal);

    r = await call("/api/requests", { method: "POST", body: { amount: 450, fromName: "Rohan", note: "Dinner" } });
    assert.equal(r.data.request.status, "pending");

    // --- history reflects exactly the six settled payments ---
    r = await call("/api/payments");
    assert.equal(r.data.payments.length, 6);

    // --- account balance is exactly consistent with every debit ---
    r = await call("/api/accounts");
    assert.equal(r.data.balanceMinor, bal);

    // --- integrity: ledger, audit, readiness ---
    r = await call("/api/ledger/verify");
    assert.equal(r.data.ok, true);
    r = await call("/api/audit/verify");
    assert.equal(r.data.ok, true);
    r = await call("/api/ready");
    assert.equal(r.data.ready, true);
  });
});

test("protected endpoints reject missing or invalid tokens", async () => {
  await withServer(async ({ call }) => {
    let r = await call("/api/accounts", { auth: null });
    assert.equal(r.status, 401);
    assert.equal(r.data.error, "unauthorized");

    r = await call("/api/accounts", { auth: "tok_not_a_real_token" });
    assert.equal(r.status, 401);
    assert.equal(r.data.error, "unauthorized");
  });
});
