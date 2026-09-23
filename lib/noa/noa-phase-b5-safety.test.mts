import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-procurement-capability.server.ts and noa-orchestrator.ts have "@/..." aliases and/or
// `import "server-only"`, neither resolvable by Node's plain ESM resolver outside the Next.js
// build (`server-only` isn't even physically present in node_modules - Next.js provides it
// specially). These are source-level wiring/safety checks, not runtime execution tests, matching
// the convention already used throughout lib/noa/'s other *-safety.test.mts files.

const procurementSource = readFileSync("lib/noa/noa-procurement-capability.server.ts", "utf8");
const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const typesSource = readFileSync("lib/noa/noa-types.ts", "utf8");
const routerSource = readFileSync("lib/noa/noa-intent-router.ts", "utf8");
const vendorStepsSource = readFileSync("lib/procurement/vendor-steps.ts", "utf8");

const MUTATION_PATTERN = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/;

// 1. Procurement capability calls requireProcurementManager()
test("1. Procurement capability calls requireProcurementManager(), not the weaker requireActiveUser()", () => {
  assert.ok(procurementSource.includes('import { requireProcurementManager } from "@/lib/auth";'));
  assert.ok(procurementSource.includes("await requireProcurementManager();"));
  assert.ok(!procurementSource.includes("requireActiveUser"));
});

// 2. auth occurs before any Supabase query
test("2. auth is checked before any Supabase query runs", () => {
  const authIndex = procurementSource.indexOf("await requireProcurementManager();");
  const firstQueryIndex = procurementSource.indexOf("await createClient();");
  assert.ok(authIndex >= 0 && firstQueryIndex >= 0 && authIndex < firstQueryIndex);
});

// 3. user-scoped client only
test("3. only the user-scoped Supabase client is used", () => {
  assert.ok(procurementSource.includes('import { createClient } from "@/lib/supabase/server";'));
});

// 4. no createAdminClient / service-role
test("4. no createAdminClient or service-role access", () => {
  assert.ok(!procurementSource.includes("createAdminClient"));
  assert.ok(!/service[-_]?role|SUPABASE_SERVICE_ROLE/i.test(procurementSource));
});

// 5. no writes
test("5. no mutation method calls", () => {
  assert.ok(!MUTATION_PATTERN.test(procurementSource));
});

// 6. order list bounded
test("6. Procurement order list is hard-capped", () => {
  assert.match(procurementSource, /const MAX_PROCUREMENT_ORDER_ROWS = 20;/);
  assert.ok(procurementSource.includes(".slice(0, MAX_PROCUREMENT_ORDER_ROWS)"));
});

// 7. vendors-per-order and docs-per-vendor bounded
test("7. vendors-per-order and documents-per-vendor are hard-capped", () => {
  assert.match(procurementSource, /const MAX_PROCUREMENT_VENDOR_ROWS = 20;/);
  assert.match(procurementSource, /const MAX_PROCUREMENT_DOCS_PER_VENDOR = 10;/);
  assert.ok(procurementSource.includes(".slice(0, MAX_PROCUREMENT_VENDOR_ROWS)"));
  assert.ok(procurementSource.includes(".slice(0, MAX_PROCUREMENT_DOCS_PER_VENDOR)"));
});

// 8. deterministicText exists
test("8. every Procurement result path emits deterministicText", () => {
  const count = (procurementSource.match(/deterministicText:/g) ?? []).length;
  assert.ok(count >= 2, "expected deterministicText in both the list/count and detail result branches");
});

// 9. order active/completed derived from layout_settings, never active_step
test("9. order active/completed state comes from layout_settings (projectCompletedAt/projectCancelledAt), never procurement_vendor_progress.active_step", () => {
  assert.ok(procurementSource.includes("projectCompletedAt"));
  assert.ok(procurementSource.includes("projectCancelledAt"));
  // The only place active_step is read is to derive a step LABEL, never an order status.
  const activeStepUses = (procurementSource.match(/active_step/g) ?? []).length;
  assert.ok(activeStepUses >= 1);
  assert.ok(!/completedAt\s*=.*active_step/.test(procurementSource));
});

