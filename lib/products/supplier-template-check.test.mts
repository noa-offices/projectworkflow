import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveSupplierBrandPriceStatus, resolveSupplierFamilyPriceStatus, supplierFamilyStatusPresentation, type SupplierResponsibilityInput, type SupplierTemplateCheckFact } from "./supplier-family-status";
import type { PriceLine, PriceLineState } from "./supplier-price-lines";
import { supplierLatestTemplateChecks, supplierMarkTemplateChecked, type SupplierFamilyReviewFact } from "./supplier-price-repository";
import { evaluateTemplateCheck, type TemplateCheckInput } from "./supplier-template-check";

const line = (state: PriceLineState, extra: Partial<PriceLine> = {}): PriceLine => ({ key: `${state}-${Math.random()}`, code: "C", field: "", ourPrice: 1, ourCurrency: "EUR", supplierPrice: 1, supplierCurrency: "EUR", difference: 0, state, ...extra });
const input = (lines: PriceLine[], extra: Partial<TemplateCheckInput> = {}): TemplateCheckInput => ({ lines, truncated: false, families: [], chosen: [], missing: [], ...extra });

test("a product whose lines are all Same or confirmed Shared can be marked as checked", () => {
  const verdict = evaluateTemplateCheck(input([line("same"), line("same"), line("shared"), line("shared")]));
  assert.deepEqual([verdict.ok, verdict.blockers, verdict.lineCount], [true, [], 4]);
  assert.deepEqual(verdict.summary, { same: 2, shared: 2, families: [] });
  const withFamily = evaluateTemplateCheck(input([line("same")], { families: [{ key: "every" }], chosen: [{ key: "every", family: "EVERY" }] }));
  assert.deepEqual([withFamily.ok, withFamily.summary.families], [true, ["EVERY"]]);
});

test("every blocker refuses with a plain reason", () => {
  const messages = (lines: PriceLine[], extra: Partial<TemplateCheckInput> = {}) => evaluateTemplateCheck(input(lines, extra)).blockers.join(" | ");
  assert.match(messages([line("same"), line("changed")]), /1 line changed\. Review them first\./);
  assert.match(messages([line("needs_mapping"), line("needs_mapping")]), /2 lines need mapping\./);
  assert.match(messages([line("needs_mapping")]), /1 line needs mapping\./);
  assert.match(messages([line("ambiguous")]), /1 line unclear or missing from the price list\./);
  assert.match(messages([line("not_in_supplier_list")]), /unclear or missing/);
  assert.match(messages([line("same", { ourPrice: null })]), /1 line has an empty price\. Set the price first\./);
  assert.match(messages([line("same", { ourPrice: null }), line("same", { ourPrice: null })]), /2 lines have an empty price\./);
  assert.match(messages([line("same", { familyHint: "choose_family" })]), /Choose a family for this product first\./);
  assert.match(messages([line("needs_mapping")], { families: [{ key: "every" }], chosen: [] }), /Choose a family for this product first\./);
  assert.match(messages([line("same")], { missing: [{ family: "EVERY" }] }), /This family is not in the price list: EVERY\. Choose again\./);
  assert.match(messages([]), /no lines in this price list/);
  assert.match(messages([line("same")], { truncated: true }), /too many lines/);
  for (const state of ["changed", "needs_mapping", "ambiguous", "not_in_supplier_list"] as const) assert.equal(evaluateTemplateCheck(input([line(state)])).ok, false, state);
});

const D = "D1", S = "S1";
const responsibility: SupplierResponsibilityInput = { templateId: "T1", definitionId: D, definitionName: "INTERSTUHL", versions: [{ id: S, title: "October 2026", status: "imported", effective_from: "2026-01-02", created_at: "2026-01-02T00:00:00Z" }] };
const fact = (extra: Partial<SupplierFamilyReviewFact> = {}): SupplierFamilyReviewFact => ({ brandId: "B", templateId: "T1", sourceId: S, batchId: "batch1", batchStatus: "review", completedAt: null, scope: "complete", inCoverage: true, hasReviewEvidence: true, totalTargets: 3, excludedTargets: 0, resolvedTargets: 0, unresolvedTargets: 3, fullyChecked: false, partiallyChecked: false, ...extra });
const check = (extra: Partial<SupplierTemplateCheckFact> = {}): SupplierTemplateCheckFact => ({ templateId: "T1", sourceId: S, pricingVersion: "5", checkedAt: "2026-11-03T10:00:00Z", ...extra });
const resolve = (extra: { checks?: SupplierTemplateCheckFact[]; version?: string | null; facts?: SupplierFamilyReviewFact[] } = {}) => resolveSupplierFamilyPriceStatus({
  businessDate: "2026-11-04", families: [{ templateId: "T1", brandId: "B", pricingVersion: extra.version === undefined ? "5" : extra.version }], responsibilities: [responsibility], facts: extra.facts ?? [fact()], ...(extra.checks ? { checks: extra.checks } : {}),
})[0];

