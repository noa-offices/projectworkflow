/* eslint-disable @typescript-eslint/no-explicit-any -- in-memory fake rows and a deliberately hostile input */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildRecipe,
  findForbiddenRecipeKey,
  hashSpecificationText,
  restorePlainState,
  validateRecipeShape,
  type SavedSetupPlainState,
} from "./recipe";
import {
  clearRemovedSetupsForUser,
  deleteSetupForUser,
  listSetupsForUser,
  renameSetupForUser,
  saveSetupForUser,
} from "./saved-setups-service";
import { isSetupUsable } from "./usable";
import { defaultSetupName } from "./default-name";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const TPL_OK = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TPL_ARCHIVED = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TPL_HIDDEN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const BRAND = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

// ── Minimal in-memory Supabase fake. `rls` simulates the database policies (own-only rows, hidden templates). ──
type Row = Record<string, any>;
type Db = { product_templates: Row[]; brands: Row[]; saved_setups: Row[] };

function newDb(): Db {
  return {
    brands: [{ id: BRAND, name: "Interstuhl" }],
    product_templates: [
      { id: TPL_OK, brand_id: BRAND, template_name: "Silver 262S", is_active: true, lifecycle_status: "active", pricing_version: 7 },
      { id: TPL_ARCHIVED, brand_id: BRAND, template_name: "Old chair", is_active: true, lifecycle_status: "archived", pricing_version: 1 },
      { id: TPL_HIDDEN, brand_id: BRAND, template_name: "Hidden", is_active: true, lifecycle_status: "active", pricing_version: 1 },
    ],
    saved_setups: [],
  };
}

function fake(db: Db, session: string, options: { rls?: boolean; hiddenTemplates?: string[]; counter?: Record<string, number> } = {}) {
  const rls = options.rls ?? true;
  const hidden = new Set(options.hiddenTemplates ?? []);
  let counter = 0;
  class Query {
    private op: "select" | "insert" | "update" | "delete" = "select";
    private payload: Row = {};
    private filters: Array<(row: Row) => boolean> = [];
    private projection = "";
    private orders: string[] = [];
    constructor(private table: keyof Db) {}
    select(columns: string) { this.projection = columns; return this; }
    insert(payload: Row) { this.op = "insert"; this.payload = payload; return this; }
    update(payload: Row) { this.op = "update"; this.payload = payload; return this; }
    delete() { this.op = "delete"; return this; }
    eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
    in(column: string, values: unknown[]) { this.filters.push((row) => values.includes(row[column])); return this; }
    order(column: string) { this.orders.push(column); return this; }
    private visible(row: Row) {
      if (!rls) return true;
      if (this.table === "saved_setups") return row.owner_id === session;
      if (this.table === "product_templates") return !hidden.has(row.id);
      return true;
    }
    private run(): { data: Row[] | null; error: { message: string } | null } {
      const rows = db[this.table];
      if (options.counter && this.op === "select") options.counter[this.table] = (options.counter[this.table] ?? 0) + 1;
      if (this.op === "insert") {
        if (rls && this.table === "saved_setups" && this.payload.owner_id !== session) return { data: null, error: { message: "rls" } };
        const row = { id: `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`, use_count: 0, archived: false, updated_at: "2026-01-01", ...this.payload };
        rows.push(row);
        return { data: [row], error: null };
      }
      const matched = rows.filter((row) => this.visible(row) && this.filters.every((filter) => filter(row)));
      if (this.op === "update") { matched.forEach((row) => Object.assign(row, this.payload)); return { data: matched, error: null }; }
      if (this.op === "delete") { for (const row of matched) rows.splice(rows.indexOf(row), 1); return { data: matched, error: null }; }
      let out = matched.map((row) => ({ ...row }));
      if (this.table === "saved_setups" && this.projection.includes("product_templates(")) {
        out = out.map((row) => ({
          ...row,
          product_templates: db.product_templates.find((tpl) => tpl.id === row.template_id && !hidden.has(tpl.id)) ?? null,
        }));
      }
      if (this.table === "saved_setups" && this.projection.includes("selected_image")) {
        out = out.map((row) => ({ ...row, selected_image: row.recipe?.selected_image ?? null }));
      }
      for (const column of [...this.orders].reverse()) out.sort((a, b) => String(a[column]).localeCompare(String(b[column])));
      return { data: out, error: null };
    }
    single() { const r = this.run(); return Promise.resolve(r.data?.[0] ? { data: r.data[0], error: null } : { data: null, error: r.error ?? { message: "none" } }); }
    maybeSingle() { const r = this.run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: r.error }); }
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve(this.run()).then(resolve, reject); }
  }
  return { from: (table: keyof Db) => new Query(table) } as unknown as SupabaseClient;
}

