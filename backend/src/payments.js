// Payment orchestration: ties together quote, balance, ledger and signing.
// Enforces idempotency, KYC, PIN verification, account lockout, transaction
// limits, atomic balance debit, and a tamper-evident audit trail — plus the
// payment-domain controls: counterparty sanctions/PEP screening, payee-name
// verification, beneficiary cooling, fraud scoring with review holds, LRS
// documentation, source-of-funds checks, a real payment state machine
// (settled / pending_review / unknown / failed / refunded / reversed /
// chargeback), refunds, reversals, chargebacks, and PSP timeout recovery.
// Security dependencies (guard/audit/limitsCheck/risk/screening/aml/psp) are
// injected and optional, so the core money math stays unit-testable in
// isolation — and constructing the service without them preserves the exact
// legacy behavior.
import { randomUUID } from "node:crypto";
import { ApiError, createQuote, createP2PQuote, isQuoteValid } from "./fx.js";
import { verifyPin, signPayment } from "./auth.js";
import { fromMinor, toMinor } from "./money.js";
import { compareNames, maskName } from "./risk.js";

// Namespace an idempotency key to its owner so keys never collide across users.
function scopedIdem(userId, key) {
  return key ? userId + ":" + key : null;
}

// Double-entry legs (G-5): every ledger entry books balanced debit/credit legs.
// The payer is debited the full total; the principal is credited to a clearing
// account for the rail, and any fee is credited to the fee-revenue account.
// Invariant (enforced by the ledger at append time): sum of deltaMinor === 0.
function doubleEntryLegs({ userId, totalMinor, feeMinor, principalMinor, clearingAccount }) {
  const legs = [
    { account: "user:" + userId, deltaMinor: -totalMinor },
    { account: clearingAccount, deltaMinor: principalMinor },
  ];
  if (feeMinor > 0) legs.push({ account: "revenue:fees", deltaMinor: feeMinor });
  return legs;
}

// While a payment is held for review or in doubt at the PSP, the full debit
// parks in an escrow account instead of clearing — released, refunded, or
// confirmed later, always via balanced ledger entries.
function escrowLegs({ userId, totalMinor, escrowAccount }) {
  return [
    { account: "user:" + userId, deltaMinor: -totalMinor },
    { account: escrowAccount, deltaMinor: totalMinor },
  ];
}

const RETURN_KINDS = ["refund", "reversal", "chargeback"];

export class PaymentService {
  constructor(store, ledger, opts = {}) {
    this.store = store;
    this.ledger = ledger;
    this.guard = opts.guard || null;
    this.audit = opts.audit || null;
    this.limitsCheck = opts.limitsCheck || null;
    this.risk = opts.risk || null; // RiskEngine (payee names, cooling, fraud score)
    this.screening = opts.screening || null; // screenParty (sanctions/PEP)
    this.aml = opts.aml || null; // AmlMonitor (monitoring, STR/CTR, SoF, LRS)
    this.psp = opts.psp || null; // PspConnector (state machine + recovery)
    // "sandbox" until a licensed PSP / sponsor bank is integrated (config
    // fail-closes "live" without one). Stamped on every receipt so nothing
    // this service produces can ever pretend simulated settlement is real.
    this.settlementMode = opts.settlementMode || "sandbox";
  }

  // ---- quote persistence (G-1) ----
  // Quotes live in the store (not process memory) so they survive restarts and
  // remain valid across horizontally scaled instances sharing one store.
  _quotes() {
    const d = this.store.data;
    if (!d.quotes) d.quotes = {};
    return d.quotes;
  }

  _saveQuote(q) {
    this._quotes()[q.quoteId] = q;
    this.sweepQuotes();
    this.store.persist();
    return q;
  }

  _getQuote(quoteId) {
    return this._quotes()[quoteId] || null;
  }

  _consumeQuote(quoteId) {
    delete this._quotes()[quoteId];
  }

  // Drop expired quotes; returns how many were removed.
  sweepQuotes(now = Date.now()) {
    const quotes = this._quotes();
    let removed = 0;
    for (const [id, q] of Object.entries(quotes)) {
      if (!isQuoteValid(q, now)) {
        delete quotes[id];
        removed++;
      }
    }
    return removed;
  }

  // Shared actor checks: existence, KYC, account, lockout, then PIN.
  // PIN failures use their own "pin" lockout scope so password-guessing
  // failures at login can never lock payments, and vice versa.
  _authorize(d, userId, pin) {
    const user = d.users[userId];
    if (!user) throw new ApiError(404, "user_not_found", "Unknown user");
    if (user.kyc?.status !== "verified")
      throw new ApiError(403, "kyc_required", "KYC not verified");
    const acct = d.accounts[userId];
    if (!acct) throw new ApiError(409, "no_account", "No bank account linked");

    if (this.guard) this.guard.assertNotLocked(userId, "pin");

    if (!verifyPin(pin, d.pins[userId])) {
      let locked = false;
      if (this.guard) {
        const r = this.guard.recordFail(userId, "pin");
        locked = r.locked;
        this.store.persist();
      }
      if (this.audit) this.audit.append("pin_failed", { userId, locked });
      throw new ApiError(401, "bad_pin", "Incorrect PIN");
    }
    if (this.guard) this.guard.recordSuccess(userId, "pin");
    return { user, acct };
  }

