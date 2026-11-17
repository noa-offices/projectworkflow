/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory fake rows and deliberately hostile input */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CUSTOM_BRAND_PAGE_SIZE,
  CUSTOM_BRAND_RECENT_LIMIT,
  cleanBrandName,
  distinctBrands,
  filterByBrand,
  isNewBrandInput,
  normaliseBrandKey,
  resolveBrandInput,
  suggestBrands,
} from "./custom-brands";
import { createCustomItemForUser, renameCustomBrandForUser, updateCustomItemForUser } from "./saved-custom-items-service";
import { filterSetups } from "./collection-view";
import { toCollectionItem, type CustomItemListItem } from "./custom-item";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

// ── Pure helpers ─────────────────────────────────────────────────────────────────────────────────────────────
test("normaliseBrandKey / cleanBrandName: case and extra spaces are ignored", () => {
  assert.equal(normaliseBrandKey("  Acme   Office "), "acme office");
  assert.equal(normaliseBrandKey("ACME OFFICE"), normaliseBrandKey("acme  office"));
  assert.equal(cleanBrandName("  Acme   Office "), "Acme Office");
  assert.equal(normaliseBrandKey(undefined), "");
  assert.equal(normaliseBrandKey(5), "");
});

test("resolveBrandInput: existing spelling reused, new brand flagged, empty and 81 characters rejected", () => {
  const existing = [{ brandName: "Acme Office", count: 3 }, { brandName: "Zeta", count: 1 }];
  assert.deepEqual(resolveBrandInput("acme   office", existing), { ok: true, name: "Acme Office", isNew: false });
  assert.deepEqual(resolveBrandInput("  ZETA ", existing), { ok: true, name: "Zeta", isNew: false });
  assert.deepEqual(resolveBrandInput("  New   Brand ", existing), { ok: true, name: "New Brand", isNew: true });
  assert.deepEqual(resolveBrandInput("x", ["X"]), { ok: true, name: "X", isNew: false }, "plain string list works too");
  for (const bad of ["", "   ", undefined, null]) assert.equal(resolveBrandInput(bad, existing).ok, false);
  assert.equal(resolveBrandInput("x".repeat(81), existing).ok, false);
  assert.equal(resolveBrandInput("x".repeat(80), existing).ok, true);
  assert.equal((resolveBrandInput("", existing) as any).error, "Enter a brand.");
});

test("distinctBrands: counts, A-Z order, case-insensitive merge with one stable spelling", () => {
  const items = ["Zeta", "acme", "Acme", "ACME ", "Beta", "Acme", ""].map((brandName) => ({ brandName }));
  assert.deepEqual(distinctBrands(items), [
    { brandName: "Acme", count: 4 }, // most used spelling wins
    { brandName: "Beta", count: 1 },
    { brandName: "Zeta", count: 1 },
  ]);
  assert.deepEqual(distinctBrands([]), []);
  // tie between spellings: the A-Z first one, so the list does not flip between renders
  assert.equal(distinctBrands([{ brandName: "beta" }, { brandName: "Beta" }])[0].brandName, "Beta");
});

test("filterByBrand / suggestBrands / isNewBrandInput", () => {
  const items = [{ brandName: "Acme", id: 1 }, { brandName: "acme", id: 2 }, { brandName: "Beta", id: 3 }];
  assert.deepEqual(filterByBrand(items, "ACME").map((item) => item.id), [1, 2]);
  assert.deepEqual(filterByBrand(items, null).map((item) => item.id), [1, 2, 3]);
  assert.deepEqual(filterByBrand(items, "  ").map((item) => item.id), [1, 2, 3]);
  assert.deepEqual(filterByBrand(items, "Nope"), []);
  const brands = distinctBrands(items);
  assert.deepEqual(suggestBrands(brands, "ac").map((brand) => brand.brandName), ["Acme"]);
  assert.deepEqual(suggestBrands(brands, "").map((brand) => brand.brandName), ["Acme", "Beta"]);
  assert.equal(isNewBrandInput(brands, "acme"), false);
  assert.equal(isNewBrandInput(brands, "Gamma"), true);
  assert.equal(isNewBrandInput(brands, "  "), false);
  assert.equal(CUSTOM_BRAND_PAGE_SIZE, 12);
  assert.equal(CUSTOM_BRAND_RECENT_LIMIT, 6);
});

