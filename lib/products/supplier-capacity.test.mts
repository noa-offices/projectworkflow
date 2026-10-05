import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { normalizeSupplierRows } from "./supplier-price-import.js";
import type { RawSupplierRow, SupplierProfile } from "./supplier-price-contracts.js";

const read = (name: string) => readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
const migrations = await Promise.all(["20261002060146_pricing_identity_version_foundation", "20261002065310_pricing_writer_concurrency", "20261003141259_supplier_default_price_writer", "20261002082357_supplier_price_source_review",
  "20261002124625_supplier_source_finish_evidence", "038_product_template_detail_price_history", "20261003154849_detail_history_dynamic_price_fields", "20261003170000_supplier_shared_price_writer",
  "20261004090000_supplier_confirmed_unchanged_decision", "20261004120000_supplier_review_completion", "20261005090000_supplier_source_definitions", "20261005120000_supplier_batch_coverage_snapshot",
  "20261005150000_supplier_coverage_completion_mode", "20261005180000_supplier_source_definition_writes", "20261005210000_supplier_source_definition_delete", "20261006090000_supplier_capacity_hardening"].map(read));
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const user = id(1), brand = id(2), otherBrand = id(3), template = id(4);
const hashA = "a".repeat(64), hashB = "b".repeat(64);
const config: SupplierProfile = { full_code_column: "CODE", strategy: "exact", currency: "EUR", basis: "list", price_columns: [{ column: "PRICE", price_field: "unit_price" }] };
const sourceRows: RawSupplierRow[] = ["111001", "111002", "111003"].map((code, index) => ({ unit_key: `row-${index}`, row_number: index + 2, sheet: "Sheet", values: { CODE: code, PRICE: 100 + index } }));

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role authenticated; create role anon; create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as 'select ''${user}''::uuid';
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(bucket_id text,name text); alter table storage.objects enable row level security;
    create table public.permissions(can_review boolean,can_approve boolean); insert into public.permissions values(true,true);
    create function public.current_user_is_active() returns boolean language sql as 'select true';
    create function public.current_user_can_manage_records() returns boolean language sql as 'select true';
    create function public.current_user_can_review_brand_prices() returns boolean language sql as 'select can_review from public.permissions';
    create function public.current_user_can_approve_brand_prices() returns boolean language sql as 'select can_approve from public.permissions';
    create table public.profiles(id uuid primary key); insert into public.profiles values('${user}');
    create table public.brands(id uuid primary key,last_price_list_checked_at timestamptz); insert into public.brands values('${brand}','2025-06-01');
    create table public.brand_price_list_updates(id uuid primary key default gen_random_uuid(),brand_id uuid not null,title text not null,reference_no text,currency text,effective_from date,received_at date,
      status text not null default 'draft' check(status in ('draft','active','archived')),notes text,attachment_url text,created_by uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    create table public.product_templates(id uuid primary key,brand_id uuid,template_name text,item_code text,description text,default_image_url text,price_notes text,
      last_price_checked_at timestamptz,last_price_checked_by uuid,price_check_note text,created_at timestamptz default '2025-01-01',is_active boolean default true,
      default_unit_price numeric default 100,currency text default 'EUR',variant_pricing jsonb default '[]',category_pricing jsonb default '[]',desking_size_pricing jsonb default '[]',accessory_pricing jsonb default '[]');
    create table public.product_components(id uuid primary key,template_id uuid not null references public.product_templates(id),option_type text,component_group text,component_code text,component_name text,description text,
      qty numeric,unit_label text,unit_price numeric,currency text,is_optional boolean,is_default_selected boolean,sort_order int,is_active boolean,price_notes text,calculation_data jsonb,created_by uuid);
    create table public.product_template_price_history(id uuid default gen_random_uuid(),product_template_id uuid,brand_id uuid,brand_price_list_update_id uuid,old_default_unit_price numeric,new_default_unit_price numeric,currency text,effective_from date,note text,changed_by uuid);
    create table public.quotations(id uuid primary key,total numeric); insert into public.quotations values('${user}',500);`);
  await db.exec(`
    create table public.test_role(role text); insert into public.test_role values('system_owner');
    create function public.current_user_role() returns text language sql stable as 'select role from public.test_role';
    create function public.current_account_status() returns text language sql stable as 'select ''active''';`);
  for (const sql of migrations.slice(0, 3)) await db.exec(sql);
  for (const sql of migrations.slice(3)) await db.exec(sql);
  await db.exec(`alter table public.brands add column if not exists name text; insert into public.brands(id) values('${otherBrand}'); update public.brands set stored_price_basis='list', name='LAS MOBILI';
    insert into public.product_templates(id,brand_id,template_name,item_code,default_unit_price) values('${template}','${brand}','MONOLITH','111001',100);`);
  return db;
}
type Db = Awaited<ReturnType<typeof fixture>>;
const withDb = async (run: (db: Db) => Promise<void>) => { const db = await fixture(); try { await run(db); } finally { await db.close(); } };
const write = async (db: Db, operation: string, payload: Record<string, unknown>) => (await db.query<{ result: { id: string } }>("select public.supplier_price_review_write($1,$2::jsonb) result", [operation, JSON.stringify(payload)])).rows[0].result;
const profileFor = async (db: Db, brandId = brand, profileConfig: SupplierProfile = config, title = "LAS") => (await write(db, "profile", { brand_id: brandId, title, config: profileConfig })).id;
async function importSource(db: Db, options: { profileId: string; hash?: string; title?: string; filename?: string; profileConfig?: SupplierProfile; finalize?: boolean }) {
  const profileConfig = options.profileConfig ?? config;
  const created = await write(db, "source", { profile_id: options.profileId, expected_profile: profileConfig, title: options.title ?? "LAS Feb 2026", filename: options.filename ?? "LISTINO.xlsx", source_type: "xlsx", file_hash: options.hash ?? hashA, expected_rows: sourceRows.length, expected_cells: sourceRows.length, expected_chunks: 1 });
  const status = (await db.query<{ status: string }>("select status from public.supplier_source_versions where id=$1", [created.id])).rows[0].status;
  if (status === "uploading") {
    await write(db, "chunk", { source_id: created.id, chunk_index: 0, rows: sourceRows, cells: normalizeSupplierRows(sourceRows, profileConfig) });
    if (options.finalize !== false) await write(db, "finalize_source", { source_id: created.id });
  }
  return created.id;
}
const count = async (db: Db, sql: string, params: unknown[] = []) => (await db.query<{ n: number }>(`select (${sql})::int n`, params)).rows[0].n;
const report = async (db: Db) => (await db.query<{ r: Record<string, any> }>("select public.supplier_capacity_report() r")).rows[0].r; // eslint-disable-line @typescript-eslint/no-explicit-any
async function batchWithMatch(db: Db, sourceId: string, finalize = true) {
  const identity = (await db.query<{ data: Record<string, unknown> }>("select data from public.supplier_source_identities where source_id=$1 order by key limit 1", [sourceId])).rows[0].data;
  const batch = await write(db, "batch", { source_id: sourceId, title: "Review", scope: "complete", selected_template_ids: [], expected_matches: 1, expected_chunks: 1 });
  await write(db, "match_chunk", { batch_id: batch.id, chunk_index: 0, matches: [{ key: `m-${identity.code}`, source: identity, targets: [], classification: "unmatched", comparison: null, candidate_shared: false }] });
  if (finalize) await write(db, "finalize_batch", { batch_id: batch.id });
  return batch.id;
}
const productSnapshot = async (db: Db) => JSON.stringify([(await db.query("select id,default_unit_price::text,pricing_version::text,last_price_checked_at from public.product_templates order by id")).rows,
  (await db.query("select * from public.quotations")).rows, (await db.query("select (select count(*) from public.product_template_price_history)::int a,(select count(*) from public.product_template_detail_price_history)::int b")).rows]);

test("same Brand + same file hash reuses the existing source whatever the title, date or filename; other Brands and other hashes are separate", async () => {
  await withDb(async (db) => {
    const profileId = await profileFor(db);
    const first = await importSource(db, { profileId });
    const again = await importSource(db, { profileId, title: "Another name", filename: "renamed.xlsx" });
    assert.equal(again, first); assert.equal(await count(db, "select count(*) from public.supplier_source_versions"), 1);
    assert.equal(await count(db, "select count(*) from public.supplier_source_rows"), 3); // no second copy of rows
    const otherHash = await importSource(db, { profileId, hash: hashB, title: "LAS Feb 2026" }); // same title, different file
    assert.notEqual(otherHash, first);
    const otherBrandSource = await importSource(db, { profileId: await profileFor(db, otherBrand), hash: hashA });
    assert.notEqual(otherBrandSource, first);
    assert.equal(await count(db, "select count(*) from public.supplier_source_versions"), 3);
  });
});

test("a different import profile for the same file is refused until the existing source is archived; archived sources do not block", async () => {
  await withDb(async (db) => {
    const first = await importSource(db, { profileId: await profileFor(db) });
    const changed: SupplierProfile = { ...config, basis: "net" };
    const otherProfile = await profileFor(db, brand, changed, "LAS net");
    await assert.rejects(importSource(db, { profileId: otherProfile, profileConfig: changed }), /Supplier source already exists for this Brand and file/);
    await write(db, "archive_source", { source_id: first });
    const reimported = await importSource(db, { profileId: otherProfile, profileConfig: changed });
    assert.notEqual(reimported, first);
  });
});

test("an unfinished import is resumed, not duplicated; duplicate prevention is serialised by the per-Brand+hash lock", async () => {
  await withDb(async (db) => {
    const profileId = await profileFor(db);
    const started = await importSource(db, { profileId, finalize: false });
    assert.equal(await importSource(db, { profileId, title: "Retry", finalize: false }), started);
    const body = (await db.query<{ d: string }>("select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) d")).rows[0].d;
    assert.ok(body.indexOf("pg_advisory_xact_lock(hashtextextended(profile_record.brand_id::text||(p_payload->>'file_hash'),0))") < body.indexOf("order by (status='imported') desc, created_at, id limit 1"));
  });
});

test("source chunks keep their payload while importing and are compacted to a receipt once imported; retries stay deterministic", async () => {
  await withDb(async (db) => {
    const profileId = await profileFor(db);
    const sourceId = await importSource(db, { profileId, finalize: false });
    assert.equal(await count(db, "select count(*) from public.supplier_source_chunks where source_id=$1 and payload is not null", [sourceId]), 1);
    const chunk = { source_id: sourceId, chunk_index: 0, rows: sourceRows, cells: normalizeSupplierRows(sourceRows, config) };
    await write(db, "chunk", chunk); // retry while importing still compares the retained payload
    assert.equal(await count(db, "select count(*) from public.supplier_source_rows where source_id=$1", [sourceId]), 3);
    await write(db, "finalize_source", { source_id: sourceId });
    const receipt = (await db.query<{ payload: unknown; payload_sha256: string; payload_bytes: number; compacted_at: Date }>("select payload,payload_sha256,payload_bytes,compacted_at from public.supplier_source_chunks where source_id=$1", [sourceId])).rows[0];
    assert.equal(receipt.payload, null); assert.match(receipt.payload_sha256, /^[a-f0-9]{64}$/); assert.ok(receipt.payload_bytes > 0); assert.ok(receipt.compacted_at instanceof Date);
    await assert.rejects(write(db, "chunk", chunk), /immutable/); // no duplicate rows after compaction
    assert.deepEqual(await write(db, "finalize_source", { source_id: sourceId }), { id: sourceId, reused: true });
    assert.equal(await count(db, "select count(*) from public.supplier_source_rows where source_id=$1", [sourceId]), 3);
    assert.equal(await count(db, "select count(*) from public.supplier_source_identities where source_id=$1", [sourceId]), 3);
  });
});

test("match chunks keep their payload until the batch is final, then keep only a receipt; canonical matches stay", async () => {
  await withDb(async (db) => {
    const sourceId = await importSource(db, { profileId: await profileFor(db) });
    const open = await batchWithMatch(db, sourceId, false);
    assert.equal(await count(db, "select count(*) from public.supplier_price_match_chunks where batch_id=$1 and payload is not null", [open]), 1);
    await write(db, "finalize_batch", { batch_id: open });
    assert.equal(await count(db, "select count(*) from public.supplier_price_match_chunks where batch_id=$1 and payload is null and payload_sha256 is not null", [open]), 1);
    assert.equal(await count(db, "select count(*) from public.supplier_price_matches where batch_id=$1", [open]), 1);
    assert.deepEqual(await write(db, "finalize_batch", { batch_id: open }), { id: open, reused: true });
  });
});

test("compacting already-finalised chunks: owner only, dry run by default, never touches an import in progress", async () => {
  await withDb(async (db) => {
    const profileId = await profileFor(db);
    const done = await importSource(db, { profileId });
    const importing = await importSource(db, { profileId, hash: hashB, finalize: false });
    await db.exec(`update public.supplier_source_chunks set payload='{"legacy":true}',payload_sha256=null,compacted_at=null where source_id='${done}'`); // as before this migration
    const dry = (await db.query<{ r: Record<string, number | boolean> }>("select public.supplier_capacity_compact_finalized() r")).rows[0].r;
    assert.equal(dry.dry_run, true); assert.equal(dry.source_chunks, 1);
    assert.equal(await count(db, "select count(*) from public.supplier_source_chunks where payload is not null"), 2); // nothing changed
    await db.exec("update public.test_role set role='designer'");
    await assert.rejects(db.query("select public.supplier_capacity_compact_finalized(false)"), /permission|privilege/i);
    await db.exec("update public.test_role set role='system_owner'");
    await db.query("select public.supplier_capacity_compact_finalized(false)");
    assert.equal(await count(db, "select count(*) from public.supplier_source_chunks where source_id=$1 and payload is null", [done]), 1);
    assert.equal(await count(db, "select count(*) from public.supplier_source_chunks where source_id=$1 and payload is not null", [importing]), 1); // in progress: untouched
  });
});

test("capacity report: duplicate groups, deterministic canonical, protected imports, retention classes, storage safety; read-only and owner only", async () => {
  await withDb(async (db) => {
    const profileId = await profileFor(db);
    const canonical = await importSource(db, { profileId });
    // Simulate the duplicates created before this migration (the old reuse rule matched on title).
    for (const [index, title] of ["feb 2026", "feb 2026 again"].entries()) {
      const copy = id(50 + index);
      await db.exec(`insert into public.supplier_source_versions(id,brand_id,title,filename,file_hash,source_type,currency,basis,profile,status,expected_rows,expected_cells,expected_chunks,created_by,created_at,working_reference)
        select '${copy}',brand_id,'${title}',filename,file_hash,source_type,currency,basis,profile,'imported',expected_rows,expected_cells,expected_chunks,created_by,created_at + interval '${index + 1} hour','${brand}/${copy}/${hashA}.xlsx' from public.supplier_source_versions where id='${canonical}';
        insert into public.supplier_source_rows select '${copy}',unit_key,row_number,sheet,raw_extras,page_reference from public.supplier_source_rows where source_id='${canonical}';
        insert into public.supplier_source_cells select '${copy}',unit_key,row_key,code,raw_code,raw_article,finish,dimension,price_field,price,raw_price,issues,companion_note from public.supplier_source_cells where source_id='${canonical}';
        insert into public.supplier_source_identities select '${copy}',key,code,data from public.supplier_source_identities where source_id='${canonical}';`);
    }
    const [safeCopy, decidedCopy] = [id(50), id(51)];
    const importing = await importSource(db, { profileId, hash: hashB, finalize: false });
    const old = await batchWithMatch(db, canonical); const current = await batchWithMatch(db, canonical);
    const decided = await batchWithMatch(db, decidedCopy);
    await db.query("insert into public.supplier_price_decisions(batch_id,key,decision,note,reviewed_by) select $1,key,'reviewed','',$2 from public.supplier_price_matches where batch_id=$1", [decided, user]);
    const before = await productSnapshot(db); const rows = await count(db, "select count(*) from public.supplier_source_rows");

    const result = await report(db);
    assert.ok(result.database_bytes > 0); assert.ok(result.supplier_bytes > 0);
    assert.ok(result.tables.some((table: { name: string; rows: number }) => table.name === "supplier_source_rows" && table.rows === rows));
    assert.equal(result.duplicate_groups.length, 1);
    const group = result.duplicate_groups[0];
    assert.equal(group.file_hash, hashA); assert.equal(group.classification, "SAFE_CANDIDATE");
    // The copy with a user decision is preferred as canonical (meaningful state first), never deleted automatically.
    assert.equal(group.canonical_source_id, decidedCopy);
    const byId = Object.fromEntries(group.members.map((member: { source_id: string }) => [member.source_id, member]));
    assert.equal(byId[decidedCopy].classification, "CANONICAL");
    assert.equal(byId[canonical].classification, "SAFE_CANDIDATE"); assert.equal(byId[safeCopy].classification, "SAFE_CANDIDATE");
    assert.equal(byId[safeCopy].rows, 3); assert.equal(byId[safeCopy].storage_shared, false); assert.ok(byId[safeCopy].estimated_bytes > 0);
    assert.ok(group.reclaimable_bytes > 0);
    assert.equal(result.protected_sources.length, 1); assert.equal(result.protected_sources[0].source_id, importing);
    const retention = Object.fromEntries(result.batches.map((batch: { batch_id: string; retention: string }) => [batch.batch_id, batch.retention]));
    assert.deepEqual([retention[old], retention[current], retention[decided]], ["SUPERSEDED_SAFE_TO_DELETE", "KEEP_CURRENT", "KEEP_PROTECTED_DECISIONS"]);
    assert.ok(result.reclaimable.superseded_match_rows >= 1);
    // Read-only: nothing changed anywhere, including Product data.
    assert.equal(await count(db, "select count(*) from public.supplier_source_rows"), rows);
    assert.equal(await count(db, "select count(*) from public.supplier_source_versions"), 4);
    assert.equal(await productSnapshot(db), before);
    await db.exec("update public.test_role set role='admin_manager'");
    await assert.rejects(report(db), /permission|privilege/i);
  });
});

test("a second meaningful copy forces MANUAL_REVIEW_REQUIRED and a shared Storage path is reported as shared", async () => {
  await withDb(async (db) => {
    const profileId = await profileFor(db);
    const first = await importSource(db, { profileId });
    await db.exec(`update public.supplier_source_versions set working_reference='${brand}/shared/${hashA}.xlsx' where id='${first}';
      insert into public.supplier_source_versions(id,brand_id,title,filename,file_hash,source_type,currency,basis,profile,status,expected_rows,expected_cells,expected_chunks,created_by,working_reference)
      select '${id(60)}',brand_id,'copy',filename,file_hash,source_type,currency,basis,profile,'imported',expected_rows,expected_cells,expected_chunks,created_by,working_reference from public.supplier_source_versions where id='${first}';
      insert into public.supplier_source_identities select '${id(60)}',key,code,data from public.supplier_source_identities where source_id='${first}';`);
    for (const sourceId of [first, id(60)]) {
      const batchId = await batchWithMatch(db, sourceId);
      await db.query("insert into public.supplier_price_decisions(batch_id,key,decision,note,reviewed_by) select $1,key,$3,'',$2 from public.supplier_price_matches where batch_id=$1", [batchId, user, sourceId === first ? "reviewed" : "skip"]);
    }
    const group = (await report(db)).duplicate_groups[0];
    assert.equal(group.classification, "MANUAL_REVIEW_REQUIRED");
    assert.deepEqual(group.members.map((member: { classification: string }) => member.classification).sort(), ["CANONICAL", "MANUAL_REVIEW_REQUIRED"]);
    assert.equal(group.reclaimable_bytes, 0);
    assert.ok(group.members.every((member: { storage_shared: boolean }) => member.storage_shared));
  });
});

test("definition rename/archive now requires the definition's own Brand", async () => {
  await withDb(async (db) => {
    const definition = (await write(db, "definition", { brand_id: brand, name: "LAS Furniture" })).id;
    await assert.rejects(write(db, "definition", { id: definition, brand_id: otherBrand, name: "Hijacked" }), /unavailable/);
    await write(db, "definition", { id: definition, brand_id: brand, name: "LAS Furniture 2" });
    assert.equal((await db.query<{ name: string }>("select name from public.supplier_source_definitions where id=$1", [definition])).rows[0].name, "LAS Furniture 2");
  });
});
