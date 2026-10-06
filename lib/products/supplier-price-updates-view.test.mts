import assert from "node:assert/strict";
import test from "node:test";
import { buildSupplierPriceUpdatesView, filterPriceUpdatesView, summarizePriceUpdates, type PriceUpdatesDefinitionInput } from "./supplier-price-updates-view.js";
import type { SupplierFamilyReviewFact } from "./supplier-price-repository.js";

const TODAY = "2026-10-20";
const BRAND = "brand-las";
const fam = (id: string, name: string, brandId = BRAND) => ({ id, brandId, name });
const families = [fam("monolith", "MONOLITH"), fam("oxi", "OXI_P"), fam("sigma", "Sigma"), fam("uc", "Universal Cabinet"), fam("us", "Universal Screen"), fam("lead", "LEAD")];
const furniture: PriceUpdatesDefinitionInput = { id: "def-furniture", brandId: BRAND, name: "LAS Furniture", isActive: true, familyIds: ["monolith", "oxi", "sigma", "uc", "us"],
  versions: [{ id: "v-oct", title: "LAS MOBILI — October 2026", status: "imported", effective_from: "2026-10-01", created_at: "2026-10-02T00:00:00Z" }] };
const chairs: PriceUpdatesDefinitionInput = { id: "def-chairs", brandId: BRAND, name: "LAS Chairs", isActive: true, familyIds: ["lead"],
  versions: [{ id: "v-chairs", title: "LAS Chairs — October 2026", status: "imported", effective_from: "2026-10-01", created_at: "2026-10-02T00:00:00Z" }] };
const fact = (over: Partial<SupplierFamilyReviewFact>): SupplierFamilyReviewFact => ({ brandId: BRAND, templateId: "x", sourceId: "v-oct", batchId: "b", batchStatus: "completed", completedAt: "2026-10-10T00:00:00Z", scope: "complete",
  inCoverage: true, hasReviewEvidence: true, totalTargets: 1, excludedTargets: 0, resolvedTargets: 1, unresolvedTargets: 0, fullyChecked: true, partiallyChecked: false, ...over });
const facts: SupplierFamilyReviewFact[] = [
  fact({ templateId: "monolith" }), fact({ templateId: "oxi" }), fact({ templateId: "uc" }), fact({ templateId: "us" }),
  fact({ templateId: "lead", sourceId: "v-chairs", batchStatus: "review", completedAt: null, fullyChecked: false, totalTargets: 4, resolvedTargets: 2, unresolvedTargets: 2 }),
];
const build = (over: Partial<Parameters<typeof buildSupplierPriceUpdatesView>[0]> = {}) => buildSupplierPriceUpdatesView({
  businessDate: TODAY, brands: [{ id: BRAND, name: "LAS MOBILI" }], families, definitions: [furniture, chairs], facts, legacyDetail: (id) => `legacy detail ${id}`, ...over,
});
const [las] = build();

test("LAS MOBILI is one Brand with two source groups, and each Family sits under its own source", () => {
  assert.equal(las.brandName, "LAS MOBILI");
  assert.deepEqual(las.sources.map((group) => group.definitionName), ["LAS Furniture", "LAS Chairs"]);
  assert.deepEqual(las.sources[0].families.map((status) => status.familyName), ["MONOLITH", "OXI_P", "Sigma", "Universal Cabinet", "Universal Screen"]);
  assert.deepEqual(las.sources[1].families.map((status) => status.familyName), ["LEAD"]);
  assert.equal(las.sources[0].current?.title, "LAS MOBILI — October 2026");
});

test("Family statuses come from the shared resolver: checked, update available and needs attention are distinct", () => {
  const by = Object.fromEntries(las.families.map((status) => [status.familyId, status.status]));
  assert.equal(by.monolith, "price_checked"); assert.equal(by.oxi, "price_checked"); assert.equal(by.uc, "price_checked"); assert.equal(by.us, "price_checked");
  assert.equal(by.sigma, "update_available"); assert.equal(by.lead, "needs_attention");
});

test("the Brand state and progress come from the Brand resolver: 4 of 6 checked, not current", () => {
  assert.equal(las.state, "needs_attention"); assert.equal(las.stateLabel, "Needs attention");
  assert.equal(las.progress.applicableFamilies, 6); assert.equal(las.progress.checkedFamilies, 4);
  assert.equal(las.progress.updateAvailableFamilies, 1); assert.equal(las.progress.needsAttentionFamilies, 1);
});

test("partial progress carries its progress and exclusion detail through", () => {
  const partial = build({ facts: [...facts, fact({ templateId: "sigma", totalTargets: 20, resolvedTargets: 17, excludedTargets: 3, fullyChecked: false, partiallyChecked: true })] })[0];
  const sigma = partial.families.find((status) => status.familyId === "sigma")!;
  assert.equal(sigma.status, "partially_checked"); assert.deepEqual(sigma.progress, { checked: 17, total: 20, excluded: 3, unresolved: 0 });
  assert.equal(partial.state, "needs_attention"); // LEAD still needs attention, so the Brand is not partial
});

