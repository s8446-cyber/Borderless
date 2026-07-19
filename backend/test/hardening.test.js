// Platform-hardening regression tests (G-1, G-2, G-5):
//   G-1 — quotes are persisted in the store: they survive a process restart and
//         expired quotes are actively swept.
//   G-2 — sessions can be explicitly revoked (logout) and expired sessions are
//         garbage-collected by the maintenance sweep, not just lazily on touch.
//   G-5 — every ledger entry books balanced double-entry legs; the zero-sum
//         invariant is enforced at append time and re-checked by verify();
//         balances() folds legs into reconcilable per-account balances.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Store } from "../src/store.js";
import { DualLedger } from "../src/ledger.js";
import { PaymentService } from "../src/payments.js";
import { hashPin } from "../src/auth.js";
import { buildApp } from "../src/server.js";

function seedUser(store, id, balanceMinor, pin) {
  store.data.users[id] = { id, name: "Aarav", country: "IN", kyc: { status: "verified" } };
  store.data.accounts[id] = { bank: "HDFC", currency: "INR", balanceMinor };
  store.data.pins[id] = hashPin(pin);
}

// ---------- G-1: persistent quotes ----------

test("G-1: quote survives a process restart (file-backed store)", () => {
  const dir = mkdtempSync(join(tmpdir(), "bp-hardening-"));
  const dbPath = join(dir, "db.json");
  try {
    // process #1: seed user, create a quote, persist
    const store1 = new Store(dbPath);
    const svc1 = new PaymentService(store1, new DualLedger());
    seedUser(store1, "usr_restart", 1000000, "4321");
    store1.persist();
    const q = svc1.quote("AED", 80);

    // process #2: fresh Store + PaymentService from the same file — the quote
    // must still be executable (previously it lived only in a process Map)
    const store2 = new Store(dbPath);
    const svc2 = new PaymentService(store2, new DualLedger());
    const out = svc2.execute({ userId: "usr_restart", quoteId: q.quoteId, pin: "4321" });
    assert.equal(out.receipt.status, "settled");
    assert.equal(store2.data.accounts["usr_restart"].balanceMinor, 1000000 - q.totalMinor);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("G-1: expired quotes are swept and cannot be executed", () => {
  const store = new Store(null);
  const svc = new PaymentService(store, new DualLedger());
  seedUser(store, "u", 1000000, "1111");

  const q = svc.quote("AED", 80);
  // force-expire the stored quote
  store.data.quotes[q.quoteId].expiresAt = Date.now() - 1;

  assert.throws(
    () => svc.execute({ userId: "u", quoteId: q.quoteId, pin: "1111" }),
    (e) => e.code === "quote_expired"
  );

  const removed = svc.sweepQuotes();
  assert.ok(removed >= 1, "expired quote removed by sweep");
  assert.equal(store.data.quotes[q.quoteId], undefined);
});

test("G-1: a consumed quote is deleted from the store (no reuse)", () => {
  const store = new Store(null);
  const svc = new PaymentService(store, new DualLedger());
  seedUser(store, "u", 1000000, "1111");
  const q = svc.quote("AED", 10);
  assert.ok(store.data.quotes[q.quoteId], "quote persisted on creation");
  svc.execute({ userId: "u", quoteId: q.quoteId, pin: "1111" });
  assert.equal(store.data.quotes[q.quoteId], undefined, "quote consumed after settlement");
  assert.throws(
    () => svc.execute({ userId: "u", quoteId: q.quoteId, pin: "1111" }),
    (e) => e.code === "quote_expired"
  );
});

// ---------- G-5: double-entry ledger legs ----------

test("G-5: cross-border payment books balanced legs (user / clearing / fees)", () => {
  const store = new Store(null);
  const ledger = new DualLedger();
  const svc = new PaymentService(store, ledger);
  seedUser(store, "usr_legs", 1000000, "4321");

  const q = svc.quote("AED", 80);
  svc.execute({ userId: "usr_legs", quoteId: q.quoteId, pin: "4321" });

  const bal = ledger.balances();
  assert.equal(bal["user:usr_legs"], -q.totalMinor);
  assert.equal(bal["clearing:intl:AED"], q.amountMinor);
  assert.equal(bal["revenue:fees"], q.feeMinor);
  // reconciliation invariant: everything sums to exactly zero
  const grandTotal = Object.values(bal).reduce((s, v) => s + v, 0);
  assert.equal(grandTotal, 0);
  assert.equal(ledger.verify().ok, true);
});

test("G-5: domestic payment books zero-fee balanced legs", () => {
  const store = new Store(null);
  const ledger = new DualLedger();
  const svc = new PaymentService(store, ledger);
  seedUser(store, "usr_dom", 500000, "4321");

  svc.payDomestic({ userId: "usr_dom", pin: "4321", amountINR: 250, payee: { name: "Priya" }, kind: "upi" });

  const bal = ledger.balances();
  assert.equal(bal["user:usr_dom"], -25000);
  assert.equal(bal["clearing:domestic:upi"], 25000);
  assert.equal(bal["revenue:fees"], undefined, "no fee leg for zero-fee domestic");
  assert.equal(Object.values(bal).reduce((s, v) => s + v, 0), 0);
});

test("G-5: unbalanced legs are rejected at append time", () => {
  const l = new DualLedger();
  assert.throws(
    () => l.append({ type: "settlement", legs: [
      { account: "user:u1", deltaMinor: -100 },
      { account: "clearing:x", deltaMinor: 99 }, // off by one — must never enter the chain
    ] }),
    /unbalanced ledger entry/
  );
  assert.throws(
    () => l.append({ type: "settlement", legs: [{ account: "user:u1", deltaMinor: 0 }] }),
    /unbalanced ledger entry/
  );
  // well-formed legs are accepted
  const { block } = l.append({ type: "settlement", legs: [
    { account: "user:u1", deltaMinor: -100 },
    { account: "clearing:x", deltaMinor: 100 },
  ] });
  assert.ok(block.hash);
  assert.equal(l.verify().ok, true);
});

test("G-5: verify() flags a chain whose persisted legs were malformed", () => {
  const l = new DualLedger();
  l.append({ type: "settlement", legs: [
    { account: "user:u1", deltaMinor: -100 },
    { account: "clearing:x", deltaMinor: 100 },
  ] });
  // simulate a corrupted/hand-edited store: rewrite legs AND recompute nothing —
  // hash check fires first; but even a re-hashed chain with bad legs must fail.
  const raw = l.toJSON();
  raw.blocks[1].txn.legs[1].deltaMinor = 999;
  const reloaded = new DualLedger(raw);
  assert.equal(reloaded.verify().ok, false);
});

// ---------- G-2: session lifecycle over real HTTP ----------

async function withServer(fn) {
  const app = buildApp({ dbPath: null });
  await new Promise((resolve) => app.server.listen(0, resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path, { method = "GET", body, token } = {}) => {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = "Bearer " + token;
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
  try {
    await fn({ call, app });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
}

test("G-2: logout revokes the session token immediately", async () => {
  await withServer(async ({ call }) => {
    let r = await call("/api/kyc/verify", { method: "POST", body: { fullName: "Aarav Shah", documentId: "P1", country: "IN", consent: true } });
    assert.equal(r.status, 200);
    const token = r.data.token;

    r = await call("/api/accounts/link", { method: "POST", body: { bank: "HDFC", pin: "4321" }, token });
    assert.equal(r.status, 200);

    r = await call("/api/logout", { method: "POST", token });
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);

    // the token is dead server-side — every authed route must now 401
    r = await call("/api/accounts", { token });
    assert.equal(r.status, 401);
  });
});

test("G-2: maintenance sweep garbage-collects expired sessions and quotes", async () => {
  await withServer(async ({ call, app }) => {
    const r = await call("/api/kyc/verify", { method: "POST", body: { fullName: "Aarav Shah", documentId: "P1", country: "IN", consent: true } });
    const token = r.data.token;
    assert.ok(app.store.data.sessions[token]);

    const q = await call("/api/quotes", { method: "POST", body: { currency: "AED", localAmount: 10 } });
    assert.ok(app.store.data.quotes[q.data.quoteId]);

    // nothing expired yet → sweep removes nothing
    let swept = app.sweepExpired();
    assert.equal(swept.sessions, 0);
    assert.equal(swept.quotes, 0);

    // force-expire both, then sweep
    app.store.data.sessions[token].exp = Date.now() - 1;
    app.store.data.quotes[q.data.quoteId].expiresAt = Date.now() - 1;
    swept = app.sweepExpired();
    assert.equal(swept.sessions, 1);
    assert.equal(swept.quotes, 1);
    assert.equal(app.store.data.sessions[token], undefined);
    assert.equal(app.store.data.quotes[q.data.quoteId], undefined);
  });
});

test("G-2: sweep GCs idempotency keys 24h after settlement — fresh keys still dedupe", async () => {
  await withServer(async ({ call, app }) => {
    const r = await call("/api/kyc/verify", { method: "POST", body: { fullName: "Aarav Shah", documentId: "P1", country: "IN", consent: true } });
    const token = r.data.token;
    await call("/api/accounts/link", { method: "POST", body: { bank: "HDFC", pin: "4321" }, token });
    await call("/api/topup", { method: "POST", body: { amount: 200000, pin: "4321" }, token });

    const base = Object.keys(app.store.data.idempotency).length;
    const pay = async (idem) => {
      const q = await call("/api/quotes", { method: "POST", body: { currency: "AED", localAmount: 10 } });
      const res = await fetch(`http://127.0.0.1:${app.server.address().port}/api/payments`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + token, "idempotency-key": idem },
        body: JSON.stringify({ quoteId: q.data.quoteId, pin: "4321" }),
      });
      return res.json();
    };

    const first = await pay("fresh-key");
    assert.equal(Object.keys(app.store.data.idempotency).length, base + 1);

    // a fresh key survives the sweep AND still deduplicates
    let swept = app.sweepExpired();
    assert.equal(swept.idem, 0, "fresh idempotency key kept");
    const replay = await pay("fresh-key");
    assert.equal(replay.replayed, true, "dedupe still works after sweep");
    assert.equal(replay.receipt.paymentId, first.receipt.paymentId);

    // age the payment past the retention window → key is GC'd, receipt remains
    const paymentId = first.receipt.paymentId;
    app.store.data.payments[paymentId].settledAt = Date.now() - 86400001;
    swept = app.sweepExpired();
    assert.equal(swept.idem, 1, "expired idempotency key removed");
    assert.equal(Object.keys(app.store.data.idempotency).length, base);
    assert.ok(app.store.data.payments[paymentId], "the receipt itself is permanent");
  });
});
