import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DurableBinding, PriceTarget, SourceIdentity } from "./supplier-price-contracts";
import { supplierDimensionFamily, supplierFamilyKey } from "./supplier-price-import";
import { matchSupplierPrices } from "./supplier-price-matching";
import { supplierFamilyScope } from "./supplier-price-repository";

const target = (key: string, template_id: string, price: number, code = "521234", dimension = ""): PriceTarget => ({ key, template_id, template_name: template_id, brand_id: "b", architecture: "a", group_id: "g", row_id: "r", column_id: "c", dimension, price_field: "unit_price", physical_field: "unit_price", code, raw_code: code, price, currency: "EUR", pricing_version: "1", label: "Base" });
const tagged = (key: string, family: string, price: number, code = "521234", category = "") => ({ key, code, price_field: "unit_price", dimension: JSON.stringify([category, "series", family]), raw_dimension: category, finishes: [], price, currency: "EUR", row_keys: [], issues: [] }) as SourceIdentity;
const plain = (key: string, price: number, code = "521234", dimension = "") => ({ key, code, price_field: "unit_price", dimension, raw_dimension: dimension, finishes: [], price, currency: "EUR", row_keys: [], issues: [] }) as SourceIdentity;
const scope = (entries: Record<string, string[]>) => new Map(Object.entries(entries).map(([template, families]) => [template, new Set(families.map(supplierFamilyKey))]));
const byKey = (matches: ReturnType<typeof matchSupplierPrices>) => Object.fromEntries(matches.map((match) => [match.key, match.classification]));

const everyList = [tagged("aim", "AIM", 57), tagged("every", "EVERY", 58), tagged("goal", "Goal-Air", 57)];
const t1 = [target("t1", "T1", 58)];

test("golden: with no scope, an empty scope or a scope for other products, results are identical to today", () => {
  const sources = [...everyList, plain("untagged", 58, "999001"), tagged("cat", "EVERY", 13, "162S", "SG3"), plain("sg3", 13, "162S", "SG3")];
  const targets = [...t1, target("t2", "T2", 13, "162S", "SG3"), target("t3", "T3", 5, "999001")];
  const today = matchSupplierPrices(sources, targets);
  assert.deepEqual(matchSupplierPrices(sources, targets, [], [], undefined), today);
  assert.deepEqual(matchSupplierPrices(sources, targets, [], [], new Map()), today);
  assert.deepEqual(matchSupplierPrices(sources, targets, [], [], new Map([["T1", new Set<string>()]])), today);
  assert.deepEqual(matchSupplierPrices(sources, targets, [], [], scope({ "not-a-template": ["every"] })), today);
});

test("Every case: without a saved family all three need mapping; choosing EVERY gives Same against 58 and ignores the others", () => {
  assert.deepEqual(byKey(matchSupplierPrices(everyList, t1)), { aim: "needs_dimension_mapping", every: "needs_dimension_mapping", goal: "needs_dimension_mapping" });
  const chosen = matchSupplierPrices(everyList, t1, [], [], scope({ T1: ["EVERY"] }));
  assert.deepEqual(byKey(chosen), { aim: "unmatched", every: "unchanged", goal: "unmatched" });
  assert.deepEqual(chosen.find((match) => match.key === "every")?.targets.map((item) => item.key), ["t1"]);
  assert.ok(!chosen.some((match) => match.classification === "target_not_represented"), "the product's column is represented, not reported missing");
});

test("several chosen families with different prices are ambiguous, never picked", () => {
  const result = matchSupplierPrices(everyList, t1, [], [], scope({ T1: ["EVERY", "AIM"] }));
  assert.deepEqual(byKey(result), { aim: "ambiguous", every: "ambiguous", goal: "unmatched" });
  assert.ok(result.filter((match) => match.classification === "ambiguous").every((match) => match.comparison === undefined && match.targets.length === 1));
});

test("same code and same price in two chosen families resolves", () => {
  const result = matchSupplierPrices(everyList, [target("t1", "T1", 57)], [], [], scope({ T1: ["AIM", "Goal-Air"] }));
  assert.deepEqual(byKey(result), { aim: "unchanged", every: "unmatched", goal: "unchanged" });
});

test("family names are compared exactly after trimming, collapsing spaces and lower-casing, never by closest name", () => {
  assert.equal(supplierFamilyKey("  Goal   AIR "), "goal air");
  const spaced = [tagged("s", "  Every  ", 58)];
  assert.deepEqual(byKey(matchSupplierPrices(spaced, t1, [], [], scope({ T1: ["every"] }))), { s: "unchanged" });
  assert.deepEqual(byKey(matchSupplierPrices([tagged("s", "EVERY 2", 58)], t1, [], [], scope({ T1: ["every"] }))), { s: "unmatched", "target:t1": "target_not_represented" });
});

test("a saved family missing from the list is not guessed: other families are ignored, the column is reported missing, untagged rows stay candidates", () => {
  const onlyAim = matchSupplierPrices([tagged("aim", "AIM", 57)], t1, [], [], scope({ T1: ["every"] }));
  assert.deepEqual(byKey(onlyAim), { aim: "unmatched", "target:t1": "target_not_represented" });
  const withUntagged = matchSupplierPrices([tagged("aim", "AIM", 57), plain("plain", 58)], t1, [], [], scope({ T1: ["every"] }));
  assert.deepEqual(byKey(withUntagged), { aim: "unmatched", plain: "unchanged" });
});

