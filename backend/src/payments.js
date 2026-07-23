// Payment orchestration: ties together quote, balance, ledger and signing.
// Enforces idempotency, KYC, PIN verification, account lockout, transaction
// limits, atomic balance debit, and a tamper-evident audit trail.
// Security dependencies (guard/audit/limitsCheck) are injected and optional, so
// the core money math stays unit-testable in isolation.
import { randomUUID } from "node:crypto";
import { ApiError, createQuote, createP2PQuote, isQuoteValid } from "./fx.js";
import { verifyPin, signPayment } from "./auth.js";
import { fromMinor, toMinor } from "./money.js";

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

export class PaymentService {
  constructor(store, ledger, opts = {}) {
    this.store = store;
    this.ledger = ledger;
    this.guard = opts.guard || null;
    this.audit = opts.audit || null;
    this.limitsCheck = opts.limitsCheck || null;
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

  quote(currency, localAmount) {
    return this._saveQuote(createQuote(currency, localAmount));
  }

  execute({ userId, quoteId, pin, idempotencyKey, merchant }) {
    const d = this.store.data;
    const replay = this._idem(d, userId, idempotencyKey);
    if (replay) return replay;

    const { acct } = this._authorize(d, userId, pin);

    const quote = this._getQuote(quoteId);
    if (!isQuoteValid(quote))
      throw new ApiError(409, "quote_expired", "Quote missing or expired — re-quote");

    this._limit(userId, quote.totalMinor, true);

    if (acct.balanceMinor < quote.totalMinor)
      throw new ApiError(402, "insufficient_funds", "Home account balance too low");

    acct.balanceMinor -= quote.totalMinor;

    const paymentId = "pay_" + randomUUID();
    const { block, anchor } = this.ledger.append({
      type: "settlement",
      paymentId,
      userId,
      currency: quote.currency,
      localAmount: quote.localAmount,
      amountMinor: quote.amountMinor,
      feeMinor: quote.feeMinor,
      totalMinor: quote.totalMinor,
      merchant: merchant || { name: "Merchant", country: quote.currency },
      legs: doubleEntryLegs({
        userId, totalMinor: quote.totalMinor, feeMinor: quote.feeMinor,
        principalMinor: quote.amountMinor, clearingAccount: "clearing:intl:" + quote.currency,
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
      status: "settled",
      userId,
      merchant: merchant || { name: "Merchant", country: quote.currency },
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
      settledAt: Date.now(),
    };

    d.payments[paymentId] = receipt;
    if (idempotencyKey) d.idempotency[scopedIdem(userId, idempotencyKey)] = paymentId;
    this._consumeQuote(quoteId);
    this._auditSettle(receipt);
    this.store.persist();

    return { replayed: false, receipt };
  }

  // ---- P2P transfers ----
  quoteTransfer(recipientCurrency, sendAmountINR) {
    return this._saveQuote(createP2PQuote(recipientCurrency, sendAmountINR));
  }

  transfer({ userId, quoteId, pin, idempotencyKey, recipient }) {
    const d = this.store.data;
    const replay = this._idem(d, userId, idempotencyKey);
    if (replay) return replay;

    const { acct } = this._authorize(d, userId, pin);

    const quote = this._getQuote(quoteId);
    if (!isQuoteValid(quote) || quote.kind !== "p2p")
      throw new ApiError(409, "quote_expired", "Quote missing or expired — re-quote");

    this._limit(userId, quote.totalMinor, true);

    if (acct.balanceMinor < quote.totalMinor)
      throw new ApiError(402, "insufficient_funds", "Home account balance too low");

    acct.balanceMinor -= quote.totalMinor;

    const transferId = "pay_" + randomUUID();
    const rcpt = recipient && recipient.name
      ? recipient
      : { name: "Recipient", country: quote.recipientCurrency };

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
      legs: doubleEntryLegs({
        userId, totalMinor: quote.totalMinor, feeMinor: quote.feeMinor,
        principalMinor: quote.sendAmountMinor, clearingAccount: "clearing:intl:" + quote.recipientCurrency,
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
      status: "settled",
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
      settledAt: Date.now(),
    };

    d.payments[transferId] = receipt;
    if (idempotencyKey) d.idempotency[scopedIdem(userId, idempotencyKey)] = transferId;
    this._consumeQuote(quoteId);
    this._auditSettle(receipt);
    this.store.persist();

    return { replayed: false, receipt };
  }

  // ---- Domestic payments (UPI-style, INR -> INR, instant, zero fee) ----
  payDomestic({ userId, pin, idempotencyKey, amountINR, payee, kind }) {
    const d = this.store.data;
    const replay = this._idem(d, userId, idempotencyKey);
    if (replay) return replay;

    const { acct } = this._authorize(d, userId, pin);

    const amountMinor = toMinor(Number(amountINR));
    if (!(amountMinor > 0))
      throw new ApiError(400, "bad_amount", "Amount must be greater than zero");

    this._limit(userId, amountMinor, false);

    if (acct.balanceMinor < amountMinor)
      throw new ApiError(402, "insufficient_funds", "Home account balance too low");

    acct.balanceMinor -= amountMinor;

    const paymentId = "pay_" + randomUUID();
    const pye = payee && payee.name ? payee : { name: "Payee", type: kind || "upi" };

    const { block, anchor } = this.ledger.append({
      type: "domestic_payment",
      paymentId,
      userId,
      kind: kind || "upi",
      payee: pye,
      amountMinor,
      legs: doubleEntryLegs({
        userId, totalMinor: amountMinor, feeMinor: 0,
        principalMinor: amountMinor, clearingAccount: "clearing:domestic:upi",
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
      status: "settled",
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
      settledAt: Date.now(),
    };

    d.payments[paymentId] = receipt;
    if (idempotencyKey) d.idempotency[scopedIdem(userId, idempotencyKey)] = paymentId;
    this._auditSettle(receipt);
    this.store.persist();

    return { replayed: false, receipt };
  }

  // ---- Add money (balance top-up) ----
  // The ONLY way a balance is ever funded — there is no invented opening
  // balance anywhere. In sandbox mode the credit books against the
  // funding:sandbox account (double-entry, zero-sum) and the receipt is
  // clearly stamped settlementMode:"sandbox". When a licensed PSP is
  // integrated, this same flow becomes the gateway-backed load.
  topup({ userId, pin, idempotencyKey, amountINR }) {
    const d = this.store.data;
    const replay = this._idem(d, userId, idempotencyKey);
    if (replay) return replay;

    const { acct } = this._authorize(d, userId, pin);

    const amountMinor = toMinor(Number(amountINR));
    if (!(amountMinor > 0))
      throw new ApiError(400, "bad_amount", "Amount must be greater than zero");

    if (this.limitsCheck) this.limitsCheck(this.store, userId, amountMinor, { intl: false, kind: "topup" });

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
      settledAt: Date.now(),
    };

    d.payments[paymentId] = receipt;
    if (idempotencyKey) d.idempotency[scopedIdem(userId, idempotencyKey)] = paymentId;
    if (this.audit) {
      this.audit.append("balance_topup", {
        paymentId, userId, amountMinor, mode: this.settlementMode,
      });
    }
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

  payRequest({ userId, requestId, pin, idempotencyKey }) {
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
    });
    r.status = "paid";
    r.paymentId = out.receipt.paymentId;
    this.store.persist();
    return out;
  }

  history(userId) {
    return Object.values(this.store.data.payments)
      .filter((p) => p.userId === userId)
      .sort((a, b) => b.settledAt - a.settledAt);
  }
}
