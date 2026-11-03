import assert from "node:assert/strict";
import test from "node:test";
import { initialPricingDimensionCode, pricingColumns, PricingColumnIdentityError } from "./pricing-category-columns.js";
import { mapDraftPriceMatricesToCategoryGroups } from "./product-template-draft-category-adapter.js";
import { createSmartSetupReviewRouting } from "./smart-product-review-routing.js";
import { smartSetupBlockingIssues } from "./smart-product-review-issues.js";
import { describeSmartSetupApplyError, mapSmartDraftForApply, previewSmartSetupApply, runGuardedSmartSetupApply } from "./smart-setup-apply-preview.js";
import type { ProductTemplateDraft } from "./product-template-draft.js";

const tricky = ["Grade A", "Grade A+", "Grade A-", "A & B", "A/B", "100%", "A (new)", "+++", "   ", "", "Grade A", "Grade A", "x".repeat(400), "Größe", "日本語", "Grade A plus", "A and B"];

test("tricky labels never throw, give unique codes and the same result twice", () => {
  const first = pricingColumns({ price_categories: tricky });
  const second = pricingColumns({ price_categories: tricky });
  assert.deepEqual(first, second);
  const codes = first.map((column) => column.dimension_code);
  assert.equal(new Set(codes).size, codes.length);
  codes.forEach((code) => assert.match(code, /^[a-z0-9]+(?:_[a-z0-9]+)*$/));
});

test("symbols become words and no code is ever empty", () => {
  assert.equal(initialPricingDimensionCode("Grade A+"), "grade_a_plus");
  assert.equal(initialPricingDimensionCode("A & B"), "a_and_b");
  assert.equal(initialPricingDimensionCode("100%"), "100_percent");
  assert.equal(initialPricingDimensionCode("A/B"), "a_b");
  assert.equal(initialPricingDimensionCode("Grade A-"), "grade_a");
  assert.equal(initialPricingDimensionCode("+++"), "plus_plus_plus");
  assert.equal(initialPricingDimensionCode("$$$"), "column");
  assert.equal(initialPricingDimensionCode(""), "column");
});

test("labels with only letters, digits and spaces keep exactly the code they had before", () => {
  const before = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  for (const label of ["Grade A", "Cat B", "Fabric Cat I", "COM S", "Leather Cat Lusso", "Customer Material", "  Cat   D ", "Größe 2", "A1 B2"]) assert.equal(initialPricingDimensionCode(label), before(label), label);
  assert.equal(initialPricingDimensionCode("Cat. B-C"), "cat_b_c");
  assert.equal(initialPricingDimensionCode("COM / S"), "com_s");
});

test("auto codes that collide get _2, _3 in column order", () => {
  assert.deepEqual(pricingColumns({ price_categories: ["Grade A", "Grade-A", "Grade_A", "grade a"] }).map((column) => column.dimension_code), ["grade_a", "grade_a_2", "grade_a_3", "grade_a_4"]);
  assert.deepEqual(pricingColumns({ price_categories: ["$", "£"] }).map((column) => column.dimension_code), ["column", "column_2"]);
});

test("an explicit code always wins over an auto code", () => {
  const columns = pricingColumns({ price_columns: [{ id: "a", label: "Grade A" }, { id: "b", label: "Other", dimension_code: "grade_a" }] });
  assert.deepEqual(columns.map((column) => column.dimension_code), ["grade_a_2", "grade_a"]);
});

test("explicit codes that clash name both columns in plain English", () => {
  assert.throws(() => pricingColumns({ price_columns: [{ id: "a", label: "Grade A", dimension_code: "grade_a" }, { id: "b", label: "Grade A+", dimension_code: "grade_a" }] }), (error: unknown) => {
    assert.ok(error instanceof PricingColumnIdentityError);
    assert.match(error.message, /"Grade A"/); assert.match(error.message, /"Grade A\+"/); assert.match(error.message, /grade_a/);
    return true;
  });
  assert.throws(() => pricingColumns({ price_columns: [{ id: "a", label: "Grade A", dimension_code: "Grade A" }] }), /Grade A/);
});