  _limit(userId, amountMinor, intl) {
    if (this.limitsCheck) this.limitsCheck(this.store, userId, amountMinor, { intl: Boolean(intl) });
  }

  // Idempotency keys are scoped PER USER. A global key space would let an
  // authenticated user replay another user's key and read back that user's
  // receipt (cross-user disclosure), so we namespace by userId and verify
  // ownership of the stored receipt as defense in depth.
  _idem(d, userId, key) {
    const k = scopedIdem(userId, key);
    if (k && d.idempotency[k]) {
      const receipt = d.payments[d.idempotency[k]];
      if (receipt && receipt.userId === userId) return { replayed: true, receipt };
    }
    return null;
  }

  _auditSettle(receipt) {
    if (this.audit) {
      this.audit.append("payment_settled", {
        paymentId: receipt.paymentId,
        userId: receipt.userId,
        kind: receipt.kind,
        currency: receipt.currency,
        totalMinor: receipt.totalMinor,
      });
    }
  }

  // ---- payment-domain gates (all optional — active only when injected) ----

  // Screening + payee-name verification + cooling/device caps + fraud score.
  // Throws for hard blocks; returns { hold, score, reasons, beneficiary }.
  _riskGate(d, { userId, amountMinor, payee, counterpartyName, device }) {
    if (!this.risk) return { hold: false, score: 0, reasons: [], beneficiary: null };
    const name = counterpartyName || (payee && payee.name) || null;
    // 1) sanctions / PEP screening of the counterparty (every payment)
    if (this.screening && name) {
      const s = this.screening({ name });
      if (!s.clear && s.list === "sanctions") {
        if (this.aml) {
          const rep = this.aml.fileReport("STR", { userId, counterparty: name, reason: "sanctions_match" });
          this.aml.alert("sanctions_hit", { userId, counterparty: name, reportId: rep.id });
        }
        if (this.audit) this.audit.append("payment_blocked_sanctions", { userId });
        this.store.persist();
        throw new ApiError(403, "sanctions_blocked", "This payee cannot be paid (compliance screening)");
      }
      if (!s.clear && s.list === "pep" && this.aml) {
        this.aml.alert("pep_match", { userId, counterparty: name });
      }
    }
    // 2) payee-name verification (UPI-style) when the directory knows the payee
    if (payee) {
      const v = this.risk.verifyPayeeName(payee);
      if (v.result === "mismatch") {
        const confirmed = payee.confirmedName && compareNames(payee.confirmedName, v.registeredName) === "match";
        if (!confirmed) {
          throw new ApiError(409, "payee_name_mismatch",
            "The registered account name is different: " + maskName(v.registeredName) +
            ". Re-submit with payee.confirmedName set to the exact registered name to continue.");
        }
      }
    }
    // 3) beneficiary cooling period + new-device risk caps
    const beneficiary = payee ? this.risk.touchBeneficiary(userId, payee) : null;
    this.risk.enforceCaps({ userId, amountMinor, beneficiary, device });
    // 4) fraud scoring: allow / hold-for-review / block
    const { score, reasons } = this.risk.assess({
      userId, amountMinor, isNewBeneficiary: Boolean(beneficiary && beneficiary.isNew), device,
    });
    if (score >= this.risk.blockScore) {
      if (this.aml) this.aml.alert("fraud_blocked", { userId, score, reasons, amountMinor });
      if (this.audit) this.audit.append("payment_blocked_fraud", { userId, score });
      this.store.persist();
      throw new ApiError(403, "fraud_blocked", "This payment was blocked by fraud controls. Contact support if you believe this is a mistake.");
    }
    return { hold: score >= this.risk.reviewScore, score, reasons, beneficiary };
  }

  // Decide the settlement route BEFORE any money moves:
  //   risk hold            → pending_review (escrow:risk)
  //   PSP declined         → clean refusal, nothing debited
  //   PSP timeout/error    → unknown (clearing:psp:pending) + recovery queue
  //   otherwise            → settled
  _route(gate, paymentId, totalMinor) {
    if (gate && gate.hold) return { status: "pending_review", escrowAccount: "escrow:risk" };
    if (this.psp) {
      const res = this.psp.settle({ paymentId, amountMinor: totalMinor });
      if (res.status === "failed") {
        throw new ApiError(502, "psp_declined", "The payment provider declined this payment" + (res.reason ? " (" + res.reason + ")" : ""));
      }
      if (res.status === "unknown") {
        return { status: "unknown", escrowAccount: "clearing:psp:pending", reason: res.reason };
      }
    }
    return { status: "settled", escrowAccount: null };
  }

