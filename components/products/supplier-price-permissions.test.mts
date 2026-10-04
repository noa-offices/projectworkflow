import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { canApproveBrandPrices, canReviewBrandPrices } from "../../lib/products/brand-price-permissions.js";
import type { AppRole } from "../../lib/supabase/types.js";

const read = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
async function load<T>(path: string, dependencies: Record<string, unknown> = {}): Promise<T> {
  const url = new URL(path, import.meta.url);
  const output = ts.transpileModule(await read(path), { fileName: fileURLToPath(url), compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const compiled = { exports: {} };
  new Function("require", "module", "exports", output)((name: string) => Object.hasOwn(dependencies, name) ? dependencies[name] : createRequire(url)(name.startsWith("@/") ? fileURLToPath(new URL(`../../${name.slice(2)}`, import.meta.url)) : name), compiled, compiled.exports);
  return compiled.exports as T;
}

// "sales_manager" is not a role in the current AppRole type; it is tested as an unknown role, which must fail closed.
const matrix: Array<[string, boolean]> = [["system_owner", true], ["admin_manager", true], ["procurement_manager", true], ["sales_coordinator", true], ["designer", true], ["sales_manager", false], ["sales_designer", false], ["viewer", false]];

test("Supplier price role matrix: five editors, everyone else read-only, inactive accounts never", () => {
  for (const [role, editor] of matrix) {
    assert.equal(canReviewBrandPrices(role as AppRole, "active"), editor, `${role} review`);
    assert.equal(canApproveBrandPrices(role as AppRole, "active"), editor, `${role} approve`);
    for (const state of ["pending", "disabled", null, undefined] as const) { assert.equal(canReviewBrandPrices(role as AppRole, state), false); assert.equal(canApproveBrandPrices(role as AppRole, state), false); }
  }
  assert.equal(canReviewBrandPrices(null, "active"), false); assert.equal(canApproveBrandPrices(undefined, "active"), false);
});

const permissionError = /approver permission required|price-review access required/;
async function actionsFor(role: string) {
  const calls: string[] = [];
  const repository = new Proxy({}, { get: (_, name: string) => async (..._args: unknown[]) => { calls.push(name); return name === "supplierBrandTargets" ? { targets: [], templates: [] } : name === "supplierBrandMatches" ? { matches: [], targets: [], templates: [], source: {} } : { id: "x", message: "ok", title: "t" }; } });
  const actions = await load<Record<string, (...args: unknown[]) => Promise<unknown>>>("../../app/products/price-updates/supplier-sources/actions.ts", {
    "next/cache": { revalidatePath() {} },
    "@/lib/auth": { async requireBrandPriceReviewer() { if (!canReviewBrandPrices(role as AppRole, "active")) throw Error("price-review access required"); return { profile: { role, account_status: "active" } }; } },
    "@/lib/supabase/server": { async createClient() { return {}; } },
    "@/lib/products/supplier-price-repository": repository,
  });
  return { actions, calls };
}
const mutations: Array<[string, unknown[]]> = [
  ["saveSupplierProfile", ["b", "LAS", {}]], ["createSupplierSource", [{}]], ["attachSupplierWorkingFile", ["s", "p"]], ["uploadSupplierChunk", ["s", 0, []]], ["finalizeSupplierSource", ["s"]], ["archiveSupplierSource", ["s"]],
  ["createSupplierReviewBatch", ["s", "complete", []]], ["saveSupplierDecision", ["r", "k", "reviewed", ""]], ["applySupplierReviewedPrice", ["r", "k"]], ["confirmSupplierUnchangedPrice", ["r", "k"]],
  ["completeSupplierPriceReview", ["r"]], ["excludeSupplierTargetFromSource", ["r", "k", "why"]], ["bulkApplySupplierChangedPrices", ["r", ["k"]]], ["bulkConfirmSupplierUnchanged", ["r", ["k"]]],
  ["bulkExcludeSupplierMissing", ["r", ["k"], "why"]], ["saveSupplierDimension", [{ brand_id: "b", raw_labels: ["x"], finish_codes: [], dimension_code: "d" }]], ["confirmSupplierBindings", ["b", []]], ["archiveSupplierDimension", ["d"]],
];

for (const [role, editor] of matrix) test(`server actions: ${role} ${editor ? "can modify" : "is rejected"}`, async () => {
  const { actions, calls } = await actionsFor(role);
  for (const [name, args] of mutations) {
    assert.equal(typeof actions[name], "function", name);
    const outcome = await actions[name](...args).then(() => null, (error: Error) => error.message);
    if (editor) assert.ok(outcome === null || !permissionError.test(outcome), `${name}: ${outcome}`); // other validation may still apply, but never a permission rejection
    else assert.match(outcome ?? "", permissionError, name);
  }
  if (!editor) assert.deepEqual(calls, [], "no repository or database work for read-only roles");
  else assert.ok(calls.length > 0);
});

test("UI mutation controls follow the same helper for all roles", async () => {
  const common = { "next/link": { default: ({ children, ...props }: { children: unknown }) => React.createElement("a", props, children as never) }, "next/navigation": { useRouter() { return { refresh() {}, push() {} }; } },
    "@/lib/supabase/client": { createClient() { assert.fail("no client"); } }, "@/app/products/price-updates/supplier-sources/actions": {} };
  const controls = await load<Record<string, (props: Record<string, unknown>) => React.ReactElement | null>>("./supplier-price-workspace-controls.tsx", common);
  const family = await load<Record<string, (props: Record<string, unknown>) => React.ReactElement | null>>("./supplier-family-review.tsx", common);
  const html = (component: (props: Record<string, unknown>) => React.ReactElement | null, props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(component as never, props as never));
  const rows = [{ key: "k", code: "103801", item: "Screen", current: "EUR 92", supplier: "EUR 81", change: "-11", issue: "", action: "", classification: "decreased", selectable: true }];
  const match = { key: "m", classification: "decreased", decision: "reviewed", source: { code: "1", dimension: "", currency: "EUR", price: 81, finishes: [], row_keys: [], issues: [], raw_dimension: "" }, targets: [{ key: "t", code: "1", template_name: "T", label: "L", dimension: "", currency: "EUR", price: 92, brand_id: "b" }] };
  for (const [role, editor] of matrix) {
    const approver = canApproveBrandPrices(role as AppRole, "active");
    const table = html(family.SupplierFamilyTable, { batchId: "r", familyName: "F", section: "changed", tabs: ["changed", "same", "missing", "attention"].map((section) => ({ section, label: section, count: 1, href: "/x" })), rows, truncated: false, approver, batchOpen: true, limit: 50, backHref: "/b", detailsHref: "/d" });
    assert.equal(/type="checkbox"/.test(table), editor, `${role} checkboxes`); assert.equal(/An approver applies, confirms or excludes items\./.test(table), !editor, `${role} read-only note`);
    assert.equal(html(controls.SupplierCompletionControls, { batchId: "r", scope: "complete", status: "review", approver }) !== "", editor, `${role} completion`);
    assert.equal(html(controls.SupplierAdvancedImportSettings, { brandId: "b", brandName: "LAS", basis: "list", approver, templates: [] }) !== "", editor, `${role} advanced settings`);
    const review = html(controls.SupplierReviewControls, { batchId: "r", brandId: "b", matches: [match], approver, sourceBasis: "list", brandBasis: "list", sourceStatus: "imported", batchStatus: "review" });
    assert.equal(/>Apply price</.test(review), editor, `${role} apply`);
  }
  // No role lists are duplicated in the UI: every screen takes its flag from the shared helper.
  for (const path of ["./supplier-price-workspace-controls.tsx", "./supplier-family-review.tsx", "./supplier-price-workflow.tsx", "../../app/products/price-updates/supplier-sources/page.tsx"]) assert.doesNotMatch(await read(path), /["']system_owner["']|["']procurement_manager["']|["']sales_coordinator["']/, path);
  assert.match(await read("../../app/products/price-updates/supplier-sources/page.tsx"), /canApproveBrandPrices\(profile\?\.role, profile\?\.account_status\)/);
});

test("the database helpers match the editor set and the migration is forward-only with unchanged grants", async () => {
  const migration = await read("../../supabase/migrations/20261004150000_supplier_price_editor_roles.sql");
  const list = "('system_owner', 'admin_manager', 'procurement_manager', 'sales_coordinator', 'designer')";
  assert.equal(migration.split(list).length - 1, 2); // review and approve use the same five roles
  assert.match(migration, /security invoker set search_path = ''/); assert.doesNotMatch(migration, /sales_manager|sales_designer|viewer|security definer/);
  assert.match(migration, /grant execute on function public\.current_user_can_review_brand_prices\(\) to authenticated/); assert.match(migration, /grant execute on function public\.current_user_can_approve_brand_prices\(\) to authenticated/);
});
