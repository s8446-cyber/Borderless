#!/usr/bin/env node
// Sanctions watchlist ingestion — downloads the two authoritative, public,
// no-registration sanctions lists and compiles them into the normalized
// dataset consumed by the `watchlist` screening provider (src/screening.js):
//
//   1. UN Security Council Consolidated List (XML)  — scsanctions.un.org
//   2. US Treasury OFAC SDN list (CSV + ALT names)  — sanctionslist.ofac.treas.gov
//
// This is an OPS-TIME tool: run it on a schedule (see RUNBOOK.md and
// .github/workflows/watchlists.yml), review the printed stats, and ship the
// dataset file to the server (BP_SCREENING_DATA). The runtime NEVER downloads
// at boot — a deploy must not depend on a third-party site being up.
//
// Fail-closed: every structural expectation about the source formats is
// VALIDATED after parsing (minimum entry counts, non-empty names, alias
// linkage). If a source changes shape, this script exits non-zero and writes
// nothing, rather than silently producing a truncated list.
//
// Usage:
//   node scripts/update-watchlists.mjs --out data/watchlists.json
//   node scripts/update-watchlists.mjs --un-file un.xml --sdn-file sdn.csv --alt-file alt.csv --out out.json
//
// Zero runtime dependencies (global fetch, Node >= 20).

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

// Primary + fallback URLs per source (overridable via env for mirrors).
const UN_URLS = (process.env.BP_WATCHLIST_UN_URL || "").trim()
  ? [process.env.BP_WATCHLIST_UN_URL.trim()]
  : ["https://scsanctions.un.org/resources/xml/en/consolidated.xml"];
const OFAC_SDN_URLS = (process.env.BP_WATCHLIST_OFAC_SDN_URL || "").trim()
  ? [process.env.BP_WATCHLIST_OFAC_SDN_URL.trim()]
  : [
      "https://sanctionslist.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV",
      "https://www.treasury.gov/ofac/downloads/sdn.csv",
    ];
const OFAC_ALT_URLS = (process.env.BP_WATCHLIST_OFAC_ALT_URL || "").trim()
  ? [process.env.BP_WATCHLIST_OFAC_ALT_URL.trim()]
  : [
      "https://sanctionslist.ofac.treas.gov/api/PublicationPreview/exports/ALT.CSV",
      "https://www.treasury.gov/ofac/downloads/alt.csv",
    ];

const OFAC_NULL = "-0-"; // OFAC's literal null marker in legacy CSV files

// ---------------------------------------------------------------------------
// Tiny parsers (exported for unit tests)
// ---------------------------------------------------------------------------

