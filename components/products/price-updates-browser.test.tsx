import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultPriceUpdatesFilters } from "@/lib/products/price-updates-filter";
import type { PriceUpdatesCardData } from "./price-updates-browser";

mock.module("next/navigation", { namedExports: { useRouter: () => ({ push() {}, replace() {}, refresh() {} }) } });
type Props = Parameters<typeof import("./price-updates-browser").PriceUpdatesBrowser>[0];

const coded: PriceUpdatesCardData = { brandId: "a", name: "Arca", state: "needs_attention", stateLabel: "Needs attention", method: "codes", href: "/products/price-updates/supplier-sources?brand=a", coded: { priceLists: 0, inProgress: 2, upcoming: 0, checked: 0, applicable: 2, needReview: 2 } };
const manual: PriceUpdatesCardData = { brandId: "c", name: "Colan", state: "legacy_manual", stateLabel: "Manual price checks", method: "manual", href: "/products/price-updates/supplier-sources?brand=c", manual: { latestRelease: "2026-11-03", countsText: "12 due · 30 checked", canManage: true, today: "2026-11-05" } };
const options = [{ value: "current", label: "Current" }, { value: "needs_attention", label: "Needs attention" }];
const render = async (extra: Partial<Props> = {}) => { const { PriceUpdatesBrowser } = await import("./price-updates-browser"); return renderToStaticMarkup(<PriceUpdatesBrowser cards={[coded, manual]} initialFilters={defaultPriceUpdatesFilters} statusOptions={options} canEditBrand {...extra} />); };
const supplierNumbers = /Current lists|Upcoming|In progress|Families checked|Need review|Current price lists|Updates in progress|Upcoming lists/;

test("a manual Brand card shows no supplier list numbers; a coded card still does", async () => {
  const html = await render();
  const [codedCard, manualCard] = [html.slice(html.indexOf("Arca"), html.indexOf("Colan")), html.slice(html.indexOf("Colan"))];
  assert.match(codedCard, /Families checked 0 \/ 2 · Need review 2/); assert.match(codedCard, /Current lists 0 · In progress 2/); assert.match(codedCard, /Edit brand/);
  assert.doesNotMatch(manualCard, supplierNumbers);
  assert.match(manualCard, /Price list released 3 Nov 2026/); assert.match(manualCard, /12 due · 30 checked/); assert.match(manualCard, /New price list released/);
  assert.match(manualCard, />Manual</); assert.match(codedCard, />Codes</);
  assert.match(html, /Open Brand/);
});

test("a manual Brand with no release says so and still has the release button", async () => {
  const html = await render({ cards: [{ ...manual, manual: { ...manual.manual!, latestRelease: null } }] });
  assert.match(html, /No price list released yet\./); assert.match(html, /New price list released/); assert.doesNotMatch(html, supplierNumbers);
});

test("the New price list released button follows the same permission as before", async () => {
  const html = await render({ cards: [{ ...manual, manual: { ...manual.manual!, canManage: false } }], canEditBrand: false });
  assert.doesNotMatch(html, /New price list released/); assert.doesNotMatch(html, /Edit brand/);
});

test("four separate status chips with counts, and no Apply button", async () => {
  const html = await render();
  assert.equal((html.match(/aria-pressed=/g) ?? []).length, 4);
  for (const label of ["Current", "Updates available", "Partially checked", "Needs attention"]) assert.match(html, new RegExp(label));
  assert.match(html, /aria-pressed="false"/);
  assert.doesNotMatch(html, />Apply</); assert.match(html, /type="search"/); assert.match(html, /All price check methods/);
  assert.match(html, /2 of 2 brands/);
});

test("the starting filters from the address apply, and an empty result has a message and Clear search", async () => {
  const filtered = await render({ initialFilters: { q: "", status: "needs_attention", method: "all" } });
  assert.match(filtered, /aria-pressed="true"/); assert.match(filtered, /1 of 2 brands/); assert.doesNotMatch(filtered, /Colan/);
  const none = await render({ initialFilters: { q: "zzz", status: "", method: "all" } });
  assert.match(none, /No brands match &quot;zzz&quot;\./); assert.match(none, /Clear search/);
});

test("cards use a responsive grid of 1, 2, 3 and 4 columns", async () => {
  const html = await render();
  assert.match(html, /@min-.576px.:grid-cols-2/); assert.match(html, /@min-.896px.:grid-cols-3/); assert.match(html, /@min-.1040px.:grid-cols-4/); assert.match(html, /@container/);
});

test("the page has padding around the import button and no Apply form or big tiles", () => {
  const source = readFileSync(new URL("../../app/products/price-updates/page.tsx", import.meta.url), "utf8");
  assert.match(source, /px-5 py-5 text-sm sm:px-8/);
  assert.doesNotMatch(source, />Apply</); assert.doesNotMatch(source, /PriceUpdatesSummaryCards/);
  assert.match(source, /<PriceUpdatesBrowser/);
});
