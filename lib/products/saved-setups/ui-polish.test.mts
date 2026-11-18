import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  filterSetups,
  formatSavedDate,
  groupByBrandProduct,
  isMyCollectionActive,
  recentlyUsed,
  savedLine,
  setupCountLabel,
  sortSetups,
  type CollectionDisplayItem,
} from "./collection-view";

const item = (id: string, patch: Partial<CollectionDisplayItem> = {}): CollectionDisplayItem => ({
  id, brandName: "Interstuhl", productName: "Every", setupName: id, createdAt: "2026-01-01T00:00:00Z", lastUsedAt: null, useCount: 0, ...patch,
});
const ids = (list: CollectionDisplayItem[]) => list.map((entry) => entry.id);

// ── Sorting ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("sort: recently used (default) puts used setups first by last use, then never-used by newest", () => {
  const list = [
    item("never-old", { createdAt: "2026-01-01T00:00:00Z" }),
    item("used-old", { lastUsedAt: "2026-03-01T00:00:00Z" }),
    item("never-new", { createdAt: "2026-05-01T00:00:00Z" }),
    item("used-new", { lastUsedAt: "2026-06-01T00:00:00Z" }),
  ];
  assert.deepEqual(ids(sortSetups(list, "recent")), ["used-new", "used-old", "never-new", "never-old"]);
  assert.deepEqual(ids(list), ["never-old", "used-old", "never-new", "used-new"], "input is not mutated");
});

test("sort: newest by created date, and Name A-Z (case-insensitive, numbers in order)", () => {
  const list = [
    item("b", { setupName: "beta 10", createdAt: "2026-02-01T00:00:00Z" }),
    item("a", { setupName: "Alpha", createdAt: "2026-04-01T00:00:00Z" }),
    item("c", { setupName: "beta 2", createdAt: "2026-03-01T00:00:00Z" }),
  ];
  assert.deepEqual(ids(sortSetups(list, "newest")), ["a", "c", "b"]);
  assert.deepEqual(ids(sortSetups(list, "name")), ["a", "c", "b"]);
  assert.deepEqual(ids(sortSetups([], "recent")), []);
  assert.deepEqual(ids(sortSetups([item("x", { createdAt: null }), item("y", { createdAt: "bad date" })], "newest")), ["x", "y"], "missing or invalid dates do not crash");
});

test("recently used: only setups that were used, newest use first, capped at 4; empty without use data", () => {
  const list = Array.from({ length: 6 }, (_, index) => item(`s${index}`, { lastUsedAt: `2026-0${index + 1}-01T00:00:00Z` }));
  assert.deepEqual(ids(recentlyUsed(list)), ["s5", "s4", "s3", "s2"]);
  assert.deepEqual(recentlyUsed([item("never"), item("never2")]), []);
});

// ── Search ──────────────────────────────────────────────────────────────────────────────────────────────────────
test("search matches the setup name, the product name or the brand (case-insensitive); empty keeps all; no match gives an empty list", () => {
  const list = [
    item("1", { setupName: "Every EV211", productName: "Every", brandName: "Interstuhl" }),
    item("2", { setupName: "Jera Meeting 159 913", productName: "Jera", brandName: "LAS MOBILI" }),
  ];
  assert.deepEqual(ids(filterSetups(list, "ev211")), ["1"]);
  assert.deepEqual(ids(filterSetups(list, "  JERA ")), ["2"], "product name and name");
  assert.deepEqual(ids(filterSetups(list, "las mobili")), ["2"], "brand");
  assert.deepEqual(ids(filterSetups(list, "")), ["1", "2"]);
  assert.deepEqual(ids(filterSetups(list, "   ")), ["1", "2"]);
  assert.deepEqual(filterSetups(list, "nothing like this"), []);
});

// ── Grouping and labels ─────────────────────────────────────────────────────────────────────────────────────────
test("grouping: Brand > Product > setups with a count per brand", () => {
  const groups = groupByBrandProduct([
    item("1", { brandName: "Interstuhl", productName: "Every" }),
    item("2", { brandName: "Interstuhl", productName: "Every" }),
    item("3", { brandName: "Interstuhl", productName: "Bow" }),
    item("4", { brandName: "Alpha", productName: "Jera" }),
  ]);
  assert.deepEqual(groups.map((group) => [group.brandName, group.count]), [["Alpha", 1], ["Interstuhl", 3]]);
  assert.deepEqual(groups[1].products.map((product) => [product.productName, product.setups.length]), [["Bow", 1], ["Every", 2]]);
  assert.equal(setupCountLabel(1), "1 setup");
  assert.equal(setupCountLabel(3), "3 setups");
});

