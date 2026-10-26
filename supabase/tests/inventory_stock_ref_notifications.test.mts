import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

const sql = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
test("inventory_stock_ref_notifications: rollback-only offline SQL assertions", async () => {
 const db = new PGlite();
 try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage;
      create type public.user_role as enum ('system_owner','admin_manager','procurement_manager','sales_designer','sales_coordinator','designer','viewer','warehouse_staff');
      create type public.account_status as enum ('active','pending','disabled');
      create table auth.users(id uuid primary key, email text, raw_app_meta_data jsonb, raw_user_meta_data jsonb);
      create table public.profiles(id uuid primary key references auth.users, email text, full_name text, role public.user_role, account_status public.account_status);
      -- public.brands.code is nullable text in migration 002_brands_categories.sql.
      create table public.brands(id uuid primary key default gen_random_uuid(), name text, code text, is_active boolean default true);
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
 await db.exec(`create table public.clients(id uuid primary key, company_name text, code text, is_active boolean default true); create table public.projects(id uuid primary key, client_id uuid references public.clients, project_number text, project_name text, is_active boolean); create function public.current_user_is_active() returns boolean language sql stable as $$ select public.current_account_status()='active' $$; create function public.current_user_can_manage_settings() returns boolean language sql stable as $$ select public.current_user_role() in ('system_owner','admin_manager') and public.current_user_is_active() $$;`);
 await db.exec(await sql("../migrations/20261023110000_inventory_functions.sql"));
 await db.exec(await sql("../migrations/20261023120000_inventory_photo_functions.sql"));
 await db.exec(await sql("../migrations/20261023130000_inventory_review_edits.sql"));
 await db.exec(await sql("../migrations/20261023140000_inventory_manager_direct.sql"));
 await db.exec(await sql("../migrations/20261023150000_inventory_reservations.sql"));
 await db.exec(await sql("../migrations/20261024100000_inventory_auto_stock_ref.sql"));
 await db.exec(await sql("../migrations/20261026100000_inventory_local_brands.sql"));
 await db.exec(`create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_id uuid,sender_id uuid,body text,order_no text,sent_to_role text);`);
 await db.exec(await sql("../migrations/20261025100000_inventory_notifications.sql"));
 await db.exec(await sql("../migrations/20261026150000_inventory_stock_ref_notifications.sql"));
 await db.exec(await sql("../migrations/20261026150000_inventory_stock_ref_notifications.sql"));
 await db.exec(await sql("./inventory_stock_ref_notifications.sql"));
 assert.deepEqual((await db.query("select count(*)::int as count from inventory.products")).rows,[{count:0}]);
 } finally { await db.close(); }
});
