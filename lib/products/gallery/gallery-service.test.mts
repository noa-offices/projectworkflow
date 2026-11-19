/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory fake client and hostile input */
import assert from "node:assert/strict";
import test, { mock } from "node:test";

const G1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const G2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const TEMPLATE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const TEMPLATE2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const BRAND = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const MAIN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const KEY = "g:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1:" + "a".repeat(64);
const SUB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";

type Row = Record<string, any>;
function makeWorld() {
  return {
    authMode: "ok" as "ok" | "redirect",
    role: "sales_designer",
    tables: {
      product_gallery_items: [] as Row[], product_templates: [] as Row[], brands: [] as Row[], product_categories: [] as Row[], brand_price_list_updates: [] as Row[],
      product_components: [] as Row[], product_template_linked_families: [] as Row[], product_template_material_groups: [] as Row[],
      brand_material_groups: [] as Row[], product_template_material_group_items: [] as Row[], brand_materials: [] as Row[], brand_material_subgroups: [] as Row[], product_gallery_updates: [] as Row[],
    },
    calls: [] as string[],
    selects: [] as Array<{ table: string; columns: string }>,
    eqs: [] as Array<[string, unknown]>,
    ors: [] as string[],
    contains: [] as Array<[string, unknown]>,
    orders: [] as Array<[string, unknown]>,
    ranges: [] as Array<[number, number]>,
    limits: [] as number[],
    rpcCalls: [] as Array<{ name: string; args: any }>,
    rpc: {} as Record<string, (args: any) => { data: any; error: any }>,
    adminCalls: 0,
    throwOnRpc: false,
    missingColumns: [] as string[],
    revalidated: [] as string[],
  };
}
let world = makeWorld();

function buildClient() {
  class Query {
    private filters: Array<[string, unknown]> = [];
    private inFilter: [string, unknown[]] | null = null;
    private wantCount = false;
    private from = 0;
    private to = Infinity;
    constructor(private table: keyof ReturnType<typeof makeWorld>["tables"]) {}
    private missingColumn = false;
    select(columns: string, options?: { count?: string }) { world.selects.push({ table: this.table, columns }); this.wantCount = Boolean(options?.count); this.missingColumn = world.missingColumns.some((column) => columns.split(",").includes(column)); return this; }
    eq(column: string, value: unknown) { world.eqs.push([column, value]); this.filters.push([column, value]); return this; }
    in(column: string, values: unknown[]) { this.inFilter = [column, values]; return this; }
    or(text: string) { world.ors.push(text); return this; }
    contains(column: string, value: unknown) { world.contains.push([column, value]); return this; }
    order(column: string, options?: unknown) { world.orders.push([column, options]); return this; }
    limit(count: number) { world.limits.push(count); return this; }
    range(from: number, to: number) { world.ranges.push([from, to]); this.from = from; this.to = to; return this; }
    private rows() { return world.tables[this.table].filter((row) => this.filters.every(([c, v]) => row[c] === v) && (!this.inFilter || this.inFilter[1].includes(row[this.inFilter[0]]))); }
    maybeSingle() {
      world.calls.push(`select:${this.table}`);
      if (this.missingColumn) return Promise.resolve({ data: null, error: { message: "column does not exist" } });
      return Promise.resolve({ data: this.rows()[0] ?? null, error: null });
    }
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      world.calls.push(`select:${this.table}`);
      if (this.missingColumn) return Promise.resolve({ data: null, count: null, error: { message: "column does not exist" } }).then(resolve, reject);
      const all = this.rows();
      return Promise.resolve({ data: all.slice(this.from, this.to + 1), count: this.wantCount ? all.length : null, error: null }).then(resolve, reject);
    }
  }
  return {
    rpc: async (name: string, args?: any) => {
      world.calls.push(`rpc:${name}`);
      world.rpcCalls.push({ name, args });
      if (world.throwOnRpc) throw new Error("secret rpc detail");
      return world.rpc[name] ? world.rpc[name](args) : { data: null, error: null };
    },
    from: (table: string) => new Query(table as any),
  };
}

mock.module("@/lib/auth", { namedExports: {
  canManageProductLibrary: (role: string) => role === "sales_designer",
  requireActiveUser: async () => {
    world.calls.push("auth");
    if (world.authMode === "redirect") throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    return { user: { id: "u1" }, profile: { role: world.role }, displayName: "Fixture" };
  },
} });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => { world.calls.push("client"); return buildClient(); } } });
mock.module("next/cache", { namedExports: { revalidatePath: (path: string) => { world.revalidated.push(path); } } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => { world.adminCalls += 1; return { error: "no admin", client: null }; } } });

const actions = await import("./gallery-actions");
const { GALLERY_MESSAGES } = await import("./gallery");

test("price action denies the role before opening a database client, and bounds UUID batches", async () => {
  reset();
  world.role = "warehouse_staff";
  assert.deepEqual(await actions.getGalleryPricesAction([G1]), { ok: true, prices: {} });
  assert.deepEqual(world.calls, ["auth"]);
  world.role = "sales_designer";
  for (const ids of [["bad"], Array<string>(61).fill(G1)]) {
    assert.deepEqual(await actions.getGalleryPricesAction(ids), { ok: false, message: GALLERY_MESSAGES.invalid_request });
  }
  world.authMode = "redirect";
  assert.deepEqual(await actions.getGalleryPricesAction([G1]), { ok: true, prices: {} });
  assert.deepEqual(world.calls, ["auth", "auth", "auth", "auth"]);
});

test("price action batches 20 visible items by template and exposes only the authorized price payload", async () => {
  reset();
  const ids = Array.from({ length: 20 }, (_, index) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}`);
  world.tables.product_gallery_items = ids.map((id) => galleryRow({ id, recipe: { recipe_version: 1, template_id: TEMPLATE, selections: {} } }));
  world.tables.product_templates = [templateRow({ template_name: "Desk", currency: "EUR", default_unit_price: 882, brand_id: BRAND, last_price_checked_at: "2026-11-01", price_check_interval_days: 90 })];
  const result = await actions.getGalleryPricesAction(ids);
  assert.ok(result.ok);
  assert.equal(Object.keys(result.prices).length, 20);
  const priced = result.prices[ids[0]];
  assert.ok(priced.status === "priced");
  assert.deepEqual(priced.sourceTotals, [{ currency: "EUR", amount: 882 }]);
  assert.equal(priced.priceCheck.checkedAt, "2026-11-01");
  assert.deepEqual(world.selects.map(({ table }) => table).sort(),
    ["brand_price_list_updates", "brands", "product_components", "product_gallery_items", "product_template_linked_families", "product_templates"]);
  assert.equal(world.adminCalls, 0);
});

test("price action catches a failed dependency read without returning any price data", async () => {
  reset();
  world.tables.product_gallery_items = [galleryRow()];
  world.missingColumns = ["default_unit_price"];
  assert.deepEqual(await actions.getGalleryPricesAction([G1]), { ok: false, message: GALLERY_MESSAGES.load_failed });
});

const storedRecipe = {
  recipe_version: 1,
  template_id: TEMPLATE,
  selections: { variant_row_id: "ffffffff-ffff-4fff-8fff-fffffffffff1", modular_quantities: {}, pricing_accessory_quantities: {}, component_accessory_quantities: {}, skipped_accessory_group_ids: [], component_option_selections: {}, accessory_category_choices: {} },
  linked: { selections: {} },
};
const galleryRow = (extra: Row = {}): Row => ({
  id: G1, template_id: TEMPLATE, brand_id: BRAND, main_category_id: MAIN, sub_category_id: SUB, item_name: "BD-1", display_name: null, item_code: "BD1", currency: "EUR",
  recipe: storedRecipe, search_text: "bd 1 buddy chair bd1", tags: ["chair"], quoted_count: 3, last_quoted_at: "2026-11-01T00:00:00Z", is_hidden: false, ...extra,
});
const templateRow = (extra: Row = {}): Row => ({ id: TEMPLATE, is_active: true, lifecycle_status: "active", default_image_url: "product-images/a.webp", proposed_image_url_1: null, proposed_image_url_2: "product-images/b.webp", ...extra });
function reset() { world = makeWorld(); }
function seed() {
  world.tables.product_gallery_items = [galleryRow()];
  world.tables.product_templates = [templateRow()];
  world.tables.brands = [{ id: BRAND, name: "Acme" }];
  world.tables.product_categories = [{ id: MAIN, name: "Chairs" }, { id: SUB, name: "Task chairs" }];
  world.rpc.product_gallery_is_editor = () => ({ data: true, error: null });
  world.rpc.product_gallery_is_curator = () => ({ data: true, error: null });
}

// ── list ───────────────────────────────────────────────────────────────────
test("list: display fields only, available flag and picture from the template, names read in batches", async () => {
  reset(); seed();
  const result: any = await actions.listGalleryItemsAction({});
  assert.equal(result.ok, true);
  assert.equal(result.pageSize, 30);
  assert.equal(result.total, 1);
  assert.deepEqual(world.ranges[0], [0, 29]);
  const item = result.items[0];
  assert.deepEqual(Object.keys(item).sort(), ["available", "brandId", "brandName", "categoryId", "categoryName", "currency", "displayName", "id", "isHidden", "itemCode", "itemName", "lastQuotedAt", "picture", "quotedCount", "subCategoryName", "tags", "templateId", "updateAvailable"]);
  assert.equal(item.displayName, "BD-1");
  assert.equal(item.brandName, "Acme");
  assert.equal(item.categoryName, "Chairs");
  assert.equal(item.subCategoryName, "Task chairs");
  assert.equal(item.available, true);
  assert.deepEqual(item.picture, { kind: "template", path: "product-images/a.webp" }, "the template's first picture");
  assert.equal(item.quotedCount, 3);
  assert.doesNotMatch(JSON.stringify(result), /recipe|selections|variant_row_id/i, "no recipe in a list");
  assert.equal(world.calls.filter((call) => call === "select:product_templates").length, 1, "templates in ONE batched query");
});

test("list: the recipe column is never selected and no select list names a price, discount or cost", async () => {
  reset(); seed();
  await actions.listGalleryItemsAction({ query: "bd", brandId: BRAND, categoryId: MAIN, tag: "chair" });
  await actions.listGalleryFiltersAction();
  assert.ok(world.selects.length >= 5);
  for (const select of world.selects) {
    assert.doesNotMatch(select.columns, /\brecipe\b/, `${select.table}: no recipe`);
    assert.doesNotMatch(select.columns, /price|discount|cost|total/i, `${select.table}: no price words`);
  }
});

test("list: availability follows the template (inactive or archived = not available; a missing template = not available)", async () => {
  reset(); seed();
  world.tables.product_templates = [templateRow({ lifecycle_status: "archived" })];
  const archived: any = await actions.listGalleryItemsAction({});
  assert.equal(archived.items[0].available, false);
  world.tables.product_templates = [];
  const missing: any = await actions.listGalleryItemsAction({});
  assert.equal(missing.items[0].available, false);
  assert.equal(missing.items[0].picture, null);
  world.tables.product_templates = [templateRow({ is_active: false })];
  const inactive: any = await actions.listGalleryItemsAction({});
  assert.equal(inactive.items[0].available, false);
});

test("list: a picture falls back to the first proposed picture, or none", async () => {
  reset(); seed();
  world.tables.product_templates = [templateRow({ default_image_url: null, proposed_image_url_1: null })];
  const second: any = await actions.listGalleryItemsAction({});
  assert.deepEqual(second.items[0].picture, { kind: "template", path: "product-images/b.webp" });
  world.tables.product_templates = [templateRow({ default_image_url: null, proposed_image_url_2: null })];
  const none: any = await actions.listGalleryItemsAction({});
  assert.equal(none.items[0].picture, null);
});

test("list: 30 per page, page 2 starts at 30", async () => {
  reset(); seed();
  world.tables.product_gallery_items = Array.from({ length: 45 }, (_, index) => galleryRow({ id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(index).padStart(12, "0")}` }));
  const first: any = await actions.listGalleryItemsAction({ page: 1 });
  assert.equal(first.items.length, 30);
  assert.equal(first.total, 45);
  assert.equal(first.hasMore, true);
  const second: any = await actions.listGalleryItemsAction({ page: 2 });
  assert.equal(second.items.length, 15);
  assert.equal(second.hasMore, false);
  assert.deepEqual(world.ranges, [[0, 29], [30, 59]]);
});

