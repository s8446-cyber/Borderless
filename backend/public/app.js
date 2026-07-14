// Borderless Pay web client — a CSP-safe, framework-free PWA that talks to the
// real backend API. Full feature parity with the React Native app:
//   • Pay abroad (cross-border FX)        • Send abroad (P2P)
//   • Domestic UPI: phone / UPI ID / bank / scan QR
//   • Bills & recharge                     • Request money + pay incoming requests
//   • Contacts, activity history, ledger integrity check
//
// CSP note: the page is served with `script-src 'self'` and no inline handlers,
// so all event wiring is delegated here (no `onclick=` attributes anywhere).

// Service worker (kept here to satisfy the strict CSP — no inline <script>).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}

const API = ""; // same origin

// ---- demo directories (mirror the backend / mobile theme) ----
const CORRIDORS = {
  AED: { flag: "🇦🇪", country: "Dubai, UAE", merchant: "Al Masa Restaurant", amount: 80, sym: "AED" },
  SGD: { flag: "🇸🇬", country: "Singapore", merchant: "Maxwell Food Centre", amount: 18, sym: "S$" },
  EUR: { flag: "🇫🇷", country: "Paris, France", merchant: "Café de Flore", amount: 24, sym: "€" },
  NPR: { flag: "🇳🇵", country: "Kathmandu, Nepal", merchant: "Himalayan Java", amount: 850, sym: "Rs" },
};
const P2P_CURRENCIES = [
  { code: "AED", flag: "🇦🇪", sym: "AED" },
  { code: "SGD", flag: "🇸🇬", sym: "S$" },
  { code: "EUR", flag: "🇪🇺", sym: "€" },
  { code: "NPR", flag: "🇳🇵", sym: "Rs" },
  { code: "USD", flag: "🇺🇸", sym: "$" },
  { code: "GBP", flag: "🇬🇧", sym: "£" },
];
const OPERATORS = ["Airtel", "Jio", "Vi", "BSNL"];
const BILL_CATEGORIES = ["Electricity", "Water", "Gas", "Broadband", "DTH", "Credit Card"];
const BILLERS = {
  Electricity: ["Tata Power", "Adani Electricity", "BESCOM"],
  Water: ["Delhi Jal Board", "BWSSB"],
  Gas: ["Indane Gas", "HP Gas", "Mahanagar Gas"],
  Broadband: ["ACT Fibernet", "JioFiber", "Airtel Xstream"],
  DTH: ["Tata Play", "Airtel Digital TV", "Dish TV"],
  "Credit Card": ["HDFC Card", "ICICI Card", "SBI Card", "Axis Card"],
};

const SETTLE_STEPS = [
  "Debit home bank account",
  "Write to settlement ledger (hash-chained)",
  "Anchor proof to public chain (Merkle)",
  "Sign authorization (HMAC)",
  "Pay merchant in local currency",
];
const SEND_STEPS = [
  "Debit home bank account",
  "Write to settlement ledger (hash-chained)",
  "Anchor proof to public chain (Merkle)",
  "Sign authorization (HMAC)",
  "Credit recipient in local currency",
];
const DOMESTIC_STEPS = [
  "Verify payee (UPI / IMPS)",
  "Debit bank account",
  "Write to settlement ledger (hash-chained)",
  "Sign authorization (HMAC)",
  "Credit payee instantly",
];

const EMPTY_FORM = {
  payeeName: "", phone: "", vpa: "", account: "", ifsc: "",
  amount: "", note: "", operator: "Airtel", billCategory: "Electricity",
  biller: "", consumerId: "",
};

const state = {
  screen: "welcome",
  token: null,
  name: "",
  consent: false,
  bank: "HDFC Bank",
  newPin: "",
  pin: "",
  account: null,
  history: [],
  contacts: [],
  requests: [],
  corridor: "AED",
  quote: null,
  receipt: null,
  flow: "pay", // pay | send | domestic
  p2p: { recipientName: "", currency: "AED", sendAmount: "" },
  domIntent: null,
  form: { ...EMPTY_FORM },
  scanning: false,
  camActive: false,
};

// ---- helpers ----
const app = () => document.getElementById("app");
const fmtINR = (n) =>
  "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = (s) =>
  String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const symFor = (code) => (P2P_CURRENCIES.find((p) => p.code === code) || { sym: code }).sym;

// Stable per-browser device identifier (G-3). The session issued at KYC is
// bound to it server-side; every call presents it via the x-device-id header.
const DEVICE_ID = (() => {
  try {
    let id = localStorage.getItem("bp_device_id");
    if (!id) {
      id = "web-" + crypto.randomUUID();
      localStorage.setItem("bp_device_id", id);
    }
    return id;
  } catch {
    return "web-" + Math.random().toString(36).slice(2);
  }
})();

async function api(path, { method = "GET", body, idempotencyKey } = {}) {
  const headers = { "content-type": "application/json", "x-device-id": DEVICE_ID };
  if (state.token) headers.authorization = "Bearer " + state.token;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || "Request failed");
  return data;
}

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.style.display = "none"), 3200);
}

function go(screen) {
  if (screen !== "scanDom") stopCam(); // never leave the camera running off-screen
  state.screen = screen;
  render();
}

function setModel(path, value) {
  const parts = path.split(".");
  let obj = state;
  for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
  obj[parts[parts.length - 1]] = value;
}

