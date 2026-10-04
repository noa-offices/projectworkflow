import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { brandPriceBaselineDate, latestBrandPriceListUpdate, scheduledBrandPriceListUpdate, productTemplatePriceCheckState, type BrandPriceListUpdateForCheck, type PriceCheckTemplate } from "../product-price-check.js";
import { canReviewBrandPrices, canApproveBrandPrices } from "./brand-price-permissions.js";
import type { AppRole, AccountStatus } from "../supabase/types.js";

const now = Date.parse("2026-10-02T12:00:00Z");
const baseline = "2026-05-19";
const template: PriceCheckTemplate = { created_at: "2026-06-01", last_price_checked_at: null, price_check_interval_days: null };
const list = (changes: Partial<BrandPriceListUpdateForCheck> = {}): BrandPriceListUpdateForCheck => ({ status: "active", coverage_mode: "complete", effective_from: baseline, received_at: "2026-05-01", created_at: "2026-04-01", ...changes });
const status = (changes: Partial<PriceCheckTemplate> = {}, options: Partial<Parameters<typeof productTemplatePriceCheckState>[0]> = {}) => productTemplatePriceCheckState({ brandPriceBaselineAt: baseline, formatDate: (value) => value ?? "", now, template: { ...template, ...changes }, ...options });

for (const changes of [{ status: "draft" }, { status: "archived" }, { coverage_mode: "partial" }, { coverage_mode: "selected_templates" }, { coverage_mode: undefined }]) {
  test(`ineligible list ${JSON.stringify(changes)} cannot move baseline`, () => {
    const update = list(changes);
    assert.equal(latestBrandPriceListUpdate([update], now), null);
    assert.equal(brandPriceBaselineDate({ latestBrandPriceListUpdate: update, now }), null);
    assert.equal(brandPriceBaselineDate({ latestBrandPriceListUpdate: update, fallbackCheckedAt: baseline, now }), baseline);
  });
}
test("effective complete takes precedence over newer legacy and fallback; dates keep precedence", () => {
  const complete = list();
  const legacy = list({ coverage_mode: "legacy", effective_from: "2026-09-01" });
  assert.equal(latestBrandPriceListUpdate([legacy, complete], now), complete);
  assert.equal(brandPriceBaselineDate({ latestBrandPriceListUpdate: complete, fallbackCheckedAt: "2026-09-01", now }), baseline);
  assert.equal(brandPriceBaselineDate({ latestBrandPriceListUpdate: list({ effective_from: null }), now }), "2026-05-01");
  assert.equal(brandPriceBaselineDate({ latestBrandPriceListUpdate: list({ effective_from: null, received_at: null }), now }), "2026-04-01");
});
test("future complete preserves previous baseline/staleness and separate schedule", () => {
  const old = list();
  const future = list({ effective_from: "2026-11-01" });
  assert.equal(latestBrandPriceListUpdate([old, future], now), old);
  assert.equal(scheduledBrandPriceListUpdate([old, future], now), future);
  assert.equal(brandPriceBaselineDate({ latestBrandPriceListUpdate: future, fallbackCheckedAt: baseline, now }), baseline);
  const state = status({}, { latestBrandPriceListUpdate: old, scheduledBrandPriceListUpdate: future });
  assert.equal(state.key, "needs_check");
  assert.equal(state.scheduledEffectiveFrom, "2026-11-01");
  assert.equal(status({}, { brandPriceBaselineAt: null, latestBrandPriceListUpdate: future }).key, "no_price_list_date");
  assert.equal(latestBrandPriceListUpdate([old, future], Date.parse("2026-11-01")), future);
  assert.equal(latestBrandPriceListUpdate([list({ effective_from: "2026-10-02" })], now)?.effective_from, "2026-10-02");
});
test("legacy source selection, missing/invalid/future fallback", () => {
  const legacy = list({ coverage_mode: "legacy" });
  assert.equal(latestBrandPriceListUpdate([legacy], now), legacy);
  for (const value of [null, "invalid", "2026-11-01"]) assert.equal(brandPriceBaselineDate({ fallbackCheckedAt: value, now }), null);
});
test("new creation never auto-current; explicit marker preserves LAS 17 without invented evidence", () => {
  assert.equal(status().key, "needs_check");
  for (let index = 0; index < 17; index++) {
    const historical = { ...template, creation_legacy: true, last_price_checked_by: null };
    const before = structuredClone(historical);
    const result = status(historical);
    assert.equal(result.key, "current");
    assert.match(result.reason, /creation_legacy/);
    assert.deepEqual(historical, before);
  }
  assert.equal(status({ creation_legacy: true }, { latestBrandPriceListUpdate: list() }).key, "needs_check");
  assert.equal(status({ creation_legacy: true, last_price_checked_at: "2026-05-01" }).key, "needs_check");
  assert.equal(status({ creation_legacy: true }, { brandPriceBaselineAt: "2026-09-01" }).key, "needs_check");
});
test("INTERSTUHL two no-list Templates remain no_price_list_date", () => {
  for (let i = 0; i < 2; i++) assert.equal(status({}, { brandPriceBaselineAt: null }).key, "no_price_list_date");
});
test("truthful check intervals: Template > Brand > 90 default", () => {
  const checked = { last_price_checked_at: "2026-08-01" };
  assert.equal(status({ ...checked, price_check_interval_days: 90 }, { brandPriceCheckIntervalDays: 30 }).key, "checked");
  assert.equal(status(checked, { brandPriceCheckIntervalDays: 30 }).key, "due");
  assert.equal(status({ ...checked, brand_price_check_interval_days: 30 }).key, "due");
  assert.equal(status(checked).key, "checked");
  assert.equal(status({ creation_legacy: true }, { brandPriceCheckIntervalDays: 1 }).key, "current");
  assert.equal(status({ ...checked, creation_legacy: true }, { brandPriceCheckIntervalDays: 30 }).key, "due");
});

