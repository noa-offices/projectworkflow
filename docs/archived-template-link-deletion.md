# Archived template family link removal — Phase A

Migration: `supabase/migrations/20261021120000_guard_archived_template_link_deletion.sql`.
Server action: `removeArchivedProductFamilyLink({ templateId, relationshipId })` in
`app/products/templates/archived-link-actions.ts`. There is no UI in this phase.

## Dependencies and existing authorization

Required existing objects:

- `auth.uid()`, `public.current_user_is_active()`, `public.current_user_can_manage_records()`,
  and `public.current_user_is_sales_coordinator()`.
- `product_templates(id, brand_id, lifecycle_status, is_active)`,
  `product_template_linked_families(id, parent_template_id, linked_template_id, is_active)`,
  and `brands(id)` with their existing foreign keys, privileges, and RLS enabled.
- Family schema/grants from migrations 025/026, manager SELECT/UPDATE policies from 076,
  DELETE policies from 077, and the sales-coordinator helper/policies from 081.
- The existing template lifecycle column must already be deployed.

The actual helper in 005 allows active system owners, admin managers, and sales designers;
081 additionally authorizes active sales coordinators. Later migration comments describing
more roles do not change that helper. Designer/procurement-manager accounts accepted by the
TypeScript library gate can still be rejected by the existing database rules. This feature
does not expand those permissions. `SECURITY INVOKER` preserves both table privileges and RLS;
row locking also requires UPDATE privilege and an applicable UPDATE policy.

Cross-brand relationships are supported: existing setup offers all active templates, and the
creation action/schema do not impose brand equality. The new operation checks both locked
endpoints and visibility of their actual brands; it does not accept a brand ID from the client.

## Exact SQL Editor deployment procedure (manual; not performed by the agent)

1. Select the intended project in Supabase Dashboard and open SQL Editor. Confirm the project
   identity. Use a reviewed backup/staging deployment process for the production environment.
2. Run these read-only preflight checks and review their output. Missing objects/permissions
   must be resolved by reviewing the project's actual deployment history, not by blindly
   applying all local migrations.

   ```sql
   select to_regprocedure('auth.uid()'),
          to_regprocedure('public.current_user_is_active()'),
          to_regprocedure('public.current_user_can_manage_records()'),
          to_regprocedure('public.current_user_is_sales_coordinator()');
   select table_name, column_name
   from information_schema.columns
   where table_schema = 'public'
     and table_name in ('brands','product_templates','product_template_linked_families')
     and column_name in ('id','brand_id','is_active','lifecycle_status',
                         'parent_template_id','linked_template_id');
   select c.relname, c.relrowsecurity,
          has_table_privilege('authenticated', c.oid, 'SELECT') as can_select,
          has_table_privilege('authenticated', c.oid, 'UPDATE') as can_lock,
          has_table_privilege('authenticated', c.oid, 'DELETE') as can_delete
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('brands','product_templates','product_template_linked_families');
   select tablename, policyname, cmd, roles, qual, with_check
   from pg_policies where schemaname = 'public'
     and tablename in ('brands','product_templates','product_template_linked_families');
   select pg_get_functiondef('public.current_user_can_manage_records()'::regprocedure),
          pg_get_functiondef('public.current_user_is_sales_coordinator()'::regprocedure);
   ```

   Brands need SELECT; templates need SELECT and UPDATE; relationships need SELECT, UPDATE,
   and DELETE. Check that the corresponding manager/coordinator policies actually apply.

3. Paste the entire migration file into a new SQL Editor query and run it once. Its BEGIN/COMMIT
   makes definition creation and EXECUTE grants one transaction. It creates one function only;
   it does not delete any relationships during deployment. If the function already exists,
   stop and compare its definition instead of dropping/replacing it blindly.
