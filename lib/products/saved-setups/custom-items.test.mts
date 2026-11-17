/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory fake rows and deliberately hostile input */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CUSTOM_ITEM_PRICE_LIMIT,
  customItemPriceLine,
  formatCustomItemPrice,
  toCollectionItem,
  validateCustomItem,
  type CustomItemListItem,
} from "./custom-item";
import {
  COLLECTION_SORT_OPTIONS,
  filterSetups,
  groupByBrand,
  groupByBrandProduct,
  itemCountLabel,
  setupCountLabel,
  sortSetups,
} from "./collection-view";
import {
  createCustomItemForUser,
  deleteCustomItemForUser,
  listCustomItemsForUser,
  updateCustomItemForUser,
} from "./saved-custom-items-service";
import { clearRemovedSetupsForUser, listSetupsForUser } from "./saved-setups-service";
import { isSetupUsable } from "./usable";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";

const good = { brandName: "Acme", itemName: "Special desk", sellingPrice: "1200", currency: "AED" };

// ── Validator ────────────────────────────────────────────────────────────────────────────────────────────────
test("validator: trims, defaults the unit to Pc, keeps optional fields null", () => {
  const result = validateCustomItem({ ...good, brandName: "  Acme  ", itemName: "  Special desk ", itemCode: "  ", specification: "", unitLabel: "  " });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.value, { brand_name: "Acme", item_name: "Special desk", item_code: null, specification: null, unit_label: "Pc", selling_price: 1200, currency: "AED" });
});

test("validator: every length limit has a plain message", () => {
  const cases: Array<[string, Record<string, unknown>, string]> = [
    ["brandName", { brandName: "x".repeat(81) }, "brandName"],
    ["brandName", { brandName: "   " }, "brandName"],
    ["itemName", { itemName: "x".repeat(121) }, "itemName"],
    ["itemName", { itemName: "" }, "itemName"],
    ["itemCode", { itemCode: "x".repeat(61) }, "itemCode"],
    ["specification", { specification: "x".repeat(4001) }, "specification"],
    ["unitLabel", { unitLabel: "x".repeat(21) }, "unitLabel"],
  ];
  for (const [field, patch] of cases) {
    const result = validateCustomItem({ ...good, ...patch });
    assert.equal(result.ok, false, JSON.stringify(patch));
    if (!result.ok) assert.match(String((result.errors as any)[field]), /\w+/, field);
  }
  assert.ok(validateCustomItem({ ...good, brandName: "x".repeat(80), itemName: "y".repeat(120), itemCode: "c".repeat(60), specification: "s".repeat(4000), unitLabel: "u".repeat(20) }).ok);
});

test("validator: price rules (negative, text, NaN, 3 decimals, huge, zero, 2 decimals)", () => {
  const price = (value: unknown) => validateCustomItem({ ...good, sellingPrice: value });
  for (const bad of ["-1", -5, "abc", "", "  ", "1e3", "1,200", NaN, Infinity, "12.345", "1000000000", 1_000_000_000, null, undefined, {}]) {
    const result = price(bad);
    assert.equal(result.ok, false, String(bad));
    if (!result.ok) assert.ok(result.errors.sellingPrice, String(bad));
  }
  assert.match(String((price("-1") as any).errors.sellingPrice), /negative/);
  assert.match(String((price("12.345") as any).errors.sellingPrice), /2 decimal/);
  for (const ok of ["0", 0, "1200", "1200.5", "1200.50", 999999999.99, "0.01"]) assert.ok(price(ok).ok, String(ok));
  assert.equal((price("1200.50") as any).value.selling_price, 1200.5);
  assert.ok(CUSTOM_ITEM_PRICE_LIMIT === 1_000_000_000);
});

test("validator: currency must be AED, EUR or USD (reuses lib/currencies)", () => {
  for (const code of ["AED", "EUR", "USD", " usd "]) assert.ok(validateCustomItem({ ...good, currency: code }).ok, code);
  for (const code of ["GBP", "", undefined, 5]) {
    const result = validateCustomItem({ ...good, currency: code });
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(String(result.errors.currency), /AED, EUR, USD/);
  }
  assert.match(read("./custom-item.ts"), /from "@\/lib\/currencies"/);
  assert.doesNotMatch(read("./custom-item.ts"), /\["AED", ?"EUR", ?"USD"\]/);
});

