// Operations back office: maker-checker (four-eyes) controls, disputes,
// reconciliation, and settlement-break management.
//
// Every sensitive money action (refund, reversal, chargeback, releasing or
// rejecting a risk hold, resolving a dispute, filing an STR, unlocking an
// account) is a TWO-PERSON operation: one ops actor creates it ("maker"), a
// DIFFERENT actor approves it ("checker"), and only approval executes it.
// Every step lands in the tamper-evident audit log.
import { randomUUID } from "node:crypto";
import { ApiError } from "./fx.js";

const ACTION_TYPES = [
  "refund", "reverse_payment", "chargeback",
  "release_risk_hold", "reject_risk_hold",
  "resolve_dispute", "file_str", "unlock_account", "register_payee_name",
];

export class OpsService {
  constructor({ store, payments, ledger, audit, aml, guard }) {
    this.store = store;
    this.payments = payments;
    this.ledger = ledger;
    this.audit = audit;
    this.aml = aml;
    this.guard = guard;
  }

  _ops() {
    const d = this.store.data;
    if (!d.ops) d.ops = { actions: {} };
    if (!d.ops.actions) d.ops.actions = {};
    return d.ops;
  }

  _disputes() {
    const d = this.store.data;
    if (!d.disputes) d.disputes = {};
    return d.disputes;
  }

  _recon() {
    const d = this.store.data;
    if (!d.recon) d.recon = { breaks: [] };
    if (!d.recon.breaks) d.recon.breaks = [];
    return d.recon;
  }

  // ---- maker-checker ----
  createAction({ type, params, makerId }) {
    if (!ACTION_TYPES.includes(type)) {
      throw new ApiError(400, "bad_action_type", "type must be one of: " + ACTION_TYPES.join(", "));
    }
    if (!makerId) throw new ApiError(400, "maker_required", "x-ops-actor header is required");
    const a = { id: "act_" + randomUUID(), type, params: params || {}, makerId, status: "pending_approval", createdAt: Date.now() };
    this._ops().actions[a.id] = a;
    this.audit.append("ops_action_created", { actionId: a.id, type, makerId });
    return a;
  }

  approveAction({ actionId, checkerId }) {
    const a = this._ops().actions[actionId];
    if (!a) throw new ApiError(404, "action_not_found", "Unknown action");
    if (a.status !== "pending_approval") throw new ApiError(409, "action_not_pending", "Action already " + a.status);
    if (!checkerId) throw new ApiError(400, "checker_required", "x-ops-actor header is required");
    if (checkerId === a.makerId) {
      throw new ApiError(403, "four_eyes_violation", "The approver must be a different operator than the requester (maker-checker)");
    }
    a.checkerId = checkerId;
    a.approvedAt = Date.now();
    try {
      a.result = this._execute(a);
      a.status = "executed";
    } catch (e) {
      a.status = "failed";
      a.error = e instanceof ApiError
        ? { code: e.code, message: e.message }
        : { code: "internal", message: String(e && e.message) };
      this.audit.append("ops_action_failed", { actionId: a.id, type: a.type, checkerId, error: a.error.code });
      throw e;
    }
    this.audit.append("ops_action_executed", { actionId: a.id, type: a.type, makerId: a.makerId, checkerId });
    return a;
  }

  rejectAction({ actionId, checkerId, reason }) {
    const a = this._ops().actions[actionId];
    if (!a) throw new ApiError(404, "action_not_found", "Unknown action");
    if (a.status !== "pending_approval") throw new ApiError(409, "action_not_pending", "Action already " + a.status);
    a.status = "rejected";
    a.checkerId = checkerId || null;
    a.reason = reason || null;
    a.rejectedAt = Date.now();
    this.audit.append("ops_action_rejected", { actionId: a.id, type: a.type, checkerId });
    return a;
  }

