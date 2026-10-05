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
  "20261005150000_supplier_coverage_completion_mode", "20261005180000_supplier_source_definition_writes", "20261005210000_supplier_source_definition_delete", "20261006090000_supplier_capacity_hardening", "20261006120000_supplier_capacity_cleanup", "20261006150000_supplier_compact_source_rows", "20261006170000_supplier_cells_row_key_index", "20261006180000_supplier_staged_finalize"].map(read));
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

// ---- Phases C and D: dry runs and executors ----
async function copySource(db: Db, from: string, copy: string, hours: number, extra = "") {
  await db.exec(`insert into public.supplier_source_versions(id,brand_id,title,filename,file_hash,source_type,currency,basis,profile,status,expected_rows,expected_cells,expected_chunks,created_by,created_at,working_reference)
      select '${copy}',brand_id,'copy',filename,file_hash,source_type,currency,basis,profile,'imported',expected_rows,expected_cells,expected_chunks,created_by,created_at + interval '${hours} hour','${brand}/${copy}/${hashA}.xlsx' from public.supplier_source_versions where id='${from}';
    insert into public.supplier_source_rows select '${copy}',unit_key,row_number,sheet,raw_extras,page_reference from public.supplier_source_rows where source_id='${from}';
    insert into public.supplier_source_cells select '${copy}',unit_key,row_key,code,raw_code,raw_article,finish,dimension,price_field,price,raw_price,issues,companion_note from public.supplier_source_cells where source_id='${from}';
    insert into public.supplier_source_identities select '${copy}',key,code,data from public.supplier_source_identities where source_id='${from}';
    insert into public.supplier_source_chunks(source_id,chunk_index,payload) values('${copy}',0,'{"staging":true}'); ${extra}`);
  return copy;
}
const decide = (db: Db, batchId: string, decision = "reviewed") => db.query("insert into public.supplier_price_decisions(batch_id,key,decision,note,reviewed_by) select $1,key,$3,'',$2 from public.supplier_price_matches where batch_id=$1", [batchId, user, decision]);
const json = async (db: Db, sql: string, params: unknown[] = []) => (await db.query<{ r: Record<string, any> }>(`select ${sql} r`, params)).rows[0].r; // eslint-disable-line @typescript-eslint/no-explicit-any
const supplierCounts = async (db: Db) => JSON.stringify(await Promise.all(["supplier_source_versions", "supplier_source_rows", "supplier_source_cells", "supplier_source_identities", "supplier_source_chunks", "supplier_price_batches", "supplier_price_matches", "supplier_price_match_chunks", "supplier_template_review_units", "supplier_price_decisions"].map((table) => count(db, `select count(*) from public.${table}`))));

async function duplicateScenario(db: Db) {
  const profileId = await profileFor(db);
  const canonical = await importSource(db, { profileId });
  const canonicalBatch = await batchWithMatch(db, canonical); await decide(db, canonicalBatch);
  const clean = await copySource(db, canonical, id(70), 1);
  const equivalent = await copySource(db, canonical, id(71), 2); await decide(db, await batchWithMatch(db, equivalent));
  const unique = await copySource(db, canonical, id(72), 3); await decide(db, await batchWithMatch(db, unique), "skip");
  const importing = await importSource(db, { profileId, hash: hashB, finalize: false });
  return { canonical, canonicalBatch, clean, equivalent, unique, importing };
}
const dryRun = (db: Db, canonical: string, duplicates: string[]) => json(db, "public.cleanup_duplicate_supplier_sources($1,$2::uuid[])", [canonical, duplicates]);
const verdicts = (result: Record<string, any>) => Object.fromEntries(result.duplicates.map((item: { source_id: string }) => [item.source_id, item])); // eslint-disable-line @typescript-eslint/no-explicit-any