// ---- component builders (return HTML strings) ----
const brand = () => `<div class="brand"><div class="logo">🌍</div> Borderless Pay</div>`;
const card = (inner, extra = "") => `<div class="card" ${extra}>${inner}</div>`;
const row = (label, value, opt = {}) =>
  `<div class="row ${opt.big ? "total" : ""}"><span class="lbl">${label}</span>` +
  `<span class="val ${opt.accent ? "accent" : ""}">${value}</span></div>`;
const primary = (label, action, arg = "") =>
  `<button class="btn" data-action="${action}" ${arg !== "" ? `data-arg="${esc(arg)}"` : ""}>${label}</button>`;
const field = (label, model, opt = {}) =>
  `<label>${label}</label><input data-model="${model}" value="${esc(opt.value ?? "")}" ` +
  `placeholder="${esc(opt.placeholder || "")}" ${opt.type ? `type="${opt.type}"` : ""} ` +
  `${opt.inputmode ? `inputmode="${opt.inputmode}"` : ""} ${opt.autocap ? "" : 'autocapitalize="none"'} />`;

function chips(group, value, options) {
  return (
    `<div class="chips">` +
    options
      .map(
        (o) =>
          `<button class="chip ${o.value === value ? "active" : ""}" data-action="chip" ` +
          `data-group="${group}" data-arg="${esc(o.value)}">${o.label}</button>`
      )
      .join("") +
    `</div>`
  );
}

const pinDots = (filled, total = 4) =>
  `<div class="pindots" id="pindots">` +
  Array.from({ length: total }).map((_, i) => `<span class="${i < filled ? "filled" : ""}"></span>`).join("") +
  `</div>`;

function pinPad(action) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", ""];
  return (
    `<div class="pinpad">` +
    keys
      .map((k) =>
        k === ""
          ? `<span></span>`
          : `<button class="key" data-action="${action}" data-key="${k}">${k === "del" ? "⌫" : k}</button>`
      )
      .join("") +
    `</div>`
  );
}

const scanner = () =>
  `<div class="scanner"><div class="scanline"></div>` +
  `<div class="qrbox">${Array.from({ length: 25 }).map(() => "<i></i>").join("")}</div></div>`;

// ---- transaction helpers ----
function txnIcon(p) {
  return { p2p: "💸", payment: "🧳", bill: "🧾", recharge: "📲", request: "🔁" }[p.kind] || "✅";
}
function txnName(p) {
  if (p.domestic) return p.payee ? p.payee.name : "Payment";
  if (p.kind === "p2p") return p.recipient ? p.recipient.name : "Transfer";
  return p.merchant ? p.merchant.name : "Merchant";
}
function txnTag(p) {
  return p.kind === "p2p" ? "sent" : p.domestic ? "paid" : "settled";
}
function historyList(history) {
  if (!history || !history.length) return `<p class="muted" style="padding:14px 0">No payments yet.</p>`;
  return history
    .map(
      (p) => `
      <div class="txn">
        <div style="display:flex;align-items:center">
          <div class="t-ic">${txnIcon(p)}</div>
          <div><div style="font-weight:600">${esc(txnName(p))}</div>
          <div class="muted" style="font-size:12px">${esc(p.currency)} • ${esc(p.reference)}</div></div>
        </div>
        <div style="text-align:right"><div style="font-weight:700">${fmtINR(p.total)}</div>
        <div class="accent" style="font-size:11px">${txnTag(p)}</div></div>
      </div>`
    )
    .join("");
}

// ---- screens ----
function screenWelcome() {
  return `
    ${brand()}
    <h1>Pay anywhere, straight from your bank.</h1>
    <p class="sub">Spend at home and abroad at the real mid-market rate with a flat 0.5% fee — ₹0 on domestic UPI. No wallets, no hidden FX markup, no surprises.</p>
    ${card(
      row("🏦 Direct from your bank", "✓", { accent: true }) +
        row("💱 Mid-market FX rate", "✓", { accent: true }) +
        row("🔒 Triple-secure ledger", "✓", { accent: true })
    )}
    <label>Your name</label>
    <input data-model="name" value="${esc(state.name)}" placeholder="Aarav Shah" autocapitalize="words" />
    <label class="consent-row">
      <input type="checkbox" id="consent-box" ${state.consent ? "checked" : ""} />
      <span>I agree to the Terms of Service and Privacy Policy (v1.0)</span>
    </label>
    <p class="consent-links"><a href="/terms.html" target="_blank" rel="noopener">Read the Terms ↗</a> · <a href="/privacy.html" target="_blank" rel="noopener">Read the Privacy Policy ↗</a></p>
    ${primary("Verify identity (KYC) →", "start-kyc")}
    <p class="api-note">Calls real POST /api/kyc/verify • your consent is recorded and versioned</p>`;
}

function screenLink() {
  return `
    <h2>Link your home bank</h2>
    <p class="sub">We connect via secure open-banking consent. Your money stays in your bank until you pay.</p>
    <label>Bank</label>
    ${chips("bank", state.bank, [
      { value: "HDFC Bank", label: "HDFC" },
      { value: "ICICI Bank", label: "ICICI" },
      { value: "State Bank of India", label: "SBI" },
      { value: "Axis Bank", label: "Axis" },
    ])}
    <label>Create a 4-digit payment PIN</label>
    ${pinDots(state.newPin.length)}
    ${pinPad("newpin-key")}
    ${primary("Link account", "link-bank")}
    <p class="api-note">Calls real POST /api/accounts/link • PIN stored as scrypt hash</p>`;
}