test("list: every search word must be found (one filter per word); search text, curated name or tag; wildcards cannot widen it", async () => {
  reset(); seed();
  await actions.listGalleryItemsAction({ query: "Buddy  Chair 100%" });
  assert.equal(world.ors.length, 3, "buddy, chair, 100");
  assert.match(world.ors[0], /^search_text\.ilike\."%buddy%",display_name\.ilike\."%buddy%",tags\.cs\.\{"buddy"\}$/);
  assert.match(world.ors[2], /"%100%"/);
  reset(); seed();
  await actions.listGalleryItemsAction({ query: "50%_off\\x" });
  for (const filter of world.ors) assert.doesNotMatch(filter, /[%_\\](?!.)|\\\\/, "no stray wildcard or backslash");
  assert.deepEqual(world.ors.map((filter) => filter.split(".")[2]), ['"%50%",display_name', '"%off%",display_name', '"%x%",display_name']);
});

test("list: brand, category and tag filters; an invalid id or tag is refused", async () => {
  reset(); seed();
  await actions.listGalleryItemsAction({ brandId: BRAND, categoryId: MAIN, tag: " Chair " });
  assert.ok(world.eqs.some(([column, value]) => column === "brand_id" && value === BRAND));
  assert.ok(world.eqs.some(([column, value]) => column === "main_category_id" && value === MAIN), "category = MAIN category, exactly");
  assert.ok(!world.ors.some((filter) => /sub_category_id/.test(filter)), "no more main-OR-sub");
  assert.ok(!world.eqs.some(([column]) => column === "sub_category_id"), "the sub-category is its own filter");
  assert.deepEqual(world.contains, [["tags", ["chair"]]]);
  assert.deepEqual(await actions.listGalleryItemsAction({ brandId: "nope" }), { ok: false, message: GALLERY_MESSAGES.invalid_request });
  assert.deepEqual(await actions.listGalleryItemsAction({ categoryId: "x,y" }), { ok: false, message: GALLERY_MESSAGES.invalid_request });
  assert.deepEqual(await actions.listGalleryItemsAction({ tag: "x".repeat(40) }), { ok: false, message: GALLERY_MESSAGES.invalid_request });
});

test("list: sort modes (popular is the default; newest; name)", async () => {
  reset(); seed();
  await actions.listGalleryItemsAction({});
  assert.deepEqual(world.orders.slice(0, 2).map(([column, options]) => [column, (options as any).ascending]), [["quoted_count", false], ["last_quoted_at", false]]);
  reset(); seed();
  await actions.listGalleryItemsAction({ sort: "newest" });
  assert.deepEqual(world.orders[0], ["last_quoted_at", { ascending: false }]);
  reset(); seed();
  await actions.listGalleryItemsAction({ sort: "name" });
  assert.equal(world.orders[0][0], "display_name");
  assert.equal(world.orders[1][0], "item_name");
  reset(); seed();
  await actions.listGalleryItemsAction({ sort: "nonsense" });
  assert.equal(world.orders[0][0], "quoted_count", "an unknown sort is popular");
});

test("list: hidden items are included only when an EDITOR asks (the browser flag alone does nothing)", async () => {
  reset(); seed();
  world.rpc.product_gallery_is_editor = () => ({ data: false, error: null });
  await actions.listGalleryItemsAction({ includeHidden: true });
  assert.ok(world.eqs.some(([column, value]) => column === "is_hidden" && value === false), "a non-editor still gets visible items only");
  reset(); seed();
  world.rpc.product_gallery_is_editor = () => ({ data: true, error: null });
  await actions.listGalleryItemsAction({ includeHidden: true });
  assert.ok(!world.eqs.some(([column]) => column === "is_hidden"), "an editor asking for hidden items (edit mode)");
  reset(); seed();
  await actions.listGalleryItemsAction({});
  assert.ok(world.eqs.some(([column, value]) => column === "is_hidden" && value === false), "default: visible only, even for an editor");
  assert.equal(world.calls.filter((call) => call === "rpc:product_gallery_is_editor").length, 1, "one role check, only to decide whether update offers may be read");
});

test("list: a database failure is a friendly message", async () => {
  reset(); seed();
  world.throwOnRpc = true;
  const failed: any = await actions.listGalleryItemsAction({ includeHidden: true });
  assert.equal(failed.ok, true, "a failed role check just means: not a curator");
  reset(); seed();
  const original = world.tables.product_gallery_items;
  Object.defineProperty(world.tables, "product_gallery_items", { get() { throw new Error("secret table detail"); } });
  const broken: any = await actions.listGalleryItemsAction({});
  assert.deepEqual(broken, { ok: false, message: GALLERY_MESSAGES.load_failed });
  assert.doesNotMatch(JSON.stringify(broken), /secret/);
  void original;
});

// ── filters ────────────────────────────────────────────────────────────────
test("filters: brands, MAIN categories only and tags that have a visible item, with counts", async () => {
  reset(); seed();
  world.tables.product_gallery_items = [
    galleryRow({ id: G1, tags: ["chair", "office"] }),
    galleryRow({ id: G2, template_id: TEMPLATE2, sub_category_id: MAIN, tags: ["chair"] }),
  ];
  const result: any = await actions.listGalleryFiltersAction();
  assert.equal(result.ok, true);
  assert.deepEqual(result.brands, [{ id: BRAND, name: "Acme", count: 2 }]);
  assert.deepEqual(result.categories.map((entry: any) => [entry.name, entry.count]), [["Chairs", 2]], "main categories only; a sub-category is not in this list");
  assert.deepEqual(result.tags, [{ tag: "chair", count: 2 }, { tag: "office", count: 1 }]);
  assert.ok(world.eqs.some(([column, value]) => column === "is_hidden" && value === false), "hidden items are not counted");
  assert.deepEqual(world.limits, [2000]);
});