test("validator: reports every bad field at once and never reads owner, source or sharing fields", () => {
  const result = validateCustomItem({} as any);
  assert.equal(result.ok, false);
  if (!result.ok) assert.deepEqual(Object.keys(result.errors).sort(), ["brandName", "currency", "itemName", "sellingPrice"]);
  const hostile = validateCustomItem({ ...good, owner_id: USER_B, ownerId: USER_B, sourceItemId: "x", sharedBy: USER_B } as any);
  assert.ok(hostile.ok);
  if (hostile.ok) assert.deepEqual(Object.keys(hostile.value).sort(), ["brand_name", "currency", "item_code", "item_name", "selling_price", "specification", "unit_label"]);
});

// ── Fake client ──────────────────────────────────────────────────────────────────────────────────────────────
type Row = Record<string, any>;
type Db = { saved_custom_items: Row[]; saved_setups: Row[] };

function fake(db: Db, session: string, log: { updates: Row[] } = { updates: [] }) {
  let counter = 0;
  class Query {
    private op: "select" | "insert" | "update" | "delete" = "select";
    private payload: Row = {};
    private filters: Array<(row: Row) => boolean> = [];
    private orders: string[] = [];
    constructor(private table: keyof Db) {}
    select() { return this; }
    insert(payload: Row) { this.op = "insert"; this.payload = payload; return this; }
    update(payload: Row) { this.op = "update"; this.payload = payload; log.updates.push(payload); return this; }
    delete() { this.op = "delete"; return this; }
    eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
    in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
    order(column: string) { this.orders.push(column); return this; }
    private run(): { data: Row[] | null; error: { message: string } | null } {
      const rows = db[this.table];
      const visible = (row: Row) => row.owner_id === session; // own-only RLS
      if (this.op === "insert") {
        if (this.payload.owner_id !== session) return { data: null, error: { message: "rls" } };
        const row = { id: `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`, use_count: 0, created_at: "2026-01-01", source_item_id: null, shared_by: null, ...this.payload };
        rows.push(row);
        return { data: [row], error: null };
      }
      const matched = rows.filter((row) => visible(row) && this.filters.every((filter) => filter(row)));
      if (this.op === "update") {
        // Column grant: ownership and provenance columns can never be changed.
        for (const column of ["id", "owner_id", "source_item_id", "shared_by"]) if (column in this.payload) return { data: null, error: { message: "permission denied" } };
        matched.forEach((row) => Object.assign(row, this.payload));
        return { data: matched, error: null };
      }
      if (this.op === "delete") { for (const row of matched) rows.splice(rows.indexOf(row), 1); return { data: matched, error: null }; }
      const out = matched.map((row) => ({ ...row }));
      for (const column of [...this.orders].reverse()) out.sort((a, b) => String(a[column]).localeCompare(String(b[column])));
      return { data: out, error: null };
    }
    single() { const r = this.run(); return Promise.resolve(r.data?.[0] ? { data: r.data[0], error: null } : { data: null, error: r.error ?? { message: "none" } }); }
    maybeSingle() { const r = this.run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); }
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve(this.run()).then(resolve, reject); }
  }
  return { from: (table: keyof Db) => new Query(table) } as unknown as SupabaseClient;
}
const newDb = (): Db => ({ saved_custom_items: [], saved_setups: [] });

// ── Service ──────────────────────────────────────────────────────────────────────────────────────────────────
test("service: the owner is the session user even if the client sends another owner_id", async () => {
  const db = newDb();
  const result = await createCustomItemForUser(fake(db, USER_A), USER_A, { ...good, owner_id: USER_B, ownerId: USER_B, source_item_id: "x", shared_by: USER_B } as any);
  assert.equal(result.ok, true);
  assert.equal(db.saved_custom_items.length, 1);
  const row = db.saved_custom_items[0];
  assert.equal(row.owner_id, USER_A);
  assert.equal(row.source_item_id, null);
  assert.equal(row.shared_by, null);
  assert.equal(row.selling_price, 1200);
  assert.ok(row.price_saved_at);
});

test("service: invalid input returns the first message and per-field errors and saves nothing", async () => {
  const db = newDb();
  const result = await createCustomItemForUser(fake(db, USER_A), USER_A, { ...good, sellingPrice: "-3", brandName: "" });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.error);
    assert.ok(result.fieldErrors?.sellingPrice && result.fieldErrors.brandName);
  }
  assert.equal(db.saved_custom_items.length, 0);
});

