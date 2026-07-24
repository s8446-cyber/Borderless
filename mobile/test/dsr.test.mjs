// Tests for the DSR client helpers (src/dsr.js) — the pure logic behind the
// "Privacy & your data" section of the Help screen.
import test from "node:test";
import assert from "node:assert/strict";
import { summarizeExport, buildExportShareText } from "../src/dsr.js";

const SAMPLE = {
  format: "borderless-pay/dsr-export/v1",
  exportedAt: "2026-07-24T00:00:00.000Z",
  profile: { userId: "u1", name: "Asha", email: "asha@example.com", country: "IN" },
  payments: [{ id: "p1" }, { id: "p2" }],
  moneyRequests: [{ id: "r1" }],
  disputes: [],
  devices: [{ deviceHash: "d1" }],
  sessions: [{ createdAt: null }],
};

test("summarizeExport counts every collection and tolerates gaps", () => {
  const s = summarizeExport(SAMPLE);
  assert.equal(s.counts.payments, 2);
  assert.equal(s.counts.moneyRequests, 1);
  assert.equal(s.counts.disputes, 0);
  assert.equal(s.counts.devices, 1);
  assert.equal(s.counts.sessions, 1);
  assert.equal(s.name, "Asha");
  assert.equal(s.email, "asha@example.com");
  assert.equal(s.exportedAt, "2026-07-24T00:00:00.000Z");
  // A malformed/empty payload must not throw — the screen just shows zeros.
  const empty = summarizeExport(null);
  assert.equal(empty.counts.payments, 0);
  assert.equal(empty.name, null);
  assert.equal(empty.exportedAt, null);
});

test("buildExportShareText embeds the full JSON verbatim after the summary", () => {
  const text = buildExportShareText(SAMPLE);
  assert.ok(text.startsWith("Borderless Pay \u2014 your data export"));
  assert.ok(text.includes("Exported at: 2026-07-24T00:00:00.000Z"));
  assert.ok(text.includes("Name: Asha"));
  assert.ok(text.includes("Payments: 2 \u00b7 Requests: 1 \u00b7 Disputes: 0"));
  assert.ok(text.includes("Devices: 1 \u00b7 Sessions: 1"));
  // Everything from the first brace onward must parse back to the exact input
  // — the share sheet hands the user a faithful machine-readable copy.
  const jsonPart = text.slice(text.indexOf("{"));
  assert.deepEqual(JSON.parse(jsonPart), SAMPLE);
});
