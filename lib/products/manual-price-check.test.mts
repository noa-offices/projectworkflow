import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { latestPassedManualRelease, manualPriceStateFromRows, resolveManualFamilyStatus, type ManualBrandState, type ManualPriceRelease } from "./manual-price-check.js";
import { resolveSupplierBrandPriceStatus, resolveSupplierFamilyPriceStatus, supplierFamilyStatusPresentation, type SupplierResponsibilityInput } from "./supplier-family-status.js";

const BRAND = "colan", T1 = "tpl-1";
const release = (id: string, effectiveFrom: string, extra: Partial<ManualPriceRelease> = {}): ManualPriceRelease => ({ id, brandId: BRAND, effectiveFrom, note: `List ${id}`, createdAt: `${effectiveFrom}T08:00:00Z`, ...extra });
const state = (releases: ManualPriceRelease[], checks: ManualBrandState["checks"] = []): ManualBrandState => ({ brandId: BRAND, releases, checks });
const check = (releaseId: string, pricingVersion = "5", extra: Partial<ManualBrandState["checks"][number]> = {}) => ({ releaseId, templateId: T1, pricingVersion, checkedAt: "2026-02-03T09:00:00Z", checkedByName: "Sara Khan", ...extra });
const status = (s: ManualBrandState | undefined, businessDate: string, pricingVersion: string | null = "5") => resolveManualFamilyStatus({ state: s, templateId: T1, pricingVersion, businessDate });

test("no release yet, or the release date has not come: Manual price check", () => {
  assert.equal(status(undefined, "2026-02-01").status, "legacy_manual");
  assert.equal(status(state([]), "2026-02-01").status, "legacy_manual");
  assert.equal(status(state([release("r1", "2026-03-01")]), "2026-02-28").status, "legacy_manual");
});

test("from the release date on, an unchecked product is Price update due (the date itself counts)", () => {
  const s = state([release("r1", "2026-03-01")]);
  assert.equal(status(s, "2026-03-01").status, "price_update_due");
  assert.equal(status(s, "2026-06-01").status, "price_update_due");
});

test("checked for the latest release with the same pricing version: Price checked, with who and when", () => {
  const result = status(state([release("r1", "2026-01-15")], [check("r1")]), "2026-02-10");
  assert.equal(result.status, "price_checked");
  assert.ok(result.status === "price_checked" && result.checkedByName === "Sara Khan" && result.checkedAt === "2026-02-03T09:00:00Z");
});

test("prices changed after the check: Edited since check", () => {
  assert.equal(status(state([release("r1", "2026-01-15")], [check("r1", "4")]), "2026-02-10", "5").status, "edited_since_check");
});

test("a new release resets every product; an old release's check no longer counts", () => {
  const s = state([release("r1", "2026-01-15"), release("r2", "2026-04-01")], [check("r1")]);
  assert.equal(status(s, "2026-03-01").status, "price_checked", "before the new date the old release is still the latest");
  assert.equal(status(s, "2026-04-01").status, "price_update_due");
  assert.equal(status(state(s.releases, [check("r1"), check("r2")]), "2026-04-02").status, "price_checked");
});

test("a future release is ignored, the latest passed one counts, same-day releases use the newest record", () => {
  const releases = [release("r1", "2026-01-15"), release("r2", "2026-09-01"), release("r3", "2026-01-15", { createdAt: "2026-01-15T12:00:00Z" })];
  assert.equal(latestPassedManualRelease(releases, "2026-02-01")?.id, "r3");
  assert.equal(latestPassedManualRelease(releases, "2026-09-01")?.id, "r2");
  assert.equal(latestPassedManualRelease([release("r2", "2026-09-01")], "2026-02-01"), null);
});

test("an unknown pricing version never counts as checked", () => {
  assert.equal(status(state([release("r1", "2026-01-15")], [check("r1")]), "2026-02-10", null).status, "price_update_due");
});

test("the newest check for a release wins (re-check after an edit)", () => {
  const checks = [check("r1", "4", { checkedAt: "2026-02-01T00:00:00Z" }), check("r1", "5", { checkedAt: "2026-02-05T00:00:00Z" })];
  assert.equal(status(state([release("r1", "2026-01-15")], checks), "2026-02-10", "5").status, "price_checked");
});

// ---- the shared resolver ----
const family = (templateId: string, brandId: string, pricingVersion: string | null = "5") => ({ templateId, brandId, pricingVersion });
const manual = new Map([[BRAND, state([release("r1", "2026-01-15")], [check("r1")])]]);