const roles: AppRole[] = ["system_owner", "admin_manager", "procurement_manager", "designer", "sales_coordinator", "sales_designer", "viewer"];
const reviewers = roles.slice(0, 5); // review and approve are the same five editable roles
const approvers = roles.slice(0, 5);
for (const role of roles) test(`${role} reviewer/approver and inactive protection`, () => {
  assert.equal(canReviewBrandPrices(role, "active"), reviewers.includes(role));
  assert.equal(canApproveBrandPrices(role, "active"), approvers.includes(role));
  for (const state of ["pending", "disabled", null, undefined] as const) {
    assert.equal(canReviewBrandPrices(role, state), false);
    assert.equal(canApproveBrandPrices(role, state), false);
  }
});
test("missing profile role/status fail closed", () => {
  assert.equal(canReviewBrandPrices(null, "active"), false);
  assert.equal(canApproveBrandPrices(undefined, "active"), false);
});

const actions = await readFile(new URL("../../app/products/templates/actions.ts", import.meta.url), "utf8");
const auth = await readFile(new URL("../auth.ts", import.meta.url), "utf8");
function functionSource(source: string, name: string) {
  const start = source.indexOf(`export async function ${name}(`);
  assert.notEqual(start, -1);
  const end = source.indexOf("\nexport ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}
function executable(source: string, name: string, context: Record<string, unknown>) {
  const compiled = ts.transpileModule(source.replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return runInNewContext(`${compiled}\n${name}`, context) as (...args: unknown[]) => Promise<unknown>;
}
for (const name of ["createBrandPriceListUpdate", "updateBrandPriceListUpdate", "archiveBrandPriceListUpdate"]) {
  test(`${name} enforces actual active reviewer guard before DB access; preserves check metadata`, async () => {
    for (const role of roles) for (const accountStatus of ["active", "disabled", "pending"] as AccountStatus[]) {
      let dbAccess = 0;
      let payload: Record<string, unknown> | null = null;
      const tables: string[] = [];
      const record = { id: "id", brand_id: "brand", title: "Title", status: "draft" };
      const builder = {
        select() { return this; }, eq() { return this; },
        async maybeSingle() { return { data: record, error: null }; },
        async single() { return { data: record, error: null }; },
        insert(value: Record<string, unknown>) { payload = value; return this; },
        update(value: Record<string, unknown>) { payload = value; return this; },
        then(resolve: (value: unknown) => unknown) { return Promise.resolve({ error: null }).then(resolve); },
      };
      const guard = executable(functionSource(auth, "requireBrandPriceReviewer"), "requireBrandPriceReviewer", {
        requireActiveUser: async () => { if (accountStatus !== "active") throw Error("denied"); return { user: { id: "user" }, profile: { role, account_status: accountStatus }, displayName: "Reviewer" }; },
        canReviewBrandPrices, redirect: () => { throw Error("denied"); },
      });
      const action = executable(functionSource(actions, name), name, {
        requireBrandPriceReviewer: guard,
        createClient: async () => { dbAccess++; return { from: (table: string) => { tables.push(table); return builder; } }; },
        textValue: (_form: unknown, field: string) => field === "title" ? "Title" : "id",
        optionalTextValue: () => null, priceListUpdateStatusValue: () => "draft",
        createAuditLog: async () => {}, revalidatePath: () => {},
        redirectWithMessage: () => { throw Error("finished"); }, console,
      });
      const allowed = canReviewBrandPrices(role, accountStatus);
      await assert.rejects(action(new FormData()), allowed ? /finished/ : /denied/);
      assert.equal(dbAccess, allowed ? 1 : 0);
      if (allowed) {
        assert.ok(payload);
        assert.ok(tables.every((table) => ["brands", "brand_price_list_updates"].includes(table)));
        assert.equal(Object.hasOwn(payload, "last_price_checked_at"), false);
        assert.equal(Object.hasOwn(payload, "creation_legacy"), false);
        if (name === "createBrandPriceListUpdate") assert.equal((payload as Record<string, unknown>).coverage_mode, "partial");
        else assert.equal(Object.hasOwn(payload, "coverage_mode"), false);
      }
    }
  });
}
test("manual Product authorization remains the original six-role set", () => {
  const body = auth.match(/export function canManageProductLibrary\([^]*?\n}/)?.[0];
  assert.ok(body);
  const compiled = ts.transpileModule(body.replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  const canManage = runInNewContext(`${compiled}\ncanManageProductLibrary`) as (role: AppRole) => boolean;
  for (const role of roles) assert.equal(canManage(role), role !== "viewer");
});
test("both pages load coverage/legacy evidence, inherit intervals and share the helper without filter redesign", async () => {
  for (const path of ["../../app/products/price-updates/page.tsx", "../../app/products/templates/page.tsx"]) {
    const source = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(source, /productTemplatePriceCheckState\(/);
    assert.match(source, /select\([^]*?creation_legacy/);
    assert.match(source, /select\("coverage_mode,/);
    assert.match(source, /scheduledBrandPriceListUpdate\(/);
    assert.match(source, /brandPriceCheckIntervalDays|brand_price_check_interval_days/);
  }
});

test("local migration: SQL role parity, active-account INSERT/UPDATE RLS and unchanged reads/legacy records", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role authenticated; create table public.brands(id uuid primary key);
      create table public.profiles(id uuid primary key);
      create function public.current_user_role() returns text language sql stable as $$ select current_setting('test.role',true) $$;
      create function public.current_account_status() returns text language sql stable as $$ select current_setting('test.status',true) $$;
      create function public.current_user_is_active() returns boolean language sql stable as $$ select public.current_account_status()='active' $$;
      create function public.current_user_can_manage_records() returns boolean language sql stable as $$ select public.current_user_role() in ('system_owner','admin_manager','procurement_manager','sales_designer','designer') $$;
      create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
      insert into brands values ('00000000-0000-0000-0000-000000000001');`);
    await db.exec(await readFile(new URL("../../supabase/migrations/036_brand_price_list_updates.sql", import.meta.url), "utf8"));
    await db.exec("alter table brand_price_list_updates add column coverage_mode text default 'legacy'; insert into brand_price_list_updates(brand_id,title) values('00000000-0000-0000-0000-000000000001','Historical');");
    const before = (await db.query("select policyname,qual from pg_policies where tablename='brand_price_list_updates' and cmd='SELECT' order by policyname")).rows;
    const migration = await readFile(new URL("../../supabase/migrations/20261002074032_brand_price_status_roles.sql", import.meta.url), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    // Phase: Supplier price editors. The forward migration widens both helpers to the same five roles and keeps the policies.
    const editors = await readFile(new URL("../../supabase/migrations/20261004150000_supplier_price_editor_roles.sql", import.meta.url), "utf8");
    await db.exec(editors);
    await db.exec(editors);
    assert.deepEqual((await db.query("select policyname,qual from pg_policies where tablename='brand_price_list_updates' and cmd='SELECT' order by policyname")).rows, before);
    assert.equal((await db.query<{ coverage_mode: string }>("select coverage_mode from brand_price_list_updates where title='Historical'")).rows[0].coverage_mode, "legacy");
    for (const role of roles) for (const state of ["active", "disabled", "pending"] as AccountStatus[]) {
      await db.query("select set_config('test.role',$1,false),set_config('test.status',$2,false)", [role, state]);
      await db.exec("set role authenticated");
      const result = (await db.query<{ review: boolean; approve: boolean }>("select current_user_can_review_brand_prices() review,current_user_can_approve_brand_prices() approve")).rows[0];
      assert.equal(result.review, canReviewBrandPrices(role, state));
      assert.equal(result.approve, canApproveBrandPrices(role, state));
      const insert = "insert into brand_price_list_updates(brand_id,title,coverage_mode) values('00000000-0000-0000-0000-000000000001','New','partial')";
      if (result.review) {
        await db.exec(insert);
        assert.equal((await db.query("update brand_price_list_updates set notes='Reviewed' where title='Historical' returning id")).rows.length, 1);
      } else {
        await assert.rejects(db.exec(insert), /row-level security/);
        assert.equal((await db.query("update brand_price_list_updates set notes='Forbidden' where title='Historical' returning id")).rows.length, 0);
      }
      if (state === "active") assert.ok((await db.query("select id from brand_price_list_updates")).rows.length > 0);
      await db.exec("reset role");
    }
  } finally { await db.close(); }
});
