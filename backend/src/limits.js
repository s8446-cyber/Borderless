// Transaction limits + daily velocity controls. Protects against fat-finger
// errors, account draining, and abnormal money movement.
import { config } from "./config.js";
import { ApiError } from "./fx.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function checkTxnLimits(store, userId, amountMinor, opts, now = Date.now()) {
  const o = opts || {};
  const L = config.limits;
  if (!(amountMinor > 0)) throw new ApiError(400, "bad_amount", "Amount must be greater than zero");
  if (amountMinor < L.perTxnMinMinor) {
    throw new ApiError(400, "below_min", "Amount is below the minimum allowed");
  }
  const perMax = o.intl ? L.intlPerTxnMaxMinor : L.perTxnMaxMinor;
  if (amountMinor > perMax) {
    throw new ApiError(403, "limit_exceeded", "Amount exceeds the per-transaction limit");
  }
  const since = now - DAY_MS;
  const today = Object.values(store.data.payments || {}).filter(
    (p) => p.userId === userId && (p.settledAt || 0) >= since
  );
  const dayTotal = today.reduce((sum, p) => sum + (p.totalMinor || 0), 0);
  if (dayTotal + amountMinor > L.dailyTotalMaxMinor) {
    throw new ApiError(403, "daily_limit", "Daily transfer limit reached");
  }
  if (today.length + 1 > L.dailyCountMax) {
    throw new ApiError(403, "daily_count_limit", "Daily transaction count limit reached");
  }
  return { dayTotalMinor: dayTotal + amountMinor, dayCount: today.length + 1 };
}