// RFC-4180-style CSV: quoted fields, embedded commas/quotes/newlines, CRLF.
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); field = ""; rows.push(row); row = [];
    } else if (c !== "\r") {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // Drop fully-empty rows.
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

function decodeXml(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

// All inner contents of <TAG ...>...</TAG>. Exact-name match: <INDIVIDUAL>
// does not match <INDIVIDUALS> or <INDIVIDUAL_ALIAS>.
function blocks(xml, tag) {
  const re = new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">", "g");
  const out = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function tagValue(block, tag) {
  const m = block.match(new RegExp("<" + tag + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + tag + ">"));
  return m ? decodeXml(m[1].trim()) : "";
}

// UN Security Council Consolidated List XML → normalized entries.
// Individuals: FIRST/SECOND/THIRD/FOURTH_NAME + INDIVIDUAL_ALIAS/ALIAS_NAME
// Entities:    FIRST_NAME + ENTITY_ALIAS/ALIAS_NAME
export function parseUnXml(xml) {
  const entries = [];
  const skipped = { individuals: 0, entities: 0 };
  for (const b of blocks(xml, "INDIVIDUAL")) {
    const name = ["FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME"]
      .map((t) => tagValue(b, t)).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    if (!name) { skipped.individuals++; continue; }
    const aliases = [];
    for (const a of blocks(b, "INDIVIDUAL_ALIAS")) {
      const an = tagValue(a, "ALIAS_NAME");
      if (an) aliases.push(an);
    }
    const orig = tagValue(b, "NAME_ORIGINAL_SCRIPT");
    if (orig) aliases.push(orig);
    const listType = tagValue(b, "UN_LIST_TYPE");
    entries.push({
      id: "UN:" + (tagValue(b, "DATAID") || tagValue(b, "REFERENCE_NUMBER") || name),
      source: "un_sc_consolidated",
      list: "sanctions",
      type: "individual",
      name,
      aliases,
      programs: listType ? [listType] : [],
    });
  }
  for (const b of blocks(xml, "ENTITY")) {
    const name = tagValue(b, "FIRST_NAME").replace(/\s+/g, " ").trim();
    if (!name) { skipped.entities++; continue; }
    const aliases = [];
    for (const a of blocks(b, "ENTITY_ALIAS")) {
      const an = tagValue(a, "ALIAS_NAME");
      if (an) aliases.push(an);
    }
    const orig = tagValue(b, "NAME_ORIGINAL_SCRIPT");
    if (orig) aliases.push(orig);
    const listType = tagValue(b, "UN_LIST_TYPE");
    entries.push({
      id: "UN:" + (tagValue(b, "DATAID") || tagValue(b, "REFERENCE_NUMBER") || name),
      source: "un_sc_consolidated",
      list: "sanctions",
      type: "entity",
      name,
      aliases,
      programs: listType ? [listType] : [],
    });
  }
  return { entries, skipped };
}

// OFAC SDN.CSV (+ ALT.CSV alternate names) → normalized entries.
// SDN columns: ent_num, SDN_Name, SDN_Type, Program, ... (nulls are "-0-").
// ALT columns: ent_num, alt_num, alt_type, alt_name, alt_remarks.
// Defensive: a leading header row (non-numeric ent_num) is skipped; rows that
// do not fit the shape are counted and reported, and validation gates on the
// parsed/total ratio so a format change cannot silently pass.
export function parseOfacSdn(sdnText, altText) {
  const byEnt = new Map();
  let sdnRows = 0;
  let sdnSkipped = 0;
  const rows = parseCsv(sdnText);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const entNum = (r[0] || "").trim();
    if (!/^\d+$/.test(entNum)) {
      if (i === 0) continue; // header row, if present
      sdnSkipped++;
      continue;
    }
    sdnRows++;
    const name = (r[1] || "").trim();
    if (!name || name === OFAC_NULL) { sdnSkipped++; continue; }
    const sdnType = (r[2] || "").trim();
    const program = (r[3] || "").trim();
    byEnt.set(entNum, {
      id: "OFAC:" + entNum,
      source: "ofac_sdn",
      list: "sanctions",
      type: sdnType && sdnType !== OFAC_NULL ? sdnType.toLowerCase() : "unknown",
      name,
      aliases: [],
      programs: program && program !== OFAC_NULL ? [program] : [],
    });
  }
  let altLinked = 0;
  let altOrphans = 0;
  if (altText) {
    const altRows = parseCsv(altText);
    for (let i = 0; i < altRows.length; i++) {
      const r = altRows[i];
      const entNum = (r[0] || "").trim();
      if (!/^\d+$/.test(entNum)) {
        if (i === 0) continue; // header row, if present
        continue;
      }
      const altName = (r[3] || "").trim();
      if (!altName || altName === OFAC_NULL) continue;
      const entry = byEnt.get(entNum);
      if (entry) { entry.aliases.push(altName); altLinked++; } else { altOrphans++; }
    }
  }
  return { entries: [...byEnt.values()], stats: { sdnRows, sdnSkipped, altLinked, altOrphans } };
}

// ---------------------------------------------------------------------------
// Download + validate + write
// ---------------------------------------------------------------------------

async function download(urls, label) {
  const errors = [];
  for (const url of urls) {
    try {
      process.stderr.write(`downloading ${label}: ${url}\n`);
      const res = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(180000),
        headers: {
          "user-agent": "borderless-pay-watchlist-updater/1.0 (sanctions compliance data refresh)",
          accept: "*/*",
        },
      });
      if (!res.ok) { errors.push(`${url} -> HTTP ${res.status}`); continue; }
      const text = await res.text();
      if (text.length < 10000) { errors.push(`${url} -> suspiciously small (${text.length} bytes)`); continue; }
      return { url, text, bytes: Buffer.byteLength(text), sha256: createHash("sha256").update(text).digest("hex") };
    } catch (e) {
      errors.push(`${url} -> ${e && e.message ? e.message : e}`);
    }
  }
  throw new Error(`could not download ${label}:\n  ` + errors.join("\n  "));
}

