// Borderless Pay web client — talks to the real backend API.
// Service worker registration (moved out of inline HTML to satisfy a strict
// Content-Security-Policy of script-src 'self').
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/service-worker.js").catch(function () {});
  });
}

const API = ""; // same origin
let state = { token: null, userId: null, quote: null, pin: "", corridor: "AED", account: null };

const CORRIDORS = {
  AED: { flag: "🇦🇪", country: "Dubai, UAE", merchant: "Al Masa Restaurant", amount: 80, sym: "AED" },
  SGD: { flag: "🇸🇬", country: "Singapore", merchant: "Maxwell Food Centre", amount: 18, sym: "S$" },
  EUR: { flag: "🇫🇷", country: "Paris, France", merchant: "Café de Flore", amount: 24, sym: "€" },
  NPR: { flag: "🇳🇵", country: "Kathmandu, Nepal", merchant: "Himalayan Java", amount: 850, sym: "Rs" },
};

const $ = (id) => document.getElementById(id);
const fmtINR = (n) => "₹" + Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function api(path, { method = "GET", body, idempotencyKey } = {}) {
  const headers = { "content-type": "application/json" };
  if (state.token) headers.authorization = "Bearer " + state.token;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || "Request failed");
  return data;
}

function show(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(id).classList.add("active");
}
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.style.display = "block";
  setTimeout(() => (t.style.display = "none"), 3000);
}

// ---- onboarding ----
async function doKyc() {
  const fullName = $("kyc-name").value.trim() || "Aarav Shah";
  try {
    const r = await api("/api/kyc/verify", { method: "POST", body: { fullName, documentId: "P" + Date.now(), country: "IN" } });
    state.token = r.token; state.userId = r.userId;
    show("screen-link");
  } catch (e) { toast(e.message); }
}

async function linkBank() {
  const bank = $("bank-select").value;
  const pin = state.newPin;
  if (!pin || pin.length !== 4) { toast("Set a 4-digit PIN first"); return; }
  try {
    await api("/api/accounts/link", { method: "POST", body: { bank, pin, openingBalance: 250000 } });
    await refreshHome();
    show("screen-home");
  } catch (e) { toast(e.message); }
}

async function refreshHome() {
  state.account = await api("/api/accounts");
  $("home-balance").textContent = fmtINR(state.account.balance);
  $("home-bank").textContent = state.account.bank + " • " + state.account.maskedNumber;
  await renderHistory();
}

// ---- pay flow ----
function startScan() {
  const c = CORRIDORS[state.corridor];
  $("scan-merchant").textContent = c.merchant;
  $("scan-country").textContent = c.flag + " " + c.country;
  show("screen-scan");
  $("scan-detected").style.display = "none";
  $("scan-spinner").style.display = "block";
  setTimeout(() => {
    $("scan-spinner").style.display = "none";
    $("scan-detected").style.display = "block";
  }, 1800);
}

async function getQuote() {
  const c = CORRIDORS[state.corridor];
  try {
    const q = await api("/api/quotes", { method: "POST", body: { currency: state.corridor, localAmount: c.amount } });
    state.quote = q;
    $("q-local").textContent = c.sym + " " + c.amount.toLocaleString();
    $("q-rate").textContent = "1 " + state.corridor + " = ₹" + q.rate;
    $("q-amount").textContent = fmtINR(q.amount);
    $("q-fee").textContent = fmtINR(q.fee);
    $("q-total").textContent = fmtINR(q.total);
    $("q-merchant").textContent = c.merchant;
    const cardCost = q.amount * 1.035 + 200; // typical 3.5% markup + flat
    $("q-savings").textContent = "You save ~" + fmtINR(cardCost - q.total) + " vs a typical bank card";
    show("screen-quote");
  } catch (e) { toast(e.message); }
}

// PIN pad
function pinKey(d) {
  if (d === "del") state.pin = state.pin.slice(0, -1);
  else if (state.pin.length < 4) state.pin += d;
  document.querySelectorAll("#pindots span").forEach((s, i) => s.classList.toggle("filled", i < state.pin.length));
  if (state.pin.length === 4) setTimeout(authorize, 200);
}

