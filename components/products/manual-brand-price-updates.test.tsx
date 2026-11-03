import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ManualBrandPriceUpdates } from "./manual-brand-price-updates";
import type { ManualProductRow } from "@/lib/products/manual-brand-products";

const row = (id: string, name: string, status: ManualProductRow["status"], label: string, tone: ManualProductRow["tone"], detail = ""): ManualProductRow => ({ id, name, category: "Chairs / Swivel", mainCategory: "Chairs", status, label, tone, detail });
const rows = [
  row("a", "Rose Chair", "price_checked", "Price checked", "success", "Checked on 3 Feb 2026 by Sara Khan"),
  row("b", "Lotus Chair", "price_update_due", "Price update due", "warning"),
];
const render = (extra: Partial<Parameters<typeof ManualBrandPriceUpdates>[0]> = {}) => renderToStaticMarkup(<ManualBrandPriceUpdates brandId="colan" brandName="Colan" initialRows={rows} releases={[]} latest={{ effectiveFrom: "2026-01-15", note: "List" }} canManage today="2026-02-10" truncated={false} limit={1000} {...extra} />);

test("the manual screen shows the release line, the progress line and one row per product", () => {
  const html = render();
  assert.match(html, /Manual price check/); assert.match(html, /Latest: price list released 15 Jan 2026 - List/);
  assert.match(html, /1 due · 1 checked/);
  assert.match(html, /Rose Chair/); assert.match(html, /Lotus Chair/);
  assert.match(html, /Checked on 3 Feb 2026 by Sara Khan/);
  assert.match(html, /Chairs \/ Swivel/);
  assert.match(html, /Due/); assert.match(html, /Edited since check/); assert.match(html, /Search/);
});

test("rows are sorted with due first", () => {
  const html = render();
  assert.ok(html.indexOf("Lotus Chair") < html.indexOf("Rose Chair"));
});

test("with no release the message is clear and the products are still listed", () => {
  const neutral = rows.map((item) => ({ ...item, status: "legacy_manual" as const, label: "Manual price check", tone: "neutral" as const, detail: "" }));
  const html = render({ latest: null, initialRows: neutral });
  assert.match(html, /No price list released yet\. Click New price list released\./);
  assert.match(html, /Rose Chair/); assert.match(html, /Lotus Chair/);
});

test("none of the supplier import screen is shown for a manual Brand", () => {
  const html = render();
  for (const text of ["Import price list", "Family coverage", "Available price lists", "Advanced import settings", "No Supplier price lists yet"]) assert.doesNotMatch(html, new RegExp(text));
});

test("the page switches on the Brand's manual state before any supplier read, so Brands with codes keep the supplier screen", () => {
  const source = readFileSync(new URL("../../app/products/price-updates/supplier-sources/page.tsx", import.meta.url), "utf8");
  const manualAt = source.indexOf("loadManualPriceState(client, [brand.id])");
  assert.ok(manualAt > 0);
  assert.ok(manualAt < source.indexOf('"supplier_price_profiles"'), "the manual check comes before the supplier reads");
  assert.match(source, /if \(brand && manualBrandState\) \{[\s\S]*?<ManualBrandPriceUpdates[\s\S]*?\n  \}\n  const base = /); // the early return ends before the supplier page starts
  assert.ok(source.includes("<SupplierAdvancedImportSettings"), "the supplier screen code is still there");
});
