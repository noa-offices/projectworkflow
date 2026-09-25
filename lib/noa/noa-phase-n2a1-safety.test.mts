// NOA 2.0A-1: Attention Center - core read model + Product Price + Procurement findings.
// noa-attention-capability.server.ts/noa-orchestrator.ts have "@/..." aliases and/or
// `import "server-only"`, neither resolvable by Node's plain ESM resolver outside the Next.js
// build - these are source-level wiring/safety checks, matching the convention already used
// throughout lib/noa/'s other *-safety.test.mts files. noa-intent-router.ts is alias-free, so its
// routing tests import and exercise the real function instead.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyNoaIntent, classifyNoaRoute } from "./noa-intent-router.js";

function context(overrides: Partial<Parameters<typeof classifyNoaRoute>[1]> = {}) {
  return { pathname: "/dashboard", section: "dashboard" as const, ...overrides };
}

const attentionSource = readFileSync("lib/noa/noa-attention-capability.server.ts", "utf8");
const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const typesSource = readFileSync("lib/noa/noa-types.ts", "utf8");
const projectCapabilitySource = readFileSync("lib/noa/noa-project-capability.server.ts", "utf8");

// 1. Attention is a valid NoaDomain
test("1. Attention is a valid NoaDomain", () => {
  assert.match(typesSource, /export type NoaDomain = .*"Attention".*;/);
});

// 2. attention phrases route deterministically to Attention
test("2. attention phrases route deterministically to Attention", () => {
  for (const message of [
    "what needs my attention",
    "what needs attention today",
    "anything I need to check",
    "what should I look at",
    "show attention items",
    "show what needs attention",
  ]) {
    assert.equal(classifyNoaRoute(message, context()), "Attention", message);
    assert.equal(classifyNoaIntent(message, context()), "Attention", message);
  }
});

// 3. unrelated "check" phrasing does not become Attention
test("3. unrelated check/attention-adjacent phrasing does not become Attention", () => {
  assert.notEqual(classifyNoaRoute("what did i check today", context()), "Attention");
  assert.notEqual(classifyNoaRoute("is this product's price status due", context()), "Attention");
  assert.notEqual(classifyNoaRoute("check the quotation total", context()), "Attention");
  assert.notEqual(classifyNoaRoute("show pending quotations", context()), "Attention");
});

// 4. orchestrator dispatches Attention capability
test("4. orchestrator dispatches Attention capability", () => {
  assert.ok(orchestratorSource.includes('import { fetchNoaAttentionCapability } from "@/lib/noa/noa-attention-capability.server";'));
  assert.ok(orchestratorSource.includes('domain === "Attention"'));
  assert.ok(orchestratorSource.includes("await fetchNoaAttentionCapability(request.message, request.context)"));
});

// 5. base auth occurs before reads
test("5. requireActiveUser() is the base gate, called before any Supabase read", () => {
  const entryStart = attentionSource.indexOf("export async function fetchNoaAttentionCapability");
  const entryBody = attentionSource.slice(entryStart);
  const authIndex = entryBody.indexOf("await requireActiveUser();");
  const firstClientIndex = entryBody.indexOf("await createClient();");
  assert.ok(authIndex > -1 && firstClientIndex > -1);
  assert.ok(authIndex < firstClientIndex);
});

// 6. user-scoped Supabase client only
test("6. only the user-scoped Supabase client is used - no service role/admin client", () => {
  assert.ok(attentionSource.includes('import { createClient } from "@/lib/supabase/server";'));
  assert.ok(!attentionSource.includes("createAdminClient"));
  assert.ok(!/service[-_]?role|SUPABASE_SERVICE_ROLE/i.test(attentionSource));
});

// 7. Product subsection calls requireProductLibraryManager() before product reads
test("7. Product Price subsection calls requireProductLibraryManager() before any product read", () => {
  const guardIndex = attentionSource.indexOf("await requireProductLibraryManager();");
  const readIndex = attentionSource.indexOf("await productPriceFindings(supabase);");
  assert.ok(guardIndex > -1 && readIndex > -1);
  assert.ok(guardIndex < readIndex);
});

// 8. Product uses productTemplatePriceCheckState()
test("8. product price findings are computed via productTemplatePriceCheckState()", () => {
  assert.ok(attentionSource.includes('import {\n  brandPriceBaselineDate,\n  latestBrandPriceListUpdate,\n  productTemplatePriceCheckState,\n} from "@/lib/product-price-check";'));
  assert.ok(attentionSource.includes("productTemplatePriceCheckState({"));
});

// 9. price-state algorithm is NOT duplicated locally
test("9. no local reimplementation of the price-check status algorithm", () => {
  assert.ok(!/function\s+productTemplatePriceCheckState/.test(attentionSource));
  assert.ok(!/dueAt\s*<\s*now|intervalDays\s*\*\s*dayMs/.test(attentionSource));
});

// 10. product scan is bounded
test("10. product template scan is bounded, never a whole-table scan", () => {
  assert.ok(attentionSource.includes("const MAX_PRICE_SCAN = 200;"));
  assert.ok(attentionSource.includes(".limit(MAX_PRICE_SCAN)"));
});

// 11. only needs_check and due create Product findings
test("11. only needs_check and due statuses create Product Price findings", () => {
  assert.ok(attentionSource.includes('if (status.key !== "needs_check" && status.key !== "due") continue;'));
});

// 12. Procurement subsection calls requireProcurementManager() before procurement reads
test("12. Procurement subsection calls requireProcurementManager() before any procurement read", () => {
  const guardIndex = attentionSource.indexOf("await requireProcurementManager();");
  const readIndex = attentionSource.indexOf("await procurementFindings(supabase);");
  assert.ok(guardIndex > -1 && readIndex > -1);
  assert.ok(guardIndex < readIndex);
});