test("saved line: 'Saved 17 Nov 2026 · Used 3 times', singular, never used, missing date", () => {
  assert.equal(formatSavedDate("2026-11-17T09:30:00Z"), "17 Nov 2026");
  assert.equal(savedLine({ createdAt: "2026-11-17T09:30:00Z", useCount: 3 }), "Saved 17 Nov 2026 · Used 3 times");
  assert.equal(savedLine({ createdAt: "2026-11-17T09:30:00Z", useCount: 1 }), "Saved 17 Nov 2026 · Used 1 time");
  assert.equal(savedLine({ createdAt: "2026-11-17T09:30:00Z", useCount: 0 }), "Saved 17 Nov 2026 · Not used yet");
  assert.equal(savedLine({ createdAt: null, useCount: null }), "Not used yet");
  assert.equal(formatSavedDate("garbage"), "");
});

// ── Sidebar (checked from source, like the other layout tests) ────────────────────────────────────────────────────
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const sidebar = read("../../../components/layout/erp-sidebar.tsx");

function rolesOf(name: string): string[] {
  const match = sidebar.match(new RegExp(`const ${name} =\\s*((?:\\s*role === "\\w+"\\s*\\|?\\|?)+);`));
  assert.ok(match, `${name} definition found`);
  return Array.from(match![1].matchAll(/role === "(\w+)"/g), (entry) => entry[1]);
}
const productsSection = sidebar.slice(sidebar.indexOf('title: "Products"'), sidebar.indexOf('title: "', sidebar.indexOf('title: "Products"') + 10));

test("sidebar: My Collection is visible to a manager AND to a non-manager (no role gate, group not hidden)", () => {
  const line = productsSection.split("\n").find((entry) => entry.includes('label: "My Collection"'));
  assert.ok(line, "My Collection item exists in the Products group");
  assert.ok(!/hidden:/.test(line!), "no per-item gate");
  assert.ok(!/hiddenSection/.test(productsSection), "the Products group is no longer hidden for non-managers");
  assert.match(line!, /href: "\/products\/my-collection"/);
  assert.match(line!, /active: isMyCollectionActive\(pathname\)/);
  // It is the FIRST item of the group.
  const labels = Array.from(productsSection.matchAll(/label: "([^"]+)"/g), (entry) => entry[1]);
  assert.deepEqual(labels, ["My Collection", "Product Library", "Product Management", "Brands", "Material Library", "Price Updates"]);
  // Warehouse staff keep their own separate sidebar (returned before this group is built).
  assert.ok(sidebar.indexOf('if (role === "warehouse_staff") {') < sidebar.indexOf('title: "Products"'));
});

test("sidebar: the other Products items are still gated exactly as before (no access widened)", () => {
  const manage = ["system_owner", "admin_manager", "procurement_manager", "sales_designer", "sales_coordinator", "designer"];
  assert.deepEqual(rolesOf("canManageProducts"), manage);
  assert.deepEqual(rolesOf("canManageMaterials"), manage);
  assert.deepEqual(rolesOf("canManagePriceUpdates"), ["system_owner", "admin_manager", "procurement_manager", "designer"]);
  const gate = (label: string) => productsSection.split("\n").find((entry) => entry.includes(`label: "${label}"`))?.match(/hidden: (![A-Za-z]+)/)?.[1];
  assert.equal(gate("Product Library"), "!canManageProducts");
  assert.equal(gate("Product Management"), "!canManageProducts");
  assert.equal(gate("Brands"), "!canManageProducts");
  assert.equal(gate("Material Library"), "!canManageMaterials");
  assert.equal(gate("Price Updates"), "!canManagePriceUpdates");
  // Visible items per role = the My Collection item plus whatever the unchanged gates allow.
  const visible = (role: string | null) => ["My Collection", ...(role && manage.includes(role) ? ["Product Library", "Product Management", "Brands", "Material Library"] : []), ...(role && rolesOf("canManagePriceUpdates").includes(role) ? ["Price Updates"] : [])];
  assert.deepEqual(visible("sales_designer"), ["My Collection", "Product Library", "Product Management", "Brands", "Material Library"]);
  assert.deepEqual(visible("viewer"), ["My Collection"]);
  assert.deepEqual(visible(null), ["My Collection"]);
});

