// Watchlist screening — parser + matcher + fail-closed loader tests.
//
// Parser fixtures are format-exact excerpts of the two real sources:
//   - UN Security Council Consolidated List XML (individual CDi.005 with its
//     published aliases, and entity structure)
//   - OFAC SDN.CSV / ALT.CSV legacy format (no header, "-0-" nulls, quoted
//     names with embedded commas)
// End-to-end verification against the LIVE downloads happens in CI
// (.github/workflows/watchlists.yml → scripts/check-watchlists.mjs); these
// tests pin the parsing/matching mechanics.

import test from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createWatchlistScreen, loadWatchlistDataset, normalizeName, screenParty } from "../src/screening.js";
import { buildDataset, parseCsv, parseOfacSdn, parseUnXml } from "../scripts/update-watchlists.mjs";

// ---------- UN XML parsing (real list structure) ----------

const UN_XML = `<?xml version="1.0" encoding="utf-8"?>\n<CONSOLIDATED_LIST xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" dateGenerated="2026-07-20T00:00:00">\n<INDIVIDUALS>\n<INDIVIDUAL><DATAID>111157</DATAID><VERSIONNUM>1</VERSIONNUM><FIRST_NAME>J\u00c9R\u00d4ME</FIRST_NAME><SECOND_NAME>KAKWAVU</SECOND_NAME><THIRD_NAME>BUKANDE</THIRD_NAME><UN_LIST_TYPE>DRC</UN_LIST_TYPE><REFERENCE_NUMBER>CDi.005</REFERENCE_NUMBER><INDIVIDUAL_ALIAS><QUALITY>Good</QUALITY><ALIAS_NAME>J\u00e9r\u00f4me Kakwavu</ALIAS_NAME></INDIVIDUAL_ALIAS><INDIVIDUAL_ALIAS><QUALITY>Low</QUALITY><ALIAS_NAME>Commandant J\u00e9r\u00f4me</ALIAS_NAME></INDIVIDUAL_ALIAS><NATIONALITY><VALUE>Democratic Republic of the Congo</VALUE></NATIONALITY></INDIVIDUAL>\n<INDIVIDUAL><DATAID>110058</DATAID><FIRST_NAME>FRANK</FIRST_NAME><SECOND_NAME>KAKOLELE</SECOND_NAME><THIRD_NAME>BWAMBALE</THIRD_NAME><UN_LIST_TYPE>DRC</UN_LIST_TYPE><REFERENCE_NUMBER>CDi.002</REFERENCE_NUMBER><INDIVIDUAL_ALIAS><QUALITY>Good</QUALITY><ALIAS_NAME>FRANK KAKORERE</ALIAS_NAME></INDIVIDUAL_ALIAS></INDIVIDUAL>\n</INDIVIDUALS>\n<ENTITIES>\n<ENTITY><DATAID>110068</DATAID><FIRST_NAME>ALLIED DEMOCRATIC FORCES (ADF)</FIRST_NAME><UN_LIST_TYPE>DRC</UN_LIST_TYPE><REFERENCE_NUMBER>CDe.001</REFERENCE_NUMBER><ENTITY_ALIAS><QUALITY>a.k.a.</QUALITY><ALIAS_NAME>FORCES DEMOCRATIQUES ALLIEES-ARMEE NATIONALE DE LIBERATION DE L&apos;OUGANDA</ALIAS_NAME></ENTITY_ALIAS></ENTITY>\n</ENTITIES>\n</CONSOLIDATED_LIST>`;

test("UN XML: individuals parse with assembled names, aliases, list type", () => {
  const { entries } = parseUnXml(UN_XML);
  const kakwavu = entries.find((e) => e.id === "UN:111157");
  assert.ok(kakwavu);
  assert.equal(kakwavu.type, "individual");
  assert.equal(kakwavu.name, "J\u00c9R\u00d4ME KAKWAVU BUKANDE");
  assert.deepEqual(kakwavu.aliases, ["J\u00e9r\u00f4me Kakwavu", "Commandant J\u00e9r\u00f4me"]);
  assert.deepEqual(kakwavu.programs, ["DRC"]);
});

test("UN XML: entities parse with XML entities decoded", () => {
  const { entries } = parseUnXml(UN_XML);
  const adf = entries.find((e) => e.id === "UN:110068");
  assert.ok(adf);
  assert.equal(adf.type, "entity");
  assert.equal(adf.name, "ALLIED DEMOCRATIC FORCES (ADF)");
  assert.equal(adf.aliases[0].includes("L'OUGANDA"), true); // &apos; decoded
});

// ---------- OFAC CSV parsing (legacy format) ----------

const SDN_CSV = `36,"AEROCARIBBEAN AIRLINES","-0-","CUBA","-0-","-0-","-0-","-0-","-0-","-0-","-0-","-0-"\r\n173,"ANGLO-CARIBBEAN CO., LTD.","-0-","CUBA","-0-","-0-","-0-","-0-","-0-","-0-","-0-","-0-"\r\n306,"BANCO NACIONAL DE CUBA","-0-","CUBA","-0-","-0-","-0-","-0-","-0-","-0-","-0-","a.k.a. 'BNC'."\r\n`;
const ALT_CSV = `36,12,"aka","AERO-CARIBBEAN","-0-"\r\n306,220,"aka","BNC","-0-"\r\n999999,1,"aka","ORPHAN ROW","-0-"\r\n`;

