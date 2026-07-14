// UPI QR parsing (NPCI deep-link spec): merchant and P2P QR codes encode an
// `upi://pay?...` URI. We extract only the fields the payment flow needs and
// validate them defensively — QR contents are untrusted input.
//   pa = payee VPA (required)     pn = payee name
//   am = amount (optional)        tn = note        cu = currency (INR)
export function parseUpiQr(data) {
  const s = String(data || "").trim();
  if (!/^upi:\/\/pay\?/i.test(s)) return null;
  const params = {};
  for (const kv of s.slice(s.indexOf("?") + 1).split("&")) {
    const eq = kv.indexOf("=");
    if (eq <= 0) continue;
    const key = kv.slice(0, eq).toLowerCase();
    let val = kv.slice(eq + 1).replace(/\+/g, " ");
    try { val = decodeURIComponent(val); } catch { /* keep raw */ }
    params[key] = val;
  }

  // VPA: local@handle — the one field we must have and must be sane
  const vpa = (params.pa || "").trim();
  if (!/^[a-z0-9][a-z0-9.\-_]{0,63}@[a-z][a-z0-9]{1,63}$/i.test(vpa)) return null;

  // currency: UPI is INR; refuse anything else rather than mischarge
  if (params.cu && params.cu.toUpperCase() !== "INR") return null;

  // amount: optional; must be a positive number with <= 2 decimals if present
  let amount = null;
  if (params.am !== undefined && params.am !== "") {
    const n = Number(params.am);
    if (!Number.isFinite(n) || n <= 0 || n > 1e7) return null;
    if (Math.round(n * 100) !== Number((n * 100).toFixed(6))) return null;
    amount = n;
  }

  // name/note: display-only — cap length, strip control chars
  const clean = (v, max) => String(v || "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max).trim();

  return {
    vpa,
    name: clean(params.pn, 80) || vpa,
    amount,
    note: clean(params.tn, 120),
  };
}
