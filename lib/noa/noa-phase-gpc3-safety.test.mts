import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isNoaProductConfigurationReference } from "./noa-product-configuration-reference.js";

// noa-orchestrator.ts has "server-only" + "@/..." aliases, neither resolvable by Node's plain ESM
// resolver outside the Next.js build. Source-level wiring/safety checks for the orchestrator, same
// convention as every other lib/noa/*-safety.test.mts file. noa-product-configuration-reference.ts
// is pure/alias-free, so its validator is exercised directly (real execution, not source-assertion).

const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const referenceSource = readFileSync("lib/noa/noa-product-configuration-reference.ts", "utf8");
const typesSource = readFileSync("lib/noa/noa-types.ts", "utf8");
const routeSource = readFileSync("app/api/noa/chat/route.ts", "utf8");
const assistantSource = readFileSync("components/noa/noa-assistant.tsx", "utf8");

// ── REFERENCE (tests 1-5): real, executed validator tests ──────────────────────

test("1. a valid empty configuration reference (no selections yet) is accepted", () => {
  assert.equal(isNoaProductConfigurationReference({ templateId: "tmpl-1", mode: "configuring", selections: {} }), true);
});

test("2. a valid populated reference (every GPC-1 selection key) is accepted", () => {
  assert.equal(isNoaProductConfigurationReference({
    templateId: "tmpl-1",
    mode: "configuring",
    selections: {
      variantGroupId: "g1", subgroupId: "sg1", variantRowId: "r1",
      systemRowId: "s1", systemQuantity: 2,
      categoryGroupId: "cg1", categoryRowId: "cr1", fabricCategory: "Cat A",
      workstationGroupId: "wg1", deskingSizeId: "ds1", workstationVariantRowId: "wv1",
      modularQuantities: { m1: 2 },
      accessoryQuantities: { a1: 1 },
      requiredOverrides: { comp1: { quantity: 0, trigger: "[[]]" } },
      quantity: 3,
    },
  }), true);
});

test("3. unknown fields are rejected - at the top level and inside selections", () => {
  assert.equal(isNoaProductConfigurationReference({ templateId: "tmpl-1", mode: "configuring", selections: {}, extra: "x" }), false);
  assert.equal(isNoaProductConfigurationReference({ templateId: "tmpl-1", mode: "configuring", selections: { notARealKey: "x" } }), false);
});

test("4. malformed quantities are rejected - negative, non-integer, zero where positive is required", () => {
  assert.equal(isNoaProductConfigurationReference({ templateId: "t", mode: "configuring", selections: { systemQuantity: -1 } }), false);
  assert.equal(isNoaProductConfigurationReference({ templateId: "t", mode: "configuring", selections: { systemQuantity: 1.5 } }), false);
  assert.equal(isNoaProductConfigurationReference({ templateId: "t", mode: "configuring", selections: { modularQuantities: { m1: 0 } } }), false);
  assert.equal(isNoaProductConfigurationReference({ templateId: "t", mode: "configuring", selections: { quantity: 1000 } }), false);
  // requiredOverrides quantity of 0 IS valid (untick semantics) - only the maps above require > 0.
  assert.equal(isNoaProductConfigurationReference({ templateId: "t", mode: "configuring", selections: { requiredOverrides: { c1: { quantity: 0, trigger: "x" } } } }), true);
});

test("5. quantity/id maps are bounded in entry count - never silently unlimited", () => {
  const over = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`m${i}`, 1]));
  const atCap = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`m${i}`, 1]));
  assert.equal(isNoaProductConfigurationReference({ templateId: "t", mode: "configuring", selections: { modularQuantities: over } }), false);
  assert.equal(isNoaProductConfigurationReference({ templateId: "t", mode: "configuring", selections: { modularQuantities: atCap } }), true);
});

test("templateId itself is bounded and non-empty", () => {
  assert.equal(isNoaProductConfigurationReference({ templateId: "", mode: "configuring", selections: {} }), false);
  assert.equal(isNoaProductConfigurationReference({ templateId: "x".repeat(101), mode: "configuring", selections: {} }), false);
  assert.equal(isNoaProductConfigurationReference({ mode: "configuring", selections: {} }), false);
  assert.equal(isNoaProductConfigurationReference({ templateId: "t", selections: {} }), false);
  assert.equal(isNoaProductConfigurationReference(null), false);
  assert.equal(isNoaProductConfigurationReference("not an object"), false);
});

