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
    let r = await call("/api/kyc/verify", { method: "POST", body: { fullName: "Aarav Shah", documentId: "P1", country: "IN", consent: true } });
    assert.equal(r.status, 200);
    assert.equal(r.data.kyc.status, "verified");
    setToken(r.data.token);

    // --- link bank: balances always start at ZERO (no invented money) ---
    r = await call("/api/accounts/link", { method: "POST", body: { bank: "HDFC Bank", pin: "4321" } });
    assert.equal(r.status, 200);
    assert.equal(r.data.balance, 0);

    // --- fund via the explicit top-up flow (the ONLY funding path) ---
    r = await call("/api/topup", { method: "POST", idem: "tp1", body: { amount: 200000, pin: "4321" } });
    assert.equal(r.status, 200);
    assert.equal(r.data.receipt.kind, "topup");
    assert.equal(r.data.receipt.settlementMode, "sandbox", "top-ups are honestly stamped sandbox");
    assert.equal(r.data.receipt.feeMinor, 0);
    let bal = 20000000; // minor units
    assert.equal(r.data.receipt.balanceAfterMinor, bal);
    // replay with the same idempotency key → no double credit
    r = await call("/api/topup", { method: "POST", idem: "tp1", body: { amount: 200000, pin: "4321" } });
    assert.equal(r.data.replayed, true);
    assert.equal(r.data.receipt.balanceAfterMinor, bal);
    // re-linking the bank must never touch an existing balance
    r = await call("/api/accounts/link", { method: "POST", body: { bank: "ICICI Bank", pin: "4321" } });
    assert.equal(r.data.balanceMinor, bal, "re-link preserves the balance");

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

    // --- collect requests: no fake seeds — a fresh account has none ---
    r = await call("/api/requests");
    assert.equal(r.data.requests.length, 0, "no seeded requests — real data only");
    r = await call("/api/requests", { method: "POST", body: { amount: 450, fromName: "Rohan", note: "Dinner" } });
    assert.equal(r.data.request.status, "pending");
    assert.equal(r.data.request.direction, "outgoing");

    // --- recent payees are derived from the user's OWN history ---
    r = await call("/api/contacts");
    const names = r.data.contacts.map((c) => c.name);
    assert.ok(names.includes("Priya"), "UPI payee appears in recent payees");
    assert.ok(names.includes("Sara"), "P2P recipient appears in recent payees");
    assert.ok(!names.includes("Tata Power"), "billers are a catalog, not payees");

    // --- history reflects the top-up + five settled payments ---
    r = await call("/api/payments");
    assert.equal(r.data.payments.length, 6);
    assert.ok(r.data.payments.every((p) => p.settlementMode === "sandbox"), "every receipt carries the settlement mode");

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

    // --- /api/ledger is unauthenticated, so it must NOT leak transaction PII ---
    r = await call("/api/ledger", { auth: null });
    assert.equal(r.status, 200);
    assert.equal(typeof r.data.head.hash, "string");
    assert.equal(typeof r.data.head.index, "number");
    assert.equal(r.data.head.txn, undefined, "ledger head must not expose transaction contents");
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
