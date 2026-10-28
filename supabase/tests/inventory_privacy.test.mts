import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";

const sql = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const definition = async (path: string, name: string) => {
 const source = await sql(path);
 const match = source.match(new RegExp(`create or replace function public\\.${name}\\(\\)[\\s\\S]*?\\$\\$;`, "i"));
 if (!match) throw new Error(`Missing real function ${name} in ${path}`);
 return match[0];
};
test("inventory_privacy: offline SQL assertions", async () => {
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
      create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text);
      alter table storage.objects enable row level security; grant usage on schema storage to authenticated; grant select on storage.objects to authenticated;
      create function storage.foldername(text) returns text[] language sql immutable as $$ select (string_to_array($1,'/'))[1:array_length(string_to_array($1,'/'),1)-1] $$;
      create function storage.filename(text) returns text language sql immutable as $$ select (string_to_array($1,'/'))[array_length(string_to_array($1,'/'),1)] $$;
    `);
    await db.exec(await definition("../migrations/001_profiles_roles_rls.sql", "current_user_role"));
    await db.exec(await definition("../migrations/002_brands_categories.sql", "current_account_status"));
    await db.exec(await definition("../migrations/20261023090100_warehouse_staff_lockdown.sql", "current_user_is_active"));
    await db.exec(await definition("../migrations/20261023090100_warehouse_staff_lockdown.sql", "current_user_can_access_inventory"));
    await db.exec(await definition("../migrations/075_add_designer_role.sql", "current_user_can_manage_records"));
    await db.exec(await sql("../migrations/20261023100000_inventory_schema.sql"));
    await db.exec(await sql("../migrations/20261023100100_inventory_rls_and_storage.sql"));
 await db.exec(`create table public.clients(id uuid primary key, company_name text, code text, is_active boolean default true); create table public.projects(id uuid primary key, client_id uuid references public.clients, project_number text, project_name text, is_active boolean); create function public.current_user_can_manage_settings() returns boolean language sql stable as $$ select public.current_user_role() in ('system_owner','admin_manager') and public.current_user_is_active() $$;`);
 await db.exec(await sql("../migrations/20261023110000_inventory_functions.sql"));
 await db.exec(await sql("../migrations/20261023120000_inventory_photo_functions.sql"));
 await db.exec(await sql("../migrations/20261023130000_inventory_review_edits.sql"));
 await db.exec(await sql("../migrations/20261023140000_inventory_manager_direct.sql"));
 await db.exec(await sql("../migrations/20261023150000_inventory_reservations.sql"));
 await db.exec(await sql("../migrations/20261024100000_inventory_auto_stock_ref.sql"));
 await db.exec(await sql("../migrations/20261026100000_inventory_local_brands.sql"));
 await db.exec(await sql("../migrations/071_notifications.sql"));
 await db.exec(`alter policy "Recipients can select their own notifications" on public.notifications using (recipient_id=auth.uid() and public.current_account_status()='active'); alter policy "Senders can select notifications they sent" on public.notifications using (sender_id=auth.uid() and public.current_account_status()='active'); alter policy "Recipients can update their own notifications" on public.notifications using (recipient_id=auth.uid() and public.current_account_status()='active');`);
 await db.exec(await sql("../migrations/20261025100000_inventory_notifications.sql"));
 await db.exec(await sql("../migrations/20261026150000_inventory_stock_ref_notifications.sql"));
 await db.exec(await sql("../migrations/20261026120000_inventory_delete_product.sql"));
 await db.exec(await sql("../migrations/20261027100000_inventory_person_names.sql"));
 await db.exec(await sql("../migrations/040_audit_activity_log.sql"));
 await db.exec(`create function public.current_user_can_view_client_payments() returns boolean language sql stable as $$ select false $$;`);
 const receiptMigration = await sql("../migrations/090_client_payment_receipt_workflow.sql");
 const receiptPolicy = receiptMigration.match(/drop policy if exists audit_activity_log_select_active_users[\s\S]*?\n  \);/i);
 if (!receiptPolicy) throw new Error("Missing latest audit policy");
 await db.exec(receiptPolicy[0]);
 await db.exec(`create policy sc_audit_activity_log_select on public.audit_activity_log for select to authenticated using (public.current_user_role() = 'sales_coordinator');`);
 await db.exec(await sql("../migrations/20261029100000_inventory_activity_log.sql"));
 await db.exec(await sql("./inventory_privacy_TEST.sql"));
 await db.exec(await sql("../migrations/20261030100000_inventory_privacy.sql"));
 await db.exec(await sql("./inventory_privacy.sql"));
 assert.deepEqual((await db.query("select count(*)::int as count from inventory.products")).rows,[{count:0}]);
 } finally { await db.close(); }
});