test("duplicate dry run: exact counts and verdicts, equivalent decisions flagged not deleted, unique decisions protected, nothing changes", async () => {
  await withDb(async (db) => {
    const s = await duplicateScenario(db);
    const before = await supplierCounts(db); const products = await productSnapshot(db);
    const result = await dryRun(db, s.canonical, [s.clean, s.equivalent, s.unique, s.canonical, s.importing]);
    assert.equal(result.dry_run, true);
    const v = verdicts(result);
    assert.equal(v[s.clean].classification, "SAFE_TO_DELETE"); assert.deepEqual([v[s.clean].rows, v[s.clean].cells, v[s.clean].identities, v[s.clean].chunks, v[s.clean].batches], [3, 3, 3, 1, 0]);
    assert.ok(v[s.clean].estimated_bytes > 0); assert.equal(v[s.clean].storage_shared, false); assert.equal(v[s.clean].storage_object_candidate, `${brand}/${s.clean}/${hashA}.xlsx`);
    assert.equal(v[s.equivalent].classification, "MANUAL_REVIEW_REQUIRED"); assert.equal(v[s.equivalent].safe_after_equivalence_confirmation, true); assert.match(v[s.equivalent].reasons.join(), /DUPLICATED_EQUIVALENT_STATE/);
    assert.equal(v[s.unique].classification, "MANUAL_REVIEW_REQUIRED"); assert.equal(v[s.unique].unique_decisions, 1); assert.equal(v[s.unique].safe_after_equivalence_confirmation, false);
    assert.equal(v[s.canonical].classification, "PROTECTED"); assert.match(v[s.canonical].reasons.join(), /canonical/);
    assert.equal(v[s.importing].classification, "PROTECTED"); // different hash and not finished
    assert.equal(await supplierCounts(db), before); assert.equal(await productSnapshot(db), products); // dry run deletes nothing
  });
});

test("applied price history, a definition link, an unfinished copy and a shared Storage path all block automatic deletion", async () => {
  await withDb(async (db) => {
    const s = await duplicateScenario(db);
    const appliedBatch = await batchWithMatch(db, s.clean);
    await db.query("insert into public.product_template_price_history(product_template_id,note) values($1,$2)", [template, `Supplier source: x; batch: ${appliedBatch}; match: m`]);
    const linked = await copySource(db, s.canonical, id(73), 4, `insert into public.supplier_source_definitions(id,brand_id,name) values('${id(80)}','${brand}','LAS Furniture'); update public.supplier_source_versions set definition_id='${id(80)}' where id='${id(73)}';`);
    const unfinished = await copySource(db, s.canonical, id(74), 5, `update public.supplier_source_versions set status='importing' where id='${id(74)}';`);
    const shared = await copySource(db, s.canonical, id(75), 6, `update public.supplier_source_versions set working_reference='${brand}/shared/${hashA}.xlsx' where id in ('${s.canonical}','${id(75)}');`);
    const v = verdicts(await dryRun(db, s.canonical, [s.clean, linked, unfinished, shared]));
    assert.equal(v[s.clean].classification, "MANUAL_REVIEW_REQUIRED"); assert.match(v[s.clean].reasons.join(), /applied Product price history/); assert.equal(v[s.clean].safe_after_equivalence_confirmation, false);
    assert.equal((await json(db, "public.supplier_capacity_batch_verdict($1)", [appliedBatch])).classification, "KEEP_PROTECTED_APPLIED");
    assert.equal(v[linked].classification, "MANUAL_REVIEW_REQUIRED"); assert.match(v[linked].reasons.join(), /Supplier source definition/);
    assert.equal(v[unfinished].classification, "PROTECTED");
    assert.equal(v[shared].storage_shared, true); assert.equal(v[shared].storage_object_candidate, null);
    // The report now prefers the copy whose review reached applied history as canonical.
    assert.equal((await report(db)).duplicate_groups[0].canonical_source_id, s.clean);
  });
});