  _bookRouteMeta(d, route, paymentId, { clearingAccount, principalMinor, feeMinor, totalMinor, gate }) {
    const now = Date.now();
    if (route.status === "pending_review") {
      if (!d.riskHolds) d.riskHolds = {};
      d.riskHolds[paymentId] = {
        clearingAccount, principalMinor, feeMinor, totalMinor,
        score: gate.score, reasons: gate.reasons, createdAt: now,
      };
      if (this.audit) this.audit.append("payment_held_for_review", { paymentId, score: gate.score, reasons: gate.reasons });
      if (this.aml) this.aml.alert("risk_hold", { userId: null, paymentId, score: gate.score, reasons: gate.reasons });
    } else if (route.status === "unknown") {
      if (!d.pspPending) d.pspPending = {};
      // Eligible for a status re-query immediately; exponential backoff only
      // kicks in after re-queries that STILL come back unknown.
      d.pspPending[paymentId] = {
        clearingAccount, principalMinor, feeMinor, totalMinor,
        attempts: 0, nextRetryAt: now,
        createdAt: now, reason: route.reason || null,
      };
      if (this.audit) this.audit.append("payment_in_doubt", { paymentId, reason: route.reason || null });
    }
  }

  _finishOutbound({ d, receipt, idempotencyKey, gate, device }) {
    d.payments[receipt.paymentId] = receipt;
    if (idempotencyKey) d.idempotency[scopedIdem(receipt.userId, idempotencyKey)] = receipt.paymentId;
    if (receipt.status === "settled") this._auditSettle(receipt);
    if (this.risk && gate) this.risk.recordCoolingSpend(gate.beneficiary, receipt.totalMinor);
    if (device && device.deviceHash) receipt.deviceHash = device.deviceHash;
    if (this.aml) this.aml.monitor(receipt);
    this.store.persist();
    return { replayed: false, receipt };
  }

  quote(currency, localAmount) {
    return this._saveQuote(createQuote(currency, localAmount));
  }

  execute({ userId, quoteId, pin, idempotencyKey, merchant, purposeCode, pan, device }) {
    const d = this.store.data;
    const replay = this._idem(d, userId, idempotencyKey);
    if (replay) return replay;

    const { acct } = this._authorize(d, userId, pin);

    const quote = this._getQuote(quoteId);
    if (!isQuoteValid(quote))
      throw new ApiError(409, "quote_expired", "Quote missing or expired — re-quote");

    this._limit(userId, quote.totalMinor, true);

    // LRS documentation gate (cross-border): purpose code + PAN above the doc
    // threshold, annual remittance cap across the financial year.
    const lrs = this.aml ? this.aml.checkLrs({ userId, totalMinor: quote.totalMinor, purposeCode, pan }) : null;

    const mcht = merchant || { name: "Merchant", country: quote.currency };
    const gate = this._riskGate(d, { userId, amountMinor: quote.totalMinor, payee: null, counterpartyName: mcht.name, device });

    if (acct.balanceMinor < quote.totalMinor)
      throw new ApiError(402, "insufficient_funds", "Home account balance too low");

    const paymentId = "pay_" + randomUUID();
    const clearingAccount = "clearing:intl:" + quote.currency;
    const route = this._route(gate, paymentId, quote.totalMinor);

    acct.balanceMinor -= quote.totalMinor;

    const { block, anchor } = this.ledger.append({
      type: "settlement",
      paymentId,
      userId,
      currency: quote.currency,
      localAmount: quote.localAmount,
      amountMinor: quote.amountMinor,
      feeMinor: quote.feeMinor,
      totalMinor: quote.totalMinor,
      merchant: mcht,
      routeStatus: route.status,
      legs: route.escrowAccount
        ? escrowLegs({ userId, totalMinor: quote.totalMinor, escrowAccount: route.escrowAccount })
        : doubleEntryLegs({
            userId, totalMinor: quote.totalMinor, feeMinor: quote.feeMinor,
            principalMinor: quote.amountMinor, clearingAccount,
          }),
    });

    const signature = signPayment({
      paymentId, userId, currency: quote.currency,
      localAmount: quote.localAmount, amountMinor: quote.amountMinor,
      feeMinor: quote.feeMinor, totalMinor: quote.totalMinor,
      settlementHash: block.hash,
    });

    const receipt = {
      paymentId,
      kind: "payment",
      status: route.status,
      userId,
      merchant: mcht,
      currency: quote.currency,
      localAmount: quote.localAmount,
      rate: quote.rate,
      amountMinor: quote.amountMinor,
      feeMinor: quote.feeMinor,
      totalMinor: quote.totalMinor,
      homeCurrency: "INR",
      balanceAfterMinor: acct.balanceMinor,
      settlement: { index: block.index, hash: block.hash },
      anchor: anchor ? { merkleRoot: anchor.merkleRoot, publicTxHash: anchor.publicTxHash } : null,
      signature,
      settlementMode: this.settlementMode,
      reference: "BP-" + paymentId.slice(4, 10).toUpperCase(),
      createdAt: Date.now(),
    };
    if (route.status === "settled") receipt.settledAt = Date.now();
    if (route.status === "pending_review") receipt.hold = { score: gate.score, reasons: gate.reasons };
    if (route.status === "unknown") receipt.pspReason = route.reason || null;
    if (lrs) receipt.lrs = lrs;

    this._bookRouteMeta(d, route, paymentId, {
      clearingAccount, principalMinor: quote.amountMinor, feeMinor: quote.feeMinor,
      totalMinor: quote.totalMinor, gate,
    });
    this._consumeQuote(quoteId);
    return this._finishOutbound({ d, receipt, idempotencyKey, gate, device });
  }