const baseState: SavedSetupPlainState = { templateId: TPL_OK };

// ── Recipe: no price / line quantity; configuration quantities kept ──────────────────────────────────────────
test("a built recipe contains no price, total, exchange rate, cost or line quantity key", () => {
  const { recipe, specOverrides } = buildRecipe({
    ...baseState,
    variantRowId: "row-1",
    modularQuantities: { m1: 2 },
    pricingAccessoryQuantities: { a1: 1 },
    systemRowId: "sys-1",
    systemQuantity: 3,
    requiredOverrides: { k: { quantity: 2, trigger: "t" } },
    linkedSelections: { "l:1": { variantRowId: "v", quantity: 2, accessoryQuantities: { x: 1 } } },
  });
  assert.equal(findForbiddenRecipeKey(recipe), null);
  assert.equal(findForbiddenRecipeKey(specOverrides), null);
  assert.deepEqual(validateRecipeShape(recipe, specOverrides), { ok: true });
  assert.ok(!("quantity" in recipe) && !("qty" in recipe.selections) && !("quantity" in recipe.selections));
});

test("the guard rejects price, unit_price, net_price, total, exchange rate, internal_cost, supplier cost and line quantity", () => {
  const { recipe } = buildRecipe({ ...baseState, variantRowId: "row-1" });
  for (const key of ["price", "unit_price", "net_price", "total", "exchange_rate", "exchangeRates", "internal_cost", "supplier_cost"]) {
    const dirty = { ...recipe, finishes: [{ [key]: 1 }] };
    assert.equal(validateRecipeShape(dirty).ok, false, `${key} must be rejected`);
    assert.equal(validateRecipeShape({ ...recipe, [key]: 1 }).ok, false, `${key} (top level) must be rejected`);
  }
  for (const key of ["qty", "quantity", "line_qty", "line_quantity"]) {
    assert.equal(validateRecipeShape({ ...recipe, [key]: 1 }).ok, false, `${key} (line level) must be rejected`);
    assert.equal(validateRecipeShape({ ...recipe, selections: { ...recipe.selections, [key]: 1 } }).ok, false);
  }
  // Configuration quantities are allowed where they belong.
  assert.equal(validateRecipeShape({ ...recipe, selections: { ...recipe.selections, required_overrides: { k: { quantity: 2, trigger: "t" } } } }).ok, true);
  assert.equal(validateRecipeShape({ ...recipe, template_id: "nope" }).ok, false);
  assert.equal(validateRecipeShape({ ...recipe, recipe_version: 2 }).ok, false);
  assert.equal(validateRecipeShape({ ...recipe, finishes: [{ blob: "x".repeat(70000) }] }).ok, false);
});

test("configuration quantities (modular, accessory, system, linked, required overrides) ARE kept; zero and empty entries are dropped", () => {
  const { recipe } = buildRecipe({
    ...baseState,
    modularQuantities: { m1: 2, m2: 0 },
    pricingAccessoryQuantities: { a1: 3 },
    componentAccessoryQuantities: { c1: 1 },
    systemRowId: "sys",
    systemQuantity: 4,
    skippedAccessoryGroupIds: ["g1", "g1"],
  });
  assert.deepEqual(recipe.selections.modular_quantities, { m1: 2 });
  assert.deepEqual(recipe.selections.pricing_accessory_quantities, { a1: 3 });
  assert.deepEqual(recipe.selections.component_accessory_quantities, { c1: 1 });
  assert.equal(recipe.selections.system_quantity, 4);
  assert.deepEqual(recipe.selections.skipped_accessory_group_ids, ["g1"]);
});