test("duplicate executor: owner only, re-checks under lock, deletes only named supplier rows, keeps canonical, Product data and Storage", async () => {
  await withDb(async (db) => {
    const s = await duplicateScenario(db);
    const products = await productSnapshot(db); const canonicalRows = await count(db, "select count(*) from public.supplier_source_rows where source_id=$1", [s.canonical]);
    await db.exec("update public.test_role set role='admin_manager'");
    await assert.rejects(json(db, "public.cleanup_duplicate_supplier_sources($1,$2::uuid[],false)", [s.canonical, [s.clean]]), /permission|privilege/i);
    await db.exec("update public.test_role set role='system_owner'");
    const before = await supplierCounts(db);
    await assert.rejects(json(db, "public.cleanup_duplicate_supplier_sources($1,$2::uuid[],false)", [s.canonical, [s.clean, s.unique]]), /Nothing was deleted/);
    await assert.rejects(json(db, "public.cleanup_duplicate_supplier_sources($1,$2::uuid[],false)", [s.canonical, [s.equivalent]]), /Nothing was deleted/); // equivalent state needs explicit confirmation
    assert.equal(await supplierCounts(db), before); // whole call rolled back
    // State changed after the dry run: the clean copy gains a unique decision, so the executor refuses.
    const late = await batchWithMatch(db, s.clean); await decide(db, late, "reject");
    await assert.rejects(json(db, "public.cleanup_duplicate_supplier_sources($1,$2::uuid[],false)", [s.canonical, [s.clean]]), /Nothing was deleted/);
    await db.query("delete from public.supplier_price_decisions where batch_id=$1", [late]);
    const done = await json(db, "public.cleanup_duplicate_supplier_sources($1,$2::uuid[],false)", [s.canonical, [s.clean]]);
    assert.deepEqual([done.deleted.supplier_source_versions, done.deleted.supplier_source_rows, done.deleted.supplier_source_cells, done.deleted.supplier_source_identities, done.deleted.supplier_source_chunks, done.deleted.supplier_price_batches, done.deleted.supplier_price_matches], [1, 3, 3, 3, 1, 1, 1]);
    assert.deepEqual(done.storage_object_candidates, [`${brand}/${s.clean}/${hashA}.xlsx`]); // reported, not deleted
    const confirmed = await json(db, "public.cleanup_duplicate_supplier_sources($1,$2::uuid[],false,true)", [s.canonical, [s.equivalent]]);
    assert.equal(confirmed.deleted.supplier_price_decisions, 1);
    assert.equal(await count(db, "select count(*) from public.supplier_source_rows where source_id=$1", [s.canonical]), canonicalRows);
    assert.equal(await count(db, "select count(*) from public.supplier_price_decisions where batch_id=$1", [s.canonicalBatch]), 1);
    assert.equal(await count(db, "select count(*) from public.supplier_source_versions where id=$1", [s.importing]), 1);
    assert.equal(await productSnapshot(db), products);
    await assert.rejects(json(db, "public.cleanup_duplicate_supplier_sources($1,$2::uuid[],false)", [s.canonical, [s.clean]]), /Nothing was deleted/); // repeating is refused (source gone)
  });
});

test("batch verdicts: decisions, completed, in progress and newest are kept; only superseded empty runs are safe", async () => {
  await withDb(async (db) => {
    const profileId = await profileFor(db);
    const source = await importSource(db, { profileId });
    const superseded = await batchWithMatch(db, source);
    const decided = await batchWithMatch(db, source); await decide(db, decided, "confirmed_unchanged");
    const completed = await batchWithMatch(db, source); await db.query("update public.supplier_price_batches set status='completed',completed_at=now() where id=$1", [completed]);
    const running = await batchWithMatch(db, source, false);
    const newest = await batchWithMatch(db, source);
    const result = await json(db, "public.cleanup_supplier_review_batches($1::uuid[])", [[superseded, decided, completed, running, newest]]);
    const v = Object.fromEntries(result.batches.map((item: { batch_id: string; classification: string }) => [item.batch_id, item.classification]));
    assert.deepEqual([v[superseded], v[decided], v[completed], v[running], v[newest]], ["SUPERSEDED_SAFE_TO_DELETE", "KEEP_PROTECTED_DECISIONS", "KEEP_PROTECTED_COMPLETED", "KEEP_IN_PROGRESS", "KEEP_CURRENT"]);
    assert.ok(result.batches.find((item: { batch_id: string }) => item.batch_id === superseded).estimated_bytes > 0);
    const importing = await importSource(db, { profileId, hash: hashB, finalize: false });
    assert.equal(await count(db, "select count(*) from public.supplier_source_chunks where source_id=$1 and payload is not null", [importing]), 1);
    assert.equal(await count(db, "select count(*) from public.supplier_price_batches"), 5); // dry run deleted nothing
  });
});

