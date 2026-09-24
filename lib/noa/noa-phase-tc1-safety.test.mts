import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const semantic = readFileSync("lib/noa/noa-semantic-request.ts", "utf8");
const extractor = readFileSync("lib/noa/noa-intent-extractor.server.ts", "utf8");
const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const quotation = readFileSync("lib/noa/noa-quotation-capability.server.ts", "utf8");

test("TC-1 defines only bounded Quotation identifier and request arguments", () => {
  assert.ok(semantic.includes('quotationNo: string;'));
  assert.ok(semantic.includes('request: "detail" | "total" | "status";'));
  assert.ok(semantic.includes("isNoaSemanticQuotationShape"));
  assert.ok(!/grandTotal|currency|requestedStatus/.test(semantic));
});

test("TC-1 extractor schema and prompt support direct QN quotation requests without business data", () => {
  assert.ok(extractor.includes("QN-... identifiers are quotation numbers."));
  assert.ok(extractor.includes('quotationNo: { type: "string", maxLength: 80 }'));
  assert.ok(extractor.includes('enum: ["detail", "total", "status"]'));
  assert.ok(!extractor.includes("recentMessages"));
  assert.ok(!extractor.includes("capabilityData"));
});

test("TC-1 dispatches validated Quotation arguments without rewriting the raw question", () => {
  assert.ok(orchestrator.includes("...(extracted.quotation ? { quotation: extracted.quotation } : {})"));
  assert.ok(orchestrator.includes("fetchNoaQuotationCapability(request.message, request.context, {"));
  assert.ok(orchestrator.includes("quotation: deterministicQuotation ?? (semanticRequest?.domain === \"Quotation\" ? semanticRequest.quotation : undefined)"));
  assert.ok(!orchestrator.includes("quotation structured"));
});

test("TC-1B fast-path accepts exactly one QN ERP identifier and maps the requested field", () => {
  assert.ok(quotation.includes("const quotationNo = extractQuotationIdentifier(message);"));
  assert.ok(quotation.includes("/^QN-\\d{3,}(?:-\\d+)*$/i"));
  assert.ok(quotation.includes("if (quotationIdentifierCount(message) !== 1) return undefined;"));
  assert.ok(quotation.includes('/\\b(worth|value|total)\\b/.test(normalized)'));
  assert.ok(quotation.includes('/\\bstatus\\b/.test(normalized)'));
  assert.ok(orchestrator.includes('const deterministicQuotation = quotationStructuredRequest(request.message);'));
  assert.ok(orchestrator.includes('const quotationIdentifierTotal = quotationIdentifierCount(request.message);'));
  assert.ok(orchestrator.includes('quotationIdentifierTotal > 0\n      ? "Quotation"'));
});

test("TC-1B routes multiple QNs to Quotation without single-quotation arguments", () => {
  assert.ok(quotation.includes('return [...message.matchAll(/\\bQN-\\d{3,}(?:-\\d+)*\\b/gi)].length;'));
  assert.ok(orchestrator.includes('quotation: deterministicQuotation ?? (semanticRequest?.domain === "Quotation" ? semanticRequest.quotation : undefined)'));
  assert.ok(quotation.includes("const broadAnswer = await buildBroadQuotationAnswer(supabase, message, context);"));
  assert.ok(quotation.includes('if (/\\b(compare|difference between)\\b/.test(normalized))'));
  assert.ok(quotation.includes('.in("quotation_no", identifiers)'));
  assert.ok(quotation.includes('{ aliases: /\\b(?:draft|pending)\\b/, displayLabel: "Pending"'));
  assert.ok(quotation.includes("return buildQuotationStatusAnswer(supabase, message, questionKind);"));
});

test("TC-1 structured execution uses the existing quotation lookup and authorization", () => {
  assert.ok(quotation.includes("await requireQuotationActionUser();"));
  assert.ok(quotation.includes("if (options.quotation)"));
  assert.ok(quotation.includes("quotationForIdentifier(supabase, options.quotation.quotationNo)"));
  assert.ok(quotation.includes("buildQuotationAnswer(supabase, quotation, options.quotation.request)"));
  assert.ok(quotation.includes("const identifier = extractQuotationIdentifier(message);"));
  assert.ok(quotation.includes("requestedField"));
});

test("TC-1 preserves one extraction call and the existing raw-message fallback", () => {
  assert.equal((orchestrator.match(/extractNoaSemanticRequest\(/g) ?? []).length, 1);
  assert.equal((orchestrator.match(/\[NOA TRACE\]/g) ?? []).length, 0);
  assert.equal((extractor.match(/\[NOA TRACE\]/g) ?? []).length, 0);
  assert.ok(quotation.includes("const broadAnswer = await buildBroadQuotationAnswer(supabase, message, context);"));
  assert.ok(quotation.includes("quotationQuestionKind(message)"));
});
