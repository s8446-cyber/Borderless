// HTTP integration test for the waitlist endpoint — exercises the real server
// (routing, validation, dedupe, audit, rate-limit tier) end-to-end over a socket.
import test from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/server.js";

async function withServer(fn) {
  const app = buildApp({ dbPath: null });
  await new Promise((resolve) => app.server.listen(0, resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  try {
    await fn(base, app);
  } finally {
    await new Promise((resolve) => app.server.close(resolve));
  }
}

const post = (base, email) =>
  fetch(base + "/api/waitlist", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });

test("waitlist: valid signup is stored and counted", async () => {
  await withServer(async (base, app) => {
    const res = await post(base, "Aarav@Example.com");
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.count, 1);
    // email is normalized (trimmed + lowercased) in the store
    assert.equal(app.store.data.waitlist[0].email, "aarav@example.com");
  });
});

test("waitlist: duplicate email does not double-count", async () => {
  await withServer(async (base) => {
    await post(base, "dup@example.com");
    await post(base, "DUP@example.com"); // same after normalization
    const res = await fetch(base + "/api/waitlist/count");
    const data = await res.json();
    assert.equal(data.count, 1);
  });
});

test("waitlist: invalid email is rejected with 400", async () => {
  await withServer(async (base) => {
    const res = await post(base, "not-an-email");
    const data = await res.json();
    assert.equal(res.status, 400);
    assert.equal(data.error, "bad_email");
  });
});
