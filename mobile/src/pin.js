// Payment-PIN quality rules (pure JS — unit-tested in test/pin.test.mjs).
// Banks reject trivially guessable PINs; so do we. Returns null when the PIN
// is acceptable, or a human-readable reason when it must be rejected.
export function pinIssue(pin) {
  const p = String(pin || "");
  if (!/^\d{4}$/.test(p)) return "Your PIN must be exactly 4 digits.";
  if (/^(\d)\1{3}$/.test(p)) return "All four digits are the same — that's the first PIN a thief tries. Pick another.";
  const d = [...p].map(Number);
  const step = d[1] - d[0];
  if ((step === 1 || step === -1) && d[2] - d[1] === step && d[3] - d[2] === step) {
    return "Sequential digits (like 1234 or 4321) are too easy to guess. Pick another.";
  }
  // straight lines on a phone keypad — the classic "pattern" PINs
  if (p === "2580" || p === "0852") {
    return "That keypad pattern is one of the most common PINs. Pick another.";
  }
  return null;
}
