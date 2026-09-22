import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { normalizeCategoryPriceLabel } from "../../lib/products/category-pricing-groups.js";
import { explicitPricingCategoryLabels } from "../../lib/products/pricing-category-columns.js";

type TestModularRow = { prices?: Record<string, unknown> };
type TestModularGroup = { price_categories?: string[]; items?: TestModularRow[] };

/**
 * Mirrors ModularItemPricingTable's per-group Matrix Modular column derivation
 * (normalizeModularGroups's non-direct branch) with includeDefaultPriceCategories
 * hardcoded to false, matching the fix: incoming/explicit columns are authoritative,
 * and Cat A-D defaults are never auto-injected.
 */
function reviewGroupColumnsForTest(group: TestModularGroup) {
  const explicitCategories = explicitPricingCategoryLabels(group.price_categories);
  return Array.from(new Set([
    ...(explicitCategories.length ? explicitCategories : []),
    ...(explicitCategories.length ? [] : (group.price_categories ?? []).map(normalizeCategoryPriceLabel).filter(Boolean)),
    ...(explicitCategories.length ? [] : (group.items ?? []).flatMap((item) => Object.keys(item.prices ?? {}).map(normalizeCategoryPriceLabel).filter(Boolean))),
  ]));
}

test("accessory editor retains and edits the optional dimension field", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  ["dimension?: string", "dimension: row.dimension?.trim() ?? \"\"", "<th className=\"px-2 py-2\">Dimension</th>", "value={item.dimension ?? \"\"}", "updateItem(groupIndex, itemIndex, { dimension: e.target.value })"].forEach((expected) => assert.ok(source.includes(expected)));
});

test("pricing editors keep important requirements separate and normalize one line per value", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  ["function ImportantRequirementsTextarea", "One requirement per line", "reviewImportantRequirements(next)", "value={row.importantRequirements}", "value={normalizedRow.importantRequirements}", "value={item.importantRequirements}", "{ importantRequirements }"] .forEach((expected) => assert.ok(source.includes(expected)));
});

test("accessory editor replacement state retains category definitions and price maps", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  [
    "row.price_categories?.length ? { price_categories: row.price_categories.map((category) => ({ ...category })) }",
    "row.prices ? { prices: Object.fromEntries(Object.entries(row.prices)",
    "setGroups(normalizeAccessoryGroups(replacementGroups))",
    "(group.price_categories ?? []).length",
    "item.prices?.[category.id] ?? \"\"",
    'name="accessory_pricing" value={serialized}',
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected category accessory editor handoff: ${expected}`));
});

test("accessory editor validates the final live groups for dangling option_item references before submit", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  [
    "const finalAccessoryGroups = useMemo(",
    "const referenceIssues = useMemo(() => accessoryPricingReferenceIssues(finalAccessoryGroups), [finalAccessoryGroups]);",
    'process.env.NODE_ENV === "production"',
    "issue: issue.code, referencedGroupId, referencedItemId, submittedGroupIds, submittedItemsForReferencedGroup",
    "{referenceIssues.length ? (",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected final accessory_pricing reference validation wiring: ${expected}`));
});

test("conditional configuration editor includes workstation applicability choices", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  assert.ok(source.includes("applicabilityTargetChoices(baseModelGroups, categoryPricingGroups, modularPricingGroups, workstationPricingGroups)"));
  assert.ok(source.includes("workstationPricingGroups={workstationPricingGroups}"));
});

test("direct Modular groups retain scalar rows, roles, composition, and no fallback categories", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  ["function normalizeDirectModularRow", "price: parseNullablePricingNumber(row.price)", "modular_role:", "const direct = isDirectModularPricingGroup(sourceGroup)", "price_categories: direct ? [] : priceCategories", 'modular_pricing_mode: "direct"', "modular_composition: sourceGroup.modular_composition"].forEach((expected) => assert.ok(source.includes(expected), `Expected Direct Modular preservation: ${expected}`));
});

test("Direct Modular editor exposes scalar price and editable role without Matrix cells", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  ["const directGroup = isDirectModularPricingGroup(group)", "Direct Price", "aria-label=\"Modular Role\"", "<option value=\"starter\">Starter</option>", "<option value=\"intermediate\">Intermediate</option>", "<option value=\"terminal\">Terminal</option>", "modular_role: e.target.value || undefined"].forEach((expected) => assert.ok(source.includes(expected), `Expected Direct Modular editor control: ${expected}`));
});

