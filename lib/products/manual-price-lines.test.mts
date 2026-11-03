import assert from "node:assert/strict";
import test from "node:test";
import { collectPriceChanges, MAX_PRICES_PER_SAVE, parsePriceInput, priceDifference, STALE_TEMPLATE_MESSAGE, validateChangesForSave, type ManualPriceLine } from "./manual-price-lines.js";

const lines: ManualPriceLine[] = [
  { key: "a", code: "RC-1", label: "White", price: 100, currency: "USD" },
  { key: "b", code: "RC-1", label: "Normal wood", price: 120.5, currency: "USD" },
  { key: "c", code: "RC-1", label: "Embossed", price: 140, currency: "USD" },
  { key: "d", code: "RC-2", label: "Empty", price: null, currency: "USD" },
];

test("only changed cells are sent", () => {
  const { changes, errors } = collectPriceChanges(lines, { a: "100", b: "125", c: "140.00" });
  assert.deepEqual(changes, [{ key: "b", newPrice: 125 }]);
  assert.deepEqual(errors, {});
  assert.deepEqual(collectPriceChanges(lines, {}).changes, []); // untouched inputs are prefilled with the current price
});

test("invalid numbers are refused", () => {
  for (const bad of ["", "  ", "abc", "-5", "1,000", "10.123", "1e3", "12 USD", "+5", "."]) assert.equal(parsePriceInput(bad).ok, false, bad);
  for (const good of ["0", "0.5", "12", "12.5", "12.55", " 7 "]) assert.equal(parsePriceInput(good).ok, true, good);
  const { changes, errors } = collectPriceChanges(lines, { a: "abc", b: "130" });
  assert.deepEqual(Object.keys(errors), ["a"]);
  assert.deepEqual(changes, [{ key: "b", newPrice: 130 }]);
});

test("lines without a price cannot be typed over", () => {
  assert.deepEqual(collectPriceChanges(lines, { d: "50" }), { changes: [], errors: {} });
  assert.throws(() => validateChangesForSave(lines, [{ key: "d", newPrice: 50 }], "7", "7"), /not available/);
});

test("live difference is rounded to cents", () => {
  assert.equal(priceDifference(lines[1], "125"), 4.5);
  assert.equal(priceDifference(lines[0], "99.99"), -0.01);
  assert.equal(priceDifference(lines[0], "x"), null);
  assert.equal(priceDifference(lines[3], "5"), null);
});

test("a stale version is refused before anything is written", () => {
  assert.throws(() => validateChangesForSave(lines, [{ key: "a", newPrice: 101 }], "7", "8"), (error: unknown) => error instanceof Error && error.message === STALE_TEMPLATE_MESSAGE);
  assert.equal(STALE_TEMPLATE_MESSAGE, "This Product Template changed. Reload before saving.");
});

test("server side checks repeat the browser rules", () => {
  assert.deepEqual(validateChangesForSave(lines, [{ key: "a", newPrice: 101 }, { key: "b", newPrice: 120.5 }], "7", "7"), [{ key: "a", newPrice: 101 }]); // unchanged cells are dropped
  assert.throws(() => validateChangesForSave(lines, [], "7", "7"), /no price changes/);
  assert.throws(() => validateChangesForSave(lines, "x", "7", "7"), /no price changes/);
  assert.throws(() => validateChangesForSave(lines, [{ key: "zzz", newPrice: 1 }], "7", "7"), /not available/);
  assert.throws(() => validateChangesForSave(lines, [{ key: "a", newPrice: 1 }, { key: "a", newPrice: 2 }], "7", "7"), /not available/);
  assert.throws(() => validateChangesForSave(lines, [{ key: "a", newPrice: -1 }], "7", "7"), /RC-1/);
  assert.throws(() => validateChangesForSave(lines, [{ key: "a", newPrice: "5" }], "7", "7"), /RC-1/);
  assert.throws(() => validateChangesForSave(lines, [{ key: "a", newPrice: 1.234 }], "7", "7"), /2 decimals/);
  const many = Array.from({ length: MAX_PRICES_PER_SAVE + 1 }, (_, i) => ({ key: "a", newPrice: i }));
  assert.throws(() => validateChangesForSave(lines, many, "7", "7"), /at most/);
});
