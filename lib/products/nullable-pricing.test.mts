import assert from "node:assert/strict";
import test from "node:test";
import { parseNullablePricingNumber, resolveInheritedPricingCurrency } from "./nullable-pricing.js";

test("JSON pricing preserves blank/null, explicit zero, and valid numeric strings", () => {
  assert.equal(parseNullablePricingNumber(""), null);
  assert.equal(parseNullablePricingNumber(null), null);
  assert.equal(parseNullablePricingNumber(0), 0);
  assert.equal(parseNullablePricingNumber("0"), 0);
  assert.equal(parseNullablePricingNumber("135"), 135);
  assert.equal(parseNullablePricingNumber("not-a-price"), null);
  assert.equal(parseNullablePricingNumber(Infinity), null);
});

test("template currency takes precedence over brand, then brand, then the system fallback", () => {
  const resolve = (values: { rowCurrency?: string | null; templateCurrency?: string | null; brandCurrency?: string | null }) =>
    resolveInheritedPricingCurrency({ ...values, fallbackCurrency: "AED", normalizeCurrency: (value) => value.toUpperCase() });
  assert.equal(resolve({ rowCurrency: "EUR", templateCurrency: "USD", brandCurrency: "AED" }), "EUR");
  assert.equal(resolve({ rowCurrency: null, templateCurrency: "USD", brandCurrency: "AED" }), "USD");
  assert.equal(resolve({ rowCurrency: null, templateCurrency: null, brandCurrency: "EUR" }), "EUR");
  assert.equal(resolve({ rowCurrency: null, templateCurrency: null, brandCurrency: null }), "AED");
});
