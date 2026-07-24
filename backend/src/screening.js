// Transaction-time sanctions / PEP screening — pluggable provider registry,
// same pattern as kyc.js. KYC screens the ACCOUNT HOLDER once at onboarding;
// this screens the COUNTERPARTY (payee / recipient / merchant) on EVERY
// outbound payment, which onboarding can never cover.
//
// Contract (mirrors commercial screening vendors — Refinitiv World-Check,
// Dow Jones, ComplyAdvantage):
//   screenParty({ name }) →
//     { clear: true } | { clear: false, list: "sanctions" | "pep", matched }
//
// Policy applied by the payment service:
//   sanctions hit → payment BLOCKED + STR auto-filed + alert (fail-closed)
//   pep hit       → payment allowed + alert (enhanced-due-diligence flag)
//
// Providers:
//   sandbox   — tiny, obviously-fake fixtures so the block/flag paths are
//               exercisable end-to-end in dev/tests without any dataset.
//   watchlist — REAL sanctions data: the UN Security Council Consolidated
//               List and the US OFAC SDN list, ingested into a normalized
//               dataset by `backend/scripts/update-watchlists.mjs`.
//               Fail-closed: if selected, the process refuses to boot unless
//               BP_SCREENING_DATA points at a valid, complete, fresh dataset.
//
// Honest limitation: UN/OFAC publish SANCTIONS designations only. There is no
// authoritative public PEP (politically-exposed persons) registry — PEP data
// is commercial (World-Check, Dow Jones, ComplyAdvantage). The watchlist
// provider therefore returns real sanctions hits and NO pep hits; PEP
// screening remains a licensed-vendor adapter (one-entry registry addition).

import { readFileSync } from "node:fs";
import { config } from "./config.js";
import { logger } from "./logger.js";

const SANDBOX_SANCTIONS = ["blocked person", "sanctioned entity", "embargoed trader"];
const SANDBOX_PEP = ["prominent politician", "exposed person"];

