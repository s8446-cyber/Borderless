// Pre-transaction risk controls:
//   - payee-name verification against the payee directory (UPI-style)
//   - beneficiary registration + cooling-period caps for NEW beneficiaries
//   - per-device risk limits (a first-day device gets a lower outbound cap)
//   - deterministic, explainable rule-based fraud scoring
//
// Decisions surface as: allow | hold (status "pending_review", funds parked in
// the escrow:risk ledger account until an ops maker-checker decision) | block.
import { ApiError } from "./fx.js";

const DAY_MS = 86400000;
const NON_SPEND_KINDS = ["topup", "refund", "reversal", "chargeback"];

// Normalize a beneficiary to a stable key (vpa > phone > number > name).
export function beneficiaryKey(payee) {
  if (!payee) return null;
  const id = payee.vpa || payee.phone || payee.number || payee.name;
  if (!id) return null;
  return String(id).trim().toLowerCase().replace(/\s+/g, " ");
}

// Compare a sender-provided name against the registered name, the way UPI
// payee-name verification behaves: exact (case/space-insensitive) → "match",
// shared first token → "partial", otherwise "mismatch".
export function compareNames(provided, registered) {
  const a = String(provided || "").trim().toLowerCase().replace(/\s+/g, " ");
  const b = String(registered || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!a || !b) return "unknown";
  if (a === b) return "match";
  if (a.split(" ")[0] === b.split(" ")[0]) return "partial";
  return "mismatch";
}

// "Priya Sharma" → "P***a S****a" (never expose the full registered name).
export function maskName(name) {
  return String(name || "")
    .split(/\s+/)
    .map((w) => (w.length <= 2 ? w : w[0] + "*".repeat(w.length - 2) + w[w.length - 1]))
    .join(" ");
}

export class RiskEngine {
  constructor(store, opts = {}) {
    this.store = store;
    this.coolingMs = opts.coolingMs ?? DAY_MS; // beneficiary cooling window
    this.coolingCapMinor = opts.coolingCapMinor ?? 2500000; // ₹25,000 total during cooling
    this.newDeviceWindowMs = opts.newDeviceWindowMs ?? DAY_MS;
    this.newDeviceDailyCapMinor = opts.newDeviceDailyCapMinor ?? 5000000; // ₹50,000/day from a first-day device
    this.reviewScore = opts.reviewScore ?? 70; // hold for ops review
    this.blockScore = opts.blockScore ?? 90; // refuse outright
  }

  _beneficiaries() {
    const d = this.store.data;
    if (!d.beneficiaries) d.beneficiaries = {};
    return d.beneficiaries;
  }

  // Payee-name verification against the payee directory. When the directory
  // KNOWS this payee and the provided name is a clear mismatch, the payment
  // service refuses unless the sender confirms the registered name back.
  verifyPayeeName(payee) {
    const dir = this.store.data.payeeDirectory || {};
    const key = beneficiaryKey(payee);
    const registered = key ? dir[key] : null;
    if (!registered) return { result: "unknown", registeredName: null };
    return { result: compareNames(payee && payee.name, registered), registeredName: registered };
  }

  // Register (or fetch) a beneficiary record. The FIRST payment to a new
  // beneficiary starts the cooling window.
  touchBeneficiary(userId, payee, now = Date.now()) {
    const key = beneficiaryKey(payee);
    if (!key) return { key: null, isNew: false, record: null };
    const all = this._beneficiaries();
    if (!all[userId]) all[userId] = {};
    let rec = all[userId][key];
    const isNew = !rec;
    if (!rec) {
      rec = { name: (payee && payee.name) || key, addedAt: now, sentDuringCoolingMinor: 0 };
      all[userId][key] = rec;
    }
    return { key, isNew, record: rec };
  }

  // Throws when a cooling-period or new-device cap would be exceeded.
  enforceCaps({ userId, amountMinor, beneficiary, device, now = Date.now() }) {
    if (beneficiary && beneficiary.record) {
      const rec = beneficiary.record;
      const inCooling = now - rec.addedAt < this.coolingMs;
      if (inCooling && rec.sentDuringCoolingMinor + amountMinor > this.coolingCapMinor) {
        throw new ApiError(403, "beneficiary_cooling",
          "New beneficiary: transfers to someone you recently added are capped during the cooling period. Try a smaller amount or wait for the period to end.");
      }
    }
    if (device && device.isNew) {
      const since = now - DAY_MS;
      const d = this.store.data;
      const fromDevice = Object.values(d.payments || {}).filter((p) =>
        p.userId === userId && p.deviceHash === device.deviceHash &&
        (p.settledAt || p.createdAt || 0) >= since &&
        !NON_SPEND_KINDS.includes(p.kind) && p.status !== "failed");
      const total = fromDevice.reduce((s, p) => s + (p.totalMinor || 0), 0);
      if (total + amountMinor > this.newDeviceDailyCapMinor) {
        throw new ApiError(403, "new_device_limit",
          "This device was added recently — outbound transfers from it are capped for the first day.");
      }
    }
  }

  // Count successful spend against the cooling window (called after settle/hold).
  recordCoolingSpend(beneficiary, amountMinor, now = Date.now()) {
    if (!beneficiary || !beneficiary.record) return;
    if (now - beneficiary.record.addedAt < this.coolingMs) {
      beneficiary.record.sentDuringCoolingMinor += amountMinor;
    }
  }

  // Rule-based fraud score (0..100+). Deterministic and explainable: every
  // triggered rule contributes to `reasons`, stored on the hold and shown to
  // the ops reviewer — no black-box declines.
  assess({ userId, amountMinor, isNewBeneficiary, device, now = Date.now() }) {
    const d = this.store.data;
    const reasons = [];
    let score = 0;
    const mine = Object.values(d.payments || {}).filter((p) =>
      p.userId === userId && !NON_SPEND_KINDS.includes(p.kind) && p.status !== "failed");
    if (isNewBeneficiary) { score += 25; reasons.push("new_beneficiary"); }
    const tenMinAgo = now - 600000;
    const burst = mine.filter((p) => (p.settledAt || p.createdAt || 0) >= tenMinAgo).length;
    if (burst >= 5) { score += 20; reasons.push("velocity_burst"); }
    if (mine.length >= 3) {
      const avg = mine.reduce((s, p) => s + (p.totalMinor || 0), 0) / mine.length;
      if (amountMinor > avg * 5) { score += 25; reasons.push("amount_5x_average"); }
    }
    const hour = new Date(now).getUTCHours();
    if (hour >= 0 && hour < 3) { score += 10; reasons.push("night_hours"); }
    if (device && device.isNew) { score += 20; reasons.push("new_device"); }
    return { score, reasons };
  }
}