  // ---- P2P transfers ----
  quoteTransfer(recipientCurrency, sendAmountINR) {
    return this._saveQuote(createP2PQuote(recipientCurrency, sendAmountINR));
  }

  transfer({ userId, quoteId, pin, idempotencyKey, recipient, purposeCode, pan, device }) {
    const d = this.store.data;
    const replay = this._idem(d, userId, idempotencyKey);
    if (replay) return replay;

    const { acct } = this._authorize(d, userId, pin);

    const quote = this._getQuote(quoteId);
    if (!isQuoteValid(quote) || quote.kind !== "p2p")
      throw new ApiError(409, "quote_expired", "Quote missing or expired — re-quote");

    this._limit(userId, quote.totalMinor, true);

    const lrs = this.aml ? this.aml.checkLrs({ userId, totalMinor: quote.totalMinor, purposeCode, pan }) : null;

    const rcpt = recipient && recipient.name
      ? recipient
      : { name: "Recipient", country: quote.recipientCurrency };

    const gate = this._riskGate(d, { userId, amountMinor: quote.totalMinor, payee: rcpt, device });

    if (acct.balanceMinor < quote.totalMinor)
      throw new ApiError(402, "insufficient_funds", "Home account balance too low");

    const transferId = "pay_" + randomUUID();
    const clearingAccount = "clearing:intl:" + quote.recipientCurrency;
    const route = this._route(gate, transferId, quote.totalMinor);

    acct.balanceMinor -= quote.totalMinor;

    const { block, anchor } = this.ledger.append({
      type: "p2p_transfer",
      transferId,
      userId,
      recipient: rcpt,
      recipientCurrency: quote.recipientCurrency,
      recipientAmount: quote.recipientAmount,
      sendAmountMinor: quote.sendAmountMinor,
      feeMinor: quote.feeMinor,
      totalMinor: quote.totalMinor,
      routeStatus: route.status,
      legs: route.escrowAccount
        ? escrowLegs({ userId, totalMinor: quote.totalMinor, escrowAccount: route.escrowAccount })
        : doubleEntryLegs({
            userId, totalMinor: quote.totalMinor, feeMinor: quote.feeMinor,
            principalMinor: quote.sendAmountMinor, clearingAccount,
          }),
    });

    const signature = signPayment({
      paymentId: transferId, userId, currency: quote.recipientCurrency,
      localAmount: quote.recipientAmount, amountMinor: quote.sendAmountMinor,
      feeMinor: quote.feeMinor, totalMinor: quote.totalMinor,
      settlementHash: block.hash,
    });

    const receipt = {
      paymentId: transferId,
      kind: "p2p",
      status: route.status,
      userId,
      recipient: rcpt,
      currency: quote.recipientCurrency,
      recipientAmount: quote.recipientAmount,
      localAmount: quote.recipientAmount,
      rate: quote.rate,
      amountMinor: quote.sendAmountMinor,
      feeMinor: quote.feeMinor,
      totalMinor: quote.totalMinor,
      homeCurrency: "INR",
      balanceAfterMinor: acct.balanceMinor,
      settlement: { index: block.index, hash: block.hash },
      anchor: anchor ? { merkleRoot: anchor.merkleRoot, publicTxHash: anchor.publicTxHash } : null,
      signature,
      settlementMode: this.settlementMode,
      reference: "BP-" + transferId.slice(4, 10).toUpperCase(),
      createdAt: Date.now(),
    };
    if (route.status === "settled") receipt.settledAt = Date.now();
    if (route.status === "pending_review") receipt.hold = { score: gate.score, reasons: gate.reasons };
    if (route.status === "unknown") receipt.pspReason = route.reason || null;
    if (lrs) receipt.lrs = lrs;

    this._bookRouteMeta(d, route, transferId, {
      clearingAccount, principalMinor: quote.sendAmountMinor, feeMinor: quote.feeMinor,
      totalMinor: quote.totalMinor, gate,
    });
    this._consumeQuote(quoteId);
    return this._finishOutbound({ d, receipt, idempotencyKey, gate, device });
  }