// ── Round trip per product type and accessory mode ───────────────────────────────────────────────────────────
const productTypes: Record<string, SavedSetupPlainState> = {
  "price matrix": { templateId: TPL_OK, categoryGroupId: "cg", categoryRowId: "cr", fabricCategory: "Cat 2" },
  "base/model": { templateId: TPL_OK, variantRowId: "variant-1", componentOptionSelections: { Armrest: "opt-1", Base: ["a", "b"] } },
  modular: { templateId: TPL_OK, categoryGroupId: "cg", fabricCategory: "Cat 1", modularQuantities: { s1: 1, i1: 2, t1: 1 } },
  workstation: { templateId: TPL_OK, workstationSizeId: "ws-1", workstationLayout: "Linear", additionalClusterQuantity: 2, dimensionOverride: "1200x600" },
  system: { templateId: TPL_OK, systemRowId: "sys-1", systemQuantity: 3, variantRowId: "variant-2" },
};

function normalizedForCompare(state: SavedSetupPlainState) {
  // buildRecipe drops empty/null values, so compare through a second build.
  return buildRecipe(state);
}

for (const [name, state] of Object.entries(productTypes)) {
  test(`round trip keeps the same selections: ${name}`, () => {
    const built = buildRecipe(state);
    const restored = restorePlainState(built.recipe, built.specOverrides);
    assert.deepEqual(normalizedForCompare(restored), built);
    assert.equal(restored.templateId, state.templateId);
  });
}

const accessoryModes: Record<string, Record<string, number>> = {
  exactly_one: { stirrup: 1 },
  at_least_one: { a: 1, b: 2 },
  choose_multiple: { a: 1, b: 1, c: 1 },
  unrestricted: {},
};
for (const [mode, quantities] of Object.entries(accessoryModes)) {
  test(`round trip keeps accessory picks: ${mode} (incl. required companion override)`, () => {
    const state: SavedSetupPlainState = {
      templateId: TPL_OK,
      variantRowId: "v",
      pricingAccessoryQuantities: quantities,
      requiredOverrides: { "kit:item": { quantity: 2, trigger: "[[],[]]" } },
      accessoryCategoryChoices: { [`${TPL_OK}:g:a`]: "cat-1" },
    };
    const built = buildRecipe(state);
    const restored = restorePlainState(built.recipe, built.specOverrides);
    assert.deepEqual(restored.pricingAccessoryQuantities, quantities);
    assert.deepEqual(normalizedForCompare(restored), built);
  });
}

// ── Edited specification ──────────────────────────────────────────────────────────────────────────────────────
test("edited specification: text and base hash are stored; the generated template text is not", () => {
  const generated = "Generated: chair with mesh back and 5-star base.";
  const edited = "My edited spec for the client.";
  const { recipe, specOverrides } = buildRecipe({ ...baseState, specificationEdited: true, editedSpecification: edited, generatedSpecification: generated });
  assert.equal(specOverrides.specification_edited, true);
  assert.equal(specOverrides.edited_specification, edited);
  assert.equal(specOverrides.generated_specification_hash, hashSpecificationText(generated));
  const serialized = JSON.stringify({ recipe, specOverrides });
  assert.ok(!serialized.includes(generated), "generated text must not be stored");
  const notEdited = buildRecipe({ ...baseState, specificationEdited: false, editedSpecification: edited, generatedSpecification: generated });
  assert.equal(notEdited.specOverrides.specification_edited, false);
  assert.equal(notEdited.specOverrides.edited_specification, null);
  assert.equal(hashSpecificationText("a  b"), hashSpecificationText(" a b "));
  assert.notEqual(hashSpecificationText("a b"), hashSpecificationText("a c"));
});

// ── isSetupUsable ───────────────────────────────────────────────────────────────────────────────────────────────
test("isSetupUsable: false for null template id, missing or inactive template; true only for an active template", () => {
  const active = { is_active: true, lifecycle_status: "active" };
  assert.equal(isSetupUsable({ template_id: null }, active), false);
  assert.equal(isSetupUsable({ template_id: TPL_OK }, null), false);
  assert.equal(isSetupUsable({ template_id: TPL_OK }, { is_active: false, lifecycle_status: "active" }), false);
  assert.equal(isSetupUsable({ template_id: TPL_OK }, { is_active: true, lifecycle_status: "archived" }), false);
  assert.equal(isSetupUsable({ template_id: TPL_OK }, { is_active: true, lifecycle_status: "discontinued" }), false);
  assert.equal(isSetupUsable({ template_id: TPL_OK }, active), true);
});

