// Client-side input validation & sanitization for payment forms.
// Pure JS — unit-tested in test/validation.test.mjs.
//
// The backend remains the authority on every rule; these checks exist to
// catch typos and impossible input BEFORE money moves. Each *Issue() helper
// returns a machine code (mapped to localized copy by the screens) or null
// when the value is acceptable.

// Keep only digits and a single decimal point, capped at 2 decimals — amount
// fields must never hold arbitrary text, no matter how it was entered
// (paste, hardware keyboard, web build).
export function sanitizeAmount(text) {
  let s = String(text || "").replace(/[^\d.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
    const [whole, dec] = s.split(".");
    s = whole + "." + (dec || "").slice(0, 2);
  }
  s = s.replace(/^0+(?=\d)/, ""); // "007" → "7", but keep "0.50"
  if (s.startsWith(".")) s = "0" + s;
  return s;
}

export function amountIssue(text, { min = 1, max = 1e7, balance = null } = {}) {
  const s = String(text || "").trim();
  if (!s) return "amount_empty";
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return "amount_invalid";
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return "amount_invalid";
  if (n < min) return "amount_too_small";
  if (n > max) return "amount_too_large";
  if (balance !== null && n > balance) return "amount_exceeds_balance";
  return null;
}

// Same VPA shape the hardened QR parser accepts (src/upi.js).
export function vpaIssue(vpa) {
  const v = String(vpa || "").trim();
  if (!/^[a-z0-9][a-z0-9.\-_]{0,63}@[a-z][a-z0-9]{1,63}$/i.test(v)) return "vpa_invalid";
  return null;
}

// IFSC: 4 letters + "0" + 6 alphanumerics (RBI format).
export function ifscIssue(code) {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(c)) return "ifsc_invalid";
  return null;
}

// Normalize an Indian mobile number to its 10 significant digits.
export function normalizePhone(phone) {
  let d = String(phone || "").replace(/[^\d]/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  return d;
}

export function phoneIssue(phone) {
  const d = normalizePhone(phone);
  if (!/^[6-9]\d{9}$/.test(d)) return "phone_invalid";
  return null;
}

// Indian bank account numbers are 9–18 digits.
export function accountIssue(account) {
  const a = String(account || "").replace(/\s/g, "");
  if (!/^\d{9,18}$/.test(a)) return "account_invalid";
  return null;
}

// The re-entry confirmation field must match exactly (whitespace ignored).
export function accountsMatch(a, b) {
  const x = String(a || "").replace(/\s/g, "");
  const y = String(b || "").replace(/\s/g, "");
  return x.length > 0 && x === y;
}

export function nameIssue(name) {
  if (String(name || "").trim().length < 2) return "name_invalid";
  return null;
}

export function consumerIdIssue(id) {
  const c = String(id || "").trim();
  if (!/^[A-Za-z0-9\-\/]{4,24}$/.test(c)) return "consumer_invalid";
  return null;
}