  // ---- Domestic payments (UPI-style, INR -> INR, instant, zero fee) ----
  payDomestic({ userId, pin, idempotencyKey, amountINR, payee, kind, device }) {
    const d = this.store.data;
    const replay = this._idem(d, userId, idempotencyKey);
    if (replay) return replay;

    const { acct } = this._authorize(d, userId, pin);

    const amountMinor = toMinor(Number(amountINR));
    if (!(amountMinor > 0))
      throw new ApiError(400, "bad_amount", "Amount must be greater than zero");

    this._limit(userId, amountMinor, false);

    const pye = payee && payee.name ? payee : { name: "Payee", type: kind || "upi" };
    const gate = this._riskGate(d, { userId, amountMinor, payee: pye, device });

    if (acct.balanceMinor < amountMinor)
      throw new ApiError(402, "insufficient_funds", "Home account balance too low");

    const paymentId = "pay_" + randomUUID();
    const clearingAccount = "clearing:domestic:upi";
    const route = this._route(gate, paymentId, amountMinor);

    acct.balanceMinor -= amountMinor;

    const { block, anchor } = this.ledger.append({
      type: "domestic_payment",
      paymentId,
      userId,
      kind: kind || "upi",
      payee: pye,
      amountMinor,
      routeStatus: route.status,
      legs: route.escrowAccount
        ? escrowLegs({ userId, totalMinor: amountMinor, escrowAccount: route.escrowAccount })
        : doubleEntryLegs({
            userId, totalMinor: amountMinor, feeMinor: 0,
            principalMinor: amountMinor, clearingAccount,
          }),
    });

    const signature = signPayment({
      paymentId, userId, currency: "INR",
      localAmount: Number(amountINR), amountMinor,
      feeMinor: 0, totalMinor: amountMinor,
      settlementHash: block.hash,
    });

    const receipt = {
      paymentId,
      kind: kind || "upi",
      domestic: true,
      status: route.status,
      userId,
      payee: pye,
      currency: "INR",
      localAmount: Number(amountINR),
      rate: 1,
      amountMinor,
      feeMinor: 0,
      totalMinor: amountMinor,
      homeCurrency: "INR",
      balanceAfterMinor: acct.balanceMinor,
      settlement: { index: block.index, hash: block.hash },
      anchor: anchor ? { merkleRoot: anchor.merkleRoot, publicTxHash: anchor.publicTxHash } : null,
      signature,
      settlementMode: this.settlementMode,
      reference: "BP-" + paymentId.slice(4, 10).toUpperCase(),
      createdAt: Date.now(),
    };
    if (route.status === "settled") receipt.settledAt = Date.now();
    if (route.status === "pending_review") receipt.hold = { score: gate.score, reasons: gate.reasons };
    if (route.status === "unknown") receipt.pspReason = route.reason || null;

    this._bookRouteMeta(d, route, paymentId, {
      clearingAccount, principalMinor: amountMinor, feeMinor: 0,
      totalMinor: amountMinor, gate,
    });
    return this._finishOutbound({ d, receipt, idempotencyKey, gate, device });
  }

  // ---- Add money (balance top-up) ----
  // The ONLY way a balance is ever funded — there is no invented opening
  // balance anywhere. In sandbox mode the credit books against the
  // funding:sandbox account (double-entry, zero-sum) and the receipt is
  // clearly stamped settlementMode:"sandbox". When a licensed PSP is
  // integrated, this same flow becomes the gateway-backed load.
  topup({ userId, pin, idempotencyKey, amountINR, sourceOfFunds }) {
    const d = this.store.data;
    const replay = this._idem(d, userId, idempotencyKey);
    if (replay) return replay;

    const { acct } = this._authorize(d, userId, pin);

    const amountMinor = toMinor(Number(amountINR));
    if (!(amountMinor > 0))
      throw new ApiError(400, "bad_amount", "Amount must be greater than zero");

    if (this.limitsCheck) this.limitsCheck(this.store, userId, amountMinor, { intl: false, kind: "topup" });

    // Source-of-funds declaration for large loads (threshold is policy config).
    const sof = this.aml ? this.aml.checkSourceOfFunds({ amountMinor, sourceOfFunds }) : null;

    acct.balanceMinor += amountMinor;

    const paymentId = "pay_" + randomUUID();
    const { block, anchor } = this.ledger.append({
      type: "topup",
      paymentId,
      userId,
      amountMinor,
      source: "funding:" + this.settlementMode,
      // credit the user, debit the funding account — the zero-sum invariant
      // is enforced by the ledger exactly as for outbound payments
      legs: [
        { account: "funding:" + this.settlementMode, deltaMinor: -amountMinor },
        { account: "user:" + userId, deltaMinor: amountMinor },
      ],
    });

    const signature = signPayment({
      paymentId, userId, currency: "INR",
      localAmount: Number(amountINR), amountMinor,
      feeMinor: 0, totalMinor: amountMinor,
      settlementHash: block.hash,
    });

    const receipt = {
      paymentId,
      kind: "topup",
      domestic: true,
      status: "settled",
      userId,
      payee: { name: "Borderless balance", type: "topup" },
      currency: "INR",
      localAmount: Number(amountINR),
      rate: 1,
      amountMinor,
      feeMinor: 0,
      totalMinor: amountMinor,
      homeCurrency: "INR",
      balanceAfterMinor: acct.balanceMinor,
      settlement: { index: block.index, hash: block.hash },
      anchor: anchor ? { merkleRoot: anchor.merkleRoot, publicTxHash: anchor.publicTxHash } : null,
      signature,
      settlementMode: this.settlementMode,
      reference: "BP-" + paymentId.slice(4, 10).toUpperCase(),
      createdAt: Date.now(),
      settledAt: Date.now(),
    };
    if (sof) receipt.sourceOfFunds = sof;

    d.payments[paymentId] = receipt;
    if (idempotencyKey) d.idempotency[scopedIdem(userId, idempotencyKey)] = paymentId;
    if (this.audit) {
      this.audit.append("balance_topup", {
        paymentId, userId, amountMinor, mode: this.settlementMode,
      });
    }
    if (this.aml) this.aml.monitor(receipt);
    this.store.persist();

    return { replayed: false, receipt };
  }