// 10. sensitive fields never selected/exposed
test("10. storage_path, public_url/signed URLs, internal row ids, and vendor_key are never exposed in payload data", () => {
  assert.ok(!procurementSource.includes("storage_path"));
  assert.ok(!procurementSource.includes("public_url"));
  assert.ok(!/vendorKey:/.test(procurementSource));
  assert.ok(!/\bvendor\.id\b|docId|\bdoc\.id\b/.test(procurementSource));
});

// 11. vendor_key used only as an internal grouping/lookup key, never surfaced as vendorLabel
test("11. vendor_key is used only for internal grouping/lookup, and the human-facing field is displayLabel/vendorLabel", () => {
  assert.ok(procurementSource.includes("group.displayLabel"));
  assert.ok(procurementSource.includes("group.dedupeKey"));
});

// 12. step label reused from the shared server-safe constant, not reimplemented
test("12. step labels are sourced from lib/procurement/vendor-steps.ts, not reimplemented inline", () => {
  assert.ok(procurementSource.includes('import { vendorDocSlotLabel, vendorStepLabel } from "@/lib/procurement/vendor-steps";'));
  assert.ok(!/const\s+VENDOR_STEPS\s*=/.test(procurementSource));
});

// 13. vendor-steps.ts is a pure, client-independent mirror
test("13. vendor-steps.ts does not import the 'use client' vendor-controls-panel component", () => {
  assert.ok(!vendorStepsSource.includes("vendor-controls-panel"));
  assert.ok(!vendorStepsSource.includes('"use client"'));
  assert.match(vendorStepsSource, /delivered_installed/);
});

// 14. orchestrator dispatches Procurement
test("14. orchestrator dispatches to fetchNoaProcurementCapability for the Procurement domain", () => {
  assert.ok(orchestratorSource.includes('import { fetchNoaProcurementCapability } from "@/lib/noa/noa-procurement-capability.server";'));
  assert.match(orchestratorSource, /domain === "Procurement"\s*\n\s*\? await fetchNoaProcurementCapability\(request\.message, request\.context\)/);
});

// 15. unauthorized result prevents provider call
test("15. an unauthorized result returns before runNoaProvider is ever reached", () => {
  const capabilityResultIndex = orchestratorSource.indexOf("const capabilityResult");
  const notOkIndex = orchestratorSource.indexOf("if (!capabilityResult.ok)");
  const providerCallIndex = orchestratorSource.indexOf("runNoaProvider(");
  assert.ok(capabilityResultIndex >= 0 && notOkIndex >= 0 && providerCallIndex >= 0);
  assert.ok(capabilityResultIndex < notOkIndex && notOkIndex < providerCallIndex);
});

// 16. no cross-capability chaining
test("16. no cross-capability chaining: Procurement capability never imports another NOA capability", () => {
  assert.ok(!procurementSource.includes("noa-product-capability"));
  assert.ok(!procurementSource.includes("noa-quotation-capability"));
  assert.ok(!procurementSource.includes("noa-price-capability"));
  assert.ok(!procurementSource.includes("noa-project-capability"));
  assert.ok(!procurementSource.includes("noa-client-capability"));
});

// 17. Procurement is a real NoaDomain, "unsupported_procurement" fully retired
test("17. Procurement is a real NoaDomain and the unsupported_procurement route is fully retired", () => {
  assert.match(typesSource, /export type NoaDomain = "Product" \| "Quotation" \| "Price" \| "Project" \| "Client" \| "Procurement" \| "Help";/);
  assert.ok(!typesSource.includes("unsupported_procurement"));
  assert.ok(!routerSource.includes("unsupported_procurement"));
  assert.ok(!orchestratorSource.includes("unsupported_procurement"));
});

// 18. never selects('*')
test("18. Procurement capability never uses select('*') and uses fixed column lists", () => {
  assert.ok(!procurementSource.includes('.select("*")'));
});
