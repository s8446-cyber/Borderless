// AML transaction monitoring, regulatory reporting (STR/CTR), source-of-funds
// checks, and LRS purpose-code enforcement for cross-border remittances.
//
// Thresholds are policy configuration (config.aml / env), not hard-coded law:
// deployments tune them to their compliance program. Defaults are chosen so
// the sandbox's per-transaction limits sit BELOW the reporting thresholds —
// raising BP_TXN_MAX_MINOR in a real deployment makes these gates live.
import { randomUUID } from "node:crypto";
import { ApiError } from "./fx.js";

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const NON_SPEND_KINDS = ["topup", "refund", "reversal", "chargeback"];

// Indicative RBI Form-A2 purpose codes for LRS outward remittances.
export const LRS_PURPOSES = {
  S0301: "Business travel",
  S0304: "Travel for medical treatment",
  S0305: "Travel for education (including fees, hostel expenses)",
  S0306: "Other travel (personal)",
  S1301: "Family maintenance and savings",
  S1302: "Personal gifts and donations",
};

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// Only a masked PAN is ever persisted ("ABC*****4F") — the full PAN is used
// for format validation and then discarded.
export function maskPan(pan) {
  const s = String(pan || "");
  return s.length === 10 ? s.slice(0, 3) + "*****" + s.slice(8) : "**********";
}

function fyStart(now) {
  const d = new Date(now);
  const year = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return Date.UTC(year, 3, 1); // Indian financial year starts 1 April
}

export class AmlMonitor {
  constructor(store, audit, opts = {}) {
    this.store = store;
    this.audit = audit || null;
    this.ctrThresholdMinor = opts.ctrThresholdMinor ?? 100000000; // ₹10,00,000 single txn
    this.structuringPct = opts.structuringPct ?? 0.8; // ≥80% of CTR threshold
    this.structuringCount = opts.structuringCount ?? 3; // ≥3 such txns in 24h
    this.velocityAlertMinor = opts.velocityAlertMinor ?? 50000000; // ₹5,00,000 outbound/day
    this.sofThresholdMinor = opts.sofThresholdMinor ?? 50000000; // ₹5,00,000 per top-up
    this.lrsDocThresholdMinor = opts.lrsDocThresholdMinor ?? 70000000; // ₹7,00,000 per remittance
    this.lrsAnnualCapMinor = opts.lrsAnnualCapMinor ?? 2100000000; // ≈ USD 250,000 equivalent
  }

  _aml() {
    const d = this.store.data;
    if (!d.aml) d.aml = { alerts: [], reports: [] };
    if (!d.aml.alerts) d.aml.alerts = [];
    if (!d.aml.reports) d.aml.reports = [];
    return d.aml;
  }

  alert(type, data) {
    const a = { id: "alr_" + randomUUID(), type, data, createdAt: Date.now(), status: "open" };
    this._aml().alerts.push(a);
    if (this.audit) this.audit.append("aml_alert", { alertId: a.id, type, userId: data && data.userId });
    return a;
  }

  // STR (suspicious transaction report) / CTR (cash/currency transaction
  // report). Sandbox marks reports "filed_sandbox"; a live deployment's
  // adapter would submit to FIU-IND and store the acknowledgement.
  fileReport(type, data, { filedBy = "system" } = {}) {
    const r = { id: "rep_" + randomUUID(), type, data, filedBy, filedAt: Date.now(), status: "filed_sandbox" };
    this._aml().reports.push(r);
    if (this.audit) this.audit.append("aml_report_filed", { reportId: r.id, type, filedBy });
    return r;
  }

  // Source-of-funds declaration required for top-ups at/above the threshold.
  checkSourceOfFunds({ amountMinor, sourceOfFunds }) {
    if (amountMinor < this.sofThresholdMinor) return null;
    const VALID = ["salary", "savings", "business_income", "investment_proceeds", "gift", "loan", "property_sale"];
    const t = sourceOfFunds && String(sourceOfFunds.type || "").trim().toLowerCase();
    if (!t) {
      throw new ApiError(400, "source_of_funds_required",
        "Top-ups of this size require a source-of-funds declaration ({ sourceOfFunds: { type, note? } })");
    }
    if (!VALID.includes(t)) {
      throw new ApiError(400, "bad_source_of_funds", "sourceOfFunds.type must be one of: " + VALID.join(", "));
    }
    return { type: t, note: String((sourceOfFunds && sourceOfFunds.note) || "").slice(0, 300), declaredAt: Date.now() };
  }