// 13. ERP Project File parsing uses existing helper(s)
test("13. ERP Project File extraction reuses the existing allProjectFiles()/projectFileFromLayoutSettings() path", () => {
  assert.ok(attentionSource.includes('import { allProjectFiles } from "@/lib/noa/noa-project-capability.server";'));
  assert.ok(attentionSource.includes("await allProjectFiles(supabase)"));
  assert.ok(projectCapabilitySource.includes("export async function allProjectFiles("));
  assert.ok(projectCapabilitySource.includes("projectFileFromLayoutSettings(quotation.layout_settings)"));
  assert.ok(projectCapabilitySource.includes("clientApprovalDraftFromLayoutSettings(quotation.layout_settings)?.confirmedOrder"));
});

// 14. standalone `projects` table is never queried in Attention capability
test("14. the standalone projects table is never queried in the Attention capability", () => {
  assert.ok(!attentionSource.includes('.from("projects")'));
});

// 15. Project File scan is bounded
test("15. the underlying Project File scan is bounded (PROJECT_FILE_SCAN_LIMIT), and the active-order set Attention evaluates is separately bounded", () => {
  assert.ok(projectCapabilitySource.includes("const PROJECT_FILE_SCAN_LIMIT = 200;"));
  assert.ok(projectCapabilitySource.includes(".limit(PROJECT_FILE_SCAN_LIMIT)"));
  assert.ok(attentionSource.includes("const MAX_ATTENTION_ORDER_SCAN = 20;"));
  assert.ok(attentionSource.includes(".slice(0, MAX_ATTENTION_ORDER_SCAN)"));
});

// 16. vendor grouping reuses existing helper
test("16. vendor grouping reuses buildEffectiveDocumentGroups(), never a new vendor-alias algorithm", () => {
  assert.ok(attentionSource.includes('import { buildEffectiveDocumentGroups } from "@/lib/quotations/document-grouping";'));
  assert.ok(attentionSource.includes("buildEffectiveDocumentGroups(items)"));
  assert.ok(!/function\s+buildEffectiveDocumentGroups/.test(attentionSource));
});

// 17. procurement progress query is scoped to bounded order numbers
test("17. procurement_vendor_progress is queried scoped to the bounded order-number set only", () => {
  assert.ok(attentionSource.includes('.from("procurement_vendor_progress")'));
  assert.ok(attentionSource.includes('.in("order_no", orderNos)'));
});

// 18. missing progress row creates missing ETA + ETD only for a real vendor group
test("18. a missing/incomplete progress row creates missing-ETA/missing-ETD findings only for real vendor groups", () => {
  assert.ok(attentionSource.includes("for (const group of vendorGroups) {"));
  assert.ok(attentionSource.includes("if (!progress?.eta) {"));
  assert.ok(attentionSource.includes("if (!progress?.etd) {"));
  assert.ok(attentionSource.includes("if (items.length === 0) continue;"));
});

// 19. no RFQ-stalled logic
test("19. no RFQ-stage/stalled-duration logic exists", () => {
  assert.ok(!/active_step|rfq|stalled/i.test(attentionSource));
});

// 20. no stale-quotation logic
test("20. no stale-draft-quotation logic exists", () => {
  assert.ok(!/stale|draft.*quotation|quotation.*draft/i.test(attentionSource));
});

// 21. no source-price-change logic
test("21. no quotation source-price-change logic exists", () => {
  assert.ok(!/sourcePrice|currentSourcePriceFromSnapshot|source_component_data/i.test(attentionSource));
});

// 22. no ClientPayment logic
test("22. no ClientPayment logic exists", () => {
  assert.ok(!/clientPayment|client_payment|installment|payment_overdue/i.test(attentionSource));
});

// 23. no severity/priority/rank field
test("23. the Attention item contract has no severity/priority/rank field", () => {
  assert.ok(!/severity|priority|\brank\b|\bscore\b/i.test(attentionSource));
});

// 24. no service/admin client
test("24. no service-role/admin database client anywhere in the Attention capability", () => {
  assert.ok(!attentionSource.includes("createAdminClient"));
  assert.ok(!/service[-_]?role/i.test(attentionSource));
});

// 25. permission failure in Product does not fail Procurement
test("25. a Product Price permission failure does not throw or fail the whole result - Procurement still proceeds", () => {
  assert.ok(attentionSource.includes("productPriceAvailable = false;"));
  const productCatchIndex = attentionSource.indexOf("productPriceAvailable = false;");
  const procurementGuardIndex = attentionSource.indexOf("await requireProcurementManager();");
  assert.ok(productCatchIndex > -1 && procurementGuardIndex > -1);
  assert.ok(productCatchIndex < procurementGuardIndex);
});

// 26. permission failure in Procurement does not fail Product
test("26. a Procurement permission failure does not throw or fail the whole result", () => {
  assert.ok(attentionSource.includes("procurementAvailable = false;"));
  assert.ok(attentionSource.includes("if (!isNextRedirectError(error)) throw error;\n    procurementAvailable = false;"));
});

// 27. deterministicText exists
test("27. the capability always returns a deterministicText field", () => {
  assert.ok(attentionSource.includes("deterministicText"));
  assert.ok(attentionSource.includes("Nothing currently matches the Attention checks available to you."));
});

// 28. no provider call in Attention capability
test("28. no provider/LLM call inside the Attention capability - deterministicOnly short-circuits it", () => {
  assert.ok(!attentionSource.includes("runNoaProvider"));
  assert.ok(attentionSource.includes("deterministicOnly: true"));
});
