import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { RawSupplierRow, SupplierProfile } from "./supplier-price-contracts";
import { familiesInRows, familySaves, initialFamilyChoices, missingSavedFamilies, previewImport, profileFromMapping, type FileFamily, type SavedFamilyRow, type WizardMapping } from "./supplier-import-wizard";

const wizard = readFileSync("components/products/supplier-import-wizard.tsx", "utf8");
const row = (index: number, values: Record<string, unknown>): RawSupplierRow => ({ unit_key: `r${index}`, row_number: index + 1, sheet: "S", values });
const rows = [
  row(1, { supplier_code: "521234", price: 57, category: "", family: "AIM", subfamily: "AIM" }),
  row(2, { supplier_code: "521234", price: 58, category: "", family: "EVERY", subfamily: "Silver" }),
  row(3, { supplier_code: "521234", price: 57, category: "", family: " Goal-Air ", subfamily: "" }),
  row(4, { supplier_code: "521235", price: 10, category: "SG3", family: "every", subfamily: "Silver" }),
  row(5, { supplier_code: "521236", price: 5, category: "", family: "", subfamily: "" }),
  row(6, { supplier_code: "521237", price: 5, category: "", family: 7, subfamily: null }),
];
const mapping: WizardMapping = { fullCode: "supplier_code", articleCode: "", description: "", category: "category", priceColumns: [{ column: "price", label: "" }], currency: "EUR", basis: "list", structure: "simple", articleLength: 6, finishLength: 3 };
const profileFor = (extra: Partial<WizardMapping>): SupplierProfile => profileFromMapping({ ...mapping, ...extra });

test("step 2 preview shows Family and Sub-family only when those columns are chosen, and never the raw JSON tag", () => {
  const none = previewImport(rows, profileFor({}));
  assert.ok(none.every((item) => !("family" in item) && !("subfamily" in item)));
  assert.deepEqual(none.map((item) => item.dimension), ["—", "—", "—", "SG3", "—"], "existing behaviour: a label with a digit reads as a dimension");
  const family = previewImport(rows, profileFor({ series: "family" }), 6);
  assert.deepEqual(family.map((item) => item.family), ["AIM", "EVERY", "Goal-Air", "every", "—", "—"], "an empty or non-text family shows a dash");
  assert.ok(family.every((item) => !("subfamily" in item)));
  assert.ok(family.every((item) => !item.tier.includes("series") && !item.dimension.includes("series")), "the tag is shown as plain category, not JSON");
  assert.equal(family.find((item) => item.code === "521235")?.dimension, "SG3", "the plain category is kept");
  const both = previewImport(rows, profileFor({ series: "family", subfamily: "subfamily" }), 6);
  assert.deepEqual(both.slice(0, 3).map((item) => [item.family, item.subfamily]), [["AIM", "AIM"], ["EVERY", "Silver"], ["Goal-Air", "—"]]);
  assert.match(wizard, /profile\?\.series_column \? <th className="pr-3">Family<\/th> : null\}\{profile\?\.subfamily_column \? <th className="pr-3">Sub-family<\/th> : null/);
});

test("the families found in the file are read from the rows: text only, trimmed, one per normalised key, first spelling", () => {
  assert.deepEqual(familiesInRows(rows, "family"), [
    { family: "AIM", key: "aim", rows: 1 }, { family: "EVERY", key: "every", rows: 2 }, { family: "Goal-Air", key: "goal-air", rows: 1 },
  ]);
  assert.deepEqual(familiesInRows(rows, "missing_column"), []);
});

const file: FileFamily[] = familiesInRows(rows, "family");
const saved: SavedFamilyRow[] = [{ template_id: "T1", family: "EVERY", family_key: "every" }, { template_id: "T1", family: "Old Series", family_key: "old series" }, { template_id: "T2", family: "AIM", family_key: "aim" }];

test("a product is pre-selected only from what is saved, and a saved family missing from the file is warned about and never replaced", () => {
  assert.deepEqual(initialFamilyChoices(saved, file), { T1: ["every"], T2: ["aim"] });
  assert.deepEqual(initialFamilyChoices([], file), {}, "nothing is pre-selected without a saved choice");
  assert.deepEqual(missingSavedFamilies(saved, file, ["T1", "T2"]).map((item) => [item.template_id, item.family]), [["T1", "Old Series"]]);
  assert.deepEqual(missingSavedFamilies(saved, file, ["T2"]), [], "only ticked products are reported");
  assert.match(wizard, /Family \{row\.family\} is not in this price list\. Choose again\./);
  assert.doesNotMatch(wizard, /closest|fuzzy|fallback/i);
});

