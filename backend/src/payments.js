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

export class PaymentService {
  constructor(store, ledger, opts = {}) {
    this.store = store;
    this.ledger = ledger;
    this.quotes = new Map(); // quoteId -> quote (ephemeral)
    this.guard = opts.guard || null;
    this.audit = opts.audit || null;
    this.limitsCheck = opts.limitsCheck || null;
  }

  // Shared actor checks: existence, KYC, account, lockout, then PIN.
  _authorize(d, userId, pin) {
    const user = d.users[userId];
    if (!user) throw new ApiError(404, "user_not_found", "Unknown user");
    if (user.kyc?.status !== "verified")
      throw new ApiError(403, "kyc_required", "KYC not verified");
    const acct = d.accounts[userId];
    if (!acct) throw new ApiError(409, "no_account", "No bank account linked");

    if (this.guard) this.guard.assertNotLocked(userId);

    if (!verifyPin(pin, d.pins[userId])) {
      let locked = false;
      if (this.guard) {
        const r = this.guard.recordFail(userId);
        locked = r.locked;
        this.store.persist();
      }
      if (this.audit) this.audit.append("pin_failed", { userId, locked });
      throw new ApiError(401, "bad_pin", "Incorrect PIN");
    }
    if (this.guard) this.guard.recordSuccess(userId);
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
    const q = createQuote(currency, localAmount);
    this.quotes.set(q.quoteId, q);
    return q;
  }

  execute({ userId, quoteId, pin, idempotencyKey, merchant }) {
    const d = this.store.data;
    const replay = this._idem(d, userId, idempotencyKey);
    if (replay) return replay;

    const { acct } = this._authorize(d, userId, pin);

    const quote = this.quotes.get(quoteId);
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
      reference: "BP-" + paymentId.slice(4, 10).toUpperCase(),
      settledAt: Date.now(),
    };

    d.payments[paymentId] = receipt;
    if (idempotencyKey) d.idempotency[scopedIdem(userId, idempotencyKey)] = paymentId;
    this.quotes.delete(quoteId);
    this._auditSettle(receipt);
    this.store.persist();

    return { replayed: false, receipt };
  }

  // ---- P2P transfers ----
  quoteTransfer(recipientCurrency, sendAmountINR) {
    const q = createP2PQuote(recipientCurrency, sendAmountINR);
    this.quotes.set(q.quoteId, q);
    return q;
  }

  transfer({ userId, quoteId, pin, idempotencyKey, recipient }) {
    const d = this.store.data;
    const replay = this._idem(d, userId, idempotencyKey);
    if (replay) return replay;

    const { acct } = this._authorize(d, userId, pin);

    const quote = this.quotes.get(quoteId);
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
      reference: "BP-" + transferId.slice(4, 10).toUpperCase(),
      settledAt: Date.now(),
    };

    d.payments[transferId] = receipt;
    if (idempotencyKey) d.idempotency[scopedIdem(userId, idempotencyKey)] = transferId;
    this.quotes.delete(quoteId);
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
      reference: "BP-" + paymentId.slice(4, 10).toUpperCase(),
      settledAt: Date.now(),
    };

    d.payments[paymentId] = receipt;
    if (idempotencyKey) d.idempotency[scopedIdem(userId, idempotencyKey)] = paymentId;
    this._auditSettle(receipt);
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