function actionTile(icon, label, action, arg = "", intl = false) {
  return `<button class="tile ${intl ? "intl" : ""}" data-action="${action}" ${arg !== "" ? `data-arg="${esc(arg)}"` : ""}>
    <span class="tile-ic">${icon}</span><span class="tile-lbl">${label}</span></button>`;
}

function screenHome() {
  const a = state.account;
  const incoming = state.requests.find((r) => r.direction === "incoming" && r.status === "pending");
  const peopleRow = state.contacts.length
    ? `<div class="section">People</div><div class="people">` +
      state.contacts
        .map(
          (ct, i) =>
            `<button class="person" data-action="pay-contact" data-arg="${i}">
              <span class="avatar">${esc(ct.initials)}</span>
              <span class="person-name">${esc(ct.name.split(" ")[0])}</span></button>`
        )
        .join("") +
      `</div>`
    : "";
  const incomingCard = incoming
    ? card(
        `<div style="font-weight:700;margin-bottom:4px">💰 ${esc(incoming.fromName)} requested ${fmtINR(incoming.amount)}</div>
         <div class="muted" style="font-size:13px;margin-bottom:10px">${esc(incoming.note || "Payment request")}</div>
         ${primary("Pay " + fmtINR(incoming.amount), "pay-request", incoming.id)}`,
        'style="border-color:var(--accent)"'
      )
    : "";
  return `
    ${brand()}
    ${card(
      `<span class="muted">Available to spend</span>
       <div class="balance">${fmtINR(a ? a.balance : 0)}</div>
       <span class="pill">${a ? esc(a.bank) + " • " + esc(a.maskedNumber) : "Bank"}</span>
       <div class="badge-secure"><span>🔐 scrypt PIN</span><span>⛓️ dual ledger</span><span>✍️ HMAC signed</span></div>`
    )}
    ${incomingCard}
    <div class="section">Money transfer</div>
    <div class="grid">
      ${actionTile("📷", "Scan QR", "start-scan-dom")}
      ${actionTile("📱", "To phone", "dom", "phone")}
      ${actionTile("🆔", "To UPI ID", "dom", "upiid")}
      ${actionTile("🏦", "To bank", "dom", "bank")}
      ${actionTile("🔁", "Request", "dom", "request")}
    </div>
    <div class="section">Recharge &amp; bills</div>
    <div class="grid">
      ${actionTile("📲", "Recharge", "dom", "recharge")}
      ${actionTile("🧾", "Pay bills", "dom", "bill")}
      ${actionTile("💡", "Electricity", "dom", "bill")}
      ${actionTile("📺", "DTH", "dom", "bill")}
    </div>
    <div class="section">International 🌍</div>
    <div class="grid">
      ${actionTile("💸", "Send abroad", "start-send", "", true)}
      ${actionTile("🧳", "Pay abroad", "start-scan-intl", "", true)}
      ${actionTile("🔎", "Verify", "verify-ledger", "", true)}
      ${actionTile("🚪", "Log out", "logout", "", true)}
    </div>
    ${peopleRow}
    <div class="section">Recent</div>
    ${historyList(state.history)}
    <p class="api-note"><a href="#" data-action="close-account" style="color:var(--muted)">Close account &amp; erase my data</a> · <a href="/privacy.html" target="_blank" rel="noopener" style="color:var(--muted)">Privacy</a> · <a href="/terms.html" target="_blank" rel="noopener" style="color:var(--muted)">Terms</a></p>`;
}

function screenScanDom() {
  const camSupported = Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.BarcodeDetector);
  if (state.camActive) {
    return `
      <h2>Scan any UPI QR</h2>
      <div class="scanner" id="cam-holder"><div class="spinner"></div></div>
      <p class="api-note">Point at any UPI QR — payee and amount fill in automatically. Nothing is photographed or stored.</p>
      <button class="btn secondary" data-action="cam-stop">Stop camera</button>
      <button class="btn secondary" data-action="dom" data-arg="upiid">Enter UPI ID instead</button>`;
  }
  return `
    <h2>Scan any UPI QR</h2>
    ${scanner()}
    ${
      state.scanning
        ? `<div class="spinner"></div>`
        : `${camSupported ? `<button class="btn" data-action="cam-scan">📷 Scan a real QR with the camera</button>` : ""}
          ${card(
            row("Merchant", "Cafe Coffee Day") +
              row("UPI ID", "ccd@bpl") +
              row("Status", "✓ Demo merchant", { accent: true })
          )}
          ${primary("Enter amount (demo QR)", "scan-continue-dom")}
          ${camSupported ? "" : `<p class="api-note">Live camera scanning needs a browser with BarcodeDetector (Chrome/Edge). The demo QR works everywhere.</p>`}`
    }`;
}

function screenScanIntl() {
  const c = CORRIDORS[state.corridor];
  return `
    <h2>Pay abroad</h2>
    <label>Corridor</label>
    ${chips(
      "corridor",
      state.corridor,
      Object.keys(CORRIDORS).map((k) => ({ value: k, label: CORRIDORS[k].flag + " " + k }))
    )}
    ${scanner()}
    ${
      state.scanning
        ? `<div class="spinner"></div>`
        : `${card(
            row("Merchant", esc(c.merchant)) +
              row("Location", c.flag + " " + esc(c.country)) +
              row("Status", "✓ Verified merchant", { accent: true })
          )}
          ${primary("Continue", "scan-continue-intl")}`
    }`;
}