// ── Server-side guards (service used by the server actions) ────────────────────────────────────────────────────
test("saveSetup: owner comes from the session; a client-sent owner_id is ignored", async () => {
  const db = newDb();
  const hostile = { templateId: TPL_OK, setupName: "Mine", state: { ...baseState, variantRowId: "v" }, owner_id: USER_B, ownerId: USER_B } as any;
  const result = await saveSetupForUser(fake(db, USER_A), USER_A, hostile);
  assert.equal(result.ok, true);
  assert.equal(db.saved_setups.length, 1);
  assert.equal(db.saved_setups[0].owner_id, USER_A);
  assert.equal(db.saved_setups[0].brand_name, "Interstuhl");
  assert.equal(db.saved_setups[0].product_name, "Silver 262S");
  assert.equal(db.saved_setups[0].template_pricing_version_at_save, 7);
  // Even a hostile state cannot smuggle a different template id.
  const swapped = await saveSetupForUser(fake(db, USER_A), USER_A, { templateId: TPL_OK, setupName: "x", state: { templateId: TPL_ARCHIVED } });
  assert.equal(swapped.ok, true);
  assert.equal(db.saved_setups[1].recipe.template_id, TPL_OK);
});

test("saveSetup: refused when the caller cannot read the template, when it is inactive, or when the data is invalid", async () => {
  const db = newDb();
  const hiddenResult = await saveSetupForUser(fake(db, USER_A, { hiddenTemplates: [TPL_HIDDEN] }), USER_A, { templateId: TPL_HIDDEN, setupName: "n", state: { templateId: TPL_HIDDEN } });
  assert.equal(hiddenResult.ok, false);
  const archived = await saveSetupForUser(fake(db, USER_A), USER_A, { templateId: TPL_ARCHIVED, setupName: "n", state: { templateId: TPL_ARCHIVED } });
  assert.equal(archived.ok, false);
  const missing = await saveSetupForUser(fake(db, USER_A), USER_A, { templateId: "99999999-9999-4999-8999-999999999999", setupName: "n", state: baseState });
  assert.equal(missing.ok, false);
  assert.equal((await saveSetupForUser(fake(db, USER_A), USER_A, { templateId: TPL_OK, setupName: "   ", state: baseState })).ok, false);
  assert.equal((await saveSetupForUser(fake(db, USER_A), USER_A, { templateId: TPL_OK, setupName: "x".repeat(121), state: baseState })).ok, false);
  const tooBig = await saveSetupForUser(fake(db, USER_A), USER_A, { templateId: TPL_OK, setupName: "n", state: { ...baseState, finishes: [{ blob: "x".repeat(70000) }] } });
  assert.equal(tooBig.ok, false);
  assert.equal(db.saved_setups.length, 0);
});

test("rename and delete of another user's setup affect zero rows (with and without database RLS)", async () => {
  for (const rls of [true, false]) {
    const db = newDb();
    const saved = await saveSetupForUser(fake(db, USER_A, { rls }), USER_A, { templateId: TPL_OK, setupName: "A setup", state: baseState });
    assert.equal(saved.ok, true);
    const id = (saved as { id: string }).id;
    const renamed = await renameSetupForUser(fake(db, USER_B, { rls }), USER_B, id, "hijacked");
    assert.equal(renamed.ok, false);
    assert.equal(db.saved_setups[0].setup_name, "A setup");
    const deleted = await deleteSetupForUser(fake(db, USER_B, { rls }), USER_B, id);
    assert.equal(deleted.ok, false);
    assert.equal(db.saved_setups.length, 1);
    // The owner can.
    assert.equal((await renameSetupForUser(fake(db, USER_A, { rls }), USER_A, id, "  Renamed  ")).ok, true);
    assert.equal(db.saved_setups[0].setup_name, "Renamed");
    assert.equal((await deleteSetupForUser(fake(db, USER_A, { rls }), USER_A, id)).ok, true);
    assert.equal(db.saved_setups.length, 0);
  }
});

