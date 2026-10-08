import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as capacity from "../../lib/products/system-capacity.js";
import { canManageSupplierCapacity, resolveSupplierPriceListLifecycleState, supplierBusinessDate } from "../../lib/products/supplier-price-repository.js";
import type { SystemCapacityReport, CapacitySnapshot } from "../../lib/products/system-capacity.js";

async function load<T>(path: string, dependencies: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(path, import.meta.url);
  const source = await readFile(url, "utf8");
  const output = ts.transpileModule(source, { fileName: fileURLToPath(url), compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output)((name: string) => Object.hasOwn(dependencies, name) ? dependencies[name] : createRequire(url)(name), compiled, compiled.exports);
  return compiled.exports as T;
}

const mb = 1_048_576;
const snapshot = (id: string, captured_at: string, database_bytes: number): CapacitySnapshot => ({ id, captured_at, database_bytes, storage_bytes: mb, supplier_bytes: mb, product_image_bytes: mb, quote_image_bytes: 0, other_storage_bytes: 0 });
const sample: SystemCapacityReport = {
  generated_at: "2026-10-08T09:00:00Z", database_bytes: 126 * mb, supplier_bytes: 80 * mb, supplier_index_bytes: 10 * mb,
  database_limit: 500 * mb, storage_limit: 1024 * mb, database_setting: null, storage_setting: null, storage_bytes: 5 * mb,
  tables: [
    { schema: "public", name: "supplier_price_matches", total_bytes: 30 * mb, table_bytes: 20 * mb, index_bytes: 10 * mb, rows: 123 },
    { schema: "public", name: "product_templates", total_bytes: 50 * mb, table_bytes: 40 * mb, index_bytes: 10 * mb, rows: null },
  ],
  indexes: [{ schema: "public", name: "small_index", table_name: "supplier_price_matches", bytes: mb }, { schema: "public", name: "large_index", table_name: "product_templates", bytes: 10 * mb }],
  buckets: [{ name: "supplier-price-sources", objects: 5, total_bytes: 5 * mb, largest_bytes: 2 * mb, unknown_sizes: 0 }],
  reclaimable: { bytes: mb, items: 2 }, sources: { current: 1, previous: 2, archived: 3, compacted: 4, upcoming: 1, unfinished: 0, update_in_progress: 1 },
  snapshots: [snapshot("latest", "2026-10-01T09:00:00Z", 110 * mb)], baseline_30_day: snapshot("baseline", "2026-09-01T09:00:00Z", 100 * mb),
  monthly: [snapshot("baseline", "2026-09-01T09:00:00Z", 100 * mb), snapshot("latest", "2026-10-01T09:00:00Z", 110 * mb)],
};

test("health thresholds, configured limits, and growth handle boundaries and absent history", () => {
  for (const [used, expected] of [[0, "Healthy"], [69.99, "Healthy"], [70, "Watch"], [85, "Watch"], [85.01, "Action needed"], [110, "Action needed"]] as const) assert.equal(capacity.capacityHealth(used, 100).status, expected);
  assert.deepEqual(capacity.capacityHealth(1, null), { used: null, status: "Unknown" });
  assert.equal(capacity.capacityHealth(null, 100).status, "Unknown");
  assert.equal(capacity.capacityHealth(1, 0).status, "Unknown");
  assert.equal(capacity.configuredCapacity("524288000"), 500 * mb);
  for (const value of [undefined, "", "0", "-1", "NaN", "500 MB", "1.5", "99999999999999999999999"]) assert.equal(capacity.configuredCapacity(value), null);
  assert.equal(capacity.capacityTrend(sample).change, 26 * mb);
  assert.equal(capacity.capacityTrend(sample).fastGrowth, true);
  assert.equal(capacity.capacityTrend({ ...sample, baseline_30_day: null }).change, null);
  assert.equal(capacity.capacityTrend({ ...sample, baseline_30_day: null }).fastGrowth, false);
  assert.equal(capacity.capacityChange(100 * mb, 110 * mb), "-10.0 MB");
  assert.equal(capacity.capacityInputBytes("500", "MB"), 500 * mb);
  assert.equal(capacity.capacityInputBytes("1.5", "GB"), 1.5 * 1024 * mb);
  assert.equal(capacity.capacityInputBytes("", "GB"), null);
  for (const [value, unit] of [["0", "MB"], ["-1", "GB"], ["abc", "MB"], ["1", "TB"], ["999999999999999999999", "GB"]]) assert.throws(() => capacity.capacityInputBytes(value, unit), /Capacity/);
  assert.throws(() => capacity.capacityInputBytes(null, "MB"), /Capacity/);
  assert.deepEqual(capacity.capacitySettingInput(500 * mb), { value: "500", unit: "MB" });
  assert.deepEqual(capacity.capacitySettingInput(2 * 1024 * mb), { value: "2", unit: "GB" });
});

test("dashboard renders measurements, capacity settings, sorted breakdowns, Supplier footprint, buckets, conservative estimate and trends", async () => {
  const components = await load<{ CapacitySettings(props: { report: SystemCapacityReport; onSaved(report: SystemCapacityReport): void }): React.ReactElement; SystemCapacityDetails(props: { report: SystemCapacityReport }): React.ReactElement; SupplierCapacityPanel(): React.ReactElement }>("./supplier-capacity.tsx", {
    "@/lib/products/system-capacity": capacity,
    "@/app/settings/system-health/actions": {},
  });
  const markup = renderToStaticMarkup(React.createElement(components.SystemCapacityDetails, { report: sample }));
  for (const text of ["126.0 MB", "500.0 MB", "25% used", "Healthy", "5.0 MB", "1.0 GB", "Database &amp; Storage Growth", "Largest database tables", "Database tables", "Largest indexes", "Storage breakdown", "Supplier Pricing breakdown", "supplier_price_matches", "supplier-price-sources", "100% · 5 objects", "Current active: 1", "Archived: 3", "+26.0 MB", "1.0 MB potentially reclaimable", "Database reclaimable", "Database accounting only", "2 finalized database staging chunks"]) assert.ok(markup.includes(text), text);
  assert.ok(markup.indexOf("public.product_templates") < markup.indexOf("public.supplier_price_matches"));
  assert.ok(markup.indexOf("public.large_index") < markup.indexOf("public.small_index"));
  const unknown = renderToStaticMarkup(React.createElement(components.SystemCapacityDetails, { report: { ...sample, database_limit: null, storage_bytes: null, snapshots: [], baseline_30_day: null, monthly: [] } }));
  assert.match(unknown, /Capacity limit not configured/); assert.match(unknown, /Capture a snapshot to start the growth trend/); assert.doesNotMatch(unknown, /Growth watch|Used<|Status</);
  const one = renderToStaticMarkup(React.createElement(components.SystemCapacityDetails, { report: sample }));
  assert.match(one, /Growth trend starts after the next snapshot/); assert.doesNotMatch(one, /No snapshots yet/);
  const two = renderToStaticMarkup(React.createElement(components.SystemCapacityDetails, { report: { ...sample, snapshots: [snapshot("b", "2026-10-02T09:00:00Z", 120 * mb), sample.snapshots[0]], reclaimable: { bytes: 0, items: 0 } } }));
  assert.match(two, /<svg/); assert.match(two, /No safely reclaimable database technical data/);
  for (const [used, status] of [[60, "Healthy"], [80, "Watch"], [90, "Action needed"]] as const) { const m = renderToStaticMarkup(React.createElement(components.SystemCapacityDetails, { report: { ...sample, database_bytes: used, database_limit: 100 } })); assert.ok(m.includes(status)); assert.ok(m.includes(`aria-valuenow="${used}"`)); }
  const savedLimit = renderToStaticMarkup(React.createElement(components.SystemCapacityDetails, { report: { ...sample, database_bytes: 400 * mb, database_setting: 500 * mb, database_limit: 500 * mb } }));
  assert.match(savedLimit, /80% used/); assert.match(savedLimit, /Watch/);
  const panel = renderToStaticMarkup(React.createElement(components.SupplierCapacityPanel));
  assert.equal((panel.match(/<button/g) ?? []).length, 2);
  assert.match(panel, />Refresh</); assert.match(panel, /Capture snapshot/);
  assert.doesNotMatch(panel, /Vacuum|Reindex|Delete|Purge|Compact|Remove source file|archive\/unarchive/);
  const settings = renderToStaticMarkup(React.createElement(components.CapacitySettings, { report: { ...sample, database_setting: 500 * mb, storage_setting: null }, onSaved() {} }));
  for (const text of ["Capacity settings", "Database capacity", "Storage capacity", "MB", "GB", "Save capacity", "Leave a field blank"]) assert.ok(settings.includes(text), text);
  const cleanup = renderToStaticMarkup(React.createElement(components.SystemCapacityDetails, { report: { ...sample, storage_cleanup: { status: "available", message: null, graceDays: 7, total: { objects: 2, bytes: 3 * mb }, active: { objects: 0, bytes: 0 }, temporary: { objects: 1, bytes: mb }, orphaned: { objects: 1, bytes: 2 * mb }, reclaimable: { objects: 1, bytes: 2 * mb }, candidates: [{ path: "smart-source-qa/123e4567-e89b-42d3-a456-426614174000-old.pdf", createdAt: "2026-09-01T00:00:00Z", bytes: 2 * mb, ageDays: 37 }], review: [{ path: "smart-source-qa/123e4567-e89b-42d3-a456-426614174000-old.pdf", createdAt: "2026-09-01T00:00:00Z", bytes: 2 * mb, ageDays: 37, state: "reclaimable", reason: "Outside the grace period." }], buckets: [{ bucket: "product-source-files", status: "available", detail: "Safe temporary namespace." }, { bucket: "supplier-price-sources", status: "managed_elsewhere", detail: "Existing Supplier lifecycle." }, { bucket: "product-images", status: "unavailable", detail: "References are not proven." }, { bucket: "quote-images", status: "unavailable", detail: "References are not proven." }], quotationPdfNote: "Generated quotation/document PDFs are created on demand and are not stored persistently." } } }));
  for (const text of ["STORAGE CLEANUP", "Persistent Storage", "Safely reclaimable", "Product Source QA PDFs", "Protected by grace period", "Safe to clean", "Clean safe files", "Review files", "Supplier price-source files", "Product images", "Quote images", "Automatic cleanup not enabled", "on demand"]) assert.ok(cleanup.includes(text), text);
  const zeroCleanup = renderToStaticMarkup(React.createElement(components.SystemCapacityDetails, { report: { ...sample, storage_cleanup: { status: "available", message: null, graceDays: 7, total: { objects: 3, bytes: 3 * mb }, active: { objects: 1, bytes: mb }, temporary: { objects: 2, bytes: 2 * mb }, orphaned: { objects: 0, bytes: 0 }, reclaimable: { objects: 0, bytes: 0 }, candidates: [], review: [], buckets: [], quotationPdfNote: "Generated quotation and document PDFs are created on demand and are not stored persistently." } } }));
  assert.match(zeroCleanup, /No files are currently eligible for cleanup/); assert.match(zeroCleanup, /within the 7-day grace period/); assert.match(zeroCleanup, /disabled/);
  const componentSource = await readFile(new URL("./supplier-capacity.tsx", import.meta.url), "utf8");
  assert.match(componentSource, /Capacity settings saved\./);
});

test("growth series and bucket shares derive only from recorded data", () => {
  const series = capacity.growthSeries({ snapshots: [snapshot("b", "2026-10-02T00:00:00Z", 2), snapshot("a", "2026-10-01T00:00:00Z", 1)] });
  assert.deepEqual(series.map((point) => point.database), [1, 2]);
  const shares = capacity.bucketShares([{ name: "a", objects: 1, total_bytes: 25, largest_bytes: 25, unknown_sizes: 0 }, { name: "b", objects: 1, total_bytes: 75, largest_bytes: 75, unknown_sizes: 0 }], 100);
  assert.deepEqual(shares.map((bucket) => [bucket.name, bucket.share]), [["b", 75], ["a", 25]]);
  assert.equal(capacity.bucketShares([], null).length, 0); assert.equal(capacity.meterPercent(null), null); assert.equal(capacity.meterPercent(140), 100);
});

test("Storage forecast uses recorded snapshots only and requires a seven-day positive trend plus configured capacity", () => {
  const report = { ...sample, storage_bytes: 40 * mb, storage_limit: 100 * mb, snapshots: [
    { ...snapshot("new", "2026-10-08T00:00:00Z", 1), storage_bytes: 30 * mb },
    { ...snapshot("old", "2026-09-28T00:00:00Z", 1), storage_bytes: 20 * mb },
  ] };
  assert.deepEqual(capacity.storageForecast(report), { dailyBytes: mb, monthlyBytes: 30.4375 * mb, daysTo70: 40, daysTo85: 55, sampleDays: 10 });
  assert.equal(capacity.storageForecast({ ...report, storage_limit: null }), null);
  assert.equal(capacity.storageForecast({ ...report, snapshots: report.snapshots.slice(0, 1) }), null);
  assert.equal(capacity.storageForecast({ ...report, snapshots: [{ ...report.snapshots[0], captured_at: "2026-10-03T00:00:00Z" }, report.snapshots[1]] }), null);
  assert.equal(capacity.storageForecast({ ...report, snapshots: report.snapshots.map((item) => ({ ...item, storage_bytes: 20 * mb })) }), null);
});

test("server actions save converted settings for the owner and deny every non-owner before any capacity work", async () => {
  for (const role of ["system_owner", "admin_manager", "sales_designer", "viewer"]) for (const account_status of ["active", "disabled", "pending"]) {
    const calls: string[] = [];
    const actions = await load<{ loadSystemCapacityReport(): Promise<unknown>; captureCapacitySnapshot(): Promise<unknown>; saveCapacitySettings(input: capacity.CapacitySettingsInput): Promise<unknown>; cleanTemporaryProductSources(paths: string[]): Promise<unknown> }>("../../app/settings/system-health/actions.ts", {
      "@/lib/auth": { async requireSystemOwner() { return { profile: { role, account_status } }; } },
      "@/lib/supabase/server": { async createClient() { calls.push("client"); return {}; } },
      "@/lib/products/supplier-price-repository": { canManageSupplierCapacity },
      "@/lib/products/system-capacity": capacity,
      "@/lib/products/product-source-cleanup.server": { async cleanProductSourceCandidates() { calls.push("clean"); return { ok: true, message: "done", analysis: { status: "available", candidates: [] } }; } },
      "@/lib/products/system-capacity.server": { async systemCapacityReport() { calls.push("report"); return sample; }, async systemCapacityReportWithStorageCleanup() { calls.push("report"); return sample; }, async captureSystemCapacitySnapshot() { calls.push("capture"); }, async saveSystemCapacitySettings(_: unknown, database: number | null, storage: number | null) { calls.push(`save:${database}:${storage}`); } },
    });
    if (role === "system_owner" && account_status === "active") {
      assert.equal((await actions.loadSystemCapacityReport() as SystemCapacityReport).generated_at, sample.generated_at);
      assert.deepEqual(calls, ["client", "report"]); calls.length = 0;
      assert.equal((await actions.captureCapacitySnapshot() as SystemCapacityReport).generated_at, sample.generated_at);
      assert.deepEqual(calls, ["client", "capture", "report"]);
      calls.length = 0;
      assert.equal((await actions.saveCapacitySettings({ databaseValue: "500", databaseUnit: "MB", storageValue: "1.5", storageUnit: "GB" }) as SystemCapacityReport).generated_at, sample.generated_at);
      assert.deepEqual(calls, ["client", `save:${500 * mb}:${1.5 * 1024 * mb}`, "report"]);
      calls.length = 0;
      await actions.cleanTemporaryProductSources(["smart-source-qa/123e4567-e89b-42d3-a456-426614174000-old.pdf"]);
      assert.deepEqual(calls, ["client", "clean", "report"]); calls.length = 0;
      await assert.rejects(actions.saveCapacitySettings({ databaseValue: "-1", databaseUnit: "MB", storageValue: "1", storageUnit: "GB" }), /positive number/);
      assert.deepEqual(calls, ["client"]);
    } else {
      await assert.rejects(actions.loadSystemCapacityReport(), /Only the active System Owner/);
      await assert.rejects(actions.captureCapacitySnapshot(), /Only the active System Owner/);
      await assert.rejects(actions.saveCapacitySettings({ databaseValue: "500", databaseUnit: "MB", storageValue: "1", storageUnit: "GB" }), /Only the active System Owner/);
      await assert.rejects(actions.cleanTemporaryProductSources(["smart-source-qa/123e4567-e89b-42d3-a456-426614174000-old.pdf"]), /Only the active System Owner/);
      assert.deepEqual(calls, []);
    }
  }
  const page = await readFile(new URL("../../app/settings/system-health/page.tsx", import.meta.url), "utf8");
  assert.match(page, /requireSystemOwner\(\)/);
  assert.match(page, /<SupplierCapacityPanel \/>/);
});

test("DBH-1 is placed in System & Maintenance and removed from Supplier Sources", async () => {
  const settings = await readFile(new URL("../../app/settings/page.tsx", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../layout/erp-sidebar.tsx", import.meta.url), "utf8");
  const supplierSources = await readFile(new URL("../../app/products/price-updates/supplier-sources/page.tsx", import.meta.url), "utf8");
  assert.match(settings, /<SettingsGroup title="System & Maintenance">/);
  assert.match(settings, /href="\/settings\/system-health"/);
  assert.match(settings, /title="Database & Storage Health"/);
  assert.match(settings, /Monitor database size, storage usage, growth, and reclaimable space\./);
  assert.match(settings, /\{isSystemOwner \? \(/);
  assert.match(sidebar, /label: "Database & Storage Health", href: "\/settings\/system-health"/);
  assert.match(sidebar, /hidden: !isSystemOwner/);
  assert.doesNotMatch(supplierSources, /SupplierCapacityPanel|System \/ database health/);
  assert.doesNotMatch(settings, /supplier-capacity/);

  const route = await load<{ default(): Promise<React.ReactElement> }>("../../app/settings/system-health/page.tsx", {
    "next/link": { default: ({ children, ...props }: { children: React.ReactNode }) => React.createElement("a", props, children) },
    "@/components/layout/erp-app-shell": { ErpAppShell: ({ children }: { children: React.ReactNode }) => React.createElement("main", null, children) },
    "@/components/products/supplier-capacity": { SupplierCapacityPanel: () => React.createElement("div", { "data-dashboard": "reused" }, "Existing dashboard") },
    "@/lib/auth": { async requireSystemOwner() { return { user: { email: "owner@example.com" }, profile: { role: "system_owner", avatar_url: null }, displayName: "Owner" }; } },
  });
  const markup = renderToStaticMarkup(await route.default());
  assert.match(markup, /Back to settings/);
  assert.match(markup, /data-dashboard="reused"/);
});

test("Settings landing exposes Database & Storage Health only to the System Owner", async () => {
  for (const role of ["system_owner", "admin_manager", "sales_designer"]) {
    const landing = await load<{ default(): Promise<React.ReactElement> }>("../../app/settings/page.tsx", {
      "next/link": { default: ({ children, ...props }: { children: React.ReactNode }) => React.createElement("a", props, children) },
      "next/navigation": { redirect(path: string) { throw Error(`redirect:${path}`); } },
      "@/components/layout/erp-app-shell": { ErpAppShell: ({ children }: { children: React.ReactNode }) => React.createElement("main", null, children) },
      "@/lib/auth": { async requireActiveUser() { return { user: { email: `${role}@example.com` }, profile: { role, avatar_url: null }, displayName: role }; } },
    });
    const markup = renderToStaticMarkup(await landing.default());
    assert.equal(markup.includes("Database &amp; Storage Health"), role === "system_owner", role);
    assert.equal(markup.includes("/settings/system-health"), role === "system_owner", role);
  }
});

test("repository resolves saved settings before environment fallbacks and retains existing capacity behavior", async () => {
  const repo = await load<{ systemCapacityReport(client: unknown): Promise<SystemCapacityReport>; captureSystemCapacitySnapshot(client: unknown): Promise<void>; saveSystemCapacitySettings(client: unknown, database: number | null, storage: number | null): Promise<unknown> }>("../../lib/products/system-capacity.server.ts", {
    "server-only": {}, "./system-capacity": capacity,
    "./product-source-cleanup.server": { async analyzeProductSourceCleanup() { return { status: "available", candidates: [] }; } },
    "./supplier-price-repository": { resolveSupplierPriceListLifecycleState, supplierBusinessDate },
  });
  const calls: string[] = [];
  const source = { brand_id: "b", definition_id: null, status: "imported", effective_from: null, created_at: "2026-01-01T00:00:00Z", rows_compacted_at: null };
  let settings: { database_capacity_bytes: number | null; storage_capacity_bytes: number | null; updated_at: string | null; updated_by: string | null } = { database_capacity_bytes: 700 * mb, storage_capacity_bytes: null, updated_at: null, updated_by: null };
  const client = { async rpc(name: string, ...args: unknown[]) {
    calls.push(name);
    if (name === "system_capacity_settings_read") { assert.deepEqual(args, []); return { error: null, data: settings }; }
    if (name === "system_capacity_settings_save") { settings = { database_capacity_bytes: (args[0] as { p_database_capacity_bytes: number | null }).p_database_capacity_bytes, storage_capacity_bytes: (args[0] as { p_storage_capacity_bytes: number | null }).p_storage_capacity_bytes, updated_at: null, updated_by: null }; return { error: null, data: settings }; }
    if (name === "capture_system_capacity_snapshot") { assert.deepEqual(args, []); return { error: null, data: null }; }
    assert.equal(name, "system_capacity_report"); assert.deepEqual(args, [], "no client-supplied metrics");
    return { error: null, data: { ...sample, source_metadata: [
      { ...source, id: "old" }, { ...source, id: "new", rows_compacted_at: "2026-01-01" },
      { ...source, id: "archive", status: "archived" }, { ...source, id: "unfinished", status: "importing" },
    ], review_metadata: [
      { source_id: "old", status: "completed", completed_at: "2026-01-01T00:00:00Z" },
      { source_id: "new", status: "completed", completed_at: "2026-02-01T00:00:00Z" },
    ] } };
  } };
  const previousDatabaseEnv = process.env.SYSTEM_DATABASE_CAPACITY_BYTES, previousStorageEnv = process.env.SYSTEM_STORAGE_CAPACITY_BYTES;
  process.env.SYSTEM_DATABASE_CAPACITY_BYTES = String(500 * mb); process.env.SYSTEM_STORAGE_CAPACITY_BYTES = String(2 * 1024 * mb);
  const report = await repo.systemCapacityReport(client);
  assert.deepEqual(report.sources, { current: 1, previous: 1, archived: 1, compacted: 1, upcoming: 0, unfinished: 1, update_in_progress: 0 });
  assert.equal(report.database_limit, 700 * mb, "saved database setting beats env");
  assert.equal(report.storage_limit, 2 * 1024 * mb, "env is used when the saved setting is absent");
  assert.equal(report.database_setting, 700 * mb); assert.equal(report.storage_setting, null);
  assert.equal("source_metadata" in report, false); assert.equal("review_metadata" in report, false);
  settings = { ...settings, database_capacity_bytes: null, storage_capacity_bytes: null };
  delete process.env.SYSTEM_DATABASE_CAPACITY_BYTES; delete process.env.SYSTEM_STORAGE_CAPACITY_BYTES;
  const unconfigured = await repo.systemCapacityReport(client); assert.equal(unconfigured.database_limit, null); assert.equal(unconfigured.storage_limit, null);
  await repo.saveSystemCapacitySettings(client, 900 * mb, 3 * 1024 * mb);
  assert.deepEqual(settings, { database_capacity_bytes: 900 * mb, storage_capacity_bytes: 3 * 1024 * mb, updated_at: null, updated_by: null });
  await repo.captureSystemCapacitySnapshot(client);
  if (previousDatabaseEnv === undefined) delete process.env.SYSTEM_DATABASE_CAPACITY_BYTES; else process.env.SYSTEM_DATABASE_CAPACITY_BYTES = previousDatabaseEnv;
  if (previousStorageEnv === undefined) delete process.env.SYSTEM_STORAGE_CAPACITY_BYTES; else process.env.SYSTEM_STORAGE_CAPACITY_BYTES = previousStorageEnv;
  assert.deepEqual(calls, ["system_capacity_report", "system_capacity_settings_read", "system_capacity_report", "system_capacity_settings_read", "system_capacity_settings_save", "capture_system_capacity_snapshot"]);
  await assert.rejects(repo.systemCapacityReport({ async rpc() { return { error: { code: "PGRST202", message: "missing" } }; } }), /requires.*migration/);
  const migration = await readFile(new URL("../../supabase/migrations/20261008045010_system_capacity_snapshots.sql", import.meta.url), "utf8");
  assert.match(migration, /supplier_capacity_compact_finalized\(true\)/);
  assert.doesNotMatch(migration, /supplier_capacity_report\(\)|supplier_compact_finalized_source\(|supplier_capacity_source_storage\(/);
  assert.doesNotMatch(migration, /\b(update|delete from|truncate|vacuum|reindex)\s+(public\.|storage\.)/i);
  assert.equal((migration.match(/insert into /gi) ?? []).length, 1);
  assert.match(migration, /insert into public\.system_capacity_snapshots/);
});
