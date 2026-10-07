import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { normalizeSupplierRows, supplierImportChunks } from "./supplier-price-import.js";
import { brandPriceTargets } from "./supplier-price-targets.js";
import { matchSupplierPrices } from "./supplier-price-matching.js";
import type { RawSupplierRow, SourceIdentity, SupplierProfile } from "./supplier-price-contracts.js";

const migration = await readFile(new URL("../../supabase/migrations/20261002082357_supplier_price_source_review.sql", import.meta.url), "utf8");
const finishMigration = await readFile(new URL("../../supabase/migrations/20261002124625_supplier_source_finish_evidence.sql", import.meta.url), "utf8");
const confirmedUnchangedMigration = await readFile(new URL("../../supabase/migrations/20261004090000_supplier_confirmed_unchanged_decision.sql", import.meta.url), "utf8");
const completionMigration = await readFile(new URL("../../supabase/migrations/20261004120000_supplier_review_completion.sql", import.meta.url), "utf8");
const deskingMigration = await readFile(new URL("../../supabase/migrations/20261004170000_supplier_desking_additional_price_comparison.sql", import.meta.url), "utf8");
const sourceDefinitionsMigration = await readFile(new URL("../../supabase/migrations/20261005090000_supplier_source_definitions.sql", import.meta.url), "utf8");
const batchCoverageMigration = await readFile(new URL("../../supabase/migrations/20261005120000_supplier_batch_coverage_snapshot.sql", import.meta.url), "utf8");
const definitionWritesMigration = await readFile(new URL("../../supabase/migrations/20261005180000_supplier_source_definition_writes.sql", import.meta.url), "utf8");
const definitionDeleteMigration = await readFile(new URL("../../supabase/migrations/20261005210000_supplier_source_definition_delete.sql", import.meta.url), "utf8");
const dimensionReplaceMigration = await readFile(new URL("../../supabase/migrations/20261006054910_supplier_dimension_atomic_replace.sql", import.meta.url), "utf8");
const capacityHardeningMigration = await readFile(new URL("../../supabase/migrations/20261006090000_supplier_capacity_hardening.sql", import.meta.url), "utf8");
const compactRowsMigration = await readFile(new URL("../../supabase/migrations/20261006150000_supplier_compact_source_rows.sql", import.meta.url), "utf8");
const identityEvidenceMigration = await readFile(new URL("../../supabase/migrations/20261006210000_supplier_identity_evidence.sql", import.meta.url), "utf8");
const basisMigration = await readFile(new URL("../../supabase/migrations/20261006250000_supplier_price_basis_confirmation_writes.sql", import.meta.url), "utf8");
const brand = "00000000-0000-0000-0000-000000000001";
const user = "00000000-0000-0000-0000-000000000002";
const templateId = "00000000-0000-0000-0000-000000000003";
const profile: SupplierProfile = { full_code_column: "CODE", article_code_column: "NOME_FILE", strategy: "article_plus_finish", article_length: 6, finish_length: 3, currency: "EUR", basis: "unknown", price_columns: [{ column: "PRICE", price_field: "unit_price" }] };
const preBasisMigrations = [confirmedUnchangedMigration, completionMigration, deskingMigration, sourceDefinitionsMigration, batchCoverageMigration, definitionWritesMigration, definitionDeleteMigration, dimensionReplaceMigration, capacityHardeningMigration, compactRowsMigration, identityEvidenceMigration];
async function fixture(applyFinishMigration = true, applyBasisMigration = true) {
  const db = new PGlite();
  await db.exec(`create role authenticated; create role anon; create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as $$select '${user}'::uuid$$;
    create table profiles(id uuid primary key);insert into profiles values('${user}');
    create table brands(id uuid primary key,stored_price_basis text,last_price_list_checked_at timestamptz);insert into brands values('${brand}','unknown','2026-05-19');
    create table product_templates(id uuid primary key,brand_id uuid,template_name text,is_active boolean,pricing_version bigint,default_unit_price numeric,currency text,variant_pricing jsonb,category_pricing jsonb,desking_size_pricing jsonb,accessory_pricing jsonb,last_price_checked_at timestamptz,last_price_checked_by uuid,item_code text);insert into product_templates values('${templateId}','${brand}','Existing',true,4,150,'EUR','[]','[]','[]','[]',null,null,'111001');
    create table product_components(id uuid primary key,unit_price numeric,template_id uuid,component_code text,currency text,is_active boolean);insert into product_components values('${templateId}',88,'${templateId}','COMP','EUR',true);
    create table quotations(id uuid primary key,total numeric);insert into quotations values('${templateId}',500);
    create table product_template_price_history(id uuid primary key default gen_random_uuid(),note text);
    create table product_template_detail_price_history(id uuid primary key default gen_random_uuid(),note text);
    create table brand_price_list_updates(id uuid primary key,brand_id uuid,status text,coverage_mode text);insert into brand_price_list_updates values('${templateId}','${brand}','draft','partial');
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;
    create function current_user_role() returns text language sql stable as $$select current_setting('test.role',true)$$;
    create function current_account_status() returns text language sql stable as $$select current_setting('test.status',true)$$;
    create function current_user_can_review_brand_prices() returns boolean language sql stable as $$select coalesce(current_setting('test.status',true)='active' and current_setting('test.role',true) in ('system_owner','admin_manager','procurement_manager','sales_coordinator','designer'),false)$$;
    create function current_user_can_approve_brand_prices() returns boolean language sql stable as $$select coalesce(current_setting('test.status',true)='active' and current_setting('test.role',true) in ('system_owner','admin_manager','procurement_manager','sales_coordinator','designer'),false)$$;
    select set_config('test.status','active',false),set_config('test.role','system_owner',false);`);
  await db.exec(migration); if (applyFinishMigration) await db.exec(finishMigration); for (const sql of preBasisMigrations) await db.exec(sql); if (applyBasisMigration) await db.exec(basisMigration); return db;
}
async function write(db: PGlite, operation: string, payload: Record<string, unknown>) { return (await db.query<{ result: { id: string } }>("select supplier_price_review_write($1,$2::jsonb) result", [operation, JSON.stringify(payload)])).rows[0].result; }
async function sourceFixture(db: PGlite, count = 3) {
  const p = await write(db, "profile", { brand_id: brand, title: "LAS", config: profile });
  const s = await write(db, "source", { profile_id: p.id, expected_profile: profile, title: "Version 1", filename: "source.xlsx", source_type: "xlsx", file_hash: "a".repeat(64), expected_rows: count, expected_cells: count, expected_chunks: 2 });
  return s.id;
}
const rows = [144, 145, 146].map((finish, index) => ({ unit_key: `row-${index}`, sheet: "Source", row_number: index + 2, values: { CODE: `111001${finish}`, NOME_FILE: "111001", PRICE: 152, ECOTAXE: 99 } }));
const chunk = (sourceId: string, index: number, rawRows: RawSupplierRow[] = rows.slice(0, 2)) => ({ source_id: sourceId, chunk_index: index, rows: rawRows, cells: normalizeSupplierRows(rawRows, profile) });

