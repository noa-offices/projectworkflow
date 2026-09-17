import assert from "node:assert/strict";
import test from "node:test";
import { buildCompanyStyleProductSpecification, buildDirectModularDimensionSuggestion, buildModularCompositionSpecification, resolveFinalProductSpecification } from "./product-template-snapshot.js";

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

test("uses neutral, case-preserving, quotation-ready composition wording for Direct Modular rows without software phrasing", () => {
  const result = build([
    { itemName: "Starter Bench - W120", quantity: 1 },
    { itemName: "Intermediate Bench - W120", quantity: 1 },
  ], { modularPricingMode: "direct" });
  assert.equal(result, "Composition comprising 1 Starter Bench - W 120 and 1 Intermediate Bench - W 120.");
  assert.ok(!result?.includes("Modular configuration comprising"));
  assert.equal(build([{ itemName: "Corner Element", quantity: 1 }]), "Fully upholstered modular lounge seating comprising 1 corner element.");
});

test("builds a Direct Modular specification from rows, resolved companions, and useful requirements once", () => {
  const result = buildModularCompositionSpecification({
    items: [
      { itemName: "Starter Bench - W120", quantity: 1, specification: "Bench with panel base.", importantRequirements: ["Always complete with 2 ART.058 top-access units.", "25 mm thick tops."] },
      { itemName: "Intermediate Bench - W120", quantity: 1, specification: "Bench with panel base.", importantRequirements: ["25 mm thick tops."] },
    ],
    accessories: [
      { item_name: "Top-Access (Soft-Close)", supplier_price_list_code: "ART.058", qty: 4, specification: "Top-access with soft-close mechanism." },
      { item_name: "Unselected accessory", qty: 0, specification: "Must not appear." },
    ],
    modularPricingMode: "direct",
  });
  assert.equal(result, "Composition comprising 1 Starter Bench - W 120 and 1 Intermediate Bench - W 120, Bench with panel base, 25 mm thick tops, and Complete with 4 Top-Access units with soft-close mechanism.");
  assert.equal((result?.match(/Bench with panel base/g) ?? []).length, 1);
  assert.ok(!result?.includes("Always complete with 2 ART.058"));
  assert.ok(!result?.includes("Unselected accessory"));
});

test("selected accessories/options participate naturally and are deduplicated, while unselected ones are excluded", () => {
  const result = buildModularCompositionSpecification({
    items: [{ itemName: "Starter Bench - W120", quantity: 1, specification: "Bench with panel base." }],
    accessories: [
      { item_name: "Mobile Pedestal", qty: 1, specification: "Mobile pedestal." },
      { item_name: "Mobile Pedestal", qty: 1, specification: "Mobile pedestal." },
      { item_name: "Desk Screen", qty: 0, specification: "Front fabric screen." },
    ],
    modularPricingMode: "direct",
  });
  assert.ok(result?.includes("Mobile Pedestal"));
  assert.equal((result?.match(/Mobile Pedestal/g) ?? []).length, 1);
  assert.ok(!result?.includes("Desk Screen"));
});

test("excludes commercial availability/stock notes from the Direct Modular specification without dropping other row facts", () => {
  const result = buildModularCompositionSpecification({
    items: [{
      itemName: "Starter Bench - W120",
      quantity: 1,
      specification: "Bench with panel base. Item available while supplies last.",
    }],
    accessories: [
      { item_name: "Cable Tray", qty: 1, specification: "Cable tray. Subject to availability." },
    ],
    modularPricingMode: "direct",
  });
  assert.ok(!result?.toLowerCase().includes("available while supplies last"));
  assert.ok(!result?.toLowerCase().includes("subject to availability"));
  assert.ok(result?.includes("Bench with panel base"));
  assert.ok(result?.includes("Cable Tray"));
});

test("appends an authoritative brand/origin line only when supplied, and never invents one", () => {
  const withBrand = buildModularCompositionSpecification({
    items: [{ itemName: "Starter Bench - W120", quantity: 1 }],
    modularPricingMode: "direct",
    brand: "LAS MOBILI",
    origin: "ITALY",
  });
  assert.equal(withBrand, "Composition comprising 1 Starter Bench - W 120.\nLAS MOBILI – ITALY");
  const withoutBrand = buildModularCompositionSpecification({
    items: [{ itemName: "Starter Bench - W120", quantity: 1 }],
    modularPricingMode: "direct",
  });
  assert.ok(!withoutBrand?.includes("–"));
});

test("suggests Direct Modular dimensions without calculating an unsupported overall width", () => {
  assert.equal(buildDirectModularDimensionSuggestion([{ itemName: "Starter Bench - W120", quantity: 1, dimension: "W120 x D145.2 x H73.6 cm" }]), "W120 × D145.2 × H73.6 cm");
  assert.equal(buildDirectModularDimensionSuggestion([
    { itemName: "Starter Bench - W120", quantity: 1, dimension: "W120 x D145.2 x H73.6 cm" },
    { itemName: "Intermediate Bench - W120", quantity: 1, dimension: "W120 x D145.2 x H73.6 cm" },
  ]), "Starter W120 × 1 + Intermediate W120 × 1 · D145.2 × H73.6 cm");
  assert.equal(buildDirectModularDimensionSuggestion([
    { itemName: "Starter Bench - W120", quantity: 1, dimension: "W120 x D145.2 x H73.6 cm" },
    { itemName: "Intermediate Bench - W140", quantity: 2, dimension: "W140 x D145.2 x H73.6 cm" },
  ]), "Starter W120 × 1 + Intermediate W140 × 2 · D145.2 × H73.6 cm");
});

test("consolidates a genuinely repeated identical module into one modules-count line", () => {
  assert.equal(buildDirectModularDimensionSuggestion([
    { itemName: "Intermediate Bench - W120", quantity: 2, dimension: "W120 x D145.2 x H73.6 cm" },
  ]), "2 modules · each W120 × D145.2 × H73.6 cm");
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

test("the general specification builder also excludes commercial availability notes and appends brand/origin only when authoritative", () => {
  const filtered = buildCompanyStyleProductSpecification({
    accessorySnapshots: [{ item_name: "Monitor Arm", specification: "Monitor arm. Item available while supplies last." }],
    linkedProductSnapshots: [],
    selectedOptionSnapshots: [],
    template: { default_specification: "Executive desk.", description: null },
  });
  assert.ok(!filtered?.toLowerCase().includes("available while supplies last"));

  const withBrand = buildCompanyStyleProductSpecification({
    accessorySnapshots: [],
    brand: "QUADRIFOGLIO",
    linkedProductSnapshots: [],
    origin: "ITALY",
    selectedOptionSnapshots: [],
    template: { default_specification: "Executive desk.", description: null },
  });
  assert.equal(withBrand, "Executive desk.\nQUADRIFOGLIO – ITALY");

  const withoutOrigin = buildCompanyStyleProductSpecification({
    accessorySnapshots: [],
    linkedProductSnapshots: [],
    selectedOptionSnapshots: [],
    template: { default_specification: "Executive desk.", description: null },
  });
  assert.equal(withoutOrigin, "Executive desk.");
});
