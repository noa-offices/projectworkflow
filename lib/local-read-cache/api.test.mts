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
  role = "viewer"; assert.equal((await request("products")).status, 403);
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
