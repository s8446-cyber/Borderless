// Standalone simulator that mirrors the Borderless Pay backend so the mobile
// app works with no server. Mirrors src/fx.js, payments.js and ledger.js logic.
const RATES = { AED: 23.2, SGD: 64.1, EUR: 90.4, NPR: 0.625, USD: 83.4, GBP: 105.7 };

// Domestic (India) directories for the UPI-style flows.
const CONTACTS = [
  { name: "Ananya Iyer", phone: "+91 98\u2022\u2022\u2022\u2022 2104", vpa: "ananya@bpl", initials: "AI" },
  { name: "Rohan Mehta", phone: "+91 99\u2022\u2022\u2022\u2022 7781", vpa: "rohan@bpl", initials: "RM" },
  { name: "Priya Nair", phone: "+91 90\u2022\u2022\u2022\u2022 4452", vpa: "priya@bpl", initials: "PN" },
  { name: "Vikram Singh", phone: "+91 70\u2022\u2022\u2022\u2022 9930", vpa: "vikram@bpl", initials: "VS" },
  { name: "Sara Khan", phone: "+91 88\u2022\u2022\u2022\u2022 1207", vpa: "sara@bpl", initials: "SK" },
];
const BILLERS = [
  { category: "Electricity", names: ["Tata Power", "Adani Electricity", "BESCOM"] },
  { category: "Water", names: ["Delhi Jal Board", "BWSSB"] },
  { category: "Gas", names: ["Indane Gas", "HP Gas", "Mahanagar Gas"] },
  { category: "Broadband", names: ["ACT Fibernet", "JioFiber", "Airtel Xstream"] },
  { category: "DTH", names: ["Tata Play", "Airtel Digital TV", "Dish TV"] },
];
const OPERATORS = ["Airtel", "Jio", "Vi", "BSNL"];

const db = {
  user: null,
  account: null,
  pin: null,
  payments: [],
  requests: {},
  quotes: {},
  idem: {},
  blocks: 1, // genesis
  anchors: 0,
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round2 = (n) => Math.round(n * 100) / 100;
const uid = (p) => p + Math.random().toString(36).slice(2, 12);

// Deterministic 64-hex pseudo-hash (FNV-1a expanded) — for demo display only.
function hx(seed) {
  let h = 0x811c9dc5 >>> 0;
  const s = String(seed);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  let out = "";
  let x = h;
  for (let i = 0; i < 8; i++) {
    x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d) >>> 0;
    out += ("00000000" + x.toString(16)).slice(-8);
  }
  return out.slice(0, 64);
}

// Shared domestic (UPI-style) payment: INR -> INR, instant, zero fee.
function domesticPay(body, idempotencyKey, kind, payee) {
  if (idempotencyKey && db.idem[idempotencyKey])
    return { replayed: true, receipt: db.idem[idempotencyKey] };
  if (String(body.pin) !== db.pin) throw new Error("Incorrect PIN");
  const amount = round2(Number(body.amount));
  if (!(amount > 0)) throw new Error("Enter a valid amount");
  if (db.account.balance < amount) throw new Error("Insufficient funds");

  db.account.balance = round2(db.account.balance - amount);
  db.account.balanceMinor = Math.round(db.account.balance * 100);

  const paymentId = uid("pay_");
  db.blocks += 1;
  db.anchors += 1;
  const receipt = {
    paymentId,
    kind,
    domestic: true,
    status: "settled",
    payee,
    currency: "INR",
    localAmount: amount,
    rate: 1,
    amount,
    fee: 0,
    total: amount,
    reference: "BP-" + paymentId.slice(4, 10).toUpperCase(),
    settlement: { index: db.blocks - 1, hash: hx(paymentId) },
    anchor: { merkleRoot: hx("mr" + paymentId), publicTxHash: "0x" + hx("anc" + paymentId).slice(0, 40) },
    signature: hx("sig" + paymentId),
    balanceAfterMinor: db.account.balanceMinor,
    settledAt: Date.now(),
  };
  db.payments.unshift(receipt);
  if (idempotencyKey) db.idem[idempotencyKey] = receipt;
  return { replayed: false, receipt };
}