test("the scope applies only to the products that chose families, and saved bindings stay explicit", () => {
  const two = [target("t1", "T1", 58), target("t2", "T2", 58)];
  const result = matchSupplierPrices([tagged("aim", "AIM", 57)], two, [], [], scope({ T1: ["every"] }));
  assert.deepEqual(result.find((match) => match.key === "aim")?.targets.map((item) => item.key), ["t2"], "T1 ignored the AIM row; only T2 (no saved family) is a candidate");
  assert.equal(result.find((match) => match.key === "aim")?.classification, "needs_dimension_mapping", "T2 chose nothing and still sees it, as today");
  const binding: DurableBinding = { id: "b", code: "521234", price_field: "unit_price", source_dimension: JSON.stringify(["", "series", "AIM"]), target_keys: ["t1"], kind: "alias", confirmed: true };
  assert.equal(matchSupplierPrices([tagged("aim", "AIM", 57)], t1, [], [binding], scope({ T1: ["every"] }))[0].classification, "decreased", "a saved binding is not filtered by the scope");
});

test("the family is read from the dimension by the one helper that knows the format", () => {
  assert.deepEqual(supplierDimensionFamily(JSON.stringify(["SG3", "series", "EVERY", "Silver"])), { family: "EVERY", subfamily: "Silver" });
  assert.deepEqual(supplierDimensionFamily(JSON.stringify(["", "series", "AIM"])), { family: "AIM", subfamily: null });
  for (const other of ["SG3", "", '["broken', JSON.stringify(["x", "finish_set", ["a"]]), JSON.stringify(["x", "series", ""])]) assert.equal(supplierDimensionFamily(other), null);
});

const rpcClient = (result: { data: unknown; error: { code?: string; message: string } | null }) => ({ rpc: async () => result }) as unknown as SupabaseClient;

test("the loader reads the scope for one definition; before the migration it reads as no family; other errors still fail", async () => {
  const rows = [{ definition_id: "d", template_id: "T1", family: "EVERY", family_key: "every" }, { definition_id: "d", template_id: "T1", family: "AIM", family_key: "aim" }];
  assert.deepEqual([...(await supplierFamilyScope(rpcClient({ data: rows, error: null }), "d")).get("T1")!], ["every", "aim"]);
  assert.equal((await supplierFamilyScope(rpcClient({ data: null, error: { code: "PGRST202", message: "not found" } }), "d")).size, 0);
  assert.equal((await supplierFamilyScope(rpcClient({ data: null, error: { code: "42883", message: "no function" } }), "d")).size, 0);
  await assert.rejects(() => supplierFamilyScope(rpcClient({ data: null, error: { code: "42501", message: "denied" } }), "d"), /denied/);
  assert.equal((await supplierFamilyScope(rpcClient({ data: rows, error: null }), null)).size, 0, "a source with no definition has no scope");
});

test("wiring: matching loads the scope only for the matched source's definition; actions use the approver guard; no UI", () => {
  const repository = readFileSync("lib/products/supplier-price-repository.ts", "utf8");
  assert.match(repository, /supplierFamilyScope\(client, source\.definition_id\)/);
  assert.match(repository, /matchSupplierPrices\(identities\.map\(\(identity\) => withoutEvidence\(identity\.data\)\), targets, rules, bindings, familyScope\)/);
  const actions = readFileSync("app/products/price-updates/supplier-sources/actions.ts", "utf8");
  for (const name of ["setSupplierTemplateFamilies", "listSupplierTemplateFamilies", "listSupplierSourceFamilies", "listMissingSupplierTemplateFamilies"]) {
    const body = actions.match(new RegExp(`export async function ${name}[\\s\\S]*?\\n\\}`))?.[0] ?? "";
    assert.match(body, /await approver\(\)/, name);
    assert.doesNotMatch(body, /supplierWrite|\.from\(/, name);
  }
  for (const file of ["components/quotations/product-library-selector.tsx", "components/quotations/supplier-coverage-popup.tsx"]) assert.doesNotMatch(readFileSync(file, "utf8"), /SupplierTemplateFamilies|template_series/, `no UI yet in ${file}`);
});

test("the migration: own table with deny-by-default access, role checks inside, anchor guard, no new classification", () => {
  const sql = readFileSync("supabase/migrations/20261102100000_supplier_template_series.sql", "utf8");
  assert.match(sql, /primary key \(definition_id, template_id, family_key\)/);
  assert.match(sql, /enable row level security;\s*revoke all on public\.supplier_template_series from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /create policy|grant (select|insert|update|delete|all) on public\.supplier_template_series/i);
  assert.equal((sql.match(/current_user_can_review_brand_prices\(\)/g) ?? []).length, 3, "three read functions check the review role");
  assert.match(sql, /elsif p_operation='template_series_set' then\s*if not public\.current_user_can_approve_brand_prices\(\) then raise insufficient_privilege/);
  assert.match(sql, /position\('template_series_set' in definition\)>0\s*or \(length\(definition\)-length\(replace\(definition,anchor,''\)\)\)\/length\(anchor\)<>1/);
  assert.doesNotMatch(sql, /supplier_source_definition_families\s*\(|delete from public\.supplier_source_definition_families|supplier_price_batches|supplier_price_decisions/);
  const matcher = readFileSync("lib/products/supplier-price-matching.ts", "utf8");
  assert.doesNotMatch(matcher.replace(/"ambiguous"/g, ""), /classification: "(?!unchanged|increased|decreased|changed|unmatched|referenced_companion|ambiguous|shared|needs_dimension_mapping|baseline_drift|invalid_source|target_not_represented)/);
});
