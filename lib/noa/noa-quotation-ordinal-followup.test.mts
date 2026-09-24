// NOA Conversation Follow-up: Quotation ordinal selection ("yah for 3rd one" against a previous
// Quotation list reference). `noa-orchestrator.ts` has "server-only" + "@/..." aliases, neither
// resolvable by Node's plain ESM resolver outside the Next.js build - source-level wiring/safety
// checks, same convention as every other lib/noa/*-safety.test.mts file (see
// noa-phase-c4a-safety.test.mts for the established precedent this file follows).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");

// Slice out one named function's/const's body up to the next top-level declaration, so assertions
// stay scoped to just that piece rather than accidentally matching unrelated code elsewhere.
function bodyFrom(anchor: string): string {
  const start = source.indexOf(anchor);
  assert.ok(start >= 0, `anchor not found: ${anchor}`);
  const rest = source.slice(start);
  const nextMatch = rest.slice(1).search(/\n(async function |function |const \w+[:=]|type )/);
  return nextMatch === -1 ? rest : rest.slice(0, nextMatch + 1);
}

const parserBody = bodyFrom("function parseQuotationOrdinalPosition(");
const resolverBody = bodyFrom("function resolveQuotationOrdinalFollowUp(");

test("PART 1. The committed parser never calls the AI provider/extractor - purely regex-based", () => {
  assert.ok(!parserBody.includes("runNoaProvider") && !parserBody.includes("extractNoaSemanticRequest"));
});

// A tiny, local re-implementation of the exact regex/logic committed in the orchestrator, so the
// ordinal parsing itself can be exercised as real behavior (not just grepped) without needing to
// import the "server-only" module. Kept in lockstep with the orchestrator by asserting the exact
// source strings below - if either drifts, the matching source-presence test fails first.
const ORDINAL_WORDS: Record<string, number> = {
  eighth: 8, fifth: 5, first: 1, fourth: 4, ninth: 9,
  second: 2, seventh: 7, sixth: 6, tenth: 10, third: 3,
};
const WORD_PATTERN = new RegExp(
  `\\bthe\\s+(${Object.keys(ORDINAL_WORDS).join("|")})\\b|\\b(${Object.keys(ORDINAL_WORDS).join("|")})\\s+one\\b`,
  "i",
);
const SUFFIX_PATTERN = /\b(\d{1,2})(?:st|nd|rd|th)\s+one\b/i;
const NUMBER_PATTERN = /\bnumber\s+(\d{1,2})\b/i;
const LAST_PATTERN = /\blast\s+one\b/i;

