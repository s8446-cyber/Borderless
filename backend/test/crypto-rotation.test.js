// Encryption key rotation tests:
//   - decryptField accepts an ordered list of candidate keys (current first,
//     then BP_ENC_KEY_PREVIOUS) so reads keep working mid-rotation
//   - GCM authentication: a wrong key or tampered ciphertext always throws
//   - scripts/rotate-enc-key.mjs re-encrypts every stored field under the new
//     key, is idempotent, backs up first, and is FAIL-CLOSED (an undecryptable
//     field aborts the run with the file untouched).
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

import { encryptField, decryptField, isEncrypted } from "../src/crypto.js";

const oldKey = randomBytes(32);
const newKey = randomBytes(32);
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "rotate-enc-key.mjs");

function runScript(args, env) {
  return execFileSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, BP_ENV: "development", ...env },
    encoding: "utf8",
  });
}

test("decryptField: ordered multi-key fallback (rotation reads)", () => {
  const blob = encryptField("secret-value", oldKey);
  assert.ok(isEncrypted(blob));
  // single-key call still works (back-compat)
  assert.equal(decryptField(blob, oldKey), "secret-value");
  // rotation shape: try new key first, fall back to old
  assert.equal(decryptField(blob, [newKey, oldKey]), "secret-value");
  // the wrong key can never silently \"decrypt\" — GCM auth throws
  assert.throws(() => decryptField(blob, [newKey]));
});

test("decryptField: tampered ciphertext throws under every candidate key", () => {
  const blob = encryptField("x", oldKey);
  const parts = blob.split(":");
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("00") ? "11" : "00");
  assert.throws(() => decryptField(parts.join(":"), [newKey, oldKey]));
});

test("rotate-enc-key.mjs: re-encrypts every stored field under the new key", () => {
  const dir = mkdtempSync(join(tmpdir(), "bp-rotate-"));
  const db = join(dir, "db.json");
  writeFileSync(db, JSON.stringify({
    schemaVersion: 3,
    accounts: { usr_1: { bank: "HDFC", balanceMinor: 0, accountRefEnc: encryptField("12345678901234", oldKey) } },
    credentials: { "a@b.com": { userId: "usr_1", totpSecretEnc: encryptField("JBSWY3DPEHPK3PXP", oldKey) } },
    payments: {},
  }));
  const out = runScript(["--db", db], {
    BP_ENC_KEY: newKey.toString("hex"),
    BP_ENC_KEY_PREVIOUS: oldKey.toString("hex"),
  });
  assert.match(out, /"rotated":2/);
  const rotated = JSON.parse(readFileSync(db, "utf8"));
  // decryptable by the NEW key alone; the old key is retired from rest
  assert.equal(decryptField(rotated.accounts.usr_1.accountRefEnc, [newKey]), "12345678901234");
  assert.equal(decryptField(rotated.credentials["a@b.com"].totpSecretEnc, [newKey]), "JBSWY3DPEHPK3PXP");
  assert.throws(() => decryptField(rotated.accounts.usr_1.accountRefEnc, [oldKey]));
  // non-encrypted data untouched
  assert.equal(rotated.accounts.usr_1.bank, "HDFC");
  // a pre-rotation backup exists
  assert.ok(readdirSync(dir).some((f) => f.startsWith("db.json.pre-rotation.")), "backup created");
});

test("rotate-enc-key.mjs: fail-closed — an undecryptable field aborts with NO write", () => {
  const dir = mkdtempSync(join(tmpdir(), "bp-rotate-"));
  const db = join(dir, "db.json");
  const strangerKey = randomBytes(32);
  const original = JSON.stringify({
    accounts: { usr_1: { accountRefEnc: encryptField("999", strangerKey) } },
  });
  writeFileSync(db, original);
  assert.throws(() => runScript(["--db", db], {
    BP_ENC_KEY: newKey.toString("hex"),
    BP_ENC_KEY_PREVIOUS: oldKey.toString("hex"),
  }));
  assert.equal(readFileSync(db, "utf8"), original, "file byte-identical after refused rotation");
  assert.ok(!readdirSync(dir).some((f) => f.includes(".rotate.tmp")), "no temp file left behind");
});

test("rotate-enc-key.mjs: idempotent — fields already under the current key stay byte-identical", () => {
  const dir = mkdtempSync(join(tmpdir(), "bp-rotate-"));
  const db = join(dir, "db.json");
  const blob = encryptField("already-current", newKey);
  writeFileSync(db, JSON.stringify({ accounts: { usr_1: { accountRefEnc: blob } } }));
  const out = runScript(["--db", db], {
    BP_ENC_KEY: newKey.toString("hex"),
    BP_ENC_KEY_PREVIOUS: oldKey.toString("hex"),
  });
  assert.match(out, /"rotated":0/);
  assert.match(out, /"alreadyCurrent":1/);
  const after = JSON.parse(readFileSync(db, "utf8"));
  assert.equal(after.accounts.usr_1.accountRefEnc, blob, "unchanged ciphertext bytes");
});