test("list: NEW sub-category and currency filters are exact matches; the existing filters are untouched", async () => {
  reset(); seed();
  await actions.listGalleryItemsAction({ brandId: BRAND, categoryId: MAIN, subCategoryId: SUB, currency: " eur " });
  assert.ok(world.eqs.some(([column, value]) => column === "sub_category_id" && value === SUB), "exact sub-category");
  assert.ok(world.eqs.some(([column, value]) => column === "currency" && value === "EUR"), "currency is upper-cased and exact");
  assert.ok(world.eqs.some(([column, value]) => column === "brand_id" && value === BRAND), "brand filter as before");
  assert.ok(world.eqs.some(([column, value]) => column === "main_category_id" && value === MAIN), "main category AND sub-category are both applied");
  reset(); seed();
  await actions.listGalleryItemsAction({ subCategoryId: SUB });
  assert.ok(world.eqs.some(([column, value]) => column === "sub_category_id" && value === SUB), "a sub-category works with no category");
  assert.ok(!world.eqs.some(([column]) => column === "main_category_id"));
  reset(); seed();
  await actions.listGalleryItemsAction({ subCategoryId: "", currency: null });
  assert.ok(!world.eqs.some(([column]) => column === "sub_category_id" || column === "currency"), "empty means no filter");
});

test("list: an invalid sub-category id or currency is refused before any query", async () => {
  for (const input of [{ subCategoryId: "nope" }, { subCategoryId: "x,y" }, { currency: "EU1" }, { currency: "A".repeat(9) }, { currency: "e r" }, { currency: 5 as any }]) {
    reset(); seed();
    assert.deepEqual(await actions.listGalleryItemsAction(input), { ok: false, message: GALLERY_MESSAGES.invalid_request }, JSON.stringify(input));
    assert.ok(!world.calls.includes("select:product_gallery_items"));
  }
});

test("filters: sub-categories (with parent) and currencies that have a visible item, with counts", async () => {
  reset(); seed();
  world.tables.product_gallery_items = [
    galleryRow({ id: G1, currency: "EUR" }),
    galleryRow({ id: G2, template_id: TEMPLATE2, currency: "AED" }),
    galleryRow({ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3", sub_category_id: null, currency: "EUR" }),
  ];
  const result: any = await actions.listGalleryFiltersAction();
  assert.equal(result.ok, true);
  assert.deepEqual(result.subCategories, [{ id: SUB, name: "Task chairs", parentCategoryId: MAIN, parentCategoryName: "Chairs", count: 2 }], "ALL sub-categories with a visible item, each with its parent");
  assert.deepEqual(result.currencies, [{ currency: "EUR", count: 2 }, { currency: "AED", count: 1 }]);
  assert.deepEqual(result.brands, [{ id: BRAND, name: "Acme", count: 3 }], "existing fields unchanged");
  assert.ok(world.selects.some((entry: any) => entry.table === "product_gallery_items" && /currency/.test(entry.columns) && !/recipe/.test(entry.columns)));
});

test("add data: a My Collection-shaped setup with neutral spec overrides; the recipe goes out only here", async () => {
  reset(); seed();
  const result: any = await actions.getGalleryItemForAddAction({ id: G1 });
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.item).sort(), ["id", "itemName", "setup", "templateId"]);
  assert.deepEqual(Object.keys(result.item.setup).sort(), ["id", "recipe", "setupName", "specOverrides", "templateId"]);
  assert.equal(result.item.setup.templateId, TEMPLATE);
  assert.equal(result.item.setup.setupName, "BD-1");
  assert.equal(result.item.setup.recipe.template_id, TEMPLATE);
  assert.deepEqual(result.item.setup.recipe.finishes, []);
  assert.deepEqual(result.item.setup.specOverrides, { specification_edited: false, edited_specification: null, generated_specification_hash: null });
  world.tables.product_gallery_items = [galleryRow({ display_name: "Buddy Chair" })];
  const named: any = await actions.getGalleryItemForAddAction({ id: G1 });
  assert.equal(named.item.setup.setupName, "Buddy Chair");
});

test("add data: an inactive or archived product is unavailable; a missing item; an unreadable recipe; a bad id", async () => {
  reset(); seed();
  world.tables.product_templates = [templateRow({ lifecycle_status: "archived" })];
  assert.deepEqual(await actions.getGalleryItemForAddAction({ id: G1 }), { ok: false, message: GALLERY_MESSAGES.product_unavailable });
  world.tables.product_templates = [];
  assert.deepEqual(await actions.getGalleryItemForAddAction({ id: G1 }), { ok: false, message: GALLERY_MESSAGES.product_unavailable });
  reset(); seed();
  assert.deepEqual(await actions.getGalleryItemForAddAction({ id: G2 }), { ok: false, message: GALLERY_MESSAGES.item_not_found });
  world.tables.product_gallery_items = [galleryRow({ recipe: { ...storedRecipe, selections: { ...storedRecipe.selections, discount: 10 } } })];
  assert.deepEqual(await actions.getGalleryItemForAddAction({ id: G1 }), { ok: false, message: GALLERY_MESSAGES.recipe_unreadable });
  world.tables.product_gallery_items = [galleryRow({ recipe: { ...storedRecipe, template_id: TEMPLATE2 } })];
  assert.deepEqual(await actions.getGalleryItemForAddAction({ id: G1 }), { ok: false, message: GALLERY_MESSAGES.recipe_unreadable });
  assert.deepEqual(await actions.getGalleryItemForAddAction({ id: "nope" }), { ok: false, message: GALLERY_MESSAGES.invalid_request });
});

// ── curation ───────────────────────────────────────────────────────────────
test("curation: validated arguments go to the right database function with the caller's client", async () => {
  reset(); seed();
  world.rpc.product_gallery_set_hidden = () => ({ data: true, error: null });
  world.rpc.product_gallery_update_details = () => ({ data: true, error: null });
  world.rpc.product_gallery_merge = () => ({ data: true, error: null });
  assert.deepEqual(await actions.setGalleryItemHiddenAction({ id: G1, hidden: true }), { ok: true });
  assert.deepEqual(await actions.updateGalleryItemDetailsAction({ id: G1, displayName: "  Buddy Chair ", tags: [" Chair ", "chair", "OFFICE"] }), { ok: true });
  assert.deepEqual(await actions.updateGalleryItemDetailsAction({ id: G1, displayName: "", tags: [] }), { ok: true });
  assert.deepEqual(await actions.mergeGalleryItemsAction({ fromId: G1, toId: G2 }), { ok: true });
  assert.deepEqual(world.rpcCalls.filter((call) => !/is_(editor|curator)/.test(call.name)), [
    { name: "product_gallery_set_hidden", args: { p_id: G1, p_hidden: true } },
    { name: "product_gallery_update_details", args: { p_id: G1, p_display_name: "Buddy Chair", p_tags: ["chair", "office"] } },
    { name: "product_gallery_update_details", args: { p_id: G1, p_display_name: null, p_tags: [] } },
    { name: "product_gallery_merge", args: { p_from: G1, p_to: G2 } },
  ]);
  assert.equal(world.adminCalls, 0);
});

test("curation: editors may rename, tag and hide; only curators merge; the server checks before the database", async () => {
  reset(); seed();
  world.rpc.product_gallery_set_hidden = () => ({ data: true, error: null });
  world.rpc.product_gallery_update_details = () => ({ data: true, error: null });
  world.rpc.product_gallery_merge = () => ({ data: true, error: null });
  world.rpc.product_gallery_is_curator = () => ({ data: false, error: null });
  assert.deepEqual(await actions.setGalleryItemHiddenAction({ id: G1, hidden: true }), { ok: true }, "an editor who is not a curator can hide");
  assert.deepEqual(await actions.updateGalleryItemDetailsAction({ id: G1, displayName: "Buddy", tags: [] }), { ok: true }, "and edit");
  assert.deepEqual(await actions.mergeGalleryItemsAction({ fromId: G1, toId: G2 }), { ok: false, message: GALLERY_MESSAGES.not_allowed }, "but not merge");
  assert.ok(!world.rpcCalls.some((call) => call.name === "product_gallery_merge"), "the merge function was never called");
  reset(); seed();
  world.rpc.product_gallery_is_editor = () => ({ data: false, error: null });
  world.rpc.product_gallery_is_curator = () => ({ data: true, error: null });
  assert.deepEqual(await actions.setGalleryItemHiddenAction({ id: G1, hidden: true }), { ok: false, message: GALLERY_MESSAGES.not_allowed });
  assert.deepEqual(await actions.updateGalleryItemDetailsAction({ id: G1, displayName: "x", tags: [] }), { ok: false, message: GALLERY_MESSAGES.not_allowed });
  assert.ok(!world.rpcCalls.some((call) => /set_hidden|update_details/.test(call.name)), "a non-editor never reaches the database functions");
});

