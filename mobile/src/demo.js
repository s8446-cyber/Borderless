// Standalone simulator that mirrors the Borderless Pay backend so the mobile
// app works with no server. Mirrors src/fx.js, payments.js and ledger.js —
// including a REAL SHA-256 hash-chained ledger with per-block Merkle anchors,
// so the in-app "verify this receipt" cryptography is genuine even offline.
// Also mirrors the backend's security behaviors: wrong-PIN lockout (5 fails)
// and 60-second single-use quotes.
import { sha256 } from "./sha256";

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

const LOCK_AFTER_FAILS = 5;
const LOCK_MS = 60_000; // shorter than prod (15 min) so demos recover quickly
const QUOTE_TTL_MS = 60_000;

function freshDb() {
  return {
    user: null,
    account: null,
    pin: null,
    payments: [],
    requests: {},
    quotes: {},
    idem: {},
    chain: [],   // real hash-chained blocks (genesis at index 0)
    anchors: [], // per-block Merkle anchors (anchorEvery = 1, like the backend default)
    pinFails: 0,
    lockUntil: 0,
  };
}
let db = freshDb();

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round2 = (n) => Math.round(n * 100) / 100;
const uid = (p) => p + Math.random().toString(36).slice(2, 12);

// ---- real hash-chained ledger (mirrors backend ledger.js exactly) ----
function hashBlock(b) {
  return sha256(`${b.index}|${b.timestamp}|${JSON.stringify(b.txn)}|${b.prevHash}`);
}

function ensureGenesis() {
  if (db.chain.length) return;
  const g = { index: 0, timestamp: 0, txn: { type: "genesis" }, prevHash: "0".repeat(64) };
  g.hash = hashBlock(g);
  db.chain.push(g);
}

// Append a settlement block and publish its anchor (one block per anchor —
// same as the backend's default anchorEvery=1, so the Merkle path is empty
// and the root equals the block hash; verification is still the real fold).
function appendBlock(txn) {
  ensureGenesis();
  const prev = db.chain[db.chain.length - 1];
  const block = { index: prev.index + 1, timestamp: Date.now(), txn, prevHash: prev.hash };
  block.hash = hashBlock(block);
  db.chain.push(block);
  const anchor = {
    anchorId: "anc_" + db.anchors.length,
    fromIndex: block.index,
    toIndex: block.index,
    merkleRoot: block.hash, // single-leaf Merkle tree
    publishedAt: Date.now(),
    publicTxHash: "0x" + sha256("anchor" + block.index + block.index + Date.now()).slice(0, 40),
  };
  db.anchors.push(anchor);
  return { block, anchor };
}

function verifyChain() {
  ensureGenesis();
  for (let i = 1; i < db.chain.length; i++) {
    const b = db.chain[i];
    if (b.prevHash !== db.chain[i - 1].hash) return { ok: false, reason: "broken link at block " + i };
    if (b.hash !== hashBlock(b)) return { ok: false, reason: "tampered block " + i };
  }
  return { ok: true, blocks: db.chain.length, anchors: db.anchors.length };
}

// ---- security behaviors (parity with backend LoginGuard) ----
function checkPin(pin) {
  const now = Date.now();
  if (db.lockUntil > now) {
    throw new Error("Too many failed attempts. Try again in " + Math.ceil((db.lockUntil - now) / 1000) + "s");
  }
  if (String(pin) !== db.pin) {
    db.pinFails += 1;
    if (db.pinFails >= LOCK_AFTER_FAILS) {
      db.lockUntil = now + LOCK_MS;
      db.pinFails = 0;
      throw new Error("Too many failed attempts. Account locked for " + LOCK_MS / 1000 + "s");
    }
    throw new Error("Incorrect PIN");
  }
  db.pinFails = 0;
  db.lockUntil = 0;
}

function takeQuote(quoteId, kind) {
  const q = db.quotes[quoteId];
  if (!q || Date.now() > q.expiresAt || (kind && q.kind !== kind)) {
    delete db.quotes[quoteId];
    throw new Error("Quote expired — please re-quote");
  }
  delete db.quotes[quoteId]; // single-use, like the backend
  return q;
}

function settle(receiptBase, txn, idempotencyKey) {
  const { block, anchor } = appendBlock(txn);
  const receipt = {
    ...receiptBase,
    settlement: { index: block.index, hash: block.hash },
    anchor: { merkleRoot: anchor.merkleRoot, publicTxHash: anchor.publicTxHash },
    signature: sha256("sig|" + receiptBase.paymentId + "|" + block.hash), // display-only (HMAC needs the server key)
    balanceAfterMinor: db.account.balanceMinor,
    settledAt: Date.now(),
  };
  db.payments.unshift(receipt);
  if (idempotencyKey) db.idem[idempotencyKey] = receipt;
  return { replayed: false, receipt };
}

// Shared domestic (UPI-style) payment: INR -> INR, instant, zero fee.
function domesticPay(body, idempotencyKey, kind, payee) {
  if (idempotencyKey && db.idem[idempotencyKey])
    return { replayed: true, receipt: db.idem[idempotencyKey] };
  checkPin(body.pin);
  const amount = round2(Number(body.amount));
  if (!(amount > 0)) throw new Error("Enter a valid amount");
  if (db.account.balance < amount) throw new Error("Insufficient funds");

  db.account.balance = round2(db.account.balance - amount);
  db.account.balanceMinor = Math.round(db.account.balance * 100);

  const paymentId = uid("pay_");
  return settle(
    {
      paymentId, kind, domestic: true, status: "settled", payee,
      currency: "INR", localAmount: amount, rate: 1,
      amount, fee: 0, total: amount,
      reference: "BP-" + paymentId.slice(4, 10).toUpperCase(),
    },
    { type: "domestic_payment", paymentId, kind, payee, amountMinor: Math.round(amount * 100) },
    idempotencyKey
  );
}

