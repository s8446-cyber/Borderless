// Zero-dependency HTTP server: REST API + static web client.
// Built only on Node's http/fs/crypto, hardened for production:
//   - security headers (CSP, HSTS, frame/sniff protection) on every response
//   - per-IP sliding-window rate limiting (global + stricter auth/payment tiers)
//   - CORS allowlist, body-size limits, strict JSON parsing
//   - request IDs + structured logging, with sanitized error responses
//   - tamper-evident dual ledger + audit log, integrity-checked at /api/ready
//   - graceful shutdown with a final durable persist
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, normalize } from "node:path";
import { randomUUID } from "node:crypto";

import { config, configSummary } from "./config.js";
import { logger } from "./logger.js";
import { Store } from "./store.js";
import { DualLedger } from "./ledger.js";
import { AuditLog } from "./audit.js";
import { PaymentService } from "./payments.js";
import { checkTxnLimits } from "./limits.js";
import { runKyc } from "./kyc.js";
import { hashPin, newToken } from "./auth.js";
import { encryptField } from "./crypto.js";
import { ApiError, RATES, listCurrencies, FEE_PCT } from "./fx.js";
import { toMinor, fromMinor, formatINR } from "./money.js";
import {
  RateLimiter, LoginGuard, securityHeaders, applyCors, clientIp,
  asString, asPin, asAmount, asEmail,
} from "./security.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PUBLIC = join(ROOT, "public");
const DB_PATH = config.dbPath || join(ROOT, "data", "db.json");

// Demo directories used by the UPI-style domestic flows.
const CONTACTS = [
  { name: "Ananya Iyer", phone: "+91 98\u2022\u2022\u2022\u2022 2104", vpa: "ananya@bpl", initials: "AI" },
  { name: "Rohan Mehta", phone: "+91 99\u2022\u2022\u2022\u2022 7781", vpa: "rohan@bpl", initials: "RM" },
  { name: "Priya Nair", phone: "+91 90\u2022\u2022\u2022\u2022 4452", vpa: "priya@bpl", initials: "PN" },
  { name: "Vikram Singh", phone: "+91 70\u2022\u2022\u2022\u2022 9930", vpa: "vikram@bpl", initials: "VS" },
  { name: "Sara Khan", phone: "+91 88\u2022\u2022\u2022\u2022 1207", vpa: "sara@bpl", initials: "SK" },
];
const BILLERS = [
  { category: "Electricity", names: ["Tata Power", "Adani Electricity", "BESCOM", "MSEDCL"] },
  { category: "Water", names: ["Delhi Jal Board", "BWSSB", "MCGM Water"] },
  { category: "Gas", names: ["Indane Gas", "HP Gas", "Mahanagar Gas"] },
  { category: "Broadband", names: ["ACT Fibernet", "JioFiber", "Airtel Xstream"] },
  { category: "DTH", names: ["Tata Play", "Airtel Digital TV", "Dish TV"] },
  { category: "Credit Card", names: ["HDFC Card", "ICICI Card", "SBI Card"] },
];
const OPERATORS = ["Airtel", "Jio", "Vi", "BSNL"];

