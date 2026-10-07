import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PriceUpdatesBrandSummaryCard, type PriceUpdatesBrandSummary } from "./price-updates-brands";
import { buildSupplierPriceUpdatesView } from "@/lib/products/supplier-price-updates-view";
import type { SupplierFamilyReviewFact } from "@/lib/products/supplier-price-repository";

const page = readFileSync("app/products/price-updates/page.tsx", "utf8");
const BRAND = "6f1c2a40-1b7e-4c59-9d2a-0a1b2c3d4e51", DEF = "7a2d3b51-2c8f-4d6a-8e3b-1b2c3d4e5f62", V = "9c4f5d73-4eab-4f8c-8a5d-3d4e5f6a7b84";
const names = ["Every", "Goal", "AirPad"], ids = ["f1", "f2", "f3"];
const fact = (templateId: string, over: Partial<SupplierFamilyReviewFact> = {}): SupplierFamilyReviewFact => ({ brandId: BRAND, templateId, sourceId: V, batchId: "b", batchStatus: "completed", completedAt: "2026-10-10T00:00:00Z", scope: "complete",
  inCoverage: true, hasReviewEvidence: true, totalTargets: 1, excludedTargets: 0, resolvedTargets: 1, unresolvedTargets: 0, fullyChecked: true, partiallyChecked: false, ...over });
const [view] = buildSupplierPriceUpdatesView({
  businessDate: "2026-10-20", brands: [{ id: BRAND, name: "LAS MOBILI" }], families: ids.map((id, index) => ({ id, brandId: BRAND, name: names[index] })),
  definitions: [{ id: DEF, brandId: BRAND, name: "Furniture", isActive: true, familyIds: ids, versions: [{ id: V, title: "LAS — October 2026", status: "imported", effective_from: "2026-10-01", created_at: "2026-10-02T00:00:00Z" }] }],
  facts: [fact("f1"), fact("f2", { batchStatus: "review", completedAt: null, fullyChecked: false, totalTargets: 4, resolvedTargets: 2, unresolvedTargets: 2 })], legacyDetail: () => "Manual",
});
const summary: PriceUpdatesBrandSummary = { view, priceLists: 1, reviewsInProgress: 2, href: `/products/price-updates/supplier-sources?brand=${BRAND}` };
const html = renderToStaticMarkup(<ul><PriceUpdatesBrandSummaryCard summary={summary} /></ul>);

test("landing renders Brand cards only: no Family rows, source groups or review buttons", () => {
  for (const family of names) assert.doesNotMatch(html, new RegExp(`>${family}<`));
  assert.doesNotMatch(html, /Continue review|Complete review|Open source|Furniture/);
  assert.match(html, />LAS MOBILI</);
});

test("Brand card shows review count, price lists, checked and attention summary from the shared resolvers", () => {
  const metric = (label: string, value: string) => assert.match(html, new RegExp(`>${label}</dt><dd[^>]*>${value}<`));
  metric("Current price lists", "1"); metric("Updates in progress", "2"); metric("Upcoming lists", "0"); metric("Families checked", "1 / 3"); metric("Need review", "2");
  assert.match(html, />3 Supplier-managed Families</); assert.match(html, /2 Families still need review\./);
  assert.equal(view.progress.checkedFamilies, 1); assert.equal(view.state, "needs_attention"); assert.match(html, />Needs attention</);
});

test("a Manual Brand stays neutral, shows no price lists and a calm note", () => {
  const [manual] = buildSupplierPriceUpdatesView({ businessDate: "2026-10-20", brands: [{ id: "m", name: "INTERSTUHL" }], families: [{ id: "x", brandId: "m", name: "Chair" }], definitions: [], facts: [], legacyDetail: () => "Manual" });
  const out = renderToStaticMarkup(<ul><PriceUpdatesBrandSummaryCard summary={{ view: manual, priceLists: 0, reviewsInProgress: 0, href: "/w" }} /></ul>);
  assert.match(out, /border-zinc-200 bg-zinc-50 text-zinc-700[^>]*>Manual</); assert.doesNotMatch(out, /red|amber/);
  assert.match(out, />No Supplier-managed Families</); assert.match(out, /No current Supplier price list./); assert.doesNotMatch(out, />Chair</);
});

test("Open Brand routes to the existing Brand workspace", () => {
  assert.match(html, new RegExp(`href="/products/price-updates/supplier-sources\\?brand=${BRAND}"[^>]*>Open Brand `));
});

test("page reuses the shared resolver builders and reads Brand-level data only, one batched read per dataset", () => {
  assert.match(page, /buildSupplierPriceUpdatesView/); assert.match(page, /loadSupplierPriceUpdatesInputs/); assert.match(page, /PriceUpdatesBrandSummaryCard/);
  assert.doesNotMatch(page, /PriceUpdatesBrandCard\b|PriceUpdatesReview|familyActionFor|product_categories|brand_price_list_updates|supplier_price_matches/);
  assert.match(page, /\.select\("id,brand_id,template_name"\)/);
  assert.doesNotMatch(page, /for \(const brand of brandList\)/);
});