function screenSend() {
  return `
    <h2>Send money abroad</h2>
    <p class="sub">Send to anyone abroad, straight from your bank at the real mid-market rate.</p>
    <label>Recipient name</label>
    <input data-model="p2p.recipientName" value="${esc(state.p2p.recipientName)}" placeholder="e.g. Sara Khan" autocapitalize="words" />
    <label>They receive in</label>
    ${chips("p2pCurrency", state.p2p.currency, P2P_CURRENCIES.map((x) => ({ value: x.code, label: x.flag + " " + x.code })))}
    <label>Amount to send (₹ INR)</label>
    <input data-model="p2p.sendAmount" value="${esc(state.p2p.sendAmount)}" placeholder="1000" inputmode="decimal" />
    ${primary("Get quote →", "send-quote")}`;
}

function screenCompose() {
  const d = state.domIntent;
  if (!d) return "";
  const f = state.form;
  let fields = "";
  if (d.kind === "phone" || d.kind === "request") {
    fields += field(d.kind === "request" ? "Request from (name or phone)" : "Phone number", "form.phone", {
      value: f.phone, placeholder: "+91 98765 43210", inputmode: d.kind === "request" ? "text" : "tel",
    });
  }
  if (d.kind === "upiid") fields += field("UPI ID", "form.vpa", { value: f.vpa, placeholder: "name@bank" });
  if (d.kind === "bank") {
    fields +=
      field("Account holder name", "form.payeeName", { value: f.payeeName, placeholder: "e.g. Meera Joshi", autocap: true }) +
      field("Account number", "form.account", { value: f.account, placeholder: "00112233445566", inputmode: "numeric" }) +
      field("IFSC code", "form.ifsc", { value: f.ifsc, placeholder: "HDFC0001234" });
  }
  if (d.kind === "recharge") {
    fields +=
      `<label>Operator</label>` + chips("operator", f.operator, OPERATORS.map((o) => ({ value: o, label: o }))) +
      field("Mobile number", "form.phone", { value: f.phone, placeholder: "+91 98765 43210", inputmode: "tel" });
  }
  if (d.kind === "bill") {
    fields +=
      `<label>Category</label>` + chips("billCategory", f.billCategory, BILL_CATEGORIES.map((o) => ({ value: o, label: o }))) +
      `<label>Biller</label>` + chips("biller", f.biller, (BILLERS[f.billCategory] || []).map((o) => ({ value: o, label: o }))) +
      field("Consumer / account number", "form.consumerId", { value: f.consumerId, placeholder: "Consumer ID" });
  }
  fields += field("Amount (₹)", "form.amount", { value: f.amount, placeholder: "0", inputmode: "decimal" });
  if (["phone", "upiid", "contact", "bank", "merchant"].includes(d.kind))
    fields += field("Note (optional)", "form.note", { value: f.note, placeholder: "What's it for?", autocap: true });

  const amt = Number(f.amount) || 0;
  const isRequest = d.kind === "request";
  return `
    <h2>${esc(d.title)}</h2>
    ${d.sub ? `<p class="sub">${esc(d.sub)}</p>` : ""}
    ${fields}
    ${card(
      row("You pay", `<span id="pay-amount">${fmtINR(amt)}</span>`, { accent: true, big: true }) +
        row("Fee", "₹0 • Free", { accent: true }) +
        row("Speed", "Instant")
    )}
    ${
      isRequest
        ? primary("Send request", "submit-request")
        : `<button class="btn" data-action="proceed-domestic">Proceed to pay <span id="btn-pay-amount">${fmtINR(amt)}</span></button>`
    }`;
}

function screenQuote() {
  const q = state.quote;
  if (!q) return "";
  if (q.kind === "p2p") {
    return `
      <h2>Confirm transfer</h2>
      <p class="sub">To ${esc(state.p2p.recipientName || "your recipient")}</p>
      ${card(
        row("They receive", symFor(q.recipientCurrency) + " " + q.recipientAmount.toLocaleString(), { accent: true }) +
          row("Exchange rate (mid-market)", "1 " + q.recipientCurrency + " = ₹" + q.rate) +
          row("You send", fmtINR(q.sendAmount)) +
          row("FX markup", "₹0.00", { accent: true }) +
          row("Borderless fee (0.5%)", fmtINR(q.fee)) +
          row("Total from bank", fmtINR(q.total), { accent: true, big: true })
      )}
      <p class="api-note accent">Real rate, no markup — they get every rupee converted fairly.</p>
      ${primary("Slide to send 🔒", "quote-pay")}`;
  }
  const c = CORRIDORS[state.corridor];
  const cardCost = q.amount * 1.035 + 200;
  return `
    <h2>Confirm payment</h2>
    <p class="sub">${esc(c.merchant)}</p>
    ${card(
      row("They charge", c.sym + " " + c.amount.toLocaleString()) +
        row("Exchange rate (mid-market)", "1 " + state.corridor + " = ₹" + q.rate, { accent: true }) +
        row("Converted amount", fmtINR(q.amount)) +
        row("FX markup", "₹0.00", { accent: true }) +
        row("Borderless fee (0.5%)", fmtINR(q.fee)) +
        row("Total from bank", fmtINR(q.total), { accent: true, big: true })
    )}
    <p class="api-note accent">You save ~${fmtINR(cardCost - q.total)} vs a typical bank card</p>
    ${primary("Slide to pay 🔒", "quote-pay")}`;
}

