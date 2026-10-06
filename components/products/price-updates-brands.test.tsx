import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PriceUpdatesBrandCard, type PriceUpdatesHrefs } from "./price-updates-brands";
import { buildSupplierPriceUpdatesView, summarizePriceUpdates } from "@/lib/products/supplier-price-updates-view";
import type { SupplierFamilyReviewFact } from "@/lib/products/supplier-price-repository";

// Rendering regression for the Brand → Source → Family Price Updates card. Static markup only; no browser tooling.
const BRAND = "6f1c2a40-1b7e-4c59-9d2a-0a1b2c3d4e51";
const FURNITURE = "7a2d3b51-2c8f-4d6a-8e3b-1b2c3d4e5f62";
const CHAIRS = "8b3e4c62-3d9a-4e7b-9f4c-2c3d4e5f6a73";
const V_FURNITURE = "9c4f5d73-4eab-4f8c-8a5d-3d4e5f6a7b84";
const V_CHAIRS = "ad5a6e84-5fbc-4a9d-9b6e-4e5f6a7b8c95";
const ids = { monolith: "b16b7f95-6acd-4b0e-8c7f-5f6a7b8c9da6", oxi: "c27c8a06-7bde-4c1f-9d8a-6a7b8c9dab07", sigma: "d38d9b17-8cef-4d20-8e9b-7b8c9dab0c18", uc: "e49eac28-9dfa-4e31-9fab-8c9dab0c1d29", us: "f5afbd39-0eab-4f42-8abc-9dab0c1d2e3a", lead: "06b0ce4a-1fbc-4053-9bcd-0ab1d2e3f4b1" };
const names: Record<string, string> = { monolith: "MONOLITH", oxi: "OXI_P", sigma: "Sigma", uc: "Universal Cabinet", us: "Universal Screen", lead: "LEAD" };

const version = (id: string, title: string) => ({ id, title, status: "imported", effective_from: "2026-10-01", created_at: "2026-10-02T00:00:00Z" });
const fact = (templateId: string, sourceId: string, over: Partial<SupplierFamilyReviewFact> = {}): SupplierFamilyReviewFact => ({ brandId: BRAND, templateId, sourceId, batchId: "batch", batchStatus: "completed", completedAt: "2026-10-10T00:00:00Z", scope: "complete",
  inCoverage: true, hasReviewEvidence: true, totalTargets: 1, excludedTargets: 0, resolvedTargets: 1, unresolvedTargets: 0, fullyChecked: true, partiallyChecked: false, ...over });

const [las] = buildSupplierPriceUpdatesView({
  businessDate: "2026-10-20",
  brands: [{ id: BRAND, name: "LAS MOBILI" }],
  families: Object.entries(ids).map(([key, id]) => ({ id, brandId: BRAND, name: names[key] })),
  definitions: [
    { id: FURNITURE, brandId: BRAND, name: "LAS Furniture", isActive: true, familyIds: [ids.monolith, ids.oxi, ids.sigma, ids.uc, ids.us], versions: [version(V_FURNITURE, "LAS MOBILI — October 2026")] },
    { id: CHAIRS, brandId: BRAND, name: "LAS Chairs", isActive: true, familyIds: [ids.lead], versions: [version(V_CHAIRS, "LAS Chairs — October 2026")] },
  ],
  facts: [
    fact(ids.monolith, V_FURNITURE), fact(ids.oxi, V_FURNITURE), fact(ids.uc, V_FURNITURE), fact(ids.us, V_FURNITURE),
    fact(ids.lead, V_CHAIRS, { batchStatus: "review", completedAt: null, fullyChecked: false, totalTargets: 4, resolvedTargets: 2, unresolvedTargets: 2 }),
  ],
  legacyDetail: () => "Manual price check",
});

const hrefs: PriceUpdatesHrefs = { familyAction: () => ({ label: "Open review", href: "/products/supplier-sources" }), sourceHref: () => "/products/supplier-sources" };
const html = renderToStaticMarkup(<PriceUpdatesBrandCard view={las} hrefs={hrefs} />);
// Each Family row is one <li>; pull out the row for a given family name so its badge is checked in context.
const rowFor = (family: string) => html.split("<li").find((row) => row.includes(`>${family}<`)) ?? "";

test("LAS MOBILI is rendered once, with both Source groups", () => {
  assert.equal(html.split(">LAS MOBILI<").length - 1, 1, "the Brand heading element appears exactly once");
  assert.match(html, />LAS Furniture</);
  assert.match(html, />LAS Chairs</);
});

test("Family rows show the shared resolver statuses", () => {
  assert.match(rowFor("MONOLITH"), />Price checked</);
  assert.match(rowFor("OXI_P"), />Price checked</);
  assert.match(rowFor("Universal Cabinet"), />Price checked</);
  assert.match(rowFor("Universal Screen"), />Price checked</);
  assert.match(rowFor("Sigma"), />Price update available</);
  assert.match(rowFor("LEAD"), />Needs attention</);
});

test("Brand progress shows 4 / 6 Families checked and the Brand primary state", () => {
  assert.equal(las.progress.checkedFamilies, 4);
  assert.equal(las.progress.applicableFamilies, 6);
  assert.match(html, /4 \/ 6 Families checked/);
  assert.match(html, />Needs attention</);
});

test("no raw UUID is visible", () => {
  assert.doesNotMatch(html, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});

test("no legacy manual status appears for these Supplier-managed Families", () => {
  assert.doesNotMatch(html, /Manual price check/);
  for (const family of ["MONOLITH", "OXI_P", "Sigma", "Universal Cabinet", "Universal Screen", "LEAD"]) assert.doesNotMatch(rowFor(family), /Manual price check/);
  assert.equal(summarizePriceUpdates([las]).needsAttention, 1);
});
