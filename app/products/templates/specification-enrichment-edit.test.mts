import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { productTemplateFormSmartWorkspace } from "../../../lib/products/product-template-form-smart-workspace.js";
import { normalizeProductTemplateDraft } from "../../../lib/products/product-template-draft.js";
import { specificationEnrichmentValidationCopy, prepareSavedSpecificationEnrichment } from "../../../lib/products/specification-enrichment-saved-data.js";
import { applyBatchSpecificationSuggestions, batchSpecificationFingerprint, flattenBatchSpecificationTargets } from "../../../lib/products/specification-enrichment-batch.js";
import { mapSmartDraftForApply } from "../../../lib/products/smart-setup-apply-preview.js";
import { persistedProductTemplatePricingRowKeys, staleProductTemplateRowReferences } from "../../../lib/products/product-template-row-references.js";
import { baseModelRowImageScope } from "../../../lib/products/review-paste-rows.js";

mock.module("server-only", { namedExports: {} });
mock.module("@/lib/auth", { namedExports: { requireProductLibraryManager: async () => { authCalls++; } } });
mock.module("@/lib/ai/resolve-agent-runtime-config.server", { namedExports: { resolveAiAgentRuntimeConfig: async () => ({ enabled: configured, apiKeyConfigured: configured, provider: "openai", model: "mock" }) } });
mock.module("@/lib/ai/provider-router.server", { namedExports: { runAiProvider: async (input: { userContent: Array<{ targetId: string }>; systemInstructions: string }) => {
  calls.push(input);
  if (failAt === calls.length) throw new Error("mock failure");
  const results = input.userContent.map((item) => ({ targetId: item.targetId, specificationSuggestion: suggestion, ...(injectResult ? { displayNameSuggestion: "Injected" } : {}) }));
  return { text: JSON.stringify({ results }) };
} } });
const { runBatchSpecificationEnrichment } = await import("./specification-enrichment-actions.js");
let authCalls = 0, configured = true, failAt = 0, injectResult = false;
let suggestion: string | null = "Steel frame.";
let calls: Array<{ userContent: Array<{ targetId: string }>; systemInstructions: string }> = [];
function reset() { calls = []; configured = true; failAt = 0; injectResult = false; suggestion = "Steel frame."; }

function fixture(count = 1) {
  return productTemplateFormSmartWorkspace({
    template_name: "Range", currency: "EUR", desking_size_pricing: "[]", category_pricing: "[]", modular_item_pricing: "[]", accessory_pricing: "[]",
    variant_pricing: JSON.stringify([{ id: "legacy-base-model-main", pricing_type: "base_model_group", group_name: "Base / Model Pricing", is_active: true, sort_order: 0,
      items: Array.from({ length: count }, (_, index) => ({ id: `desk-${index}`, item_name: "Desk", supplier_price_list_code: `D${index}`, dimension: "W100 D60 H70 cm", specification: "Steel frame.", price: 123, currency: "EUR" })) }]),
  });
}

test("validation copy leaves editor identity intact and shared validation remains strict", () => {
  const { draft } = fixture(); const before = structuredClone(draft);
  assert.equal(normalizeProductTemplateDraft(draft).valid, false);
  const normalized = normalizeProductTemplateDraft(specificationEnrichmentValidationCopy(draft));
  assert.equal(normalized.valid, true);
  assert.equal(normalized.draft!.pricing.baseModelRows[0].groupId, undefined);
  assert.deepEqual(draft, before);
  assert.equal(draft.pricing.baseModelRows[0].groupId, "legacy-base-model-main");
});

test("saved mode builds only allowlisted facts and rejects client fragments and invalid modes", async () => {
  reset(); const { draft } = fixture(); const before = structuredClone(draft);
  const response = await runBatchSpecificationEnrichment({ draft, sourceMode: "saved_data", originalImportedJsonSources: [] });
  assert.equal(response.ok, true); assert.equal(calls.length, 1); assert.ok(authCalls > 0);
  const fragment = (calls[0].userContent[0] as unknown as { sourceFragment: Record<string, unknown> }).sourceFragment;
  assert.deepEqual(Object.keys(fragment), ["source", "row", "context"]);
  assert.deepEqual(Object.keys(fragment.row as object), ["name", "supplierCodes", "dimensions", "specification"]);
  assert.match(JSON.stringify(fragment), /saved_data|Steel frame|Base \/ Model Pricing/);
  assert.doesNotMatch(JSON.stringify(fragment), /"price"|"currency"|"confidence"|"warnings"|123/);
  assert.deepEqual(draft, before);
  for (const patch of [{ sourceFragment: { invented: true } }, { fragments: [] }, { sourceMode: "unknown" }, { originalImportedJsonSources: [{ id: "client", rawJson: "{}" }] }]) {
    const result = await runBatchSpecificationEnrichment({ draft, sourceMode: "saved_data", ...patch } as never);
    assert.equal(result.ok, false);
  }
  assert.equal(calls.length, 1, "injection requests never reach provider");
});

test("other invalid fields and missing original JSON still block before provider", async () => {
  reset(); const { draft } = fixture();
  const invalid = structuredClone(draft); invalid.pricing.baseModelRows[0].id = "";
  assert.equal((await runBatchSpecificationEnrichment({ draft: invalid, sourceMode: "saved_data" })).ok, false);
  const valid = normalizeProductTemplateDraft(specificationEnrichmentValidationCopy(draft)).draft!;
  for (const originalImportedJsonSources of [undefined, []]) {
    const result = await runBatchSpecificationEnrichment({ draft: valid, originalImportedJsonSources });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.message, "At least one original imported JSON source is required.");
  }
  const sources = [{ id: "original", rawJson: JSON.stringify({ id: "desk-0", material: "steel" }) }];
  assert.equal((await runBatchSpecificationEnrichment({ draft: valid, originalImportedJsonSources: sources })).ok, true);
  assert.equal(calls.length, 1);
});

