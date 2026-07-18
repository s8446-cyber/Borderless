// Transactional email delivery tests.
//  Unit: each provider builds the right HTTPS request; failures NEVER throw
//        into the caller (a delivery failure must not become an API oracle).
//  E2E:  the full password-reset journey where the token arrives BY EMAIL
//        (captured via an injected mailer), exactly as production behaves.
import test from "node:test";
import assert from "node:assert/strict";

import { Mailer, createMailer, buildResetEmail } from "../src/mailer.js";
import { buildApp } from "../src/server.js";

const silentLog = { info: () => {}, error: () => {} };

function fakeFetch(response = { ok: true, status: 200 }) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    if (response instanceof Error) throw response;
    return response;
  };
  fn.calls = calls;
  return fn;
}

// ---------- unit: providers ----------

test("mailer: resend provider posts the right payload with bearer auth", async () => {
  const f = fakeFetch();
  const m = new Mailer({ provider: "resend", apiKey: "re_test_key", from: "Borderless Pay <no-reply@bp.app>", fetchImpl: f, log: silentLog });
  const r = await m.send({ to: "user@example.com", subject: "Hi", text: "Body" });
  assert.deepEqual(r, { sent: true, provider: "resend" });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, "https://api.resend.com/emails");
  assert.equal(f.calls[0].opts.headers.authorization, "Bearer re_test_key");
  const body = JSON.parse(f.calls[0].opts.body);
  assert.deepEqual(body.to, ["user@example.com"]);
  assert.equal(body.subject, "Hi");
  assert.equal(body.text, "Body");
  assert.equal(body.from, "Borderless Pay <no-reply@bp.app>");
});

test("mailer: sendgrid provider posts the v3 shape and parses the from address", async () => {
  const f = fakeFetch({ ok: true, status: 202 });
  const m = new Mailer({ provider: "sendgrid", apiKey: "sg_key", from: "Borderless Pay <no-reply@bp.app>", fetchImpl: f, log: silentLog });
  const r = await m.send({ to: "user@example.com", subject: "Hi", text: "Body" });
  assert.deepEqual(r, { sent: true, provider: "sendgrid" });
  assert.equal(f.calls[0].url, "https://api.sendgrid.com/v3/mail/send");
  const body = JSON.parse(f.calls[0].opts.body);
  assert.equal(body.personalizations[0].to[0].email, "user@example.com");
  assert.deepEqual(body.from, { email: "no-reply@bp.app", name: "Borderless Pay" });
  assert.equal(body.content[0].value, "Body");
});

test("mailer: console provider delivers via log without network", async () => {
  let logged = null;
  const m = new Mailer({ provider: "console", log: { info: (msg, meta) => { logged = { msg, meta }; }, error: () => {} } });
  const r = await m.send({ to: "a@b.com", subject: "S", text: "T" });
  assert.deepEqual(r, { sent: true, provider: "console" });
  assert.equal(logged.msg, "email_console_delivery");
  assert.equal(logged.meta.to, "a@b.com");
  assert.equal(logged.meta.body, "T");
});

test("mailer: provider HTTP error and network error both resolve sent:false (never throw)", async () => {
  const httpFail = new Mailer({ provider: "resend", apiKey: "k", fetchImpl: fakeFetch({ ok: false, status: 500 }), log: silentLog });
  assert.deepEqual(await httpFail.send({ to: "a@b.com", subject: "S", text: "T" }), { sent: false, provider: "resend", error: "http_500" });

  const netFail = new Mailer({ provider: "resend", apiKey: "k", fetchImpl: fakeFetch(new Error("ECONNRESET")), log: silentLog });
  const r = await netFail.send({ to: "a@b.com", subject: "S", text: "T" });
  assert.equal(r.sent, false);
  assert.equal(r.error, "network_error");
});

test("mailer: misconfiguration is fail-closed in prod, console-fallback in dev; unknown provider always fatal", () => {
  assert.throws(() => new Mailer({ provider: "resend", isProd: true, log: silentLog }), /BP_EMAIL_API_KEY/);
  const dev = new Mailer({ provider: "resend", isProd: false, log: silentLog });
  assert.equal(dev.provider, "console", "dev falls back to console transport");
  assert.throws(() => new Mailer({ provider: "pigeon", log: silentLog }), /unknown BP_EMAIL_PROVIDER/);
  const off = new Mailer({ log: silentLog });
  assert.equal(off.active, false);
});