function draft(columns: Array<{ id: string; label: string; dimensionCode?: string }>): ProductTemplateDraft {
  return {
    version: 1,
    template: { templateName: null, templateCode: null, itemCode: null, internalSelectionName: null, description: null, specification: null, origin: null, supplierName: null, dimensions: null, supplierCodes: [], referenceCodes: [] },
    defaultCurrency: "USD",
    pricing: {
      workstationRows: [], baseModelRows: [], modularGroups: [],
      priceMatrices: [{ id: "rose", label: "Rose Chair", columns, rows: [{ id: "r1", label: "Chair", displayName: null, dimensions: null, currency: "USD", specification: null, supplierCodes: ["RC-1"], referenceCodes: [], prices: Object.fromEntries(columns.map((column, index) => [column.id, 100 + index])), unavailableCategoryIds: [] }] }],
    },
    optionGroups: [], materialSuggestions: [], linkedFamilySuggestions: [], extractionWarnings: [], confidence: null, sources: [],
  } as unknown as ProductTemplateDraft;
}

const colan = () => draft([{ id: "grade-a", label: "Grade A" }, { id: "grade-a-plus", label: "Grade A+" }, { id: "grade-b", label: "Grade B" }]);
const clash = () => draft([{ id: "c1", label: "Grade A", dimensionCode: "grade_a" }, { id: "c2", label: "Grade A+", dimensionCode: "grade_a" }]);

test("Colan style matrix with Grade A and Grade A+ maps and applies", () => {
  const result = mapDraftPriceMatricesToCategoryGroups(colan());
  assert.deepEqual(result.groups[0].price_columns.map((column) => column.dimension_code), ["grade_a", "grade_a_plus", "grade_b"]);
  const plan = createSmartSetupReviewRouting(colan());
  assert.equal(previewSmartSetupApply(colan(), plan), null);
  assert.equal(mapSmartDraftForApply(colan(), plan).categoryResult.groups.length, 1);
});

test("preview reports a clear blocking issue linked to the group", () => {
  const plan = createSmartSetupReviewRouting(clash());
  const problem = previewSmartSetupApply(clash(), plan);
  assert.ok(problem);
  assert.match(problem.message, /Rose Chair/); assert.match(problem.message, /"Grade A"/); assert.match(problem.message, /"Grade A\+"/);
  const issues = smartSetupBlockingIssues({ routes: plan.routes, routingErrors: [problem.message], currencyBlocked: false, accessoryReviewMessage: null });
  assert.equal(issues.length, 1); // Apply is disabled whenever this list is not empty
  assert.equal(issues[0].routeKey, plan.routes.find((route) => route.sourceName === "Rose Chair")?.key);
  assert.throws(() => mapSmartDraftForApply(clash(), plan), /Grade A/); // Apply would have failed the same way
});

test("a guarded handler catches the error and returns a message", () => {
  const plan = createSmartSetupReviewRouting(clash());
  const outcome = runGuardedSmartSetupApply(() => mapSmartDraftForApply(clash(), plan));
  assert.equal(outcome.ok, false);
  if (!outcome.ok) { assert.match(outcome.problem.message, /both use the code/); assert.ok(outcome.problem.details); }
  const unknown = runGuardedSmartSetupApply(() => { throw new TypeError("x is undefined at foo.ts:12"); });
  assert.equal(unknown.ok, false);
  if (!unknown.ok) { assert.match(unknown.problem.message, /Nothing was changed/); assert.match(unknown.problem.details, /x is undefined/); }
  assert.deepEqual(runGuardedSmartSetupApply(() => 5), { ok: true, value: 5 });
  assert.equal(describeSmartSetupApplyError("boom").details, "boom");
});
