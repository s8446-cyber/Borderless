// Demo-state persistence: the standalone app must survive a restart with its
// wallet, PIN, history and hash-chained ledger intact — and must REFUSE a
// tampered snapshot rather than restore a corrupted wallet.
import test from "node:test";
import assert from "node:assert/strict";
import { simulate, exportDemoState, importDemoState, demoBootStatus, verifyDemoPin } from "../src/demo.js";

async function onboardAndPay() {
  await simulate("/api/kyc/verify", {
    method: "POST",
    body: { fullName: "Test User", consent: { tosVersion: "1.0", privacyVersion: "1.0" } },
  });
  await simulate("/api/accounts/link", { method: "POST", body: { bank: "HDFC Bank", pin: "2049", openingBalance: 250000 } });
  const q = await simulate("/api/quotes", { method: "POST", body: { currency: "AED", localAmount: 80 } });
  const r = await simulate("/api/payments", {
    method: "POST",
    idempotencyKey: "idem_test_1",
    body: { quoteId: q.quoteId, pin: "2049", merchant: { name: "Al Masa Restaurant", country: "AED" } },
  });
  return r.receipt;
}

test("export → import round-trip preserves wallet, history and ledger", async () => {
  await simulate("/api/logout", { method: "POST" }); // clean slate
  const receipt = await onboardAndPay();

  const snapshot = JSON.parse(JSON.stringify(exportDemoState())); // as if from disk
  await simulate("/api/logout", { method: "POST" }); // "app killed"
  assert.equal(demoBootStatus().hasUser, false);

  assert.equal(importDemoState(snapshot), true);
  const st = demoBootStatus();
  assert.equal(st.hasUser, true);
  assert.equal(st.hasAccount, true);
  assert.equal(st.name, "Test User");

  // account balance and history survived
  const acct = await simulate("/api/accounts");
  assert.equal(acct.balance, 250000 - receipt.total);
  const hist = await simulate("/api/payments");
  assert.equal(hist.payments.length, 1);
  assert.equal(hist.payments[0].paymentId, receipt.paymentId);

  // the restored hash chain still verifies, and the receipt proof still folds
  const v = await simulate("/api/ledger/verify");
  assert.equal(v.ok, true);
  const proof = await simulate("/api/ledger/proof/" + receipt.settlement.index);
  assert.equal(proof.blockHash, receipt.settlement.hash);

  // the PIN hash survived: right PIN unlocks, wrong PIN does not
  assert.equal(verifyDemoPin("2049"), true);
  assert.throws(() => verifyDemoPin("1111"), /Incorrect PIN/);
});

test("quotes are never restored (60-second, single-use)", async () => {
  await simulate("/api/logout", { method: "POST" });
  await simulate("/api/kyc/verify", {
    method: "POST",
    body: { fullName: "Quote User", consent: { tosVersion: "1.0", privacyVersion: "1.0" } },
  });
  await simulate("/api/accounts/link", { method: "POST", body: { bank: "HDFC Bank", pin: "2049" } });
  const q = await simulate("/api/quotes", { method: "POST", body: { currency: "AED", localAmount: 80 } });

  const snapshot = JSON.parse(JSON.stringify(exportDemoState()));
  assert.equal(importDemoState(snapshot), true);
  await assert.rejects(
    simulate("/api/payments", { method: "POST", body: { quoteId: q.quoteId, pin: "2049" } }),
    /Quote expired/
  );
});

test("tampered ledger in a snapshot is refused — resets to first run", async () => {
  await simulate("/api/logout", { method: "POST" });
  await onboardAndPay();
  const snapshot = JSON.parse(JSON.stringify(exportDemoState()));
  snapshot.db.chain[1].txn = { type: "settlement", forged: true }; // tamper

  assert.equal(importDemoState(snapshot), false);
  assert.equal(demoBootStatus().hasUser, false); // clean first run, not a corrupt wallet
});

test("malformed snapshots are refused", () => {
  for (const bad of [null, {}, { v: 99, db: {} }, { v: 1, db: null }, { v: 1, db: { chain: "nope" } }]) {
    assert.equal(importDemoState(bad), false);
  }
  assert.equal(demoBootStatus().hasUser, false);
});