test("service: list is owner-only", async () => {
  const db = newDb();
  await createCustomItemForUser(fake(db, USER_A), USER_A, good);
  await createCustomItemForUser(fake(db, USER_B), USER_B, { ...good, itemName: "B item" });
  const a = await listCustomItemsForUser(fake(db, USER_A), USER_A);
  assert.deepEqual(a.map((item) => item.itemName), ["Special desk"]);
  assert.equal(a[0].sellingPrice, 1200);
  // Even a wrong userId argument cannot reveal the other owner's rows: RLS plus the owner filter.
  assert.deepEqual(await listCustomItemsForUser(fake(db, USER_A), USER_B), []);
});

test("service: update changes only editable columns; price_saved_at moves only when price or currency change", async () => {
  const db = newDb();
  const created = await createCustomItemForUser(fake(db, USER_A), USER_A, good);
  assert.ok(created.ok);
  const id = (created as any).id as string;
  db.saved_custom_items[0].price_saved_at = "2020-01-01T00:00:00.000Z";
  const log = { updates: [] as Row[] };

  // name only
  assert.equal((await updateCustomItemForUser(fake(db, USER_A, log), USER_A, id, { ...good, itemName: "Renamed" })).ok, true);
  assert.equal(db.saved_custom_items[0].item_name, "Renamed");
  assert.equal(db.saved_custom_items[0].price_saved_at, "2020-01-01T00:00:00.000Z", "name change keeps the saved-price date");
  // same price written differently is not a change
  await updateCustomItemForUser(fake(db, USER_A, log), USER_A, id, { ...good, sellingPrice: "1200.00" });
  assert.equal(db.saved_custom_items[0].price_saved_at, "2020-01-01T00:00:00.000Z");
  // price change
  await updateCustomItemForUser(fake(db, USER_A, log), USER_A, id, { ...good, sellingPrice: "1300" });
  assert.notEqual(db.saved_custom_items[0].price_saved_at, "2020-01-01T00:00:00.000Z");
  assert.equal(db.saved_custom_items[0].selling_price, 1300);
  // currency change
  db.saved_custom_items[0].price_saved_at = "2020-01-01T00:00:00.000Z";
  await updateCustomItemForUser(fake(db, USER_A, log), USER_A, id, { ...good, sellingPrice: "1300", currency: "USD" });
  assert.notEqual(db.saved_custom_items[0].price_saved_at, "2020-01-01T00:00:00.000Z");
  assert.equal(db.saved_custom_items[0].currency, "USD");

  // never sends owner, id, source or sharing columns, even for hostile input
  await updateCustomItemForUser(fake(db, USER_A, log), USER_A, id, { ...good, owner_id: USER_B, source_item_id: "s", shared_by: USER_B } as any);
  for (const payload of log.updates) for (const column of ["id", "owner_id", "source_item_id", "shared_by"]) assert.ok(!(column in payload), column);
  assert.equal(db.saved_custom_items[0].owner_id, USER_A);
  assert.equal(db.saved_custom_items[0].source_item_id, null);
  assert.equal(db.saved_custom_items[0].shared_by, null);
});

test("service: another user cannot update or delete an item; delete is never blocked for the owner", async () => {
  const db = newDb();
  const created = await createCustomItemForUser(fake(db, USER_A), USER_A, good);
  const id = (created as any).id as string;
  assert.equal((await updateCustomItemForUser(fake(db, USER_B), USER_B, id, { ...good, itemName: "hijack" })).ok, false);
  assert.equal((await deleteCustomItemForUser(fake(db, USER_B), USER_B, id)).ok, false);
  assert.equal(db.saved_custom_items[0].item_name, "Special desk");
  assert.equal((await deleteCustomItemForUser(fake(db, USER_A), USER_A, "not-a-uuid")).ok, false);
  // a used, shared-looking, recently used item is still deletable
  Object.assign(db.saved_custom_items[0], { use_count: 9, last_used_at: "2026-01-01", source_item_id: null });
  const deleted = await deleteCustomItemForUser(fake(db, USER_A), USER_A, id);
  assert.equal(deleted.ok, true);
  assert.equal(db.saved_custom_items.length, 0);
});

test("actions: every action authenticates first, uses the caller's client, never an admin client, never reads an owner from input", () => {
  const actions = read("./saved-custom-items-actions.ts");
  assert.match(actions, /^"use server";/);
  assert.equal((actions.match(/await requireActiveUser\(\)/g) ?? []).length, 4);
  assert.match(actions, /from "@\/lib\/supabase\/server"/);
  assert.ok(!/service[_-]?role|createAdmin|admin/i.test(actions.replace(/never an admin client/gi, "")));
  assert.ok(!/input\??\.(owner|source|shared)/i.test(actions));
  assert.doesNotMatch(actions, /owner_id|source_item_id|shared_by/);
  const service = read("./saved-custom-items-service.ts");
  assert.ok(!/service[_-]?role|createAdmin/i.test(service));
  assert.match(service, /owner_id: userId/);
});