export async function simulate(path, { method = "GET", body = {}, idempotencyKey } = {}) {
  await wait(280);

  if (path === "/api/kyc/verify") {
    db.user = { id: uid("usr_"), name: body.fullName };
    return { userId: db.user.id, token: uid("tok_"), kyc: { status: "verified", level: "tier-1" } };
  }

  if (path === "/api/accounts/link") {
    db.pin = String(body.pin);
    const opening = body.openingBalance ?? 250000;
    db.account = {
      bank: body.bank,
      maskedNumber: "••••" + Math.floor(1000 + Math.random() * 9000),
      balance: opening,
      balanceMinor: Math.round(opening * 100),
    };
    // seed a sample incoming collect request for demo realism
    const rid0 = uid("req_");
    db.requests[rid0] = { id: rid0, fromName: "Rohan Mehta", amount: 450, note: "Dinner split \ud83c\udf55", status: "pending", direction: "incoming", createdAt: Date.now() };
    return { bank: db.account.bank, maskedNumber: db.account.maskedNumber, balance: db.account.balance };
  }

  if (path === "/api/accounts") {
    if (!db.account) throw new Error("No account linked");
    return { ...db.account };
  }

  if (path === "/api/quotes") {
    const rate = RATES[body.currency];
    if (!rate) throw new Error("Unsupported currency");
    const amount = round2(body.localAmount * rate);
    const fee = round2(clamp(amount * 0.005, 2, 500));
    const total = round2(amount + fee);
    const q = {
      quoteId: uid("q_"),
      currency: body.currency,
      localAmount: body.localAmount,
      rate,
      amount,
      fee,
      total,
      fxMarkupMinor: 0,
      expiresAt: Date.now() + 60000,
    };
    db.quotes[q.quoteId] = q;
    return q;
  }

  if (path === "/api/payments" && method === "POST") {
    if (idempotencyKey && db.idem[idempotencyKey])
      return { replayed: true, receipt: db.idem[idempotencyKey] };
    if (String(body.pin) !== db.pin) throw new Error("Incorrect PIN");
    const q = db.quotes[body.quoteId];
    if (!q) throw new Error("Quote expired — please re-quote");
    if (db.account.balance < q.total) throw new Error("Insufficient funds");

    db.account.balance = round2(db.account.balance - q.total);
    db.account.balanceMinor = Math.round(db.account.balance * 100);

    const paymentId = uid("pay_");
    db.blocks += 1;
    db.anchors += 1;
    const receipt = {
      paymentId,
      kind: "payment",
      status: "settled",
      merchant: body.merchant || { name: "Merchant", country: q.currency },
      currency: q.currency,
      localAmount: q.localAmount,
      rate: q.rate,
      amount: q.amount,
      fee: q.fee,
      total: q.total,
      reference: "BP-" + paymentId.slice(4, 10).toUpperCase(),
      settlement: { index: db.blocks - 1, hash: hx(paymentId) },
      anchor: { merkleRoot: hx("mr" + paymentId), publicTxHash: "0x" + hx("anc" + paymentId).slice(0, 40) },
      signature: hx("sig" + paymentId),
      balanceAfterMinor: db.account.balanceMinor,
      settledAt: Date.now(),
    };
    db.payments.unshift(receipt);
    if (idempotencyKey) db.idem[idempotencyKey] = receipt;
    return { replayed: false, receipt };
  }

  if (path === "/api/payments" && method === "GET") {
    return { payments: db.payments };
  }

  if (path === "/api/transfers/quote") {
    const rate = RATES[body.recipientCurrency];
    if (!rate) throw new Error("Unsupported currency");
    const sendAmount = round2(body.sendAmount);
    const fee = round2(clamp(sendAmount * 0.005, 2, 500));
    const total = round2(sendAmount + fee);
    const recipientAmount = round2(sendAmount / rate);
    const q = {
      quoteId: uid("q_"),
      kind: "p2p",
      recipientCurrency: body.recipientCurrency,
      rate,
      sendAmount,
      recipientAmount,
      fee,
      total,
      fxMarkupMinor: 0,
      expiresAt: Date.now() + 60000,
    };
    db.quotes[q.quoteId] = q;
    return q;
  }

  if (path === "/api/transfers" && method === "POST") {
    if (idempotencyKey && db.idem[idempotencyKey])
      return { replayed: true, receipt: db.idem[idempotencyKey] };
    if (String(body.pin) !== db.pin) throw new Error("Incorrect PIN");
    const q = db.quotes[body.quoteId];
    if (!q || q.kind !== "p2p") throw new Error("Quote expired — please re-quote");
    if (db.account.balance < q.total) throw new Error("Insufficient funds");

    db.account.balance = round2(db.account.balance - q.total);
    db.account.balanceMinor = Math.round(db.account.balance * 100);

    const paymentId = uid("pay_");
    db.blocks += 1;
    db.anchors += 1;
    const recipient = body.recipient && body.recipient.name ? body.recipient : { name: "Recipient", country: q.recipientCurrency };
    const receipt = {
      paymentId,
      kind: "p2p",
      status: "settled",
      recipient,
      currency: q.recipientCurrency,
      recipientAmount: q.recipientAmount,
      localAmount: q.recipientAmount,
      rate: q.rate,
      amount: q.sendAmount,
      fee: q.fee,
      total: q.total,
      reference: "BP-" + paymentId.slice(4, 10).toUpperCase(),
      settlement: { index: db.blocks - 1, hash: hx(paymentId) },
      anchor: { merkleRoot: hx("mr" + paymentId), publicTxHash: "0x" + hx("anc" + paymentId).slice(0, 40) },
      signature: hx("sig" + paymentId),
      balanceAfterMinor: db.account.balanceMinor,
      settledAt: Date.now(),
    };
    db.payments.unshift(receipt);
    if (idempotencyKey) db.idem[idempotencyKey] = receipt;
    return { replayed: false, receipt };
  }

  // ---- Domestic (UPI-style) endpoints ----
  if (path === "/api/upi/pay" && method === "POST") {
    const p = body.payee || {};
    return domesticPay(body, idempotencyKey, p.kind || "upi", { ...p, name: p.name || "Payee" });
  }
  if (path === "/api/bills/pay" && method === "POST") {
    const b = body.biller || {};
    return domesticPay(body, idempotencyKey, "bill", { type: "bill", name: b.name || b.category || "Biller", category: b.category, consumerId: b.consumerId });
  }
  if (path === "/api/recharge" && method === "POST") {
    const rc = body.recharge || {};
    return domesticPay(body, idempotencyKey, "recharge", { type: "recharge", name: (rc.operator || "Operator") + " " + (rc.number || ""), operator: rc.operator, number: rc.number, plan: rc.plan });
  }
  if (path === "/api/requests" && method === "POST") {
    const id = uid("req_");
    const r = { id, fromName: body.fromName || "Someone", amount: round2(Number(body.amount)), note: body.note || "", status: "pending", direction: "outgoing", createdAt: Date.now() };
    db.requests[id] = r;
    return { request: r };
  }
  if (path === "/api/requests" && method === "GET") {
    return { requests: Object.values(db.requests).sort((a, b) => b.createdAt - a.createdAt) };
  }
  if (path === "/api/requests/pay" && method === "POST") {
    const r = db.requests[body.requestId];
    if (!r) throw new Error("Request not found");
    if (r.status === "paid") return { replayed: true, receipt: db.idem[r.paymentId] || db.payments[0] };
    const out = domesticPay({ pin: body.pin, amount: r.amount }, idempotencyKey, "request", { type: "request", name: r.fromName });
    r.status = "paid";
    r.paymentId = out.receipt.paymentId;
    return out;
  }
  if (path === "/api/contacts") return { contacts: CONTACTS };
  if (path === "/api/billers") return { billers: BILLERS };
  if (path === "/api/operators") return { operators: OPERATORS };

  if (path === "/api/ledger/verify") return { ok: true, blocks: db.blocks, anchors: db.anchors };
  if (path === "/api/ledger") return { blocks: db.blocks, anchors: db.anchors };

  throw new Error("Unknown endpoint " + path);
}
