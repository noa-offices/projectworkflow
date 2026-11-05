import assert from "node:assert/strict";
import { test, mock } from "node:test";

let guard = 0;
let error: { message: string } | null = null;
const calls: { name: string; args: unknown }[] = [];
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });
mock.module("next/navigation", { namedExports: { redirect: (path: string) => { throw new Error(path); } } });
mock.module("@/lib/auth", { namedExports: { requireCommissionViewer: async () => { guard++; } } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({ rpc: async (name: string,args: unknown) => {
  calls.push({name,args}); return {error};
} }) } });
const { changeCommissionAdjustment } = await import("./adjustment-actions");
test("actions authenticate and send only workflow inputs to guarded RPCs; RPC errors are visible", async () => {
  const form = new FormData();
  form.set("commission_id","00000000-0000-4000-8000-000000000001");
  form.set("adjustment_id","adjustment"); form.set("target_status","approved");
  form.set("adjustment_amount","999999");
  await assert.rejects(changeCommissionAdjustment(form),/success=/);
  assert.equal(guard,1);
  assert.deepEqual(calls.pop(),{name:"transition_sales_commission_adjustment",args:{p_adjustment_id:"adjustment",p_target_status:"approved",p_reason:null}});
  error = {message:"Maker-checker control"};
  await assert.rejects(changeCommissionAdjustment(form),/error=Maker-checker/);
  error = null; form.set("variation_id","variation");
  await assert.rejects(changeCommissionAdjustment(form),/success=/);
  assert.deepEqual(calls.pop(),{name:"generate_sales_commission_adjustment",args:{p_variation_id:"variation"}});
});