test("search matches brand, name and code (collection-view)", () => {
  const entries = [
    toCollectionItem({ id: "1", brandName: "Zeta", itemName: "Lamp", itemCode: "LMP-9" } as CustomItemListItem),
    toCollectionItem({ id: "2", brandName: "Acme", itemName: "Desk", itemCode: "DSK-1" } as CustomItemListItem),
  ];
  assert.deepEqual(filterSetups(entries, "zeta").map((entry) => entry.id), ["1"]);
  assert.deepEqual(filterSetups(entries, "desk").map((entry) => entry.id), ["2"]);
  assert.deepEqual(filterSetups(entries, "lmp-9").map((entry) => entry.id), ["1"]);
});

// ── Fake client ──────────────────────────────────────────────────────────────────────────────────────────────
type Row = Record<string, any>;
function fake(rows: Row[], session: string, log: { updates: Row[] } = { updates: [] }) {
  let counter = 0;
  class Query {
    private op: "select" | "insert" | "update" = "select";
    private payload: Row = {};
    private filters: Array<(row: Row) => boolean> = [];
    select() { return this; }
    insert(payload: Row) { this.op = "insert"; this.payload = payload; return this; }
    update(payload: Row) { this.op = "update"; this.payload = payload; log.updates.push(payload); return this; }
    eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
    in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
    order() { return this; }
    private run(): { data: Row[] | null; error: { message: string } | null } {
      if (this.op === "insert") {
        if (this.payload.owner_id !== session) return { data: null, error: { message: "rls" } };
        const row = { id: `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`, use_count: 0, created_at: "2026-01-01", price_saved_at: "2026-01-01", ...this.payload };
        rows.push(row);
        return { data: [row], error: null };
      }
      const matched = rows.filter((row) => row.owner_id === session && this.filters.every((filter) => filter(row)));
      if (this.op === "update") { matched.forEach((row) => Object.assign(row, this.payload)); return { data: matched, error: null }; }
      return { data: matched.map((row) => ({ ...row })), error: null };
    }
    single() { const r = this.run(); return Promise.resolve(r.data?.[0] ? { data: r.data[0], error: null } : { data: null, error: { message: "none" } }); }
    maybeSingle() { return Promise.resolve({ data: this.run().data?.[0] ?? null, error: null }); }
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve(this.run()).then(resolve, reject); }
  }
  return { from: () => new Query() } as unknown as SupabaseClient;
}
let seq = 0;
const stored = (owner: string, brand: string, patch: Row = {}): Row => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(++seq).padStart(12, "0")}`, owner_id: owner, brand_name: brand, item_name: `Item ${seq}`, item_code: null, specification: null,
  unit_label: "Pc", selling_price: 100, currency: "AED", price_saved_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01", last_used_at: null, use_count: 0, ...patch,
});
const good = { itemName: "Desk", sellingPrice: "100", currency: "AED" };

// ── Rename brand ─────────────────────────────────────────────────────────────────────────────────────────────
test("rename brand: only the caller's rows change, count returned, saved-price date untouched", async () => {
  const rows = [stored(USER_A, "Acme"), stored(USER_A, "acme"), stored(USER_A, "Beta"), stored(USER_B, "Acme")];
  const log = { updates: [] as Row[] };
  const result = await renameCustomBrandForUser(fake(rows, USER_A, log), USER_A, "ACME", "Acme Office");
  assert.deepEqual(result, { ok: true, count: 2, brandName: "Acme Office" });
  assert.deepEqual(rows.map((row) => row.brand_name), ["Acme Office", "Acme Office", "Beta", "Acme"], "another owner's items untouched");
  assert.deepEqual(log.updates, [{ brand_name: "Acme Office" }], "only brand_name is written");
  assert.equal(rows[0].price_saved_at, "2026-01-01T00:00:00Z");
});

test("rename brand: merges into another existing brand's spelling; case-only rename keeps the new spelling", async () => {
  const rows = [stored(USER_A, "Acme"), stored(USER_A, "Beta"), stored(USER_A, "Beta")];
  const merged = await renameCustomBrandForUser(fake(rows, USER_A), USER_A, "Acme", "  BETA ");
  assert.deepEqual(merged, { ok: true, count: 1, brandName: "Beta" });
  assert.deepEqual(rows.map((row) => row.brand_name), ["Beta", "Beta", "Beta"]);
  const rows2 = [stored(USER_A, "acme"), stored(USER_A, "acme")];
  assert.deepEqual(await renameCustomBrandForUser(fake(rows2, USER_A), USER_A, "acme", "ACME"), { ok: true, count: 2, brandName: "ACME" });
});

test("rename brand: validates the new name (1-80), unknown brand fails, another owner's brand is not found", async () => {
  const rows = [stored(USER_A, "Acme"), stored(USER_B, "Gamma")];
  assert.equal((await renameCustomBrandForUser(fake(rows, USER_A), USER_A, "Acme", "")).ok, false);
  assert.equal((await renameCustomBrandForUser(fake(rows, USER_A), USER_A, "Acme", "x".repeat(81))).ok, false);
  assert.equal((await renameCustomBrandForUser(fake(rows, USER_A), USER_A, "Nope", "Z")).ok, false);
  assert.equal((await renameCustomBrandForUser(fake(rows, USER_A), USER_A, "Gamma", "Z")).ok, false, "B's brand is invisible to A");
  assert.equal(rows[1].brand_name, "Gamma");
  assert.equal(rows[0].brand_name, "Acme");
});

test("rename brand action: authenticates first, caller's client, owner never read from input", () => {
  const actions = read("./saved-custom-brands-actions.ts");
  assert.match(actions, /^"use server";/);
  assert.equal((actions.match(/await requireActiveUser\(\)/g) ?? []).length, 1);
  assert.match(actions, /renameCustomBrandForUser\(supabase, user\.id,/);
  assert.match(actions, /from "@\/lib\/supabase\/server"/);
  assert.ok(!/admin|service[_-]?role|owner_id/i.test(actions.replace(/no owner or item ids/gi, "")));
  const service = read("./saved-custom-items-service.ts");
  assert.match(service, /\.eq\("owner_id", userId\)\s*\.in\("id", ids\)/);
  assert.ok(!/service[_-]?role|createAdmin/i.test(service));
  // the saved_custom_items grant already allows brand_name; no database change
  assert.match(read("../../../supabase/migrations/20261117100000_saved_custom_items.sql"), /grant update \(brand_name,/);
});

// ── Save paths reuse the existing spelling ───────────────────────────────────────────────────────────────────
test("create and update: a brand matching an existing one (ignoring case and spaces) uses the existing spelling", async () => {
  const rows = [stored(USER_A, "Acme Office")];
  const created = await createCustomItemForUser(fake(rows, USER_A), USER_A, { ...good, brandName: "  acme   OFFICE " });
  assert.equal(created.ok, true);
  assert.equal(rows[1].brand_name, "Acme Office");
  const fresh = await createCustomItemForUser(fake(rows, USER_A), USER_A, { ...good, brandName: "Brand New" });
  assert.equal(fresh.ok, true);
  assert.equal(rows[2].brand_name, "Brand New");
  // a case-only fix of the ONLY item of a brand is possible (its own old spelling is not "existing")
  const solo = [stored(USER_A, "gamma")];
  const updated = await updateCustomItemForUser(fake(solo, USER_A), USER_A, solo[0].id, { ...good, brandName: "Gamma" });
  assert.equal(updated.ok, true);
  assert.equal(solo[0].brand_name, "Gamma");
  // updating into another brand's case variant reuses that brand's spelling
  const two = [stored(USER_A, "Acme"), stored(USER_A, "Beta")];
  await updateCustomItemForUser(fake(two, USER_A), USER_A, two[1].id, { ...good, brandName: "ACME" });
  assert.equal(two[1].brand_name, "Acme");
  // another owner's brands are never used
  const mixed = [stored(USER_B, "Secret Brand")];
  await createCustomItemForUser(fake(mixed, USER_A), USER_A, { ...good, brandName: "secret brand" });
  assert.equal(mixed[1].brand_name, "secret brand");
});

// ── UI (source-text) ─────────────────────────────────────────────────────────────────────────────────────────
test("combobox: labelled Brand, required, helper text, existing brands with counts, '+ New brand' row, keyboard", () => {
  const box = read("../../../components/products/brand-combobox.tsx");
  assert.match(box, /Pick one or type a new brand/);
  assert.match(box, /aria-required="true"/);
  assert.match(box, /role="combobox"/);
  assert.match(box, /\+ New brand: /);
  assert.match(box, /brand\.count/);
  for (const key of ["ArrowDown", "ArrowUp", "Enter", "Escape"]) assert.ok(box.includes(`"${key}"`), key);
  assert.match(box, /resolveBrandInput\(value, brands\)/);
  assert.match(box, /All brands/);
});

test("the popup, the Add custom item form and the edit form all use the combobox, and the brand is required", () => {
  const page = read("../../../components/products/my-collection-custom-items.tsx");
  assert.match(page, /<BrandCombobox brands=\{brands\} value=\{values\.brandName\}/);
  assert.doesNotMatch(page, /<Field label="Brand"/, "the plain text field is gone");
  assert.match(page, /const brand = resolveBrandInput\(values\.brandName, brands\);\s*if \(!brand\.ok\)/);
  assert.match(page, /<CustomItemForm item=\{null\} brands=\{brands\}/, "Add custom item form");
  assert.match(page, /<CustomItemForm item=\{item\} brands=\{brands\}/, "edit form");
  const popup = read("../../../components/quotations/save-as-custom-item-button.tsx");
  assert.match(popup, /CustomItemForm item=\{null\} defaults=\{prefilled\.defaults\} brands=\{brands\}/);
  assert.match(popup, /listCustomItems\(\)/);
  assert.match(popup, /distinctBrands\(items\)/);
});

test("My Collection > Custom items: brand column, show more, rename brand, search; Configured tab unchanged", () => {
  const page = read("../../../components/products/my-collection-custom-items.tsx");
  assert.match(page, /<BrandFilterList brands=\{brands\} total=\{items\.length\}/);
  assert.match(page, /CUSTOM_BRAND_PAGE_SIZE/);
  assert.match(page, /Show more \(/);
  assert.match(page, /Rename brand/);
  assert.match(page, /renameCustomBrand\(brand, name\)/);
  assert.match(page, /updated to brand/);
  assert.match(page, /Search by name, code or brand/);
  assert.match(page, /Confirm delete/);
  assert.match(page, /setConfirmingDelete\(true\)/);
  const tabs = read("../../../components/products/my-collection-tabs.tsx");
  assert.match(tabs, /<MyCollectionList items=\{items\} \/>/);
  const list = read("../../../components/products/my-collection-list.tsx");
  assert.doesNotMatch(list, /custom|brand-combobox/i);
});

test("picker Custom items tab: brand column, All brands, Recently used (6), 12 items with Show more, search, sort, price line", () => {
  const pane = read("../../../components/quotations/custom-item-picker-pane.tsx");
  assert.match(pane, /<BrandFilterList brands=\{brands\} total=\{items\.length\} selected=\{activeBrand\} onSelect=\{setBrandFilter\}/);
  assert.match(pane, /recentlyUsed\(entries, CUSTOM_BRAND_RECENT_LIMIT\)/);
  assert.match(pane, /searching \|\| activeBrand \? \[\]/);
  assert.match(pane, /Recently used/);
  assert.match(pane, /brand\.items\.slice\(0, limit\)/);
  assert.match(pane, /Show more \(/);
  assert.match(pane, /Search by name, code or brand/);
  assert.match(pane, /COLLECTION_SORT_OPTIONS\.map/);
  assert.match(pane, /groupByBrand\(sortSetups\(filterSetups\(filterByBrand\(entries, activeBrand\), search\), sort\)\)/);
  assert.match(pane, /customItemPriceLine\(item\)/);
  assert.doesNotMatch(pane, /unit_price|net_total|qty/);
  const box = read("../../../components/products/brand-combobox.tsx");
  assert.match(box, /md:max-h-\[60vh\]/);
  assert.match(pane, /flex flex-col gap-4 md:flex-row/, "column stacks above on narrow screens");
  const picker = read("../../../components/quotations/add-from-my-collection-button.tsx");
  assert.doesNotMatch(picker, /brand-combobox|custom-brands/, "the Configured tab file is unchanged by brand work");
  const selector = read("../../../components/quotations/product-library-selector.tsx");
  assert.doesNotMatch(selector, /custom-brands|brand-combobox/);
});