test("only ticked products the user changed are saved, with the file's spelling, several families allowed", () => {
  assert.deepEqual(familySaves(["T1", "T2"], {}, saved, file), [], "untouched products are never written");
  assert.deepEqual(familySaves(["T1"], { T1: ["every"] }, [{ template_id: "T1", family: "EVERY", family_key: "every" }], file), [], "an unchanged choice is not written");
  assert.deepEqual(familySaves(["T1"], { T1: ["every"] }, [], file), [{ templateId: "T1", families: ["EVERY"] }]);
  assert.deepEqual(familySaves(["T1"], { T1: ["every", "aim"] }, [], file), [{ templateId: "T1", families: ["AIM", "EVERY"] }]);
  assert.deepEqual(familySaves(["T1"], { T1: ["every"] }, saved, file), [{ templateId: "T1", families: ["EVERY"] }], "the missing saved family is dropped only because the user changed this product");
  assert.deepEqual(familySaves(["T1"], { T1: [] }, saved, file), [{ templateId: "T1", families: [] }], "clearing is possible only by an explicit change");
  assert.deepEqual(familySaves(["T2"], { T1: ["every"] }, [], file), [], "a product that is not ticked is ignored");
});

test("the wizard reads on load, saves only after coverage is confirmed, and hides the control without a family column", () => {
  // Reading is the only thing the effect does.
  const effect = wizard.slice(wizard.indexOf("useEffect(() => {\n    if (!loadSavedFor) return;"), wizard.indexOf("const activeSaved"));
  assert.match(effect, /listSupplierTemplateFamilies\(\{ definitionId: loadSavedFor \}\)/);
  assert.doesNotMatch(effect, /setSupplierTemplateFamilies|confirmSupplierCoverage/);
  // One write site, inside saveProductFamilies, called in startReview right after coverage.
  assert.equal((wizard.match(/await setSupplierTemplateFamilies\(/g) ?? []).length, 1);
  const save = wizard.slice(wizard.indexOf("async function saveProductFamilies"), wizard.indexOf("/** Product price review is prepared"));
  assert.match(save, /await setSupplierTemplateFamilies\(definitionForFamilies, change\.templateId, change\.families\)/);
  assert.match(save, /were not saved: \$\{error instanceof Error \? error\.message/);
  const coverage = wizard.indexOf("await confirmSupplierCoverage(coverageId, selected);");
  const call = wizard.indexOf("await saveProductFamilies(coverageId)");
  assert.ok(coverage > 0 && call > coverage, "families are saved after coverage is confirmed");
  assert.match(wizard, /if \(!withoutReview && coverageId && hasFamilyColumn\) await saveProductFamilies\(coverageId\)/);
  assert.ok(call < wizard.indexOf("describeSupplierImport(brandId, result.id)"), "and before the result is described");
  // The control only exists with a family column and families in the file; the replace flow returns before any of it.
  assert.match(wizard, /const showFamilyChoice = hasFamilyColumn && fileFamilies\.length > 0/);
  assert.match(wizard, /showFamilyChoice && selected\.includes\(family\.id\) \? <fieldset/);
  assert.match(wizard, /const hasFamilyColumn = Boolean\(mapping\?\.series\)/);
  assert.ok(wizard.indexOf("if (replace) {\n        // Success is reported") < call, "Replace Price List never reaches the family save");
});

test("the role guard stays in front, profiles without families are unchanged, and the control uses plain words", () => {
  assert.ok(wizard.indexOf("if (!approver) return") > wizard.indexOf("saveProductFamilies") === false, "the approver guard comes before the save function exists");
  assert.match(wizard, /if \(!approver\) return <section/);
  assert.match(wizard, /Supplier family for \{family\.name\}/);
  assert.match(wizard, /Choose one\. Choose more only if this product is sold under more than one family\./);
  const none = profileFor({});
  assert.equal("series_column" in none, false);
  assert.deepEqual(previewImport(rows.slice(0, 2), none), previewImport(rows.slice(0, 2), { ...none }));
});