test("curation: bad input never reaches the database", async () => {
  reset(); seed();
  const invalid = { ok: false, message: GALLERY_MESSAGES.invalid_request };
  assert.deepEqual(await actions.setGalleryItemHiddenAction({ id: "nope", hidden: true }), invalid);
  assert.deepEqual(await actions.setGalleryItemHiddenAction({ id: G1, hidden: "yes" as any }), invalid);
  assert.deepEqual(await actions.updateGalleryItemDetailsAction({ id: G1, displayName: "x".repeat(121), tags: [] }), invalid);
  assert.deepEqual(await actions.updateGalleryItemDetailsAction({ id: G1, displayName: "ok", tags: Array.from({ length: 21 }, (_, index) => `t${index}`) }), invalid);
  assert.deepEqual(await actions.updateGalleryItemDetailsAction({ id: G1, displayName: "ok", tags: ["x".repeat(31)] }), invalid);
  assert.deepEqual(await actions.mergeGalleryItemsAction({ fromId: G1, toId: G1 }), invalid);
  assert.deepEqual(await actions.mergeGalleryItemsAction({ fromId: G1, toId: "nope" }), invalid);
  assert.equal(world.rpcCalls.length, 0);
});

test("curation: 'Not allowed.' and 42501 are not_allowed; false is item_not_found; other errors are friendly and leak nothing", async () => {
  reset(); seed();
  world.rpc.product_gallery_set_hidden = () => ({ data: null, error: { message: "Not allowed.", code: "P0001" } });
  assert.deepEqual(await actions.setGalleryItemHiddenAction({ id: G1, hidden: true }), { ok: false, message: GALLERY_MESSAGES.not_allowed });
  world.rpc.product_gallery_set_hidden = () => ({ data: null, error: { message: "permission denied", code: "42501" } });
  assert.deepEqual(await actions.setGalleryItemHiddenAction({ id: G1, hidden: true }), { ok: false, message: GALLERY_MESSAGES.not_allowed });
  world.rpc.product_gallery_set_hidden = () => ({ data: false, error: null });
  assert.deepEqual(await actions.setGalleryItemHiddenAction({ id: G1, hidden: true }), { ok: false, message: GALLERY_MESSAGES.item_not_found });
  world.rpc.product_gallery_set_hidden = () => ({ data: null, error: { message: "boom secret detail", code: "XX000" } });
  const failed: any = await actions.setGalleryItemHiddenAction({ id: G1, hidden: true });
  assert.equal(failed.message, GALLERY_MESSAGES.save_failed);
  assert.doesNotMatch(JSON.stringify(failed), /secret/);
  world.rpc.product_gallery_merge = () => { throw new Error("secret rpc detail"); };
  const thrown: any = await actions.mergeGalleryItemsAction({ fromId: G1, toId: G2 });
  assert.deepEqual(thrown, { ok: false, message: GALLERY_MESSAGES.save_failed });
});

test("capabilities: canView / canEdit / canCurate through the three database functions; a failure means no", async () => {
  reset();
  world.rpc.product_gallery_can_view = () => ({ data: true, error: null });
  world.rpc.product_gallery_is_editor = () => ({ data: true, error: null });
  world.rpc.product_gallery_is_curator = () => ({ data: true, error: null });
  assert.deepEqual(await actions.getGalleryCapabilitiesAction(), { ok: true, canView: true, canEdit: true, canCurate: true });
  world.rpc.product_gallery_is_curator = () => ({ data: false, error: null });
  assert.deepEqual(await actions.getGalleryCapabilitiesAction(), { ok: true, canView: true, canEdit: true, canCurate: false }, "a sales editor: edit and hide, no merge");
  world.rpc.product_gallery_is_editor = () => ({ data: false, error: null });
  assert.deepEqual(await actions.getGalleryCapabilitiesAction(), { ok: true, canView: true, canEdit: false, canCurate: false }, "a viewer");
  world.rpc.product_gallery_can_view = () => ({ data: false, error: null });
  world.rpc.product_gallery_is_editor = () => ({ data: true, error: null });
  world.rpc.product_gallery_is_curator = () => ({ data: true, error: null });
  assert.deepEqual(await actions.getGalleryCapabilitiesAction(), { ok: true, canView: false, canEdit: false, canCurate: false }, "who cannot view can do nothing here");
  world.throwOnRpc = true;
  assert.deepEqual(await actions.getGalleryCapabilitiesAction(), { ok: true, canView: false, canEdit: false, canCurate: false });
});



// ── details popup ──────────────────────────────────────────────────────────
const MATERIAL_GROUP = "99999999-9999-4999-8999-999999999991";
const LINK = "88888888-8888-4888-8888-888888888881";
function seedDetail() {
  seed();
  world.rpc.product_gallery_can_view = () => ({ data: true, error: null });
  world.tables.product_templates = [templateRow({
    template_name: "Buddy Chair", template_code: "T-BD1", item_code: "BD1", description: "A task chair.", default_specification: "Mesh back.",
    default_unit_price: 98765, unit_price: 98765,
    reference_image_url: "product-images/ref.webp", proposed_image_url_1: "product-images/a.webp",
    variant_pricing: [{ id: "vg1", pricing_type: "base_model_group", group_name: "Bases", is_active: true, sort_order: 0, items: [{ id: "vr1", display_name: "Chrome", price: 98765, is_active: true, sort_order: 0 }, { id: "vr2", display_name: "Black", price: 98766, is_active: true, sort_order: 1 }] }],
    accessory_pricing: [{ id: "ag1", group_name: "Add-ons", is_active: true, sort_order: 0, items: [{ id: "ac1", item_name: "Cable Tray", price: 98765, is_active: true, sort_order: 0 }] }],
    category_pricing: [], desking_size_pricing: [],
  })];
  world.tables.product_gallery_items = [galleryRow({ recipe: { ...storedRecipe, selections: { ...storedRecipe.selections, variant_row_id: "vr1", pricing_accessory_quantities: { ac1: 2 } } }, display_name: "Buddy" })];
  world.tables.product_components = [{ id: "c1", template_id: TEMPLATE, component_group: "Casters", component_name: "Soft", option_type: "component_option", sort_order: 0, is_active: true }];
  world.tables.product_template_linked_families = [{ id: "f1", parent_template_id: TEMPLATE, label: "Matching table", sort_order: 0, is_active: true }];
  world.tables.product_template_material_groups = [{ id: LINK, product_template_id: TEMPLATE, material_group_id: MATERIAL_GROUP, selection_mode: "full_group", label_override: null, sort_order: 0, is_active: true }];
  world.tables.brand_material_groups = [{ id: MATERIAL_GROUP, group_name: "Fabrics", is_active: true }];
  world.tables.brand_materials = [
    { id: "m1", material_group_id: MATERIAL_GROUP, material_code: "F1", material_name: "Oak", image_url: "materials/f1.webp", sort_order: 0, subgroup_id: "sg1", material_collection: null, is_active: true },
    { id: "m2", material_group_id: MATERIAL_GROUP, material_code: "F2", material_name: "Ash", image_url: null, sort_order: 1, subgroup_id: null, material_collection: "Veneers", is_active: true },
  ];
  world.tables.brand_material_subgroups = [{ id: "sg1", name: "Era", grade: "A", sort_order: 0, is_active: true }];
}

test("details: header, pictures, texts, readable configuration, materials and options; no price, no recipe, no id of a recipe", async () => {
  reset(); seedDetail();
  const result: any = await actions.getGalleryItemDetailAction({ id: G1 });
  assert.equal(result.ok, true);
  const detail = result.detail;
  assert.equal(detail.displayName, "Buddy");
  assert.equal(detail.itemName, "BD-1");
  assert.equal(detail.brandName, "Acme");
  assert.equal(detail.categoryName, "Chairs");
  assert.equal(detail.subCategoryName, "Task chairs", "category and sub-category are separate");
  assert.equal(detail.itemCode, "BD1");
  assert.equal(detail.templateCode, "T-BD1");
  assert.deepEqual(detail.tags, ["chair"]);
  assert.equal(detail.quotedCount, 3);
  assert.deepEqual(detail.images, ["product-images/a.webp", "product-images/b.webp", "product-images/ref.webp"]);
  assert.equal(detail.description, "A task chair.");
  assert.equal(detail.specification, "Mesh back, Cable Tray.", "the recipe is complete: the generated text, not the plain template text");
  assert.ok(detail.configuration.some((line: any) => line.value === "Chrome"));
  assert.ok(detail.configuration.some((line: any) => line.value === "Cable Tray x 2"));
  assert.deepEqual(detail.materials, [{
    groupName: "Fabrics",
    count: 2,
    collections: [
      { name: "A · Era", swatches: [{ code: "F1", name: "Oak", imagePath: "product-images:materials/f1.webp" }] },
      { name: "Other · Veneers", swatches: [{ code: "F2", name: "Ash", imagePath: null }] },
    ],
    moreCount: 0,
  }]);
  assert.equal(detail.specificationSource, "generated", "the recipe is complete, so its text is generated");
  assert.match(detail.specification, /Cable Tray/);
  assert.deepEqual(detail.options.map((group: any) => [group.kind, group.groupName, group.items]), [["option", "Casters", [{ name: "Soft" }]], ["accessory", "Add-ons", [{ name: "Cable Tray" }]], ["linked", "Linked products", [{ name: "Matching table" }]]]);
  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /98765|98766|unit_price|variant_pricing|recipe|selections|variant_row_id/i, "no price and no recipe leave the server");
  assert.equal(world.adminCalls, 0, "the caller's own client only");
});

