// Security-fix verification suite.
//
// Covers the fixes applied for the security review:
//   1. Session / refresh / reset tokens are stored ONLY as SHA-256 hashes.
//   2. Legacy plaintext token keys are migrated at boot.
//   3. Lockouts are scoped: login failures do not lock the payment PIN.
//   4. Authenticated password change exists and revokes other sessions.
//   5. Password reset works end-to-end with hashed token storage.
//   6. TOTP 2FA issues single-use recovery codes; disable flow exists.
//   7. Account closure requires password reauthentication.
//   8. Weak/common passwords are rejected.
//
// Each test boots its own app on an ephemeral port with an in-memory store,
// so rate limiters and lockout state never leak between tests.
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { buildApp } from "../src/server.js";
import { Store } from "../src/store.js";
import { sha256 } from "../src/ledger.js";

const PASSWORD = "Str0ng!passphrase";
const CONSENT = { consent: { tosVersion: "1.0", privacyVersion: "1.0" } };
let seq = 0;

function startApp(t, store = new Store(null)) {
  const app = buildApp({ store });
  return new Promise((resolve) => {
    app.server.listen(0, "127.0.0.1", () => {
      const base = `http://127.0.0.1:${app.server.address().port}`;
      t.after(() => new Promise((r) => app.server.close(r)));
      resolve({ app, base, store });
    });
  });
}

async function api(base, method, path, { token, body, headers } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: "Bearer " + token } : {}),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = {};
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function signup(base, overrides = {}) {
  const email = `user${++seq}.${Date.now()}@example.com`;
  const r = await api(base, "POST", "/api/auth/signup", {
    body: { email, password: PASSWORD, fullName: "Test User", country: "IN", ...CONSENT, ...overrides },
  });
  return { email, status: r.status, ...r.json };
}