function screenAuth() {
  return `
    <h2 style="text-align:center">🔒 Authorize</h2>
    <p class="sub" style="text-align:center">Face ID + enter your PIN</p>
    <div style="font-size:54px;text-align:center;margin:10px">👤</div>
    ${pinDots(state.pin.length)}
    ${pinPad("pin-key")}`;
}

function screenSettle() {
  const steps = state.flow === "send" ? SEND_STEPS : state.flow === "domestic" ? DOMESTIC_STEPS : SETTLE_STEPS;
  return `
    <h2 style="text-align:center">Settling securely…</h2>
    <ul class="steps" id="settle-steps">
      ${steps.map((t, i) => `<li><span class="dot">${i + 1}</span> ${t}</li>`).join("")}
    </ul>
    <div class="spinner"></div>`;
}

function screenReceipt() {
  const r = state.receipt;
  if (!r) return "";
  const payeeName = r.domestic
    ? "to " + (r.payee ? r.payee.name : "payee")
    : r.kind === "p2p"
    ? "to " + (r.recipient ? r.recipient.name : "recipient")
    : "to " + (r.merchant ? r.merchant.name : "merchant");
  const detail =
    (r.kind === "p2p"
      ? row("They received", symFor(r.currency) + " " + r.recipientAmount.toLocaleString(), { accent: true })
      : "") +
    (!r.domestic ? row("Rate", "1 " + r.currency + " = ₹" + r.rate) : "") +
    (r.domestic && r.payee && r.payee.category ? row("Category", esc(r.payee.category)) : "") +
    row("Fee", r.domestic ? "₹0 • Free" : fmtINR(r.fee), { accent: r.domestic }) +
    row("Reference", esc(r.reference));
  return `
    <div class="receipt-check">✓</div>
    <h2 style="text-align:center">${r.kind === "p2p" ? "Sent" : "Paid"} ${fmtINR(r.total)}</h2>
    <p class="sub" style="text-align:center">${esc(payeeName)}</p>
    ${card(detail)}
    ${card(
      `<span class="muted" style="font-size:12px">Settlement ledger hash</span>
       <div class="hashrow">${esc(r.settlement.hash)}</div>
       <span class="muted" style="font-size:12px">Public anchor (tx)</span>
       <div class="hashrow">${r.anchor ? esc(r.anchor.publicTxHash) : "(batched in next anchor)"}</div>
       <span class="muted" style="font-size:12px">Authorization signature</span>
       <div class="hashrow">${esc(r.signature.slice(0, 40))}…</div>
       <div id="proof-result"></div>
       <button class="btn secondary" data-action="verify-receipt">🔎 Verify this receipt independently</button>
       <p class="api-note">Recomputes the Merkle proof from /api/ledger/proof — no trust in this app required.
       <a href="/verify.html?index=${r.settlement.index}&hash=${esc(r.settlement.hash)}" target="_blank" rel="noopener">Or verify on the public explorer ↗</a></p>`
    )}
    ${primary("Done", "receipt-done")}`;
}

function screenHistory() {
  return `<h2>Activity</h2>${historyList(state.history)}`;
}

const SCREENS = {
  welcome: screenWelcome,
  link: screenLink,
  home: screenHome,
  scanDom: screenScanDom,
  scanIntl: screenScanIntl,
  send: screenSend,
  compose: screenCompose,
  quote: screenQuote,
  auth: screenAuth,
  settle: screenSettle,
  receipt: screenReceipt,
  history: screenHistory,
};

const TAB_SCREENS = ["home", "scanDom", "scanIntl", "send", "compose", "quote", "receipt", "history"];

function render() {
  const fn = SCREENS[state.screen] || screenWelcome;
  app().innerHTML = fn();
  app().scrollTop = 0;

  const tabbar = document.getElementById("tabbar");
  if (TAB_SCREENS.includes(state.screen)) {
    tabbar.hidden = false;
    tabbar.innerHTML = `
      <button data-action="tab" data-arg="home" class="${state.screen === "home" ? "active" : ""}"><span class="ic">🏠</span>Home</button>
      <button data-action="tab" data-arg="scanDom" class="${state.screen === "scanDom" || state.screen === "scanIntl" ? "active" : ""}"><span class="ic">📷</span>Scan</button>
      <button data-action="tab" data-arg="history" class="${state.screen === "history" ? "active" : ""}"><span class="ic">📜</span>Activity</button>`;
  } else {
    tabbar.hidden = true;
    tabbar.innerHTML = "";
  }
}

// ---- data ----
async function refresh() {
  state.account = await api("/api/accounts");
  const h = await api("/api/payments");
  state.history = h.payments || [];
  try {
    const cts = await api("/api/contacts");
    state.contacts = cts.contacts || [];
    const rq = await api("/api/requests");
    state.requests = rq.requests || [];
  } catch (e) {
    /* contacts / requests are optional */
  }
}

// ---- flows ----
async function handleKyc() {
  if (!state.consent) return toast("Please accept the Terms & Privacy Policy first");
  try {
    const r = await api("/api/kyc/verify", {
      method: "POST",
      body: {
        fullName: state.name || "Aarav Shah", documentId: "P" + Date.now(), country: "IN",
        deviceId: DEVICE_ID,
        consent: { tosVersion: "1.0", privacyVersion: "1.0" },
      },
    });
    state.token = r.token;
    go("link");
  } catch (e) {
    toast(e.message);
  }
}