function norm(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sandboxScreen({ name }) {
  const n = norm(name);
  if (!n) return { clear: true };
  if (SANDBOX_SANCTIONS.includes(n)) return { clear: false, list: "sanctions", matched: n };
  if (SANDBOX_PEP.includes(n)) return { clear: false, list: "pep", matched: n };
  return { clear: true };
}

// ---------------------------------------------------------------------------
// Watchlist provider (real UN + OFAC data)
// ---------------------------------------------------------------------------

// Normalization for name matching: Unicode-decompose and strip diacritics
// (Jérôme → jerome), lowercase, collapse every non-letter/non-digit run to a
// single space. Non-Latin scripts (Arabic, Cyrillic, …) survive — original-
// script aliases from the source lists remain matchable.
export function normalizeName(name) {
  return String(name || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenKey(normalized) {
  return normalized.split(" ").sort().join(" ");
}

// Load + validate a dataset produced by scripts/update-watchlists.mjs.
// Every failure throws (fail-closed): screening against a missing, truncated,
// malformed, or stale list is worse than refusing to start.
export function loadWatchlistDataset(filePath, opts = {}) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (e) {
    throw new Error(`FATAL screening: cannot read watchlist dataset at ${filePath}: ${e.message}. Generate it with: node backend/scripts/update-watchlists.mjs --out ${filePath}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`FATAL screening: watchlist dataset ${filePath} is not valid JSON: ${e.message}`);
  }
  if (!data || data.format !== "borderless-watchlists/v1") {
    throw new Error(`FATAL screening: ${filePath} is not a borderless-watchlists/v1 dataset`);
  }
  const minEntries = opts.minEntries ?? 1000;
  if (!Array.isArray(data.entries) || data.entries.length < minEntries) {
    const n = Array.isArray(data.entries) ? data.entries.length : 0;
    throw new Error(`FATAL screening: dataset ${filePath} has only ${n} entries (expected >= ${minEntries}) — refusing to screen against an incomplete list`);
  }
  const fetchedAt = Date.parse(data.fetchedAt || "");
  if (!Number.isFinite(fetchedAt)) {
    throw new Error(`FATAL screening: dataset ${filePath} has no valid fetchedAt timestamp`);
  }
  const maxAgeDays = opts.maxAgeDays ?? Number(process.env.BP_SCREENING_MAX_AGE_DAYS || 45);
  const ageDays = (Date.now() - fetchedAt) / 86400000;
  if (ageDays > maxAgeDays) {
    throw new Error(`FATAL screening: watchlist dataset is ${Math.floor(ageDays)} days old (max ${maxAgeDays}) — sanctions lists change; refresh with backend/scripts/update-watchlists.mjs or raise BP_SCREENING_MAX_AGE_DAYS deliberately`);
  }
  return data;
}

// Build a screening function over a loaded dataset. Matching is exact on the
// normalized primary name or any alias, plus token-order-insensitive matching
// ("Kakwavu Jérôme" matches alias "Jérôme Kakwavu"). Deterministic by design:
// fuzzy/phonetic scoring is a tuned vendor capability and faking one would
// create false confidence — token-sorted exact matching is the honest
// zero-dependency baseline.
export function createWatchlistScreen(dataset) {
  const exact = new Map();
  const sorted = new Map();
  for (const entry of dataset.entries) {
    for (const candidate of [entry.name, ...(entry.aliases || [])]) {
      const n = normalizeName(candidate);
      if (!n) continue;
      if (!exact.has(n)) exact.set(n, entry);
      const k = tokenKey(n);
      if (!sorted.has(k)) sorted.set(k, entry);
    }
  }
  return function watchlistScreen({ name }) {
    const q = normalizeName(name);
    if (!q) return { clear: true };
    const hit = exact.get(q) || sorted.get(tokenKey(q));
    if (hit) {
      return { clear: false, list: "sanctions", matched: hit.name, source: hit.source, entryId: hit.id };
    }
    return { clear: true };
  };
}

// ---------------------------------------------------------------------------
// Provider selection (boot-time, fail-closed)
// ---------------------------------------------------------------------------

const PROVIDERS = { sandbox: sandboxScreen };

const providerName = (process.env.BP_SCREENING_PROVIDER || "sandbox").trim().toLowerCase();

let selected;
let meta = { provider: providerName };
if (providerName === "watchlist") {
  const dataPath = (process.env.BP_SCREENING_DATA || "").trim();
  if (!dataPath) {
    throw new Error(
      "FATAL config: BP_SCREENING_PROVIDER=watchlist requires BP_SCREENING_DATA=<path to watchlists.json>. " +
      "Generate the dataset with: node backend/scripts/update-watchlists.mjs --out <path>"
    );
  }
  const dataset = loadWatchlistDataset(dataPath);
  selected = createWatchlistScreen(dataset);
  meta = {
    provider: "watchlist",
    entries: dataset.entries.length,
    fetchedAt: dataset.fetchedAt,
    sources: (dataset.sources || []).map((s) => s.name),
  };
} else {
  selected = PROVIDERS[providerName];
  if (!selected) {
    throw new Error(
      `FATAL config: unknown BP_SCREENING_PROVIDER "${providerName}" (registered: ${[...Object.keys(PROVIDERS), "watchlist"].join(", ")})`
    );
  }
  if (config.isProd && providerName === "sandbox") {
    // Loud, honest boot warning — same posture as the settlement/KYC warnings
    // in server.js: the process still runs (staging is legitimate) but nobody
    // can miss that payees are being screened against fixture lists.
    logger.warn("screening_sandbox_in_production", { message: "BP_SCREENING_PROVIDER=sandbox screens payees against tiny fixture lists. Set BP_SCREENING_PROVIDER=watchlist with a dataset built from the real UN + OFAC lists (backend/scripts/update-watchlists.mjs) before real-money launch." });
  }
}

export const SCREENING_PROVIDER = providerName;
export const SCREENING_META = meta;

export function screenParty(input) {
  return selected(input);
}