test("details: canView is checked FIRST; without it nothing about the item is read", async () => {
  reset(); seedDetail();
  world.rpc.product_gallery_can_view = () => ({ data: false, error: null });
  assert.deepEqual(await actions.getGalleryItemDetailAction({ id: G1 }), { ok: false, message: GALLERY_MESSAGES.not_allowed, unavailable: false });
  assert.ok(!world.calls.includes("select:product_gallery_items") && !world.calls.includes("select:product_templates"), "no item, no template read");
  assert.equal(world.calls.indexOf("rpc:product_gallery_can_view") > world.calls.indexOf("client"), true);
});

test("details: a bad id, a missing item, an inactive/archived/deleted product are friendly results, never a throw", async () => {
  reset(); seedDetail();
  assert.deepEqual(await actions.getGalleryItemDetailAction({ id: "nope" }), { ok: false, message: GALLERY_MESSAGES.invalid_request, unavailable: false });
  assert.deepEqual(await actions.getGalleryItemDetailAction(undefined as any), { ok: false, message: GALLERY_MESSAGES.invalid_request, unavailable: false });
  assert.ok(!world.calls.includes("select:product_gallery_items"), "an invalid id reads nothing");
  assert.deepEqual(await actions.getGalleryItemDetailAction({ id: G2 }), { ok: false, message: GALLERY_MESSAGES.item_not_found, unavailable: true });
  for (const change of [{ is_active: false }, { lifecycle_status: "archived" }, { lifecycle_status: "discontinued" }]) {
    reset(); seedDetail();
    world.tables.product_templates = [templateRow(change)];
    assert.deepEqual(await actions.getGalleryItemDetailAction({ id: G1 }), { ok: false, message: GALLERY_MESSAGES.product_unavailable, unavailable: true }, JSON.stringify(change));
  }
  reset(); seedDetail();
  world.tables.product_templates = [];
  assert.deepEqual(await actions.getGalleryItemDetailAction({ id: G1 }), { ok: false, message: GALLERY_MESSAGES.product_unavailable, unavailable: true }, "a deleted template");
  reset(); seedDetail();
  Object.defineProperty(world.tables, "product_gallery_items", { get() { throw new Error("secret table detail"); } });
  const broken: any = await actions.getGalleryItemDetailAction({ id: G1 });
  assert.deepEqual(broken, { ok: false, message: GALLERY_MESSAGES.load_failed, unavailable: false });
  assert.doesNotMatch(JSON.stringify(broken), /secret/);
});

