import test from "node:test";
import assert from "node:assert/strict";
import { filterPayments, buildActivityCsv, csvEscape, matchesFilter, displayName } from "../src/activity.js";

const PAYMENTS = [
  { paymentId: "p1", kind: "p2p", domestic: true, payee: { name: "Ravi", vpa: "ravi@upi" }, reference: "REF001", total: 500, fee: 0, currency: "INR", status: "completed" },
  { paymentId: "p2", kind: "p2p", domestic: false, recipient: { name: "Priya" }, currency: "AED", total: 2000, fee: 50, reference: "REF002", status: "completed" },
  { paymentId: "p3", kind: "topup", domestic: true, total: 1000, fee: 0, currency: "INR", status: "completed" },
  { paymentId: "p4", kind: "bill", domestic: true, payee: { name: "Tata Power", category: "Electricity" }, total: 850, fee: 0, currency: "INR", status: "completed" },
  { paymentId: "p5", kind: "recharge", domestic: true, payee: { name: "Airtel" }, total: 299, fee: 0, currency: "INR", status: "completed" },
];

test("filterPayments: all returns every item", () => {
  assert.equal(filterPayments(PAYMENTS, { filter: "all" }).length, 5);
});

test("filterPayments: domestic excludes topup and international", () => {
  const r = filterPayments(PAYMENTS, { filter: "domestic" });
  assert.ok(r.every((p) => p.domestic && p.kind !== "topup"));
  assert.ok(r.map((p) => p.paymentId).includes("p1"));
  assert.ok(!r.map((p) => p.paymentId).includes("p2"));
  assert.ok(!r.map((p) => p.paymentId).includes("p3"));
});

test("filterPayments: international", () => {
  const r = filterPayments(PAYMENTS, { filter: "international" });
  assert.deepEqual(r.map((p) => p.paymentId), ["p2"]);
});

test("filterPayments: topup", () => {
  const r = filterPayments(PAYMENTS, { filter: "topup" });
  assert.deepEqual(r.map((p) => p.paymentId), ["p3"]);
});

test("filterPayments: bills includes bill and recharge", () => {
  const r = filterPayments(PAYMENTS, { filter: "bills" });
  assert.deepEqual(r.map((p) => p.paymentId).sort(), ["p4", "p5"]);
});

test("filterPayments: query matches on name", () => {
  const r = filterPayments(PAYMENTS, { query: "ravi" });
  assert.deepEqual(r.map((p) => p.paymentId), ["p1"]);
});

test("filterPayments: query matches on category", () => {
  const r = filterPayments(PAYMENTS, { query: "electricity" });
  assert.deepEqual(r.map((p) => p.paymentId), ["p4"]);
});

test("filterPayments: query + filter combined", () => {
  const r = filterPayments(PAYMENTS, { query: "airtel", filter: "bills" });
  assert.deepEqual(r.map((p) => p.paymentId), ["p5"]);
  // airtel present but filter=domestic would exclude it if we also filter
  const r2 = filterPayments(PAYMENTS, { query: "airtel", filter: "international" });
  assert.equal(r2.length, 0);
});

test("filterPayments: empty/null inputs don't throw", () => {
  assert.deepEqual(filterPayments(null), []);
  assert.deepEqual(filterPayments([], {}), []);
});

test("csvEscape: quotes and escapes fields with commas and quotes", () => {
  assert.equal(csvEscape("simple"), "simple");
  assert.equal(csvEscape("with, comma"), '"with, comma"');
  assert.equal(csvEscape('say "hi"'), '"say \"\"hi\"\""');
  assert.equal(csvEscape(null), "");
  assert.equal(csvEscape(undefined), "");
});

test("buildActivityCsv: produces header + correct row count", () => {
  const csv = buildActivityCsv(PAYMENTS);
  const lines = csv.split("\n");
  assert.equal(lines[0], "Date,Type,Name,Reference,Currency,Total (INR),Fee (INR),Status");
  assert.equal(lines.length, PAYMENTS.length + 1); // header + rows
});

test("buildActivityCsv: name column uses displayName helper", () => {
  const csv = buildActivityCsv([PAYMENTS[0]]);
  assert.ok(csv.includes("Ravi"));
});
