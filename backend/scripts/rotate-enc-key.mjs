#!/usr/bin/env node
// Re-encrypt every field-encrypted value in the store under the CURRENT
// BP_ENC_KEY. This is step 3 of the key-rotation procedure (docs/RUNBOOK.md §8):
// the server keeps reading under both keys (BP_ENC_KEY + BP_ENC_KEY_PREVIOUS)
// while this tool retires the old key from data at rest.
//
// Usage:
//   file store:  BP_ENC_KEY=<new> BP_ENC_KEY_PREVIOUS=<old> \
//                node scripts/rotate-enc-key.mjs --db /path/to/db.json
//   postgres:    BP_ENC_KEY=<new> BP_ENC_KEY_PREVIOUS=<old> BP_PG_URL=... \
//                node scripts/rotate-enc-key.mjs --pg
//
// Guarantees:
//   - FAIL-CLOSED: if a single encrypted field cannot be decrypted with either
//     key, NOTHING is written and the exit code is non-zero.
//   - Idempotent: fields already under the current key are left byte-identical.
//   - File mode: a timestamped backup is taken first; the write is atomic
//     (tmp + rename, mode 0600) — same discipline as the store itself.
//   - Postgres mode: loads/persists through the same PgStore the server uses.
import { readFileSync, writeFileSync, copyFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { config } from "../src/config.js";
import { encryptField, decryptField } from "../src/crypto.js";

// Strict shape check for our v1 AES-256-GCM wire format:
// "v1:<iv 12B hex>:<tag 16B hex>:<ciphertext hex>". Deliberately tighter than
// crypto.js isEncrypted() so an unrelated string that merely starts with
// "v1:" can never be mistaken for a ciphertext and abort a rotation.
export function looksEncrypted(v) {
  if (typeof v !== "string") return false;
  const p = v.split(":");
  return p.length === 4 && p[0] === "v1" &&
    /^[0-9a-f]{24}$/.test(p[1]) && /^[0-9a-f]{32}$/.test(p[2]) &&
    p[3].length > 0 && p[3].length % 2 === 0 && /^[0-9a-f]+$/.test(p[3]);
}

// Walk the whole state tree and re-encrypt in place. Returns nothing; fills
// stats = { rotated, alreadyCurrent, failed: [paths] }.
export function rotateTree(node, stats, path = "$") {
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) node[i] = rotateValue(node[i], stats, path + "[" + i + "]");
    return node;
  }
  if (node && typeof node === "object") {
    for (const k of Object.keys(node)) node[k] = rotateValue(node[k], stats, path + "." + k);
    return node;
  }
  return node;
}

function rotateValue(v, stats, path) {
  if (typeof v === "string" && looksEncrypted(v)) {
    // Already under the current key? Leave it byte-identical (idempotent).
    try {
      decryptField(v, [config.encKey]);
      stats.alreadyCurrent++;
      return v;
    } catch {}
    try {
      const plaintext = decryptField(v, [config.encKeyPrevious]);
      stats.rotated++;
      return encryptField(plaintext); // fresh IV, current key
    } catch {
      stats.failed.push(path);
      return v;
    }
  }
  if (v && typeof v === "object") return rotateTree(v, stats, path);
  return v;
}

function fatal(msg) {
  console.error("rotate-enc-key: " + msg);
  process.exit(1);
}

async function main() {
  const args = process.argv.slice(2);
  const usePg = args.includes("--pg");
  const dbFlagAt = args.indexOf("--db");
  const dbPath = dbFlagAt >= 0 ? args[dbFlagAt + 1] : (usePg ? null : config.dbPath);

  if (!process.env.BP_ENC_KEY) {
    fatal("BP_ENC_KEY (the NEW, current key) must be set explicitly — refusing to rotate onto an ephemeral dev key");
  }
  if (!config.encKeyPrevious) {
    fatal("BP_ENC_KEY_PREVIOUS (the OLD key) must be set — there is nothing to rotate from without it");
  }

  const stats = { rotated: 0, alreadyCurrent: 0, failed: [] };

  if (usePg) {
    if (!config.pgUrl) fatal("--pg requires BP_PG_URL");
    // Same store the server boots with — stop the app first (single writer).
    const { PgStore } = await import("../src/store-pg.js");
    const store = await PgStore.create(config.pgUrl);
    rotateTree(store.data, stats);
    if (stats.failed.length) {
      if (store.close) await store.close();
      fatal("refusing to write: " + stats.failed.length + " field(s) undecryptable with either key:\n  " + stats.failed.join("\n  "));
    }
    store.persist();
    if (store.flush) await store.flush();
    if (store.close) await store.close();
  } else {
    if (!dbPath) fatal("pass --db <path-to-db.json> (or set BP_DB), or --pg for Postgres");
    const data = JSON.parse(readFileSync(dbPath, "utf8"));
    rotateTree(data, stats);
    if (stats.failed.length) {
      fatal("refusing to write: " + stats.failed.length + " field(s) undecryptable with either key:\n  " + stats.failed.join("\n  "));
    }
    const backup = dbPath + ".pre-rotation." + Date.now();
    copyFileSync(dbPath, backup);
    const tmp = dbPath + ".rotate.tmp";
    writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    renameSync(tmp, dbPath);
    console.log("backup written: " + backup);
  }

  console.log(JSON.stringify({ rotated: stats.rotated, alreadyCurrent: stats.alreadyCurrent, failed: 0 }));
  console.log("done. Verify the app boots and reads decrypt, then remove BP_ENC_KEY_PREVIOUS (and BP_ENC_SALT_PREVIOUS).");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => fatal(String((err && err.stack) || err)));
}