// ── Removed-products isolation ───────────────────────────────────────────────────────────────────────────────
test("custom items never show in Removed products and Clear removed never touches them", async () => {
  const db = newDb();
  await createCustomItemForUser(fake(db, USER_A), USER_A, good);
  db.saved_setups.push(
    { id: "s-removed", owner_id: USER_A, template_id: null, brand_name: "B", product_name: "P", setup_name: "gone", use_count: 0, created_at: "2026-01-01", updated_at: "2026-01-01", archived: false },
  );
  const setups = await listSetupsForUser(fake(db, USER_A), USER_A, { withImages: false });
  assert.deepEqual(setups.map((item) => item.id), ["s-removed"]);
  assert.equal(setups.filter((item) => !item.usable).length, 1);
  const cleared = await clearRemovedSetupsForUser(fake(db, USER_A), USER_A);
  assert.deepEqual(cleared, { ok: true, count: 1 });
  assert.equal(db.saved_custom_items.length, 1, "custom item survives Clear removed");
  assert.equal(db.saved_setups.length, 0);
});

test("saved_setups code is unchanged: isSetupUsable, the Removed products section and Clear removed", () => {
  assert.equal(isSetupUsable({ template_id: null }, { is_active: true, lifecycle_status: "active" }), false);
  const service = read("./saved-setups-service.ts");
  assert.doesNotMatch(service, /saved_custom_items/);
  assert.match(service, /removed: !row\.template_id/);
  assert.match(service, /items\.filter\(\(item\) => !item\.usable\)/);
  assert.doesNotMatch(read("./usable.ts"), /custom/i);
  assert.doesNotMatch(read("./actions.ts"), /custom/i);
  assert.doesNotMatch(read("./recipe.ts"), /custom|selling_price/i);
  const list = read("../../../components/products/my-collection-list.tsx");
  assert.doesNotMatch(list, /custom/i);
  assert.match(list, /Removed products \(/);
});

// ── collection-view mapping ──────────────────────────────────────────────────────────────────────────────────
function item(id: string, patch: Partial<CustomItemListItem> = {}): CustomItemListItem {
  return { id, brandName: "Acme", itemName: "Desk", itemCode: null, specification: null, unitLabel: "Pc", sellingPrice: 100, currency: "AED", priceSavedAt: "2026-11-17T08:00:00Z", createdAt: "2026-01-01T00:00:00Z", lastUsedAt: null, useCount: 0, ...patch };
}

test("collection-view works for custom items: search by brand, name and code; sort; grouping", () => {
  const list = [
    toCollectionItem(item("1", { brandName: "Zeta", itemName: "Lamp", itemCode: "LMP-9", createdAt: "2026-03-01T00:00:00Z" })),
    toCollectionItem(item("2", { brandName: "Acme", itemName: "Desk", itemCode: "DSK-1", createdAt: "2026-02-01T00:00:00Z", lastUsedAt: "2026-04-01T00:00:00Z" })),
    toCollectionItem(item("3", { brandName: "Acme", itemName: "Chair", createdAt: "2026-01-01T00:00:00Z" })),
  ];
  const ids = (entries: Array<{ id: string }>) => entries.map((entry) => entry.id);
  assert.deepEqual(ids(filterSetups(list, "zeta")), ["1"], "brand");
  assert.deepEqual(ids(filterSetups(list, "chair")), ["3"], "name");
  assert.deepEqual(ids(filterSetups(list, "dsk-1")), ["2"], "code");
  assert.deepEqual(ids(filterSetups(list, "")), ["1", "2", "3"]);
  assert.deepEqual(ids(sortSetups(list, "name")), ["3", "2", "1"]);
  assert.deepEqual(ids(sortSetups(list, "newest")), ["1", "2", "3"]);
  assert.deepEqual(ids(sortSetups(list, "recent")), ["2", "1", "3"]);
  assert.equal(list[0].productName, list[0].setupName);
  const groups = groupByBrand(sortSetups(list, "name"));
  assert.deepEqual(groups.map((group) => [group.brandName, group.count, ids(group.items)]), [["Acme", 2, ["3", "2"]], ["Zeta", 1, ["1"]]]);
  assert.equal(itemCountLabel(1), "1 item");
  assert.equal(itemCountLabel(3), "3 items");
  // existing behaviour unchanged
  assert.equal(setupCountLabel(1), "1 setup");
  assert.equal(groupByBrandProduct([{ id: "x", brandName: "B", productName: "P", setupName: "S" }]).length, 1);
  assert.equal(filterSetups([{ id: "x", brandName: "B", productName: "P", setupName: "S" }], "b").length, 1);
  assert.equal(COLLECTION_SORT_OPTIONS.length, 3);
});

test("price line: 'AED 1,200 · Saved price 17 Nov 2026'", () => {
  assert.equal(formatCustomItemPrice("AED", 1200), "AED 1,200");
  assert.equal(formatCustomItemPrice("USD", 1200.5), "USD 1,200.50");
  assert.equal(customItemPriceLine(item("1", { sellingPrice: 1200 })), "AED 1,200 · Saved price 17 Nov 2026");
  assert.equal(customItemPriceLine(item("1", { priceSavedAt: null })), "AED 100");
});

// ── Page (source-text) ───────────────────────────────────────────────────────────────────────────────────────
test("page: two tabs, form fields, two-step delete, empty state; the Configured tab is the unchanged list", () => {
  const tabs = read("../../../components/products/my-collection-tabs.tsx");
  assert.match(tabs, /Configured products/);
  assert.match(tabs, /Custom items/);
  assert.match(tabs, /<MyCollectionList items=\{items\} \/>/);
  const custom = read("../../../components/products/my-collection-custom-items.tsx");
  for (const label of ["Brand", "Item name", "Code", "Unit", "Selling price", "Currency", "Specification", "Add custom item"]) assert.ok(custom.includes(label), label);
  assert.match(custom, /Confirm delete/);
  assert.match(custom, /setConfirmingDelete\(true\)/);
  assert.match(custom, /Add an item that is not in the Product Library, with your own price\./);
  assert.match(custom, /Search custom items/);
  assert.match(custom, /COLLECTION_SORT_OPTIONS\.map/);
  assert.match(custom, /fieldErrors/);
  assert.match(custom, /grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3/);
  assert.doesNotMatch(custom, /image_path|upload/i, "no image in this PR");
  const page = read("../../../app/products/my-collection/page.tsx");
  assert.match(page, /<MyCollectionTabs items=\{items\} customItems=\{customItems\} \/>/);
  assert.match(page, /listCustomItemsForUser\(supabase, user\.id\)/);
  assert.match(page, /Your saved product setups\. Prices are always recalculated from the current price lists when you use one\./);
  // no picker tab and no quote-builder change in this PR
  for (const file of ["components/quotations/add-from-my-collection-button.tsx", "components/quotations/local-quotation-builder.tsx", "components/quotations/product-library-selector.tsx", "app/quotations/[id]/builder/page.tsx"]) {
    assert.doesNotMatch(read(`../../../${file}`), /saved-custom-items|custom-item/, file);
  }
});

// ── Migration (source-text) ──────────────────────────────────────────────────────────────────────────────────
test("migration: 4 own-only policies, update grant excludes owner/id/provenance, no price column on saved_setups", () => {
  const sql = read("../../../supabase/migrations/20261117100000_saved_custom_items.sql");
  const policies = sql.match(/create policy saved_custom_items_\w+_own/g) ?? [];
  assert.equal(policies.length, 4);
  for (const kind of ["select", "insert", "update", "delete"]) assert.match(sql, new RegExp(`create policy saved_custom_items_${kind}_own`));
  assert.equal((sql.match(/owner_id = \(select auth\.uid\(\)\)/g) ?? []).length, 5);
  const grant = sql.match(/grant update \(([\s\S]*?)\)\s*on public\.saved_custom_items/);
  assert.ok(grant);
  const columns = grant![1].split(",").map((column) => column.trim());
  for (const forbidden of ["owner_id", "id", "source_item_id", "shared_by"]) assert.ok(!columns.includes(forbidden), forbidden);
  assert.match(sql, /revoke all on public\.saved_custom_items from public, anon, authenticated/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /currency in \('AED','EUR','USD'\)/);
  const setups = read("../../../supabase/migrations/20261112100000_saved_setups.sql");
  assert.doesNotMatch(setups, /selling_price|price_saved_at|currency/);
  assert.doesNotMatch(sql, /internal_cost|margin_|supplier_cost/);
});
