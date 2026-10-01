import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readProjection } from "./server";
type RecordRow = Record<string, unknown>;
let user: { id: string } | null = { id: "user-a" };
let role = "designer";
let active = "active";
let failing = "";
const selections: Array<{ table: string; fields: string }> = [];
const tables: Record<string, RecordRow[]> = {};
class Query {
  constructor(private table: string) {}
  select(fields: string) { selections.push({ table: this.table, fields }); return this; }
  eq() { return this; } in() { return this; } or() { return this; } order() { return this; } limit() { return this; }
  single() { return Promise.resolve({ data: this.table === "profiles" ? { role, account_status: active } : tables[this.table]?.[0], error: this.table === failing ? { message: "Unavailable" } : null }); }
  then(resolve: (value: { data: RecordRow[]; error: { message: string } | null }) => unknown, reject: (error: unknown) => unknown) {
    return Promise.resolve({ data: tables[this.table] ?? [], error: this.table === failing ? { message: "Unavailable" } : null }).then(resolve, reject);
  }
}
const createDb = async () => ({
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: (table: string) => new Query(table),
  }) as unknown as SupabaseClient;
beforeEach(() => {
  user = { id: "user-a" }; role = "designer"; active = "active"; failing = ""; selections.length = 0;
  for (const key of Object.keys(tables)) delete tables[key];
});
async function request(entity: string) { return readProjection(new Request("http://localhost/api/local-read-cache/" + entity), entity, createDb); }
test("unauthorized/inactive reads rejected with no-store response", async () => {
  user = null; assert.equal((await request("clients")).status, 401);
  user = { id: "user-a" }; active = "disabled"; assert.equal((await request("clients")).status, 403);
});
test("role restrictions checked for Product Library", async () => {
  role = "viewer";
  for (const entity of ["products", "products:management", "brands:list", "materials:library"]) assert.equal((await request(entity)).status, 403);
});
test("Management API selects only list metadata, preserves lifecycle and uses fixed batches", async () => {
  tables.product_templates = [{ id: "p1", template_name: "Chair", template_code: "TP1", item_code: "CH1",
    brand_id: "b1", main_category_id: "cat1", is_active: true, lifecycle_status: "discontinued",
    variant_pricing: { secret: true }, matrix_configuration: "secret", source_qa: "secret", supplier_cost: "secret", editor_state: "secret" }];
  tables.brands = [{ id: "b1", name: "Brand", is_active: true }];
  tables.product_categories = [{ id: "cat1", name: "Seating" }];
  const response = await request("products:management");
  assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data[0].title, "Chair"); assert.equal(data[0].status, "discontinued"); assert.equal(data[0].archived, true);
  assert.equal(data[0].brand, "Brand"); assert.equal(data[0].category, "Seating");
  assert.ok(!JSON.stringify(data).includes("secret")); assert.equal(selections.length, 4);
  assert.equal(selections.find(s => s.table === "product_templates")?.fields,
    "id,template_name,template_code,item_code,brand_id,main_category_id,sub_category_id,default_image_url,is_active,lifecycle_status");
});
test("Brands API preserves origin and category counts without documents or pricing", async () => {
  tables.brands = [{ id: "b1", name: "Brand", code: "BR", origin: "Italy", is_active: true, price_list_file: "secret", audit_history: "secret" }];
  tables.product_categories = [{ id: "c1", brand_id: "b1", parent_id: null, is_active: true },
    { id: "c2", brand_id: "b1", parent_id: "c1", is_active: true }];
  const response = await request("brands:list"); assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data[0].subtitle, "Origin: Italy"); assert.equal(data[0].status, "Active");
  assert.equal(data[0].category, "1 categories · 1 subcategories");
  assert.ok(!JSON.stringify(data).includes("secret")); assert.equal(selections.length, 3);
  assert.equal(selections.find(s => s.table === "brands")?.fields, "id,name,code,origin,is_active");
});
test("Materials API returns grouped names/codes and swatch references only, with fixed batches", async () => {
  tables.brands = [{ id: "b1", name: "Brand", is_active: true }];
  tables.brand_material_groups = [{ id: "g1", brand_id: "b1", group_name: "Upholstery", sort_order: 1, is_active: true }];
  tables.brand_materials = [{ id: "m1", brand_id: "b1", material_group_id: "g1", material_name: "Blue",
    material_code: "BL", material_category: "Grade 2", material_collection: "Wool", image_url: "https://example.test/swatch.jpg",
    sort_order: 1, is_active: true, source_payload: "secret", pricing: "secret", template_assignments: "secret", edit_form: "secret" }];
  const response = await request("materials:library"); assert.equal(response.status, 200);
  const data = (await response.json()).data;
  assert.equal(data[0].group, "Upholstery"); assert.equal(data[0].title, "Blue"); assert.equal(data[0].code, "BL");
  assert.equal(data[0].category, "Grade 2 / Wool"); assert.equal(data[0].thumbnail, "https://example.test/swatch.jpg");
  assert.ok(!JSON.stringify(data).includes("secret")); assert.equal(selections.length, 4);
});
test("all extension source failures reject rather than overwrite cache with empty data", async () => {
  tables.brands = [{ id: "b1", name: "Brand", is_active: true }];
  for (const [entity, table] of [["products:management", "product_templates"], ["brands:list", "product_categories"], ["materials:library", "brand_materials"]]) {
    failing = table; assert.equal((await request(entity)).status, 503);
  }
});
test("extension authoritative empty results are explicitly successful empty projections", async () => {
  for (const entity of ["products:management", "brands:list", "materials:library"]) {
    const response = await request(entity); assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).data, []);
  }
});
test("Client directory API excludes sensitive fields and uses ordinary session client", async () => {
  tables.clients = [{ id: "c1", company_name: "Company", client_number: "CL-1", is_active: true, email: "secret", phone: "secret", notes: "secret" }];
  const response = await request("clients"); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.userId, "user-a"); assert.equal(body.data[0].title, "Company");
  assert.ok(!JSON.stringify(body).includes("secret")); assert.match(response.headers.get("Cache-Control") ?? "", /no-store/);
  assert.equal(selections.find(s => s.table === "clients")?.fields, "id,company_name,client_number,client_code,is_active");
});
test("Product API persists only browse metadata and uses fixed-count batches", async () => {
  tables.product_templates = [{ id: "p1", template_name: "Chair", item_code: "CH-1", brand_id: "b1", main_category_id: "cat1", is_active: true, description: "Display", variant_pricing: { secret: true }, internal_cost: 500 }];
  tables.brands = [{ id: "b1", name: "Brand" }]; tables.product_categories = [{ id: "cat1", name: "Seating" }];
  const response = await request("products"); assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.data[0].brand, "Brand"); assert.equal(body.data[0].category, "Seating");
  assert.ok(!JSON.stringify(body).includes("secret")); assert.ok(!JSON.stringify(body).includes("internal_cost"));
  assert.equal(selections.length, 4);
});
test("failed source read is an error, never successful empty data", async () => {
  failing = "clients"; const response = await request("clients");
  assert.equal(response.status, 503); assert.equal((await response.json()).ok, false);
});
test("successful empty source read is explicitly successful empty snapshot", async () => {
  const response = await request("clients"); assert.equal(response.status, 200); assert.deepEqual((await response.json()).data, []);
});
test("read APIs never return full layout_settings/items or admin-client results", async () => {
  tables.quotations = [];
  const response = await request("quotations"); assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).data, []);
  const selected = selections.find(s => s.table === "quotations")?.fields ?? "";
  assert.ok(!selected.split(",").includes("layout_settings")); assert.ok(!selected.includes("quotation_items"));
});
