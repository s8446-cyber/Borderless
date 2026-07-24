// Customer-facing error copy — pure JS, unit-tested in test/errors.test.mjs.
//
// The backend can answer with machine codes ("insufficient_funds") or with
// human sentences. Machine codes and anything that leaks internals (endpoint
// paths, snake_case identifiers) must NEVER reach a customer's screen; this
// module maps known codes to helpful copy and falls back to a safe generic
// message for anything unrecognizably internal.

const CODE_COPY = {
  insufficient_funds: "You don't have enough balance for this payment. Add money and try again.",
  wallet_locked: "Your wallet is locked after too many incorrect PIN attempts. Contact support to unlock it.",
  incorrect_pin: "That PIN is incorrect. Try again — 5 wrong attempts lock your wallet.",
  session_expired: "Your session has expired — please sign in again.",
  unauthorized: "Your session has expired — please sign in again.",
  rate_limited: "Too many attempts. Please wait a moment and try again.",
  too_many_requests: "Too many attempts. Please wait a moment and try again.",
  quote_expired: "The exchange-rate lock expired. We'll fetch you a fresh quote.",
  sanctions_blocked: "This payment can't be completed. Please contact support for assistance.",
  screening_blocked: "This payment can't be completed. Please contact support for assistance.",
  risk_blocked: "This payment was declined by our security checks. Contact support if you believe this is a mistake.",
  pending_review: "This payment is being held for a quick security review. We'll notify you as soon as it completes.",
  purpose_code_required: "Please choose a purpose for this international transfer.",
  limit_exceeded: "This payment exceeds your current transaction limit.",
  daily_limit_exceeded: "You've reached your daily payment limit. Try again tomorrow or contact support.",
  payee_name_mismatch: "The account holder's name doesn't match the bank's records. Double-check the details before paying.",
  payee_unverified: "We couldn't verify this payee yet. Double-check the details before paying.",
  cooling_period: "This payee was added recently, so larger payments are limited for the first 24 hours — a standard fraud protection.",
  request_failed: "Something went wrong. Please try again.",
  network_offline: "You appear to be offline. Check your connection and try again.",
};

const GENERIC = CODE_COPY.request_failed;

// True when the string looks like an internal identifier rather than a
// sentence meant for humans (machine codes, endpoint paths, JSON-ish).
function looksInternal(msg) {
  if (/\/api\//i.test(msg)) return true;               // endpoint leak
  if (/^[a-z0-9_.:\-]+$/i.test(msg) && !/\s/.test(msg)) return true; // bare code
  if (/^[{[]/.test(msg)) return true;                   // serialized JSON
  return false;
}

export function humanError(raw, fallback) {
  const msg = String((raw && raw.message) || raw || "").trim();
  if (!msg) return fallback || GENERIC;
  const code = msg.toLowerCase().replace(/\s+/g, "_");
  if (CODE_COPY[code]) return CODE_COPY[code];
  if (looksInternal(msg)) return fallback || GENERIC;
  return msg; // already a human sentence written for customers
}

export const ERROR_COPY = CODE_COPY;