test("a non-owner cannot read another user's setups", async () => {
  for (const rls of [true, false]) {
    const db = newDb();
    await saveSetupForUser(fake(db, USER_A, { rls }), USER_A, { templateId: TPL_OK, setupName: "A", state: baseState });
    assert.equal((await listSetupsForUser(fake(db, USER_B, { rls }), USER_B)).length, 0);
    assert.equal((await listSetupsForUser(fake(db, USER_A, { rls }), USER_A)).length, 1);
  }
});

test("clearRemovedSetups deletes only the caller's own removed or unavailable setups", async () => {
  const db = newDb();
  const base = { brand_name: "Interstuhl", product_name: "P", note: null, recipe: {}, use_count: 0, archived: false, updated_at: "2026-01-01" };
  db.saved_setups.push(
    { ...base, id: "s-ok-a", owner_id: USER_A, template_id: TPL_OK, setup_name: "usable" },
    { ...base, id: "s-removed-a", owner_id: USER_A, template_id: null, setup_name: "template deleted" },
    { ...base, id: "s-archived-a", owner_id: USER_A, template_id: TPL_ARCHIVED, setup_name: "template archived" },
    { ...base, id: "s-removed-b", owner_id: USER_B, template_id: null, setup_name: "someone else's" },
  );
  const listed = await listSetupsForUser(fake(db, USER_A, { rls: false }), USER_A);
  assert.deepEqual(listed.map((item) => [item.id, item.usable, item.removed]).sort(), [["s-archived-a", false, false], ["s-ok-a", true, false], ["s-removed-a", false, true]]);
  for (const rls of [false]) {
    const result = await clearRemovedSetupsForUser(fake(db, USER_A, { rls }), USER_A);
    assert.deepEqual(result, { ok: true, count: 2 });
  }
  assert.deepEqual(db.saved_setups.map((row) => row.id).sort(), ["s-ok-a", "s-removed-b"]);
});

// ── Source-text guards: migration, actions, and the untouched Add path ─────────────────────────────────────────
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("migration: template delete is never blocked, own-only RLS, narrow grants, no existing table touched", () => {
  const sql = read("../../../supabase/migrations/20261112100000_saved_setups.sql");
  assert.match(sql, /template_id uuid references public\.product_templates\(id\) on delete set null/);
  assert.ok(!/on delete (restrict|no action)/i.test(sql));
  assert.match(sql, /revoke all on public\.saved_setups from public, anon, authenticated/);
  assert.match(sql, /grant update \(setup_name, note, recipe, spec_overrides, last_used_at, use_count, archived\)/);
  assert.equal((sql.match(/current_user_is_active\(\)/g) ?? []).length >= 3, true);
  assert.ok(!/alter table public\.(?!saved_setups)/i.test(sql), "must not alter any other table");
  assert.ok(!/(update|delete from|insert into) public\.(?!saved_setups)/i.test(sql));
});

test("server actions authenticate with requireActiveUser, use the caller's client, never an admin client, never read owner from input", () => {
  const actions = read("./actions.ts");
  assert.ok(actions.startsWith('"use server"'));
  assert.equal((actions.match(/await requireActiveUser\(\)/g) ?? []).length, 4);
  assert.match(actions, /from "@\/lib\/supabase\/server"/);
  assert.ok(!/service[_-]?role|admin/i.test(actions));
  assert.ok(!/owner/i.test(actions.replace(/owner-only|\(never from client input\)|owner from/gi, "")), "actions must not read an owner from input");
  assert.equal((actions.match(/revalidatePath\(MY_COLLECTION_PATH\)/g) ?? []).length, 4);
  const service = read("./saved-setups-service.ts");
  assert.ok(!/service[_-]?role|createAdmin/i.test(service));
});

test("the existing Add path is untouched: Add / Add to Local Workspace unchanged and the saved state never enters the line", () => {
  const source = read("../../../components/quotations/product-library-selector.tsx");
  assert.ok(source.includes("onAddLocalItem?.(localProductItem);"));
  assert.ok(source.includes("action={addProductTemplateToQuotation}"));
  assert.ok(source.includes("                                  Add to Local Workspace"));
  const lineStart = source.indexOf("const localProductItem: LocalQuotationItem = {");
  const stateStart = source.indexOf("const savedSetupState: SavedSetupPlainState = {");
  assert.ok(lineStart > 0 && stateStart > lineStart, "saved state is declared after, and outside, the line object");
  assert.ok(!source.slice(lineStart, stateStart).includes("savedSetupState"));
  // The new button is a plain button and imports no quotation action.
  const button = read("../../../components/quotations/save-to-my-collection-button.tsx");
  assert.ok(!button.includes("@/app/quotations/actions"));
  assert.ok(!/type="submit"/.test(button));
  assert.match(button, /event\.preventDefault\(\)/);
});

