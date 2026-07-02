// PostgreSQL persistence tests. Run against a real database when
// BP_PG_TEST_URL is set (CI provisions one; locally e.g.
// postgres://bp:bp_test@127.0.0.1:5432/borderless). Skipped otherwise so the
// zero-dependency default workflow is unaffected.
import test from "node:test";
import assert from "node:assert/strict";

const URL = process.env.BP_PG_TEST_URL;
const opts = URL ? {} : { skip: "BP_PG_TEST_URL not set" };

async function freshDb() {
  const { PgStore } = await import("../src/store-pg.js");
  const pg = (await import("pg")).default;
  const admin = new pg.Pool({ connectionString: URL, max: 1 });
  await admin.query("DROP TABLE IF EXISTS bp_state, ledger_blocks, audit_entries CASCADE");
  await admin.end();
  return PgStore;
}

test("PG: snapshot survives a full restart (round-trip through Postgres)", opts, async () => {
  const PgStore = await freshDb();

  const s1 = await PgStore.create(URL);
  s1.data.users["usr_pg"] = { id: "usr_pg", name: "Aarav", country: "IN", kyc: { status: "verified" } };
  s1.data.accounts["usr_pg"] = { bank: "HDFC", currency: "INR", balanceMinor: 1000000 };
  s1.persist();
  await s1.close();

  const s2 = await PgStore.create(URL);
  assert.equal(s2.data.users["usr_pg"].name, "Aarav");
  assert.equal(s2.data.accounts["usr_pg"].balanceMinor, 1000000);
  await s2.close();
});

test("PG: ledger + audit are mirrored append-only, exactly once", opts, async () => {
  const PgStore = await freshDb();
  const { DualLedger } = await import("../src/ledger.js");
  const { AuditLog } = await import("../src/audit.js");
  const pg = (await import("pg")).default;

  const store = await PgStore.create(URL);
  const ledger = new DualLedger();
  const audit = new AuditLog();
  ledger.append({ type: "settlement", paymentId: "p1", legs: [
    { account: "user:u1", deltaMinor: -100 }, { account: "clearing:x", deltaMinor: 100 },
  ] });
  ledger.append({ type: "settlement", paymentId: "p2", legs: [
    { account: "user:u1", deltaMinor: -200 }, { account: "clearing:x", deltaMinor: 200 },
  ] });
  audit.append("payment_settled", { paymentId: "p1" });

  store.data.ledger = ledger.toJSON();
  store.data.audit = audit.toJSON();
  store.persist();
  store.persist(); // second persist must NOT duplicate mirror rows
  await store.flush();

  const q = new pg.Pool({ connectionString: URL, max: 1 });
  const blocks = await q.query('SELECT "index", hash FROM ledger_blocks ORDER BY "index"');
  const entries = await q.query('SELECT "index", event FROM audit_entries ORDER BY "index"');
  assert.equal(blocks.rows.length, 3, "genesis + 2 settlements");
  assert.equal(blocks.rows[1].hash, ledger.blocks[1].hash);
  assert.equal(blocks.rows[2].hash, ledger.blocks[2].hash);
  assert.equal(entries.rows.length, 2, "genesis + 1 event");
  assert.equal(entries.rows[1].event, "payment_settled");
  await q.end();
  await store.close();
});

test("PG: mirror watermark resumes across restarts (no dupes, no gaps)", opts, async () => {
  const PgStore = await freshDb();
  const { DualLedger } = await import("../src/ledger.js");
  const pg = (await import("pg")).default;

  // instance 1 writes 2 blocks
  const s1 = await PgStore.create(URL);
  const l1 = new DualLedger();
  l1.append({ type: "settlement", paymentId: "p1" });
  s1.data.ledger = l1.toJSON();
  s1.persist();
  await s1.close();

  // instance 2 loads the snapshot, appends one more block, persists
  const s2 = await PgStore.create(URL);
  const l2 = new DualLedger(s2.data.ledger);
  l2.append({ type: "settlement", paymentId: "p2" });
  s2.data.ledger = l2.toJSON();
  s2.persist();
  await s2.close();

  const q = new pg.Pool({ connectionString: URL, max: 1 });
  const rows = (await q.query('SELECT "index" FROM ledger_blocks ORDER BY "index"')).rows.map((r) => Number(r.index));
  assert.deepEqual(rows, [0, 1, 2], "contiguous, exactly-once mirror across restarts");
  await q.end();
  assert.equal(l2.verify().ok, true);
});

test("PG: full HTTP journey on Postgres, then restart — money and history intact", opts, async () => {
  const PgStore = await freshDb();
  const { buildApp } = await import("../src/server.js");

  const run = async (store, fn) => {
    const app = buildApp({ store });
    await new Promise((resolve) => app.server.listen(0, resolve));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const call = async (path, { method = "GET", body, token } = {}) => {
      const headers = { "content-type": "application/json" };
      if (token) headers.authorization = "Bearer " + token;
      const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
      return { status: res.status, data: await res.json().catch(() => ({})) };
    };
    try { return await fn(call); }
    finally {
      await new Promise((resolve) => app.server.close(resolve));
      // final durable persist, as the real shutdown path does
      store.data.ledger = app.ledger.toJSON();
      store.data.audit = app.audit.toJSON();
      store.persist();
      await store.flush();
    }
  };

  // life 1: onboard + pay
  const store1 = await PgStore.create(URL);
  const { token, totalMinor } = await run(store1, async (call) => {
    const r = await call("/api/kyc/verify", { method: "POST", body: { fullName: "Aarav Shah", documentId: "P1", country: "IN" } });
    const token = r.data.token;
    await call("/api/accounts/link", { method: "POST", body: { bank: "HDFC", pin: "4321" }, token });
    const q = await call("/api/quotes", { method: "POST", body: { currency: "AED", localAmount: 80 } });
    const p = await call("/api/payments", { method: "POST", body: { quoteId: q.data.quoteId, pin: "4321" }, token });
    assert.equal(p.data.receipt.status, "settled");
    return { token, totalMinor: p.data.receipt.totalMinor };
  });
  await store1.close();

  // life 2: fresh process, same database — session, balance, history, integrity all survive
  const store2 = await PgStore.create(URL);
  await run(store2, async (call) => {
    const acct = await call("/api/accounts", { token });
    assert.equal(acct.status, 200, "session survived the restart");
    assert.equal(acct.data.balanceMinor, 25000000 - totalMinor, "balance durable");
    const hist = await call("/api/payments", { token });
    assert.equal(hist.data.payments.length, 1, "history durable");
    const ready = await call("/api/ready");
    assert.equal(ready.status, 200, "ledger + audit integrity verified after restart");
  });
  await store2.close();
});