  // ---- Collect requests (request money) ----
  createRequest({ userId, fromName, amountINR, note }) {
    const d = this.store.data;
    d.requests = d.requests || {};
    const id = "req_" + randomUUID();
    const req = {
      id, userId, fromName: fromName || "Someone",
      amountMinor: toMinor(Number(amountINR)), note: note || "",
      status: "pending", direction: "outgoing", createdAt: Date.now(),
    };
    d.requests[id] = req;
    this.store.persist();
    return req;
  }

  listRequests(userId) {
    const d = this.store.data;
    d.requests = d.requests || {};
    return Object.values(d.requests)
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  payRequest({ userId, requestId, pin, idempotencyKey, device }) {
    const d = this.store.data;
    d.requests = d.requests || {};
    const r = d.requests[requestId];
    if (!r) throw new ApiError(404, "request_not_found", "Unknown request");
    // Ownership check: a collect request can only be acted on by the user it
    // belongs to (prevents cross-user access / status mutation — IDOR).
    if (r.userId !== userId) throw new ApiError(404, "request_not_found", "Unknown request");
    if (r.status === "paid") return { replayed: true, receipt: d.payments[r.paymentId] };
    const out = this.payDomestic({
      userId, pin, idempotencyKey,
      amountINR: fromMinor(r.amountMinor),
      payee: { name: r.fromName, type: "request" },
      kind: "request",
      device,
    });
    r.status = "paid";
    r.paymentId = out.receipt.paymentId;
    this.store.persist();
    return out;
  }

  // ---- Refunds / reversals / chargebacks ----
  // All three return funds to the payer through balanced ledger entries that
  // reference the original payment — never by silently editing balances.

  _clearingAccountFor(receipt) {
    if (receipt.kind === "payment" || receipt.kind === "p2p") return "clearing:intl:" + receipt.currency;
    return "clearing:domestic:upi";
  }

  _returnFunds({ orig, amt, kind, ledgerType, reason, actor, newStatus }) {
    const d = this.store.data;
    const acct = d.accounts[orig.userId];
    if (!acct) throw new ApiError(409, "no_account", "The payer no longer has a linked account to credit");
    const origFee = orig.feeMinor || 0;
    const feePart = orig.totalMinor > 0 ? Math.min(origFee, Math.round((amt * origFee) / orig.totalMinor)) : 0;
    const principalPart = amt - feePart;
    const clearing = this._clearingAccountFor(orig);
    const legs = [
      { account: clearing, deltaMinor: -principalPart },
      { account: "user:" + orig.userId, deltaMinor: amt },
    ];
    if (feePart > 0) legs.push({ account: "revenue:fees", deltaMinor: -feePart });
    const paymentId = "pay_" + randomUUID();
    const { block, anchor } = this.ledger.append({
      type: ledgerType, paymentId, parentPaymentId: orig.paymentId, userId: orig.userId,
      amountMinor: principalPart, feeMinor: feePart, totalMinor: amt, legs,
    });
    acct.balanceMinor += amt;
    const signature = signPayment({
      paymentId, userId: orig.userId, currency: "INR",
      localAmount: fromMinor(amt), amountMinor: principalPart,
      feeMinor: feePart, totalMinor: amt, settlementHash: block.hash,
    });
    const receipt = {
      paymentId,
      kind,
      status: "settled",
      userId: orig.userId,
      parentPaymentId: orig.paymentId,
      reason: reason || null,
      currency: "INR",
      localAmount: fromMinor(amt),
      rate: 1,
      amountMinor: principalPart,
      feeMinor: feePart,
      totalMinor: amt,
      homeCurrency: "INR",
      balanceAfterMinor: acct.balanceMinor,
      settlement: { index: block.index, hash: block.hash },
      anchor: anchor ? { merkleRoot: anchor.merkleRoot, publicTxHash: anchor.publicTxHash } : null,
      signature,
      settlementMode: this.settlementMode,
      reference: "BP-" + paymentId.slice(4, 10).toUpperCase(),
      createdAt: Date.now(),
      settledAt: Date.now(),
    };
    d.payments[paymentId] = receipt;
    orig.refundedMinor = (orig.refundedMinor || 0) + amt;
    orig.status = newStatus;
    delete orig.disputed;
    if (this.audit) {
      this.audit.append("payment_" + kind, {
        paymentId, parentPaymentId: orig.paymentId, userId: orig.userId, totalMinor: amt, actor: actor || null,
      });
    }
    this.store.persist();
    return { replayed: false, receipt };
  }

  refund({ paymentId, amountMinor, reason, actor }) {
    const d = this.store.data;
    const orig = d.payments[paymentId];
    if (!orig) throw new ApiError(404, "payment_not_found", "Unknown payment");
    if (orig.kind === "topup" || RETURN_KINDS.includes(orig.kind)) {
      throw new ApiError(409, "not_refundable", "This transaction type cannot be refunded");
    }
    if (!["settled", "partially_refunded"].includes(orig.status)) {
      throw new ApiError(409, "not_refundable", "Only settled payments can be refunded");
    }
    const already = orig.refundedMinor || 0;
    const amt = amountMinor == null ? orig.totalMinor - already : Math.floor(Number(amountMinor));
    if (!(amt > 0) || already + amt > orig.totalMinor) {
      throw new ApiError(400, "bad_refund_amount", "Refund amount must be positive and within the unrefunded remainder");
    }
    const newStatus = already + amt >= orig.totalMinor ? "refunded" : "partially_refunded";
    return this._returnFunds({ orig, amt, kind: "refund", ledgerType: "refund", reason, actor, newStatus });
  }

  // Operational reversal: undo a settled payment in full (wrong beneficiary,
  // settlement failure discovered post-facto). Ops-only, maker-checker gated.
  reverse({ paymentId, reason, actor }) {
    const d = this.store.data;
    const orig = d.payments[paymentId];
    if (!orig) throw new ApiError(404, "payment_not_found", "Unknown payment");
    if (orig.kind === "topup" || RETURN_KINDS.includes(orig.kind)) {
      throw new ApiError(409, "not_reversible", "This transaction type cannot be reversed");
    }
    if (orig.status !== "settled") throw new ApiError(409, "not_reversible", "Only settled payments can be reversed");
    const amt = orig.totalMinor - (orig.refundedMinor || 0);
    if (!(amt > 0)) throw new ApiError(409, "not_reversible", "Nothing left to reverse");
    return this._returnFunds({ orig, amt, kind: "reversal", ledgerType: "reversal", reason, actor, newStatus: "reversed" });
  }

  // Network-initiated chargeback (card/UPI dispute network rules the issuer's
  // way): funds return to the payer, original is terminally marked.
  chargeback({ paymentId, reason, actor }) {
    const d = this.store.data;
    const orig = d.payments[paymentId];
    if (!orig) throw new ApiError(404, "payment_not_found", "Unknown payment");
    if (orig.kind === "topup" || RETURN_KINDS.includes(orig.kind)) {
      throw new ApiError(409, "not_chargeable", "This transaction type cannot be charged back");
    }
    if (!["settled", "partially_refunded"].includes(orig.status)) {
      throw new ApiError(409, "not_chargeable", "Only settled payments can be charged back");
    }
    const amt = orig.totalMinor - (orig.refundedMinor || 0);
    if (!(amt > 0)) throw new ApiError(409, "not_chargeable", "Nothing left to charge back");
    return this._returnFunds({ orig, amt, kind: "chargeback", ledgerType: "chargeback", reason, actor, newStatus: "chargeback" });
  }

  // ---- Risk-hold resolution (ops maker-checker) ----
  releaseHold({ paymentId, actor }) {
    const d = this.store.data;
    const r = d.payments[paymentId];
    if (!r) throw new ApiError(404, "payment_not_found", "Unknown payment");
    if (r.status !== "pending_review") throw new ApiError(409, "not_held", "Payment is not pending review");
    const meta = (d.riskHolds || {})[paymentId] || {};
    const principal = meta.principalMinor ?? r.amountMinor;
    const fee = meta.feeMinor ?? (r.feeMinor || 0);
    const clearing = meta.clearingAccount || this._clearingAccountFor(r);
    const legs = [
      { account: "escrow:risk", deltaMinor: -r.totalMinor },
      { account: clearing, deltaMinor: principal },
    ];
    if (fee > 0) legs.push({ account: "revenue:fees", deltaMinor: fee });
    this.ledger.append({ type: "risk_hold_released", paymentId, userId: r.userId, totalMinor: r.totalMinor, legs });
    r.status = "settled";
    r.settledAt = Date.now();
    if (r.hold) r.hold.releasedBy = actor || null;
    if (d.riskHolds) delete d.riskHolds[paymentId];
    if (this.audit) this.audit.append("risk_hold_released", { paymentId, actor: actor || null });
    this._auditSettle(r);
    this.store.persist();
    return { receipt: r };
  }

  rejectHold({ paymentId, actor }) {
    const d = this.store.data;
    const r = d.payments[paymentId];
    if (!r) throw new ApiError(404, "payment_not_found", "Unknown payment");
    if (r.status !== "pending_review") throw new ApiError(409, "not_held", "Payment is not pending review");
    const acct = d.accounts[r.userId];
    if (!acct) throw new ApiError(409, "no_account", "The payer no longer has a linked account to credit");
    this.ledger.append({
      type: "risk_hold_rejected", paymentId, userId: r.userId, totalMinor: r.totalMinor,
      legs: [
        { account: "escrow:risk", deltaMinor: -r.totalMinor },
        { account: "user:" + r.userId, deltaMinor: r.totalMinor },
      ],
    });
    acct.balanceMinor += r.totalMinor;
    r.status = "failed";
    r.failedReason = "risk_rejected";
    r.balanceAfterMinor = acct.balanceMinor;
    if (r.hold) r.hold.rejectedBy = actor || null;
    if (d.riskHolds) delete d.riskHolds[paymentId];
    if (this.audit) this.audit.append("risk_hold_rejected", { paymentId, actor: actor || null });
    this.store.persist();
    return { receipt: r };
  }

  // ---- PSP in-doubt resolution (webhook / recovery / ops) ----
  resolvePsp({ paymentId, outcome, via, actor }) {
    const d = this.store.data;
    const r = d.payments[paymentId];
    if (!r) throw new ApiError(404, "payment_not_found", "Unknown payment");
    if (r.status !== "unknown") return { ok: true, alreadyFinal: true, status: r.status };
    if (!["settled", "failed"].includes(outcome)) throw new ApiError(400, "bad_outcome", "outcome must be 'settled' or 'failed'");
    const meta = (d.pspPending || {})[paymentId] || {};
    const principal = meta.principalMinor ?? r.amountMinor;
    const fee = meta.feeMinor ?? (r.feeMinor || 0);
    const clearing = meta.clearingAccount || this._clearingAccountFor(r);
    if (outcome === "settled") {
      const legs = [
        { account: "clearing:psp:pending", deltaMinor: -r.totalMinor },
        { account: clearing, deltaMinor: principal },
      ];
      if (fee > 0) legs.push({ account: "revenue:fees", deltaMinor: fee });
      this.ledger.append({ type: "psp_settlement_confirmed", paymentId, userId: r.userId, totalMinor: r.totalMinor, legs });
      r.status = "settled";
      r.settledAt = Date.now();
      this._auditSettle(r);
    } else {
      const acct = d.accounts[r.userId];
      if (!acct) throw new ApiError(409, "no_account", "The payer no longer has a linked account to credit");
      this.ledger.append({
        type: "psp_settlement_failed", paymentId, userId: r.userId, totalMinor: r.totalMinor,
        legs: [
          { account: "clearing:psp:pending", deltaMinor: -r.totalMinor },
          { account: "user:" + r.userId, deltaMinor: r.totalMinor },
        ],
      });
      acct.balanceMinor += r.totalMinor;
      r.status = "failed";
      r.failedReason = "psp_failed";
      r.balanceAfterMinor = acct.balanceMinor;
    }
    if (d.pspPending) delete d.pspPending[paymentId];
    if (this.audit) this.audit.append("psp_settlement_resolved", { paymentId, outcome, via: via || null, actor: actor || null });
    this.store.persist();
    return { ok: true, status: r.status };
  }

  // Re-query the PSP for every in-doubt payment whose backoff timer elapsed.
  // Called from the maintenance sweep and from the ops recovery endpoint.
  recoverPspPending(now = Date.now()) {
    const d = this.store.data;
    if (!d.pspPending) d.pspPending = {};
    let recovered = 0, failed = 0, stillUnknown = 0;
    for (const [paymentId, entry] of Object.entries(d.pspPending)) {
      if (entry.nextRetryAt && entry.nextRetryAt > now) { stillUnknown++; continue; }
      const q = this.psp ? this.psp.queryStatus(paymentId) : { status: "unknown" };
      if (q.status === "settled") {
        this.resolvePsp({ paymentId, outcome: "settled", via: "recovery" });
        recovered++;
      } else if (q.status === "failed") {
        this.resolvePsp({ paymentId, outcome: "failed", via: "recovery" });
        failed++;
      } else {
        entry.attempts = (entry.attempts || 0) + 1;
        entry.nextRetryAt = this.psp ? this.psp.nextRetryAt(entry.attempts, now) : now + 60000;
        stillUnknown++;
        if (this.psp && entry.attempts >= this.psp.maxAttempts && !entry.alerted && this.aml) {
          entry.alerted = true;
          this.aml.alert("psp_recovery_exhausted", { paymentId, attempts: entry.attempts });
        }
      }
    }
    if (recovered || failed) this.store.persist();
    return { recovered, failed, stillUnknown };
  }

  history(userId) {
    return Object.values(this.store.data.payments)
      .filter((p) => p.userId === userId)
      .sort((a, b) => (b.settledAt || b.createdAt || 0) - (a.settledAt || a.createdAt || 0));
  }
}
