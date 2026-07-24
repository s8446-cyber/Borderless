// Shareable receipt text — pure JS, unit-tested in test/receipt-text.test.mjs.
//
// Follows the payment-review hierarchy: recipient first, then amount,
// rate & fee, total debit, funding account, settlement status, help — and
// only after all of that, the technical verification details.

function fmtINR(n) {
  return (
    "\u20b9" +
    Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}

export function receiptRecipient(receipt) {
  if (!receipt) return "";
  if (receipt.kind === "topup") return "Your Borderless balance";
  if (receipt.domestic) return (receipt.payee && receipt.payee.name) || "Payee";
  if (receipt.kind === "p2p") return (receipt.recipient && receipt.recipient.name) || "Recipient";
  return (receipt.merchant && receipt.merchant.name) || "Merchant";
}

export function buildReceiptShareText(receipt, { fundingLabel = "", appName = "Borderless Pay" } = {}) {
  if (!receipt) return "";
  const lines = [];
  const verb = receipt.kind === "topup" ? "Added" : receipt.kind === "p2p" ? "Sent" : "Paid";
  lines.push(appName + " receipt \u2014 " + verb + " " + fmtINR(receipt.total));
  lines.push("");
  lines.push("To: " + receiptRecipient(receipt));
  if (!receipt.domestic && receipt.currency && receipt.recipientAmount !== undefined) {
    lines.push("They received: " + receipt.currency + " " + Number(receipt.recipientAmount).toLocaleString());
  }
  lines.push("Amount: " + fmtINR(receipt.amount !== undefined ? receipt.amount : receipt.total));
  if (!receipt.domestic && receipt.rate) {
    lines.push("Rate: 1 " + receipt.currency + " = \u20b9" + receipt.rate + " (mid-market, no markup)");
  }
  lines.push("Fee: " + (receipt.domestic ? "\u20b90 (free)" : fmtINR(receipt.fee)));
  lines.push("Total debit: " + fmtINR(receipt.total));
  if (fundingLabel) lines.push("From: " + fundingLabel);
  lines.push(
    "Status: " +
      (receipt.status && receipt.status !== "completed"
        ? receipt.status
        : receipt.settlementMode === "sandbox"
          ? "Completed (sandbox \u2014 simulated rails)"
          : "Completed")
  );
  if (receipt.reference) lines.push("Reference: " + receipt.reference);
  lines.push("");
  lines.push("Need help with this payment? Open Activity \u2192 the payment \u2192 Get help.");
  const tech = [];
  if (receipt.settlement && receipt.settlement.hash) tech.push("Ledger hash: " + receipt.settlement.hash);
  if (receipt.anchor && receipt.anchor.publicTxHash) tech.push("Public anchor: " + receipt.anchor.publicTxHash);
  if (receipt.signature) tech.push("Signature: " + String(receipt.signature).slice(0, 40) + "\u2026");
  if (tech.length) {
    lines.push("");
    lines.push("\u2014 Technical verification \u2014");
    lines.push(...tech);
  }
  return lines.join("\n");
}