test("status engine: with no check, nothing changes (identical to today)", () => {
  const today = resolveSupplierFamilyPriceStatus({ businessDate: "2026-11-04", families: [{ templateId: "T1", brandId: "B" }], responsibilities: [responsibility], facts: [fact()] })[0];
  assert.equal(today.status, "needs_attention");
  assert.deepEqual(resolve(), today);
  assert.deepEqual(resolve({ checks: [] }), today);
  assert.deepEqual(resolve({ checks: [check({ templateId: "OTHER" })] }), today, "a check of another product is ignored");
});

test("status engine: a valid check gives Price checked and beats a stale open review", () => {
  const status = resolve({ checks: [check()] });
  assert.deepEqual([status.status, status.label, status.checkedAt], ["price_checked", "Price checked", "2026-11-03T10:00:00Z"]);
  const presentation = supplierFamilyStatusPresentation(status);
  assert.deepEqual([presentation.tone, presentation.label, presentation.detail], ["success", "Price checked", "Checked on 3 Nov 2026"]);
  // The newest check for the pair counts.
  assert.equal(resolve({ checks: [check({ pricingVersion: "4", checkedAt: "2026-11-01T10:00:00Z" }), check()] }).status, "price_checked");
});

test("status engine: a check from an older pricing version reads Edited since check (warning)", () => {
  const status = resolve({ checks: [check({ pricingVersion: "4" })] });
  assert.deepEqual([status.status, status.label], ["edited_since_check", "Edited since check"]);
  const presentation = supplierFamilyStatusPresentation(status);
  assert.equal(presentation.tone, "warning");
  assert.match(presentation.detail, /Product prices changed after the check on 3 Nov 2026/);
  // It beats a stale open review too, but a review COMPLETED after the check wins.
  const completedLater = fact({ batchStatus: "completed", completedAt: "2026-11-05T10:00:00Z", fullyChecked: true, resolvedTargets: 3, unresolvedTargets: 0 });
  assert.equal(resolve({ checks: [check({ pricingVersion: "4" })], facts: [completedLater] }).status, "price_checked");
  assert.equal(resolve({ checks: [check({ pricingVersion: "4" })], facts: [fact({ batchStatus: "completed", completedAt: "2026-11-02T10:00:00Z", fullyChecked: true, resolvedTargets: 3, unresolvedTargets: 0 })] }).status, "edited_since_check");
});

test("status engine: a check for another price list, or without a known current version, is ignored (today's behaviour)", () => {
  assert.equal(resolve({ checks: [check({ sourceId: "NEW-LIST" })] }).status, "needs_attention", "a new price list has a different source id");
  assert.equal(resolve({ checks: [check()], version: null }).status, "needs_attention", "unknown version: not trusted");
  assert.equal(resolve({ checks: [check()], version: undefined as unknown as null }).status, "price_checked");
});

test("brand summary counts Edited since check as an update to look at, never as checked", () => {
  const summary = resolveSupplierBrandPriceStatus([{ status: "edited_since_check" }, { status: "price_checked" }]);
  assert.deepEqual([summary.updateAvailableFamilies, summary.checkedFamilies, summary.applicableFamilies], [1, 1, 2]);
  assert.equal(resolveSupplierBrandPriceStatus([{ status: "price_checked" }]).state, "current");
});

const rpcClient = (results: Array<{ data: unknown; error: { code?: string; message: string } | null }>) => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  let index = 0;
  return { calls, client: { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return results[Math.min(index++, results.length - 1)]; } } as unknown as SupabaseClient };
};