test("details: a missing optional table (options, materials, linked) just gives an empty section", async () => {
  reset(); seedDetail();
  world.tables.product_components = [];
  world.tables.product_template_linked_families = [];
  world.tables.product_template_material_groups = [];
  const result: any = await actions.getGalleryItemDetailAction({ id: G1 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.detail.materials, []);
  assert.deepEqual(result.detail.options.map((group: any) => group.kind), ["accessory"]);
});

test("details: the selects name no price column and only the one item select reads the recipe", async () => {
  reset(); seedDetail();
  await actions.getGalleryItemDetailAction({ id: G1 });
  const detailSelects = world.selects.map((entry) => entry.columns);
  assert.ok(detailSelects.length >= 6);
  for (const columns of detailSelects) assert.doesNotMatch(columns, /price|discount|cost|total|unit_price/i, columns);
  assert.deepEqual(world.selects.filter((entry) => /\brecipe\b/.test(entry.columns)).map((entry) => entry.table), ["product_gallery_items"]);
});


test("details: the gallery's own specification is shown first; without the column in the database the popup still opens", async () => {
  reset(); seedDetail();
  world.tables.product_gallery_items = [galleryRow({ ...world.tables.product_gallery_items[0], specification: "  Saved text.  " })];
  const saved: any = await actions.getGalleryItemDetailAction({ id: G1 });
  assert.deepEqual([saved.detail.specification, saved.detail.specificationSource], ["Saved text.", "gallery"]);
  assert.ok(world.selects.some((entry) => entry.table === "product_gallery_items" && /specification/.test(entry.columns)));
  reset(); seedDetail();
  world.missingColumns = ["specification", "selected_image"];
  const before: any = await actions.getGalleryItemDetailAction({ id: G1 });
  assert.equal(before.ok, true, "before the migration the item is read without that column");
  assert.equal(before.detail.specificationSource, "generated");
  assert.equal(world.selects.filter((entry) => entry.table === "product_gallery_items").length, 3, "full read, then without the picture column, then without the specification column");
});

const SPEC_RPC = "product_gallery_update_specification";
test("specification save: the role is checked on the server BEFORE the database function; the function gets trimmed text", async () => {
  reset(); seed();
  world.rpc[SPEC_RPC] = () => ({ data: true, error: null });
  assert.deepEqual(await actions.updateGalleryItemSpecificationAction({ id: G1, specification: "  Mesh back.\r\nFive star.  " }), { ok: true });
  assert.deepEqual(world.rpcCalls.filter((call) => call.name === SPEC_RPC), [{ name: SPEC_RPC, args: { p_id: G1, p_specification: "Mesh back.\nFive star." } }]);
  assert.ok(world.calls.indexOf("rpc:product_gallery_is_editor") < world.calls.indexOf(`rpc:${SPEC_RPC}`), "editor check first");
  assert.equal(world.adminCalls, 0, "the caller's own client only");
  reset(); seed();
  world.rpc[SPEC_RPC] = () => ({ data: true, error: null });
  world.rpc.product_gallery_is_editor = () => ({ data: false, error: null });
  assert.deepEqual(await actions.updateGalleryItemSpecificationAction({ id: G1, specification: "x" }), { ok: false, message: GALLERY_MESSAGES.not_allowed });
  assert.ok(!world.rpcCalls.some((call) => call.name === SPEC_RPC), "a non-editor never reaches the database function");
});

test("specification save: empty clears it, 2000 characters are allowed, more is refused with a friendly message, bad input never reaches the database", async () => {
  reset(); seed();
  world.rpc[SPEC_RPC] = () => ({ data: true, error: null });
  for (const empty of ["", "   ", null]) assert.deepEqual(await actions.updateGalleryItemSpecificationAction({ id: G1, specification: empty }), { ok: true });
  assert.deepEqual(world.rpcCalls.filter((call) => call.name === SPEC_RPC).map((call) => call.args.p_specification), [null, null, null], "empty means clear");
  assert.deepEqual(await actions.updateGalleryItemSpecificationAction({ id: G1, specification: "x".repeat(2000) }), { ok: true });
  const calls = world.rpcCalls.filter((call) => call.name === SPEC_RPC).length;
  assert.deepEqual(await actions.updateGalleryItemSpecificationAction({ id: G1, specification: "x".repeat(2001) }), { ok: false, message: GALLERY_MESSAGES.specification_too_long });
  assert.deepEqual(await actions.updateGalleryItemSpecificationAction({ id: "nope", specification: "x" }), { ok: false, message: GALLERY_MESSAGES.invalid_request });
  assert.deepEqual(await actions.updateGalleryItemSpecificationAction({ id: G1, specification: 5 as any }), { ok: false, message: GALLERY_MESSAGES.invalid_request });
  assert.deepEqual(await actions.updateGalleryItemSpecificationAction(undefined as any), { ok: false, message: GALLERY_MESSAGES.invalid_request });
  assert.equal(world.rpcCalls.filter((call) => call.name === SPEC_RPC).length, calls, "nothing invalid reached the database");
  assert.match(GALLERY_MESSAGES.specification_too_long, /2000/);
});

test("specification save: database answers become friendly messages and nothing throws", async () => {
  reset(); seed();
  world.rpc[SPEC_RPC] = () => ({ data: null, error: { message: "Not allowed.", code: "P0001" } });
  assert.deepEqual(await actions.updateGalleryItemSpecificationAction({ id: G1, specification: "x" }), { ok: false, message: GALLERY_MESSAGES.not_allowed });
  world.rpc[SPEC_RPC] = () => ({ data: false, error: null });
  assert.deepEqual(await actions.updateGalleryItemSpecificationAction({ id: G1, specification: "x" }), { ok: false, message: GALLERY_MESSAGES.item_not_found });
  world.rpc[SPEC_RPC] = () => ({ data: null, error: { message: "boom secret detail", code: "XX000" } });
  const failed: any = await actions.updateGalleryItemSpecificationAction({ id: G1, specification: "x" });
  assert.equal(failed.message, GALLERY_MESSAGES.save_failed);
  assert.doesNotMatch(JSON.stringify(failed), /secret/);
  world.rpc[SPEC_RPC] = () => { throw new Error("secret rpc detail"); };
  assert.deepEqual(await actions.updateGalleryItemSpecificationAction({ id: G1, specification: "x" }), { ok: false, message: GALLERY_MESSAGES.save_failed });
});


test("details: the picture chosen in the builder is first when it is one of the template's pictures, otherwise it is ignored; no price anywhere", async () => {
  reset(); seedDetail();
  world.tables.product_gallery_items = [galleryRow({ ...world.tables.product_gallery_items[0], selected_image: "product-images/b.webp" })];
  const chosen: any = await actions.getGalleryItemDetailAction({ id: G1 });
  assert.deepEqual(chosen.detail.images, ["product-images/b.webp", "product-images/a.webp", "product-images/ref.webp"]);
  reset(); seedDetail();
  world.tables.product_gallery_items = [galleryRow({ ...world.tables.product_gallery_items[0], selected_image: "product-images/not-a-template-picture.webp" })];
  const ignored: any = await actions.getGalleryItemDetailAction({ id: G1 });
  assert.deepEqual(ignored.detail.images, ["product-images/a.webp", "product-images/b.webp", "product-images/ref.webp"], "an unknown stored picture is never returned");
  assert.doesNotMatch(JSON.stringify(ignored), /not-a-template-picture/);
  reset(); seedDetail();
  world.missingColumns = ["selected_image"];
  const before: any = await actions.getGalleryItemDetailAction({ id: G1 });
  assert.equal(before.ok, true, "before that migration the item is read without the picture column");
  assert.equal(before.detail.specificationSource, "generated", "and the specification column is still read");
  assert.deepEqual(before.detail.images[0], "product-images/a.webp");
});

test("list: a card uses the chosen picture when valid (the template's own, no extra query), otherwise the default; the list still works without the column", async () => {
  reset(); seed();
  world.tables.product_templates = [templateRow({ reference_image_url: "product-images/ref.webp" })];
  world.tables.product_gallery_items = [galleryRow({ selected_image: "product-images/b.webp" })];
  const chosen: any = await actions.listGalleryItemsAction({});
  assert.deepEqual(chosen.items[0].picture, { kind: "template", path: "product-images/b.webp" });
  assert.equal(world.calls.filter((call) => call === "select:product_templates").length, 1, "no extra query for the picture");
  assert.ok(world.selects.some((entry) => entry.table === "product_gallery_items" && entry.columns.split(",").includes("selected_image")));
  assert.deepEqual(Object.keys(chosen.items[0]).includes("selected_image"), false, "the stored value itself is never returned");
  const reference = (await (async () => { reset(); seed(); world.tables.product_templates = [templateRow({ reference_image_url: "product-images/ref.webp" })]; world.tables.product_gallery_items = [galleryRow({ selected_image: "product-images/ref.webp" })]; return actions.listGalleryItemsAction({}); })()) as any;
  assert.deepEqual(reference.items[0].picture, { kind: "template", path: "product-images/ref.webp" }, "the reference picture can be the chosen one");
  reset(); seed();
  world.tables.product_gallery_items = [galleryRow({ selected_image: "product-images/elsewhere.webp" })];
  const unknown: any = await actions.listGalleryItemsAction({});
  assert.deepEqual(unknown.items[0].picture, { kind: "template", path: "product-images/a.webp" }, "an unknown stored picture falls back to the default");
  assert.doesNotMatch(JSON.stringify(unknown), /elsewhere/);
  reset(); seed();
  world.missingColumns = ["selected_image"];
  const without: any = await actions.listGalleryItemsAction({});
  assert.equal(without.ok, true, "before the migration the list is read without that column");
  assert.deepEqual(without.items[0].picture, { kind: "template", path: "product-images/a.webp" });
  assert.equal(world.selects.filter((entry) => entry.table === "product_gallery_items").length, 2);
});


test("details: finishes follow the template's selection mode: selected_categories shows only the connected materials (read in chunks), full_group shows the whole group", async () => {
  reset(); seedDetail();
  world.tables.product_template_material_groups = [{ id: LINK, product_template_id: TEMPLATE, material_group_id: MATERIAL_GROUP, selection_mode: "selected_categories", label_override: "Fabric Finishes", sort_order: 0, is_active: true }];
  world.tables.brand_materials = Array.from({ length: 300 }, (_, index) => ({ id: `mat-${index}`, material_group_id: MATERIAL_GROUP, material_code: `F${index}`, material_name: `Fabric ${index}`, image_url: null, sort_order: index, material_category: "SG3", material_collection: "CHILI", subgroup_id: null, is_active: true }));
  world.tables.product_template_material_group_items = Array.from({ length: 250 }, (_, index) => ({ product_template_material_group_id: LINK, brand_material_id: `mat-${index}`, sort_order: index, is_active: true }));
  const result: any = await actions.getGalleryItemDetailAction({ id: G1 });
  assert.equal(result.ok, true);
  assert.equal(result.detail.materials[0].groupName, "Fabric Finishes", "the label override");
  assert.equal(result.detail.materials[0].count, 250, "the connected materials only, not the 300 of the brand group");
  assert.equal(result.detail.materials[0].collections[0].name, "SG3 · CHILI");
  assert.equal(world.calls.filter((call) => call === "select:brand_materials").length, 3, "250 ids in chunks of 100");
  reset(); seedDetail();
  world.tables.product_template_material_groups = [{ id: LINK, product_template_id: TEMPLATE, material_group_id: MATERIAL_GROUP, selection_mode: "full_group", label_override: null, sort_order: 0, is_active: true }];
  world.tables.brand_materials = Array.from({ length: 12 }, (_, index) => ({ id: `mat-${index}`, material_group_id: MATERIAL_GROUP, material_code: `F${index}`, material_name: `Fabric ${index}`, image_url: null, sort_order: index, material_category: null, material_collection: null, subgroup_id: null, is_active: true }));
  const whole: any = await actions.getGalleryItemDetailAction({ id: G1 });
  assert.equal(whole.detail.materials[0].count, 12, "full_group lists the whole brand group");
});

const REMOVE_RPC = "product_gallery_remove";
test("remove: editors only, role checked on the server BEFORE the database function; right arguments; the caller's own client", async () => {
  reset(); seed();
  world.rpc[REMOVE_RPC] = () => ({ data: true, error: null });
  assert.deepEqual(await actions.removeGalleryItemAction({ id: G1 }), { ok: true, alreadyRemoved: false });
  assert.deepEqual(world.rpcCalls.filter((call) => call.name === REMOVE_RPC), [{ name: REMOVE_RPC, args: { p_id: G1 } }]);
  assert.ok(world.calls.indexOf("rpc:product_gallery_is_editor") < world.calls.indexOf(`rpc:${REMOVE_RPC}`), "editor check first");
  assert.equal(world.adminCalls, 0);
  reset(); seed();
  world.rpc[REMOVE_RPC] = () => ({ data: true, error: null });
  world.rpc.product_gallery_is_editor = () => ({ data: false, error: null });
  assert.deepEqual(await actions.removeGalleryItemAction({ id: G1 }), { ok: false, message: GALLERY_MESSAGES.not_allowed });
  assert.ok(!world.rpcCalls.some((call) => call.name === REMOVE_RPC), "a non-editor never reaches the database function");
});

test("remove: an item that is already gone is a success; bad input never reaches the database; database failures are friendly and nothing throws", async () => {
  reset(); seed();
  world.rpc[REMOVE_RPC] = () => ({ data: false, error: null });
  assert.deepEqual(await actions.removeGalleryItemAction({ id: G1 }), { ok: true, alreadyRemoved: true });
  const calls = world.rpcCalls.filter((call) => call.name === REMOVE_RPC).length;
  assert.deepEqual(await actions.removeGalleryItemAction({ id: "nope" }), { ok: false, message: GALLERY_MESSAGES.invalid_request });
  assert.deepEqual(await actions.removeGalleryItemAction(undefined as any), { ok: false, message: GALLERY_MESSAGES.invalid_request });
  assert.equal(world.rpcCalls.filter((call) => call.name === REMOVE_RPC).length, calls);
  world.rpc[REMOVE_RPC] = () => ({ data: null, error: { message: "Not allowed.", code: "P0001" } });
  assert.deepEqual(await actions.removeGalleryItemAction({ id: G1 }), { ok: false, message: GALLERY_MESSAGES.not_allowed });
  world.rpc[REMOVE_RPC] = () => ({ data: null, error: { message: "boom secret detail", code: "XX000" } });
  const failed: any = await actions.removeGalleryItemAction({ id: G1 });
  assert.equal(failed.message, GALLERY_MESSAGES.save_failed);
  assert.doesNotMatch(JSON.stringify(failed), /secret/);
  world.rpc[REMOVE_RPC] = () => { throw new Error("secret rpc detail"); };
  assert.deepEqual(await actions.removeGalleryItemAction({ id: G1 }), { ok: false, message: GALLERY_MESSAGES.save_failed });
});


// ── removed items, restore, update offers ───────────────────────────────────
const offer = (kind: string, value: string | null, status = "open", itemId = G1) => ({ item_id: itemId, kind, proposed_value: value, status });

test("offers in the list: editors see the 'Update available' flag for OPEN offers only; an ignored offer shows nothing", async () => {
  reset(); seed();
  world.tables.product_gallery_updates = [offer("specification", "New text"), offer("picture", "product-images/b.webp", "ignored")];
  const editor: any = await actions.listGalleryItemsAction({});
  assert.equal(editor.items[0].updateAvailable, true);
  world.tables.product_gallery_updates = [offer("specification", "New text", "ignored"), offer("picture", "x.webp", "ignored"), offer("configuration", "stale1-abc", "ignored")];
  const ignored: any = await actions.listGalleryItemsAction({});
  assert.equal(ignored.items[0].updateAvailable, false, "ignored offers (and the configuration notice) never show the tag");
  assert.ok(world.selects.some((entry) => entry.table === "product_gallery_updates"));
});

test("offers in the list: a non-editor gets false everywhere and the offers table is never read", async () => {
  reset(); seed();
  world.rpc.product_gallery_is_editor = () => ({ data: false, error: null });
  world.tables.product_gallery_updates = [offer("specification", "New text")];
  const result: any = await actions.listGalleryItemsAction({ updateAvailable: true });
  assert.equal(result.items[0].updateAvailable, false);
  assert.ok(!world.selects.some((entry) => entry.table === "product_gallery_updates"), "no offer query for a non-editor");
  assert.equal(result.items.length, 1, "the filter is ignored for a non-editor (it shows the normal list, not the offers)");
});

test("update filter: only items with an open offer; nothing when there are none", async () => {
  reset(); seed();
  world.tables.product_gallery_items = [galleryRow({ id: G1 }), galleryRow({ id: G2, template_id: TEMPLATE2 })];
  world.tables.product_gallery_updates = [offer("picture", "product-images/b.webp", "open", G2)];
  const filtered: any = await actions.listGalleryItemsAction({ updateAvailable: true });
  assert.deepEqual(filtered.items.map((item: any) => item.id), [G2]);
  world.tables.product_gallery_updates = [offer("picture", "x", "ignored", G2)];
  const none: any = await actions.listGalleryItemsAction({ updateAvailable: true });
  assert.deepEqual([none.ok, none.items, none.total], [true, [], 0]);
});

test("detail: editors get the compare data and the stale notice; everyone else gets null and the offers table is not read", async () => {
  reset(); seedDetail();
  world.tables.product_gallery_items = [galleryRow({ ...world.tables.product_gallery_items[0], specification: "Saved text.", recipe: { ...storedRecipe, selections: { ...storedRecipe.selections, variant_row_id: "gone-row" } } })];
  world.tables.product_gallery_updates = [offer("specification", "A newer text."), offer("picture", "product-images/b.webp")];
  const editor: any = await actions.getGalleryItemDetailAction({ id: G1 });
  assert.deepEqual(editor.detail.updates.specification, { current: "Saved text.", proposed: "A newer text." });
  assert.deepEqual(editor.detail.updates.picture, { currentPath: "product-images/a.webp", proposedPath: "product-images/b.webp" });
  assert.match(editor.detail.staleNotice.fingerprint, /^stale\d+-[0-9a-f]+$/);
  assert.doesNotMatch(JSON.stringify(editor), /98765|price/i);
  reset(); seedDetail();
  world.rpc.product_gallery_is_editor = () => ({ data: false, error: null });
  world.tables.product_gallery_updates = [offer("specification", "A newer text.")];
  const viewer: any = await actions.getGalleryItemDetailAction({ id: G1 });
  assert.equal(viewer.detail.updates, null);
  assert.equal(viewer.detail.staleNotice, null);
  assert.ok(!world.selects.some((entry) => entry.table === "product_gallery_updates"), "no offer data for a non-editor");
  assert.doesNotMatch(JSON.stringify(viewer), /A newer text/);
});

test("detail: an ignored stale notice stays hidden until the set of stale choices changes", async () => {
  reset(); seedDetail();
  world.tables.product_gallery_items = [galleryRow({ ...world.tables.product_gallery_items[0], recipe: { ...storedRecipe, selections: { ...storedRecipe.selections, variant_row_id: "gone-row" } } })];
  const first: any = await actions.getGalleryItemDetailAction({ id: G1 });
  const fingerprint = first.detail.staleNotice.fingerprint;
  world.tables.product_gallery_updates = [offer("configuration", fingerprint, "ignored")];
  const hidden: any = await actions.getGalleryItemDetailAction({ id: G1 });
  assert.equal(hidden.detail.staleNotice, null);
  world.tables.product_gallery_updates = [offer("configuration", "stale1-different", "ignored")];
  const again: any = await actions.getGalleryItemDetailAction({ id: G1 });
  assert.equal(again.detail.staleNotice?.fingerprint, fingerprint, "a different fingerprint shows it again");
});

test("removed list: editors only; names from the snapshot, else the product; unreadable rows dropped; no admin client", async () => {
  reset(); seed();
  world.tables.product_templates = [templateRow({ id: TEMPLATE2, template_name: "Old Product" })];
  world.rpc.product_gallery_removed_list = () => ({ error: null, data: [
    { identity_key: KEY, removed_at: "2026-11-01T10:00:00Z", template_id: TEMPLATE, item_name: "BD-1", display_name: "Buddy", quoted_count: 3, has_snapshot: true },
    { identity_key: "g:" + TEMPLATE2 + ":" + "b".repeat(64), removed_at: "2026-10-01T10:00:00Z", template_id: TEMPLATE2, item_name: null, display_name: null, quoted_count: null, has_snapshot: false },
    { identity_key: "not-a-key", removed_at: "x", template_id: null },
  ] });
  const result: any = await actions.listRemovedGalleryItemsAction();
  assert.equal(result.ok, true);
  assert.deepEqual(result.items.map((item: any) => [item.name, item.quotedCount, item.hasSnapshot]), [["Buddy", 3, true], ["Old Product", null, false]]);
  assert.equal(world.adminCalls, 0);
  assert.doesNotMatch(JSON.stringify(result), /recipe|price/i);
  reset(); seed();
  world.rpc.product_gallery_is_editor = () => ({ data: false, error: null });
  world.rpc.product_gallery_removed_list = () => ({ error: null, data: [] });
  assert.deepEqual(await actions.listRemovedGalleryItemsAction(), { ok: false, message: GALLERY_MESSAGES.not_allowed });
  assert.ok(!world.rpcCalls.some((call) => call.name === "product_gallery_removed_list"), "the database function is never reached by a non-editor");
  reset(); seed();
  world.rpc.product_gallery_removed_list = () => ({ error: { message: "boom secret" }, data: null });
  const failed: any = await actions.listRemovedGalleryItemsAction();
  assert.deepEqual(failed, { ok: false, message: GALLERY_MESSAGES.load_failed });
});

test("restore: the three database answers, key validation, the editor guard and the page is refreshed", async () => {
  for (const outcome of ["restored", "allowed_again", "not_found"] as const) {
    reset(); seed();
    world.rpc.product_gallery_restore = () => ({ data: outcome, error: null });
    assert.deepEqual(await actions.restoreGalleryItemAction({ key: KEY }), { ok: true, outcome });
    assert.deepEqual(world.rpcCalls.filter((call) => call.name === "product_gallery_restore"), [{ name: "product_gallery_restore", args: { p_key: KEY } }]);
    assert.deepEqual(world.revalidated, ["/products/gallery"]);
  }
  reset(); seed();
  world.rpc.product_gallery_restore = () => ({ data: "restored", error: null });
  for (const key of ["", "nope", "g:x:y", KEY + "z", 5 as any, undefined as any]) assert.deepEqual(await actions.restoreGalleryItemAction({ key }), { ok: false, message: GALLERY_MESSAGES.invalid_request }, String(key));
  assert.ok(!world.rpcCalls.some((call) => call.name === "product_gallery_restore"), "a bad key never reaches the database");
  world.rpc.product_gallery_is_editor = () => ({ data: false, error: null });
  assert.deepEqual(await actions.restoreGalleryItemAction({ key: KEY }), { ok: false, message: GALLERY_MESSAGES.not_allowed });
  world.rpc.product_gallery_is_editor = () => ({ data: true, error: null });
  world.rpc.product_gallery_restore = () => ({ data: "something else", error: null });
  assert.deepEqual(await actions.restoreGalleryItemAction({ key: KEY }), { ok: false, message: GALLERY_MESSAGES.save_failed });
  world.rpc.product_gallery_restore = () => ({ data: null, error: { message: "Not allowed.", code: "P0001" } });
  assert.deepEqual(await actions.restoreGalleryItemAction({ key: KEY }), { ok: false, message: GALLERY_MESSAGES.not_allowed });
  world.rpc.product_gallery_restore = () => { throw new Error("secret rpc detail"); };
  assert.deepEqual(await actions.restoreGalleryItemAction({ key: KEY }), { ok: false, message: GALLERY_MESSAGES.save_failed });
});

test("apply and ignore: kind whitelist, fingerprint rules, editor guard before the database, right arguments, friendly results", async () => {
  reset(); seed();
  world.rpc.product_gallery_update_apply = () => ({ data: true, error: null });
  world.rpc.product_gallery_update_ignore = () => ({ data: true, error: null });
  assert.deepEqual(await actions.applyGalleryUpdateAction({ id: G1, kind: "specification" }), { ok: true });
  assert.deepEqual(await actions.applyGalleryUpdateAction({ id: G1, kind: "picture" }), { ok: true });
  assert.deepEqual(await actions.ignoreGalleryUpdateAction({ id: G1, kind: "picture" }), { ok: true });
  assert.deepEqual(await actions.ignoreGalleryUpdateAction({ id: G1, kind: "configuration", value: "stale2-1a2b" }), { ok: true });
  assert.deepEqual(world.rpcCalls.filter((call) => /update_(apply|ignore)/.test(call.name)), [
    { name: "product_gallery_update_apply", args: { p_item: G1, p_kind: "specification" } },
    { name: "product_gallery_update_apply", args: { p_item: G1, p_kind: "picture" } },
    { name: "product_gallery_update_ignore", args: { p_item: G1, p_kind: "picture", p_value: null } },
    { name: "product_gallery_update_ignore", args: { p_item: G1, p_kind: "configuration", p_value: "stale2-1a2b" } },
  ]);
  assert.equal(world.revalidated.length, 4);
  const writes = () => world.rpcCalls.filter((call) => /update_(apply|ignore)/.test(call.name)).length;
  const before = writes();
  const invalid = { ok: false, message: GALLERY_MESSAGES.invalid_request };
  assert.deepEqual(await actions.applyGalleryUpdateAction({ id: G1, kind: "configuration" as any }), invalid, "a configuration notice cannot be applied");
  assert.deepEqual(await actions.applyGalleryUpdateAction({ id: G1, kind: "whatever" as any }), invalid);
  assert.deepEqual(await actions.applyGalleryUpdateAction({ id: "nope", kind: "picture" }), invalid);
  assert.deepEqual(await actions.ignoreGalleryUpdateAction({ id: G1, kind: "other" as any }), invalid);
  assert.deepEqual(await actions.ignoreGalleryUpdateAction({ id: G1, kind: "configuration" }), invalid, "the notice needs its fingerprint");
  assert.deepEqual(await actions.ignoreGalleryUpdateAction({ id: G1, kind: "configuration", value: "x".repeat(201) }), invalid);
  assert.deepEqual(await actions.ignoreGalleryUpdateAction({ id: G1, kind: "configuration", value: "has spaces; drop table" }), invalid);
  assert.equal(writes(), before, "nothing invalid reached the database");
  world.rpc.product_gallery_is_editor = () => ({ data: false, error: null });
  assert.deepEqual(await actions.applyGalleryUpdateAction({ id: G1, kind: "picture" }), { ok: false, message: GALLERY_MESSAGES.not_allowed });
  assert.deepEqual(await actions.ignoreGalleryUpdateAction({ id: G1, kind: "picture" }), { ok: false, message: GALLERY_MESSAGES.not_allowed });
  assert.equal(writes(), before, "a non-editor never reaches the database functions");
  world.rpc.product_gallery_is_editor = () => ({ data: true, error: null });
  world.rpc.product_gallery_update_apply = () => ({ data: false, error: null });
  assert.deepEqual(await actions.applyGalleryUpdateAction({ id: G1, kind: "picture" }), { ok: false, message: GALLERY_MESSAGES.update_not_found });
  world.rpc.product_gallery_update_ignore = () => ({ data: null, error: { message: "boom secret", code: "XX000" } });
  assert.deepEqual(await actions.ignoreGalleryUpdateAction({ id: G1, kind: "picture" }), { ok: false, message: GALLERY_MESSAGES.save_failed });
  world.rpc.product_gallery_update_ignore = () => { throw new Error("secret rpc detail"); };
  assert.deepEqual(await actions.ignoreGalleryUpdateAction({ id: G1, kind: "picture" }), { ok: false, message: GALLERY_MESSAGES.save_failed });
  assert.equal(world.adminCalls, 0);
});

// ── actions: auth first, never throw ───────────────────────────────────────
test("every action authenticates FIRST, before any client or database call", async () => {
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["list", () => actions.listGalleryItemsAction({})],
    ["filters", () => actions.listGalleryFiltersAction()],
    ["add", () => actions.getGalleryItemForAddAction({ id: G1 })],
    ["hide", () => actions.setGalleryItemHiddenAction({ id: G1, hidden: true })],
    ["details", () => actions.updateGalleryItemDetailsAction({ id: G1, displayName: "x", tags: [] })],
    ["merge", () => actions.mergeGalleryItemsAction({ fromId: G1, toId: G2 })],
    ["capabilities", () => actions.getGalleryCapabilitiesAction()],
    ["detail", () => actions.getGalleryItemDetailAction({ id: G1 })],
    ["specification", () => actions.updateGalleryItemSpecificationAction({ id: G1, specification: "x" })],
    ["remove", () => actions.removeGalleryItemAction({ id: G1 })],
    ["removed list", () => actions.listRemovedGalleryItemsAction()],
    ["restore", () => actions.restoreGalleryItemAction({ key: KEY })],
    ["apply update", () => actions.applyGalleryUpdateAction({ id: G1, kind: "specification" })],
    ["ignore update", () => actions.ignoreGalleryUpdateAction({ id: G1, kind: "picture" })],
  ];
  for (const [name, run] of calls) {
    reset(); seed();
    await run();
    assert.equal(world.calls[0], "auth", `${name}: auth is the first call`);
    assert.ok(world.calls.indexOf("auth") < world.calls.indexOf("client"), `${name}: auth before the client`);
  }
});

