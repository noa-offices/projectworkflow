import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supplierRemoveBinding } from "./supplier-price-repository";

const rpcClient = (result: { data: unknown; error: { message: string } | null }) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  return { calls, client: { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return result; } } as unknown as SupabaseClient };
};

test("the repository wrapper sends one binding_remove write scoped by Brand and mapping id", async () => {
  const { calls, client } = rpcClient({ data: { id: "binding-1" }, error: null });
  assert.deepEqual(await supplierRemoveBinding(client, "brand-1", "binding-1"), { id: "binding-1" });
  assert.deepEqual(calls, [{ name: "supplier_price_review_write", args: { p_operation: "binding_remove", p_payload: { id: "binding-1", brand_id: "brand-1" } } }]);
});

test("a database refusal (role, wrong Brand, missing mapping) reaches the caller unchanged", async () => {
  const { client } = rpcClient({ data: null, error: { message: "Supplier mapping unavailable for this Brand" } });
  await assert.rejects(() => supplierRemoveBinding(client, "brand-1", "binding-1"), /unavailable for this Brand/);
});

test("the server action uses the approver guard and has no UI or other writes", () => {
  const actions = readFileSync("app/products/price-updates/supplier-sources/actions.ts", "utf8");
  const body = actions.match(/export async function removeSupplierBinding[\s\S]*?\n\}/)?.[0] ?? "";
  assert.match(body, /await approver\(\)/);
  assert.match(body, /supplierRemoveBinding\(client, brandId, bindingId\)/);
  assert.doesNotMatch(body, /supplierWrite|\.from\(|\.delete\(/);
  for (const file of ["components/quotations/supplier-price-lines-popup.tsx", "components/products/supplier-price-workspace-controls.tsx"]) assert.doesNotMatch(readFileSync(file, "utf8"), /removeSupplierBinding/, `no button yet in ${file}`);
});

test("the migration adds one guarded operation: role check, Brand-scoped delete, audit, nothing else", () => {
  const sql = readFileSync("supabase/migrations/20261031100000_supplier_binding_remove.sql", "utf8");
  assert.match(sql, /position\('binding_remove' in definition\)>0/);
  assert.match(sql, /<>1 then\s*raise exception 'Deployed supplier review RPC differs/);
  assert.match(sql, /elsif p_operation='binding_remove' then\s*if not public\.current_user_can_approve_brand_prices\(\) then raise insufficient_privilege/);
  assert.match(sql, /delete from public\.supplier_price_bindings where id=\(p_payload->>'id'\)::uuid and brand_id=\(p_payload->>'brand_id'\)::uuid/);
  assert.match(sql, /insert into public\.audit_activity_log[\s\S]*'supplier_binding_removed'[\s\S]*jsonb_build_object\('binding',existing\)/);
  assert.equal((sql.match(/delete from/g) ?? []).length, 1);
  assert.doesNotMatch(sql, /alter table|drop |create table|create policy|grant /i);
});

test("the rollback TEST file contains the exact migration body and the exact assertions", () => {
  const migration = readFileSync("supabase/migrations/20261031100000_supplier_binding_remove.sql", "utf8").replace(/^begin;\s*/i, "").replace(/commit;\s*$/i, "").trim();
  const contract = readFileSync("supabase/tests/supplier_binding_remove.sql", "utf8");
  const combined = readFileSync("supabase/tests/supplier_binding_remove_TEST.sql", "utf8");
  assert.ok(combined.includes(migration), "TEST contains the exact migration body");
  assert.ok(combined.includes(contract.slice(contract.search(/\bbegin;\s*/i)).replace(/^begin;\s*/i, "").replace(/select 'PASS[\s\S]*$/, "").trim()), "TEST contains the exact assertions");
  assert.match(combined, /rollback;\s*select 'PASS: /);
  assert.doesNotMatch(combined, /\bcommit;/i);
});
