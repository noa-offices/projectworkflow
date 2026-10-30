import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { PriceMatch, PriceTarget } from "./supplier-price-contracts";
import { buildPriceLines, priceLineLimit } from "./supplier-price-lines";

const target = (key: string, template_id: string, price: number | null, extra: Partial<PriceTarget> = {}) => ({ key, template_id, template_name: "T", brand_id: "b", architecture: "a", group_id: "g", row_id: "r", column_id: "c", dimension: "", price_field: "unit_price", physical_field: "unit_price", code: key, raw_code: key.toUpperCase(), price, currency: "AED", pricing_version: "1", label: "Base", ...extra }) as PriceTarget;
const source = (price: number | null, currency = "AED") => ({ key: "s", code: "x", price_field: "unit_price", dimension: "", finishes: [], price, currency, row_keys: [], issues: [] }) as PriceMatch["source"];
const match = (key: string, classification: PriceMatch["classification"], targets: PriceTarget[], src: PriceMatch["source"] = source(10)): PriceMatch => ({ key, source: src, targets, classification, candidate_shared: false });

test("only this template's targets become lines, with the right states and differences", () => {
  const { lines } = buildPriceLines([
    match("1", "increased", [target("a1", "T1", 8)]),
    match("2", "unchanged", [target("a2", "T1", 10)]),
    match("3", "unchanged", [target("other", "T2", 10)]),
    match("4", "unmatched", [], source(5)),
    match("5", "target_not_represented", [target("a5", "T1", 3)], null),
    match("6", "needs_dimension_mapping", [target("a6", "T1", 1)]),
    match("7", "increased", [target("a7", "T1", 8)], source(10, "EUR")),
  ], "T1");
  assert.deepEqual(lines.map((line) => [line.code, line.state, line.difference]), [["A1", "changed", 2], ["A2", "same", 0], ["A5", "not_in_supplier_list", null], ["A6", "needs_mapping", 10 - 1], ["A7", "changed", null]]);
  assert.equal(lines.find((line) => line.code === "A5")?.supplierPrice, null);
});

test("an empty or unrelated match set gives no lines and long sets are capped", () => {
  assert.deepEqual(buildPriceLines([], "T1"), { lines: [], truncated: false });
  const many = Array.from({ length: priceLineLimit + 3 }, (_, index) => match(`m${index}`, "unchanged", [target(`k${index}`, "T1", 1)]));
  const capped = buildPriceLines(many, "T1");
  assert.equal(capped.lines.length, priceLineLimit);
  assert.equal(capped.truncated, true);
});

test("the action is role-checked, read-only and the button is for allowed roles on covered supplier products", () => {
  const action = readFileSync("components/quotations/supplier-price-lines-actions.ts", "utf8");
  assert.match(action, /canApproveBrandPrices\(profile\?\.role, profile\?\.account_status\)/);
  assert.match(action, /throw Error\("Brand price approver permission required\."\)/);
  assert.doesNotMatch(action, /supplierWrite|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(|revalidatePath/);
  const popup = readFileSync("components/quotations/supplier-price-lines-popup.tsx", "utf8");
  assert.match(popup, /if \(allowed !== true\) return null/);
  assert.match(popup, /Read only\. Nothing is saved here\./);
  assert.doesNotMatch(popup, /router|window\.location|<Link/);
  const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.match(selector, /!compact && supplierPresentation && !supplierPresentation\.actionHref \? <SupplierPriceLinesAction/);
});

test("summary counts and attention-first filtering keep the code order inside each group", async () => {
  const { summarizePriceLines, filterAndOrderPriceLines } = await import("./supplier-price-lines");
  const line = (code: string, state: import("./supplier-price-lines").PriceLineState) => ({ key: code, code, field: "", ourPrice: 1, ourCurrency: "AED", supplierPrice: 1, supplierCurrency: "AED", difference: 0, state });
  const lines = [line("A", "same"), line("B", "changed"), line("C", "same"), line("D", "needs_mapping"), line("E", "shared"), line("F", "not_in_supplier_list")];
  assert.deepEqual(summarizePriceLines(lines), { same: 2, changed: 1, needsMapping: 1, other: 2 });
  assert.deepEqual(filterAndOrderPriceLines(lines, "all").map((item) => item.code), ["D", "B", "F", "E", "A", "C"]);
  assert.deepEqual(filterAndOrderPriceLines(lines, "attention").map((item) => item.code), ["D", "B", "F", "E"]);
  assert.deepEqual(filterAndOrderPriceLines(lines, "same").map((item) => item.code), ["A", "C"]);
});

test("the popup keeps the read-only note, filters, sticky header and plain column names", () => {
  const popup = readFileSync("components/quotations/supplier-price-lines-popup.tsx", "utf8");
  for (const text of ["Read only. Nothing is saved here.", "Needs attention", "sticky top-0", "Your price", "Supplier price", "Difference", "Status", "sm:w-[min(1180px,96vw)]"]) assert.ok(popup.includes(text), text);
  assert.doesNotMatch(popup, /router|window\.location|<Link|supplierWrite/);
});