// Standard TOTP (RFC 6238: HMAC-SHA1, 30s step, 6 digits) over a base32 secret.
function b32decode(s) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0, value = 0;
  const out = [];
  for (const c of String(s).replace(/=+$/, "").toUpperCase()) {
    const idx = A.indexOf(c);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpCode(secret, t = Date.now()) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = createHmac("sha1", b32decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  return (((h.readUInt32BE(o) & 0x7fffffff) % 1000000)).toString().padStart(6, "0");
}

const noPlaintextTokenKeys = (map, prefix) =>
  Object.keys(map || {}).every((k) => !k.startsWith(prefix));

// ---------------------------------------------------------------------------

test("tokens are stored only as SHA-256 hashes at rest", async (t) => {
  const { base, store } = await startApp(t);
  const s = await signup(base);
  assert.equal(s.status, 200);
  assert.ok(s.token && s.token.startsWith("tok_"), "client still receives a raw token");
  assert.ok(s.refreshToken && s.refreshToken.startsWith("rtk_"));

  // No plaintext keys at rest; hashed keys resolve.
  assert.ok(noPlaintextTokenKeys(store.data.sessions, "tok_"), "plaintext session key found at rest");
  assert.ok(noPlaintextTokenKeys(store.data.refresh, "rtk_"), "plaintext refresh key found at rest");
  assert.ok(store.data.sessions[sha256(s.token)], "session not stored under sha256(token)");
  assert.ok(store.data.refresh[sha256(s.refreshToken)], "refresh not stored under sha256(token)");

  // The raw token still authenticates.
  const me = await api(base, "GET", "/api/me", { token: s.token });
  assert.equal(me.status, 200);
  assert.equal(me.json.userId, s.userId);

  // Reset tokens are hashed at rest too (dev mode returns the raw token).
  const rr = await api(base, "POST", "/api/auth/password/reset-request", { body: { email: s.email } });
  assert.equal(rr.status, 200);
  assert.ok(rr.json.resetToken, "dev mode should return the reset token");
  assert.ok(noPlaintextTokenKeys(store.data.resets, "prt_"), "plaintext reset key found at rest");
  assert.ok(store.data.resets[sha256(rr.json.resetToken)]);

  // Refresh rotation works against hashed storage; reuse is detected.
  const r1 = await api(base, "POST", "/api/sessions/refresh", { body: { refreshToken: s.refreshToken } });
  assert.equal(r1.status, 200);
  assert.ok(r1.json.token && r1.json.refreshToken);
  const reuse = await api(base, "POST", "/api/sessions/refresh", { body: { refreshToken: s.refreshToken } });
  assert.equal(reuse.status, 401);
  assert.equal(reuse.json.error, "refresh_reused");
});

test("legacy plaintext token keys are migrated at boot", async (t) => {
  const store = new Store(null);
  const now = Date.now();
  store.data.sessions["tok_legacyplaintext"] = { userId: "usr_legacy", exp: now + 3600000, createdAt: now, deviceHash: null };
  store.data.refresh["rtk_legacyplaintext"] = { userId: "usr_legacy", deviceHash: null, exp: now + 3600000, createdAt: now };
  store.data.resets["prt_legacyplaintext"] = { email: "x@example.com", exp: now + 3600000 };

  const { base } = await startApp(t, store);
  assert.equal(store.data.sessions["tok_legacyplaintext"], undefined);
  assert.equal(store.data.refresh["rtk_legacyplaintext"], undefined);
  assert.equal(store.data.resets["prt_legacyplaintext"], undefined);
  assert.ok(store.data.sessions[sha256("tok_legacyplaintext")]);
  assert.ok(store.data.refresh[sha256("rtk_legacyplaintext")]);
  assert.ok(store.data.resets[sha256("prt_legacyplaintext")]);

  // The live client's raw token keeps working after migration.
  const me = await api(base, "GET", "/api/me", { token: "tok_legacyplaintext" });
  assert.equal(me.status, 200);
  assert.equal(me.json.userId, "usr_legacy");
});

test("lockouts are scoped: login lockout does not lock the payment PIN", async (t) => {
  const { base } = await startApp(t);
  const s = await signup(base);
  assert.equal(s.status, 200);

  // Link a bank account with a PIN while we still can.
  const link = await api(base, "POST", "/api/accounts/link", { token: s.token, body: { bank: "HDFC", pin: "4321" } });
  assert.equal(link.status, 200);

  // Exhaust the login lockout with bad passwords.
  for (let i = 0; i < 5; i++) {
    const r = await api(base, "POST", "/api/auth/login", { body: { email: s.email, password: "Wrong!passphrase" } });
    assert.notEqual(r.status, 200);
  }
  // Even the CORRECT password is now refused: login scope is locked.
  const locked = await api(base, "POST", "/api/auth/login", { body: { email: s.email, password: PASSWORD } });
  assert.notEqual(locked.status, 200, "login should be locked after 5 failures");
  assert.ok([423, 429, 401, 403].includes(locked.status));

  // But the PIN scope is independent: a topup with the correct PIN succeeds
  // on the still-valid session.
  const topup = await api(base, "POST", "/api/topup", {
    token: s.token,
    body: { pin: "4321", amount: 100 },
    headers: { "idempotency-key": "lockout-scope-test-1" },
  });
  assert.equal(topup.status, 200, `PIN scope must not be locked by login failures (got ${topup.status}: ${JSON.stringify(topup.json)})`);
  assert.ok(topup.json.receipt);
});

test("authenticated password change revokes other sessions", async (t) => {
  const { base } = await startApp(t);
  const s = await signup(base); // session A
  const loginB = await api(base, "POST", "/api/auth/login", { body: { email: s.email, password: PASSWORD } });
  assert.equal(loginB.status, 200); // session B

  // Wrong current password is refused.
  const bad = await api(base, "POST", "/api/auth/password/change", {
    token: s.token, body: { currentPassword: "Wrong!passphrase", newPassword: "N3w!passphrase-ok" },
  });
  assert.equal(bad.status, 401);

  // Same-password change is refused.
  const same = await api(base, "POST", "/api/auth/password/change", {
    token: s.token, body: { currentPassword: PASSWORD, newPassword: PASSWORD },
  });
  assert.equal(same.status, 400);
  assert.equal(same.json.error, "same_password");

  // Correct change succeeds and revokes the OTHER session.
  const ok = await api(base, "POST", "/api/auth/password/change", {
    token: s.token, body: { currentPassword: PASSWORD, newPassword: "N3w!passphrase-ok" },
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.json.revokedOtherSessions >= 1);

  const meA = await api(base, "GET", "/api/me", { token: s.token });
  assert.equal(meA.status, 200, "the session that changed the password must survive");
  const meB = await api(base, "GET", "/api/me", { token: loginB.json.token });
  assert.equal(meB.status, 401, "other sessions must be revoked");

  const oldLogin = await api(base, "POST", "/api/auth/login", { body: { email: s.email, password: PASSWORD } });
  assert.equal(oldLogin.status, 401);
  const newLogin = await api(base, "POST", "/api/auth/login", { body: { email: s.email, password: "N3w!passphrase-ok" } });
  assert.equal(newLogin.status, 200);
});

test("password reset works end-to-end with hashed token storage", async (t) => {
  const { base, store } = await startApp(t);
  const s = await signup(base);

  const rr = await api(base, "POST", "/api/auth/password/reset-request", { body: { email: s.email } });
  assert.equal(rr.status, 200);
  const token = rr.json.resetToken;
  assert.ok(token && token.startsWith("prt_"));
  assert.ok(noPlaintextTokenKeys(store.data.resets, "prt_"));

  const done = await api(base, "POST", "/api/auth/password/reset", { body: { token, newPassword: "R3set!passphrase" } });
  assert.equal(done.status, 200);

  // Reset revokes every session and the token is single-use.
  const me = await api(base, "GET", "/api/me", { token: s.token });
  assert.equal(me.status, 401);
  const replay = await api(base, "POST", "/api/auth/password/reset", { body: { token, newPassword: "An0ther!passphrase" } });
  assert.equal(replay.status, 401);

  const login = await api(base, "POST", "/api/auth/login", { body: { email: s.email, password: "R3set!passphrase" } });
  assert.equal(login.status, 200);
});

test("2FA: recovery codes issued on enable, single-use at login, disable flow", async (t) => {
  const { base } = await startApp(t);
  const s = await signup(base);

  const setup = await api(base, "POST", "/api/auth/2fa/setup", { token: s.token });
  assert.equal(setup.status, 200);
  const secret = setup.json.secret;
  assert.ok(secret);

  const enable = await api(base, "POST", "/api/auth/2fa/enable", { token: s.token, body: { code: totpCode(secret) } });
  assert.equal(enable.status, 200, `enable failed: ${JSON.stringify(enable.json)}`);
  const codes = enable.json.recoveryCodes;
  assert.ok(Array.isArray(codes) && codes.length === 10, "expected 10 recovery codes");
  assert.ok(codes.every((c) => /^[0-9a-f]{10}$/.test(c)));

  // Login now requires a second factor.
  const noTotp = await api(base, "POST", "/api/auth/login", { body: { email: s.email, password: PASSWORD } });
  assert.equal(noTotp.status, 401);
  assert.equal(noTotp.json.error, "totp_required");

  // A TOTP code works.
  const withTotp = await api(base, "POST", "/api/auth/login", { body: { email: s.email, password: PASSWORD, totp: totpCode(secret) } });
  assert.equal(withTotp.status, 200);

  // A recovery code works exactly once.
  const rec1 = await api(base, "POST", "/api/auth/login", { body: { email: s.email, password: PASSWORD, totp: codes[0] } });
  assert.equal(rec1.status, 200, `recovery-code login failed: ${JSON.stringify(rec1.json)}`);
  const rec1replay = await api(base, "POST", "/api/auth/login", { body: { email: s.email, password: PASSWORD, totp: codes[0] } });
  assert.equal(rec1replay.status, 401, "recovery codes must be single-use");

  // Disable requires password + a second factor (recovery code accepted).
  const disable = await api(base, "POST", "/api/auth/2fa/disable", { token: s.token, body: { password: PASSWORD, code: codes[1] } });
  assert.equal(disable.status, 200, `disable failed: ${JSON.stringify(disable.json)}`);

  const plainLogin = await api(base, "POST", "/api/auth/login", { body: { email: s.email, password: PASSWORD } });
  assert.equal(plainLogin.status, 200, "after disable, password-only login should work");
});

test("account closure requires password reauthentication", async (t) => {
  const { base } = await startApp(t);
  const s = await signup(base);

  const noPass = await api(base, "POST", "/api/account/close", { token: s.token, body: {} });
  assert.notEqual(noPass.status, 200, "closing without a password must fail");

  const wrong = await api(base, "POST", "/api/account/close", { token: s.token, body: { password: "Wrong!passphrase" } });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.json.error, "reauth_required");

  const ok = await api(base, "POST", "/api/account/close", { token: s.token, body: { password: PASSWORD } });
  assert.equal(ok.status, 200);

  const me = await api(base, "GET", "/api/me", { token: s.token });
  assert.equal(me.status, 401, "all sessions must be revoked after closure");
});

test("weak and common passwords are rejected at signup", async (t) => {
  const { base } = await startApp(t);

  const common = await signup(base, { password: "password123" });
  assert.equal(common.status, 400, "common password must be rejected");

  const repeated = await signup(base, { password: "aaaaaaaaaa" });
  assert.equal(repeated.status, 400, "repeated-character password must be rejected");

  const short = await signup(base, { password: "Ab1!x" });
  assert.equal(short.status, 400, "too-short password must be rejected");

  const good = await signup(base);
  assert.equal(good.status, 200);
});
