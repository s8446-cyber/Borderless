import test from "node:test";
import assert from "node:assert/strict";
import { t, setLocale, getLocale, detectLocale, isRTL, onLocaleChange, offLocaleChange } from "../src/i18n.js";

// reset to 'en' before each group
function reset() { setLocale("en"); }

test("t() returns English strings by default", () => {
  reset();
  assert.equal(t("ok"), "OK");
  assert.equal(t("cancel"), "Cancel");
  assert.equal(t("sign_in"), "Sign in");
});

test("t() interpolates {{params}}", () => {
  reset();
  assert.equal(t("savings", { rate: "4.5" }), "Growing at 4.5% p.a.");
  assert.equal(t("quote_expires_in", { sec: 30 }), "Rate locked for 30s");
  assert.equal(t("shortfall", { amount: "2,000" }), "Add \u20b92,000 to pay");
});

test("t() returns key when missing from both locales", () => {
  reset();
  assert.equal(t("totally_unknown_key_xyz"), "totally_unknown_key_xyz");
});

test("setLocale/getLocale switch language", () => {
  reset();
  setLocale("hi");
  assert.equal(getLocale(), "hi");
  assert.equal(t("ok"), "\u0920\u0940\u0915 \u0939\u0948");
  assert.equal(t("sign_in"), "\u0938\u093e\u0907\u0928 \u0907\u0928 \u0915\u0930\u0947\u0902");
  reset();
});

test("Hindi t() interpolates params correctly", () => {
  setLocale("hi");
  assert.equal(t("savings", { rate: "5" }), "5% \u092a\u094d\u0930.\u0935. \u0915\u0940 \u0926\u0930 \u0938\u0947 \u092c\u095d \u0930\u0939\u093e");
  reset();
});

test("Hindi falls back to English for keys not in hi dict", () => {
  reset(); setLocale("hi");
  const r = t("nonexistent_key_abc");
  assert.equal(r, "nonexistent_key_abc"); // key passthrough
  reset();
});

test("detectLocale: maps language tags to supported locales", () => {
  assert.equal(detectLocale("hi-IN"), "hi");
  assert.equal(detectLocale("hi"), "hi");
  assert.equal(detectLocale("en-US"), "en");
  assert.equal(detectLocale("en-GB"), "en");
  assert.equal(detectLocale("fr-FR"), "en"); // unsupported \u2192 en
  assert.equal(detectLocale(null), "en");
  assert.equal(detectLocale(""), "en");
});

test("isRTL: returns false for en and hi, true for ar/he/fa/ur", () => {
  assert.equal(isRTL("en"), false);
  assert.equal(isRTL("hi"), false);
  assert.equal(isRTL("ar"), true);
  assert.equal(isRTL("ar-AE"), true);
  assert.equal(isRTL("he"), true);
  assert.equal(isRTL("fa"), true);
  assert.equal(isRTL("ur"), true);
});

test("onLocaleChange fires on locale switch, not when unchanged", () => {
  reset();
  const events = [];
  const cb = (l) => events.push(l);
  onLocaleChange(cb);
  setLocale("hi");
  setLocale("hi"); // no-op
  setLocale("en");
  offLocaleChange(cb);
  setLocale("hi"); // should not fire after off
  assert.deepEqual(events, ["hi", "en"]);
  reset();
});
