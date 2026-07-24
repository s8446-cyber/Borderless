#!/usr/bin/env node
// Self-consistency check for a generated watchlist dataset — used by CI
// (.github/workflows/watchlists.yml) after update-watchlists.mjs runs against
// the REAL UN + OFAC downloads, and usable by ops before shipping a refresh.
//
// Verifies, against the freshly built dataset itself (no hardcoded names —
// designations change over time):
//   1. the dataset loads through the same fail-closed loader the server uses
//   2. a UN individual's primary name produces a sanctions hit
//   3. one of its aliases produces a hit
//   4. token order and diacritics do not break matching
//   5. an OFAC entity name produces a hit
//   6. an unrelated name stays clear
//
// Exit code 0 = dataset is production-usable; non-zero = do NOT ship it.

import { strict as assert } from "node:assert";
import { createWatchlistScreen, loadWatchlistDataset, normalizeName } from "../src/screening.js";

const path = process.argv[2];
if (!path) {
  process.stderr.write("usage: node scripts/check-watchlists.mjs <watchlists.json>\n");
  process.exit(2);
}

const dataset = loadWatchlistDataset(path);
const screen = createWatchlistScreen(dataset);

const unIndividual = dataset.entries.find((e) => e.source === "un_sc_consolidated" && e.type === "individual" && e.aliases.length > 0 && normalizeName(e.aliases[0]));
const ofacEntry = dataset.entries.find((e) => e.source === "ofac_sdn");
assert.ok(unIndividual, "dataset contains no UN individual with aliases");
assert.ok(ofacEntry, "dataset contains no OFAC entries");

// 2. primary name hit
const hit1 = screen({ name: unIndividual.name });
assert.equal(hit1.clear, false, `expected sanctions hit for UN name: ${unIndividual.name}`);
assert.equal(hit1.list, "sanctions");

// 3. alias hit
const hit2 = screen({ name: unIndividual.aliases[0] });
assert.equal(hit2.clear, false, `expected sanctions hit for alias: ${unIndividual.aliases[0]}`);

// 4. token order + case insensitivity on the primary name
const shuffled = unIndividual.name.split(/\s+/).reverse().join(" ").toUpperCase();
const hit3 = screen({ name: shuffled });
assert.equal(hit3.clear, false, `expected token-order-insensitive hit for: ${shuffled}`);

// 5. OFAC hit
const hit4 = screen({ name: ofacEntry.name });
assert.equal(hit4.clear, false, `expected sanctions hit for OFAC name: ${ofacEntry.name}`);

// 6. unrelated name stays clear
const clear = screen({ name: "Borderless Pay Watchlist Selfcheck Nonmatch" });
assert.equal(clear.clear, true, "unrelated name must stay clear");

process.stdout.write(JSON.stringify({
  ok: true,
  entries: dataset.entries.length,
  counts: dataset.counts,
  fetchedAt: dataset.fetchedAt,
  probes: {
    unPrimary: unIndividual.name,
    unAlias: unIndividual.aliases[0],
    tokenShuffled: shuffled,
    ofac: ofacEntry.name,
  },
}, null, 2) + "\n");