test("batch executor: owner only, aborts the whole call on any protected batch, deletes a superseded run's derived rows only", async () => {
  await withDb(async (db) => {
    const source = await importSource(db, { profileId: await profileFor(db) });
    const superseded = await batchWithMatch(db, source); const decided = await batchWithMatch(db, source); await decide(db, decided); const newest = await batchWithMatch(db, source);
    const products = await productSnapshot(db);
    await db.exec("update public.test_role set role='designer'");
    await assert.rejects(json(db, "public.cleanup_supplier_review_batches($1::uuid[],false)", [[superseded]]), /permission|privilege/i);
    await db.exec("update public.test_role set role='system_owner'");
    const before = await supplierCounts(db);
    await assert.rejects(json(db, "public.cleanup_supplier_review_batches($1::uuid[],false)", [[superseded, decided]]), /Nothing was deleted/);
    await assert.rejects(json(db, "public.cleanup_supplier_review_batches($1::uuid[],false)", [[newest]]), /KEEP_CURRENT/);
    assert.equal(await supplierCounts(db), before);
    const done = await json(db, "public.cleanup_supplier_review_batches($1::uuid[],false)", [[superseded]]);
    assert.deepEqual([done.deleted.batches, done.deleted.matches, done.deleted.match_chunks], [1, 1, 1]);
    assert.equal(await count(db, "select count(*) from public.supplier_price_batches where id=any($1::uuid[])", [[decided, newest]]), 2);
    assert.equal(await count(db, "select count(*) from public.supplier_source_rows where source_id=$1", [source]), 3); // the master source is untouched
    assert.equal(await productSnapshot(db), products);
  });
});

// ---- Phase E: compact source rows and previous price list lifecycle ----
const wideConfig: SupplierProfile = { ...config, description_column: "DESC", retained_columns: ["WIDTH"] } as SupplierProfile;
const wideRows: RawSupplierRow[] = ["111001", "111002", "111003"].map((code, index) => ({ unit_key: `row-${index}`, row_number: index + 2, sheet: "Sheet", values: { CODE: code, PRICE: 100 + index, DESC: `Desk ${index}`, WIDTH: 120 + index, NOTES: "x".repeat(300), COLOUR: "Oak", CATALOGUE_PAGE: 12 } }));
const rawKeys = async (db: Db, sourceId: string) => (await db.query<{ k: string }>("select distinct jsonb_object_keys(raw_extras) k from public.supplier_source_rows where source_id=$1 order by 1", [sourceId])).rows.map((row) => row.k);
const identitiesOf = async (db: Db, sourceId: string) => JSON.stringify((await db.query("select key,data from public.supplier_source_identities where source_id=$1 order by key", [sourceId])).rows);

test("new imports keep only the profile's columns in source rows, for XLSX, CSV and JSON; retries and identities are unchanged", async () => {
  await withDb(async (db) => {
    const profileId = await profileFor(db, brand, wideConfig, "Wide");
    for (const [index, sourceType] of ["xlsx", "csv", "json"].entries()) {
      const created = await write(db, "source", { profile_id: profileId, expected_profile: wideConfig, title: `List ${sourceType}`, filename: `list.${sourceType}`, source_type: sourceType, file_hash: String(index + 1).repeat(64), expected_rows: 3, expected_cells: 3, expected_chunks: 1 });
      const chunk = { source_id: created.id, chunk_index: 0, rows: wideRows, cells: normalizeSupplierRows(wideRows, wideConfig) };
      await write(db, "chunk", chunk); await write(db, "chunk", chunk); // the retry still compares the full staging payload
      await write(db, "finalize_source", { source_id: created.id });
      assert.deepEqual(await rawKeys(db, created.id), ["CODE", "DESC", "PRICE", "WIDTH"], sourceType); // NOTES, COLOUR, CATALOGUE_PAGE stay only in the original file
      assert.equal(await count(db, "select count(*) from public.supplier_source_identities where source_id=$1", [created.id]), 3);
      assert.equal(await count(db, "select count(*) from public.supplier_source_cells where source_id=$1 and raw_code<>''", [created.id]), 3); // full code and price evidence stay in cells
    }
  });
});

