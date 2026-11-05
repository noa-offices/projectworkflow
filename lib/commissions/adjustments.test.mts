import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { after, before, test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const path = "supabase/migrations/20261110100000_sales_commission_adjustments.sql";
test("D2 adds a separate signed ledger without replacing existing functions", () => {
  assert.ok(existsSync(path), "the D2 migration exists");
  const sql = readFileSync(path, "utf8");
  assert.doesNotMatch(sql, /final_amount_override/);
  assert.match(sql, /create table public.sales_commission_adjustments/);
  assert.doesNotMatch(sql, /create or replace|alter table public\.(sales_commissions|project_variations|sales_approval_snapshots)|\?/i);
  assert.doesNotMatch(sql, /(?:update|insert into|delete from) public\.(sales_commissions|project_variations|sales_approval_snapshots|project_snapshots|client_payment)/i);
});

const read = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const fixture = read("lib/quotations/project-snapshot.test.mts");
const schema = fixture.slice(fixture.indexOf("const schema = `") + 16, fixture.indexOf("`;\nbefore(async"));
const db = new PGlite();
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const owner = uid(1), checker = uid(2), sales = uid(3), viewer = uid(4), manager = uid(5), otherSales = uid(6);
let serial = 100;
async function asUser<T>(id: string, fn: () => Promise<T>) {
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${id}',false);`);
  try { return await fn(); } finally { await db.exec("reset role"); }
}
async function generate(variation: string, actor = owner) {
  return asUser(actor, async () => (await db.query<{ id: string | null }>("select public.generate_sales_commission_adjustment($1) id",[variation])).rows[0].id);
}
async function transition(id: string, status: string, actor = owner, reason: string | null = null) {
  return asUser(actor, () => db.query("select public.transition_sales_commission_adjustment($1,$2,$3)",[id,status,reason]));
}
async function adjustment(variation: string) {
  return (await db.query<Record<string, unknown>>("select * from public.sales_commission_adjustments where variation_id=$1",[variation])).rows[0];
}
let originalApply: string;
before(async () => {
  await db.exec(schema);
  await db.exec(`create table auth.users(id uuid primary key);
    create type public.account_status as enum ('pending','active','disabled');
    alter table public.profiles alter column account_status type public.account_status using account_status::public.account_status;
    alter table public.profiles add column full_name text, add column email text;
    alter table public.audit_activity_log add column parent_entity_type text, add column parent_entity_id uuid;
    create function public.current_account_status() returns text language sql stable security definer set search_path='' as $$ select account_status::text from public.profiles where id=auth.uid() $$;
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at:=now(); return new; end $$;
    create table public.notifications(id uuid default gen_random_uuid(),recipient_id uuid,sender_id uuid,body text,order_no text,sent_to_role text,requires_response boolean);
    insert into public.profiles(id,role,account_status) values
      ('${owner}','system_owner','active'),('${checker}','system_owner','active'),('${sales}','sales_designer','active'),
      ('${viewer}','viewer','active'),('${manager}','admin_manager','active'),('${otherSales}','sales_designer','active');
    insert into public.clients(id,company_name) values('${uid(8)}','Test');`);
  const approvalSQL = read("supabase/migrations/083_sales_approval_snapshots.sql");
  await db.exec(approvalSQL.slice(0,approvalSQL.indexOf("comment on table")));
  await db.exec(read("supabase/migrations/084_sales_commission_rules_ledger.sql"));
  // Match the live ledger schema; the historical migration includes an unused column.
  await db.exec("alter table public.sales_commissions drop column final_amount_override");
  await db.exec(read("supabase/migrations/085_commission_maker_checker_notifications.sql"));
  await db.exec(read("supabase/migrations/086_commission_sales_manager_follow_up.sql"));
  await db.exec(read("supabase/migrations/20261107100000_project_snapshots.sql"));
  await db.exec(read("supabase/migrations/20261108100000_project_variations.sql"));
  originalApply = (await db.query<{ def: string }>("select pg_get_functiondef('public.apply_project_variation(uuid)'::regprocedure) def")).rows[0].def;
  await db.exec(read(path));
  assert.equal((await db.query("select * from public.sales_commission_adjustments")).rows.length,0,"migration does not backfill");
});
after(async () => { await db.close(); });

type Scenario = { formula?: string; basis?: string; total?: number; vat?: number | null; legacy?: boolean; parent?: boolean; override?: boolean; status?: string };
async function project(options: Scenario = {}) {
  const qid = uid(serial++), orderNo = `CO-${serial}`, approval = uid(serial++);
  const total = options.total ?? 1050, vat = options.vat === undefined ? 50 : options.vat;
  const file = { orderNo,quotationId:qid,quotationNo:`Q-${serial}`,clientId:uid(8),clientName:"Test",reference:"Office",total,currency:"AED",createdAt:"2026-11-05",createdBy:owner };
  await db.query("insert into public.quotations(id,client_id,quotation_no,title,grand_total,vat_amount,layout_settings) values($1,$2,$3,'Test',$4,$5,$6)",[qid,uid(8),file.quotationNo,total,vat ?? 0,JSON.stringify({projectFile:file,pricing_rule:options.legacy ? "round_up_5_legacy" : "whole_aed_v1"})]);
  // Backfill fixture avoids conflating original scope arithmetic with the D2 base tests.
  const snap = (await db.query<{ r: { id: string } }>("select public.project_snapshot_copy($1,'backfilled_from_live_quotation') r",[qid])).rows[0].r.id;
  if (options.parent !== false) {
    await db.query("insert into public.sales_approval_snapshots(id,quotation_id,quotation_folder_key,approved_salesperson_id,source_type,source_total,currency,vat_amount,amount_excluding_vat,qualified_at) values($1,$2,$3,$4,'direct_project_file',$5,'AED',$6,$7,now())",[approval,qid,orderNo,sales,total,vat,vat === null ? null : total-vat]);
    // The real original generator creates the parent. Seed its copied rule for each isolated case.
    const rule = uid(serial++);
    await db.query("insert into public.sales_commission_rules(id,salesperson_id,formula_type,basis_type,percentage_rate,effective_from,effective_to,is_enabled,created_by) values($1,$2,'percentage','approved_total_excluding_vat',10,$3,$4,false,$5)",[rule,sales,new Date(Date.UTC(2000,0,serial)).toISOString(),new Date(Date.UTC(2000,0,serial+1)).toISOString(),owner]);
    await db.query(`update public.sales_commissions set rule_id=$2,status=$3,review_reason=null,formula_type_snapshot=$4,basis_type_snapshot=$5,
      percentage_rate_snapshot=case when $4='percentage' then 10 else null end,
      fixed_amount_snapshot=case when $4='fixed_amount' then 200 else null end,fixed_amount_currency_snapshot='AED',
      tier_method_snapshot='slab',tier_configuration_snapshot='[{"minimum":"0","maximum":"2000","rate":"10"},{"minimum":"2000","maximum":null,"rate":"20"}]',
      final_commission_amount=100,original_calculated_amount=100,override_reason=$6 where approval_snapshot_id=$1`,
      [approval,rule,options.status ?? "draft",options.formula ?? "percentage",options.basis ?? "approved_total_excluding_vat",options.override ? "Manual override" : null]);
  }
  return { qid,snap,orderNo,legacy:options.legacy ?? false,total };
}
async function variation(p: Awaited<ReturnType<typeof project>>, total: number, vat: number, no = 1) {
  const id = uid(serial++), qid = uid(serial++);
  await db.query("insert into public.quotations(id,client_id,quotation_no,title) values($1,$2,$3,'Variation')",[qid,uid(8),`V-${serial}`]);
  await db.query(`insert into public.project_variations(id,snapshot_id,order_no,variation_no,variation_quotation_id,variation_quotation_no,base_revision_no,
    pricing_rule,currency,vat_percent,subtotal,discount_total,overall_discount_value,vat_amount,grand_total,previous_contract_total,new_contract_total,contract_delta,change_summary,layout_settings,quotation_data,applied_by)
    values($1,$2,$3,$4,$5,$6,0,$7,'AED',5,$8,0,0,$9,$10,$11,$10,$10::numeric-$11::numeric,'{}','{}','{}',$12)`,
    [id,p.snap,p.orderNo,no,qid,`V-${serial}`,p.legacy ? "round_up_5_legacy" : "whole_aed_v1",total-vat,vat,total,p.total,owner]);
  return id;
}

test("flat %, tier crossing, fixed fee, VAT bases, legacy and exact rounding, signed credit", async () => {
  const cases = [
    { options:{}, total:1575,vat:75,previous:1000,next:1500,amount:50 },
    { options:{formula:"tiered_percentage"},total:2625,vat:125,previous:1000,next:2500,amount:400 },
    { options:{basis:"approved_total_including_vat"},total:1575,vat:75,previous:1050,next:1575,amount:52.5 },
    { options:{legacy:true,total:1470,vat:69.95},total:1580,vat:75.1,previous:1400.05,next:1504.9,amount:10.48 },
    { options:{total:1468.95,vat:69.95},total:1577.1,vat:75.1,previous:1399,next:1502,amount:10.3 },
    { options:{status:"paid"},total:525,vat:25,previous:1000,next:500,amount:-50 },
  ];
  for (const c of cases) {
    const p = await project(c.options), v = await variation(p,c.total,c.vat), a = await adjustment(v);
    assert.ok(a,JSON.stringify(c)); assert.equal(a.status,"draft");
    assert.equal(Number(a.previous_base),c.previous); assert.equal(Number(a.new_base),c.next);
    assert.equal(Number(a.adjustment_amount),c.amount);
    assert.equal(Math.round((Number(a.new_entitlement)-Number(a.previous_entitlement))*100)/100,c.amount);
    assert.equal(await generate(v),a.id,"idempotent second call");
    await assert.rejects(db.query("insert into public.sales_commission_adjustments(commission_id,variation_id,variation_no,currency,status,review_reason) select commission_id,variation_id,variation_no,currency,'requires_review','test' from public.sales_commission_adjustments where id=$1",[a.id]),/sales_commission_adjustments_variation_id_key/);
  }
  for (const options of [{formula:"fixed_amount"},{formula:"none"},{}]) {
    const p = await project(options), v = await variation(p,options.formula ? 2000 : 1050,options.formula ? 100 : 50);
    assert.equal(await adjustment(v),undefined); assert.equal(await generate(v),null);
    assert.ok((await db.query("select 1 from public.audit_activity_log where entity_id=$1 and action='commission_adjustment_zero'",[v])).rows.length);
  }
});

test("V2 uses V1 scope, not original; review missing VAT/parent, manual overrides and inactive parents", async () => {
  const p = await project(); await variation(p,1575,75);
  const v2 = await variation(p,2100,100,2), a = await adjustment(v2);
  assert.equal(Number(a.previous_base),1500); assert.equal(Number(a.adjustment_amount),50);
  for (const options of [{vat:null},{override:true},{status:"cancelled"},{status:"reversed"},{status:"requires_review"}]) {
    const p = await project(options), v = await variation(p,1575,75), a = await adjustment(v);
    assert.equal(a.status,"requires_review"); assert.ok(a.review_reason); assert.equal(a.adjustment_amount,null);
    assert.equal(await generate(v),a.id,"only review rows are recalculated in place");
  }
  const absent = await project({parent:false}), v = await variation(absent,1575,75);
  assert.equal(await adjustment(v),undefined);
  assert.ok((await db.query("select 1 from public.audit_activity_log where entity_id=$1 and action='commission_adjustment_parent_missing'",[v])).rows.length);
});

test("closed RLS, no direct writes, guarded generation, maker-checker and immutable approved/paid amounts", async () => {
  const p = await project(), v = await variation(p,1575,75), a = await adjustment(v), id = a.id as string;
  for (const actor of [viewer,otherSales]) {
    assert.equal(await asUser(actor,async () => (await db.query("select * from public.sales_commission_adjustments")).rows.length),0);
    await assert.rejects(generate(v,actor),/Only the System Owner/);
    await assert.rejects(transition(id,"pending_approval",actor),/permission|own/);
  }
  await asUser(sales,async () => {
    assert.ok((await db.query("select * from public.sales_commission_adjustments")).rows.length);
    await assert.rejects(db.query("update public.sales_commission_adjustments set adjustment_amount=1 where id=$1",[id]),/permission denied/);
  });
  await db.exec("set role anon");
  try {
    await assert.rejects(db.query("select * from public.sales_commission_adjustments"),/permission denied/);
    await assert.rejects(db.query("select public.generate_sales_commission_adjustment($1)",[v]),/permission denied/);
  } finally { await db.exec("reset role"); }
  await transition(id,"pending_approval");
  await assert.rejects(transition(id,"approved"),/Maker-checker/);
  await assert.rejects(transition(id,"approved",manager),/Only the System Owner/);
  await assert.rejects(transition(id,"draft",checker),/reason/);
  await transition(id,"draft",checker,"Check scope");
  await transition(id,"pending_approval",sales);
  await transition(id,"approved",checker);
  await assert.rejects(db.query("update public.sales_commission_adjustments set adjustment_amount=2,new_entitlement=102 where id=$1",[id]),/financial values/);
  assert.equal(await generate(v),id);
  await transition(id,"paid",checker);
  await assert.rejects(db.query("update public.sales_commission_adjustments set new_base=123 where id=$1",[id]),/financial values/);
  await assert.rejects(transition(id,"reversed",checker),/reason/);
  await transition(id,"reversed",checker,"Recover credit");
  await assert.rejects(db.query("delete from public.sales_commission_adjustments where id=$1",[id]),/history/);
  assert.equal((await db.query<{ def:string }>("select pg_get_functiondef('public.apply_project_variation(uuid)'::regprocedure) def")).rows[0].def,originalApply);
});

test("approved negative credit preserves paid parent; review recalculation keeps identity and financial editor controls", async () => {
  const p = await project({status:"paid"});
  const original = (await db.query("select to_jsonb(c) data from public.sales_commissions c where quotation_id=$1",[p.qid])).rows;
  const v = await variation(p,525,25), a = await adjustment(v);
  await transition(a.id as string,"pending_approval",owner);
  await transition(a.id as string,"approved",checker);
  assert.equal(Number((await adjustment(v)).adjustment_amount),-50);
  assert.deepEqual((await db.query("select to_jsonb(c) data from public.sales_commissions c where quotation_id=$1",[p.qid])).rows,original);

  const review = await project({override:true}), rv = await variation(review,1575,75), initial = await adjustment(rv);
  // Fixture resolves the original's review issue through the same state an existing edit RPC would leave.
  await db.query("update public.sales_commissions set override_reason=null where quotation_id=$1",[review.qid]);
  assert.equal(await generate(rv),initial.id);
  const resolved = await adjustment(rv);
  assert.equal(resolved.status,"draft"); assert.equal(resolved.recalculated_by,owner);
  await assert.rejects(transition(resolved.id as string,"pending_approval",owner),/last financial editor/);
  await transition(resolved.id as string,"pending_approval",sales);
  await transition(resolved.id as string,"approved",checker);
  await assert.rejects(db.query("update public.sales_commission_adjustments set status='requires_review' where id=$1",[resolved.id]),/transition is not allowed/);
});

test("real apply creates draft; failed generation is audited without blocking apply", async () => {
  async function applyScope(fail: boolean) {
    const p = await project(), qid = uid(serial++), section = uid(serial++), item = uid(serial++);
    await db.query("insert into public.quotations(id,client_id,quotation_no,title,grand_total,vat_amount,subtotal,layout_settings) values($1,$2,$3,'Variation',1575,75,1500,$4)",
      [qid,uid(8),`Q-${serial}`,JSON.stringify({pricing_rule:"whole_aed_v1",variationOf:{orderNo:p.orderNo,projectQuotationId:p.qid,snapshotId:p.snap,variationNo:1,baseRevisionNo:0}})]);
    await db.query("insert into public.quotation_sections(id,quotation_id,section_title) values($1,$2,'Main')",[section,qid]);
    await db.query("insert into public.quotation_items(id,quotation_id,section_id,item_code_snapshot,item_name_snapshot,qty,unit_price,net_price,net_total) values($1,$2,$3,'A','Chair',1,1500,1500,1500)",[item,qid,section]);
    if (fail) await db.exec(`create function public.test_fail_adjustment() returns trigger language plpgsql as $$ begin raise exception 'Injected failure'; end $$;
      create trigger test_fail before insert on public.sales_commission_adjustments for each row execute function public.test_fail_adjustment();`);
    try {
      const result = await asUser(owner,async () => (await db.query<{r:{id:string}}>("select public.apply_project_variation($1) r",[qid])).rows[0].r);
      assert.ok((await db.query("select 1 from public.project_variations where id=$1",[result.id])).rows.length);
      assert.equal((await adjustment(result.id))?.status,fail ? undefined : "draft");
      if (fail) assert.ok((await db.query("select 1 from public.audit_activity_log where entity_id=$1 and action='commission_adjustment_generation_failed'",[result.id])).rows.length);
    } finally { if (fail) await db.exec("drop trigger test_fail on public.sales_commission_adjustments; drop function public.test_fail_adjustment()"); }
  }
  await applyScope(false); await applyScope(true);
});
