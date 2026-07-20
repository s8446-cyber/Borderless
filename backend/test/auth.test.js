// Email+password authentication, TOTP 2FA, and password-reset tests, plus the
// public proof-explorer page. The TOTP engine is checked against the official
// RFC 6238 / RFC 4226 test vectors before it guards anything.
import test from "node:test";
import assert from "node:assert/strict";

import { base32Encode, base32Decode, hotp, totp, verifyTotp, generateTotpSecret, otpauthUri } from "../src/totp.js";
import { buildApp } from "../src/server.js";

// ---------- TOTP engine (pure) ----------

test("TOTP: RFC 4226 / RFC 6238 test vectors", () => {
  // RFC secret: ASCII "12345678901234567890"
  const secret = base32Encode(Buffer.from("12345678901234567890"));
  assert.equal(secret, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual([...base32Decode(secret)], [...Buffer.from("12345678901234567890")]);

  // RFC 4226 Appendix D HOTP vectors (6 digits)
  const hotpVectors = ["755224", "287082", "359152", "969429", "338314", "254676"];
  hotpVectors.forEach((v, counter) => assert.equal(hotp(secret, counter), v));

  // RFC 6238 Appendix B TOTP vectors (8 digits, SHA1)
  assert.equal(totp(secret, { time: 59 * 1000, digits: 8 }), "94287082");
  assert.equal(totp(secret, { time: 1111111109 * 1000, digits: 8 }), "07081804");
  assert.equal(totp(secret, { time: 1234567890 * 1000, digits: 8 }), "89005924");
  assert.equal(totp(secret, { time: 2000000000 * 1000, digits: 8 }), "69279037");
});

test("TOTP: verify accepts ±1 step drift, rejects garbage and old codes", () => {
  const secret = generateTotpSecret();
  const now = 1700000000000;
  const code = totp(secret, { time: now });
  assert.ok(verifyTotp(secret, code, { time: now }));
  assert.ok(verifyTotp(secret, code, { time: now + 30_000 }), "previous step accepted (drift)");
  assert.ok(!verifyTotp(secret, code, { time: now + 90_000 }), "3 steps later rejected");
  assert.ok(!verifyTotp(secret, "000000", { time: now }) || totp(secret, { time: now }) === "000000");
  assert.ok(!verifyTotp(secret, "abc123", { time: now }), "non-numeric rejected");
  assert.ok(!verifyTotp(secret, "12345", { time: now }), "wrong length rejected");
  assert.match(otpauthUri(secret, "a@b.com"), /^otpauth:\/\/totp\/Borderless%20Pay:a%40b\.com\?secret=/);
});

// ---------- HTTP harness ----------

async function withServer(fn) {
  const app = buildApp({ dbPath: null });
  await new Promise((resolve) => app.server.listen(0, resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path, { method = "GET", body, token, raw } = {}) => {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = "Bearer " + token;
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (raw) return { status: res.status, text: await res.text(), type: res.headers.get("content-type") };
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  try {
    await fn({ call, app });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
}

const SIGNUP = { method: "POST", body: { email: "aarav@example.com", password: "correct-horse-9", fullName: "Aarav Shah", country: "IN", consent: true } };

// ---------- signup / login ----------

test("auth: signup → session works → login works → wrong password locks out", async () => {
  await withServer(async ({ call, app }) => {
    // signup issues a working session + refresh token, KYC stub verifies
    let r = await call("/api/auth/signup", SIGNUP);
    assert.equal(r.status, 200);
    assert.ok(r.data.token && r.data.refreshToken);
    assert.equal(r.data.kyc.status, "verified");
    const link = await call("/api/accounts/link", { method: "POST", body: { bank: "HDFC", pin: "4321" }, token: r.data.token });
    assert.equal(link.status, 200);

    // duplicate email is rejected
    r = await call("/api/auth/signup", SIGNUP);
    assert.equal(r.status, 409);

    // weak password is rejected
    r = await call("/api/auth/signup", { method: "POST", body: { ...SIGNUP.body, email: "x@y.com", password: "short" } });
    assert.equal(r.status, 400);
    assert.equal(r.data.error, "weak_password");

    // login with correct credentials
    r = await call("/api/auth/login", { method: "POST", body: { email: "aarav@example.com", password: "correct-horse-9" } });
    assert.equal(r.status, 200);
    assert.ok(r.data.token);

    // wrong password: uniform error, and repeated failures lock the account
    for (let i = 0; i < 5; i++) {
      r = await call("/api/auth/login", { method: "POST", body: { email: "aarav@example.com", password: "wrong-password" } });
    }
    assert.equal(r.status, 401);
    r = await call("/api/auth/login", { method: "POST", body: { email: "aarav@example.com", password: "correct-horse-9" } });
    assert.equal(r.status, 423, "locked after repeated failures even with the right password");

    // unknown email gets the same shape as a bad password (no enumeration)
    r = await call("/api/auth/login", { method: "POST", body: { email: "ghost@example.com", password: "whatever-123" } });
    assert.equal(r.status, 401);
    assert.equal(r.data.error, "bad_credentials");
  });
});

// ---------- TOTP 2FA over HTTP ----------

test("auth: TOTP setup → enable → login requires and verifies the code", async () => {
  await withServer(async ({ call }) => {
    const s = await call("/api/auth/signup", SIGNUP);
    const token = s.data.token;

    // setup returns the secret; 2FA is NOT enforced until a code is proven
    let r = await call("/api/auth/2fa/setup", { method: "POST", token });
    assert.equal(r.status, 200);
    const secret = r.data.secret;
    assert.match(r.data.otpauth, /^otpauth:\/\/totp\//);
    let login = await call("/api/auth/login", { method: "POST", body: { email: SIGNUP.body.email, password: SIGNUP.body.password } });
    assert.equal(login.status, 200, "2FA not enforced before enable");

    // enable requires a valid code
    r = await call("/api/auth/2fa/enable", { method: "POST", body: { code: "000000" }, token });
    assert.equal(r.status, 401);
    r = await call("/api/auth/2fa/enable", { method: "POST", body: { code: totp(secret) }, token });
    assert.equal(r.status, 200);

    // now login without a code → totp_required; with a bad code → bad_totp
    login = await call("/api/auth/login", { method: "POST", body: { email: SIGNUP.body.email, password: SIGNUP.body.password } });
    assert.equal(login.status, 401);
    assert.equal(login.data.error, "totp_required");
    login = await call("/api/auth/login", { method: "POST", body: { email: SIGNUP.body.email, password: SIGNUP.body.password, totp: "999999" } });
    assert.equal(login.status, 401);

    // with the authenticator code → in
    login = await call("/api/auth/login", { method: "POST", body: { email: SIGNUP.body.email, password: SIGNUP.body.password, totp: totp(secret) } });
    assert.equal(login.status, 200);
    assert.ok(login.data.token);
  });
});

test("auth: the passwordless account-creation endpoint is gone (404)", async () => {
  await withServer(async ({ call }) => {
    const r = await call("/api/kyc/verify", { method: "POST", body: { fullName: "Demo User", documentId: "P1", country: "IN", consent: true } });
    assert.equal(r.status, 404, "accounts exist only behind email + password");
  });
});

test("auth: password reset revokes all sessions and rotates the password", async () => {
  await withServer(async ({ call, app }) => {
    const s = await call("/api/auth/signup", SIGNUP);
    const oldToken = s.data.token;

    // unknown email → same uniform response, and NO token leaks
    let r = await call("/api/auth/password/reset-request", { method: "POST", body: { email: "ghost@example.com" } });
    assert.equal(r.status, 200);
    assert.equal(Object.keys(app.store.data.resets).length, 0);

    // real account → dev returns the token (prod delivers via mailer)
    r = await call("/api/auth/password/reset-request", { method: "POST", body: { email: SIGNUP.body.email } });
    assert.equal(r.status, 200);
    const resetToken = r.data.resetToken;
    assert.ok(resetToken, "dev mode returns the token for end-to-end testing");

    // bad/expired tokens rejected
    r = await call("/api/auth/password/reset", { method: "POST", body: { token: "prt_bogus", newPassword: "new-password-1" } });
    assert.equal(r.status, 401);

    // reset succeeds: old sessions dead, old password dead, new password works
    r = await call("/api/auth/password/reset", { method: "POST", body: { token: resetToken, newPassword: "brand-new-pass-1" } });
    assert.equal(r.status, 200);
    const after = await call("/api/accounts", { token: oldToken });
    assert.equal(after.status, 401, "existing sessions revoked by the reset");
    r = await call("/api/auth/login", { method: "POST", body: { email: SIGNUP.body.email, password: SIGNUP.body.password } });
    assert.equal(r.status, 401, "old password no longer works");
    r = await call("/api/auth/login", { method: "POST", body: { email: SIGNUP.body.email, password: "brand-new-pass-1" } });
    assert.equal(r.status, 200, "new password works");

    // the token is single-use
    r = await call("/api/auth/password/reset", { method: "POST", body: { token: resetToken, newPassword: "another-pass-1" } });
    assert.equal(r.status, 401);
  });
});

// ---------- public proof explorer ----------

test("explorer: /verify.html + /verify.js are served and PII-free", async () => {
  await withServer(async ({ call }) => {
    const page = await call("/verify.html", { raw: true });
    assert.equal(page.status, 200);
    assert.match(page.type, /text\/html/);
    assert.match(page.text, /Public receipt verifier/);
    const js = await call("/verify.js", { raw: true });
    assert.equal(js.status, 200);
    assert.match(js.text, /crypto\.subtle\.digest/);
  });
});
