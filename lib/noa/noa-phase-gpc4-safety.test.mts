// GPC-4: post-completion summary/specification/price. `lib/noa/noa-orchestrator.ts` is a
// "server-only" module (Supabase/auth-backed capabilities) so - matching the existing
// noa-phase-gpc33-safety.test.mts convention for this exact file - these are deterministic
// source-inspection tests, not a runtime import/exercise of the orchestrator.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");

// Slice out one named function's body (from its `function name(` to the next top-level
// `function `/`async function ` or `type `) so assertions can be scoped to just that function,
// never accidentally matched against unrelated code elsewhere in the file.
function functionBody(name: string): string {
  const start = orchestrator.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `function ${name} not found`);
  const rest = orchestrator.slice(start);
  const nextMatch = rest.slice(1).search(/\n(async function |function |type )/);
  return nextMatch === -1 ? rest : rest.slice(0, nextMatch + 1);
}

test("1. A completed configuration gets a useful deterministic summary, not the old generic sentence", () => {
  assert.ok(orchestrator.includes("function productConfigurationSummaryAnswer("));
  assert.ok(!orchestrator.includes("are complete. Current source unit price:"));
  assert.ok(orchestrator.includes("if (!nextStep) return productConfigurationSummaryAnswer(template, state, effectiveSelections, reference);"));
});

test("2/3/4. Specification requests are classified and answered from state.specification, never repeating the completion sentence", () => {
  const classifier = functionBody("classifyProductConfigurationPostCompletionIntent");
  assert.ok(classifier.includes('normalized.includes("specification")) return "specification"'));
  const specAnswer = functionBody("productConfigurationSpecificationAnswer");
  assert.ok(specAnswer.includes("state.specification"));
  assert.ok(!specAnswer.includes("runNoaProvider"));
});

test("5. Configuration-summary phrasing (\"show configuration summary\"/\"summary\"/\"what did I configure\") classifies as summary", () => {
  const classifier = functionBody("classifyProductConfigurationPostCompletionIntent");
  assert.ok(classifier.includes('normalized.includes("summary")'));
  assert.ok(classifier.includes('normalized.includes("what did i configure")'));
  assert.ok(classifier.includes("show (?:the )?configur"));
});

test("6/7. Price requests classify as price and the price answer performs no arithmetic of its own", () => {
  const classifier = functionBody("classifyProductConfigurationPostCompletionIntent");
  assert.ok(classifier.includes('/\\bprice\\b/.test(normalized)'));
  assert.ok(classifier.includes('normalized.includes("how much")'));
  const priceAnswer = functionBody("productConfigurationPriceAnswer");
  assert.ok(priceAnswer.includes("state.price.unit"));
  // No arithmetic COMBINING price fields (a prose " - " separator elsewhere in the text is fine).
  assert.ok(!/state\.price\.\w+\s*[+*/]\s*state\.price/.test(priceAnswer));
  assert.ok(!/state\.price\.\w+\s*-\s*state\.price/.test(priceAnswer));
});

test("8. Dimension in the summary comes only from state.dimension, never reconstructed from labels", () => {
  const summarySections = functionBody("productConfigurationSummarySections");
  assert.ok(summarySections.includes('if (state.dimension) fields.push({ label: "Dimension", value: state.dimension });'));
});

test("9/10/11. Required vs. optional selected accessories are bucketed from step.required/step.selectedOptionIds; a skipped optional group is excluded", () => {
  const summarySections = functionBody("productConfigurationSummarySections");
  assert.ok(summarySections.includes("skippedGroupIds.has(step.groupId)) continue;"));
  assert.ok(summarySections.includes("step.selectedOptionIds ?? []"));
  assert.ok(summarySections.includes("(step.required ? requiredAccessoryLines : optionalAccessoryLines).push(line);"));
});

test("12. No internal id/step-key/row-id is ever pushed as a summary VALUE - only resolved option labels", () => {
  const summarySections = functionBody("productConfigurationSummarySections");
  assert.ok(!/push\([^,]+,\s*(step\.key|option\.id|selectedId)\)/.test(summarySections));
  assert.ok(summarySections.includes(".label ?? null") || summarySections.includes(")?.label"));
});

test("13. A null/blank specification returns an honest deterministic message, never an invented one", () => {
  const specAnswer = functionBody("productConfigurationSpecificationAnswer");
  assert.ok(specAnswer.includes("I don't have a configured specification for this selection."));
});

test("14. No provider/LLM call anywhere in the new completion-summary/specification/price path", () => {
  for (const name of [
    "productConfigurationSummarySections",
    "productConfigurationSummaryAnswer",
    "productConfigurationSpecificationAnswer",
    "productConfigurationPriceAnswer",
    "classifyProductConfigurationPostCompletionIntent",
    "productConfigurationCompletionResponse",
  ]) {
    assert.ok(!functionBody(name).includes("runNoaProvider"), `${name} must not call the provider`);
  }
});

test("15/16/17. The incoming reference is always passed straight through (never rebuilt/cleared) by summary, specification, and price answers", () => {
  assert.ok(functionBody("productConfigurationSummaryAnswer").includes("productConfigurationReference: reference"));
  assert.ok(functionBody("productConfigurationSpecificationAnswer").includes("productConfigurationReference: reference"));
  assert.ok(functionBody("productConfigurationPriceAnswer").includes("productConfigurationReference: reference"));
});