test("compacting finalised source rows: owner only, dry run by default, never an unfinished import, identities and matches unchanged", async () => {
  await withDb(async (db) => {
    const profileId = await profileFor(db, brand, wideConfig, "Wide");
    const done = await importSource(db, { profileId, profileConfig: wideConfig });
    const importing = await importSource(db, { profileId, profileConfig: wideConfig, hash: hashB, finalize: false });
    await db.query("update public.supplier_source_rows set raw_extras=raw_extras || jsonb_build_object('NOTES',repeat('x',300),'COLOUR','Oak') where source_id=any($1::uuid[])", [[done, importing]]); // rows as stored before this migration
    const batchId = await batchWithMatch(db, done); const matchesBefore = JSON.stringify((await db.query("select * from public.supplier_price_matches where batch_id=$1", [batchId])).rows);
    const identities = await identitiesOf(db, done); const products = await productSnapshot(db);
    const dry = await json(db, "public.supplier_capacity_compact_source_rows($1::uuid[])", [[done, importing]]);
    const byId = Object.fromEntries(dry.sources.map((item: { source_id: string }) => [item.source_id, item]));
    assert.equal(dry.dry_run, true); assert.equal(byId[done].rows_to_compact, 3); assert.ok(byId[done].saved_bytes > 0);
    assert.equal(byId[importing].compacted, false); assert.match(byId[importing].reason, /not finished/);
    assert.ok((await rawKeys(db, done)).includes("NOTES")); // dry run changed nothing
    await db.exec("update public.test_role set role='procurement_manager'");
    await assert.rejects(json(db, "public.supplier_capacity_compact_source_rows($1::uuid[],false)", [[done]]), /permission|privilege/i);
    await db.exec("update public.test_role set role='system_owner'");
    await json(db, "public.supplier_capacity_compact_source_rows($1::uuid[],false)", [[done, importing]]);
    assert.deepEqual(await rawKeys(db, done), ["CODE", "PRICE"]); // these rows only ever had the profile columns plus the legacy extras
    assert.ok((await rawKeys(db, importing)).includes("NOTES")); // unfinished import untouched
    assert.equal(await identitiesOf(db, done), identities);
    assert.equal(JSON.stringify((await db.query("select * from public.supplier_price_matches where batch_id=$1", [batchId])).rows), matchesBefore);
    assert.equal(await productSnapshot(db), products);
    const storage = await json(db, "public.supplier_capacity_source_storage()");
    assert.ok(storage.some((row: { source_id: string; raw_extras_bytes: number }) => row.source_id === done && row.raw_extras_bytes > 0));
  });
});

async function lifecycle(db: Db) {
  const profileId = await profileFor(db);
  const furniture = (await write(db, "definition", { brand_id: brand, name: "LAS Furniture" })).id;
  const chairs = (await write(db, "definition", { brand_id: brand, name: "LAS Chairs" })).id;
  await write(db, "definition_coverage", { definition_id: furniture, template_ids: [template] });
  const previous = await importSource(db, { profileId, title: "February 2026" });
  const current = await importSource(db, { profileId, hash: hashB, title: "October 2026" });
  const chairList = await importSource(db, { profileId, hash: "c".repeat(64), title: "Chairs February 2026" });
  await db.exec(`update public.supplier_source_versions set created_at=created_at - interval '1 day' where id='${previous}'`);
  for (const [sourceId, definition] of [[previous, furniture], [current, furniture], [chairList, chairs]]) await write(db, "source_definition", { source_id: sourceId, definition_id: definition });
  await db.exec(`update public.supplier_source_versions set working_reference=brand_id||'/'||id||'/'||file_hash||'.xlsx'`);
  return { previous, current, chairList };
}
const previousState = (db: Db, current: string) => json(db, "public.supplier_previous_source_state($1)", [current]);

test("previous price list: the older version of the same Supplier source is offered; Keep and Archive change no data; other sources are not involved", async () => {
  await withDb(async (db) => {
    const s = await lifecycle(db);
    const state = await previousState(db, s.current);
    assert.deepEqual(state.previous.map((item: { source_id: string }) => item.source_id), [s.previous]); // LAS Chairs is a different source
    assert.equal(state.previous[0].safe_to_delete, true); assert.equal(state.previous[0].storage_shared, false);
    assert.deepEqual((await previousState(db, s.chairList)).previous, []);
    const before = await supplierCounts(db);
    await write(db, "archive_source", { source_id: s.previous });
    assert.equal(await supplierCounts(db), before); // archive keeps every row
    assert.equal((await previousState(db, s.current)).previous[0].status, "archived");
  });
});

