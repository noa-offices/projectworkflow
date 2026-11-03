import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ManualPriceLinesTable } from "./manual-price-lines-popup";

const lines = [
  { key: "a", code: "RC-1", label: "White", price: 100, currency: "USD" },
  { key: "b", code: "RC-1", label: "Normal wood", price: 120.5, currency: "USD" },
  { key: "d", code: "RC-2", label: "Empty", price: null, currency: "USD" },
];
const noop = () => {};

test("editable table: an input per priced line, prefilled with the current price, currency in the header", () => {
  const html = renderToStaticMarkup(<ManualPriceLinesTable lines={lines} currency="USD" canEdit inputs={{}} errors={{}} onInput={noop} />);
  assert.equal((html.match(/<input/g) ?? []).length, 2); // the empty price has no input
  assert.match(html, /value="100"/); assert.match(html, /value="120.5"/);
  assert.match(html, /New price \(USD\)/); assert.match(html, /Set it by hand in Edit Template/);
  assert.doesNotMatch(html, /data-changed="true"/);
});

test("changed rows are highlighted and show the live difference", () => {
  const html = renderToStaticMarkup(<ManualPriceLinesTable lines={lines} currency="USD" canEdit inputs={{ b: "125" }} errors={{}} onInput={noop} />);
  assert.equal((html.match(/data-changed="true"/g) ?? []).length, 1);
  assert.match(html, /\+4\.50/);
});

test("an invalid number shows its message next to the input", () => {
  const html = renderToStaticMarkup(<ManualPriceLinesTable lines={lines} currency="USD" canEdit inputs={{ a: "abc" }} errors={{ a: "Use numbers only, up to 2 decimals." }} onInput={noop} />);
  assert.match(html, /role="alert"[^>]*>Use numbers only/);
});

test("read-only mode has no inputs and no new-price columns", () => {
  const html = renderToStaticMarkup(<ManualPriceLinesTable lines={lines} currency="USD" canEdit={false} inputs={{}} errors={{}} onInput={noop} />);
  assert.doesNotMatch(html, /<input/); assert.doesNotMatch(html, /New price/); assert.doesNotMatch(html, /Difference/);
  assert.match(html, /Current price \(USD\)/); assert.match(html, /Normal wood/);
});
