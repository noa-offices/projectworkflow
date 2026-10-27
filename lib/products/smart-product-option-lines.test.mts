import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraft } from "./product-template-draft";
import { addReviewedOptionLine, moveReviewedOptionLine, removeReviewedOptionLine, toggleReviewedOptionDefault } from "./smart-product-review";

const item = (id: string) => ({ id, label: id, displayName: id, supplierCodes: [], referenceCodes: [], dimensions: null, currency: "EUR" as const, price: null, specification: null });
const draft = { optionGroups: [{ id: "colours", label: "Plastic Parts Colour", selection: { mode: "optional", minSelections: 0, maxSelections: 1, defaultItemIds: [] }, items: [item("white"), item("grey")] }] } as unknown as ProductTemplateDraft;

test("manual lines keep zero distinct from missing price and join the imported items", () => {
  const zero = addReviewedOptionLine(draft, 0, { id: "black", name: " Black Plastic Parts ", supplierCode: " B-1 ", price: "0", specification: " Matte " });
  assert.deepEqual(zero.optionGroups[0].items.map((line) => line.id), ["white", "grey", "black"]);
  assert.equal(zero.optionGroups[0].items[2].price, 0);
  assert.equal(zero.optionGroups[0].items[2].currency, "EUR");
  assert.deepEqual(zero.optionGroups[0].items[2].supplierCodes, ["B-1"]);
  assert.equal(zero.optionGroups[0].items[2].specification, "Matte");
  const missing = addReviewedOptionLine(draft, 0, { id: "black", name: "Black", supplierCode: "", price: "", specification: "" });
  assert.equal(missing.optionGroups[0].items[2].price, null);
});

test("move, default, and confirmed removal produce the Apply order and clear stale defaults", () => {
  const added = addReviewedOptionLine(draft, 0, { id: "black", name: "Black", supplierCode: "", price: "0", specification: "" });
  const moved = moveReviewedOptionLine(added, 0, 2, -1);
  assert.deepEqual(moved.optionGroups[0].items.map((line) => line.id), ["white", "black", "grey"]);
  const selected = toggleReviewedOptionDefault(moved, 0, "black");
  assert.deepEqual(selected.optionGroups[0].selection.defaultItemIds, ["black"]);
  const removed = removeReviewedOptionLine(selected, 0, "black");
  assert.deepEqual(removed.optionGroups[0].items.map((line) => line.id), ["white", "grey"]);
  assert.deepEqual(removed.optionGroups[0].selection.defaultItemIds, []);
  const one = removeReviewedOptionLine(removed, 0, "grey");
  assert.equal(removeReviewedOptionLine(one, 0, "white"), one, "last item cannot be removed");
});

test("multiple-choice defaults can be toggled independently", () => {
  const multi = { ...draft, optionGroups: [{ ...draft.optionGroups[0], selection: { mode: "choose_multiple" as const, minSelections: 0, maxSelections: null, defaultItemIds: [] } }] };
  const first = toggleReviewedOptionDefault(multi, 0, "white");
  const second = toggleReviewedOptionDefault(first, 0, "grey");
  assert.deepEqual(second.optionGroups[0].selection.defaultItemIds, ["white", "grey"]);
  assert.deepEqual(toggleReviewedOptionDefault(second, 0, "white").optionGroups[0].selection.defaultItemIds, ["grey"]);
});
