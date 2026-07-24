import test from "node:test";
import assert from "node:assert/strict";
import { isOnline, setOnline, subscribeOnline } from "../src/net.js";

test("starts online", () => {
  setOnline(true); // reset for test isolation
  assert.equal(isOnline(), true);
});

test("setOnline changes state and notifies subscribers", () => {
  setOnline(true);
  const events = [];
  const unsub = subscribeOnline((v) => events.push(v));
  setOnline(false);
  assert.equal(isOnline(), false);
  assert.deepEqual(events, [false]);
  setOnline(true);
  assert.equal(isOnline(), true);
  assert.deepEqual(events, [false, true]);
  unsub();
  setOnline(false);
  assert.equal(events.length, 2, "no more events after unsubscribe");
  setOnline(true); // reset
});

test("setOnline is idempotent (no duplicate events)", () => {
  setOnline(true);
  const events = [];
  const unsub = subscribeOnline((v) => events.push(v));
  setOnline(true);
  setOnline(true);
  assert.equal(events.length, 0, "same state change must not fire");
  unsub();
});

test("a broken subscriber does not stop other subscribers", () => {
  setOnline(true);
  const good = [];
  const unsub1 = subscribeOnline(() => { throw new Error("boom"); });
  const unsub2 = subscribeOnline((v) => good.push(v));
  assert.doesNotThrow(() => setOnline(false));
  assert.deepEqual(good, [false]);
  unsub1(); unsub2();
  setOnline(true); // reset
});