test("the shared resolver gives manual Brands the manual statuses and the right labels", () => {
  const [checked, due] = resolveSupplierFamilyPriceStatus({ businessDate: "2026-02-10", families: [family(T1, BRAND), family("tpl-2", BRAND)], responsibilities: [], facts: [], manual });
  assert.deepEqual([checked.status, checked.label], ["price_checked", "Price checked"]);
  assert.deepEqual([due.status, due.label], ["price_update_due", "Price update due"]);
  assert.equal(due.manualReleaseId, "r1");
  assert.equal(checked.manualReleaseId, undefined);
  assert.match(supplierFamilyStatusPresentation(checked).detail, /^Checked on 3 Feb 2026 by Sara Khan$/);
  assert.equal(supplierFamilyStatusPresentation(due).manualCheck, true);
  assert.equal(supplierFamilyStatusPresentation(checked).manualCheck, undefined);
  const edited = resolveSupplierFamilyPriceStatus({ businessDate: "2026-02-10", families: [family(T1, BRAND, "6")], responsibilities: [], facts: [], manual })[0];
  assert.equal(edited.status, "edited_since_check");
});

test("a manual Brand with no passed release keeps the legacy status", () => {
  const early = new Map([[BRAND, state([release("r1", "2026-05-01")])]]);
  const [item] = resolveSupplierFamilyPriceStatus({ businessDate: "2026-02-10", families: [family(T1, BRAND)], responsibilities: [], facts: [], manual: early, legacyDetail: () => "Interval check: last checked 2026-01-01" });
  assert.deepEqual([item.status, item.label, item.detail], ["legacy_manual", "Manual price check", "Interval check: last checked 2026-01-01"]);
});

test("Brands with Supplier codes are unchanged, even next to a manual Brand", () => {
  const responsibilities: SupplierResponsibilityInput[] = [{ templateId: "coded-1", definitionId: "d1", definitionName: "LAS", versions: [{ id: "v1", title: "List", status: "imported", effective_from: null, created_at: "2026-01-01T00:00:00Z" }] }];
  const input = { businessDate: "2026-02-10", families: [family("coded-1", "las"), family("coded-2", "other"), family(T1, BRAND)], responsibilities, facts: [] };
  const withManual = resolveSupplierFamilyPriceStatus({ ...input, manual });
  const without = resolveSupplierFamilyPriceStatus(input);
  assert.deepEqual(withManual.slice(0, 2), without.slice(0, 2));
  assert.deepEqual(withManual.slice(0, 2).map((item) => item.status), ["update_available", "legacy_manual"]);
});

test("Brand summary counts due and edited manual products as updates waiting", () => {
  assert.equal(resolveSupplierBrandPriceStatus([{ status: "price_update_due" }, { status: "price_checked" }]).state, "partially_checked");
  assert.equal(resolveSupplierBrandPriceStatus([{ status: "price_update_due" }, { status: "edited_since_check" }]).state, "update_available");
  assert.equal(resolveSupplierBrandPriceStatus([{ status: "price_checked" }]).state, "current");
});

test("database rows become per-Brand state; unknown Brands are ignored", () => {
  const result = manualPriceStateFromRows([{ brand_ids: [BRAND], releases: [{ id: "r1", brand_id: BRAND, effective_from: "2026-01-15", note: "Colan 2026.1.15 list", created_by_name: " Sara ", created_at: "2026-01-15T08:00:00Z" }, { id: "x", brand_id: "other", effective_from: "2026-01-15", note: "", created_at: "2026-01-15T08:00:00Z" }], checks: [{ release_id: "r1", template_id: T1, pricing_version: "5", checked_at: "2026-02-03T09:00:00Z", checked_by_name: "Sara Khan" }, { release_id: "x", template_id: T1, pricing_version: "1", checked_at: "2026-02-03T09:00:00Z" }] }]);
  assert.deepEqual([...result.keys()], [BRAND]);
  assert.equal(result.get(BRAND)!.releases[0].createdByName, "Sara");
  assert.equal(result.get(BRAND)!.checks.length, 1);
});

test("the migration is additive, role-checked, closed, and never edits history", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261105100000_manual_price_check.sql", import.meta.url), "utf8");
  assert.match(sql, /price_check_mode text not null default 'supplier_codes'/);
  for (const table of ["brand_price_releases", "brand_price_release_checks"]) {
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(sql, new RegExp(`revoke all on public\\.${table} from public, anon, authenticated`));
  }
  assert.match(sql, /before update or delete on public\.brand_price_releases/);
  for (const fn of ["brand_price_check_mode_set", "brand_price_release_add", "brand_price_release_check_set"]) assert.match(sql, new RegExp(`function public\\.${fn}[\\s\\S]*?current_user_can_approve_brand_prices\\(\\)`));
  assert.match(sql, /function public\.brand_price_manual_state[\s\S]*?current_user_can_review_brand_prices\(\)/);
  assert.equal(/\bdrop table\b|\btruncate\b|\bdelete from\b/i.test(sql), false);
});
