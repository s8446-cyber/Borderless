// DSR (data-principal rights) client helpers — pure JS, unit-tested in
// test/dsr.test.mjs.
//
// buildExportShareText turns the machine-readable export returned by
// POST /api/account/export into the text handed to the OS share sheet:
// a short human summary followed by the full JSON payload, so the user can
// save it to Files, mail it to themselves, etc. without the app needing any
// file-system permission of its own.

export function summarizeExport(data) {
  const d = data || {};
  const counts = {
    payments: Array.isArray(d.payments) ? d.payments.length : 0,
    moneyRequests: Array.isArray(d.moneyRequests) ? d.moneyRequests.length : 0,
    disputes: Array.isArray(d.disputes) ? d.disputes.length : 0,
    devices: Array.isArray(d.devices) ? d.devices.length : 0,
    sessions: Array.isArray(d.sessions) ? d.sessions.length : 0,
  };
  const profile = d.profile || {};
  return {
    exportedAt: d.exportedAt || null,
    name: profile.name || null,
    email: profile.email || null,
    counts,
  };
}

export function buildExportShareText(data) {
  const s = summarizeExport(data);
  const lines = [
    "Borderless Pay \u2014 your data export",
    s.exportedAt ? "Exported at: " + s.exportedAt : null,
    s.name ? "Name: " + s.name : null,
    s.email ? "Email: " + s.email : null,
    "Payments: " + s.counts.payments +
      " \u00b7 Requests: " + s.counts.moneyRequests +
      " \u00b7 Disputes: " + s.counts.disputes,
    "Devices: " + s.counts.devices + " \u00b7 Sessions: " + s.counts.sessions,
    "",
    "Full machine-readable export (JSON):",
    JSON.stringify(data, null, 2),
  ].filter((l) => l !== null);
  return lines.join("\n");
}