export function buildApp({ dbPath = DB_PATH } = {}) {
  const store = new Store(dbPath);
  const ledger = new DualLedger(store.data.ledger);
  const audit = new AuditLog(store.data.audit);
  const guard = new LoginGuard(store, config.lockout);
  const payments = new PaymentService(store, ledger, {
    guard,
    audit,
    limitsCheck: checkTxnLimits,
  });

  // persist ledger + audit back into the store on every save
  const persist = () => {
    store.data.ledger = ledger.toJSON();
    store.data.audit = audit.toJSON();
    store.persist();
  };

  const globalLimiter = new RateLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.max });
  const authLimiter = new RateLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.authMax });
  const paymentLimiter = new RateLimiter({ windowMs: config.rateLimit.windowMs, max: config.rateLimit.paymentMax });
  const limiterFor = (path) => {
    if (/^\/api\/(payments|transfers|upi|bills|recharge)/.test(path) || /^\/api\/requests\/pay$/.test(path)) return paymentLimiter;
    if (/^\/api\/(kyc|accounts\/link|waitlist)/.test(path)) return authLimiter;
    return null;
  };

  const routes = [];
  const add = (method, pattern, handler) => routes.push({ method, pattern, handler });

  // ---- health & readiness ----
  add("GET", /^\/api\/health$/, async () => ({ ok: true, ts: Date.now() }));
  add("GET", /^\/api\/ready$/, async () => {
    const l = ledger.verify();
    const a = audit.verify();
    if (!l.ok || !a.ok) throw new ApiError(503, "not_ready", "integrity check failed");
    return { ready: true, ledger: l, audit: a };
  });

  add("GET", /^\/api\/currencies$/, async () => ({
    homeCurrency: "INR", feePct: FEE_PCT, rates: RATES, currencies: listCurrencies(),
  }));

  // ---- marketing-site early-access waitlist ----
  add("GET", /^\/api\/waitlist\/count$/, async () => ({ count: store.data.waitlist.length }));
  add("POST", /^\/api\/waitlist$/, async (req, body) => {
    const email = asEmail(body.email);
    store.data.waitlist = store.data.waitlist || [];
    if (!store.data.waitlist.some((w) => w.email === email)) {
      store.data.waitlist.push({ email, ts: Date.now() });
      audit.append("waitlist_signup", { domain: email.split("@")[1] });
      persist();
    }
    return { ok: true, count: store.data.waitlist.length };
  });

  // KYC + create user
  add("POST", /^\/api\/kyc\/verify$/, async (req, body) => {
    asString(body.fullName, "fullName", { max: 120 });
    asString(body.documentId, "documentId", { max: 120 });
    asString(body.country, "country", { max: 60 });
    const kyc = runKyc(body);
    const userId = "usr_" + randomUUID();
    store.data.users[userId] = { id: userId, name: body.fullName, country: body.country, kyc };
    const token = newToken();
    store.data.sessions[token] = { userId, exp: Date.now() + config.sessionTtlMs, createdAt: Date.now() };
    audit.append("user_created", { userId, country: body.country, kycStatus: kyc.status });
    persist();
    return { userId, token, kyc };
  });

  // Link bank account
  add("POST", /^\/api\/accounts\/link$/, async (req, body) => {
    const userId = requireAuth(req, store);
    const bank = asString(body.bank, "bank", { max: 80 });
    const openingBalance = Number(body.openingBalance === undefined ? 250000 : body.openingBalance);
    if (!Number.isFinite(openingBalance) || openingBalance < 0) throw new ApiError(400, "bad_amount", "Invalid opening balance");
    store.data.accounts[userId] = {
      bank,
      maskedNumber: asString(body.maskedNumber, "maskedNumber", { required: false, max: 40 }) || ("\u2022\u2022\u2022\u2022" + Math.floor(1000 + Math.random() * 9000)),
      currency: "INR",
      balanceMinor: toMinor(openingBalance),
      accountRefEnc: body.accountNumber ? encryptField(String(body.accountNumber)) : null,
    };
    if (body.pin) store.data.pins[userId] = hashPin(asPin(body.pin));
    // seed a sample incoming collect request for demo realism
    store.data.requests = store.data.requests || {};
    const rid = "req_" + randomUUID();
    store.data.requests[rid] = { id: rid, userId, fromName: "Rohan Mehta", amountMinor: toMinor(450), note: "Dinner split", status: "pending", direction: "incoming", createdAt: Date.now() };
    audit.append("account_linked", { userId, bank });
    persist();
    const a = store.data.accounts[userId];
    return { bank: a.bank, maskedNumber: a.maskedNumber, balance: fromMinor(a.balanceMinor) };
  });

  add("GET", /^\/api\/accounts$/, async (req) => {
    const userId = requireAuth(req, store);
    const a = store.data.accounts[userId];
    if (!a) throw new ApiError(404, "no_account", "No account linked");
    return { bank: a.bank, maskedNumber: a.maskedNumber, balanceMinor: a.balanceMinor, balance: fromMinor(a.balanceMinor) };
  });

  // Quote (cross-border)
  add("POST", /^\/api\/quotes$/, async (req, body) => {
    asString(body.currency, "currency", { max: 8 });
    asAmount(body.localAmount, "localAmount");
    const q = payments.quote(body.currency, Number(body.localAmount));
    return { ...q, amount: fromMinor(q.amountMinor), fee: fromMinor(q.feeMinor), total: fromMinor(q.totalMinor) };
  });

  // Execute cross-border payment (idempotent via Idempotency-Key header)
  add("POST", /^\/api\/payments$/, async (req, body) => {
    const userId = requireAuth(req, store);
    asPin(body.pin);
    const out = payments.execute({
      userId,
      quoteId: asString(body.quoteId, "quoteId", { max: 80 }),
      pin: body.pin,
      merchant: body.merchant,
      idempotencyKey: req.headers["idempotency-key"],
    });
    persist();
    return { replayed: out.replayed, receipt: decorate(out.receipt) };
  });

  add("GET", /^\/api\/payments$/, async (req) => {
    const userId = requireAuth(req, store);
    return { payments: payments.history(userId).map(decorate) };
  });

  // ---- P2P transfers ----
  add("POST", /^\/api\/transfers\/quote$/, async (req, body) => {
    requireAuth(req, store);
    asString(body.recipientCurrency, "recipientCurrency", { max: 8 });
    asAmount(body.sendAmount, "sendAmount");
    const q = payments.quoteTransfer(body.recipientCurrency, Number(body.sendAmount));
    return { ...q, sendAmount: fromMinor(q.sendAmountMinor), fee: fromMinor(q.feeMinor), total: fromMinor(q.totalMinor) };
  });

  add("POST", /^\/api\/transfers$/, async (req, body) => {
    const userId = requireAuth(req, store);
    asPin(body.pin);
    const out = payments.transfer({
      userId,
      quoteId: asString(body.quoteId, "quoteId", { max: 80 }),
      pin: body.pin,
      recipient: body.recipient,
      idempotencyKey: req.headers["idempotency-key"],
    });
    persist();
    return { replayed: out.replayed, receipt: decorate(out.receipt) };
  });

  // ---- Domestic payments (UPI-style: phone / UPI ID / bank / scan; instant, zero fee) ----
  add("POST", /^\/api\/upi\/pay$/, async (req, body) => {
    const userId = requireAuth(req, store);
    asPin(body.pin);
    asAmount(body.amount, "amount");
    const out = payments.payDomestic({
      userId, pin: body.pin, amountINR: Number(body.amount),
      payee: body.payee, kind: (body.payee && body.payee.kind) || "upi",
      idempotencyKey: req.headers["idempotency-key"],
    });
    persist();
    return { replayed: out.replayed, receipt: decorate(out.receipt) };
  });

  // Bill payments (electricity, water, gas, broadband, DTH, etc.)
  add("POST", /^\/api\/bills\/pay$/, async (req, body) => {
    const userId = requireAuth(req, store);
    asPin(body.pin);
    asAmount(body.amount, "amount");
    const biller = body.biller || {};
    const out = payments.payDomestic({
      userId, pin: body.pin, amountINR: Number(body.amount),
      payee: { name: biller.name || biller.category || "Biller", type: "bill", category: biller.category, consumerId: biller.consumerId },
      kind: "bill", idempotencyKey: req.headers["idempotency-key"],
    });
    persist();
    return { replayed: out.replayed, receipt: decorate(out.receipt) };
  });

  // Mobile / DTH recharge
  add("POST", /^\/api\/recharge$/, async (req, body) => {
    const userId = requireAuth(req, store);
    asPin(body.pin);
    asAmount(body.amount, "amount");
    const rc = body.recharge || {};
    const out = payments.payDomestic({
      userId, pin: body.pin, amountINR: Number(body.amount),
      payee: { name: (rc.operator || "Operator") + " " + (rc.number || ""), type: "recharge", operator: rc.operator, number: rc.number, plan: rc.plan },
      kind: "recharge", idempotencyKey: req.headers["idempotency-key"],
    });
    persist();
    return { replayed: out.replayed, receipt: decorate(out.receipt) };
  });

  // ---- Collect requests (request money) ----
  add("POST", /^\/api\/requests$/, async (req, body) => {
    const userId = requireAuth(req, store);
    asAmount(body.amount, "amount");
    const r = payments.createRequest({ userId, fromName: body.fromName, amountINR: Number(body.amount), note: body.note });
    persist();
    return { request: { ...r, amount: fromMinor(r.amountMinor) } };
  });

  add("GET", /^\/api\/requests$/, async (req) => {
    const userId = requireAuth(req, store);
    return { requests: payments.listRequests(userId).map((r) => ({ ...r, amount: fromMinor(r.amountMinor) })) };
  });

  add("POST", /^\/api\/requests\/pay$/, async (req, body) => {
    const userId = requireAuth(req, store);
    asPin(body.pin);
    const out = payments.payRequest({ userId, requestId: asString(body.requestId, "requestId", { max: 80 }), pin: body.pin, idempotencyKey: req.headers["idempotency-key"] });
    persist();
    return { replayed: out.replayed, receipt: decorate(out.receipt) };
  });

  // Demo directories for the UPI-style flows
  add("GET", /^\/api\/contacts$/, async (req) => {
    requireAuth(req, store);
    return { contacts: CONTACTS };
  });
  add("GET", /^\/api\/billers$/, async () => ({ billers: BILLERS }));
  add("GET", /^\/api\/operators$/, async () => ({ operators: OPERATORS }));

  // Ledger + audit inspection / integrity verification
  add("GET", /^\/api\/ledger$/, async () => ({
    blocks: ledger.blocks.length, anchors: ledger.anchors.length,
    auditEntries: audit.entries.length, head: ledger.head, anchorList: ledger.anchors,
  }));
  add("GET", /^\/api\/ledger\/verify$/, async () => ledger.verify());
  add("GET", /^\/api\/audit\/verify$/, async () => audit.verify());

  // ---- request handling ----
  const server = createServer(async (req, res) => {
    const requestId = logger.requestId();
    const ip = clientIp(req);
    securityHeaders(res);
    applyCors(req, res);
    try {
      if (req.method === "OPTIONS") { res.statusCode = 204; res.end(); return; }
      const url = new URL(req.url, "http://localhost");
      const path = url.pathname;

      if (path.startsWith("/api/")) {
        const gl = globalLimiter.check(ip);
        if (!gl.ok) return rateLimited(res, gl.retryAfter, requestId, ip, path, "global");
        const tier = limiterFor(path);
        if (tier) {
          const tl = tier.check(ip);
          if (!tl.ok) return rateLimited(res, tl.retryAfter, requestId, ip, path, "tier");
        }

        const matching = routes.filter((r) => r.pattern.test(path));
        if (!matching.length) return send(res, 404, { error: "not_found", path }, requestId);
        const match = matching.find((r) => r.method === req.method);
        if (!match) {
          res.setHeader("allow", matching.map((r) => r.method).join(", "));
          return send(res, 405, { error: "method_not_allowed" }, requestId);
        }
        const body = req.method === "POST" ? await readBody(req) : {};
        const result = await match.handler(req, body, url, { ip, requestId });
        return send(res, 200, result, requestId);
      }
      return serveStatic(res, url.pathname);
    } catch (err) {
      if (err instanceof ApiError) return send(res, err.status, { error: err.code, message: err.message }, requestId);
      logger.error("unhandled_error", { requestId, ip, message: String(err && err.message), stack: err && err.stack });
      const payload = config.isProd
        ? { error: "internal", requestId }
        : { error: "internal", message: String(err && err.message), requestId };
      return send(res, 500, payload, requestId);
    }
  });

  function rateLimited(res, retryAfter, requestId, ip, path, scope) {
    audit.append("rate_limited", { ip, path, scope });
    persist();
    res.setHeader("retry-after", String(retryAfter));
    return send(res, 429, { error: "rate_limited", retryAfter }, requestId);
  }

  return { server, store, ledger, payments, audit };
}

