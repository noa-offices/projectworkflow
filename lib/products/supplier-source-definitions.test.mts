import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supplierBrandMatches, supplierSourceCoverageConflicts, supplierSourceCoverageSuggestion, supplierSourceDefinitionsForBrand } from "./supplier-price-repository.js";

const read = (name: string) => readFile(new URL(`../../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
const [sourceReview, definitions, definitionWrites, definitionDelete] = await Promise.all([read("20261002082357_supplier_price_source_review"), read("20261005090000_supplier_source_definitions"), read("20261005180000_supplier_source_definition_writes"), read("20261005210000_supplier_source_definition_delete")]);
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const user = id(1), brand = id(2), otherBrand = id(3), sourceA = id(10), sourceB = id(11), otherSource = id(12);
const mono = id(21), oxi = id(22), lead = id(23), foreign = id(24), lateFamily = id(25), profileA = id(31), profileForeign = id(32), furniture = id(41), chairs = id(42), retired = id(43), foreignDefinition = id(44);

const pgClient = (db: PGlite) => ({
  from(table: string) {
    const filters: Array<[string, unknown]> = []; let order: string | null = null, start = 0, end = 999;
    const execute = async () => {
      let rows: Record<string, unknown>[];
      if (table === "product_components") rows = (await db.query<Record<string, unknown>>("select c.* from product_components c join product_templates t on t.id=c.template_id where t.brand_id=$1 and c.is_active order by c.id", [filters.find(([key]) => key === "product_templates.brand_id")?.[1]])).rows;
      else {
        const params: unknown[] = []; const where: string[] = [];
        for (const [key, value] of filters) { params.push(value); where.push(`"${key}"=$${params.length}`); }
        rows = (await db.query<Record<string, unknown>>(`select * from public.${table}${where.length ? ` where ${where.join(" and ")}` : ""}${order ? ` order by "${order}"` : ""} limit ${end - start + 1} offset ${start}`, params)).rows;
      }
      return rows.map((row) => {
        const copy = { ...row };
        if (typeof copy.default_unit_price === "string") copy.default_unit_price = Number(copy.default_unit_price);
        if (table === "product_templates" && copy.pricing_version !== undefined) copy.pricing_version = String(copy.pricing_version);
        for (const field of ["created_at", "confirmed_at", "received_at"]) if (copy[field] instanceof Date) copy[field] = (copy[field] as Date).toISOString();
        return copy;
      });
    };
    return { select() { return this; }, eq(key: string, value: unknown) { filters.push([key, value]); return this; }, order(column: string) { order = column; return this; }, range(from: number, to: number) { start = from; end = to; return this; },
      async single() { const rows = await execute(); return { data: rows.length === 1 ? rows[0] : null, error: rows.length === 1 ? null : { message: "Record unavailable" } }; },
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) { return execute().then((data) => resolve({ data, error: null }), reject); } };
  },
}) as unknown as SupabaseClient;

const template = (templateId: string, owner: string, name: string, code: string, createdAt = "2026-01-01T00:00:00Z") =>
  `insert into product_templates(id,brand_id,template_name,is_active,pricing_version,default_unit_price,currency,variant_pricing,category_pricing,desking_size_pricing,accessory_pricing,item_code,created_at) values('${templateId}','${owner}','${name}',true,1,100,'EUR','[]','[]','[]','[]','${code}','${createdAt}');`;
const identity = (sourceId: string, code: string) => `insert into supplier_source_identities(source_id,key,code,data) values('${sourceId}','${code}-key','${code}','${JSON.stringify({ key: `${code}-key`, code, price_field: "unit_price", dimension: "", finishes: [], price: 100, currency: "EUR", row_keys: ["r"], issues: [] })}');`;
const version = (versionId: string, owner: string, title: string, definitionId = "null") =>
  `insert into supplier_source_versions(id,brand_id,title,filename,file_hash,source_type,currency,basis,profile,status,expected_rows,expected_cells,expected_chunks,created_by,definition_id) values('${versionId}','${owner}','${title}','f.xlsx','${"a".repeat(64)}','xlsx','EUR','unknown','{}','imported',1,1,1,'${user}',${definitionId === "null" ? "null" : `'${definitionId}'`});`;

async function fixture() {
  const db = new PGlite();
  await db.exec(`create role authenticated; create role anon; create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql as $$select '${user}'::uuid$$;
    create table profiles(id uuid primary key);insert into profiles values('${user}');
    create table brands(id uuid primary key,stored_price_basis text,last_price_list_checked_at timestamptz);insert into brands values('${brand}','unknown',null),('${otherBrand}','unknown',null);
    create table product_templates(id uuid primary key,brand_id uuid,template_name text,is_active boolean,pricing_version bigint,default_unit_price numeric,currency text,variant_pricing jsonb,category_pricing jsonb,desking_size_pricing jsonb,accessory_pricing jsonb,last_price_checked_at timestamptz,last_price_checked_by uuid,item_code text,created_at timestamptz default now());
    create table product_components(id uuid primary key,unit_price numeric,template_id uuid,component_code text,currency text,is_active boolean);
    create table quotations(id uuid primary key,total numeric);
    create table brand_price_list_updates(id uuid primary key,brand_id uuid,status text,coverage_mode text);
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;grant usage on schema storage to authenticated;grant select,insert on storage.objects to authenticated;
    create function current_user_can_review_brand_prices() returns boolean language sql stable as $$select true$$;
    create function current_user_can_approve_brand_prices() returns boolean language sql stable as $$select true$$;`);
  await db.exec(sourceReview); await db.exec(definitions); await db.exec(definitionWrites); await db.exec(definitionDelete);
  await db.exec(`
    ${template(mono, brand, "MONOLITH", "1AF 044")}${template(oxi, brand, "OXI_P", "111069")}${template(lead, brand, "LEAD", "L1")}${template(foreign, otherBrand, "FOREIGN", "1AF 044")}
    insert into supplier_price_profiles(id,brand_id,title,config) values('${profileA}','${brand}','LAS','{}'),('${profileForeign}','${otherBrand}','Other','{}');
    insert into supplier_source_definitions(id,brand_id,name,profile_id) values('${furniture}','${brand}','LAS Furniture','${profileA}'),('${chairs}','${brand}','LAS Chairs',null),('${foreignDefinition}','${otherBrand}','Other furniture',null);
    insert into supplier_source_definitions(id,brand_id,name,is_active) values('${retired}','${brand}','Retired',false);
    ${version(sourceA, brand, "Oct 2026", furniture)}${version(sourceB, brand, "Legacy")}${version(otherSource, otherBrand, "Other brand")}
    ${identity(sourceA, "1AF044")}${identity(sourceA, "111069")}${identity(sourceB, "L1")}${identity(otherSource, "L1")}${identity(otherSource, "1AF044")}`);
  return db;
}
const withDb = async (run: (db: PGlite, client: SupabaseClient) => Promise<void>) => { const db = await fixture(); try { await run(db, pgClient(db)); } finally { await db.close(); } };
const cover = (definition: string, ...templates: string[]) => `insert into supplier_source_definition_families(definition_id,template_id,confirmed_at) values ${templates.map((t) => `('${definition}','${t}','2026-06-01T00:00:00Z')`).join(",")};`;
const row = (rows: Awaited<ReturnType<typeof supplierSourceCoverageSuggestion>>, templateId: string) => rows.find((entry) => entry.templateId === templateId)!;
const write = async (db: PGlite, operation: string, payload: Record<string, unknown>) => db.query("select public.supplier_price_review_write($1,$2::jsonb) result", [operation, JSON.stringify(payload)]);

test("definition writes rename/archive without touching source history; delete is rejected once a source version exists", async () => {
  await withDb(async (db) => {
    await write(db, "definition", { id: chairs, brand_id: brand, name: "LAS Seating" });
    assert.equal((await db.query<{ name: string; is_active: boolean }>("select name,is_active from supplier_source_definitions where id=$1", [chairs])).rows[0].name, "LAS Seating");
    await write(db, "definition", { id: chairs, brand_id: brand, is_active: false });
    assert.equal((await db.query<{ is_active: boolean }>("select is_active from supplier_source_definitions where id=$1", [chairs])).rows[0].is_active, false);
    await write(db, "definition_delete", { id: retired, brand_id: brand });
    assert.equal((await db.query("select 1 from supplier_source_definitions where id=$1", [retired])).rows.length, 0);
    await assert.rejects(write(db, "definition_delete", { id: furniture, brand_id: brand }), /cannot be deleted because it has imported price lists or review history/);
    assert.equal((await db.query("select 1 from supplier_source_versions where id=$1", [sourceA])).rows.length, 1);
  });
});

test("schema: definition and family tables exist, definition_id and coverage_template_ids are nullable and unpopulated", async () => {
  await withDb(async (db) => {
    const columns = (await db.query<{ table_name: string; column_name: string; is_nullable: string }>("select table_name,column_name,is_nullable from information_schema.columns where table_schema='public' and ((table_name='supplier_source_versions' and column_name='definition_id') or (table_name='supplier_price_batches' and column_name='coverage_template_ids') or table_name in ('supplier_source_definitions','supplier_source_definition_families'))")).rows;
    assert.ok(columns.some((c) => c.table_name === "supplier_source_definitions" && c.column_name === "name"));
    assert.ok(columns.some((c) => c.table_name === "supplier_source_definition_families" && c.column_name === "template_id"));
    assert.equal(columns.find((c) => c.column_name === "definition_id")!.is_nullable, "YES");
    assert.equal(columns.find((c) => c.column_name === "coverage_template_ids")!.is_nullable, "YES");
    assert.equal((await db.query("select 1 from supplier_source_versions where id=$1 and definition_id is null", [sourceB])).rows.length, 1); // no backfill
    assert.equal((await db.query("select count(*)::int c from supplier_source_definition_families")).rows[0] && (await db.query<{ c: number }>("select count(*)::int c from supplier_source_definition_families")).rows[0].c, 0);
  });
});

test("constraints: unique (brand, name); one Family may sit in two definitions; nothing crosses Brands", async () => {
  await withDb(async (db) => {
    await assert.rejects(db.exec(`insert into supplier_source_definitions(brand_id,name) values('${brand}','LAS Furniture')`), /duplicate key|unique/);
    await db.exec(`insert into supplier_source_definitions(brand_id,name) values('${otherBrand}','LAS Furniture')`); // same name, another Brand
    await db.exec(cover(furniture, mono) + cover(chairs, mono));
    assert.equal((await db.query<{ c: number }>("select count(*)::int c from supplier_source_definition_families where template_id=$1", [mono])).rows[0].c, 2);
    await assert.rejects(db.exec(cover(furniture, foreign)), /another Brand/);
    await assert.rejects(db.exec(`insert into supplier_source_definitions(brand_id,name,profile_id) values('${brand}','Bad profile','${profileForeign}')`), /another Brand/);
    await assert.rejects(db.exec(`update supplier_source_versions set definition_id='${foreignDefinition}' where id='${sourceA}'`), /foreign key/);
  });
});

test("permissions: authenticated users can read but not write definitions or coverage directly", async () => {
  await withDb(async (db) => {
    await db.exec("set role authenticated");
    assert.equal((await db.query("select 1 from supplier_source_definitions")).rows.length > 0, true);
    await assert.rejects(db.exec(`insert into supplier_source_definitions(brand_id,name) values('${brand}','Forged')`), /permission denied/);
    await assert.rejects(db.exec(`insert into supplier_source_definition_families(definition_id,template_id) values('${furniture}','${lead}')`), /permission denied/);
    await db.exec("reset role");
  });
});

test("conflicts: overlap between active definitions is reported; inactive definitions are ignored; nothing is written", async () => {
  await withDb(async (db, client) => {
    await db.exec(cover(furniture, mono, oxi) + cover(chairs, lead, mono) + cover(retired, oxi));
    const before = (await db.query<{ c: number }>("select count(*)::int c from supplier_source_definition_families")).rows[0].c;
    const conflicts = await supplierSourceCoverageConflicts(client, { brandId: brand });
    assert.deepEqual(conflicts.map((c) => [c.templateName, c.definitions.map((d) => d.definitionName).sort()]), [["MONOLITH", ["LAS Chairs", "LAS Furniture"]]]); // OXI_P overlaps only an inactive definition
    assert.deepEqual((await supplierSourceCoverageConflicts(client, { brandId: brand, definitionId: furniture })).map((c) => c.templateId), [mono]);
    assert.deepEqual(await supplierSourceCoverageConflicts(client, { brandId: otherBrand }), []); // Brand isolation
    assert.equal((await db.query<{ c: number }>("select count(*)::int c from supplier_source_definition_families")).rows[0].c, before);
  });
});

test("suggestion: found/total uses distinct canonical codes; zero overlap is not suggested", async () => {
  await withDb(async (db, client) => {
    await db.exec(`update product_templates set item_code='1AF 044' where id='${mono}'; ${template(id(26), brand, "TWO CODES", "111069")} update product_templates set item_code='1AF  044' where id='${id(26)}';`);
    const rows = await supplierSourceCoverageSuggestion(client, { brandId: brand, sourceId: sourceA });
    assert.deepEqual([row(rows, mono).totalTargetCodes, row(rows, mono).foundTargetCodes, row(rows, mono).foundRatio, row(rows, mono).suggested], [1, 1, 1, true]); // "1AF 044" == source "1AF044"
    assert.deepEqual([row(rows, id(26)).totalTargetCodes, row(rows, id(26)).foundTargetCodes], [1, 1]); // internal whitespace is formatting
    assert.deepEqual([row(rows, lead).totalTargetCodes, row(rows, lead).foundTargetCodes, row(rows, lead).foundRatio, row(rows, lead).suggested], [1, 0, 0, false]); // LEAD's code is only in another source
    assert.equal(rows.some((entry) => entry.templateId === foreign), false); // another Brand's Families never appear
  });
});

test("suggestion: partial overlap is a ratio below the threshold; many physical rows do not inflate the count", async () => {
  await withDb(async (db, client) => {
    await db.exec(`${template(id(27), brand, "HALF", "1AF 044")} update product_templates set variant_pricing='[{"id":"g","items":[{"id":"r0","supplier_price_list_code":"1AF 044","price":1},{"id":"r1","supplier_price_list_code":"NOPE 1","price":1},{"id":"r2","supplier_price_list_code":"NOPE 1","price":1}]}]' where id='${id(27)}';`);
    const half = row(await supplierSourceCoverageSuggestion(client, { brandId: brand, sourceId: sourceA }), id(27));
    assert.deepEqual([half.totalTargetCodes, half.foundTargetCodes, half.foundRatio, half.suggested], [2, 1, 0.5, false]); // NOPE 1 appears twice but counts once
  });
});

test("suggestion: source and Brand isolation", async () => {
  await withDb(async (db, client) => {
    assert.equal(row(await supplierSourceCoverageSuggestion(client, { brandId: brand, sourceId: sourceB }), lead).foundTargetCodes, 1); // its own source counts
    assert.equal(row(await supplierSourceCoverageSuggestion(client, { brandId: brand, sourceId: sourceA }), lead).foundTargetCodes, 0); // another source's L1 does not
    await assert.rejects(supplierSourceCoverageSuggestion(client, { brandId: brand, sourceId: otherSource }), /another Brand/);
    await assert.rejects(supplierSourceCoverageSuggestion(client, { brandId: brand, sourceId: sourceA, definitionId: foreignDefinition }), /unavailable for this Brand/);
    await db.exec("select 1");
  });
});

test("suggestion: prior confirmed coverage is reused; a later Family is flagged new; a Family left out earlier is not", async () => {
  await withDb(async (db, client) => {
    await db.exec(cover(furniture, mono, lead) + template(lateFamily, brand, "LATE", "ZZ1", "2026-09-01T00:00:00Z"));
    const rows = await supplierSourceCoverageSuggestion(client, { brandId: brand, sourceId: sourceA, definitionId: furniture });
    assert.deepEqual([row(rows, lead).previouslyCovered, row(rows, lead).suggested, row(rows, lead).foundTargetCodes], [true, true, 0]); // confirmed coverage wins over overlap
    assert.deepEqual([row(rows, oxi).previouslyCovered, row(rows, oxi).isNewFamily, row(rows, oxi).suggested], [false, false, true]); // existed before the confirmation; strong overlap still suggests
    assert.deepEqual([row(rows, lateFamily).isNewFamily, row(rows, lateFamily).previouslyCovered, row(rows, lateFamily).suggested], [true, false, false]); // created after the last confirmation, no overlap
    const plain = await supplierSourceCoverageSuggestion(client, { brandId: brand, sourceId: sourceA });
    assert.equal(plain.some((entry) => entry.previouslyCovered || entry.isNewFamily), false); // no definition, no history
  });
});

test("definition list: confirmed Family count and latest imported source", async () => {
  await withDb(async (db, client) => {
    await db.exec(cover(furniture, mono, oxi));
    const list = await supplierSourceDefinitionsForBrand(client, brand);
    const furnitureSummary = list.find((entry) => entry.id === furniture)!;
    assert.deepEqual([furnitureSummary.confirmedFamilyCount, furnitureSummary.latestSource?.id, furnitureSummary.profileId], [2, sourceA, profileA]);
    assert.equal(list.find((entry) => entry.id === chairs)!.latestSource, null);
    assert.equal(list.some((entry) => entry.id === foreignDefinition), false);
  });
});

test("legacy: a source without a definition and a batch without coverage review exactly as before", async () => {
  await withDb(async (db, client) => {
    await db.exec(cover(furniture, mono)); // coverage exists for another source but must not influence a legacy source
    const legacy = await supplierBrandMatches(client, sourceB);
    assert.deepEqual(legacy.targets.map((target) => target.template_name).sort(), ["LEAD", "MONOLITH", "OXI_P"]); // every active Brand Family stays in scope
    const classes = Object.fromEntries(legacy.matches.map((match) => [match.targets[0]?.template_name ?? match.source?.code, match.classification]));
    assert.equal(classes.LEAD, "unchanged"); assert.equal(classes.MONOLITH, "target_not_represented"); assert.equal(classes.OXI_P, "target_not_represented");
    await db.exec(`insert into supplier_price_batches(brand_id,source_id,title,scope,expected_matches,expected_chunks,basis_warning,created_by) values('${brand}','${sourceB}','Legacy review','complete',0,0,'',  '${user}')`);
    assert.equal((await db.query<{ c: unknown }>("select coverage_template_ids c from supplier_price_batches")).rows[0].c, null);
  });
});
