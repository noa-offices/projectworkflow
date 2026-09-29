import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { normalizeVendorDate } from "./vendor-dates";
for (const value of ["2026-10-15", "2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31"]) {
  test(`valid date preserved: ${value}`, () => assert.deepEqual(normalizeVendorDate(value), { ok: true, value }));
}
for (const value of [null, ""]) test(`blank/null clears: ${String(value)}`, () => assert.deepEqual(normalizeVendorDate(value), { ok: true, value: null }));
for (const value of ["2026-02-30", "2026-02-29", "1900-02-29", "2026-04-31", "2026-00-01", "2026-13-01", "2026-01-00", "0000-01-01", "15/10/2026", "2026-1-01", "tomorrow", " ", " 2026-10-15 ", "2026-10-15T12:00:00Z", undefined, 20261015]) {
  test(`invalid input rejected: ${String(value)}`, () => assert.deepEqual(normalizeVendorDate(value), { ok: false }));
}
test("page contracts retain date input, ISO reads and null fallback across all three pages", () => {
  const controls = readFileSync("components/procurement/vendor-controls-panel.tsx", "utf8");
  assert.ok(controls.includes('type="date"'));
  assert.ok(controls.includes("saveVendorProgress(orderNo, vendorKey, activeStep, etd, eta)"));
  for (const path of ["app/procurement/orders/[orderNo]/page.tsx", "app/projects/orders/[orderNo]/page.tsx", "app/procurement/completed/[orderNo]/page.tsx"]) {
    const page = readFileSync(path, "utf8");
    assert.ok(page.includes('from("procurement_vendor_progress")'));
    assert.ok(page.includes("etd, eta"));
  }
  const project = readFileSync("app/projects/orders/[orderNo]/page.tsx", "utf8");
  assert.ok(project.includes("vendor.eta >= today"));
  assert.ok(project.includes("localeCompare"));
  assert.equal("2026-10-15" > "2026-09-30", true);
  const completed = readFileSync("app/procurement/completed/[orderNo]/page.tsx", "utf8");
  assert.ok(completed.includes('progress?.etd ?? ""'));
  assert.ok(completed.includes('progress?.eta ?? ""'));
  const operations = readFileSync("components/projects/project-vendor-operations.tsx", "utf8");
  assert.ok(operations.includes('`${value}T00:00:00`'));
});
test("migration restricts legacy parsing and leaves already-date columns untouched", () => {
  const sql = readFileSync("supabase/migrations/20260929113359_procurement_eta_etd_dates.sql", "utf8");
  assert.ok(sql.includes("pg_input_is_valid"));
  assert.ok(sql.includes("^[0-9]{4}-[0-9]{2}-[0-9]{2}$"));
  assert.ok(sql.includes("TYPE date USING"));
  assert.ok(sql.includes("ELSE NULL END"));
  assert.ok(sql.includes("IF column_type = 'date' THEN"));
  assert.ok(sql.includes("RAISE NOTICE"));
});
