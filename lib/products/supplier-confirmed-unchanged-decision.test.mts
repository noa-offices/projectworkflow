import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const read = (name: string) => readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
const review = await read("20261002082357_supplier_price_source_review");
const finishEvidence = await read("20261002124625_supplier_source_finish_evidence");
const migration = await read("20261004090000_supplier_confirmed_unchanged_decision");
const user = "00000000-0000-0000-0000-000000000001", brand = "00000000-0000-0000-0000-000000000002", template = "00000000-0000-0000-0000-000000000003";
const source = "00000000-0000-0000-0000-000000000004", batch = "00000000-0000-0000-0000-000000000005";

async function fixture(applyMigration = true) {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as 'select ''${user}''::uuid';
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(bucket_id text,name text); alter table storage.objects enable row level security;
    create table public.permissions(can_review boolean,can_approve boolean); insert into public.permissions values(true,true);
    create function public.current_user_can_review_brand_prices() returns boolean language sql as 'select can_review from public.permissions';
    create function public.current_user_can_approve_brand_prices() returns boolean language sql as 'select can_approve from public.permissions';
    create table public.profiles(id uuid primary key); insert into public.profiles values('${user}');
    create table public.brands(id uuid primary key); insert into public.brands values('${brand}');
    create table public.product_templates(id uuid primary key); insert into public.product_templates values('${template}');
    create table public.brand_price_list_updates(id uuid primary key);`);
  await db.exec(review); await db.exec(finishEvidence);
  if (applyMigration) await db.exec(migration);
  await db.exec(`
    insert into public.supplier_source_versions(id,brand_id,title,filename,file_hash,source_type,currency,basis,profile,status,expected_rows,expected_cells,expected_chunks,created_by)
      values('${source}','${brand}','Source','s.csv','${"a".repeat(64)}','csv','EUR','list','{}','imported',1,1,1,'${user}');
    insert into public.supplier_price_batches(id,brand_id,source_id,title,scope,status,expected_matches,expected_chunks,basis_warning,created_by)
      values('${batch}','${brand}','${source}','Batch','partial','review',3,1,'',${"'" + user + "'"});
    insert into public.supplier_template_review_units values('${batch}','${template}','Template',3,0,1,0,'READY');`);
  for (const [key, classification] of [["same", "unchanged"], ["up", "increased"], ["open", "unmatched"]]) {
    await db.query("insert into public.supplier_price_matches values($1,$2,$2,$3,null,$4,$5)", [batch, key, classification, [template], JSON.stringify({ key, classification, targets: classification === "unmatched" ? [] : [{ template_id: template }] })]);
  }
  return db;
}
const decide = (db: PGlite, key: string, decision: string) => db.query("select public.supplier_price_review_write('decision',$1) result", [JSON.stringify({ batch_id: batch, key, decision, note: "n", proposed_target_keys: [] })]);
const decisions = async (db: PGlite) => (await db.query<{ key: string; decision: string }>("select key,decision from public.supplier_price_decisions order by key")).rows;
const unitState = async (db: PGlite) => (await db.query<{ state: string }>("select state from public.supplier_template_review_units")).rows[0].state;

test("before the migration only the four original decisions exist", async () => {
  const db = await fixture(false);
  try {
    await assert.rejects(decide(db, "same", "confirmed_unchanged"), /decision_check/);
    await decide(db, "same", "reviewed"); assert.deepEqual(await decisions(db), [{ key: "same", decision: "reviewed" }]);
  } finally { await db.close(); }
});

test("confirmed_unchanged is stored only for unchanged matches by an approver; existing decisions still work", async () => {
  const db = await fixture();
  try {
    for (const [key, decision] of [["same", "reviewed"], ["up", "reviewed"], ["open", "skip"], ["open", "reject"], ["open", "mapping_proposed"]]) await decide(db, key, decision);
    assert.deepEqual(await decisions(db), [{ key: "open", decision: "mapping_proposed" }, { key: "same", decision: "reviewed" }, { key: "up", decision: "reviewed" }]);
    for (const key of ["up", "open"]) await assert.rejects(decide(db, key, "confirmed_unchanged"), /Only an unchanged match/);
    await assert.rejects(decide(db, "missing", "confirmed_unchanged"));
    await db.exec("update public.permissions set can_approve=false");
    await assert.rejects(decide(db, "same", "confirmed_unchanged"), /insufficient_privilege|permission denied/);
    await decide(db, "same", "skip"); // Reviewers keep the existing decisions.
    await db.exec("update public.permissions set can_approve=true");
    await decide(db, "same", "confirmed_unchanged"); await decide(db, "same", "confirmed_unchanged");
    assert.deepEqual((await decisions(db)).filter((row) => row.key === "same"), [{ key: "same", decision: "confirmed_unchanged" }]);
    await db.exec("update public.supplier_price_batches set status='matching'");
    await assert.rejects(decide(db, "same", "confirmed_unchanged"), /not ready for review/);
  } finally { await db.close(); }
});

test("review-unit resolved state counts confirmed_unchanged and the RPC security properties survive", async () => {
  const db = await fixture();
  try {
    await db.exec("update public.supplier_price_matches set template_ids='{}' where key='open'");
    await decide(db, "up", "skip"); assert.notEqual(await unitState(db), "REVIEWED");
    await decide(db, "same", "confirmed_unchanged"); assert.equal(await unitState(db), "REVIEWED");
    await decide(db, "same", "reviewed"); assert.equal(await unitState(db), "REVIEWED");
    const rpc = (await db.query<{ prosecdef: boolean; config: string[]; granted: boolean; publicGranted: boolean }>(`select prosecdef,proconfig as config,
      has_function_privilege('authenticated','public.supplier_price_review_write(text,jsonb)','execute') granted,
      has_function_privilege('anon','public.supplier_price_review_write(text,jsonb)','execute') "publicGranted"
      from pg_proc where proname='supplier_price_review_write'`)).rows;
    assert.equal(rpc.length, 1); assert.equal(rpc[0].prosecdef, true); assert.deepEqual(rpc[0].config, ['search_path=""']);
    assert.equal(rpc[0].granted, true); assert.equal(rpc[0].publicGranted, false);
    // Existing finish-evidence projection from the earlier forward migration is retained.
    assert.match((await db.query<{ def: string }>("select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) def")).rows[0].def, /array_remove\(finishes,''\)/);
  } finally { await db.close(); }
});