test("atomic source lifecycle, retry equality, completeness, immutable finalized master", async () => {
  const db = await fixture(); try {
    const id = await sourceFixture(db);
    await assert.rejects(write(db, "batch", { source_id: id, scope: "partial", title: "Review", expected_matches: 0, expected_chunks: 0 }), /finalized imported/);
    await write(db, "chunk", chunk(id, 0)); await write(db, "chunk", chunk(id, 0));
    assert.equal((await db.query<{ count: number }>("select count(*)::int count from supplier_source_rows")).rows[0].count, 2);
    await assert.rejects(write(db, "chunk", { ...chunk(id, 0), rows: [rows[0]] }), /retry payload changed/);
    await assert.rejects(write(db, "finalize_source", { source_id: id }), /Import incomplete/);
    await write(db, "chunk", chunk(id, 1, rows.slice(2))); await write(db, "finalize_source", { source_id: id });
    await write(db, "finalize_source", { source_id: id });
    const s = (await db.query<{ status: string; stored_rows: number; identity_count: number }>("select status,stored_rows,identity_count from supplier_source_versions")).rows[0]; assert.equal(s.status, "imported"); assert.equal(s.stored_rows, 3); assert.equal(s.identity_count, 1);
    const identity = (await db.query<{ data: SourceIdentity }>("select data from supplier_source_identities")).rows[0].data; assert.equal(identity.price, 152); assert.equal(identity.row_keys.length, 3); assert.equal(identity.dimension, "");
    assert.deepEqual(identity.finishes, ["144", "145", "146"]);
    assert.equal((await db.query<{ raw_extras: Record<string, unknown> }>("select raw_extras from supplier_source_rows limit 1")).rows[0].raw_extras.ECOTAXE, undefined);
    await assert.rejects(write(db, "chunk", chunk(id, 0)), /immutable/);
    await assert.rejects(db.exec("set role authenticated; update supplier_source_versions set status='imported'"), /permission denied/); await db.exec("reset role");
  } finally { await db.close(); }
});
test("authorized basis confirmations are source-scoped, profile-safe and price-safe", async () => {
  const db = await fixture(); try {
    const sourceId = await sourceFixture(db);
    const profileBefore = (await db.query<{ config: unknown }>("select config from supplier_price_profiles where title='LAS'")).rows[0].config;
    const untouchedBefore = await db.query("select row_to_json(t) data from product_templates t union all select row_to_json(c) from product_components c union all select row_to_json(q) from quotations q");
    const second = await write(db, "source", { profile_id: (await db.query<{ id: string }>("select id from supplier_price_profiles where title='LAS'")).rows[0].id, expected_profile: profile, title: "Historical version", filename: "old.xlsx", source_type: "xlsx", file_hash: "b".repeat(64), expected_rows: 1, expected_cells: 1, expected_chunks: 1 });
    await write(db, "source_basis_update", { brand_id: brand, source_id: sourceId, basis: "list" });
    assert.equal((await db.query<{ basis: string }>("select basis from supplier_source_versions where id=$1", [sourceId])).rows[0].basis, "list");
    assert.equal((await db.query<{ basis: string }>("select basis from supplier_source_versions where id=$1", [second.id])).rows[0].basis, "unknown");
    assert.deepEqual((await db.query<{ config: unknown }>("select config from supplier_price_profiles where title='LAS'")).rows[0].config, profileBefore);
    await write(db, "source_basis_update", { brand_id: brand, source_id: sourceId, basis: "net" });
    assert.equal((await db.query<{ basis: string }>("select basis from supplier_source_versions where id=$1", [sourceId])).rows[0].basis, "net");
    const otherBrand = "00000000-0000-0000-0000-000000000099"; await db.query("insert into brands(id,stored_price_basis) values($1,'unknown')", [otherBrand]);
    for (const payload of [{ brand_id: brand, source_id: sourceId, basis: "unknown" }, { brand_id: otherBrand, source_id: sourceId, basis: "list" }]) await assert.rejects(write(db, "source_basis_update", payload), /Price basis must be list or net|does not belong/);
    await write(db, "brand_basis_update", { brand_id: brand, basis: "list" }); assert.equal((await db.query<{ stored_price_basis: string }>("select stored_price_basis from brands where id=$1", [brand])).rows[0].stored_price_basis, "list");
    await write(db, "brand_basis_update", { brand_id: brand, basis: "net" }); assert.equal((await db.query<{ stored_price_basis: string }>("select stored_price_basis from brands where id=$1", [brand])).rows[0].stored_price_basis, "net");
    await assert.rejects(write(db, "brand_basis_update", { brand_id: brand, basis: "unknown" }), /Price basis must be list or net/);
    await db.query("select set_config('test.role','viewer',false)"); await assert.rejects(write(db, "brand_basis_update", { brand_id: brand, basis: "list" }), /insufficient_privilege/);
    assert.deepEqual(await db.query("select row_to_json(t) data from product_templates t union all select row_to_json(c) from product_components c union all select row_to_json(q) from quotations q"), untouchedBefore);
  } finally { await db.close(); }
});
test("basis migration patches the complete predecessor RPC once and still fails closed", async () => {
  const db = await fixture(true, false); try {
    const before = (await db.query<{ definition: string }>("select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) definition")).rows[0].definition;
    assert.match(before, /definition_delete/); assert.doesNotMatch(before, /source_basis_update|brand_basis_update/);
    await db.exec(basisMigration);
    const after = (await db.query<{ definition: string }>("select pg_get_functiondef('public.supplier_price_review_write(text,jsonb)'::regprocedure) definition")).rows[0].definition;
    assert.match(after, /source_basis_update/); assert.match(after, /brand_basis_update/); assert.match(after, /definition_delete/); assert.match(after, /archive_dimension/);
  } finally { await db.close(); }
  const wrong = await fixture(true, false); try {
    await assert.rejects(wrong.exec(basisMigration.replace("'source_definition','definition_delete'", "'source_definition','missing_operation'")), /Deployed Supplier write RPC differs from the expected body/);
  } finally { await wrong.close(); }
});
test("review persisted across sessions; mapping, bulk shared bindings and hard safety snapshots", async () => {
  const db = await fixture(); try {
    const before = (await db.query("select row_to_json(t) data from product_templates t union all select row_to_json(c) from product_components c union all select row_to_json(b) from brands b union all select row_to_json(q) from quotations q union all select row_to_json(u) from brand_price_list_updates u")).rows;
    const id = await sourceFixture(db); await write(db, "chunk", chunk(id, 0)); await write(db, "chunk", chunk(id, 1, rows.slice(2))); await write(db, "finalize_source", { source_id: id });
    const identity = (await db.query<{ data: SourceIdentity }>("select data from supplier_source_identities")).rows[0].data;
    const targets = brandPriceTargets([{ id: templateId, brand_id: brand, template_name: "Existing", pricing_version: 4, item_code: "111001", default_unit_price: 150, currency: "EUR" }]);
    const matches = matchSupplierPrices([identity], targets);
    const batch = await write(db, "batch", { source_id: id, scope: "selected_templates", selected_template_ids: [templateId], title: "Review", expected_matches: matches.length, expected_chunks: 1, brand_price_list_update_id: templateId });
    await assert.rejects(write(db, "finalize_batch", { batch_id: batch.id }), /Matching incomplete/);
    await write(db, "match_chunk", { batch_id: batch.id, chunk_index: 0, matches }); await write(db, "match_chunk", { batch_id: batch.id, chunk_index: 0, matches }); await write(db, "finalize_batch", { batch_id: batch.id });
    await write(db, "decision", { batch_id: batch.id, key: matches[0].key, decision: "skip", note: "Continue tomorrow" });
    assert.equal((await db.query<{ state: string }>("select state from supplier_template_review_units")).rows[0].state, "REVIEWED");
    await db.exec("set role authenticated"); assert.equal((await db.query<{ decision: string }>("select decision from supplier_price_decisions")).rows[0].decision, "skip"); await db.exec("reset role");
    await write(db, "decision", { batch_id: batch.id, key: matches[0].key, decision: "reject", note: "Rejected" });
    await write(db, "decision", { batch_id: batch.id, key: matches[0].key, decision: "mapping_proposed", proposed_target_keys: [targets[0].key] });
    await write(db, "bindings", { bindings: [1, 2].map((n) => ({ brand_id: brand, code: `ALIAS-${n}`, price_field: "unit_price", source_dimension: "", kind: "alias", baseline_snapshot: targets })) });
    assert.equal((await db.query<{ count: number }>("select count(*)::int count from supplier_price_bindings")).rows[0].count, 2);
    await write(db, "dimension", { brand_id: brand, raw_labels: ["Cat A", "A"], finish_codes: ["144", "145"], dimension_code: "cat_a", template_id: templateId, group_id: "group" });
    await assert.rejects(write(db, "bindings", { bindings: [{ brand_id: brand, code: "SHARED", price_field: "unit_price", source_dimension: "", kind: "shared", baseline_snapshot: [targets[0], { ...targets[0], key: "second", price: 151 }] }] }), /baseline drift/);
    const after = (await db.query("select row_to_json(t) data from product_templates t union all select row_to_json(c) from product_components c union all select row_to_json(b) from brands b union all select row_to_json(q) from quotations q union all select row_to_json(u) from brand_price_list_updates u")).rows; assert.deepEqual(after, before);
    await write(db, "archive_source", { source_id: id }); assert.equal((await db.query<{ count: number }>("select count(*)::int count from supplier_source_identities")).rows[0].count, 1);
  } finally { await db.close(); }
});
test("SQL authoritative role sets; inactive and unauthorized roles cannot import/configure", async () => {
  const db = await fixture(); try {
    const id = await sourceFixture(db);
    for (const role of ["system_owner", "admin_manager", "procurement_manager", "designer", "sales_designer", "sales_coordinator", "viewer"]) for (const status of ["active", "disabled", "pending"]) {
      await db.query("select set_config('test.role',$1,false),set_config('test.status',$2,false)", [role, status]);
      await db.exec("set role authenticated");
      const allowed = status === "active" && ["system_owner", "admin_manager", "procurement_manager", "sales_coordinator", "designer"].includes(role);
      if (allowed) { await write(db, "chunk", chunk(id, 0)); assert.ok((await db.query("select id from supplier_source_versions")).rows.length); }
      else await assert.rejects(write(db, "chunk", chunk(id, 0)), /insufficient_privilege/);
      const approve = status === "active" && ["system_owner", "admin_manager", "procurement_manager", "sales_coordinator", "designer"].includes(role);
      if (approve) await write(db, "profile", { brand_id: brand, title: "Updated", config: profile });
      else await assert.rejects(write(db, "profile", { brand_id: brand, title: "Updated", config: profile }), /insufficient_privilege/);
      await db.exec("reset role");
    }
  } finally { await db.close(); }
});

