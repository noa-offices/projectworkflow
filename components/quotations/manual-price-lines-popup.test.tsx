import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ManualPriceLinesTable } from "./manual-price-lines-popup";
import type { ManualPriceLine } from "@/lib/products/manual-price-lines";

const cell = (key: string, rowKey: string, rowName: string, columnName: string, price: number | null, currency = "USD"): ManualPriceLine =>
  ({ key, code: rowName, label: columnName, price, currency, rowKey, rowName, columnName });
// Swivel Armchair has Grade A and Grade A+; Footrest has Grade A only (no Grade A+ price).
const lines = [
  cell("s-a", "swivel", "Rose Chair - Swivel Armchair", "GRADE A", 319),
  cell("s-ap", "swivel", "Rose Chair - Swivel Armchair", "GRADE A+", 349),
  cell("f-a", "foot", "Rose Chair - Footrest", "GRADE A", 120.5),
];
const noop = () => {};
const render = (props: Partial<Parameters<typeof ManualPriceLinesTable>[0]> = {}) => renderToStaticMarkup(<ManualPriceLinesTable lines={lines} canEdit inputs={{}} errors={{}} onInput={noop} {...props} />);

test("one row per variant and one column per price name", () => {
  const html = render();
  assert.equal((html.match(/<tbody>[\s\S]*<\/tbody>/)?.[0].match(/<tr/g) ?? []).length, 2);
  assert.match(html, />GRADE A</); assert.match(html, />GRADE A\+</);
  assert.match(html, /Rose Chair - Swivel Armchair/); assert.match(html, /Rose Chair - Footrest/);
  assert.equal((html.match(/<th[ >]/g) ?? []).length, 3); // Product + two price names
});

test("each cell shows the current price with currency and a New price box under it, prefilled", () => {
  const html = render();
  assert.match(html, /USD 319\.00/); assert.match(html, /USD 349\.00/); assert.match(html, /USD 120\.50/);
  assert.equal((html.match(/<input/g) ?? []).length, 3);
  assert.match(html, /value="319"/); assert.match(html, /value="120.5"/);
});

test("a missing price is a dash with no box", () => {
  const html = render();
  assert.equal((html.match(/<input/g) ?? []).length, 3); // 3 priced cells, not 4
  assert.match(html, /<td[^>]*>—<\/td>/);
});

test("a product with one price name shows one column", () => {
  const html = render({ lines: [cell("a", "r1", "Arm pad", "Price", 50), cell("b", "r2", "Cushion", "Price", 30)] });
  assert.equal((html.match(/<th[ >]/g) ?? []).length, 2);
  assert.equal((html.match(/<input/g) ?? []).length, 2);
});

test("the difference shows under the box only when the typed price differs", () => {
  assert.doesNotMatch(render(), /\+\d|data-changed="true"/);
  const html = render({ inputs: { "s-ap": "355.5" } });
  assert.equal((html.match(/data-changed="true"/g) ?? []).length, 1);
  assert.match(html, /\+6\.50/);
  assert.doesNotMatch(render({ inputs: { "s-ap": "349" } }), /data-changed="true"/);
});

test("an invalid number shows its message next to the box", () => {
  assert.match(render({ inputs: { "s-a": "abc" }, errors: { "s-a": "Use numbers only, up to 2 decimals." } }), /role="alert"[^>]*>Use numbers only/);
});

test("read-only mode has no boxes and still shows the current prices", () => {
  const html = render({ canEdit: false });
  assert.doesNotMatch(html, /<input/);
  assert.match(html, /USD 319\.00/); assert.match(html, /GRADE A\+/);
});

test("lines keep their own currency in each cell", () => {
  const html = render({ lines: [cell("a", "r1", "A", "Price", 10, "USD"), cell("b", "r2", "B", "Price", 20, "AED")], canEdit: false });
  assert.match(html, /USD 10\.00/); assert.match(html, /AED 20\.00/);
});

test("a product with no price cells says so", () => {
  assert.match(render({ lines: [] }), /This product has no prices yet\. Add them in Edit Template\./);
});