test("delete previous price list: dry run first, owner only, protected history disables it, safe delete removes only the old version", async () => {
  await withDb(async (db) => {
    const s = await lifecycle(db);
    const decided = await batchWithMatch(db, s.previous); await decide(db, decided);
    const protectedState = (await previousState(db, s.current)).previous[0];
    assert.equal(protectedState.safe_to_delete, false); assert.ok(protectedState.reasons.includes("This previous price list contains review history that must be retained."));
    const before = await supplierCounts(db);
    await assert.rejects(json(db, "public.cleanup_previous_supplier_source($1,$2,false)", [s.current, s.previous]), /Nothing was deleted/);
    assert.equal(await supplierCounts(db), before); // the new current source and everything else intact after a refused delete
    await db.query("delete from public.supplier_price_decisions where batch_id=$1", [decided]);
    const cleared = await supplierCounts(db);
    const dry = await json(db, "public.cleanup_previous_supplier_source($1,$2)", [s.current, s.previous]);
    assert.equal(dry.dry_run, true); assert.equal(dry.previous.safe_to_delete, true); assert.equal(await supplierCounts(db), cleared);
    await db.exec("update public.test_role set role='admin_manager'");
    await assert.rejects(json(db, "public.cleanup_previous_supplier_source($1,$2,false)", [s.current, s.previous]), /permission|privilege/i);
    await db.exec("update public.test_role set role='system_owner'");
    const products = await productSnapshot(db); const currentIdentities = await identitiesOf(db, s.current);
    const done = await json(db, "public.cleanup_previous_supplier_source($1,$2,false)", [s.current, s.previous]);
    assert.deepEqual([done.deleted.supplier_source_versions, done.deleted.supplier_source_rows, done.deleted.supplier_price_batches], [1, 3, 1]);
    assert.equal(done.storage_object_candidate, `${brand}/${s.previous}/${hashA}.xlsx`); // reported only; Storage is not touched
    assert.equal(await identitiesOf(db, s.current), currentIdentities);
    assert.equal(await count(db, "select count(*) from public.supplier_source_versions where id=any($1::uuid[])", [[s.current, s.chairList]]), 2);
    assert.equal(await productSnapshot(db), products);
  });
});

test("a previous version sharing the Storage file is reported as shared; an import still running is never offered for deletion", async () => {
  await withDb(async (db) => {
    const s = await lifecycle(db);
    await db.exec(`update public.supplier_source_versions set working_reference='${brand}/shared.xlsx' where id in ('${s.previous}','${s.current}')`);
    const state = (await previousState(db, s.current)).previous[0];
    assert.equal(state.storage_shared, true); assert.equal(state.storage_object_candidate, null);
    const verdict = await json(db, "public.supplier_previous_source_verdict($1,$2)", [s.previous, s.current]); // reversed: the newer one is not "previous"
    assert.equal(verdict.safe_to_delete, false); assert.match(verdict.reasons.join(), /Not an older version/);
  });
});

// ---- Staged finalize ----
const largeRows: RawSupplierRow[] = Array.from({ length: 600 }, (_, index) => ({ unit_key: `big-${index}`, row_number: index + 2, sheet: "Sheet", values: { CODE: `C${String(index % 120).padStart(3, "0")}`, PRICE: 100 + (index % 3) } }));
async function uploadLarge(db: Db, profileId: string, hash: string) {
  const created = await write(db, "source", { profile_id: profileId, expected_profile: config, title: `Large ${hash[0]}`, filename: "large.xlsx", source_type: "xlsx", file_hash: hash, expected_rows: 600, expected_cells: 600, expected_chunks: 2 });
  for (const index of [0, 1]) { const rows = largeRows.slice(index * 300, index * 300 + 300); await write(db, "chunk", { source_id: created.id, chunk_index: index, rows, cells: normalizeSupplierRows(rows, config) }); }
  return created.id;
}
const step = (db: Db, sourceId: string, maxCells = 20000) => json(db, "public.supplier_finalize_source_step($1,$2)", [sourceId, maxCells]);
const identityData = async (db: Db, sourceId: string) => JSON.stringify((await db.query<{ key: string; data: Record<string, unknown> }>("select key,data from public.supplier_source_identities where source_id=$1 order by key", [sourceId])).rows.map((row) => [row.key, row.data]));

