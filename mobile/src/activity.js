// Activity search / filter / CSV export — pure JS, unit-tested in
// test/activity.test.mjs. Powers the Activity screen's search box, filter
// chips, and "Export CSV" share action.

export const ACTIVITY_FILTERS = ["all", "domestic", "international", "topup", "bills"];

export function displayName(p) {
  if (!p) return "";
  if (p.kind === "topup") return "Added to balance";
  if (p.domestic) return (p.payee && p.payee.name) || "Payment";
  if (p.kind === "p2p") return (p.recipient && p.recipient.name) || "Transfer";
  return (p.merchant && p.merchant.name) || "Merchant";
}

function searchText(p) {
  return [
    displayName(p),
    p.reference,
    p.note,
    p.kind,
    p.currency,
    p.payee && p.payee.category,
    p.payee && p.payee.vpa,
    p.payee && p.payee.phone,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function matchesFilter(p, filter) {
  switch (filter) {
    case "topup":
      return p.kind === "topup";
    case "bills":
      return p.kind === "bill" || p.kind === "recharge";
    case "domestic":
      return Boolean(p.domestic) && p.kind !== "topup";
    case "international":
      return !p.domestic && p.kind !== "topup";
    default:
      return true;
  }
}

export function filterPayments(payments, { query = "", filter = "all" } = {}) {
  const q = String(query || "").trim().toLowerCase();
  return (payments || []).filter((p) => {
    if (!matchesFilter(p, filter)) return false;
    if (!q) return true;
    return searchText(p).includes(q);
  });
}

export function csvEscape(v) {
  const s = String(v === null || v === undefined ? "" : v);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Spreadsheet-friendly export of the visible activity list.
export function buildActivityCsv(payments) {
  const header = ["Date", "Type", "Name", "Reference", "Currency", "Total (INR)", "Fee (INR)", "Status"];
  const rows = (payments || []).map((p) => [
    p.createdAt || p.ts || "",
    p.kind || (p.domestic ? "upi" : "payment"),
    displayName(p),
    p.reference || "",
    p.currency || "INR",
    p.total !== undefined ? p.total : "",
    p.fee !== undefined ? p.fee : "",
    p.status || "completed",
  ]);
  return [header, ...rows].map((r) => r.map(csvEscape).join(",")).join("\n");
}