test("18/19/20. Fresh other-domain requests still escape BEFORE the post-completion classifier ever runs", () => {
  assert.ok(orchestrator.includes("if (looksLikeFreshOtherDomainRequest(request.message, request.context)) return null;"));
  const turnHandler = functionBody("maybeHandleProductConfigurationTurn");
  const escapeIndex = turnHandler.indexOf("looksLikeFreshOtherDomainRequest");
  const resumeCallIndex = turnHandler.indexOf("resumeProductConfiguration(incomingReference, request.message)");
  assert.ok(escapeIndex >= 0 && resumeCallIndex > escapeIndex, "escape check must run before resumeProductConfiguration is called");
});

test("21. A still-incomplete configuration keeps using the normal guided question flow, untouched by GPC-4", () => {
  assert.ok(orchestrator.includes("const selectionKey = productConfigurationSelectionKey(nextStep.kind);"));
  assert.ok(orchestrator.includes("return productConfigurationQuestionAnswer(nextStep, reference, template.templateName, isFirstQuestion);"));
});

test("10 (regression). The current message - not just reference completeness - decides the post-completion answer", () => {
  assert.ok(orchestrator.includes(
    "return productConfigurationCompletionResponse(message, loaded.template, currentState, reference.selections, reference);",
  ));
  const dispatch = functionBody("productConfigurationCompletionResponse");
  assert.ok(dispatch.includes("classifyProductConfigurationPostCompletionIntent(message)"));
});

test("22. No write action was introduced - GPC-4 stays a read/reevaluate path only", () => {
  assert.ok(!orchestrator.includes(".insert(") && !orchestrator.includes(".update(") && !orchestrator.includes(".delete(") && !orchestrator.includes("supabase"));
});

// ── GPC-4.1: human-friendly final summary + price presentation ─────────────────────────────────

test("GPC-4.1 1/4. The default summary is built from real blank-line-separated blocks, not one joined sentence", () => {
  const summaryAnswer = functionBody("productConfigurationSummaryAnswer");
  assert.ok(summaryAnswer.includes('blocks.join("\\n\\n")'));
  assert.ok(!summaryAnswer.includes('.join(" ")'));
});

test("GPC-4.1 2. Product + brand heading is the first block of the default summary", () => {
  const summaryAnswer = functionBody("productConfigurationSummaryAnswer");
  assert.ok(summaryAnswer.includes('const heading = template.brandName ? `${template.templateName} — ${template.brandName}` : template.templateName;'));
  assert.ok(summaryAnswer.includes("const blocks: string[] = [heading];"));
});

test("GPC-4.1 3. Configured source unit price is its own clearly-headed block, not buried inline", () => {
  const summaryAnswer = functionBody("productConfigurationSummaryAnswer");
  assert.ok(summaryAnswer.includes('["Configured source unit price", `${state.price.currency} ${state.price.unit.toLocaleString()}`]'));
  assert.ok(summaryAnswer.includes("blocks.push(priceBlock.join"));
});

test("GPC-4.1 5/6. A summary-specific request returns the full structured summary; a price-specific request stays short and never repeats the full configuration/specification", () => {
  const dispatch = functionBody("productConfigurationCompletionResponse");
  assert.ok(dispatch.includes('if (intent === "price") return productConfigurationPriceAnswer(template, state, reference);'));
  assert.ok(dispatch.includes("return productConfigurationSummaryAnswer(template, state, selections, reference);"));
  const priceAnswer = functionBody("productConfigurationPriceAnswer");
  assert.ok(!priceAnswer.includes("state.specification"));
  assert.ok(!priceAnswer.includes("productConfigurationSummarySections"));
});

test("GPC-4.1 8. An internal-sounding Category/Matrix group label (e.g. \"Finish Category Pricing\") is never shown as a Category line", () => {
  const detector = functionBody("isInternalWorkflowLabel");
  assert.ok(/\\bpricing\\b/i.test(detector) || detector.includes("pricing"));
  assert.ok(detector.includes("group"));
  const summarySections = functionBody("productConfigurationSummarySections");
  assert.ok(summarySections.includes('if (categoryGroupLabel && !isInternalWorkflowLabel(categoryGroupLabel)) push("Category", categoryGroupLabel);'));
  // The Category/Matrix selected ITEM is still always shown (relabelled "Model", never omitted).
  assert.ok(summarySections.includes('push("Model", selectedOptionLabel(stepByKey.get("category_row"), selections.categoryRowId));'));
});

test("GPC-4.1 9. Required accessory selections are grouped under a single header, never repeated per line as \"Required — X\"", () => {
  const summaryAnswer = functionBody("productConfigurationSummaryAnswer");
  assert.ok(summaryAnswer.includes('if (sections.requiredAccessoryLines.length) configuredLines.push("Required", ...sections.requiredAccessoryLines);'));
  assert.ok(!orchestrator.includes("`Required — ${step.label}`"));
});

test("GPC-4.1 10/11. Optional selected accessories are grouped under their own header; skipped optional groups stay excluded", () => {
  const summaryAnswer = functionBody("productConfigurationSummaryAnswer");
  assert.ok(summaryAnswer.includes('if (sections.optionalAccessoryLines.length) configuredLines.push("Optional", ...sections.optionalAccessoryLines);'));
  const summarySections = functionBody("productConfigurationSummarySections");
  assert.ok(summarySections.includes("skippedGroupIds.has(step.groupId)) continue;"));
});