// ── PR 1b-1: default name, display block, pictures ─────────────────────────────────────────────────────────────
test("defaultSetupName: template name first, then the main code", () => {
  assert.equal(defaultSetupName({ mainCode: "159 913", templateName: "Jera Meeting" }), "Jera Meeting 159 913");
  assert.equal(defaultSetupName({ mainCode: "EV211", templateName: "Every" }), "Every EV211");
  assert.equal(defaultSetupName({ mainCode: "  EV211  ", templateName: " Every " }), "Every EV211");
  // Only one of them present, or neither.
  assert.equal(defaultSetupName({ mainCode: "", templateName: "Silver 262S" }), "Silver 262S");
  assert.equal(defaultSetupName({ mainCode: null, templateName: "Silver 262S" }), "Silver 262S");
  assert.equal(defaultSetupName({ templateName: "Silver 262S" }), "Silver 262S");
  assert.equal(defaultSetupName({ mainCode: "EV211", templateName: "  " }), "EV211");
  assert.equal(defaultSetupName({ mainCode: "159 913", templateName: null }), "159 913");
  assert.equal(defaultSetupName({ mainCode: "", templateName: "" }), "");
  assert.equal(defaultSetupName({}), "");
  // The code is not repeated when the template name already ends with it (case-insensitive).
  assert.equal(defaultSetupName({ mainCode: "EV211", templateName: "Every EV211" }), "Every EV211");
  assert.equal(defaultSetupName({ mainCode: "ev211", templateName: "Every EV211" }), "Every EV211");
  assert.equal(defaultSetupName({ mainCode: "159 913", templateName: "Jera Meeting 159 913" }), "Jera Meeting 159 913");
  // Extra spaces in the template name collapse; the code keeps its inner space unchanged.
  assert.equal(defaultSetupName({ mainCode: "159 913", templateName: "  Jera    Meeting  " }), "Jera Meeting 159 913");
  assert.equal(defaultSetupName({ mainCode: "159  913", templateName: "Jera" }), "Jera 159  913");
});

test("the main code is stored only as a display hint; the recipe stays price- and quantity-free; the guard also checks display", () => {
  const { recipe } = buildRecipe({ ...baseState, mainCode: " EV211 ", variantRowId: "v" });
  assert.deepEqual(recipe.display, { main_code: "EV211" });
  assert.equal(recipe.recipe_version, 1);
  assert.equal(findForbiddenRecipeKey(recipe), null);
  assert.equal(restorePlainState(recipe).mainCode, "EV211");
  assert.equal(buildRecipe({ ...baseState, mainCode: "" }).recipe.display, undefined);
  for (const key of ["price", "unit_price", "total", "exchange_rate", "internal_cost"]) {
    assert.equal(validateRecipeShape({ ...recipe, display: { main_code: "EV211", [key]: 1 } }).ok, false, `${key} inside display`);
  }
});

test("old saved rows without recipe.display (or without selected_image) still list, with the template picture", async () => {
  const db = newDb();
  db.product_templates[0].proposed_image_url_1 = "product-templates/silver/main.png";
  db.saved_setups.push({
    id: "old-1", owner_id: USER_A, template_id: TPL_OK, brand_name: "Interstuhl", product_name: "Silver 262S", setup_name: "Old",
    note: null, recipe: { recipe_version: 1, template_id: TPL_OK, selections: {} }, use_count: 0, archived: false, updated_at: "2026-01-01",
  });
  const [item] = await listSetupsForUser(fake(db, USER_A), USER_A);
  assert.equal(item.setupName, "Old");
  assert.equal(item.imagePath, "product-templates/silver/main.png");
  assert.equal(restorePlainState({ recipe_version: 1, template_id: TPL_OK, selections: {} } as never).mainCode, null);
});