test("CSV parser: quoted fields with embedded commas and CRLF", () => {
  const rows = parseCsv(SDN_CSV);
  assert.equal(rows.length, 3);
  assert.equal(rows[1][1], "ANGLO-CARIBBEAN CO., LTD.");
  assert.equal(rows[0][0], "36");
});

test("OFAC: entries build with -0- nulls dropped and ALT names linked by ent_num", () => {
  const { entries, stats } = parseOfacSdn(SDN_CSV, ALT_CSV);
  assert.equal(entries.length, 3);
  const aero = entries.find((e) => e.id === "OFAC:36");
  assert.deepEqual(aero.aliases, ["AERO-CARIBBEAN"]);
  assert.deepEqual(aero.programs, ["CUBA"]);
  assert.equal(stats.altLinked, 2);
  assert.equal(stats.altOrphans, 1); // ALT row without a parent is counted, not invented
});

// ---------- normalization + matching ----------

test("normalizeName: diacritics fold, punctuation collapses, non-Latin survives", () => {
  assert.equal(normalizeName("  J\u00c9R\u00d4ME   KAKWAVU "), "jerome kakwavu");
  assert.equal(normalizeName("ANGLO-CARIBBEAN CO., LTD."), "anglo caribbean co ltd");
  assert.equal(normalizeName("\u0645\u062d\u0645\u062f").length > 0, true); // Arabic script preserved
  assert.equal(normalizeName(""), "");
});

function smallDataset() {
  const { entries: un } = parseUnXml(UN_XML);
  const { entries: ofac } = parseOfacSdn(SDN_CSV, ALT_CSV);
  return { format: "borderless-watchlists/v1", fetchedAt: new Date().toISOString(), sources: [], entries: [...un, ...ofac] };
}

test("watchlist matching: primary, alias, diacritic-insensitive, token-order-insensitive", () => {
  const screen = createWatchlistScreen(smallDataset());
  // primary name, diacritics stripped by caller
  const h1 = screen({ name: "jerome kakwavu bukande" });
  assert.equal(h1.clear, false);
  assert.equal(h1.list, "sanctions");
  assert.equal(h1.entryId, "UN:111157");
  // published alias
  assert.equal(screen({ name: "J\u00e9r\u00f4me Kakwavu" }).clear, false);
  // token order shuffled against the alias
  assert.equal(screen({ name: "KAKWAVU J\u00c9R\u00d4ME" }).clear, false);
  // OFAC alias via ALT linkage
  assert.equal(screen({ name: "aero-caribbean" }).clear, false);
  // unrelated names stay clear
  assert.equal(screen({ name: "Rahul Verma" }).clear, true);
  assert.equal(screen({ name: "" }).clear, true);
});

// ---------- dataset validation gates (fail-closed ingestion) ----------

test("buildDataset: refuses truncated sources", () => {
  const un = parseUnXml(UN_XML);
  const ofac = parseOfacSdn(SDN_CSV, ALT_CSV);
  assert.throws(() => buildDataset({ un, ofac, sources: [] }), /VALIDATION FAILED/);
});

// ---------- loader (fail-closed at boot) ----------

function bigEntries(n) {
  return Array.from({ length: n }, (_, i) => ({ id: "T:" + i, source: "un_sc_consolidated", list: "sanctions", type: "individual", name: "Test Name " + i, aliases: [] }));
}

test("loader: missing file, bad JSON, wrong format, too few entries, stale \u2014 all throw", () => {
  const dir = mkdtempSync(join(tmpdir(), "wl-"));
  assert.throws(() => loadWatchlistDataset(join(dir, "nope.json")), /cannot read watchlist dataset/);

  const bad = join(dir, "bad.json");
  writeFileSync(bad, "{not json");
  assert.throws(() => loadWatchlistDataset(bad), /not valid JSON/);

  const wrong = join(dir, "wrong.json");
  writeFileSync(wrong, JSON.stringify({ format: "other", entries: [] }));
  assert.throws(() => loadWatchlistDataset(wrong), /not a borderless-watchlists\/v1/);

  const few = join(dir, "few.json");
  writeFileSync(few, JSON.stringify({ format: "borderless-watchlists/v1", fetchedAt: new Date().toISOString(), entries: bigEntries(10) }));
  assert.throws(() => loadWatchlistDataset(few), /incomplete list/);

  const stale = join(dir, "stale.json");
  writeFileSync(stale, JSON.stringify({ format: "borderless-watchlists/v1", fetchedAt: new Date(Date.now() - 100 * 86400000).toISOString(), entries: bigEntries(1200) }));
  assert.throws(() => loadWatchlistDataset(stale), /days old/);

  const fresh = join(dir, "fresh.json");
  writeFileSync(fresh, JSON.stringify({ format: "borderless-watchlists/v1", fetchedAt: new Date().toISOString(), entries: bigEntries(1200) }));
  const ds = loadWatchlistDataset(fresh);
  assert.equal(ds.entries.length, 1200);
  const screen = createWatchlistScreen(ds);
  assert.equal(screen({ name: "test name 7" }).clear, false);
});

// ---------- default provider unchanged ----------

test("default provider stays sandbox and its fixtures still work", () => {
  assert.equal(screenParty({ name: "Rahul Verma" }).clear, true);
  assert.equal(screenParty({ name: "Blocked Person" }).clear, false);
});