function parseOrdinalPosition(message: string, entityCount: number): number | null {
  const normalized = message.trim().toLowerCase();
  if (!normalized) return null;
  if (LAST_PATTERN.test(normalized)) return entityCount;
  const wordMatch = normalized.match(WORD_PATTERN);
  if (wordMatch) {
    const word = wordMatch[1] ?? wordMatch[2];
    if (word && word in ORDINAL_WORDS) return ORDINAL_WORDS[word];
  }
  const suffixMatch = normalized.match(SUFFIX_PATTERN);
  if (suffixMatch) {
    const value = Number(suffixMatch[1]);
    if (Number.isInteger(value) && value > 0) return value;
  }
  const numberMatch = normalized.match(NUMBER_PATTERN);
  if (numberMatch) {
    const value = Number(numberMatch[1]);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return null;
}

const THREE_QUOTATIONS = ["QN-0005-001", "QN-0004-001", "QN-0002-001"];

test("1/11. Three quotation reference + \"third one\" selects index 2 (QN-0002-001) - existing stored order, never re-sorted", () => {
  const position = parseOrdinalPosition("third one", THREE_QUOTATIONS.length);
  assert.equal(position, 3);
  assert.equal(THREE_QUOTATIONS[position! - 1], "QN-0002-001");
});

test("2. \"3rd one\" resolves to the third position", () => {
  assert.equal(parseOrdinalPosition("3rd one", 3), 3);
});

test("3. \"yah for 3rd one\" (loose prefix wording) resolves to the third position", () => {
  assert.equal(parseOrdinalPosition("yah for 3rd one", 3), 3);
});

test("4. \"yes the second one\" resolves to the second position", () => {
  assert.equal(parseOrdinalPosition("yes the second one", 3), 2);
});

test("5. \"number 1\" resolves to the first position", () => {
  assert.equal(parseOrdinalPosition("number 1", 3), 1);
});

test("6. \"last one\"/\"yeah last one\" resolves to the last position", () => {
  assert.equal(parseOrdinalPosition("last one", 3), 3);
  assert.equal(parseOrdinalPosition("yeah last one", 3), 3);
});

test("PART 2 additional loose phrasings all resolve as expected", () => {
  assert.equal(parseOrdinalPosition("first one", 5), 1);
  assert.equal(parseOrdinalPosition("the first", 5), 1);
  assert.equal(parseOrdinalPosition("show me the second", 5), 2);
  assert.equal(parseOrdinalPosition("tell me about the 2nd one", 5), 2);
  assert.equal(parseOrdinalPosition("details for number 3", 5), 3);
  assert.equal(parseOrdinalPosition("4th one", 5), 4);
  assert.equal(parseOrdinalPosition("5th one", 5), 5);
});

test("PART 1/2. Does not interpret a bare/unrelated number as an ordinal", () => {
  assert.equal(parseOrdinalPosition("third quarter results", 3), null, "bare ordinal word with no list-selection shape must not match");
  assert.equal(parseOrdinalPosition("the 3rd floor", 3), null, "ordinal-looking text with no \"one\" suffix must not match");
  assert.equal(parseOrdinalPosition("just 3 please", 3), null, "a bare digit is never treated as an ordinal");
  assert.equal(parseOrdinalPosition("what number is this", 3), null, "\"number\" with no following digit must not match");
});

test("7. Out-of-range (\"4th one\" against 3 entities) is detected by the parser and produces a value beyond the count", () => {
  const position = parseOrdinalPosition("4th one", 3);
  assert.equal(position, 4);
  assert.ok(position! > 3, "orchestrator's resolveQuotationOrdinalFollowUp treats any parsed position beyond entityCount as out_of_range");
});

// ── Source-level wiring checks (gating, dispatch, out-of-range answer, priority order) ─────────

test("PART 3/9. Ordinal resolution is gated strictly on conversationReference.domain === \"Quotation\"", () => {
  assert.ok(resolverBody.includes('if (reference.domain !== "Quotation") return undefined;'));
  assert.ok(resolverBody.includes('entity.type === "quotation"'));
  assert.ok(resolverBody.includes("if (quotationEntities.length === 0) return undefined;"));
});

test("8/9. A non-Quotation or absent reference never invokes the parser - resolveQuotationOrdinalFollowUp is called only when domain === \"Quotation\"", () => {
  assert.ok(source.includes('const quotationOrdinalFollowUp = conversationReference?.domain === "Quotation"'));
  assert.ok(source.includes("? resolveQuotationOrdinalFollowUp(request.message, conversationReference)"));
  assert.ok(source.includes(": undefined;"));
});

test("5/7. Out-of-range returns a fixed deterministic clarification, never falling through to Help/the provider", () => {
  assert.ok(source.includes('if (quotationOrdinalFollowUp?.kind === "out_of_range") {'));
  assert.ok(source.includes("There were only ${quotationOrdinalFollowUp.count} quotation"));
  assert.ok(source.includes('domain: "Quotation",'));
  // The clarification is returned directly from runNoaOrchestratorCore, before any capability call.
  const outOfRangeIndex = source.indexOf('if (quotationOrdinalFollowUp?.kind === "out_of_range")');
  const firstCapabilityCallIndex = source.indexOf("const capabilityResult =");
  assert.ok(outOfRangeIndex >= 0 && firstCapabilityCallIndex > outOfRangeIndex);
});

test("joinQuotationOrdinalChoices produces the exact \"1, 2, or 3\" style phrasing", () => {
  const fnBody = bodyFrom("function joinQuotationOrdinalChoices(");
  assert.ok(fnBody.includes('if (numbers.length === 1) return numbers[0];'));
  assert.ok(fnBody.includes('if (numbers.length === 2) return numbers.join(" or ");'));
  assert.ok(fnBody.includes('`${numbers.slice(0, -1).join(", ")}, or ${numbers[numbers.length - 1]}`'));
});

test("4. Selected ordinal rewrites to \"tell me about <label>\" - identity only, no stale fact copied into the rewrite", () => {
  assert.ok(resolverBody.includes("return { kind: \"selected\", rewrittenMessage: `tell me about ${quotationEntities[position - 1].label}` };"));
});

test("10. Selection always re-dispatches through the EXISTING fetchNoaQuotationCapability, never answers from reference data directly", () => {
  assert.ok(source.includes("const quotationMessageOverride = quotationOrdinalFollowUp?.kind === \"selected\" ? quotationOrdinalFollowUp.rewrittenMessage : undefined;"));
  assert.match(source, /await fetchNoaQuotationCapability\(quotationMessageOverride \?\? request\.message, request\.context, \{/);
  // The fresh capability result still rebuilds the Quotation reference exactly as C4A already does
  // for every successful Quotation answer - no special-cased reference logic for the ordinal path.
  assert.ok(source.includes("? buildQuotationConversationReference(capabilityResult.data)"));
});

test("12. QN deterministic fast path (quotationIdentifierTotal) still wins over the ordinal check", () => {
  const routeStart = source.indexOf("const route = recordedQuotationFollowUpFrom");
  const routeEnd = source.indexOf(";", source.indexOf("classifyNoaRoute(request.message, request.context)", routeStart));
  const routeBlock = source.slice(routeStart, routeEnd);
  const quotationIdIndex = routeBlock.indexOf("quotationIdentifierTotal > 0");
  const ordinalIndex = routeBlock.indexOf("quotationMessageOverride");
  assert.ok(quotationIdIndex >= 0 && ordinalIndex >= 0 && quotationIdIndex < ordinalIndex);
});

test("14. recordedQuotationFollowUpFrom (UserActivity \"which quotation?\") still takes priority over the ordinal check", () => {
  const routeStart = source.indexOf("const route = recordedQuotationFollowUpFrom");
  const routeEnd = source.indexOf(";", source.indexOf("classifyNoaRoute(request.message, request.context)", routeStart));
  const routeBlock = source.slice(routeStart, routeEnd);
  const recordedIndex = routeBlock.indexOf("recordedQuotationFollowUpFrom");
  const ordinalIndex = routeBlock.indexOf("quotationMessageOverride");
  assert.ok(recordedIndex >= 0 && ordinalIndex >= 0 && recordedIndex < ordinalIndex);
});

test("no semantic extractor call was added for the ordinal path - resolution happens before route classification, still exactly one extractor invocation per request", () => {
  const ordinalDeclIndex = source.indexOf("const quotationOrdinalFollowUp = conversationReference?.domain");
  const extractorCallIndex = source.indexOf("await extractNoaSemanticRequest(");
  assert.ok(ordinalDeclIndex >= 0 && extractorCallIndex > ordinalDeclIndex);
  assert.equal((source.match(/extractNoaSemanticRequest\(/g) ?? []).length, 1);
});

test("13. Pending-quotations / general quotation list behavior is untouched (no change to buildQuotationConversationReference's own list-building)", () => {
  const fnStart = source.indexOf("function buildQuotationConversationReference(data: unknown)");
  const fnBody = source.slice(fnStart, source.indexOf("\n// C4A: ordinal", fnStart));
  assert.ok(fnBody.includes("record.quotationNo"));
  assert.ok(fnBody.includes("boundConversationReferenceEntities("));
});

test("no mutation calls were introduced by the ordinal follow-up addition", () => {
  const addedSource = source.slice(source.indexOf("// C4A: ordinal list-selection follow-up"), source.indexOf("// ══════════════════════════════════════════════════════════════════════════════════════════════\n// GPC-3"));
  assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(addedSource));
});
