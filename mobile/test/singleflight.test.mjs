// singleFlight guards session renewal: the rotating refresh token is
// SINGLE-USE with reuse detection, so a duplicate renewal racing a real one
// would present an already-rotated token — which the server treats as a
// theft signal and punishes by revoking every session for the account.
// These tests pin the exact concurrency semantics the API client relies on.
import test from "node:test";
import assert from "node:assert/strict";
import { singleFlight } from "../src/singleflight.js";

const tick = () => new Promise((r) => setTimeout(r, 10));

test("concurrent callers share ONE execution and its result", async () => {
  let runs = 0;
  const fn = singleFlight(async () => {
    runs++;
    await tick();
    return "rotated-" + runs;
  });
  const [a, b, c] = await Promise.all([fn(), fn(), fn()]);
  assert.equal(runs, 1, "the operation ran exactly once");
  assert.equal(a, "rotated-1");
  assert.equal(b, "rotated-1");
  assert.equal(c, "rotated-1");
});

test("sequential calls run fresh executions", async () => {
  let runs = 0;
  const fn = singleFlight(async () => {
    runs++;
    return runs;
  });
  assert.equal(await fn(), 1);
  assert.equal(await fn(), 2, "a call AFTER settlement starts a new execution");
  assert.equal(runs, 2);
});

test("a rejection reaches every concurrent waiter, then resets", async () => {
  let runs = 0;
  const fn = singleFlight(async () => {
    runs++;
    await tick();
    if (runs === 1) throw new Error("network down");
    return "ok";
  });
  const results = await Promise.allSettled([fn(), fn()]);
  assert.equal(runs, 1, "both waiters shared the single failed execution");
  assert.ok(results.every((r) => r.status === "rejected"), "both saw the failure");
  assert.equal(await fn(), "ok", "the guard reset after the failure");
  assert.equal(runs, 2);
});

test("synchronous throw inside the operation also resets the guard", async () => {
  let runs = 0;
  const fn = singleFlight(() => {
    runs++;
    if (runs === 1) throw new Error("boom");
    return "fine";
  });
  await assert.rejects(fn());
  assert.equal(await fn(), "fine");
});