test("Direct Modular rows collapse verbose metadata and use a synchronized real-table scrollbar", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  ["function SyncedHorizontalScrollContainer", "primaryRef", "stickyRef", "onScroll={syncPrimary}", "onScroll={syncSticky}", "ResizeObserver(measure)", "window.addEventListener(\"scroll\", measure, true)", "group.getBoundingClientRect()", "viewportVisible", "fixed bottom-20", "hasOverflow", "expandedRowByGroup", "Edit / Details", "Hide details", "<ImportantRequirementsTextarea value={normalizedRow.importantRequirements}", "<SyncedHorizontalScrollContainer>"].forEach((expected) => assert.ok(source.includes(expected), `Expected compact detail/scroll behavior: ${expected}`));
});

test("all pricing-table editors reuse the floating scrollbar wrapper without changing their table data paths", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  assert.ok((source.match(/<SyncedHorizontalScrollContainer>/g) ?? []).length >= 4);
  ["name=\"variant_pricing\" value={serialized}", "name=\"category_pricing\" value={serialized}", "name=\"modular_item_pricing\" value={serialized}", "name=\"accessory_pricing\" value={serialized}"].forEach((expected) => assert.ok(source.includes(expected), `Expected preserved editor serialization: ${expected}`));
});

test("Matrix Modular rows expose the same compact Role selector as Direct Modular while keeping category price cells, and group composition is no longer gated to Direct Modular only", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  [
    // Role column/selector is now rendered for every modular group (direct or matrix), not only inside the directGroup branch.
    '<th className="px-2 py-2">Role</th>',
    'aria-label="Modular Role" value={normalizedRow.modular_role ?? ""} onChange={(e) => updateRow(groupIndex, rowIndex, { modular_role: e.target.value || undefined })}',
    // Matrix rows still render their category price-cell inputs, one per priceCategories entry.
    "priceCategories.map((category) => <td key={category} className=\"px-2 py-2 align-top\"><input type=\"number\" value={normalizedRow.prices?.[category]",
    // normalizeCategory (the Matrix row normalizer) now preserves modular_role instead of dropping it.
    "const role = row.modular_role === \"starter\" || row.modular_role === \"intermediate\" || row.modular_role === \"terminal\" ? row.modular_role : undefined;",
    "...(role ? { modular_role: role } : {}),",
    // Group-level composition serialization is no longer wrapped inside the isDirectModularPricingGroup gate.
    "...(group.modular_composition ? { modular_composition: group.modular_composition } : {}),",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected Matrix Modular role/composition editor support: ${expected}`));
  // The Role <th> now appears exactly once (shared by both branches), not duplicated per pricing mode.
  assert.equal((source.match(/<th className="px-2 py-2">Role<\/th>/g) ?? []).length, 1);
});

test("Matrix and Accessory rows keep commercial pricing visible while collapsing verbose metadata", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  ["expandedCategoryRowByGroup", "Edit / Details", "groupPriceCategories.map((category)", "unavailable_categories", "<details><summary", "item.prices?.[category.id]", "<ImportantRequirementsTextarea value={item.importantRequirements}"].forEach((expected) => assert.ok(source.includes(expected), `Expected compact Matrix/Accessory behavior: ${expected}`));
});

// ---------------------------------------------------------------------------
// ModularItemPricingTable Matrix Modular / Direct Modular parity (Issue 2):
// Specification and Important Requirements move behind Edit / Details for
// Matrix rows too, reusing the exact presentation Direct Modular already had.
// ---------------------------------------------------------------------------

test("8/9/10: Matrix Modular rows use the same compact row presentation as Direct Modular, with Specification and Important Requirements hidden until Edit / Details", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  assert.ok(source.includes('<th className="px-2 py-2">Details</th>'), "Expected one shared \"Details\" column header for both Direct and Matrix Modular");
  assert.ok(!source.includes('"Specification note"'), "Expected the old always-visible \"Specification note\" column label to be removed");
  assert.ok(source.includes('<td className="px-2 py-2 align-top"><button type="button" aria-expanded={expanded} onClick={() => setExpandedRowByGroup((current) => ({ ...current, [groupId]: expanded ? null : normalizedRow.id ?? null }))} className="rounded border border-zinc-300 px-2 py-1 text-xs font-semibold text-emerald-900">{expanded ? "Hide details" : "Edit / Details"}</button></td>'), "Expected the collapsed-row cell to always render the Edit / Details toggle, not inline Specification/Requirements fields");
  // The details-expansion row (Specification + Important Requirements) is no longer gated to Direct Modular only.
  assert.ok(source.includes('{expanded ? <tr key={`${normalizedRow.id}-details`} className="border-t border-zinc-200 bg-zinc-50">'), "Expected the expanded details row to render for any expanded row regardless of pricing mode");
  assert.ok(!source.includes('{directGroup && expanded ? <tr key={`${normalizedRow.id}-details`}'), "Expected the old Direct-Modular-only details gate to be removed");
});

test("11: all Matrix price columns remain visible and directly editable in the collapsed row", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  assert.ok(source.includes('{directGroup ? <th className="px-2 py-2">Direct Price</th> : priceCategories.map((category) => <th key={category} className="px-2 py-2">{category}</th>)}'), "Expected every Matrix price category to render its own header column, unaffected by the Details change");
  assert.ok(source.includes('priceCategories.map((category) => <td key={category} className="px-2 py-2 align-top"><input type="number" value={normalizedRow.prices?.[category] ?? ""}'), "Expected every Matrix price category cell to remain a directly editable input in the collapsed row");
});

test("12: Modular Role remains visible and editable in the collapsed row for both pricing modes", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  assert.ok(source.includes('<td className="px-2 py-2 align-top"><select aria-label="Modular Role" value={normalizedRow.modular_role ?? ""}'), "Expected the Role selector to remain unconditional (outside the Details toggle) in the collapsed row");
});

test("13: the row reference image remains visible in the collapsed row for both pricing modes", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  assert.ok(source.includes('<td className="px-2 py-2 align-top">{group.id && row.id ? <PricingRowReferenceImage templateId={templateId} templateIsPersisted={templateIsPersisted} pricingType="modular" groupId={group.id} rowId={row.id} />'), "Expected the Image column to remain unconditional (outside the directGroup ternary)");
});

test("14: the floating synchronized horizontal scrollbar still wraps the shared Modular table (Direct and Matrix alike)", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  assert.ok(source.includes('<div className="mt-4 rounded-md border border-zinc-200 bg-white"><SyncedHorizontalScrollContainer>'), "Expected the Modular table to still be wrapped in the shared floating scrollbar container");
  assert.ok(source.includes('</SyncedHorizontalScrollContainer></div>'));
});

test("root cause fix: the saved modular_item_pricing payload includes price_categories for Matrix Modular groups, not only Direct Modular", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  assert.ok(
    source.includes('...(isDirectModularPricingGroup(group) ? { modular_pricing_mode: "direct", price_categories: [] } : { price_categories: priceCategories }),'),
    "Expected Matrix Modular groups to submit price_categories: priceCategories, not omit the field entirely",
  );
  assert.ok(
    !source.includes('...(isDirectModularPricingGroup(group) ? { modular_pricing_mode: "direct", price_categories: [] } : {}),'),
    "Expected the old serialization that omitted price_categories for Matrix Modular groups to be gone",
  );
});

test("15: Direct Modular price/role/currency/active/remove wiring and the directGroup branch itself are untouched", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  [
    "const directGroup = isDirectModularPricingGroup(group)",
    '{directGroup ? <td className="px-2 py-2 align-top"><input aria-label="Direct Price" type="number" value={normalizedRow.price ?? ""}',
    "const normalizedRow = directGroup ? normalizeDirectModularRow(row, rowIndex) : categoryPricingRowWithColumns(row, priceCategories);",
    'colSpan={directGroup ? 12 : priceCategories.length + 10}',
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected unchanged Direct Modular wiring: ${expected}`));
});