test("sidebar: My Collection is active on its own route only, and never lights up Product Library", () => {
  assert.equal(isMyCollectionActive("/products/my-collection"), true);
  assert.equal(isMyCollectionActive("/products/my-collection/anything"), true);
  assert.equal(isMyCollectionActive("/products"), false);
  assert.equal(isMyCollectionActive("/products/templates"), false);
  assert.equal(isMyCollectionActive("/products/my-collection-old"), false);
  assert.match(sidebar, /function isProductLibraryActive\(pathname: string, priceStatus: string \| null, manage: string \| null\) \{\s*return \(\s*\(pathname === "\/products" \|\| pathname === "\/products\/templates"\)/);
});

// ── Picker ──────────────────────────────────────────────────────────────────────────────────────────────────────
const picker = read("../../../components/quotations/add-from-my-collection-button.tsx");

test("picker: lists only what listPickerSetups returns (usable setups), shows no price, whole card is the click target", () => {
  assert.ok(picker.includes("listPickerSetups()"));
  // Comments may say "no price"; only rendered code and text matter.
  const code = picker.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\s\/\/ best effort.*$/gm, "");
  assert.ok(!/formatMoney|unit_price|net_price|currency|\bAED\b|\bprice\b/i.test(code.replace(/current price lists/g, "").replace(/Prices are recalculated/g, "")), "no price text or price fields");
  assert.ok(!/supabase/i.test(picker));
  const card = picker.slice(picker.indexOf("function SetupPickCard"), picker.indexOf("export function AddFromMyCollectionButton"));
  assert.match(card, /<button\s+type="button"[\s\S]*onClick=\{\(\) => onPick\(item\.id\)\}/);
  assert.ok(card.indexOf("<SetupThumbnail") > card.indexOf("<button") && card.indexOf("{item.setupName}") > card.indexOf("<button"), "thumbnail and name are inside the button");
  assert.ok(card.indexOf("</button>") > card.indexOf("{item.setupName}"));
  assert.match(card, /hover:/);
  assert.match(card, /focus-visible:/);
});

test("picker: search box is focused on open, Escape closes, wide dialog with a sticky header, Manage link kept", () => {
  assert.match(picker, /searchRef\.current\?\.focus\(\)/);
  assert.match(picker, /event\.key === "Escape"[\s\S]{0,80}setOpen\(false\)/);
  assert.match(picker, /sm:max-w-\[1200px\]/);
  assert.match(picker, /sticky top-0/);
  assert.match(picker, /role="dialog"/);
  assert.match(picker, /href="\/products\/my-collection"/);
  assert.match(picker, /Open My Collection page/);
  assert.match(picker, /Recently used/);
});

test("selection, replay and save code paths are unchanged: the picker still loads, hands over, then marks use", () => {
  assert.ok(picker.includes("const result = await loadSetupForReplay(id);"));
  assert.ok(picker.includes("const problem = onChoose(result.setup);"));
  assert.ok(picker.includes("void markSetupUsed(id).catch(() => undefined);"));
  assert.ok(picker.includes("setSetups(await listPickerSetups());"));
  const selector = read("../../../components/quotations/product-library-selector.tsx");
  assert.ok(selector.includes("<AddFromMyCollectionButton onChoose={openSetupFromCollection} />"));
  assert.ok(selector.includes("const openSetupFromCollection = (setup: SetupForUse): string | null => {"));
  assert.ok(selector.includes("<SaveToMyCollectionButton"));
  assert.ok(selector.includes("onAddLocalItem?.(localProductItem);"));
});

// ── My Collection page ──────────────────────────────────────────────────────────────────────────────────────────
const list = read("../../../components/products/my-collection-list.tsx");

test("page: cards in a responsive grid, search + sort, empty and no-result states, rename / two-step delete / clear removed kept", () => {
  assert.match(list, /grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3/);
  assert.match(list, /size=\{104\}/);
  assert.match(list, /loading="lazy"/);
  assert.match(list, /alt=\{alt\}/);
  assert.match(list, /Search My Collection/);
  assert.match(list, /COLLECTION_SORT_OPTIONS\.map/);
  assert.match(list, /Save a configured product from the Product Library and it appears here\./);
  assert.match(list, /No setup matches your search\./);
  assert.match(list, /Confirm delete/);
  assert.match(list, /renameSetup\(item\.id, name\)/);
  assert.match(list, /deleteSetup\(item\.id\)/);
  assert.match(list, /Removed products \(/);
  assert.match(list, /These products are no longer available\. You can clear them from here\./);
  assert.match(list, /clearRemovedSetups\(\)/);
  assert.match(list, /setupCountLabel\(brand\.count\)/);
  assert.ok(!/formatMoney|unit_price|net_price|currency/i.test(list));
  const page = read("../../../app/products/my-collection/page.tsx");
  assert.ok(page.includes("Prices are always recalculated from the current price lists when you use one."));
});