function openAuth() { state.pin = ""; document.querySelectorAll("#pindots span").forEach((s) => s.classList.remove("filled")); show("screen-auth"); }

async function authorize() {
  show("screen-settle");
  animateSteps();
  const idem = "idem_" + Date.now() + "_" + Math.random().toString(36).slice(2);
  const c = CORRIDORS[state.corridor];
  try {
    const r = await api("/api/payments", {
      method: "POST",
      idempotencyKey: idem,
      body: { quoteId: state.quote.quoteId, pin: state.pin, merchant: { name: c.merchant, country: state.corridor } },
    });
    setTimeout(() => showReceipt(r.receipt), 2600);
  } catch (e) {
    toast(e.message);
    setTimeout(() => show("screen-quote"), 400);
  }
}

function animateSteps() {
  const items = document.querySelectorAll("#settle-steps li");
  items.forEach((li) => li.classList.remove("done"));
  items.forEach((li, i) => setTimeout(() => li.classList.add("done"), 500 + i * 550));
}

function showReceipt(r) {
  $("r-merchant").textContent = r.merchant.name;
  $("r-total").textContent = fmtINR(r.total);
  $("r-fee").textContent = fmtINR(r.fee);
  $("r-rate").textContent = "1 " + r.currency + " = ₹" + r.rate;
  $("r-ref").textContent = r.reference;
  $("r-settle-hash").textContent = r.settlement.hash;
  $("r-anchor").textContent = r.anchor ? r.anchor.publicTxHash : "(batched in next anchor)";
  $("r-sig").textContent = r.signature.slice(0, 32) + "…";
  show("screen-receipt");
  refreshHome();
}

async function renderHistory() {
  try {
    const { payments } = await api("/api/payments");
    const el = $("history-list");
    if (!payments.length) { el.innerHTML = '<p class="muted" style="padding:14px 0">No payments yet.</p>'; return; }
    el.innerHTML = payments.map((p) => `
      <div class="txn">
        <div style="display:flex;align-items:center">
          <div class="t-ic">🛒</div>
          <div><div style="font-weight:600">${p.merchant.name}</div>
          <div class="muted" style="font-size:12px">${p.currency} • ${p.reference}</div></div>
        </div>
        <div style="text-align:right"><div style="font-weight:700">${fmtINR(p.total)}</div>
        <div class="accent" style="font-size:11px">settled</div></div>
      </div>`).join("");
  } catch (e) {}
}

async function verifyLedger() {
  try {
    const v = await api("/api/ledger/verify");
    const l = await api("/api/ledger");
    toast(v.ok ? `✓ Ledger intact — ${l.blocks} blocks, ${l.anchors} anchors` : "✗ " + v.reason);
  } catch (e) { toast(e.message); }
}

function setCorridor(v) { state.corridor = v; }

// new-PIN entry on link screen
function setupNewPin() {
  state.newPin = "";
  const disp = $("newpin-display");
  document.querySelectorAll("#newpin-pad .key").forEach((k) => {
    k.onclick = () => {
      const d = k.dataset.k;
      if (d === "del") state.newPin = state.newPin.slice(0, -1);
      else if (state.newPin.length < 4) state.newPin += d;
      disp.textContent = "●".repeat(state.newPin.length) + "○".repeat(4 - state.newPin.length);
    };
  });
}

window.addEventListener("DOMContentLoaded", () => {
  $("btn-start").onclick = doKyc;
  $("btn-link").onclick = linkBank;
  $("btn-pay").onclick = startScan;
  $("btn-scan-continue").onclick = getQuote;
  $("btn-quote-pay").onclick = openAuth;
  $("btn-receipt-done").onclick = () => show("screen-home");
  $("btn-verify").onclick = verifyLedger;
  $("corridor-select").onchange = (e) => setCorridor(e.target.value);
  document.querySelectorAll("#pinpad .key").forEach((k) => (k.onclick = () => pinKey(k.dataset.k)));
  document.querySelectorAll(".tabbar button").forEach((b) => (b.onclick = () => {
    document.querySelectorAll(".tabbar button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    show(b.dataset.screen);
    if (b.dataset.screen === "screen-history") renderHistory();
  }));
  setupNewPin();
});