async function handleLink() {
  if (state.newPin.length !== 4) return toast("Set a 4-digit PIN first");
  try {
    await api("/api/accounts/link", { method: "POST", body: { bank: state.bank, pin: state.newPin, openingBalance: 250000 } });
    await refresh();
    go("home");
  } catch (e) {
    toast(e.message);
  }
}

function startScanDom() {
  state.flow = "domestic";
  state.scanning = true;
  state.camActive = false;
  go("scanDom");
  setTimeout(() => { state.scanning = false; if (state.screen === "scanDom") render(); }, 1500);
}

// ---- real camera QR scanning (BarcodeDetector, where the browser has it) ----
// UPI QR parsing — same validation rules as the mobile app (mobile/src/upi.js).
function parseUpiQr(data) {
  const s = String(data || "").trim();
  if (!/^upi:\/\/pay\?/i.test(s)) return null;
  const params = {};
  for (const kv of s.slice(s.indexOf("?") + 1).split("&")) {
    const eq = kv.indexOf("=");
    if (eq <= 0) continue;
    let val = kv.slice(eq + 1).replace(/\+/g, " ");
    try { val = decodeURIComponent(val); } catch {}
    params[kv.slice(0, eq).toLowerCase()] = val;
  }
  const vpa = (params.pa || "").trim();
  if (!/^[a-z0-9][a-z0-9.\-_]{0,63}@[a-z][a-z0-9]{1,63}$/i.test(vpa)) return null;
  if (params.cu && params.cu.toUpperCase() !== "INR") return null;
  let amount = null;
  if (params.am !== undefined && params.am !== "") {
    const n = Number(params.am);
    if (!Number.isFinite(n) || n <= 0 || n > 1e7) return null;
    if (Math.round(n * 100) !== Number((n * 100).toFixed(6))) return null;
    amount = n;
  }
  const clean = (v, max) => String(v || "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, max).trim();
  return { vpa, name: clean(params.pn, 80) || vpa, amount, note: clean(params.tn, 120) };
}

let camStream = null;
function stopCam() {
  if (camStream) {
    camStream.getTracks().forEach((t) => t.stop());
    camStream = null;
  }
  state.camActive = false;
}

async function startCamScan() {
  state.camActive = true;
  render();
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
  } catch (e) {
    stopCam();
    render();
    toast("Camera unavailable or denied — the demo QR still works");
    return;
  }
  const holder = document.getElementById("cam-holder");
  if (!holder || !camStream) { stopCam(); return; }
  holder.innerHTML = `<video id="cam-video" autoplay playsinline muted style="width:100%;height:100%;object-fit:cover;border-radius:18px"></video>`;
  const video = document.getElementById("cam-video");
  video.srcObject = camStream;
  const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
  let lastHint = 0;
  const loop = async () => {
    if (!camStream || state.screen !== "scanDom") { stopCam(); return; }
    try {
      const codes = await detector.detect(video);
      for (const c of codes) {
        const parsed = parseUpiQr(c.rawValue);
        if (parsed) {
          stopCam();
          state.form = { ...EMPTY_FORM, payeeName: parsed.name, vpa: parsed.vpa, amount: parsed.amount ? String(parsed.amount) : "", note: parsed.note };
          state.domIntent = { kind: "upiid", title: parsed.name, sub: parsed.vpa + " • Scanned QR" };
          go("compose");
          return;
        }
        if (Date.now() - lastHint > 2500) { lastHint = Date.now(); toast("Not a UPI payment QR — keep pointing at a upi://pay QR"); }
      }
    } catch (e) { /* detector hiccup — keep looping */ }
    setTimeout(loop, 160);
  };
  video.addEventListener("loadedmetadata", () => setTimeout(loop, 250));
}

function startScanIntl() {
  state.flow = "pay";
  state.scanning = true;
  go("scanIntl");
  setTimeout(() => { state.scanning = false; if (state.screen === "scanIntl") render(); }, 1700);
}

function startSend() {
  state.flow = "send";
  state.p2p = { recipientName: "", currency: "AED", sendAmount: "" };
  go("send");
}

async function getTransferQuote() {
  const amt = Number(state.p2p.sendAmount);
  if (!(amt > 0)) return toast("Enter an amount to send");
  try {
    const q = await api("/api/transfers/quote", { method: "POST", body: { recipientCurrency: state.p2p.currency, sendAmount: amt } });
    state.quote = q;
    go("quote");
  } catch (e) {
    toast(e.message);
  }
}

async function getQuote() {
  const c = CORRIDORS[state.corridor];
  try {
    const q = await api("/api/quotes", { method: "POST", body: { currency: state.corridor, localAmount: c.amount } });
    state.quote = q;
    go("quote");
  } catch (e) {
    toast(e.message);
  }
}

function startDom(kind) {
  state.form = { ...EMPTY_FORM };
  state.flow = "domestic";
  const map = {
    phone: { title: "Pay by phone number", sub: "Sends instantly via UPI" },
    upiid: { title: "Pay to UPI ID", sub: "e.g. name@bank" },
    bank: { title: "Bank transfer", sub: "To any account + IFSC (IMPS / NEFT)" },
    recharge: { title: "Mobile recharge", sub: "Prepaid top-up" },
    bill: { title: "Pay bills", sub: "Electricity, water, gas, broadband & more" },
    request: { title: "Request money", sub: "Ask someone to pay you" },
  };
  const m = map[kind] || { title: "Pay", sub: "" };
  state.domIntent = { kind, title: m.title, sub: m.sub };
  go("compose");
}