// ── START (tests 6-8) ────────────────────────────────────────────────────────────

test("6. 'configure X' reuses the EXISTING fetchNoaProductCapability search - no second search implementation", () => {
  const fnStart = orchestratorSource.indexOf("async function startProductConfiguration");
  const fnEnd = orchestratorSource.indexOf("\n// PART 6/10/17:", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("await fetchNoaProductCapability(searchText, context)"));
  assert.ok(fnBody.includes("await loadProductConfigurationTemplate(templateId)"));
});

test("6b. the start pattern matches the minimum required phrasing", () => {
  assert.match("configure MONOLITH", /^(?:help me )?configure\s+(.+?)[.!]?$/i);
  assert.match("help me configure MONOLITH", /^(?:help me )?configure\s+(.+?)[.!]?$/i);
  assert.equal(orchestratorSource.includes("const PRODUCT_CONFIGURATION_START_PATTERN = /^(?:help me )?configure\\s+(.+?)[.!]?$/i;"), true);
});

test("7. auto-resolved effective selections are folded from GPC-1's own autoApplied output into the returned reference - never a second auto-selection algorithm", () => {
  const fnStart = orchestratorSource.indexOf("function applyAutoResolvedSelections");
  const fnEnd = orchestratorSource.indexOf("\ntype ProductConfigurationAnswerMatch", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("for (const entry of autoApplied)"));
  assert.ok(fnBody.includes("productConfigurationSelectionKey(entry.stepKey)"));
  assert.ok(orchestratorSource.includes("applyAutoResolvedSelections(selections, state.autoApplied)"));
});

test("8. exactly one question is returned for the first unresolved required step, bounded to 10 options", () => {
  // GPC-3.1 extracted the bounding into a shared productConfigurationChoicesFor() (reused for both
  // the full step and a narrowed ambiguous-candidate list) - that phase's own safety test covers
  // it directly; the literal here now reads `options.slice(...)` on that function's own generic
  // parameter rather than `step.options.slice(...)` inline.
  assert.ok(orchestratorSource.includes("const MAX_DISPLAYED_CONFIGURATION_OPTIONS = 10;"));
  assert.ok(orchestratorSource.includes("options.slice(0, MAX_DISPLAYED_CONFIGURATION_OPTIONS)"));
  assert.ok(orchestratorSource.includes("const nextStep = state.nextRequiredStep ?? state.optionalSteps[0] ?? null;"));
});

// ── RESUME (tests 9-15) ─────────────────────────────────────────────────────────