test("the repository wrappers: one write with the exact payload; reads tolerate a missing function or role and page by 50 brands", async () => {
  const write = rpcClient([{ data: { id: "c1" }, error: null }]);
  assert.deepEqual(await supplierMarkTemplateChecked(write.client, { definitionId: "d", sourceId: "s", templateId: "t", expectedPricingVersion: "5", lineCount: 3, summary: { same: 3 } }), { id: "c1" });
  assert.deepEqual(write.calls, [{ name: "supplier_price_review_write", args: { p_operation: "template_check_set", p_payload: { definition_id: "d", source_id: "s", template_id: "t", expected_pricing_version: "5", line_count: 3, summary: { same: 3 } } } }]);
  const rows = [{ template_id: "t", source_id: "s", definition_id: "d", pricing_version: "5", line_count: 3, checked_at: "2026-11-03T10:00:00Z" }];
  assert.deepEqual(await supplierLatestTemplateChecks(rpcClient([{ data: rows, error: null }]).client, ["b"]), rows);
  for (const code of ["PGRST202", "42883", "42501"]) assert.deepEqual(await supplierLatestTemplateChecks(rpcClient([{ data: null, error: { code, message: "x" } }]).client, ["b"]), [], code);
  await assert.rejects(() => supplierLatestTemplateChecks(rpcClient([{ data: null, error: { code: "57014", message: "statement timeout" } }]).client, ["b"]), /statement timeout/);
  const paged = rpcClient([{ data: [], error: null }]);
  await supplierLatestTemplateChecks(paged.client, Array.from({ length: 51 }, (_, i) => `b${i}`));
  assert.deepEqual(paged.calls.map((call) => (call.args.p_brand_ids as string[]).length), [50, 1]);
});

test("the server action trusts only two ids, reads the version first, refuses unless clean, and writes only the sign-off", () => {
  const action = readFileSync("components/quotations/supplier-template-check-actions.ts", "utf8");
  assert.match(action, /export async function markTemplateSupplierPriceChecked\(templateId: string, sourceId: string\)/);
  const body = action.slice(action.indexOf("export async function markTemplateSupplierPriceChecked"));
  const order = ["canApproveBrandPrices(", '"product_templates", "id,pricing_version"', "supplierTemplatePriceLines(templateId)", "evaluateTemplateCheck(source)", "if (!verdict.ok) throw", "await supplierMarkTemplateChecked("].map((text) => body.indexOf(text));
  assert.ok(order.every((position) => position > 0) && order.every((position, index) => index === 0 || position > order[index - 1]), "role, version, rebuild, verdict, refuse, then the one write");
  assert.equal((body.match(/await supplierMarkTemplateChecked\(/g) ?? []).length, 1);
  assert.match(body, /expectedPricingVersion: String\(template\.pricing_version\)/);
  assert.doesNotMatch(action, /supplierWrite|saveSupplierDecision|applySupplierReviewedPrice|confirmSupplier|completeSupplier|\.update\(|\.insert\(|\.delete\(|\.rpc\(/);
  const lines = readFileSync("components/quotations/supplier-price-lines-actions.ts", "utf8");
  assert.match(lines, /sources\.push\(\{ definitionId: definition\.id, sourceId: current\.id,/);
  // Backend only: no screen or popup uses it yet.
  for (const file of ["components/quotations/supplier-price-lines-popup.tsx", "components/quotations/product-library-selector.tsx", "components/quotations/local-quotation-builder.tsx"]) assert.doesNotMatch(readFileSync(file, "utf8"), /markTemplateSupplierPriceChecked/, file);
  const loader = readFileSync("lib/products/supplier-family-price-status-loader.ts", "utf8");
  assert.match(loader, /supplierLatestTemplateChecks\(client, brandIds\)/);
  assert.match(loader, /pricingVersion: family\.pricing_version === undefined \|\| family\.pricing_version === null \? null : String\(family\.pricing_version\)/);
});

test("the migration: closed table, role checks inside, anchor guard, and nothing but the sign-off is written", () => {
  const sql = readFileSync("supabase/migrations/20261103100000_supplier_template_checks.sql", "utf8");
  assert.match(sql, /enable row level security;\s*revoke all on public\.supplier_template_checks from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /create policy|grant (select|insert|update|delete|all) on public\.supplier_template_checks/i);
  assert.match(sql, /elsif p_operation='template_check_set' then\s*if not public\.current_user_can_approve_brand_prices\(\) then raise insufficient_privilege/);
  assert.match(sql, /auth\.uid\(\) is null or not public\.current_user_can_review_brand_prices\(\)/);
  assert.match(sql, /position\('template_check_set' in definition\)>0\s*or \(length\(definition\)-length\(replace\(definition,anchor,''\)\)\)\/length\(anchor\)<>1/);
  assert.match(sql, /for update;/, "the product row is locked while its version is compared");
  assert.match(sql, /pricing_version bigint not null/);
  assert.doesNotMatch(sql, /\bupdate public\.|delete from public\.|supplier_price_batches|supplier_price_decisions|brand_price_list_updates|supplier_price_bindings/);
});