test("46,108 LAS-like rows ingest in bounded chunks and finalize the whole master atomically", async () => {
  const db = await fixture(); try {
    const raw = Array.from({ length: 46108 }, (_, index) => {
      const article = String(100000 + Math.floor(index / 16));
      return { unit_key: `row-${index}`, sheet: "LAS", row_number: index + 2, values: { CODE: article + String(100 + index % 16), NOME_FILE: article, PRICE: 100 + Math.floor(index / 16), ECOTAXE: 99 } };
    });
    const chunks = supplierImportChunks(raw, 500, 600_000, profile);
    assert.equal(chunks.length, 185);
    const p = await write(db, "profile", { brand_id: brand, title: "LAS scale", config: profile });
    const payload = { profile_id: p.id, expected_profile: profile, title: "LAS 46k", filename: "las.xlsx", source_type: "xlsx", file_hash: "b".repeat(64), expected_rows: raw.length, expected_cells: raw.length, expected_chunks: chunks.length };
    const s = await write(db, "source", payload);
    assert.equal((await write(db, "source", payload)).id, s.id);
    await assert.rejects(write(db, "source", { ...payload, expected_profile: { ...profile, basis: "net" } }), /profile changed/);
    for (let index = 0; index < chunks.length - 1; index++) await write(db, "chunk", chunk(s.id, index, chunks[index]));
    await assert.rejects(write(db, "finalize_source", { source_id: s.id }), /Import incomplete/);
    await write(db, "chunk", chunk(s.id, chunks.length - 1, chunks.at(-1)!));
    await write(db, "chunk", chunk(s.id, chunks.length - 1, chunks.at(-1)!));
    await write(db, "finalize_source", { source_id: s.id });
    const result = (await db.query<{ status: string; stored_rows: number; stored_cells: number; identity_count: number }>("select status,stored_rows,stored_cells,identity_count from supplier_source_versions where id=$1", [s.id])).rows[0];
    assert.deepEqual(result, { status: "imported", stored_rows: 46108, stored_cells: 46108, identity_count: 2882 });
    let count = 0;
    for (let from = 0; ; from += 500) {
      const page = (await db.query("select key from supplier_source_identities where source_id=$1 order by key limit 500 offset $2", [s.id, from])).rows;
      count += page.length; if (page.length < 500) break;
    }
    assert.equal(count, 2882);
  } finally { await db.close(); }
});

