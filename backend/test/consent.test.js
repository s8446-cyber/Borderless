// Consent & data-rights tests (DPDP Act 2023 architecture):
//   - account creation is REFUSED without explicit consent, and the accepted
//     policy versions are recorded on the user + in the audit log
//   - policy documents are served; /api/policies exposes current versions
//   - account closure (consent withdrawal): profile PII erased, credentials
//     gone, all sessions revoked — while pseudonymous transaction records and
//     ledger integrity are preserved (PMLA-style retention).
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

test("consent: account creation is refused without it, recorded with it", async () => {
  await withServer(async ({ call, app }) => {
    // signup without consent is refused
    let r = await call("/api/auth/signup", { method: "POST", body: { email: "c@d.com", password: "long-enough-pw1", fullName: "C D" } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "consent_required");

    // versioned consent is recorded on the user
    r = await call("/api/auth/signup", { method: "POST", body: { email: "c@d.com", password: "long-enough-pw1", fullName: "C D", consent: { tosVersion: "1.0", privacyVersion: "1.0" } } });
    assert.equal(r.status, 200);
    const user = app.store.data.users[r.data.userId];
    assert.equal(user.consent.tosVersion, "1.0");
    assert.equal(user.consent.privacyVersion, "1.0");
    assert.ok(user.consent.acceptedAt > 0);

    // the audit log carries the consent versions (tamper-evident record)
    const consentAudits = app.audit.entries.filter((e) => e.data && e.data.consent);
    assert.ok(consentAudits.length >= 1, "consent recorded in the audit chain");
  });
});

test("consent: policy documents served + versions endpoint", async () => {
  await withServer(async ({ call }) => {
    const pol = await call("/api/policies");
    assert.equal(pol.status, 200);
    assert.equal(pol.data.versions.tos, "1.0");
    assert.equal(pol.data.documents.privacy, "/privacy.html");

    const privacy = await call("/privacy.html", { raw: true });
    assert.equal(privacy.status, 200);
    assert.match(privacy.text, /Privacy Policy/);
    assert.match(privacy.text, /Data Fiduciary/);
    const terms = await call("/terms.html", { raw: true });
    assert.equal(terms.status, 200);
    assert.match(terms.text, /Terms of Service/);
  });
});

test("account close: PII erased, sessions dead, ledger + pseudonymous records intact", async () => {
  await withServer(async ({ call, app }) => {
    // full life: signup → link → pay → close
    let r = await call("/api/auth/signup", { method: "POST", body: { email: "erase@me.com", password: "long-enough-pw1", fullName: "Erase Me", consent: true } });
    const token = r.data.token;
    const userId = r.data.userId;
    await call("/api/accounts/link", { method: "POST", body: { bank: "HDFC", pin: "4321" }, token });
    await call("/api/topup", { method: "POST", body: { amount: 200000, pin: "4321" }, token });
    const pay = await call("/api/upi/pay", { method: "POST", body: { amount: 100, pin: "4321", payee: { name: "X", kind: "upi" } }, token });
    assert.equal(pay.status, 200);
    const paymentId = pay.data.receipt.paymentId;

    // closure is a destructive, irreversible action — it now requires re-auth
    r = await call("/api/account/close", { method: "POST", body: { password: "long-enough-pw1" }, token });
    assert.equal(r.status, 200);
    assert.ok(r.data.ok);

    // profile PII gone
    const shell = app.store.data.users[userId];
    assert.equal(shell.closed, true);
    assert.equal(shell.name, undefined, "name erased");
    assert.equal(shell.email, undefined, "email erased");
    assert.equal(app.store.data.credentials["erase@me.com"], undefined, "credentials erased");
    assert.equal(app.store.data.pins[userId], undefined, "PIN hash erased");
    assert.equal(app.store.data.accounts[userId], undefined, "bank link erased");

    // every session dead
    const after = await call("/api/accounts", { token });
    assert.equal(after.status, 401, "sessions revoked");
    const login = await call("/api/auth/login", { method: "POST", body: { email: "erase@me.com", password: "long-enough-pw1" } });
    assert.equal(login.status, 401, "closed account cannot log in");

    // pseudonymous transaction record retained; chains still verify
    assert.ok(app.store.data.payments[paymentId], "transaction record retained (PMLA retention)");
    assert.equal((await call("/api/ledger/verify")).data.ok, true);
    assert.equal((await call("/api/audit/verify")).data.ok, true);

    // a closed account cannot transact even with a forged session shell
    // (kyc status is gone from the pseudonymous shell)
    assert.equal(shell.kyc, undefined);
  });
});