test("a signed-out user gets 'not allowed' and nothing is read; no action throws to the browser", async () => {
  const calls: Array<() => Promise<unknown>> = [
    () => actions.listGalleryItemsAction({}),
    () => actions.listGalleryFiltersAction(),
    () => actions.getGalleryItemForAddAction({ id: G1 }),
    () => actions.setGalleryItemHiddenAction({ id: G1, hidden: true }),
    () => actions.updateGalleryItemDetailsAction({ id: G1, displayName: "x", tags: [] }),
    () => actions.mergeGalleryItemsAction({ fromId: G1, toId: G2 }),
    () => actions.getGalleryCapabilitiesAction(),
    () => actions.updateGalleryItemSpecificationAction({ id: G1, specification: "x" }),
    () => actions.removeGalleryItemAction({ id: G1 }),
    () => actions.listRemovedGalleryItemsAction(),
    () => actions.restoreGalleryItemAction({ key: KEY }),
    () => actions.applyGalleryUpdateAction({ id: G1, kind: "specification" }),
    () => actions.ignoreGalleryUpdateAction({ id: G1, kind: "picture" }),
  ];
  for (const run of calls) {
    reset(); seed();
    world.authMode = "redirect";
    assert.deepEqual(await run(), { ok: false, message: GALLERY_MESSAGES.not_allowed });
    assert.deepEqual(world.calls, ["auth"], "nothing else ran");
  }
  reset(); seed();
  world.authMode = "redirect";
  assert.deepEqual(await actions.getGalleryItemDetailAction({ id: G1 }), { ok: false, message: GALLERY_MESSAGES.not_allowed, unavailable: false });
  assert.deepEqual(world.calls, ["auth"], "the detail action reads nothing when signed out");
  // hostile input never throws
  reset(); seed();
  for (const run of [() => (actions as any).listGalleryItemsAction(null), () => (actions as any).getGalleryItemForAddAction(undefined), () => (actions as any).mergeGalleryItemsAction(null), () => (actions as any).updateGalleryItemDetailsAction(null)]) {
    const result: any = await run();
    assert.equal(typeof result.ok, "boolean");
  }
});

