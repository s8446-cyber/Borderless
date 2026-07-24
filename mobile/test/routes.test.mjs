import test from "node:test";
import assert from "node:assert/strict";
import { backTargetFor, routeToHash, parseHash } from "../src/routes.js";

test("backTargetFor: home grid screens go back to home", () => {
  for (const s of ["send", "scanDom", "compose", "contacts", "history"]) {
    assert.equal(backTargetFor(s), "home", s);
  }
});

test("backTargetFor: txnDetail goes back to history", () => {
  assert.equal(backTargetFor("txnDetail"), "history");
});

test("backTargetFor: help returns to helpFrom or home", () => {
  assert.equal(backTargetFor("help", { helpFrom: "receipt" }), "receipt");
  assert.equal(backTargetFor("help"), "home");
});

test("backTargetFor: review back depends on domIntentKind", () => {
  assert.equal(backTargetFor("review", { domIntentKind: "payrequest" }), "home");
  assert.equal(backTargetFor("review", { domIntentKind: "upi" }), "compose");
  assert.equal(backTargetFor("review"), "compose");
});

test("backTargetFor: quote always goes back to send", () => {
  assert.equal(backTargetFor("quote", { flow: "send" }), "send");
  assert.equal(backTargetFor("quote"), "send");
});

test("backTargetFor: auth back depends on flow", () => {
  assert.equal(backTargetFor("auth", { flow: "domestic" }), "review");
  assert.equal(backTargetFor("auth", { flow: "send" }), "quote");
});

test("backTargetFor: receipt always goes home", () => {
  assert.equal(backTargetFor("receipt"), "home");
});

test("backTargetFor: settle/lock/boot return null (no back)", () => {
  assert.equal(backTargetFor("settle"), null);
  assert.equal(backTargetFor("lock"), null);
  assert.equal(backTargetFor("boot"), null);
});

test("backTargetFor: welcome/home return undefined (OS default)", () => {
  assert.equal(backTargetFor("welcome"), undefined);
  assert.equal(backTargetFor("home"), undefined);
});

test("routeToHash / parseHash round-trip for known screens", () => {
  for (const screen of ["home", "history", "help", "scanDom", "send"]) {
    const hash = routeToHash(screen);
    assert.ok(hash, screen + " has a hash");
    assert.equal(parseHash(hash), screen, screen + " round-trips");
  }
});

test("routeToHash: mid-payment screens return null (not deep-linkable)", () => {
  for (const s of ["auth", "settle", "review", "quote"]) {
    assert.equal(routeToHash(s), null, s + " must not be deep-linkable");
  }
});

test("parseHash: unknown hashes return null", () => {
  assert.equal(parseHash(""), null);
  assert.equal(parseHash("#/unknown-route"), null);
  assert.equal(parseHash("#/pay-abroad"), null);
  assert.equal(parseHash(null), null);
});
