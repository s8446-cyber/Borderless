// Observability regression tests (G-7): the Metrics registry and the
// /api/metrics scrape endpoint (Prometheus text format).
import test from "node:test";
import assert from "node:assert/strict";

import { Metrics } from "../src/metrics.js";
import { buildApp } from "../src/server.js";

// ---------- unit: registry ----------

test("G-7: route normalization keeps label cardinality bounded", () => {
  const m = new Metrics();
  assert.equal(m.route("/api/ledger/proof/42"), "/api/ledger/proof/:n");
  assert.equal(m.route("/api/payments"), "/api/payments");
  assert.equal(m.route("/api/users/usr_ab12-cd34"), "/api/users/:id");
  assert.equal(m.route("/api/payments/pay_deadbeef"), "/api/payments/:id");
});

test("G-7: http + payment + rate-limit counters accumulate correctly", () => {
  const m = new Metrics();
  m.recordHttp("GET", "/api/health", 200, 3);
  m.recordHttp("GET", "/api/health", 200, 7);
  m.recordHttp("POST", "/api/payments", 402, 40);
  m.recordPayment({ kind: "payment", totalMinor: 186528, feeMinor: 928 });
  m.recordPayment({ kind: "payment", totalMinor: 100500, feeMinor: 500 });
  m.recordPayment({ kind: "upi", totalMinor: 25000, feeMinor: 0 });
  m.recordRateLimited();

  const out = m.render();
  assert.match(out, /bp_http_requests_total\{method="GET",route="\/api\/health",status="200"\} 2/);
  assert.match(out, /bp_http_requests_total\{method="POST",route="\/api\/payments",status="402"\} 1/);
  assert.match(out, /bp_payments_settled_total\{kind="payment"\} 2/);
  assert.match(out, /bp_payments_settled_total\{kind="upi"\} 1/);
  assert.match(out, /bp_payments_volume_minor_total\{kind="payment"\} 287028/);
  assert.match(out, /bp_fee_revenue_minor_total\{kind="payment"\} 1428/);
  assert.match(out, /bp_rate_limited_total 1/);
  // histogram: 3 requests total, cumulative buckets end at count
  assert.match(out, /bp_http_request_duration_ms_count 3/);
  assert.match(out, /bp_http_request_duration_ms_bucket\{le="\+Inf"\} 3/);
});

// ---------- e2e: scrape endpoint ----------

async function withServer(fn) {
  const app = buildApp({ dbPath: null });
  await new Promise((resolve) => app.server.listen(0, resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const call = async (path, { method = "GET", body, token, raw } = {}) => {
    const headers = { "content-type": "application/json" };
    if (token) headers.authorization = "Bearer " + token;
    const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (raw) return { status: res.status, text: await res.text(), type: res.headers.get("content-type") };
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  };
  try {
    await fn({ call, app });
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
}

test("G-7: /api/metrics serves Prometheus text with business + gauge series", async () => {
  await withServer(async ({ call }) => {
    // drive one real settlement so business counters move
    const r = await call("/api/auth/signup", { method: "POST", body: { fullName: "Aarav Shah", email: "m1@t.test", password: "long-enough-pw1", country: "IN", consent: true } });
    const token = r.data.token;
    await call("/api/accounts/link", { method: "POST", body: { bank: "HDFC", pin: "4321" }, token });
    await call("/api/topup", { method: "POST", body: { amount: 200000, pin: "4321" }, token });
    const q = await call("/api/quotes", { method: "POST", body: { currency: "AED", localAmount: 80 } });
    await call("/api/payments", { method: "POST", body: { quoteId: q.data.quoteId, pin: "4321" }, token });

    const m = await call("/api/metrics", { raw: true });
    assert.equal(m.status, 200);
    assert.match(m.type, /text\/plain/);
    assert.match(m.text, /bp_payments_settled_total\{kind="payment"\} 1/);
    assert.match(m.text, /bp_http_requests_total\{method="POST",route="\/api\/payments",status="200"\} 1/);
    assert.match(m.text, /bp_ledger_blocks \d+/);
    assert.match(m.text, /bp_sessions_active 1/);
    assert.match(m.text, /bp_uptime_seconds \d+/);
    // scrapes must never leak identifiers or secrets
    assert.ok(!m.text.includes("usr_") && !m.text.includes("tok_"), "no IDs/tokens in metrics");
  });
});

test("G-7: idempotent replays are excluded from settlement counters", async () => {
  await withServer(async ({ call, app }) => {
    const r = await call("/api/auth/signup", { method: "POST", body: { fullName: "Aarav Shah", email: "m2@t.test", password: "long-enough-pw1", country: "IN", consent: true } });
    const token = r.data.token;
    await call("/api/accounts/link", { method: "POST", body: { bank: "HDFC", pin: "4321" }, token });
    await call("/api/topup", { method: "POST", body: { amount: 200000, pin: "4321" }, token });
    const q = await call("/api/quotes", { method: "POST", body: { currency: "AED", localAmount: 80 } });

    const headers = { "content-type": "application/json", authorization: "Bearer " + token, "idempotency-key": "same-key" };
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const body = JSON.stringify({ quoteId: q.data.quoteId, pin: "4321" });
    await fetch(base + "/api/payments", { method: "POST", headers, body });
    await fetch(base + "/api/payments", { method: "POST", headers, body }); // replay

    const out = app.metrics.render();
    assert.match(out, /bp_payments_settled_total\{kind="payment"\} 1/, "replay not double-counted");
  });
});