function payContact(i) {
  const ct = state.contacts[i];
  if (!ct) return;
  state.flow = "domestic";
  state.form = { ...EMPTY_FORM, payeeName: ct.name, phone: ct.phone, vpa: ct.vpa };
  state.domIntent = { kind: "contact", title: "Pay " + ct.name, sub: ct.vpa || ct.phone };
  go("compose");
}

function payIncomingRequest(id) {
  const r = state.requests.find((x) => x.id === id);
  if (!r) return;
  state.flow = "domestic";
  state.form = { ...EMPTY_FORM, amount: String(r.amount) };
  state.domIntent = { kind: "payrequest", requestId: r.id, title: "Pay request", sub: r.fromName + (r.note ? " • " + r.note : "") };
  openAuth();
}

async function submitRequest() {
  const amount = Number(state.form.amount);
  if (!(amount > 0)) return toast("Enter an amount to request");
  try {
    await api("/api/requests", {
      method: "POST",
      body: { amount, fromName: state.form.payeeName || state.form.phone || "Someone", note: state.form.note },
    });
    await refresh();
    toast("Request sent — we'll notify you when it's paid.");
    go("home");
  } catch (e) {
    toast(e.message);
  }
}

function proceedDomestic() {
  const amount = Number(state.form.amount);
  if (!(amount > 0)) return toast("Enter an amount to pay");
  state.flow = "domestic";
  openAuth();
}

function buildDomesticRequest() {
  const amount = Number(state.form.amount);
  const f = state.form;
  const k = state.domIntent ? state.domIntent.kind : "upi";
  if (k === "payrequest") return { endpoint: "/api/requests/pay", body: { requestId: state.domIntent.requestId } };
  if (k === "recharge") return { endpoint: "/api/recharge", body: { amount, recharge: { operator: f.operator, number: f.phone, plan: "Custom" } } };
  if (k === "bill") return { endpoint: "/api/bills/pay", body: { amount, biller: { category: f.billCategory, name: f.biller || f.billCategory, consumerId: f.consumerId } } };
  let payee;
  if (k === "bank") payee = { kind: "bank", type: "bank", name: f.payeeName || "Bank account", account: f.account, ifsc: f.ifsc };
  else if (k === "upiid") payee = { kind: "upi", type: "upi", name: f.vpa || "UPI ID", vpa: f.vpa };
  else if (k === "phone") payee = { kind: "upi", type: "phone", name: f.payeeName || f.phone || "Payee", phone: f.phone };
  else if (k === "merchant") payee = { kind: "upi", type: "merchant", name: f.payeeName || "Merchant" };
  else payee = { kind: "upi", type: "contact", name: f.payeeName || "Payee", phone: f.phone, vpa: f.vpa };
  return { endpoint: "/api/upi/pay", body: { amount, payee } };
}

async function openAuth() {
  state.pin = "";
  go("auth");
}

function onPinKey(pad, k) {
  const key = pad === "newpin" ? "newPin" : "pin";
  let v = state[key];
  v = k === "del" ? v.slice(0, -1) : v.length < 4 ? v + k : v;
  state[key] = v;
  const dots = document.querySelectorAll("#pindots span");
  dots.forEach((s, i) => s.classList.toggle("filled", i < v.length));
  if (pad === "pin" && v.length === 4) setTimeout(authorize, 180);
}

async function authorize() {
  state.flow = state.flow || "pay";
  go("settle");
  animateSteps();
  const steps = state.flow === "send" ? SEND_STEPS : state.flow === "domestic" ? DOMESTIC_STEPS : SETTLE_STEPS;
  const idem = "idem_" + Date.now() + "_" + Math.random().toString(36).slice(2);
  const c = CORRIDORS[state.corridor];
  try {
    let endpoint, body;
    if (state.flow === "domestic") {
      const built = buildDomesticRequest();
      endpoint = built.endpoint;
      body = { ...built.body, pin: state.pin };
    } else if (state.flow === "send") {
      endpoint = "/api/transfers";
      body = { quoteId: state.quote.quoteId, pin: state.pin, recipient: { name: state.p2p.recipientName || "Recipient", country: state.p2p.currency } };
    } else {
      endpoint = "/api/payments";
      body = { quoteId: state.quote.quoteId, pin: state.pin, merchant: { name: c.merchant, country: state.corridor } };
    }
    const r = await api(endpoint, { method: "POST", idempotencyKey: idem, body });
    setTimeout(async () => {
      state.receipt = r.receipt;
      await refresh();
      go("receipt");
    }, steps.length * 520 + 300);
  } catch (e) {
    toast(e.message);
    setTimeout(() => {
      if (state.flow === "domestic")
        go(state.domIntent && state.domIntent.kind !== "payrequest" ? "compose" : "home");
      else go("quote");
    }, 400);
  }
}

function animateSteps() {
  const items = document.querySelectorAll("#settle-steps li");
  items.forEach((li, i) => setTimeout(() => li.classList.add("done"), 500 + i * 520));
}

async function verifyLedger() {
  try {
    const v = await api("/api/ledger/verify");
    const l = await api("/api/ledger");
    toast(v.ok ? `✓ Ledger intact — ${l.blocks} blocks, ${l.anchors} anchors` : "✗ " + v.reason);
  } catch (e) {
    toast(e.message);
  }
}

