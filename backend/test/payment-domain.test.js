// Payment-domain controls, end to end over a real socket:
// payee-name verification, beneficiary cooling, fraud scoring + review holds,
// sanctions/PEP screening, transaction monitoring + AML reporting (STR/CTR),
// source-of-funds, LRS purpose codes + documentation, device risk limits,
// disputes / refunds / chargebacks / reversals, the settlement state machine
// (pending_review / unknown / failed), authenticated PSP webhooks, PSP timeout
// recovery, reconciliation + settlement breaks, and the maker-checker ops
// back office.
import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/server.js";
import { config } from "../src/config.js";
import { signWebhook } from "../src/psp.js";
import { screenParty } from "../src/screening.js";
import { beneficiaryKey, compareNames, maskName } from "../src/risk.js";
import { AmlMonitor } from "../src/aml.js";

const OPS_TOKEN = "ops-dev-token"; // dev default (fail-closed in production)

async function withServer(opts, fn) {
  if (typeof opts === "function") { fn = opts; opts = {}; }
  const app = buildApp({ dbPath: null, ...opts });
  await new Promise((resolve) => app.server.listen(0, resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let token = null;
  const call = async (path, { method = "GET", body, idem, auth, headers: extra, raw } = {}) => {
    const headers = { "content-type": "application/json", ...(extra || {}) };
    const bearer = auth === undefined ? token : auth;
    if (bearer && !headers.authorization) headers.authorization = "Bearer " + bearer;
    if (idem) headers["idempotency-key"] = idem;
    const res = await fetch(base + path, {
      method,
      headers,
      body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
  const opsCall = (path, { method = "GET", body, actor = "maker1" } = {}) =>
    call(path, { method, body, auth: null, headers: { authorization: "Bearer " + OPS_TOKEN, "x-ops-actor": actor } });
  const setToken = (t) => (token = t);
  let n = 0;
  const onboard = async (email, amount = 100000) => {
    let r = await call("/api/auth/signup", { method: "POST", body: { fullName: "Test User", email, password: "long-enough-pw1", country: "IN", consent: true } });
    assert.equal(r.status, 200, "signup: " + JSON.stringify(r.data));
    setToken(r.data.token);
    r = await call("/api/accounts/link", { method: "POST", body: { bank: "HDFC Bank", pin: "4321" } });
    assert.equal(r.status, 200);
    r = await call("/api/topup", { method: "POST", idem: "fund-" + email, body: { amount, pin: "4321", sourceOfFunds: { type: "savings" } } });
    assert.equal(r.status, 200, "topup: " + JSON.stringify(r.data));
    return r.data.receipt.userId;
  };
  const balance = async () => (await call("/api/accounts")).data.balanceMinor;
  const payUpi = (amount, payee) =>
    call("/api/upi/pay", { method: "POST", idem: "pd-" + ++n, body: { amount, pin: "4321", payee } });
  // Maker-checker convenience: create as `maker`, approve as `checker`.
  const opsAction = async (type, params, { maker = "maker1", checker = "checker2" } = {}) => {
    let r = await opsCall("/api/ops/actions", { method: "POST", body: { type, params }, actor: maker });
    assert.equal(r.status, 200, "createAction: " + JSON.stringify(r.data));
    const id = r.data.action.id;
    r = await opsCall("/api/ops/actions/approve", { method: "POST", body: { actionId: id }, actor: checker });
    return { ...r, actionId: id };
  };
  try {
    await fn({ call, opsCall, setToken, onboard, balance, payUpi, opsAction, app });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
}

// ---------- unit: screening / names / monitoring ----------

test("screening: sanctions and PEP hits are case/space-insensitive", () => {
  assert.equal(screenParty({ name: "Rahul Verma" }).clear, true);
  const s = screenParty({ name: "  Blocked   PERSON " });
  assert.equal(s.clear, false);
  assert.equal(s.list, "sanctions");
  const p = screenParty({ name: "Prominent Politician" });
  assert.equal(p.clear, false);
  assert.equal(p.list, "pep");
  assert.equal(screenParty({ name: "" }).clear, true);
});

test("risk: name comparison, masking, beneficiary keys", () => {
  assert.equal(compareNames("Meera Joshi", "MEERA  JOSHI"), "match");
  assert.equal(compareNames("Meera K", "Meera Joshi"), "partial");
  assert.equal(compareNames("Someone Else", "Meera Joshi"), "mismatch");
  assert.equal(compareNames("X", ""), "unknown");
  const masked = maskName("Priya Sharma");
  assert.notEqual(masked, "Priya Sharma");
  assert.ok(masked.startsWith("P") && masked.includes("*"));
  // key precedence: vpa > phone > number > name
  assert.equal(beneficiaryKey({ vpa: "A@ok", phone: "9", name: "Z" }), "a@ok");
  assert.equal(beneficiaryKey({ phone: "98765", name: "Z" }), "98765");
  assert.equal(beneficiaryKey({ name: "  Asha  Rao " }), "asha rao");
});

test("aml monitor: CTR auto-files, structuring alerts, never throws", () => {
  const store = { data: { payments: {} } };
  const aml = new AmlMonitor(store, null, { ctrThresholdMinor: 1000 });
  const now = Date.now();
  aml.monitor({ userId: "u1", paymentId: "p1", kind: "payment", status: "settled", totalMinor: 1500, settledAt: now }, now);
  assert.equal(store.data.aml.reports.length, 1);
  assert.equal(store.data.aml.reports[0].type, "CTR");
  assert.ok(store.data.aml.alerts.some((a) => a.type === "ctr_threshold"));
  // structuring: 3 just-below-threshold transactions in 24h
  for (let i = 0; i < 3; i++) {
    store.data.payments["s" + i] = { userId: "u2", paymentId: "s" + i, kind: "upi", status: "settled", totalMinor: 900, settledAt: now };
  }
  aml.monitor(store.data.payments.s2, now);
  assert.ok(store.data.aml.alerts.some((a) => a.type === "structuring" && a.data.userId === "u2"));
  // monitoring never throws, even on garbage
  aml.monitor({}, now);
});

// ---------- payee-name verification ----------

test("payee-name verification: mismatch blocks until the registered name is confirmed", async () => {
  await withServer(async ({ call, onboard, payUpi, opsAction }) => {
    await onboard("payee@pd.test");
    // ops registers the bank-registered name for a VPA (maker-checker)
    const reg = await opsAction("register_payee_name", { key: "meera@okbank", name: "Meera Joshi" });
    assert.equal(reg.status, 200);
    assert.equal(reg.data.action.status, "executed");

    // verify endpoint returns only a MASKED name
    let r = await call("/api/payees/verify", { method: "POST", body: { payee: { vpa: "meera@okbank", name: "Wrong Name" } } });
    assert.equal(r.status, 200);
    assert.equal(r.data.result, "mismatch");
    assert.ok(!String(r.data.registeredName).includes("Meera Joshi"));
    assert.ok(String(r.data.registeredName).includes("*"));

    // clear mismatch is refused with a masked hint
    r = await payUpi(100, { name: "Wrong Name", vpa: "meera@okbank", type: "upi" });
    assert.equal(r.status, 409);
    assert.equal(r.data.error, "payee_name_mismatch");

    // confirming the exact registered name lets it through
    r = await payUpi(100, { name: "Wrong Name", confirmedName: "Meera Joshi", vpa: "meera@okbank", type: "upi" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.receipt.status, "settled");

    // a correct name simply matches
    r = await payUpi(50, { name: "MEERA JOSHI", vpa: "meera@okbank", type: "upi" });
    assert.equal(r.status, 200);
  });
});

// ---------- beneficiary cooling + device limits ----------

test("beneficiary cooling: new payees are capped during the cooling window", async () => {
  await withServer({ riskOptions: { coolingCapMinor: 50000 } }, async ({ onboard, payUpi }) => {
    await onboard("cooling@pd.test");
    // first payment within the ₹500 test cap is fine
    let r = await payUpi(400, { name: "Priya Nair", vpa: "priya@okbank", type: "upi" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    // the next one would exceed the cooling cap for this NEW beneficiary
    r = await payUpi(400, { name: "Priya Nair", vpa: "priya@okbank", type: "upi" });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, "beneficiary_cooling");
    // a different established flow (another payee) is unaffected by that cap
    r = await payUpi(300, { name: "Arjun Rao", vpa: "arjun@okbank", type: "upi" });
    assert.equal(r.status, 200);
  });
});

test("device risk limits: a first-day device has a daily outbound cap", async () => {
  await withServer({ riskOptions: { newDeviceDailyCapMinor: 60000 } }, async ({ call, onboard }) => {
    await onboard("device@pd.test");
    const dev = { headers: { "x-device-id": "new-phone-1" } };
    let r = await call("/api/upi/pay", { method: "POST", idem: "dv1", body: { amount: 400, pin: "4321", payee: { name: "Asha Rao", vpa: "asha@okbank", type: "upi" } }, ...dev });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.ok(r.data.receipt.deviceHash, "receipt records the device");
    r = await call("/api/upi/pay", { method: "POST", idem: "dv2", body: { amount: 300, pin: "4321", payee: { name: "Asha Rao", vpa: "asha@okbank", type: "upi" } }, ...dev });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, "new_device_limit");
    // without the device header the (test-sized) cap does not apply
    r = await call("/api/upi/pay", { method: "POST", idem: "dv3", body: { amount: 300, pin: "4321", payee: { name: "Asha Rao", vpa: "asha@okbank", type: "upi" } } });
    assert.equal(r.status, 200);
  });
});

// ---------- fraud scoring: hold / release / reject / block ----------

test("fraud hold: pending_review escrows funds; maker-checker releases or rejects", async () => {
  await withServer({ riskOptions: { reviewScore: 10 } }, async ({ call, onboard, balance, payUpi, opsCall, opsAction }) => {
    await onboard("hold@pd.test");
    const before = await balance();

    // any new-beneficiary payment now scores 25 ≥ 10 → held for review
    let r = await payUpi(300, { name: "Arjun Rao", vpa: "arjun@okbank", type: "upi" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.receipt.status, "pending_review");
    assert.ok(r.data.receipt.hold.reasons.includes("new_beneficiary"));
    const heldId = r.data.receipt.paymentId;
    assert.equal(await balance(), before - 30000, "funds are debited into escrow");

    // the hold is visible to ops
    r = await opsCall("/api/ops/holds");
    assert.equal(r.status, 200);
    assert.ok(r.data.holds.some((h) => h.paymentId === heldId));

    // self-approval is a four-eyes violation
    r = await opsCall("/api/ops/actions", { method: "POST", body: { type: "release_risk_hold", params: { paymentId: heldId } }, actor: "maker1" });
    const actionId = r.data.action.id;
    r = await opsCall("/api/ops/actions/approve", { method: "POST", body: { actionId }, actor: "maker1" });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, "four_eyes_violation");

    // a DIFFERENT checker releases it → settled, escrow cleared
    r = await opsCall("/api/ops/actions/approve", { method: "POST", body: { actionId }, actor: "checker2" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.action.status, "executed");
    r = await call("/api/payments");
    assert.equal(r.data.payments.find((p) => p.paymentId === heldId).status, "settled");

    // reject path: hold is refunded and the payment fails
    r = await payUpi(200, { name: "Kiran Rao", vpa: "kiran@okbank", type: "upi" });
    assert.equal(r.data.receipt.status, "pending_review");
    const midBal = await balance();
    const rej = await opsAction("reject_risk_hold", { paymentId: r.data.receipt.paymentId });
    assert.equal(rej.status, 200);
    assert.equal(await balance(), midBal + 20000, "rejected hold refunds the payer");
    r = await call("/api/payments");
    assert.ok(r.data.payments.some((p) => p.status === "failed" && p.failedReason === "risk_rejected"));

    // books stay clean throughout
    r = await opsCall("/api/ops/recon/run", { method: "POST" });
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true, JSON.stringify(r.data));
  });
});

test("fraud block: scores at/above the block threshold refuse the payment", async () => {
  await withServer({ riskOptions: { reviewScore: 5, blockScore: 20 } }, async ({ onboard, balance, payUpi, opsCall }) => {
    await onboard("block@pd.test");
    const before = await balance();
    const r = await payUpi(300, { name: "Arjun Rao", vpa: "arjun@okbank", type: "upi" });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, "fraud_blocked");
    assert.equal(await balance(), before, "no money moved");
    const a = await opsCall("/api/ops/alerts");
    assert.ok(a.data.alerts.some((x) => x.type === "fraud_blocked"));
  });
});

// ---------- sanctions / PEP at transaction time ----------

test("sanctions hit blocks the payment and auto-files an STR; PEP only alerts", async () => {
  await withServer(async ({ onboard, balance, payUpi, opsCall }) => {
    await onboard("sanctions@pd.test");
    const before = await balance();
    let r = await payUpi(100, { name: "Blocked Person", vpa: "bp@okbank", type: "upi" });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, "sanctions_blocked");
    assert.equal(await balance(), before);
    let o = await opsCall("/api/ops/reports");
    assert.ok(o.data.reports.some((x) => x.type === "STR"), "STR auto-filed");
    o = await opsCall("/api/ops/alerts");
    assert.ok(o.data.alerts.some((x) => x.type === "sanctions_hit"));

    // PEP: allowed, but flagged for enhanced due diligence
    r = await payUpi(100, { name: "Prominent Politician", vpa: "pep@okbank", type: "upi" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    o = await opsCall("/api/ops/alerts");
    assert.ok(o.data.alerts.some((x) => x.type === "pep_match"));
  });
});

// ---------- source of funds + LRS ----------

test("source-of-funds: large top-ups require a valid declaration", async () => {
  await withServer({ amlOptions: { sofThresholdMinor: 1000000 } }, async ({ call, onboard }) => {
    await onboard("sof@pd.test", 5000); // funding stays below the test threshold
    let r = await call("/api/topup", { method: "POST", idem: "sof1", body: { amount: 20000, pin: "4321" } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "source_of_funds_required");
    r = await call("/api/topup", { method: "POST", idem: "sof2", body: { amount: 20000, pin: "4321", sourceOfFunds: { type: "stolen" } } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "bad_source_of_funds");
    r = await call("/api/topup", { method: "POST", idem: "sof3", body: { amount: 20000, pin: "4321", sourceOfFunds: { type: "salary", note: "July payroll" } } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.receipt.sourceOfFunds.type, "salary");
  });
});

test("LRS: purpose-code catalog, documentation gate, and annual cap", async () => {
  await withServer({ amlOptions: { lrsDocThresholdMinor: 1 } }, async ({ call, onboard }) => {
    await onboard("lrs@pd.test");
    // catalog is public
    let r = await call("/api/lrs/purposes", { auth: null });
    assert.equal(r.status, 200);
    assert.ok(r.data.purposes.some((p) => p.code === "S0305"));

    const quote = async () => (await call("/api/quotes", { method: "POST", body: { currency: "AED", localAmount: 10 } })).data;
    // every cross-border payment now needs documentation (threshold = 1 minor)
    let q = await quote();
    r = await call("/api/payments", { method: "POST", idem: "lrs1", body: { quoteId: q.quoteId, pin: "4321", merchant: { name: "Al Masa", country: "AED" } } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "purpose_code_required");

    q = await quote();
    r = await call("/api/payments", { method: "POST", idem: "lrs2", body: { quoteId: q.quoteId, pin: "4321", purposeCode: "S9999", pan: "ABCDE1234F", merchant: { name: "Al Masa", country: "AED" } } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "bad_purpose_code");

    q = await quote();
    r = await call("/api/payments", { method: "POST", idem: "lrs3", body: { quoteId: q.quoteId, pin: "4321", purposeCode: "S0305", merchant: { name: "Al Masa", country: "AED" } } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "pan_required");

    q = await quote();
    r = await call("/api/payments", { method: "POST", idem: "lrs4", body: { quoteId: q.quoteId, pin: "4321", purposeCode: "S0305", pan: "ABCDE1234F", merchant: { name: "Al Masa", country: "AED" } } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.receipt.lrs.purposeCode, "S0305");
    assert.equal(r.data.receipt.lrs.panMasked, "ABC*****4F", "only a masked PAN is persisted");
  });

  // annual cap fail-closed (tiny cap ⇒ first remittance already exceeds it)
  await withServer({ amlOptions: { lrsAnnualCapMinor: 100 } }, async ({ call, onboard }) => {
    await onboard("lrscap@pd.test");
    const q = (await call("/api/quotes", { method: "POST", body: { currency: "AED", localAmount: 10 } })).data;
    const r = await call("/api/payments", { method: "POST", idem: "cap1", body: { quoteId: q.quoteId, pin: "4321", merchant: { name: "Al Masa", country: "AED" } } });
    assert.equal(r.status, 403);
    assert.equal(r.data.error, "lrs_limit_exceeded");
  });
});

// ---------- disputes / refunds / chargebacks / reversals ----------

test("disputes: open once, ops resolves with a refund through maker-checker", async () => {
  await withServer(async ({ call, onboard, balance, payUpi, opsAction }) => {
    await onboard("dispute@pd.test");
    let r = await payUpi(500, { name: "Tata Power", type: "bill" });
    const paymentId = r.data.receipt.paymentId;
    const afterPay = await balance();

    r = await call("/api/disputes", { method: "POST", body: { paymentId, reason: "charged twice" } });
    assert.equal(r.status, 200);
    assert.equal(r.data.dispute.status, "open");
    const disputeId = r.data.dispute.id;
    // duplicates are refused
    r = await call("/api/disputes", { method: "POST", body: { paymentId, reason: "again" } });
    assert.equal(r.status, 409);
    assert.equal(r.data.error, "dispute_exists");

    const res = await opsAction("resolve_dispute", { disputeId, outcome: "refund", note: "verified duplicate" });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(await balance(), afterPay + 50000, "refund restored the payer");
    r = await call("/api/disputes");
    assert.equal(r.data.disputes[0].status, "resolved");
    assert.equal(r.data.disputes[0].outcome, "refund");
    r = await call("/api/payments");
    const orig = r.data.payments.find((p) => p.paymentId === paymentId);
    assert.equal(orig.status, "refunded");
    assert.ok(r.data.payments.some((p) => p.kind === "refund" && p.parentPaymentId === paymentId));
  });
});

test("partial refunds, chargebacks, reversals — balanced and terminal", async () => {
  await withServer(async ({ call, onboard, balance, payUpi, opsAction, opsCall }) => {
    await onboard("returns@pd.test");
    let r = await payUpi(800, { name: "Airtel 9876543210", type: "recharge" });
    const payA = r.data.receipt.paymentId;
    const base = await balance();

    // partial refund: ₹300 of ₹800
    let res = await opsAction("refund", { paymentId: payA, amountMinor: 30000, reason: "partial goodwill" });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(await balance(), base + 30000);
    r = await call("/api/payments");
    assert.equal(r.data.payments.find((p) => p.paymentId === payA).status, "partially_refunded");

    // chargeback claws back the REMAINDER and is terminal
    res = await opsAction("chargeback", { paymentId: payA, reason: "issuer ruled for customer" });
    assert.equal(res.status, 200, JSON.stringify(res.data));
    assert.equal(await balance(), base + 80000, "full amount ultimately returned");
    r = await call("/api/payments");
    assert.equal(r.data.payments.find((p) => p.paymentId === payA).status, "chargeback");

    // refunding a charged-back payment fails and the failure is recorded
    res = await opsAction("refund", { paymentId: payA, reason: "should fail" });
    assert.equal(res.status, 409);
    const acts = await opsCall("/api/ops/actions");
    assert.equal(acts.data.actions.find((a) => a.id === res.actionId).status, "failed");

    // reversal: full undo of a settled payment
    r = await payUpi(200, { name: "Meera Joshi", vpa: "meera@okbank", type: "upi" });
    const payB = r.data.receipt.paymentId;
    const beforeRev = await balance();
    res = await opsAction("reverse_payment", { paymentId: payB, reason: "wrong beneficiary" });
    assert.equal(res.status, 200);
    assert.equal(await balance(), beforeRev + 20000);
    r = await call("/api/payments");
    assert.equal(r.data.payments.find((p) => p.paymentId === payB).status, "reversed");

    // ledger + books still reconcile after all returns
    const recon = await opsCall("/api/ops/recon/run", { method: "POST" });
    assert.equal(recon.data.ok, true, JSON.stringify(recon.data));
  });
});

// ---------- PSP state machine: unknown outcomes, webhooks, recovery ----------

test("PSP unknown outcome: in-doubt state, ops recovery re-query settles it", async () => {
  let mode = "unknown";
  const pspTransport = {
    settle: () => ({ status: mode, reason: mode === "unknown" ? "psp_timeout" : undefined }),
    queryStatus: () => ({ status: "settled" }),
  };
  await withServer({ pspTransport }, async ({ call, onboard, balance, payUpi, opsCall }) => {
    await onboard("psp@pd.test");
    const before = await balance();
    let r = await payUpi(400, { name: "Asha Rao", vpa: "asha@okbank", type: "upi" });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.receipt.status, "unknown", "in-doubt, not falsely settled");
    const paymentId = r.data.receipt.paymentId;
    assert.equal(await balance(), before - 40000, "debit parked in clearing:psp:pending");

    // recovery re-queries the PSP and finalizes
    r = await opsCall("/api/ops/psp/recover", { method: "POST" });
    assert.equal(r.status, 200);
    assert.equal(r.data.recovered, 1, JSON.stringify(r.data));
    r = await call("/api/payments");
    assert.equal(r.data.payments.find((p) => p.paymentId === paymentId).status, "settled");

    const recon = await opsCall("/api/ops/recon/run", { method: "POST" });
    assert.equal(recon.data.ok, true, JSON.stringify(recon.data));
  });
});

test("PSP webhooks: HMAC over raw bytes, timestamp window, replay rejection", async () => {
  const pspTransport = {
    settle: () => ({ status: "unknown", reason: "psp_timeout" }),
    queryStatus: () => ({ status: "unknown" }),
  };
  await withServer({ pspTransport }, async ({ call, onboard, balance, payUpi }) => {
    await onboard("webhook@pd.test");
    const before = await balance();
    let r = await payUpi(300, { name: "Asha Rao", vpa: "asha@okbank", type: "upi" });
    const payA = r.data.receipt.paymentId;
    r = await payUpi(200, { name: "Ravi Rao", vpa: "ravi@okbank", type: "upi" });
    const payB = r.data.receipt.paymentId;

    const hook = (bodyObj, { ts = Date.now(), sig } = {}) => {
      const raw = JSON.stringify(bodyObj);
      return call("/api/webhooks/psp", {
        method: "POST", auth: null, raw,
        headers: { "x-psp-timestamp": String(ts), "x-psp-signature": sig ?? signWebhook(config.webhookSecret, String(ts), raw) },
      });
    };

    // bad signature → 401, nothing moves
    r = await hook({ eventId: "evt_bad", type: "settlement.settled", paymentId: payA }, { sig: "0".repeat(64) });
    assert.equal(r.status, 401);
    assert.equal(r.data.error, "webhook_bad_signature");

    // stale timestamp → 401 even with a valid signature for that timestamp
    r = await hook({ eventId: "evt_old", type: "settlement.settled", paymentId: payA }, { ts: Date.now() - 3600000 });
    assert.equal(r.status, 401);
    assert.equal(r.data.error, "webhook_bad_timestamp");

    // valid settled event finalizes payment A
    r = await hook({ eventId: "evt_1", type: "settlement.settled", paymentId: payA });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.status, "settled");
    // replaying the same eventId is a no-op
    r = await hook({ eventId: "evt_1", type: "settlement.settled", paymentId: payA });
    assert.equal(r.data.replayed, true);

    // failed event refunds payment B
    r = await hook({ eventId: "evt_2", type: "settlement.failed", paymentId: payB });
    assert.equal(r.status, 200);
    assert.equal(r.data.status, "failed");
    assert.equal(await balance(), before - 30000, "only the settled payment stays debited");

    r = await call("/api/payments");
    assert.equal(r.data.payments.find((p) => p.paymentId === payA).status, "settled");
    assert.equal(r.data.payments.find((p) => p.paymentId === payB).status, "failed");
  });
});

// ---------- ops auth + reconciliation / settlement breaks ----------

test("ops endpoints: bearer + actor required; overview reports the estate", async () => {
  await withServer(async ({ call, onboard, opsCall }) => {
    await onboard("ops@pd.test");
    let r = await call("/api/ops/overview", { auth: null });
    assert.equal(r.status, 401);
    r = await call("/api/ops/overview", { auth: null, headers: { authorization: "Bearer wrong-token", "x-ops-actor": "m" } });
    assert.equal(r.status, 401);
    r = await call("/api/ops/overview", { auth: null, headers: { authorization: "Bearer " + OPS_TOKEN } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "ops_actor_required");
    r = await opsCall("/api/ops/overview");
    assert.equal(r.status, 200);
    assert.ok(r.data.paymentsByStatus);
    assert.equal(typeof r.data.openBreaks, "number");
  });
});

test("reconciliation: detects tampered balances as settlement breaks; resolvable", async () => {
  await withServer(async ({ onboard, payUpi, opsCall, app }) => {
    const userId = await onboard("recon@pd.test");
    await payUpi(100, { name: "Meera Joshi", vpa: "meera@okbank", type: "upi" });

    let r = await opsCall("/api/ops/recon/run", { method: "POST" });
    assert.equal(r.data.ok, true, "clean books reconcile");

    // simulate a settlement break: store balance drifts from the ledger
    app.store.data.accounts[userId].balanceMinor += 7;
    r = await opsCall("/api/ops/recon/run", { method: "POST" });
    assert.equal(r.data.ok, false);
    const brk = r.data.openBreaks.find((b) => b.kind === "balance_mismatch");
    assert.ok(brk, JSON.stringify(r.data));

    // running again dedupes rather than duplicating the break
    r = await opsCall("/api/ops/recon/run", { method: "POST" });
    assert.equal(r.data.openBreaks.filter((b) => b.kind === "balance_mismatch").length, 1);

    // operator fixes the drift and closes the break with a note
    app.store.data.accounts[userId].balanceMinor -= 7;
    r = await opsCall("/api/ops/recon/breaks/resolve", { method: "POST", body: { breakId: brk.id, note: "drift corrected" } });
    assert.equal(r.status, 200);
    assert.equal(r.data.break.status, "resolved");
    r = await opsCall("/api/ops/recon/run", { method: "POST" });
    assert.equal(r.data.ok, true);
  });
});
