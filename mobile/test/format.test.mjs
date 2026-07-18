// INR formatting — Indian digit grouping (lakh/crore), always 2 decimals.
import test from "node:test";
import assert from "node:assert/strict";
import { fmtINR } from "../src/format.js";

test("formats with Indian grouping and 2 decimals", () => {
  assert.equal(fmtINR(0), "₹0.00");
  assert.equal(fmtINR(450), "₹450.00");
  assert.equal(fmtINR(245.5), "₹245.50");
  assert.equal(fmtINR(250000), "₹2,50,000.00");
  assert.equal(fmtINR(10000000), "₹1,00,00,000.00");
});

test("tolerates null/undefined/strings without throwing", () => {
  assert.equal(fmtINR(null), "₹0.00");
  assert.equal(fmtINR(undefined), "₹0.00");
  assert.equal(fmtINR("450"), "₹450.00");
});
