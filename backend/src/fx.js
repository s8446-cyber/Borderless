// FX quote engine.
// Rates are "home currency (INR) per 1 unit of foreign currency", mid-market.
// In production these come from a live aggregated feed; here they are static
// but the math, fee policy, and quote lifecycle are real.
import { toMinor, fromMinor, pctOfMinor, clamp } from "./money.js";
import { randomUUID } from "node:crypto";

// mid-market INR per unit
export const RATES = {
  AED: 23.20,
  SGD: 64.10,
  EUR: 90.40,
  NPR: 0.625,
  USD: 83.40,
  GBP: 105.70,
};

export const FEE_PCT = 0.005;        // 0.5%
export const FEE_MIN_MINOR = 200;    // ₹2.00 floor
export const FEE_MAX_MINOR = 50000;  // ₹500.00 cap
export const QUOTE_TTL_MS = 60_000;  // rate locked for 60s

const HOME_DECIMALS = 2; // INR

export function listCurrencies() {
  return Object.keys(RATES);
}

// localAmount is a decimal in the foreign currency (e.g. 80.00 AED)
export function createQuote(currency, localAmount) {
  const rate = RATES[currency];
  if (!rate) throw new ApiError(400, "unsupported_currency", `No rate for ${currency}`);
  if (!(localAmount > 0)) throw new ApiError(400, "invalid_amount", "Amount must be > 0");

  // amount the user pays in INR minor units, before fee
  const amountMinor = Math.round(localAmount * rate * 10 ** HOME_DECIMALS);
  const rawFee = pctOfMinor(amountMinor, FEE_PCT);
  const feeMinor = clamp(rawFee, FEE_MIN_MINOR, FEE_MAX_MINOR);
  const totalMinor = amountMinor + feeMinor;

  const now = Date.now();
  return {
    quoteId: "q_" + randomUUID(),
    currency,
    localAmount: Number(localAmount),
    rate,
    fxMarkupMinor: 0,            // explicit: we never mark up the rate
    amountMinor,                // converted, pre-fee
    feePct: FEE_PCT,
    feeMinor,
    totalMinor,
    homeCurrency: "INR",
    createdAt: now,
    expiresAt: now + QUOTE_TTL_MS,
  };
}

// P2P transfer quote: the sender enters the INR amount to send; the recipient
// receives the converted amount in their local currency. The fee is charged on
// the INR principal, at the same transparent 0.5% (floor/cap) policy.
export function createP2PQuote(recipientCurrency, sendAmountINR) {
  const rate = RATES[recipientCurrency];
  if (!rate) throw new ApiError(400, "unsupported_currency", `No rate for ${recipientCurrency}`);
  if (!(sendAmountINR > 0)) throw new ApiError(400, "invalid_amount", "Amount must be > 0");

  const sendAmountMinor = Math.round(sendAmountINR * 10 ** HOME_DECIMALS); // INR principal
  const rawFee = pctOfMinor(sendAmountMinor, FEE_PCT);
  const feeMinor = clamp(rawFee, FEE_MIN_MINOR, FEE_MAX_MINOR);
  const totalMinor = sendAmountMinor + feeMinor;
  // recipient receives the principal converted at the mid-market rate
  const recipientAmount = Math.round((sendAmountMinor / 10 ** HOME_DECIMALS / rate) * 100) / 100;

  const now = Date.now();
  return {
    quoteId: "q_" + randomUUID(),
    kind: "p2p",
    recipientCurrency,
    rate,
    sendAmountMinor,
    recipientAmount,
    fxMarkupMinor: 0,
    feePct: FEE_PCT,
    feeMinor,
    totalMinor,
    homeCurrency: "INR",
    createdAt: now,
    expiresAt: now + QUOTE_TTL_MS,
  };
}

export function isQuoteValid(quote, now = Date.now()) {
  return !!quote && now <= quote.expiresAt;
}

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