  // LRS (Liberalised Remittance Scheme) gate for cross-border payments:
  // purpose code + PAN documentation above the doc threshold, and an annual
  // per-user remittance cap across the financial year. Purpose codes below
  // the threshold are accepted and recorded when provided.
  checkLrs({ userId, totalMinor, purposeCode, pan, now = Date.now() }) {
    const d = this.store.data;
    const code = purposeCode ? String(purposeCode).trim().toUpperCase() : null;
    if (code && !LRS_PURPOSES[code]) {
      throw new ApiError(400, "bad_purpose_code", "Unknown LRS purpose code — GET /api/lrs/purposes for the list");
    }
    if (totalMinor >= this.lrsDocThresholdMinor) {
      if (!code) {
        throw new ApiError(400, "purpose_code_required",
          "Cross-border transfers of this size require an LRS purpose code (GET /api/lrs/purposes)");
      }
      if (!pan || !PAN_RE.test(String(pan).trim().toUpperCase())) {
        throw new ApiError(400, "pan_required", "A valid PAN is required for this remittance (LRS documentation)");
      }
    }
    const start = fyStart(now);
    const used = Object.values(d.payments || {})
      .filter((p) => p.userId === userId && p.lrs && (p.settledAt || p.createdAt || 0) >= start &&
        !["failed", "reversed"].includes(p.status))
      .reduce((s, p) => s + (p.totalMinor || 0), 0);
    if (used + totalMinor > this.lrsAnnualCapMinor) {
      throw new ApiError(403, "lrs_limit_exceeded", "This transfer would exceed the annual LRS remittance limit");
    }
    const effective = code || "S0306";
    return {
      purposeCode: effective,
      purpose: LRS_PURPOSES[effective],
      panMasked: pan ? maskPan(String(pan).trim().toUpperCase()) : null,
      fyStart: start,
    };
  }

  // Post-transaction monitoring. NEVER throws — monitoring must not fail a
  // payment that already settled; it raises alerts / files reports instead.
  monitor(receipt, now = Date.now()) {
    try {
      const d = this.store.data;
      const userId = receipt.userId;
      // 1) CTR: single transaction at/above the reporting threshold
      if (receipt.totalMinor >= this.ctrThresholdMinor) {
        const rep = this.fileReport("CTR", { userId, paymentId: receipt.paymentId, totalMinor: receipt.totalMinor });
        this.alert("ctr_threshold", { userId, paymentId: receipt.paymentId, totalMinor: receipt.totalMinor, reportId: rep.id });
      }
      const since = now - DAY_MS;
      const recent = Object.values(d.payments || {}).filter((p) =>
        p.userId === userId && (p.settledAt || p.createdAt || 0) >= since && p.status !== "failed");
      // 2) Structuring: repeated just-below-threshold transactions
      const nearThreshold = recent.filter((p) =>
        p.totalMinor >= this.ctrThresholdMinor * this.structuringPct && p.totalMinor < this.ctrThresholdMinor);
      if (nearThreshold.length >= this.structuringCount && !this._hasRecentAlert("structuring", userId, since)) {
        this.alert("structuring", { userId, count: nearThreshold.length, paymentIds: nearThreshold.map((p) => p.paymentId).slice(0, 10) });
      }
      // 3) Velocity: outbound volume in 24h
      const outMinor = recent.filter((p) => !NON_SPEND_KINDS.includes(p.kind)).reduce((s, p) => s + (p.totalMinor || 0), 0);
      if (receipt.kind !== "topup" && outMinor >= this.velocityAlertMinor && !this._hasRecentAlert("velocity", userId, since)) {
        this.alert("velocity", { userId, dayTotalMinor: outMinor });
      }
      // 4) Rapid in-out (layering): large top-up followed by outbound within 1h
      if (!NON_SPEND_KINDS.includes(receipt.kind)) {
        const hourAgo = now - HOUR_MS;
        const bigTopup = recent.find((p) => p.kind === "topup" && (p.settledAt || 0) >= hourAgo && receipt.totalMinor >= p.totalMinor * 0.8);
        if (bigTopup) this.alert("rapid_in_out", { userId, topupId: bigTopup.paymentId, paymentId: receipt.paymentId });
      }
    } catch {
      /* monitoring must never break payments */
    }
  }

  _hasRecentAlert(type, userId, since) {
    return this._aml().alerts.some((a) => a.type === type && a.data && a.data.userId === userId && a.createdAt >= since);
  }
}
