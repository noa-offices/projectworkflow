import assert from "node:assert/strict";
import test from "node:test";
import { buildModularCompositionSpecification, resolveFinalProductSpecification } from "./product-template-snapshot.js";

const build = (items: Parameters<typeof buildModularCompositionSpecification>[0]["items"], overrides: Partial<Parameters<typeof buildModularCompositionSpecification>[0]> = {}) => buildModularCompositionSpecification({
  items,
  modularDefaultSpecification: "Fully upholstered modular lounge seating.",
  ...overrides,
});

test("keeps the base fallback and excludes zero or unselected modular rows", () => {
  assert.equal(build([]), "Fully upholstered modular lounge seating.");
  assert.equal(build([{ itemName: "Side Element", quantity: 0 }, { itemName: "Corner Element", quantity: null }]), "Fully upholstered modular lounge seating.");
});

test("uses a concise row specification for one selected row at quantity one", () => {
  assert.equal(build([{ itemName: "Sofa 200", quantity: 1, specification: "Complete sofa." }]), "Complete sofa.");
});

test("one row above quantity one is quantity-aware and pluralized", () => {
  assert.equal(build([{ itemName: "Pouf", quantity: 2, specification: "Individual pouf." }]), "Fully upholstered modular lounge seating comprising 2 poufs.");
});

test("uses natural joining, singular/plural wording, and stable source order", () => {
  assert.equal(build([
    { itemName: "Side Element", quantity: 1 },
    { itemName: "Central Element", quantity: 2 },
    { itemName: "Chaise Longue", quantity: 1 },
  ]), "Fully upholstered modular lounge seating comprising 1 side element, 2 central elements and 1 chaise longue.");
  assert.equal(build([{ itemName: "Left", quantity: 1 }, { itemName: "Right", quantity: 1 }]), "Fully upholstered modular lounge seating comprising 1 left and 1 right.");
});

test("includes cushions and poufs once without concatenating row specifications", () => {
  const result = build([
    { itemName: "Side Element", quantity: 1, specification: "Modular side element." },
    { itemName: "Feather Cushion - 45x45cm", quantity: 4, specification: "Loose cushion detail." },
    { itemName: "Pouf", quantity: 1, specification: "Pouf detail." },
  ]);
  assert.equal(result, "Fully upholstered modular lounge seating comprising 1 side element, 4 feather cushions 45×45 cm and 1 pouf.");
  assert.ok(!result?.includes("Modular side element"));
  assert.ok(!result?.includes("Loose cushion detail"));
});

test("appends the selected upholstery category once", () => {
  assert.equal(build([{ itemName: "Side Element", quantity: 1 }, { itemName: "Centre", quantity: 2 }], { selectedCategory: "Fabric Cat. H" }), "Fully upholstered modular lounge seating comprising 1 side element and 2 centres. Upholstery: Fabric Cat. H.");
  assert.equal(build([{ itemName: "Pouf", quantity: 2 }], { modularDefaultSpecification: "Modular seating in Fabric Cat. H.", selectedCategory: "Fabric Cat. H" }), "Modular seating in Fabric Cat. H comprising 2 poufs.");
});

test("falls back through template specification and description, then a neutral modular phrase", () => {
  const items = [{ itemName: "Corner Element", quantity: 1 }];
  assert.equal(build(items, { modularDefaultSpecification: null, templateDefaultSpecification: "Upholstered seating.", templateDescription: "Description." }), "Upholstered seating comprising 1 corner element.");
  assert.equal(build(items, { modularDefaultSpecification: null, templateDefaultSpecification: null, templateDescription: "Product description." }), "Product description comprising 1 corner element.");
  assert.equal(build(items, { modularDefaultSpecification: null, templateDefaultSpecification: null, templateDescription: null }), "Modular lounge seating comprising 1 corner element.");
});

test("is deterministic across local/server item shapes and never mutates numeric pricing", () => {
  const localItems = [{ itemName: "Side Element", quantity: 1, specification: "Side.", price: 100 }, { itemName: "Central Element", quantity: 2, specification: "Centre.", price: 250 }];
  const serverItems = localItems.map((item) => ({ label: item.itemName, quantity: item.quantity, specification: item.specification }));
  const before = structuredClone(localItems);
  assert.equal(build(localItems), build(serverItems));
  assert.deepEqual(localItems, before);
});

test("an explicitly edited Final Specification remains authoritative", () => {
  const generatedSpecification = build([{ itemName: "Side Element", quantity: 1 }, { itemName: "Centre", quantity: 2 }]);
  assert.equal(resolveFinalProductSpecification({ editedSpecification: "Sales-approved wording.", generatedSpecification, wasEdited: true }), "Sales-approved wording.");
  assert.equal(resolveFinalProductSpecification({ editedSpecification: "Sales-approved wording.", generatedSpecification, wasEdited: false }), generatedSpecification);
});
