// PSP (payment service provider) connector layer + authenticated webhooks.
//
// The sandbox transport settles instantly (the behavior the app always had).
// The connector adds what a REAL rail integration needs and the sandbox never
// exercised: an "unknown outcome" state when the PSP fails to answer (money
// may or may not have moved — the most dangerous state in payments), status
// re-queries with exponential backoff, and Stripe-style signed webhooks so an
// asynchronous PSP callback can finalize an in-doubt payment.
//
// Transport contract (sync in the reference implementation; a real adapter
// wraps its async call + Promise.race timeout and reports "unknown" on
// timeout instead of throwing):
//   settle({ paymentId, amountMinor })  → { status: "settled" | "failed" | "unknown", reason? }
//   queryStatus(paymentId)              → { status: "settled" | "failed" | "unknown" }
import { createHmac, timingSafeEqual } from "node:crypto";
import { ApiError } from "./fx.js";

export class PspConnector {
  constructor(opts = {}) {
    this.timeoutMs = opts.timeoutMs ?? 5000;
    this.maxAttempts = opts.maxAttempts ?? 5;
    this.retryBaseMs = opts.retryBaseMs ?? 60000;
    this.transport = opts.transport || {
      settle: () => ({ status: "settled" }),
      queryStatus: () => ({ status: "settled" }),
    };
  }

  // Never throws for transport failures: an in-doubt payment is a STATE to
  // recover, not an exception to swallow.
  settle(payment) {
    try {
      const res = this.transport.settle(payment);
      if (res && res.status === "settled") return { status: "settled" };
      if (res && res.status === "failed") return { status: "failed", reason: res.reason || "psp_declined" };
      return { status: "unknown", reason: (res && res.reason) || "psp_unrecognized_response" };
    } catch (e) {
      return { status: "unknown", reason: "psp_error:" + String(e && e.message).slice(0, 80) };
    }
  }

  queryStatus(paymentId) {
    try {
      const res = this.transport.queryStatus(paymentId);
      if (res && ["settled", "failed", "unknown"].includes(res.status)) return res;
      return { status: "unknown" };
    } catch {
      return { status: "unknown" };
    }
  }

  nextRetryAt(attempts, now = Date.now()) {
    return now + this.retryBaseMs * Math.pow(2, Math.min(attempts, 6));
  }
}

// ---- signed webhooks ----
// Scheme (Stripe-style): signature = HMAC-SHA256(secret, timestamp + "." + rawBody)
// sent as `x-psp-signature` with `x-psp-timestamp`. Verification enforces a
// constant-time compare, a ±5 minute timestamp window, and (in the server)
// event-id replay rejection. No secret configured ⇒ the endpoint does not
// exist (fail-closed), so an unauthenticated webhook can never move money.
export function signWebhook(secret, timestamp, rawBody) {
  return createHmac("sha256", secret).update(String(timestamp) + "." + rawBody).digest("hex");
}

export function verifyWebhook({ secret, timestamp, signature, rawBody, now = Date.now(), toleranceMs = 300000 }) {
  if (!secret) throw new ApiError(404, "not_found", "Not found");
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > toleranceMs) {
    throw new ApiError(401, "webhook_bad_timestamp", "Webhook timestamp missing or outside tolerance");
  }
  const expected = signWebhook(secret, timestamp, rawBody);
  const a = Buffer.from(String(signature || ""), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ApiError(401, "webhook_bad_signature", "Webhook signature verification failed");
  }
  return true;
}