test("DB finish tiers, numeric-code issues and companion provenance survive finalization", async () => {
  const db = await fixture(); try {
    const config = { ...profile, companion_note_column: "COMPANION" };
    const p = await write(db, "profile", { brand_id: brand, title: "Tiers", config });
    const raw = [...rows.map((r, i) => ({ ...r, values: { ...r.values, PRICE: i === 2 ? 190 : 152, COMPANION: "Referenced component supplied separately" } })), { ...rows[0], unit_key: "numeric", values: { CODE: 111001144, NOME_FILE: 111001, PRICE: 3 } }];
    const s = await write(db, "source", { profile_id: p.id, expected_profile: config, title: "Tiers", filename: "tier.xlsx", source_type: "xlsx", file_hash: "c".repeat(64), expected_rows: 4, expected_cells: 4, expected_chunks: 1 });
    await write(db, "chunk", { source_id: s.id, chunk_index: 0, rows: raw, cells: normalizeSupplierRows(raw, config) });
    await write(db, "finalize_source", { source_id: s.id });
    const data = (await db.query<{ data: SourceIdentity }>("select data from supplier_source_identities order by key")).rows.map((r) => r.data);
    assert.equal(data.length, 3); assert.equal(data.filter((r) => r.finishes.length).length, 2);
    assert.ok(data.find((r) => r.issues.includes("numeric_or_non_text_code")));
    assert.ok(data.filter((r) => r.code === "111001").every((r) => r.companion_notes?.length === 1));
    assert.ok(matchSupplierPrices(data, []).some((m) => m.classification === "referenced_companion"));
    await assert.rejects(write(db, "profile", { brand_id: brand, title: "Bad currency", config: { ...profile, currency: "GBP" } }), /Invalid import profile/);
  } finally { await db.close(); }
});

