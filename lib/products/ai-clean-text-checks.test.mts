import assert from "node:assert/strict";
import test from "node:test";
import type { ProductTemplateDraftOptionGroup } from "./product-template-draft";
import { accessoryNamesFromSavedAccessoryPricing, buildAccessoryNameList, isSeatingRow, isValidShortDimension, isWordSubset, numbersInText } from "./ai-clean-text-checks";

const chairDimension = "Seat: H 415-540 x W 490 x D 450 mm, seat depth adjustment 405-465 mm; backrest H 600 mm; total: H 1130 x W 520 (without armrests) / 680 (with armrests) x D 615 mm";

test("numbersInText returns every number, decimals included, as strings", () => {
  assert.deepEqual(numbersInText("H 415-540 x W 490.5 mm"), ["415", "540", "490.5"]);
  assert.deepEqual(numbersInText("no numbers"), []);
  assert.deepEqual(numbersInText(""), []);
});

test("dimension: the overall size in W D H order is accepted", () => {
  assert.equal(isValidShortDimension(chairDimension, "W:520/680 D:615 H:1130 mm"), true);
  assert.equal(isValidShortDimension(chairDimension, "W:520 D:615 mm"), true, "subsets are allowed");
  assert.equal(isValidShortDimension(chairDimension, "H:1130 mm"), true);
});
test("dimension: a number that is not in the original is rejected", () => {
  assert.equal(isValidShortDimension(chairDimension, "W:520/700 D:615 H:1130 mm"), false);
  assert.equal(isValidShortDimension(chairDimension, "W:520/680 D:615 H:1130-1250 mm"), false);
});
test("dimension: a range is accepted only when both numbers are in the original", () => {
  assert.equal(isValidShortDimension("Seat height adjustable, total H 1130 to 1250, W 520, D 615 mm", "W:520 D:615 H:1130-1250 mm"), true);
  assert.equal(isValidShortDimension("total H 1130, W 520, D 615 mm", "W:520 D:615 H:1130-1250 mm"), false);
});
test("dimension: wrong order, wrong format, empty, or longer than the original is rejected", () => {
  assert.equal(isValidShortDimension(chairDimension, "H:1130 W:520/680 D:615 mm"), false);
  assert.equal(isValidShortDimension(chairDimension, "W:520/680 D:615 H:1130"), false, "unit mm is required");
  assert.equal(isValidShortDimension(chairDimension, "520 x 615 x 1130"), false);
  assert.equal(isValidShortDimension(chairDimension, ""), false);
  assert.equal(isValidShortDimension(chairDimension, "mm"), false);
  assert.equal(isValidShortDimension("W 520 D 615", "W:520 D:615 H:0 mm"), false);
  assert.equal(isValidShortDimension("W 5 D 6", "W:5 D:6 mm"), false, "longer than the original");
});
test("dimension: round products", () => {
  const round = "Round table, diameter Ø 600 mm, height 740 mm";
  assert.equal(isValidShortDimension(round, "Ø600 H:740 mm"), true);
  assert.equal(isValidShortDimension(round, "Ø600 H:750 mm"), false);
  assert.equal(isValidShortDimension(round, "Ø600 mm"), true);
});

const spec = "Swivel chair with medium-high mesh backrest, coloured mesh design included, seat upholstered. Autolift mechanism. Armrests optional. Standard equipment: black plastic parts, polyamide chair column, hard double castors; delivered knocked down in box.";
test("specification: only words from the original, shorter, and different", () => {
  assert.equal(isWordSubset(spec, "Swivel chair with medium-high mesh backrest, seat upholstered. Autolift mechanism."), true);
  assert.equal(isWordSubset(spec, "Ergonomic swivel chair with medium-high mesh backrest."), false, "new word");
  assert.equal(isWordSubset(spec, spec), false, "equal to the original");
  assert.equal(isWordSubset(spec, `  ${spec.toUpperCase()}  `), false, "same words, same order");
  assert.equal(isWordSubset(spec, ""), false);
  assert.equal(isWordSubset(spec, " ., "), false);
  assert.equal(isWordSubset("Swivel chair", "Swivel chair seat chair chair"), false, "longer than the original");
  assert.equal(isWordSubset("Swivel chair with mesh", "mesh chair"), true, "whole words from the original");
  assert.equal(isWordSubset("Swivel chairs", "chair"), false, "partial words do not count");
});