// ---- independent receipt verification (G-4) ----
// Recomputes the Merkle inclusion proof CLIENT-SIDE with Web Crypto: the
// receipt's settlement hash is walked up the sibling path and must land
// exactly on the published anchor root. The server is not trusted for the
// math — only for serving the proof, which is itself pinned by the anchor.
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyReceipt() {
  const r = state.receipt;
  const el = document.getElementById("proof-result");
  if (!r || !r.settlement || !el) return;
  el.innerHTML = `<div class="hashrow">Verifying…</div>`;
  try {
    const p = await api("/api/ledger/proof/" + r.settlement.index);
    if (p.blockHash !== r.settlement.hash) throw new Error("Ledger block hash does not match this receipt");
    let h = p.blockHash;
    for (const step of p.path) {
      h = step.right ? await sha256Hex(h + step.hash) : await sha256Hex(step.hash + h);
    }
    if (h !== p.anchor.merkleRoot) throw new Error("Merkle path does not reach the anchor root");
    el.innerHTML = `<div class="hashrow" style="color:var(--accent)">✓ Independently verified — this settlement is committed under anchor ${esc(p.anchor.anchorId)} (root ${esc(p.anchor.merkleRoot.slice(0, 16))}…), published as ${esc(p.anchor.publicTxHash)}</div>`;
  } catch (e) {
    el.innerHTML = `<div class="hashrow" style="color:#ff6b6b">✗ Verification failed: ${esc(e.message)}</div>`;
  }
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST" });
  } catch (e) {}
  state.token = null;
  state.account = null;
  state.history = [];
  state.requests = [];
  state.consent = false;
  toast("Logged out — session revoked server-side");
  go("welcome");
}

// DPDP consent withdrawal: erase profile PII + revoke all sessions.
// Transaction records are retained pseudonymously as required by law.
async function closeAccount() {
  const sure = window.confirm(
    "Close your account?\n\nYour profile data is erased immediately and every session is revoked. " +
    "Transaction records are retained pseudonymously as required by law. This cannot be undone."
  );
  if (!sure) return;
  try {
    await api("/api/account/close", { method: "POST" });
  } catch (e) {
    return toast("Could not close account: " + e.message);
  }
  state.token = null;
  state.account = null;
  state.history = [];
  state.requests = [];
  state.consent = false;
  toast("Account closed — profile data erased");
  go("welcome");
}

async function goActivity() {
  try {
    await refresh();
  } catch (e) {}
  go("history");
}

// ---- chip selection ----
function onChip(group, value) {
  if (group === "bank") state.bank = value;
  else if (group === "corridor") state.corridor = value;
  else if (group === "p2pCurrency") state.p2p.currency = value;
  else if (group === "operator") state.form.operator = value;
  else if (group === "biller") state.form.biller = value;
  else if (group === "billCategory") {
    state.form.billCategory = value;
    state.form.biller = "";
  }
  render();
}

// ---- event delegation ----
const ACTIONS = {
  "start-kyc": handleKyc,
  "link-bank": handleLink,
  "start-scan-dom": startScanDom,
  "start-scan-intl": startScanIntl,
  "start-send": startSend,
  "send-quote": getTransferQuote,
  "scan-continue-intl": getQuote,
  "scan-continue-dom": () => {
    state.flow = "domestic";
    state.form = { ...EMPTY_FORM, payeeName: "Cafe Coffee Day" };
    state.domIntent = { kind: "merchant", title: "Cafe Coffee Day", sub: "ccd@bpl • Verified merchant" };
    go("compose");
  },
  dom: (arg) => startDom(arg),
  "pay-contact": (arg) => payContact(Number(arg)),
  "pay-request": (arg) => payIncomingRequest(arg),
  "submit-request": submitRequest,
  "proceed-domestic": proceedDomestic,
  "quote-pay": openAuth,
  "verify-ledger": verifyLedger,
  "cam-scan": startCamScan,
  "cam-stop": () => { stopCam(); render(); },
  "close-account": closeAccount,
  "verify-receipt": verifyReceipt,
  logout,
  "receipt-done": () => go("home"),
  tab: (arg) => (arg === "scanDom" ? startScanDom() : arg === "history" ? goActivity() : go(arg)),
};

document.addEventListener("click", (e) => {
  const target = e.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const arg = target.dataset.arg;
  if (action === "chip") return onChip(target.dataset.group, arg);
  if (action === "newpin-key") return onPinKey("newpin", target.dataset.key);
  if (action === "pin-key") return onPinKey("pin", target.dataset.key);
  const fn = ACTIONS[action];
  if (fn) {
    if (target.tagName === "A") e.preventDefault();
    fn(arg);
  }
});

document.addEventListener("change", (e) => {
  if (e.target && e.target.id === "consent-box") state.consent = e.target.checked;
});

document.addEventListener("input", (e) => {
  const t = e.target;
  if (!t.dataset || !t.dataset.model) return;
  setModel(t.dataset.model, t.value);
  // live-update the domestic "you pay" preview without a full re-render
  if (t.dataset.model === "form.amount") {
    const amt = fmtINR(Number(t.value) || 0);
    const a = document.getElementById("pay-amount");
    const b = document.getElementById("btn-pay-amount");
    if (a) a.textContent = amt;
    if (b) b.textContent = amt;
  }
});

render();