test("9-11. matching prefers exact label, then exact dimension, then a UNIQUE partial label", () => {
  const fnStart = orchestratorSource.indexOf("function matchProductConfigurationAnswer");
  // GPC-3.1 narrowed end-anchor (see test 12's comment) - was previously "\n// PART 9:", which
  // still existed later in the file by coincidence and swept in unrelated new code without
  // actually breaking this test's own assertions.
  const fnEnd = orchestratorSource.indexOf("\nfunction configurationChoiceLabel", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  const exactLabelIndex = fnBody.indexOf("exactLabel");
  const exactDimensionIndex = fnBody.indexOf("exactDimension");
  const partialIndex = fnBody.indexOf("partialMatches");
  assert.ok(exactLabelIndex >= 0 && exactDimensionIndex > exactLabelIndex && partialIndex > exactDimensionIndex);
  assert.ok(fnBody.includes("if (partialMatches.length === 1) return { kind: \"matched\", optionId: partialMatches[0].id };"));
});

test("12. more than one partial match returns 'ambiguous', never a guessed selection", () => {
  // GPC-3.1 widened the ambiguous result to also carry its own `candidates` (so the caller can
  // re-offer just those instead of every current option) - that phase's own safety test covers
  // the addition; this older check only needs to confirm ambiguity is still detected, not the
  // exact literal shape.
  const fnStart = orchestratorSource.indexOf("function matchProductConfigurationAnswer");
  const fnEnd = orchestratorSource.indexOf("\nfunction configurationChoiceLabel", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('if (partialMatches.length > 1) return { kind: "ambiguous"'));
});

test("13. an unmatched answer re-offers the SAME current step's CURRENT valid options, never corrupting state", () => {
  const fnStart = orchestratorSource.indexOf("async function resumeProductConfiguration");
  const fnBody = orchestratorSource.slice(fnStart, orchestratorSource.indexOf("\n// The single entry point", fnStart));
  assert.ok(fnBody.includes('if (match.kind === "none")'));
  assert.ok(fnBody.includes("nextStep,\n      reference,"));
  // The reference passed back on a no-match/ambiguous answer is the SAME incoming reference -
  // selections are never mutated before a match is confirmed.
  assert.ok(!fnBody.slice(0, fnBody.indexOf('if (match.kind === "none")')).includes("nextSelections"));
});

test("14. every resume turn re-fetches the template through GPC-2 - never trusts a prior turn's data", () => {
  const fnStart = orchestratorSource.indexOf("async function resumeProductConfiguration");
  const fnEnd = orchestratorSource.indexOf("\n// The single entry point", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("await loadProductConfigurationTemplate(reference.templateId)"));
});

test("15. stale selections are GPC-1's own report - resumeProductConfiguration passes reference.selections straight through, never filtering/guessing first", () => {
  const fnStart = orchestratorSource.indexOf("async function resumeProductConfiguration");
  const fnEnd = orchestratorSource.indexOf("\n// The single entry point", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("resolveProductConfigurationState(loaded.template, reference.selections)"));
});

// ── COMPLETION (test 16) ─────────────────────────────────────────────────────────

test("16. no required step remaining returns a deterministic completion marker and RETAINS the reference", () => {
  const fnStart = orchestratorSource.indexOf("function productConfigurationCompletionAnswer");
  const fnEnd = orchestratorSource.indexOf("\n// PART 17:", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("productConfigurationReference: reference,"));
  assert.ok(fnBody.includes("are complete."));
  // Only price.unit/currency/dimension/templateName - never a second, richer summary built here.
  assert.ok(fnBody.includes("state.price.currency") && fnBody.includes("state.price.unit") && fnBody.includes("state.dimension"));
});

// ── CONTROL (tests 17-21) ───────────────────────────────────────────────────────

test("17. 'cancel configuration'/'stop configuring' clears the reference (no productConfigurationReference on the answer)", () => {
  const start = orchestratorSource.indexOf("PRODUCT_CONFIGURATION_CANCEL_PATTERN.test");
  const snippet = orchestratorSource.slice(start, start + 200);
  assert.ok(snippet.includes('text: "Product configuration cancelled."'));
  assert.ok(!snippet.includes("productConfigurationReference"));
});

test("18. 'start over' preserves templateId but resets selections to {}", () => {
  const start = orchestratorSource.indexOf("PRODUCT_CONFIGURATION_START_OVER_PATTERN.test");
  const snippet = orchestratorSource.slice(start, start + 200);
  assert.ok(snippet.includes("startProductConfiguration(null, request.context, incomingReference.templateId)"));
});

test("19-20. an obvious fresh Quotation/Project request is never consumed by configuration resume - it falls through to normal routing", () => {
  const fnStart = orchestratorSource.indexOf("function looksLikeFreshOtherDomainRequest");
  const fnEnd = orchestratorSource.indexOf("\n// PART 12:", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("quotationIdentifierCount(message) > 0 || projectFileIdentifierCount(message) > 0"));
  assert.ok(fnBody.includes("classifyNoaRoute(message, context)"));
  assert.ok(orchestratorSource.includes("if (looksLikeFreshOtherDomainRequest(request.message, request.context)) return null;"));
});

test("21. an explicit 'configure OTHER_PRODUCT' always starts fresh, checked BEFORE any existing reference, and replaces it", () => {
  const fnStart = orchestratorSource.indexOf("async function maybeHandleProductConfigurationTurn");
  const startCheckIndex = orchestratorSource.indexOf("const startTarget = productConfigurationStartTarget(request.message);", fnStart);
  const referenceCheckIndex = orchestratorSource.indexOf("const incomingReference = isNoaProductConfigurationReference", fnStart);
  assert.ok(startCheckIndex >= 0 && referenceCheckIndex > startCheckIndex);
  assert.ok(orchestratorSource.includes("return startProductConfiguration(startTarget, request.context);"));
});

// ── SECURITY (tests 22-25) ──────────────────────────────────────────────────────

test("22. auth occurs via GPC-2's loadProductConfigurationTemplate on every start/resume/start-over call - orchestrator never calls requireProductLibraryManager directly for configuration", () => {
  const configBlockStart = orchestratorSource.indexOf("// PART 5: narrow start phrasing only");
  const configBlockEnd = orchestratorSource.indexOf("// The one and only dispatch point:");
  const configBlock = orchestratorSource.slice(configBlockStart, configBlockEnd);
  assert.ok(!configBlock.includes("requireProductLibraryManager"));
  const loadCallCount = (configBlock.match(/loadProductConfigurationTemplate\(/g) ?? []).length;
  assert.equal(loadCallCount, 2, "startProductConfiguration + resumeProductConfiguration, exactly");
});

test("23. no admin/service-role client is referenced anywhere in the configuration block", () => {
  const configBlockStart = orchestratorSource.indexOf("// PART 5: narrow start phrasing only");
  const configBlockEnd = orchestratorSource.indexOf("// The one and only dispatch point:");
  const configBlock = orchestratorSource.slice(configBlockStart, configBlockEnd);
  assert.ok(!/createAdminClient|service_role|SUPABASE_SERVICE_ROLE/i.test(configBlock));
});

test("24. no price/spec/total/currency/validity field exists in the reference's own selection-field allow-list - business facts are re-derived, never stored", () => {
  // Scoped to the exhaustive field allow-list itself (not the whole file, which legitimately
  // contains words like "validate"/"isValidSelections" as identifiers in a validator module).
  const listStart = referenceSource.indexOf("const SELECTION_FIELD_VALIDATORS");
  const listEnd = referenceSource.indexOf("];", listStart);
  const fieldList = referenceSource.slice(listStart, listEnd);
  assert.ok(!/["'](price|total|specification|dimension|currency|status|valid)["']/i.test(fieldList));
});

test("25. the configuration flow never trusts a business fact FROM the request - only reference.templateId (a lookup key) and reference.selections (identifiers) are ever read from it", () => {
  const fnStart = orchestratorSource.indexOf("async function resumeProductConfiguration");
  const fnEnd = orchestratorSource.indexOf("\n// The single entry point", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(!/reference\.templateId\s*[+\-]|reference\.selections\s*\.\s*(price|total)/i.test(fnBody));
});

// ── REGRESSION (tests 26-28) ────────────────────────────────────────────────────

test("26. existing conversationReference validation/handling inside the core pipeline is untouched", () => {
  assert.ok(orchestratorSource.includes("const conversationReference = isNoaConversationReference(request.conversationReference)"));
  assert.ok(orchestratorSource.includes("async function runNoaOrchestratorCore(request: NoaChatRequest): Promise<NoaAnswer> {"));
});

test("27. ordinary Product Q&A dispatch (fetchNoaProductCapability inside the core pipeline) is untouched", () => {
  assert.ok(orchestratorSource.includes('domain === "Product"\n    ? await fetchNoaProductCapability(productMessageOverride ?? request.message, request.context'));
});

test("28. Price Q&A dispatch (fetchNoaPriceCapability inside the core pipeline) is untouched", () => {
  assert.ok(orchestratorSource.includes("await fetchNoaPriceCapability(productMessageOverride ?? request.message, request.context, semanticRequest?.domain === \"Price\" ? { product: semanticRequest.product } : undefined)"));
});

// ── Transport wiring (types/route/client) ───────────────────────────────────────

test("transport: NoaChatRequest/NoaAnswer both carry an optional productConfigurationReference, separate from conversationReference", () => {
  assert.ok(typesSource.includes("productConfigurationReference?: NoaProductConfigurationReference;"));
  assert.ok(typesSource.includes("conversationReference?: NoaConversationReference;"));
});

test("transport: the API route independently validates productConfigurationReference before constructing the chat request", () => {
  assert.ok(routeSource.includes("isNoaProductConfigurationReference(rawProductConfigurationReference)"));
  assert.ok(routeSource.includes("productConfigurationReference,"));
});

test("transport: the client holds productConfigurationReference in its own ref, replacing wholesale from the server response, never rendered to the user", () => {
  assert.ok(assistantSource.includes("const productConfigurationReferenceRef = useRef<NoaProductConfigurationReference | undefined>(undefined);"));
  assert.ok(assistantSource.includes("productConfigurationReferenceRef.current = answer.productConfigurationReference;"));
  assert.ok(!assistantSource.includes("productConfigurationReference.selections"));
});

test("no server-side persistence of configuration state - the loader/orchestrator never write to any table", () => {
  const mutationPattern = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/;
  const configBlockStart = orchestratorSource.indexOf("// PART 5: narrow start phrasing only");
  const configBlockEnd = orchestratorSource.indexOf("// The one and only dispatch point:");
  assert.ok(!mutationPattern.test(orchestratorSource.slice(configBlockStart, configBlockEnd)));
});