test("picture: the selected image wins while the template still has it, else the template's main picture, else placeholder", async () => {
  const db = newDb();
  Object.assign(db.product_templates[0], { default_image_url: "product-templates/d.png", proposed_image_url_1: "product-templates/1.png", proposed_image_url_2: "product-templates/2.png" });
  const base = { brand_name: "B", product_name: "P", note: null, use_count: 0, archived: false, updated_at: "2026-01-01" };
  db.saved_setups.push(
    { ...base, id: "s-selected", owner_id: USER_A, template_id: TPL_OK, setup_name: "a", recipe: { selected_image: "product-templates/2.png" } },
    { ...base, id: "s-gone", owner_id: USER_A, template_id: TPL_OK, setup_name: "b", recipe: { selected_image: "product-templates/removed.png" } },
    { ...base, id: "s-none", owner_id: USER_A, template_id: TPL_OK, setup_name: "c", recipe: {} },
    { ...base, id: "s-noimage-template", owner_id: USER_A, template_id: TPL_ARCHIVED, setup_name: "d", recipe: { selected_image: "product-templates/2.png" } },
    { ...base, id: "s-deleted", owner_id: USER_A, template_id: null, setup_name: "e", recipe: { selected_image: "product-templates/2.png" } },
    { ...base, id: "s-hidden", owner_id: USER_A, template_id: TPL_HIDDEN, setup_name: "f", recipe: { selected_image: "product-templates/2.png" } },
  );
  const items = await listSetupsForUser(fake(db, USER_A, { hiddenTemplates: [TPL_HIDDEN] }), USER_A);
  const path = (id: string) => items.find((item) => item.id === id)?.imagePath;
  assert.equal(path("s-selected"), "product-templates/2.png");
  assert.equal(path("s-gone"), "product-templates/1.png");
  assert.equal(path("s-none"), "product-templates/1.png");
  assert.equal(path("s-noimage-template"), null);
  assert.equal(path("s-deleted"), null, "removed template => placeholder");
  assert.equal(path("s-hidden"), null, "template the caller cannot read => placeholder");
});

test("the picture lookup is ONE batched template query for many setups", async () => {
  const db = newDb();
  const base = { brand_name: "B", product_name: "P", note: null, use_count: 0, archived: false, updated_at: "2026-01-01", recipe: {} };
  for (let index = 0; index < 8; index += 1) {
    db.saved_setups.push({ ...base, id: `s${index}`, owner_id: USER_A, template_id: index % 2 ? TPL_OK : TPL_ARCHIVED, setup_name: `n${index}` });
  }
  const counter: Record<string, number> = {};
  await listSetupsForUser(fake(db, USER_A, { counter }), USER_A);
  assert.equal(counter.product_templates, 1);
  assert.equal(counter.saved_setups, 1);
  // Clear-removed does not need pictures at all.
  const counter2: Record<string, number> = {};
  await clearRemovedSetupsForUser(fake(db, USER_A, { counter: counter2 }), USER_A);
  assert.equal(counter2.product_templates ?? 0, 0);
});

test("pictures never use an elevated client, and the thumbnail reuses the existing image helper (no new storage layer)", () => {
  const service = read("./saved-setups-service.ts");
  assert.ok(!/service[_-]?role|createAdmin|storage/i.test(service));
  const list = read("../../../components/products/my-collection-list.tsx");
  assert.match(list, /resolveQuotationImageUrl/);
  assert.match(list, /loading="lazy"/);
  assert.ok(!/createSignedUrl|supabase/i.test(list));
});

test("PR 1b-1 leaves the Add / Add to Local Workspace code paths unchanged in the selector", () => {
  const source = read("../../../components/quotations/product-library-selector.tsx");
  assert.ok(source.includes("onAddLocalItem?.(localProductItem);"));
  assert.ok(source.includes("action={addProductTemplateToQuotation}"));
  assert.ok(source.includes("                                  Add to Local Workspace"));
  const lineStart = source.indexOf("const localProductItem: LocalQuotationItem = {");
  const stateStart = source.indexOf("const savedSetupState: SavedSetupPlainState = {");
  assert.ok(!source.slice(lineStart, stateStart).includes("mainCode"), "mainCode must not enter the quotation line");
});