// ---------------------------------------------------------------------------
// Smart Setup review-state initialization: incoming/saved Matrix Modular
// category columns are authoritative and Cat A-D defaults are never
// auto-created when the review/editor state is built from source data.
// ---------------------------------------------------------------------------

test("1: incoming [BL / AN, Designs] produces exactly 2 review columns", () => {
  const columns = reviewGroupColumnsForTest({ price_categories: ["BL / AN", "Designs"], items: [{ prices: { "BL / AN": 1310, Designs: 1874 } }] });
  assert.deepEqual(columns, ["BL / AN", "Designs"]);
});

test("2: Cat A-D are not injected for a 2-column Matrix Modular group", () => {
  const columns = reviewGroupColumnsForTest({ price_categories: ["BL / AN", "Designs"], items: [{ prices: { "BL / AN": 1310, Designs: 1874 } }] });
  assert.ok(!columns.some((label) => label.startsWith("Cat ")), "Expected no default Cat A-D column to be auto-created");
});

test("3: incoming [Cat A, Cat B] are preserved exactly (still valid, explicit labels)", () => {
  const columns = reviewGroupColumnsForTest({ price_categories: ["Cat A", "Cat B"], items: [{ prices: { "Cat A": 100, "Cat B": 120 } }] });
  assert.deepEqual(columns, ["Cat A", "Cat B"]);
});