test("insufficient saved facts skip the row; null suggestions remain null and result extra fields are rejected", async () => {
  reset(); const { draft } = fixture(); draft.pricing.baseModelRows[0].specification = null;
  const result = await runBatchSpecificationEnrichment({ draft, sourceMode: "saved_data" });
  assert.equal(result.ok, true); assert.equal(result.skippedTargetIds.length, 1); assert.equal(calls.length, 0);
  draft.pricing.baseModelRows[0].specification = "Desk"; suggestion = null;
  const unchanged = await runBatchSpecificationEnrichment({ draft, sourceMode: "saved_data" });
  assert.equal(unchanged.results[0].specificationSuggestion, null);
  injectResult = true;
  assert.equal((await runBatchSpecificationEnrichment({ draft, sourceMode: "saved_data" })).ok, false);
});

test("saved mode retains the 120-target limit, sequential six-row batches, partial results and configuration errors", async () => {
  reset(); const { draft } = fixture(7); failAt = 2;
  const partial = await runBatchSpecificationEnrichment({ draft, sourceMode: "saved_data" });
  assert.equal(partial.ok, false); assert.equal(partial.results.length, 6); assert.equal(partial.skippedTargetIds.length, 1);
  assert.deepEqual(calls.map((call) => call.userContent.length), [6, 1]);
  reset(); configured = false;
  const missing = await runBatchSpecificationEnrichment({ draft, sourceMode: "saved_data" });
  assert.equal(missing.ok, false);
  if (!missing.ok) { assert.equal(missing.code, "not_configured"); assert.equal(missing.message, "Specification enrichment is not configured."); }
  assert.equal(calls.length, 0);
  reset();
  assert.equal((await runBatchSpecificationEnrichment({ draft: fixture(121).draft, sourceMode: "saved_data" })).ok, false);
  assert.equal(calls.length, 0);
});

test("fingerprint includes source mode and saved facts; only specification patches reach the original draft", () => {
  const { draft } = fixture();
  assert.equal(batchSpecificationFingerprint(draft, []), batchSpecificationFingerprint(draft, [], "original_json"));
  assert.notEqual(batchSpecificationFingerprint(draft, [], "saved_data"), batchSpecificationFingerprint(draft, []));
  assert.equal(batchSpecificationFingerprint(draft, [{ id: "additional", rawJson: "{}" }], "saved_data"), batchSpecificationFingerprint(draft, [], "saved_data"));
  const next = applyBatchSpecificationSuggestions(draft, [{ targetId: "baseModel:desk-0", specificationSuggestion: "New wording." }]);
  assert.notEqual(batchSpecificationFingerprint(next, [], "saved_data"), batchSpecificationFingerprint(draft, [], "saved_data"));
  const restored = structuredClone(next); restored.pricing.baseModelRows[0].specification = draft.pricing.baseModelRows[0].specification;
  assert.deepEqual(restored, draft);
  assert.equal(baseModelRowImageScope(next.pricing.baseModelRows[0].groupId), "base_model_group:legacy-base-model-main");
  const targets = flattenBatchSpecificationTargets(normalizeProductTemplateDraft(specificationEnrichmentValidationCopy(draft)).draft!);
  assert.equal(prepareSavedSpecificationEnrichment(targets).eligible.length, 1);
});

// Optional offline proof: data stays outside the repository and assertion failures never dump it.
if (process.env.SMART_SETUP_STUDY_EXPORT) test("real saved export retains all 98 reference identities after a specification-only edit", () => {
  const data = JSON.parse(readFileSync(process.env.SMART_SETUP_STUDY_EXPORT!, "utf8").replace(/^\uFEFF/, ""));
  const snapshot = Object.fromEntries(Object.entries(data.template).map(([key, value]) => [key, typeof value === "string" ? value : value == null ? "" : JSON.stringify(value)]));
  const workspace = productTemplateFormSmartWorkspace(snapshot);
  const draft = workspace.draft;
  const before = structuredClone(draft);
  const next = applyBatchSpecificationSuggestions(draft, [{ targetId: `baseModel:${encodeURIComponent(draft.pricing.baseModelRows[0].id)}`, specificationSuggestion: "Offline study wording." }]);
  const restored = structuredClone(next); restored.pricing.baseModelRows[0].specification = before.pricing.baseModelRows[0].specification;
  assert.ok(isDeepStrictEqual(restored, before), "only specification may change");
  const mapped = mapSmartDraftForApply(next, workspace.plan);
  const keys = persistedProductTemplatePricingRowKeys({ variantPricing: mapped.baseModel.groups.length ? mapped.baseModel.groups : mapped.baseModel.rows, categoryPricing: [...mapped.categoryResult.groups, ...mapped.modularResult.groups], accessoryPricing: mapped.accessoryResult.groups, deskingSizePricing: mapped.workstation.pricing ?? mapped.workstation.rows });
  assert.equal(data.row_references.length, 98);
  assert.equal(staleProductTemplateRowReferences(data.row_references, keys).length, 0);
  for (const [type, count] of [["base_model", 4], ["modular", 72], ["accessory", 22]]) assert.equal(data.row_references.filter((row: { pricing_type: string }) => row.pricing_type === type).length, count);
  assert.ok(isDeepStrictEqual(draft, before), "input remains unchanged");
  assert.ok(isDeepStrictEqual(next.pricing.baseModelRows.map((row) => baseModelRowImageScope(row.groupId)), before.pricing.baseModelRows.map((row) => baseModelRowImageScope(row.groupId))), "picture scopes remain identical");
});