test("mailer: reset email contains the token, the TTL, and the app origin", () => {
  const msg = buildResetEmail({ origin: "https://app.borderlesspay.app/", token: "prt_abc123", ttlMinutes: 30 });
  assert.match(msg.subject, /reset/i);
  assert.ok(msg.text.includes("prt_abc123"));
  assert.ok(msg.text.includes("30 minutes"));
  assert.ok(msg.text.includes("https://app.borderlesspay.app"), "trailing slash trimmed, origin present");
  assert.ok(!msg.text.includes("app/ "), "no double-slash artifacts");
});

test("mailer: createMailer wires config fields through", () => {
  const m = createMailer(
    { emailProvider: "resend", emailApiKey: "k", emailFrom: "X <x@y.z>", isProd: false },
    { fetchImpl: fakeFetch(), log: silentLog }
  );
  assert.equal(m.provider, "resend");
  assert.equal(m.from, "X <x@y.z>");
  assert.ok(m.active);
});

// ---------- e2e: the production-shaped reset journey ----------

async function withServer(fn, { mailer } = {}) {
  const app = buildApp({ dbPath: null, mailer });
  await new Promise((resolve) => app.server.listen(0, resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path, { method = "GET", body, token } = {}) => {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = "Bearer " + token;
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  };
  try {
    await fn({ call, app });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
}

const CONSENT = { consent: { tosVersion: "1.0", privacyVersion: "1.0" } };

test("e2e: password reset token arrives by email and completes the reset", async () => {
  const sent = [];
  const mailer = {
    active: true,
    send: async (msg) => { sent.push(msg); return { sent: true, provider: "test" }; },
  };
  await withServer(async ({ call }) => {
    const su = await call("/api/auth/signup", { method: "POST", body: { email: "reset-me@example.com", password: "correct horse battery", fullName: "Reset Me", ...CONSENT } });
    assert.equal(su.status, 200);

    const rr = await call("/api/auth/password/reset-request", { method: "POST", body: { email: "reset-me@example.com" } });
    assert.equal(rr.status, 200);

    // the token was delivered by email — extract it exactly like a user would
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "reset-me@example.com");
    const token = /prt_[0-9a-f]+/.exec(sent[0].text)?.[0];
    assert.ok(token, "reset token present in the email body");

    const done = await call("/api/auth/password/reset", { method: "POST", body: { token, newPassword: "a brand new passphrase" } });
    assert.equal(done.status, 200);

    // old password dead, new one works
    const oldLogin = await call("/api/auth/login", { method: "POST", body: { email: "reset-me@example.com", password: "correct horse battery" } });
    assert.equal(oldLogin.status, 401);
    const newLogin = await call("/api/auth/login", { method: "POST", body: { email: "reset-me@example.com", password: "a brand new passphrase" } });
    assert.equal(newLogin.status, 200);
  }, { mailer });
});

test("e2e: email delivery failure never changes the API response (no oracle)", async () => {
  const mailer = { active: true, send: async () => ({ sent: false, provider: "test", error: "http_500" }) };
  await withServer(async ({ call }) => {
    await call("/api/auth/signup", { method: "POST", body: { email: "oracle@example.com", password: "some password 123", fullName: "Oracle", ...CONSENT } });
    const known = await call("/api/auth/password/reset-request", { method: "POST", body: { email: "oracle@example.com" } });
    const unknown = await call("/api/auth/password/reset-request", { method: "POST", body: { email: "nobody@example.com" } });
    assert.equal(known.status, 200);
    assert.equal(unknown.status, 200);
    assert.deepEqual(Object.keys(known.data).filter((k) => k !== "resetToken"), Object.keys(unknown.data).filter((k) => k !== "resetToken"));
    assert.equal(known.data.ok, true);
    assert.equal(unknown.data.ok, true);
  }, { mailer });
});