test("bulk shared confirmation, shared decisions, stale/forged baseline rejection and immutable storage", async () => {
  const db = await fixture(); try {
    const otherId = "00000000-0000-0000-0000-000000000004";
    await db.query("insert into product_templates select $1::uuid,brand_id,'Other',is_active,pricing_version,default_unit_price,currency,variant_pricing,category_pricing,desking_size_pricing,accessory_pricing,last_price_checked_at,last_price_checked_by,item_code from product_templates where id=$2", [otherId, templateId]);
    const id = await sourceFixture(db);
    const path = `${brand}/${id}/${"a".repeat(64)}.xlsx`;
    await db.exec("set role authenticated");
    await db.query("insert into storage.objects(bucket_id,name) values('supplier-price-sources',$1)", [path]);
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('supplier-price-sources',$1)", [path + ".wrong"]), /row-level security/);
    await assert.rejects(db.query("update storage.objects set name='changed'"), /permission denied/);
    await db.exec("reset role"); await write(db, "attach_file", { source_id: id, path });
    await write(db, "chunk", chunk(id, 0)); await write(db, "chunk", chunk(id, 1, rows.slice(2))); await write(db, "finalize_source", { source_id: id });
    const targets = brandPriceTargets([templateId, otherId].map((id) => ({ id, brand_id: brand, template_name: id, pricing_version: 4, item_code: "111001", default_unit_price: 150, currency: "EUR" })));
    await write(db, "bindings", { bindings: ["111001", "SECOND"].map((code) => ({ brand_id: brand, code, price_field: "unit_price", source_dimension: "", kind: "shared", baseline_snapshot: targets })) });
    assert.equal((await db.query<{ count: number }>("select count(*)::int count from supplier_price_bindings")).rows[0].count, 2);
    const invalid = { brand_id: brand, code: "BAD", price_field: "unit_price", source_dimension: "", kind: "alias", baseline_snapshot: [{ ...targets[0], price: 999 }] };
    await assert.rejects(write(db, "bindings", { bindings: [invalid] }), /changed or forged/);
    await assert.rejects(write(db, "bindings", { bindings: [{ ...invalid, baseline_snapshot: [{ ...targets[0], pricing_version: "3" }] }] }), /baseline changed/);
    const identity = (await db.query<{ data: SourceIdentity }>("select data from supplier_source_identities")).rows[0].data;
    const matches = matchSupplierPrices([identity], targets, [], [{ id: "shared", code: "111001", price_field: "unit_price", source_dimension: "", kind: "shared", target_keys: targets.map((t) => t.key), confirmed: true }]);
    const b = await write(db, "batch", { source_id: id, scope: "complete", title: "Shared", expected_matches: matches.length, expected_chunks: 1 });
    await write(db, "match_chunk", { batch_id: b.id, chunk_index: 0, matches }); await write(db, "finalize_batch", { batch_id: b.id });
    await write(db, "decision", { batch_id: b.id, key: matches[0].key, decision: "reviewed" });
    assert.equal((await db.query("select template_id from supplier_template_review_units where state='REVIEWED'")).rows.length, 2);
    await db.exec("set role authenticated");
    assert.equal((await db.query("select name from storage.objects")).rows.length, 1);
    await db.query("select set_config('test.status','disabled',false)");
    assert.equal((await db.query("select name from storage.objects")).rows.length, 0);
    await db.exec("reset role");
  } finally { await db.close(); }
});