  _execute(a) {
    const p = a.params || {};
    const actor = a.makerId + "+" + a.checkerId;
    switch (a.type) {
      case "refund":
        return this.payments.refund({ paymentId: p.paymentId, amountMinor: p.amountMinor, reason: p.reason, actor });
      case "reverse_payment":
        return this.payments.reverse({ paymentId: p.paymentId, reason: p.reason, actor });
      case "chargeback":
        return this.payments.chargeback({ paymentId: p.paymentId, reason: p.reason, actor });
      case "release_risk_hold":
        return this.payments.releaseHold({ paymentId: p.paymentId, actor });
      case "reject_risk_hold":
        return this.payments.rejectHold({ paymentId: p.paymentId, actor });
      case "resolve_dispute":
        return this.resolveDispute({ disputeId: p.disputeId, outcome: p.outcome, note: p.note, actor });
      case "file_str":
        return this.aml.fileReport("STR", { summary: p.summary || null, alertId: p.alertId || null }, { filedBy: actor });
      case "unlock_account": {
        this.guard.recordSuccess(p.userId, p.scope || "pin");
        this.audit.append("ops_account_unlocked", { userId: p.userId, scope: p.scope || "pin", actor });
        return { ok: true };
      }
      case "register_payee_name": {
        const d = this.store.data;
        if (!d.payeeDirectory) d.payeeDirectory = {};
        d.payeeDirectory[String(p.key || "").trim().toLowerCase()] = String(p.name || "");
        this.audit.append("payee_name_registered", { key: String(p.key || "").trim().toLowerCase(), actor });
        return { ok: true };
      }
      default:
        throw new ApiError(400, "bad_action_type", "Unknown action type");
    }
  }

  // ---- disputes ----
  openDispute({ userId, paymentId, reason }) {
    const d = this.store.data;
    const receipt = d.payments[paymentId];
    if (!receipt || receipt.userId !== userId) throw new ApiError(404, "payment_not_found", "Unknown payment");
    if (!["settled", "partially_refunded"].includes(receipt.status)) {
      throw new ApiError(409, "not_disputable", "Only settled payments can be disputed");
    }
    const existing = Object.values(this._disputes()).find((x) => x.paymentId === paymentId && x.status !== "resolved");
    if (existing) throw new ApiError(409, "dispute_exists", "A dispute is already open for this payment");
    const disp = { id: "dsp_" + randomUUID(), userId, paymentId, reason: String(reason || "").slice(0, 500), status: "open", createdAt: Date.now() };
    this._disputes()[disp.id] = disp;
    receipt.disputed = true;
    this.audit.append("dispute_opened", { disputeId: disp.id, paymentId, userId });
    return disp;
  }

