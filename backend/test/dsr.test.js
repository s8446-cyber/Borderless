// DSR (data-principal rights, DPDP Act 2023) tests:
//   - data-access export: password-reauthenticated, machine-readable, contains
//     everything held about the caller (profile, account incl. the decrypted
//     account number the user submitted, payments, sessions, devices) and
//     NEVER contains AML working data (PMLA tipping-off prohibition)
//   - the export is strictly scoped to the caller (no other user's data)
//   - profile correction: password-reauthenticated, re-runs KYC on identity
//     changes, and lands in the audit chain.
import test from "node:test";
import assert from "node:assert/strict";

import { buildApp } from "../src/server.js";

async function withServer(fn) {
  const app = buildApp({ dbPath: null });
  await new Promise((resolve) => app.server.listen(0, resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path, { method = "GET", body, token, raw } = {}) => {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = "Bearer " + token;
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (raw) return { status: res.status, text: await res.text() };
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  try {
    await fn({ call, app });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
}

const consent = { tosVersion: "1.0", privacyVersion: "1.0" };

test("DSR export: password-reauthenticated, machine-readable, complete, AML-free", async () => {
  await withServer(async ({ call, app }) => {
    let r = await call("/api/auth/signup", { method: "POST", body: { email: "dsr@me.com", password: "long-enough-pw1", fullName: "Data Principal", consent } });
    assert.equal(r.status, 200);
    const token = r.data.token;
    const userId = r.data.userId;
    await call("/api/accounts/link", { method: "POST", body: { bank: "HDFC", pin: "4321", accountNumber: "12345678901234" }, token });
    await call("/api/topup", { method: "POST", body: { amount: 5000, pin: "4321" }, token });
    const pay = await call("/api/upi/pay", { method: "POST", body: { amount: 100, pin: "4321", payee: { name: "Chai Point", kind: "upi" } }, token });
    assert.equal(pay.status, 200);

    // a bearer token alone is NOT enough — wrong password is refused + audited
    r = await call("/api/account/export", { method: "POST", body: { password: "totally-wrong-pw" }, token });
    assert.equal(r.status, 401);

    r = await call("/api/account/export", { method: "POST", body: { password: "long-enough-pw1" }, token });
    assert.equal(r.status, 200);
    const exp = r.data;
    assert.equal(exp.format, "borderless-pay/dsr-export/v1");
    assert.equal(exp.profile.email, "dsr@me.com");
    assert.equal(exp.profile.name, "Data Principal");
    assert.ok(exp.profile.consent, "consent record included");
    // the account number the user submitted comes back decrypted — it is THEIR data
    assert.equal(exp.account.accountNumber, "12345678901234");
    assert.equal(exp.account.bank, "HDFC");
    // transaction history included
    assert.ok(exp.payments.some((p) => p.paymentId === pay.data.receipt.paymentId), "payments included");
    // session metadata included, but never token material
    assert.ok(Array.isArray(exp.sessions) && exp.sessions.length >= 1, "session metadata included");
    assert.ok(!JSON.stringify(exp.sessions).includes(token), "no raw tokens in export");
    // AML working data is NEVER in a self-serve export (PMLA tipping-off)
    assert.ok(!("aml" in exp) && !("alerts" in exp) && !("reports" in exp), "no AML keys");
    // the access request itself is recorded in the tamper-evident audit chain
    assert.ok(app.audit.entries.some((e) => e.data && e.data.userId === userId), "export audited");
    assert.equal((await call("/api/audit/verify")).data.ok, true);
  });
});

test("DSR export: strictly scoped to the caller", async () => {
  await withServer(async ({ call }) => {
    let r = await call("/api/auth/signup", { method: "POST", body: { email: "alice.private@a.com", password: "long-enough-pw1", fullName: "Alice Privateperson", consent } });
    const tokenA = r.data.token;
    await call("/api/accounts/link", { method: "POST", body: { bank: "ICICI", pin: "1111", accountNumber: "55556666777788" }, token: tokenA });
    await call("/api/topup", { method: "POST", body: { amount: 3000, pin: "1111" }, token: tokenA });
    const payA = await call("/api/upi/pay", { method: "POST", body: { amount: 50, pin: "1111", payee: { name: "Secret Vendor", kind: "upi" } }, token: tokenA });
    assert.equal(payA.status, 200);

    r = await call("/api/auth/signup", { method: "POST", body: { email: "bob@b.com", password: "long-enough-pw2", fullName: "Bob Other", consent } });
    const tokenB = r.data.token;
    const expB = await call("/api/account/export", { method: "POST", body: { password: "long-enough-pw2" }, token: tokenB });
    assert.equal(expB.status, 200);

    const flat = JSON.stringify(expB.data);
    assert.ok(!flat.includes("alice.private@a.com"), "no other user's email");
    assert.ok(!flat.includes("Alice Privateperson"), "no other user's name");
    assert.ok(!flat.includes("55556666777788"), "no other user's account number");
    assert.ok(!flat.includes(payA.data.receipt.paymentId), "no other user's payments");
  });
});

test("DSR correction: reauthenticated profile fix re-runs KYC and is audited", async () => {
  await withServer(async ({ call, app }) => {
    let r = await call("/api/auth/signup", { method: "POST", body: { email: "fix@me.com", password: "long-enough-pw1", fullName: "Misspeled Naam", consent } });
    assert.equal(r.status, 200);
    const token = r.data.token;
    const userId = r.data.userId;

    // wrong password → refused, nothing changes
    r = await call("/api/account/profile", { method: "POST", body: { password: "wrong-password-x", fullName: "Correct Name" }, token });
    assert.equal(r.status, 401);
    assert.equal((await call("/api/me", { token })).data.name, "Misspeled Naam");

    // nothing to update → explicit 400, not a silent no-op
    r = await call("/api/account/profile", { method: "POST", body: { password: "long-enough-pw1" }, token });
    assert.equal(r.status, 400);

    // correct password → name + country fixed, KYC re-run on corrected identity
    r = await call("/api/account/profile", { method: "POST", body: { password: "long-enough-pw1", fullName: "Correct Name", country: "IN" }, token });
    assert.equal(r.status, 200);
    assert.ok(r.data.updated.includes("name"));
    assert.equal(r.data.profile.name, "Correct Name");
    assert.ok(r.data.kyc && r.data.kyc.status, "KYC re-ran and returned a status");

    const me = await call("/api/me", { token });
    assert.equal(me.data.name, "Correct Name");
    assert.ok(me.data.kyc && me.data.kyc.status, "KYC status present after correction");

    // recorded in the tamper-evident audit chain
    assert.ok(app.audit.entries.some((e) => e.data && e.data.userId === userId && Array.isArray(e.data.fields) && e.data.fields.includes("name")), "correction audited");
    assert.equal((await call("/api/audit/verify")).data.ok, true);
    assert.equal(app.store.data.users[userId].name, "Correct Name");
  });
});