test("SQL baseline locators verify every pricing architecture without any Product mutations", async () => {
  const db = await fixture(); try {
    const t = { id: templateId, brand_id: brand, template_name: "Existing", pricing_version: 4, currency: "EUR", item_code: "111001", default_unit_price: 150,
      variant_pricing: [{ id: "base", items: [{ id: "base-row", supplier_price_list_code: "BASE", price: 10 }] }, { id: "size-row", supplier_price_list_code: "SIZE", price: 11 }],
      category_pricing: [{ id: "matrix", price_columns: [{ id: "col_a", label: "A", dimension_code: "cat_a" }], items: [{ id: "matrix-row", supplier_price_list_code: "MATRIX", prices: { col_a: 20 } }] }, { id: "direct", pricing_type: "modular_group", modular_pricing_mode: "direct", items: [{ id: "direct-row", supplier_price_list_code: "DIRECT", price: 30 }] }, { id: "mod-matrix", pricing_type: "modular_group", price_columns: [{ id: "col_b", label: "B", dimension_code: "cat_b" }], items: [{ id: "mod-row", supplier_price_list_code: "MOD", prices: { col_b: 40 } }] }, { id: "flat-matrix", supplier_price_list_code: "FLAT", price_columns: [{ id: "col_c", label: "C", dimension_code: "cat_c" }], prices: { col_c: 41 } }],
      desking_size_pricing: [{ id: "ws", items: [{ id: "ws-row", base_supplier_price_list_code: "WS", additional_supplier_price_list_code: "WS-ADD", default_price: 50, additional_price: 60 }] }],
      accessory_pricing: [{ id: "acc", items: [{ id: "acc-row", supplier_price_list_code: "ACC", price: 70 }] }, { id: "acc-matrix", price_categories: [{ id: "acc-a" }], items: [{ id: "acc-matrix-row", supplier_price_list_code: "ACC-MATRIX", prices: { "acc-a": 71 } }] }],
    };
    await db.query("update product_templates set variant_pricing=$1::jsonb,category_pricing=$2::jsonb,desking_size_pricing=$3::jsonb,accessory_pricing=$4::jsonb where id=$5", [JSON.stringify(t.variant_pricing), JSON.stringify(t.category_pricing), JSON.stringify(t.desking_size_pricing), JSON.stringify(t.accessory_pricing), templateId]);
    const before = (await db.query("select row_to_json(t) data from product_templates t union all select row_to_json(c) from product_components c")).rows;
    const targets = brandPriceTargets([t], [{ id: templateId, template_id: templateId, component_code: "COMP", unit_price: 88, currency: "EUR" }]);
    assert.equal(targets.length, 11);
    await write(db, "bindings", { bindings: targets.map((target) => ({ brand_id: brand, code: target.code, price_field: target.price_field, source_dimension: target.dimension, kind: "alias", baseline_snapshot: [target] })) });
    for (const target of targets) await assert.rejects(write(db, "bindings", { bindings: [{ brand_id: brand, code: target.code, price_field: target.price_field, source_dimension: target.dimension, kind: "alias", baseline_snapshot: [{ ...target, price: 999 }] }] }), /changed or forged/);
    const after = (await db.query("select row_to_json(t) data from product_templates t union all select row_to_json(c) from product_components c")).rows;
    assert.deepEqual(after, before);
  } finally { await db.close(); }
});