function assertOrDie(cond, message) {
  if (!cond) throw new Error("VALIDATION FAILED: " + message);
}

export function buildDataset({ un, ofac, sources }) {
  // Structural gates — chosen far below the real list sizes (UN ~1k entries,
  // OFAC ~12k+) but far above anything a truncated/error response could parse.
  assertOrDie(un.entries.length >= 500, `UN consolidated list parsed only ${un.entries.length} entries (expected >= 500) — format change or truncated download`);
  assertOrDie(un.entries.some((e) => e.type === "individual"), "UN list parsed no individuals");
  assertOrDie(un.entries.some((e) => e.type === "entity"), "UN list parsed no entities");
  assertOrDie(ofac.entries.length >= 5000, `OFAC SDN parsed only ${ofac.entries.length} entries (expected >= 5000) — format change or truncated download`);
  assertOrDie(ofac.stats.altLinked >= 1000, `OFAC ALT names linked only ${ofac.stats.altLinked} aliases (expected >= 1000)`);
  const parsedRatio = ofac.stats.sdnRows / (ofac.stats.sdnRows + ofac.stats.sdnSkipped || 1);
  assertOrDie(parsedRatio >= 0.98, `only ${(parsedRatio * 100).toFixed(1)}% of OFAC rows fit the expected shape`);
  const entries = [...un.entries, ...ofac.entries];
  assertOrDie(entries.every((e) => e.name && e.name.trim()), "found entries with empty names");
  const aliasCount = entries.reduce((n, e) => n + e.aliases.length, 0);
  return {
    format: "borderless-watchlists/v1",
    fetchedAt: new Date().toISOString(),
    sources,
    counts: {
      total: entries.length,
      un: un.entries.length,
      ofac: ofac.entries.length,
      aliases: aliasCount,
      unSkipped: un.skipped,
      ofacStats: ofac.stats,
    },
    entries,
  };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

export async function main() {
  const outPath = arg("--out") || "data/watchlists.json";
  const unFile = arg("--un-file");
  const sdnFile = arg("--sdn-file");
  const altFile = arg("--alt-file");

  let unRaw;
  let sdnRaw;
  let altRaw;
  if (unFile && sdnFile && altFile) {
    unRaw = { url: "file:" + unFile, text: readFileSync(unFile, "utf8") };
    sdnRaw = { url: "file:" + sdnFile, text: readFileSync(sdnFile, "utf8") };
    altRaw = { url: "file:" + altFile, text: readFileSync(altFile, "utf8") };
    for (const r of [unRaw, sdnRaw, altRaw]) {
      r.bytes = Buffer.byteLength(r.text);
      r.sha256 = createHash("sha256").update(r.text).digest("hex");
    }
  } else {
    unRaw = await download(UN_URLS, "UN consolidated list (XML)");
    sdnRaw = await download(OFAC_SDN_URLS, "OFAC SDN list (CSV)");
    altRaw = await download(OFAC_ALT_URLS, "OFAC alternate names (CSV)");
  }

  const un = parseUnXml(unRaw.text);
  const ofac = parseOfacSdn(sdnRaw.text, altRaw.text);
  const dataset = buildDataset({
    un,
    ofac,
    sources: [
      { name: "un_sc_consolidated", url: unRaw.url, bytes: unRaw.bytes, sha256: unRaw.sha256, entries: un.entries.length },
      { name: "ofac_sdn", url: sdnRaw.url, bytes: sdnRaw.bytes, sha256: sdnRaw.sha256, entries: ofac.entries.length },
      { name: "ofac_alt", url: altRaw.url, bytes: altRaw.bytes, sha256: altRaw.sha256, entries: ofac.stats.altLinked },
    ],
  });

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(dataset), { mode: 0o600 });
  process.stdout.write(JSON.stringify({ out: outPath, fetchedAt: dataset.fetchedAt, counts: dataset.counts, sources: dataset.sources.map((s) => ({ name: s.name, url: s.url, bytes: s.bytes, sha256: s.sha256, entries: s.entries })) }, null, 2) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    process.stderr.write(String((e && e.message) || e) + "\n");
    process.exit(1);
  });
}