test("staged finalize builds exactly the identities of the single-statement finalize, in bounded resumable steps", async () => {
  await withDb(async (db) => {
    const profileId = await profileFor(db);
    const reference = await uploadLarge(db, profileId, hashA); await write(db, "finalize_source", { source_id: reference });
    const staged = await uploadLarge(db, profileId, hashB);
    const products = await productSnapshot(db);
    const results: Array<Record<string, any>> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    for (let guard = 0; guard < 50; guard++) {
      const result = await step(db, staged, 100);
      results.push(result);
      if (result.done) break;
      assert.equal((await db.query<{ status: string }>("select status from public.supplier_source_versions where id=$1", [staged])).rows[0].status, "importing"); // not imported until the last step
      assert.equal(await count(db, "select count(*) from public.supplier_source_chunks where source_id=$1 and payload is not null", [staged]), 2); // staging kept until finished
    }
    assert.ok(results.length > 2); // split into several steps
    assert.ok(results.every((result) => result.codes <= 20)); // 5 cells per code, 100-cell budget: whole codes only, never more than the budget allows
    const final = results.at(-1)!;
    assert.equal(final.status, "imported"); assert.equal(final.identity_count, await count(db, "select count(*) from public.supplier_source_identities where source_id=$1", [reference]));
    assert.equal(await identityData(db, staged), (await identityData(db, reference)).replaceAll(reference, staged)); // identical identities (and issues)
    assert.equal(await count(db, "select count(*) from public.supplier_source_chunks where source_id=$1 and payload is null and payload_sha256 is not null", [staged]), 2); // compacted after finalize
    assert.deepEqual(await step(db, staged), { id: staged, status: "imported", done: true, reused: true, identity_count: final.identity_count, remaining_codes: 0 }); // repeating is harmless
    assert.equal(await productSnapshot(db), products);
  });
});

test("staged finalize resumes after an interruption without duplicating identities, and a small source finishes in one step", async () => {
  await withDb(async (db) => {
    const profileId = await profileFor(db);
    const large = await uploadLarge(db, profileId, hashA);
    const first = await step(db, large, 100);
    const builtFirst = await count(db, "select count(*) from public.supplier_source_identities where source_id=$1", [large]);
    assert.equal(first.done, false); assert.equal(builtFirst, first.identities_built);
    // A crash before the next call loses nothing: the next call continues with the codes still missing.
    const resumed = await step(db, large, 100000);
    assert.equal(resumed.done, true);
    assert.equal(await count(db, "select count(*) from public.supplier_source_identities where source_id=$1", [large]), resumed.identity_count);
    assert.equal(await count(db, "select count(*) from (select key from public.supplier_source_identities where source_id=$1 group by key having count(*)>1) d", [large]), 0);
    const small = await importSource(db, { profileId, hash: hashB, finalize: false });
    assert.equal((await step(db, small)).done, true);
    assert.equal(await count(db, "select count(*) from public.supplier_source_identities where source_id=$1", [small]), 3);
    await assert.rejects(step(db, small, 10), /step size/); // the budget is bounded
    await db.exec("update public.permissions set can_review=false");
    await assert.rejects(step(db, large), /permission|privilege/i);
  });
});

test("staged finalize refuses an incomplete upload and leaves it importing", async () => {
  await withDb(async (db) => {
    const profileId = await profileFor(db);
    const created = await write(db, "source", { profile_id: profileId, expected_profile: config, title: "Half", filename: "half.xlsx", source_type: "xlsx", file_hash: hashA, expected_rows: 600, expected_cells: 600, expected_chunks: 2 });
    const rows = largeRows.slice(0, 300); await write(db, "chunk", { source_id: created.id, chunk_index: 0, rows, cells: normalizeSupplierRows(rows, config) });
    await assert.rejects(step(db, created.id), /Import incomplete/);
    assert.equal((await db.query<{ status: string }>("select status from public.supplier_source_versions where id=$1", [created.id])).rows[0].status, "importing");
    assert.equal(await count(db, "select count(*) from public.supplier_source_identities where source_id=$1", [created.id]), 0);
  });
});
