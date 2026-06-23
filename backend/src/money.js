// All money handled in MINOR units (paise/fils/cents) as integers to avoid
// floating-point drift. Conversion helpers live here.

export function toMinor(amount, decimals = 2) {
  return Math.round(Number(amount) * 10 ** decimals);
}
export function fromMinor(minor, decimals = 2) {
  return Number(minor) / 10 ** decimals;
}

// Bankers-free simple round-half-up for fee calc in minor units.
export function pctOfMinor(minor, pct) {
  return Math.round(minor * pct);
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function formatINR(minor) {
  return "₹" + fromMinor(minor).toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}
