import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSupplierFamilyPriceStatus, supplierFamilyStatusPresentation, type SupplierResponsibilityInput, type SupplierTemplateCheckFact } from "./supplier-family-status";
import { supplierLatestTemplateChecks, type SupplierFamilyReviewFact } from "./supplier-price-repository";

const responsibility: SupplierResponsibilityInput = { templateId: "T1", definitionId: "D1", definitionName: "INTERSTUHL", versions: [{ id: "S1", title: "October 2026", status: "imported", effective_from: "2026-01-02", created_at: "2026-01-02T00:00:00Z" }] };
const fact: SupplierFamilyReviewFact = { brandId: "B", templateId: "T1", sourceId: "S1", batchId: "batch1", batchStatus: "review", completedAt: null, scope: "complete", inCoverage: true, hasReviewEvidence: true, totalTargets: 3, excludedTargets: 0, resolvedTargets: 0, unresolvedTargets: 3, fullyChecked: false, partiallyChecked: false };
const check = (extra: Partial<SupplierTemplateCheckFact> = {}): SupplierTemplateCheckFact => ({ templateId: "T1", sourceId: "S1", pricingVersion: "5", checkedAt: "2026-10-31T10:00:00Z", ...extra });
const resolve = (checks: SupplierTemplateCheckFact[]) => resolveSupplierFamilyPriceStatus({ businessDate: "2026-11-04", families: [{ templateId: "T1", brandId: "B", pricingVersion: "5" }], responsibilities: [responsibility], facts: [fact], checks })[0];

test("the status text says who checked it, in the engine detail and in the badge", () => {
  const named = resolve([check({ checkedByName: "Dana Owner" })]);
  assert.equal(named.status, "price_checked");
  assert.equal(named.checkedByName, "Dana Owner");
  assert.match(named.detail, /checked on 31 Oct 2026 by Dana Owner$/);
  const presentation = supplierFamilyStatusPresentation(named);
  assert.deepEqual([presentation.label, presentation.tone, presentation.detail], ["Price checked", "success", "Checked on 31 Oct 2026 by Dana Owner"]);
});

test("without a name the text is exactly what it was before", () => {
  const unnamed = resolve([check()]);
  assert.equal("checkedByName" in unnamed, false);
  assert.match(unnamed.detail, /checked on 31 Oct 2026$/);
  assert.equal(supplierFamilyStatusPresentation(unnamed).detail, "Checked on 31 Oct 2026");
  assert.equal(supplierFamilyStatusPresentation(resolve([check({ checkedByName: undefined })])).detail, "Checked on 31 Oct 2026");
});

test("other statuses and wording are unchanged by a name", () => {
  const edited = resolve([check({ pricingVersion: "4", checkedByName: "Dana Owner" })]);
  assert.equal(edited.status, "edited_since_check");
  assert.equal("checkedByName" in edited, false);
  assert.equal(supplierFamilyStatusPresentation(edited).detail, "Product prices changed after the check on 31 Oct 2026");
  assert.equal(resolve([]).status, "needs_attention");
});

const rpcClient = (data: unknown) => ({ rpc: async () => ({ data, error: null }) }) as unknown as SupabaseClient;

test("the wrapper passes the name through, and the older function (no key) still works", async () => {
  const base = { template_id: "t", source_id: "s", definition_id: "d", pricing_version: "5", line_count: 3, checked_at: "2026-10-31T10:00:00Z" };
  assert.deepEqual(await supplierLatestTemplateChecks(rpcClient([{ ...base, checked_by_name: "Dana Owner" }]), ["b"]), [{ ...base, checked_by_name: "Dana Owner" }]);
  assert.deepEqual(await supplierLatestTemplateChecks(rpcClient([base]), ["b"]), [base], "no key: rows are returned as they are");
  assert.deepEqual(await supplierLatestTemplateChecks(rpcClient([{ ...base, checked_by_name: null }]), ["b"]), [{ ...base, checked_by_name: null }]);
});

test("the loader, the lines action and the popup read the name and fall back to today's text", () => {
  const loader = readFileSync("lib/products/supplier-family-price-status-loader.ts", "utf8");
  assert.match(loader, /\.\.\.\(row\.checked_by_name\?\.trim\(\) \? \{ checkedByName: row\.checked_by_name\.trim\(\) \} : \{\}\)/, "a missing, null or blank name adds nothing");
  const action = readFileSync("components/quotations/supplier-price-lines-actions.ts", "utf8");
  assert.match(action, /checkedByName: newest\.checked_by_name\?\.trim\(\) \|\| null/);
  assert.match(action, /check: \{ checkedAt: string; valid: boolean; \/\*\* The checker's full name, when known\. \*\/ checkedByName: string \| null \} \| null/);
  const popup = readFileSync("components/quotations/supplier-price-lines-popup.tsx", "utf8");
  assert.match(popup, /Checked on \{checkedDate\(source\.check\.checkedAt\)\}\{source\.check\.checkedByName \? ` by \$\{source\.check\.checkedByName\}` : ""\}/);
  // The write operation and the sign-off rules are untouched.
  const checkAction = readFileSync("components/quotations/supplier-template-check-actions.ts", "utf8");
  assert.doesNotMatch(checkAction, /checked_by_name|checkedByName/);
});

test("the migration patches the read function in place, behind a guard, and touches nothing else", () => {
  const sql = readFileSync("supabase/migrations/20261104100000_supplier_template_checks_checked_by_name.sql", "utf8");
  assert.match(sql, /'checked_by_name', x\.checked_by_name/);
  assert.match(sql, /nullif\(btrim\(p\.full_name\), ''\)/);
  assert.match(sql, /position\('checked_by_name' in definition\) > 0 then raise exception 'supplier_template_checks_latest is already patched'/);
  assert.match(sql, /<> 1 then\s*raise exception 'Deployed supplier_template_checks_latest differs from the expected body; review before migrating'/);
  assert.match(sql, /execute replace\(replace\(definition, old_keys, new_keys\), old_select, new_select\)/);
  assert.doesNotMatch(sql, /p\.email|p\.role|'email'|'role'|'checked_by'|'user_id'/, "no email, role or user id is returned");
  assert.doesNotMatch(sql, /create table|alter table|create policy|enable row level security|template_check_set|create function|grant |revoke /i, "table, RLS, write operation and grants are not touched");
});