test("nothing logs a recipe, a row or a price", async () => {
  reset(); seed();
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    world.throwOnRpc = true;
    await actions.mergeGalleryItemsAction({ fromId: G1, toId: G2 });
    await actions.setGalleryItemHiddenAction({ id: G1, hidden: true });
  } finally {
    console.error = original;
  }
  assert.ok(logged.length > 0);
  assert.doesNotMatch(JSON.stringify(logged), /secret|recipe|selections|price|variant_row_id/i);
});

test("check updates: editor guard, count messages and revalidation", async () => {
  reset(); seed();
  world.rpc.product_gallery_can_view = () => ({ data: true, error: null });
  world.rpc.product_gallery_is_editor = () => ({ data: false, error: null });
  assert.deepEqual(await actions.checkGalleryUpdatesAction(), { ok: false, message: GALLERY_MESSAGES.not_allowed });
  assert.equal(world.rpcCalls.some((call) => call.name === "product_gallery_check_updates"), false);
  world.rpc.product_gallery_is_editor = () => ({ data: true, error: null });
  world.rpc.product_gallery_check_updates = () => ({ data: 2, error: null });
  assert.deepEqual(await actions.checkGalleryUpdatesAction(), { ok: true, message: "2 update(s) found" });
  world.rpc.product_gallery_check_updates = () => ({ data: 0, error: null });
  assert.deepEqual(await actions.checkGalleryUpdatesAction(), { ok: true, message: "No updates found" });
  assert.deepEqual(world.revalidated, ["/products/gallery", "/products/gallery"]);
});