function decorate(r) {
  return {
    ...r,
    amount: fromMinor(r.amountMinor),
    fee: fromMinor(r.feeMinor),
    total: fromMinor(r.totalMinor),
    totalFormatted: formatINR(r.totalMinor),
  };
}

function requireAuth(req, store) {
  const h = req.headers["authorization"] || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  const sess = token ? store.data.sessions[token] : null;
  if (!sess) throw new ApiError(401, "unauthorized", "Missing or invalid token");
  const userId = typeof sess === "string" ? sess : sess.userId;
  const exp = typeof sess === "string" ? null : sess.exp;
  if (exp && Date.now() > exp) {
    delete store.data.sessions[token];
    throw new ApiError(401, "session_expired", "Session expired, please re-authenticate");
  }
  if (!userId) throw new ApiError(401, "unauthorized", "Missing or invalid token");
  return userId;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    let bytes = 0;
    req.on("data", (c) => {
      bytes += c.length;
      if (bytes > config.bodyLimitBytes) {
        reject(new ApiError(413, "payload_too_large", "Request body too large"));
        req.destroy();
        return;
      }
      data += c;
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); }
      catch { reject(new ApiError(400, "bad_json", "Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function send(res, status, obj, requestId) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  if (requestId) res.setHeader("x-request-id", requestId);
  res.end(JSON.stringify(obj));
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".ico": "image/x-icon" };
async function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const full = normalize(join(PUBLIC, rel));
  if (!full.startsWith(PUBLIC)) { res.statusCode = 403; return res.end("forbidden"); }
  try {
    const data = await readFile(full);
    res.statusCode = 200;
    res.setHeader("content-type", MIME[extname(full)] || "application/octet-stream");
    res.setHeader("cache-control", extname(full) === ".html" ? "no-cache" : "public, max-age=3600");
    res.end(data);
  } catch {
    res.statusCode = 404;
    res.setHeader("content-type", "text/plain");
    res.end("Not found");
  }
}

// start when run directly
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = buildApp();
  const PORT = config.port;
  app.server.listen(PORT, () => logger.info("server_listening", { port: PORT, ...configSummary() }));
  const shutdown = (signal) => {
    logger.info("shutting_down", { signal });
    app.server.close(() => {
      try {
        app.store.data.ledger = app.ledger.toJSON();
        app.store.data.audit = app.audit.toJSON();
        app.store.persist();
      } catch (e) { logger.error("shutdown_persist_failed", { message: String(e && e.message) }); }
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