test("a Family with no Supplier coverage is legacy manual, with the caller's legacy detail, and is not counted as Supplier applicable", () => {
  const withLegacy = build({ families: [...families, fam("bag", "Bag")] })[0];
  const bag = withLegacy.families.find((status) => status.familyId === "bag")!;
  assert.equal(bag.status, "legacy_manual"); assert.equal(bag.detail, "legacy detail bag");
  assert.deepEqual(withLegacy.legacyFamilyIds, ["bag"]);
  assert.equal(withLegacy.progress.applicableFamilies, 6);
});

test("an upcoming-only source is shown as no current price list with the upcoming list as metadata, never as current", () => {
  const future: PriceUpdatesDefinitionInput = { ...chairs, versions: [{ id: "v-nov", title: "LAS Chairs — November 2026", status: "imported", effective_from: "2026-11-01", created_at: "2026-10-15T00:00:00Z" }] };
  const view = build({ definitions: [furniture, future] })[0];
  const lead = view.families.find((status) => status.familyId === "lead")!;
  assert.equal(lead.status, "no_price_list"); assert.equal(lead.upcoming?.effectiveFrom, "2026-11-01");
  assert.equal(view.sources[1].current, null); assert.equal(view.sources[1].upcoming?.title, "LAS Chairs — November 2026");
  assert.equal(view.progress.applicableFamilies, 5); // the upcoming-only Family is outside the denominator
});

test("a checked Family with an upcoming list stays price checked; the list is metadata only", () => {
  const future: PriceUpdatesDefinitionInput = { ...furniture, versions: [...furniture.versions, { id: "v-nov", title: "LAS MOBILI — November 2026", status: "imported", effective_from: "2026-11-01", created_at: "2026-10-15T00:00:00Z" }] };
  const monolith = build({ definitions: [future, chairs] })[0].families.find((status) => status.familyId === "monolith")!;
  assert.equal(monolith.status, "price_checked"); assert.equal(monolith.upcoming?.sourceId, "v-nov");
});

test("Brand summary counts Brand states only, never Product rows", () => {
  const brands = [{ id: "a", name: "A" }, { id: BRAND, name: "LAS MOBILI" }];
  const views = buildSupplierPriceUpdatesView({ businessDate: TODAY, brands, families: [...families, fam("a1", "A1", "a")], definitions: [furniture, chairs], facts, legacyDetail: () => "" });
  const summary = summarizePriceUpdates(views);
  assert.equal(summary.needsAttention, 1); assert.equal(summary.brandsCurrent, 0);
  assert.equal(views.find((view) => view.brandId === "a")!.state, "legacy_manual"); // no Supplier coverage: neutral fallback
});

test("all Supplier-managed Families checked → the Brand is current and counted as such", () => {
  const allChecked = [...facts.map((item) => item.templateId === "lead" ? fact({ templateId: "lead", sourceId: "v-chairs" }) : item), fact({ templateId: "sigma" })];
  const view = build({ facts: allChecked })[0];
  assert.equal(view.state, "current"); assert.equal(summarizePriceUpdates([view]).brandsCurrent, 1);
});

test("filters: status, Brand and search keep the Brand only when a visible Family matches", () => {
  const brands = [{ id: "a", name: "Atelier" }, { id: BRAND, name: "LAS MOBILI" }];
  const views = buildSupplierPriceUpdatesView({ businessDate: TODAY, brands, families: [...families, fam("a1", "Chair One", "a")], definitions: [furniture, chairs], facts, legacyDetail: () => "" });
  assert.deepEqual(filterPriceUpdatesView(views, { status: "needs_attention" }).map((view) => view.brandId), [BRAND]);
  assert.deepEqual(filterPriceUpdatesView(views, { brandId: "a" }).map((view) => view.brandId), ["a"]);
  const sigma = filterPriceUpdatesView(views, { q: "sigma" });
  assert.deepEqual(sigma.map((view) => view.brandId), [BRAND]);
  assert.deepEqual(sigma[0].sources.flatMap((group) => group.families.map((status) => status.familyName)), ["Sigma"]);
  assert.equal(filterPriceUpdatesView(views, { q: "nothing-matches-this" }).length, 0);
});

test("no raw identifiers are presented as names: every label comes from the Family or source name", () => {
  const text = JSON.stringify(las.sources.map((group) => [group.definitionName, group.current?.title, group.families.map((status) => status.familyName)]));
  assert.doesNotMatch(text, /def-furniture|v-oct|monolith/);
});
