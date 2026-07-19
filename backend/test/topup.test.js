// Real-data posture tests: the top-up funding flow, zero-seed guarantees, and
// the honest settlement-mode metadata. These lock in the v1.2.0 contract:
// no invented balances, no fake contacts/requests, sandbox stamped everywhere.
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
    await fn({ call, setToken, app });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
}

async function onboard(call, setToken, pin = "4321") {
  let r = await call("/api/kyc/verify", { method: "POST", body: { fullName: "Test User", documentId: "P1", country: "IN", consent: true } });
  setToken(r.data.token);
  r = await call("/api/accounts/link", { method: "POST", body: { bank: "HDFC", pin } });
  return r;
}

test("no fake data: fresh accounts start with zero balance, no requests, no payees", async () => {
  await withServer(async ({ call, setToken }) => {
    const link = await onboard(call, setToken);
    assert.equal(link.data.balance, 0, "no invented opening balance");
    let r = await call("/api/requests");
    assert.equal(r.data.requests.length, 0, "no seeded incoming requests");
    r = await call("/api/contacts");
    assert.equal(r.data.contacts.length, 0, "no fake contact directory");
    r = await call("/api/accounts");
    assert.equal(r.data.balanceMinor, 0);
  });
});

test("top-up: requires the correct PIN and rejects bad amounts", async () => {
  await withServer(async ({ call, setToken }) => {
    await onboard(call, setToken);
    let r = await call("/api/topup", { method: "POST", body: { amount: 1000, pin: "0000" } });
    assert.equal(r.status, 401);
    assert.equal(r.data.error, "bad_pin");
    r = await call("/api/topup", { method: "POST", body: { amount: -5, pin: "4321" } });
    assert.equal(r.status, 400);
    r = await call("/api/topup", { method: "POST", body: { amount: 0, pin: "4321" } });
    assert.equal(r.status, 400);
    // nothing was credited by any failed attempt
    r = await call("/api/accounts");
    assert.equal(r.data.balanceMinor, 0);
  });
});

test("top-up: books balanced double-entry legs against the funding account", async () => {
  await withServer(async ({ call, setToken, app }) => {
    await onboard(call, setToken);
    const r = await call("/api/topup", { method: "POST", body: { amount: 5000, pin: "4321" } });
    assert.equal(r.status, 200);
    const receipt = r.data.receipt;
    assert.equal(receipt.kind, "topup");
    assert.equal(receipt.settlementMode, "sandbox");
    assert.equal(receipt.balanceAfterMinor, 500000);

    // the ledger block carries zero-sum legs: funding down, user up
    const block = app.ledger.blocks[receipt.settlement.index];
    const legs = block.txn.legs;
    assert.equal(legs.reduce((s, l) => s + l.deltaMinor, 0), 0, "legs are zero-sum");
    assert.ok(legs.some((l) => l.account === "funding:sandbox" && l.deltaMinor === -500000));
    assert.ok(legs.some((l) => l.account.startsWith("user:") && l.deltaMinor === 500000));

    // integrity endpoints still pass with the new block type
    const v = await call("/api/ledger/verify");
    assert.equal(v.data.ok, true);
    const ready = await call("/api/ready");
    assert.equal(ready.data.ready, true);
  });
});

test("top-up: velocity-limited in its own daily bucket (spend limits untouched)", async () => {
  await withServer(async ({ call, setToken }) => {
    await onboard(call, setToken);
    // per-transaction cap applies (default ₹2,00,000)
    let r = await call("/api/topup", { method: "POST", body: { amount: 200001, pin: "4321" } });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, "limit_exceeded");

    // a large day of top-ups must not consume the SPENDING allowance:
    // top up ₹2,00,000 five times (₹10,00,000 = the daily total cap) …
    for (let i = 0; i < 5; i++) {
      r = await call("/api/topup", { method: "POST", body: { amount: 200000, pin: "4321" } });
      assert.equal(r.status, 200, "top-up " + i + " ok");
    }
    // …the topup bucket is now exhausted…
    r = await call("/api/topup", { method: "POST", body: { amount: 100, pin: "4321" } });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, "daily_limit");
    // …but a normal payment still goes through (separate bucket)
    r = await call("/api/upi/pay", { method: "POST", body: { amount: 500, pin: "4321", payee: { kind: "upi", type: "upi", name: "Meera", vpa: "meera@okbank" } } });
    assert.equal(r.status, 200);
  });
});

test("recent payees: derived from history, deduplicated, newest first", async () => {
  await withServer(async ({ call, setToken }) => {
    await onboard(call, setToken);
    await call("/api/topup", { method: "POST", body: { amount: 10000, pin: "4321" } });
    await call("/api/upi/pay", { method: "POST", body: { amount: 100, pin: "4321", payee: { kind: "upi", type: "upi", name: "Meera Joshi", vpa: "meera@okbank" } } });
    await call("/api/upi/pay", { method: "POST", body: { amount: 200, pin: "4321", payee: { kind: "upi", type: "phone", name: "Arjun Rao", phone: "+91 90000 00001" } } });
    // paying Meera again must not duplicate her
    await call("/api/upi/pay", { method: "POST", body: { amount: 50, pin: "4321", payee: { kind: "upi", type: "upi", name: "Meera Joshi", vpa: "meera@okbank" } } });
    // bills and top-ups are not people
    await call("/api/bills/pay", { method: "POST", body: { amount: 900, pin: "4321", biller: { category: "Electricity", name: "Tata Power", consumerId: "C1" } } });

    const r = await call("/api/contacts");
    const names = r.data.contacts.map((c) => c.name);
    assert.deepEqual(names, ["Meera Joshi", "Arjun Rao"], "deduped, newest first");
    assert.ok(!names.includes("Tata Power"), "billers excluded");
    assert.ok(!names.includes("Borderless balance"), "top-ups excluded");
    assert.equal(r.data.contacts[0].initials, "MJ");
  });
});

test("payees are per-user: one user's history never leaks into another's", async () => {
  await withServer(async ({ call, setToken }) => {
    await onboard(call, setToken);
    await call("/api/topup", { method: "POST", body: { amount: 1000, pin: "4321" } });
    await call("/api/upi/pay", { method: "POST", body: { amount: 100, pin: "4321", payee: { kind: "upi", type: "upi", name: "Meera Joshi", vpa: "meera@okbank" } } });

    // second, unrelated user
    await onboard(call, setToken, "5711");
    const r = await call("/api/contacts");
    assert.equal(r.data.contacts.length, 0, "fresh user sees no one else's payees");
  });
});

test("/api/meta: public, honest settlement-mode disclosure", async () => {
  await withServer(async ({ call }) => {
    const r = await call("/api/meta", { auth: null });
    assert.equal(r.status, 200);
    assert.equal(r.data.settlementMode, "sandbox");
    assert.equal(r.data.kycProvider, "sandbox");
    assert.ok(r.data.policies.tos, "policy versions advertised");
  });
});

test("insufficient funds: an unfunded account cannot pay anything", async () => {
  await withServer(async ({ call, setToken }) => {
    await onboard(call, setToken);
    const r = await call("/api/upi/pay", { method: "POST", body: { amount: 100, pin: "4321", payee: { kind: "upi", type: "upi", name: "X", vpa: "x@bank" } } });
    assert.equal(r.status, 402);
    assert.equal(r.data.error, "insufficient_funds");
  });
});