  listDisputes(userId) {
    return Object.values(this._disputes())
      .filter((x) => !userId || x.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  resolveDispute({ disputeId, outcome, note, actor }) {
    const disp = this._disputes()[disputeId];
    if (!disp) throw new ApiError(404, "dispute_not_found", "Unknown dispute");
    if (disp.status === "resolved") throw new ApiError(409, "dispute_resolved", "Dispute already resolved");
    if (!["refund", "deny"].includes(outcome)) throw new ApiError(400, "bad_outcome", "outcome must be 'refund' or 'deny'");
    let refundId = null;
    if (outcome === "refund") {
      const out = this.payments.refund({ paymentId: disp.paymentId, reason: "dispute:" + disp.id, actor });
      refundId = out.receipt.paymentId;
    } else {
      const receipt = this.store.data.payments[disp.paymentId];
      if (receipt) delete receipt.disputed;
    }
    disp.status = "resolved";
    disp.outcome = outcome;
    disp.note = note || null;
    disp.resolvedAt = Date.now();
    disp.resolvedBy = actor;
    this.audit.append("dispute_resolved", { disputeId, outcome, actor });
    return { dispute: disp, refundPaymentId: refundId };
  }

  // ---- reconciliation & settlement breaks ----
  // Compares independent records that must agree: the hash-chained ledger,
  // per-user account balances in the store, and escrow accounts vs the
  // held/in-doubt payments they should exactly cover. Discrepancies become
  // persistent break records that stay open until an operator resolves them.
  reconcile(now = Date.now()) {
    const d = this.store.data;
    const checks = [];
    const bal = this.ledger.balances();
    const integrity = this.ledger.verify();
    checks.push({ kind: "ledger_integrity", ok: integrity.ok });
    if (!integrity.ok) {
      this._recordBreak({ kind: "ledger_integrity", account: "ledger", expectedMinor: 0, actualMinor: 0 }, now);
    }
    const grand = Object.values(bal).reduce((s, v) => s + v, 0);
    checks.push({ kind: "zero_sum", ok: grand === 0 });
    if (grand !== 0) this._recordBreak({ kind: "zero_sum", account: "ledger", expectedMinor: 0, actualMinor: grand }, now);
    for (const [userId, acct] of Object.entries(d.accounts || {})) {
      const ledgerBal = bal["user:" + userId] || 0;
      if (ledgerBal !== acct.balanceMinor) {
        this._recordBreak({ kind: "balance_mismatch", account: "user:" + userId, expectedMinor: ledgerBal, actualMinor: acct.balanceMinor }, now);
      }
    }
    const held = Object.values(d.payments || {}).filter((p) => p.status === "pending_review").reduce((s, p) => s + (p.totalMinor || 0), 0);
    const escrow = bal["escrow:risk"] || 0;
    checks.push({ kind: "risk_escrow", ok: escrow === held });
    if (escrow !== held) this._recordBreak({ kind: "escrow_mismatch", account: "escrow:risk", expectedMinor: held, actualMinor: escrow }, now);
    const inDoubt = Object.values(d.payments || {}).filter((p) => p.status === "unknown").reduce((s, p) => s + (p.totalMinor || 0), 0);
    const pendingClearing = bal["clearing:psp:pending"] || 0;
    checks.push({ kind: "psp_pending_escrow", ok: pendingClearing === inDoubt });
    if (pendingClearing !== inDoubt) {
      this._recordBreak({ kind: "settlement_break", account: "clearing:psp:pending", expectedMinor: inDoubt, actualMinor: pendingClearing }, now);
    }
    const open = this._recon().breaks.filter((b) => b.status === "open");
    this.audit.append("reconciliation_run", { openBreaks: open.length });
    return { ok: open.length === 0, checks, openBreaks: open };
  }

  _recordBreak(brk, now) {
    const breaks = this._recon().breaks;
    const existing = breaks.find((b) => b.status === "open" && b.kind === brk.kind && b.account === brk.account);
    if (existing) {
      existing.expectedMinor = brk.expectedMinor;
      existing.actualMinor = brk.actualMinor;
      existing.lastSeenAt = now;
      return existing;
    }
    const rec = { id: "brk_" + randomUUID(), ...brk, status: "open", detectedAt: now, lastSeenAt: now, resolvedAt: null, resolvedBy: null, note: null };
    breaks.push(rec);
    this.audit.append("settlement_break_detected", { breakId: rec.id, kind: rec.kind, account: rec.account });
    return rec;
  }

  resolveBreak({ breakId, note, actor }) {
    const rec = this._recon().breaks.find((b) => b.id === breakId);
    if (!rec) throw new ApiError(404, "break_not_found", "Unknown break");
    if (rec.status !== "open") throw new ApiError(409, "break_not_open", "Break already " + rec.status);
    rec.status = "resolved";
    rec.resolvedAt = Date.now();
    rec.resolvedBy = actor;
    rec.note = note || null;
    this.audit.append("settlement_break_resolved", { breakId, actor });
    return rec;
  }

  overview() {
    const d = this.store.data;
    const byStatus = {};
    for (const p of Object.values(d.payments || {})) byStatus[p.status || "unknown"] = (byStatus[p.status || "unknown"] || 0) + 1;
    const aml = d.aml || { alerts: [], reports: [] };
    return {
      users: Object.keys(d.users || {}).length,
      paymentsByStatus: byStatus,
      openDisputes: Object.values(d.disputes || {}).filter((x) => x.status !== "resolved").length,
      openAlerts: (aml.alerts || []).filter((a) => a.status === "open").length,
      reportsFiled: (aml.reports || []).length,
      pendingActions: Object.values((d.ops && d.ops.actions) || {}).filter((a) => a.status === "pending_approval").length,
      openBreaks: ((d.recon && d.recon.breaks) || []).filter((b) => b.status === "open").length,
      riskHolds: Object.values(d.payments || {}).filter((p) => p.status === "pending_review").length,
      unknownSettlements: Object.values(d.payments || {}).filter((p) => p.status === "unknown").length,
    };
  }
}
