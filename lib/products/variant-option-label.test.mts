import assert from "node:assert/strict";
import test from "node:test";
import { variantOptionLabel } from "./variant-option-label";

const name = "Swivel Chair, Medium-High Back (Mesh) - Autolift";
test("label is code + name", () => {
  assert.equal(variantOptionLabel({ code: "EV251", name }), `EV251 - ${name}`);
});
test("no code gives the name only; only the first of several codes is used", () => {
  assert.equal(variantOptionLabel({ code: null, name }), name);
  assert.equal(variantOptionLabel({ code: "  ", name }), name);
  assert.equal(variantOptionLabel({ code: "EV251, EV252", name }), `EV251 - ${name}`);
});
test("the dimension text and price are never part of the label", () => {
  const label = variantOptionLabel({ code: "EV251", name, dimension: "Seat: H 415-540 x W 490 x D 450 mm", price: 1200 } as never);
  assert.doesNotMatch(label, /Seat:|\bmm\b|1200|AED/);
});
test("a name that already starts with the code does not repeat it", () => {
  assert.equal(variantOptionLabel({ code: "EV251", name: "EV251 Swivel Chair" }), "EV251 Swivel Chair");
  assert.equal(variantOptionLabel({ code: "ev251", name: "EV251 - Swivel Chair" }), "EV251 - Swivel Chair");
  assert.equal(variantOptionLabel({ code: "EV251", name: "EV2510 Swivel Chair" }), "EV251 - EV2510 Swivel Chair");
});
test("a very long name is kept whole in the data", () => {
  const long = "Long name ".repeat(60).trim();
  assert.equal(variantOptionLabel({ code: "EV1", name: long }), `EV1 - ${long}`);
});