export async function simulate(path, { method = "GET", body = {}, idempotencyKey } = {}) {
  await wait(280);

  if (path === "/api/kyc/verify") {
    if (!body.consent) throw new Error("Please accept the Terms of Service and Privacy Policy to continue");
    ensureGenesis();
    db.user = { id: uid("usr_"), name: body.fullName, consent: { acceptedAt: Date.now(), tosVersion: body.consent.tosVersion || "1.0", privacyVersion: body.consent.privacyVersion || "1.0" } };
    return { userId: db.user.id, token: uid("tok_"), kyc: { status: "verified", level: "tier-1" } };
  }

  if (path === "/api/logout") {
    db = freshDb(); // demo logout = clean slate, ready to re-onboard
    return { ok: true };
  }

  if (path === "/api/account/close") {
    db = freshDb(); // demo closure: everything local is erased
    return { ok: true, note: "Your profile data has been erased and all sessions revoked." };
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
      expiresAt: Date.now() + QUOTE_TTL_MS,
    };
    db.quotes[q.quoteId] = q;
    return q;
  }

  if (path === "/api/payments" && method === "POST") {
    if (idempotencyKey && db.idem[idempotencyKey])
      return { replayed: true, receipt: db.idem[idempotencyKey] };
    checkPin(body.pin);
    const q = takeQuote(body.quoteId);
    if (db.account.balance < q.total) throw new Error("Insufficient funds");

    db.account.balance = round2(db.account.balance - q.total);
    db.account.balanceMinor = Math.round(db.account.balance * 100);

    const paymentId = uid("pay_");
    return settle(
      {
        paymentId, kind: "payment", status: "settled",
        merchant: body.merchant || { name: "Merchant", country: q.currency },
        currency: q.currency, localAmount: q.localAmount, rate: q.rate,
        amount: q.amount, fee: q.fee, total: q.total,
        reference: "BP-" + paymentId.slice(4, 10).toUpperCase(),
      },
      { type: "settlement", paymentId, currency: q.currency, totalMinor: Math.round(q.total * 100) },
      idempotencyKey
    );
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
      expiresAt: Date.now() + QUOTE_TTL_MS,
    };
    db.quotes[q.quoteId] = q;
    return q;
  }

  if (path === "/api/transfers" && method === "POST") {
    if (idempotencyKey && db.idem[idempotencyKey])
      return { replayed: true, receipt: db.idem[idempotencyKey] };
    checkPin(body.pin);
    const q = takeQuote(body.quoteId, "p2p");
    if (db.account.balance < q.total) throw new Error("Insufficient funds");

    db.account.balance = round2(db.account.balance - q.total);
    db.account.balanceMinor = Math.round(db.account.balance * 100);

    const paymentId = uid("pay_");
    const recipient = body.recipient && body.recipient.name ? body.recipient : { name: "Recipient", country: q.recipientCurrency };
    return settle(
      {
        paymentId, kind: "p2p", status: "settled", recipient,
        currency: q.recipientCurrency, recipientAmount: q.recipientAmount,
        localAmount: q.recipientAmount, rate: q.rate,
        amount: q.sendAmount, fee: q.fee, total: q.total,
        reference: "BP-" + paymentId.slice(4, 10).toUpperCase(),
      },
      { type: "p2p_transfer", paymentId, recipientCurrency: q.recipientCurrency, totalMinor: Math.round(q.total * 100) },
      idempotencyKey
    );
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
    if (r.status === "paid") {
      const prev = db.payments.find((p) => p.paymentId === r.paymentId);
      return { replayed: true, receipt: prev || db.payments[0] };
    }
    const out = domesticPay({ pin: body.pin, amount: r.amount }, idempotencyKey, "request", { type: "request", name: r.fromName });
    r.status = "paid";
    r.paymentId = out.receipt.paymentId;
    return out;
  }
  if (path === "/api/contacts") return { contacts: CONTACTS };
  if (path === "/api/billers") return { billers: BILLERS };
  if (path === "/api/operators") return { operators: OPERATORS };

  // ---- trust endpoints: REAL verification math, same as the backend ----
  if (path === "/api/ledger/verify") return verifyChain();
  if (path === "/api/ledger") {
    ensureGenesis();
    const head = db.chain[db.chain.length - 1];
    return { blocks: db.chain.length, anchors: db.anchors.length, head: { index: head.index, hash: head.hash } };
  }
  if (path.startsWith("/api/ledger/proof/")) {
    ensureGenesis();
    const index = Number(path.split("/").pop());
    const block = db.chain[index];
    const anchor = db.anchors.find((a) => a.fromIndex <= index && index <= a.toIndex);
    if (!block || index === 0 || !anchor) throw new Error("Block not found or not anchored yet");
    return {
      blockIndex: index,
      blockHash: block.hash,
      path: [], // single-leaf anchors → empty sibling path (root === block hash)
      anchor: { anchorId: anchor.anchorId, merkleRoot: anchor.merkleRoot, publicTxHash: anchor.publicTxHash, publishedAt: anchor.publishedAt },
    };
  }

  throw new Error("Unknown endpoint " + path);
}
