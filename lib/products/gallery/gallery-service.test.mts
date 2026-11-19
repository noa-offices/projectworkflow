/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory fake client and hostile input */
import assert from "node:assert/strict";
import test, { mock } from "node:test";

const G1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const G2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const TEMPLATE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const TEMPLATE2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const BRAND = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const MAIN = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";
const SUB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2";

type Row = Record<string, any>;
function makeWorld() {
  return {
    authMode: "ok" as "ok" | "redirect",
    tables: {
      product_gallery_items: [] as Row[], product_templates: [] as Row[], brands: [] as Row[], product_categories: [] as Row[],
      product_components: [] as Row[], product_template_linked_families: [] as Row[], product_template_material_groups: [] as Row[],
      brand_material_groups: [] as Row[], product_template_material_group_items: [] as Row[], brand_materials: [] as Row[],
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
    select(columns: string, options?: { count?: string }) { world.selects.push({ table: this.table, columns }); this.wantCount = Boolean(options?.count); return this; }
    eq(column: string, value: unknown) { world.eqs.push([column, value]); this.filters.push([column, value]); return this; }
    in(column: string, values: unknown[]) { this.inFilter = [column, values]; return this; }
    or(text: string) { world.ors.push(text); return this; }
    contains(column: string, value: unknown) { world.contains.push([column, value]); return this; }
    order(column: string, options?: unknown) { world.orders.push([column, options]); return this; }
    limit(count: number) { world.limits.push(count); return this; }
    range(from: number, to: number) { world.ranges.push([from, to]); this.from = from; this.to = to; return this; }
    private rows() { return world.tables[this.table].filter((row) => this.filters.every(([c, v]) => row[c] === v) && (!this.inFilter || this.inFilter[1].includes(row[this.inFilter[0]]))); }
    maybeSingle() { world.calls.push(`select:${this.table}`); return Promise.resolve({ data: this.rows()[0] ?? null, error: null }); }
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      world.calls.push(`select:${this.table}`);
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
  requireActiveUser: async () => {
    world.calls.push("auth");
    if (world.authMode === "redirect") throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" });
    return { user: { id: "u1" }, profile: { role: "sales_designer" }, displayName: "Fixture" };
  },
} });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => { world.calls.push("client"); return buildClient(); } } });
mock.module("@/lib/supabase/admin", { namedExports: { createAdminClient: () => { world.adminCalls += 1; return { error: "no admin", client: null }; } } });

const actions = await import("./gallery-actions");
const { GALLERY_MESSAGES } = await import("./gallery");

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
  assert.deepEqual(Object.keys(item).sort(), ["available", "brandId", "brandName", "categoryId", "categoryName", "currency", "displayName", "id", "isHidden", "itemCode", "itemName", "lastQuotedAt", "picture", "quotedCount", "subCategoryName", "tags", "templateId"]);
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
  assert.ok(!world.calls.includes("rpc:product_gallery_is_editor"), "no role check when hidden items were not asked for");
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
  world.tables.brand_materials = [{ id: "m1", material_group_id: MATERIAL_GROUP, material_code: "F1", material_name: "Oak", sort_order: 0, is_active: true }];
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
  assert.equal(detail.specification, "Mesh back.");
  assert.ok(detail.configuration.some((line: any) => line.value === "Chrome"));
  assert.ok(detail.configuration.some((line: any) => line.value === "Cable Tray x 2"));
  assert.deepEqual(detail.materials, [{ groupName: "Fabrics", items: ["F1 - Oak"], moreCount: 0 }]);
  assert.deepEqual(detail.options.map((group: any) => [group.kind, group.groupName, group.items]), [["option", "Casters", ["Soft"]], ["accessory", "Add-ons", ["Cable Tray"]], ["linked", "Linked products", ["Matching table"]]]);
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