test("forward migration preserves imported snapshots and privileges; same-file new-title reimport retains finishes", async () => {
  const db = await fixture(false); try {
    const oldId = await sourceFixture(db);
    await write(db, "chunk", chunk(oldId, 0)); await write(db, "chunk", chunk(oldId, 1, rows.slice(2))); await write(db, "finalize_source", { source_id: oldId });
    const snapshot = async () => (await db.query("select row_to_json(s) data from supplier_source_versions s where id=$1 union all select row_to_json(i) from supplier_source_identities i where source_id=$1", [oldId])).rows;
    const oldSnapshot = await snapshot();
    assert.deepEqual((await db.query<{ data: SourceIdentity }>("select data from supplier_source_identities where source_id=$1", [oldId])).rows[0].data.finishes, []);
    const privileges = async () => (await db.query("select proowner,proacl,prosecdef,proconfig from pg_proc where oid='public.supplier_price_review_write(text,jsonb)'::regprocedure")).rows;
    const permissionsBefore = await privileges();
    const pricesBefore = (await db.query("select row_to_json(t) data from product_templates t union all select row_to_json(c) from product_components c union all select row_to_json(b) from brands b union all select row_to_json(q) from quotations q union all select row_to_json(u) from brand_price_list_updates u")).rows;
    await db.exec(finishMigration); await db.exec(finishMigration);
    assert.deepEqual(await snapshot(), oldSnapshot); assert.deepEqual(await privileges(), permissionsBefore);
    await write(db, "finalize_source", { source_id: oldId }); assert.deepEqual(await snapshot(), oldSnapshot);
    assert.equal(await sourceFixture(db), oldId); // Same commercial version is still reused, never silently corrected.
    const p = await write(db, "profile", { brand_id: brand, title: "LAS", config: profile });
    const payload = { profile_id: p.id, expected_profile: profile, title: "Version 1 — corrected finish evidence", filename: "source.xlsx", source_type: "xlsx", file_hash: "a".repeat(64), expected_rows: 3, expected_cells: 3, expected_chunks: 2 };
    const fresh = await write(db, "source", payload); assert.equal(fresh.id, oldId); assert.equal((await write(db, "source", payload)).id, oldId);
    assert.deepEqual(await snapshot(), oldSnapshot);
    const pricesAfter = (await db.query("select row_to_json(t) data from product_templates t union all select row_to_json(c) from product_components c union all select row_to_json(b) from brands b union all select row_to_json(q) from quotations q union all select row_to_json(u) from brand_price_list_updates u")).rows;
    assert.deepEqual(pricesAfter, pricesBefore);
  } finally { await db.close(); }
});