4. Request PostgREST schema cache reload, then inspect the definition/privileges:

   ```sql
   select pg_notify('pgrst', 'reload schema');
   select p.prosecdef, p.proconfig, pg_get_functiondef(p.oid)
   from pg_proc p
   where p.oid = 'public.remove_archived_template_family_link(uuid,uuid)'::regprocedure;
   select has_function_privilege('authenticated',
            'public.remove_archived_template_family_link(uuid,uuid)', 'EXECUTE') as authenticated_can_call,
          has_function_privilege('anon',
            'public.remove_archived_template_family_link(uuid,uuid)', 'EXECUTE') as anon_can_call;
   ```

   Expect `prosecdef = false`, an empty configured search path, authenticated EXECUTE true,
   anon EXECUTE false. SQL Editor's owner context is not a substitute for testing a signed-in
   manager through the application. Deploy the new action before wiring the future UI.

This manual deployment does not reconcile `supabase_migrations.schema_migrations`. Keep the
deployment record and reconcile history separately through the project's agreed process.
Do not run `supabase db push` or `migration repair` as part of this procedure. The commented
DROP at the end of the migration removes the RPC definition only; it cannot restore deleted links.

## Locking and outcomes

The RPC discovers endpoint IDs without trusting them, then locks the selected template and
both endpoints in ascending UUID order with `FOR NO KEY UPDATE`, then locks the relationship
with `FOR UPDATE`. Template locks block restore/brand changes while remaining compatible with
foreign-key KEY SHARE checks. The function checks the locked endpoint identities against the
discovery read and returns `stale` if they changed; it never takes extra endpoint locks out of order.
All eligibility checks occur after locking. Concurrent link activation is seen after the link
lock wait. Concurrent restores are seen after template lock waits. At stricter isolation levels,
serialization failures return `stale` instead of permitting a deletion from a stale snapshot.

The final DELETE repeats the relationship ID, endpoint IDs, selected membership, and inactive
predicates. Exactly one returned ID is required. Zero-row deletes raise an exception, rolling
back even trigger side effects. Permission failures return `forbidden`; deadlocks/serialization
failures return `stale`. The action accepts success only for the requested IDs and deletedCount 1.
It does not automatically retry an uncertain outcome; refresh before reviewing another attempt.

Only the relationship row is removed. No quotation, supplier price, template, or template
delete-eligibility guard is modified. Removing the last link never deletes the template.
Legacy link actions remain unchanged; this guarded entry point is for the future Archive UI.

## Verification and remaining concurrency coverage

Run only the focused tests:

```text
node --import tsx --test --test-isolation=none lib/products/archived-template-link-deletion.test.mts lib/products/archived-template-link-deletion-rpc.test.mts
```

The SQL tests execute the real migration, real family schema, real 005 permission helper,
and real 076/077 policies in disposable PGlite. They reproduce the relevant 081 policies for
only the three tested tables. Minimal quotation/supplier fixtures check unchanged snapshots/data.
Tests cover both endpoints, same/cross-brand use, inaccessible brands/endpoints, archive status,
RLS/grants, repeated deletion, zero-row rollback, other links, and last-link behavior.

PGlite is a single-backend database. It cannot validate two competing sessions; prior committed
activation/restore tests are not presented as concurrency tests. No separate PostgreSQL server
or safe multi-session test database was available. Before production deployment, use a disposable
staging database with two signed-in manager sessions and fixture IDs:

1. Session A: BEGIN; restore the selected template without committing. Session B: call the RPC.
   B must wait. COMMIT A: B must return `not_archived`; the link must remain.
2. Reset fixtures. A: BEGIN; activate the inactive link without committing. B: call the RPC.
   B must wait. COMMIT A: B must return `active_link`; the link must remain.
3. Reset fixtures. A: BEGIN; change a relationship endpoint without committing. B: call the RPC
   against the old pair. COMMIT A: B must return `stale` (or another non-success if no longer visible),
   and leave the updated relationship intact.
4. Reset fixtures. A: BEGIN; call the RPC but do not commit. B: attempt a template restore or
   link activation. It must wait for A. Roll back A: the relationship must still exist. Repeat
   with COMMIT A: a later activation must affect zero rows, and the template must still exist.

Do not use production relationships for these tests. No browser verification applies to Phase A.
