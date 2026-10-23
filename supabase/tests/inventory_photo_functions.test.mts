import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const sql = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
test("inventory photos: migration is repeatable and rollback-only SQL assertions pass offline", async (t) => {
  const db = new PGlite();
  try {
    // Disposable stand-ins for Supabase platform objects; inventory migrations run unchanged.
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create type public.user_role as enum ('system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer','viewer','warehouse_staff');
      create type public.account_status as enum ('active','pending','disabled');
      create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb, raw_user_meta_data jsonb);
      create table public.profiles(id uuid primary key references auth.users, email text, full_name text, role public.user_role, account_status public.account_status);
      create table public.brands(id uuid primary key default gen_random_uuid(), name text, is_active boolean default true);
      create function auth.uid() returns uuid language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
      $$;
      grant usage on schema auth to authenticated, anon, service_role;
      create function public.current_user_role() returns public.user_role language sql stable security definer as $$ select role from public.profiles where id=auth.uid() $$;
      create function public.current_account_status() returns public.account_status language sql stable security definer as $$ select account_status from public.profiles where id=auth.uid() $$;
      create function public.current_user_can_access_inventory() returns boolean language sql stable security definer as $$ select public.current_account_status()='active' and public.current_user_role() is not null $$;
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security;
      create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
      create function storage.filename(text) returns text language sql immutable as $$ select (string_to_array($1,'/'))[array_length(string_to_array($1,'/'),1)] $$;
    `);
    await db.exec(await sql("../migrations/20261023100000_inventory_schema.sql"));
    await db.exec(await sql("../migrations/20261023100100_inventory_rls_and_storage.sql"));
    const migration = await sql("../migrations/20261023110000_inventory_functions.sql");
    await db.exec(migration);
    await db.exec(migration);
    const photos = await sql("../migrations/20261023120000_inventory_photo_functions.sql");
    await db.exec(photos);
    await db.exec(photos);
    await t.test("existing inventory schema SQL assertions", async () => {
      await db.exec(await sql("./inventory_schema.sql"));
    });
    await t.test("inventory function SQL assertions", async () => {
      await db.exec(await sql("./inventory_functions.sql"));
    });
    await t.test("photo role matrix, ordering and removal assertions", async () => {
      await db.exec(await sql("./inventory_photo_functions.sql"));
    });
    assert.equal((await db.query("select id from auth.users")).rows.length, 0);
    assert.equal((await db.query("select id from inventory.product_images")).rows.length, 0);
    await t.test("photo rollback restores original partial indexes and removes RPCs", async () => {
      const rollback = photos.split("-- ROLLBACK (manual).")[1].split("\n").slice(1).join("\n").replace(/^-- ?/gm, "");
      await db.exec(rollback);
      assert.equal((await db.query("select 1 from pg_proc where pronamespace='inventory'::regnamespace and proname in ('set_main_product_photo','remove_product_photo')")).rows.length, 0);
      const indexes = await db.query<{ predicate: string | null }>("select pg_get_expr(indpred,indrelid) predicate from pg_index where indexrelid in ('inventory.product_images_product_sort_order_key'::regclass,'inventory.product_images_request_sort_order_key'::regclass)");
      assert.equal(indexes.rows.length, 2);
      assert.ok(indexes.rows.every(row => row.predicate?.includes("IS NOT NULL")));
      await db.exec(await sql("./inventory_schema.sql"));
      await db.exec(await sql("./inventory_functions.sql"));
    });
  } finally { await db.close(); }
});