const selection = { mode: "optional", minSelections: 0, maxSelections: null, defaultItemIds: [] };
const item = (id: string, extra: Record<string, unknown> = {}) => ({ id, label: id, displayName: null, supplierCodes: [], referenceCodes: [], dimensions: null, currency: null, price: null, specification: null, ...extra });
const groups = [
  { id: "g1", label: "Armrests", selection, items: [
    item("a", { label: "Fixed Armrest", displayName: "Armrest, fixed", supplierCodes: ["AR-1", "AR-2"], referenceCodes: ["REF-9"], price: 123, specification: "SECRET SPEC" }),
    item("b", { label: "Fixed Armrest", supplierCodes: ["ar-1"], price: 456 }),
  ] },
  { id: "g2", label: "Base", isActive: false, selection, items: [item("c", { label: "Hidden base" })] },
] as unknown as ProductTemplateDraftOptionGroup[];
test("accessory names: labels, display names, supplier codes and group label; unique; no prices or specs", () => {
  const names = buildAccessoryNameList(groups);
  assert.deepEqual(names, ["Armrests", "Fixed Armrest", "Armrest, fixed", "AR-1", "AR-2"]);
  assert.doesNotMatch(JSON.stringify(names), /123|456|SECRET|REF-9/);
  assert.deepEqual(buildAccessoryNameList([]), []);
});
test("accessory names: capped at 60 and long strings are shortened", () => {
  const many = [{ id: "g", label: "G", selection, items: Array.from({ length: 100 }, (_, i) => item(`i${i}`, { label: `Item ${i}` })) }] as unknown as ProductTemplateDraftOptionGroup[];
  assert.equal(buildAccessoryNameList(many).length, 60);
  const long = [{ id: "g", label: "L".repeat(300), selection, items: [] }] as unknown as ProductTemplateDraftOptionGroup[];
  assert.ok(buildAccessoryNameList(long)[0].length <= 80);
});
test("accessory names from saved accessory_pricing: names and codes, no prices", () => {
  const saved = [{ id: "g", group_name: "Castors", items: [{ id: "x", item_name: "Hard castors", display_name: "Castors, hard", supplier_price_list_code: "CA-1, CA-2", price: 77, specification: "SECRET" }, { id: "y", item_name: "Soft castors", supplier_price_list_code: "", price: 88, is_active: false }] }];
  const names = accessoryNamesFromSavedAccessoryPricing(saved);
  assert.deepEqual(names, ["Castors", "Hard castors", "Castors, hard", "CA-1", "CA-2"]);
  assert.doesNotMatch(JSON.stringify(names), /77|88|SECRET/);
  assert.deepEqual(accessoryNamesFromSavedAccessoryPricing(null), []);
  assert.deepEqual(accessoryNamesFromSavedAccessoryPricing("nope"), []);
  assert.deepEqual(accessoryNamesFromSavedAccessoryPricing([{ group_name: 5, items: "x" }, null]), []);
});

test("seating gate: seating words are true, everything else and unknown text is false", () => {
  assert.equal(isSeatingRow({ displayName: "Swivel Chair, Medium-High Back" }), true);
  assert.equal(isSeatingRow({ groupLabel: "Task Chairs" }), true);
  assert.equal(isSeatingRow({ displayName: "Counter stool" }), true);
  assert.equal(isSeatingRow({ category: "Seating" }), true);
  assert.equal(isSeatingRow({ displayName: "Visitor armchair" }), true);
  assert.equal(isSeatingRow({ displayName: "Desk 1600" }), false);
  assert.equal(isSeatingRow({ displayName: "Screen" }), false);
  assert.equal(isSeatingRow({ displayName: "Chair castors" }), false, "chair parts are not seating rows");
  assert.equal(isSeatingRow({ displayName: "Chairman desk" }), false, "whole words only");
  assert.equal(isSeatingRow({ displayName: "XYZ-100" }), false);
  assert.equal(isSeatingRow({}), false);
  assert.equal(isSeatingRow({ displayName: null, groupLabel: null, category: null }), false);
});