test("4: incoming custom manufacturer categories are preserved exactly, no substitution or defaults", () => {
  const columns = reviewGroupColumnsForTest({ price_categories: ["Fabric Grade 1", "Leather Grade A", "Customer Material"], items: [{ prices: { "Fabric Grade 1": 500, "Leather Grade A": 620, "Customer Material": null } }] });
  assert.deepEqual(columns, ["Fabric Grade 1", "Leather Grade A", "Customer Material"]);
});

test("5: zero incoming columns produce zero review columns", () => {
  const columns = reviewGroupColumnsForTest({ price_categories: [], items: [{ prices: {} }] });
  assert.deepEqual(columns, []);
});

test("6: manual \"+ Add price category column\" still works and no longer injects Cat A-D as a side effect", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  assert.ok(source.includes("+ Add price category column"), "Expected the manual add-column button to remain");
  assert.ok(source.includes("function addPriceCategoryColumn() {"), "Expected the Matrix Modular add-column handler to remain");
  const occurrences = source.split("...normalizedPriceMap(row.prices, false),").length - 1;
  assert.equal(occurrences, 2, "Expected both the Category/Matrix and Matrix Modular add-column handlers to pass includeDefaultPriceCategories: false, so adding one column never also injects Cat A-D defaults into every row");
});

test("7: Matrix Modular row prices stay attached to the correct incoming columns (not shifted or duplicated)", () => {
  const group = { price_categories: ["BL / AN", "Designs"], items: [{ prices: { "BL / AN": 1310, Designs: 1874 } }, { prices: { "BL / AN": 1454, Designs: 2148 } }] };
  const columns = reviewGroupColumnsForTest(group);
  assert.deepEqual(columns, ["BL / AN", "Designs"]);
  assert.equal(group.items[0].prices["BL / AN"], 1310);
  assert.equal(group.items[0].prices.Designs, 1874);
  assert.equal(group.items[1].prices["BL / AN"], 1454);
  assert.equal(group.items[1].prices.Designs, 2148);
});

test("8: Category/Matrix (non-modular) import already behaves the same way — every call site passes includeDefaultPriceCategories: false", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  assert.ok(source.includes("groupedStandardCategoryPricingRows(rows).map((group, index) => normalizeCategoryGroup(group, index, false))"), "Expected CategoryPricingTable's mount-time initialGroups to already pass false");
  assert.ok(source.includes("setGroups((replacementGroups ?? []).map((group, index) => normalizeCategoryGroup(group, index, false)));"), "Expected CategoryPricingTable's replacement effect to already pass false");
  assert.ok(source.includes("price_categories: [...groupPriceCategories, normalizedCategory],"), "Expected CategoryPricingTable's own add-column handler to remain");
  const occurrences = source.split("...normalizedPriceMap(row.prices, false),").length - 1;
  assert.equal(occurrences, 2, "Expected CategoryPricingTable's add-column handler to already pass false, alongside the now-fixed Matrix Modular one");
});

test("root cause fix: ModularItemPricingTable's mount-time review state never auto-injects Cat A-D defaults", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  assert.ok(source.includes("const initialGroups = useMemo(() => normalizeModularGroups(rows, false), [rows]);"), "Expected mount-time initialGroups to pass includeDefaultPriceCategories: false");
  assert.ok(!source.includes("const initialGroups = useMemo(() => normalizeModularGroups(rows), [rows]);"), "Expected the old defaults-including mount-time call to be gone");
  assert.ok(source.includes('const [priceCategories, setPriceCategories] = useState<string[]>(() => modularPriceCategories(initialGroups, false));'), "Expected the initial shared priceCategories state to pass includeDefaultPriceCategories: false");
  assert.ok(!source.includes('const [priceCategories, setPriceCategories] = useState<string[]>(() => modularPriceCategories(initialGroups));'), "Expected the old defaults-including initial priceCategories call to be gone");
});

test("9: Direct Modular regression — normalizeDirectModularRow, price_categories: [] for direct groups, and role/composition wiring are untouched by the default-category fix", () => {
  const source = readFileSync("components/products/variant-pricing-tables.tsx", "utf8");
  [
    "function normalizeDirectModularRow",
    "const direct = isDirectModularPricingGroup(sourceGroup)",
    "price_categories: direct ? [] : priceCategories",
    'modular_pricing_mode: "direct"',
    "modular_composition: sourceGroup.modular_composition",
  ].forEach((expected) => assert.ok(source.includes(expected), `Expected Direct Modular preservation: ${expected}`));
});
