import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-intent-extractor.server.ts has "server-only" + "@/..." aliases, neither resolvable by
// Node's plain ESM resolver outside the Next.js build. Source-level wiring/safety checks, same
// convention as every other lib/noa/*-safety.test.mts file.

const extractorSource = readFileSync("lib/noa/noa-intent-extractor.server.ts", "utf8");
const semanticRequestSource = readFileSync("lib/noa/noa-semantic-request.ts", "utf8");
const subjectResolverSource = readFileSync("lib/noa/noa-subject-resolver.ts", "utf8");
const registrySource = readFileSync("lib/ai/agent-registry.ts", "utf8");

// 1. schema is closed
test("1. the provider-facing JSON schema is closed (additionalProperties: false) at every object level", () => {
  const count = (extractorSource.match(/additionalProperties:\s*false/g) ?? []).length;
  assert.ok(count >= 3, "expected additionalProperties:false on the top-level schema, subject, and entityReference objects");
});

// 2. no business data fields exist
test("2. the schema/type never declares a business-fact field (count/total/price/status/grand_total as an actual property)", () => {
  for (const source of [extractorSource, semanticRequestSource]) {
    assert.ok(!/\b(count|total|price|status|grandTotal|grand_total):\s*\{?\s*(type|number|string)?/i.test(source));
  }
});

// 3. self detection / 4. named-user detection / 5. team detection -------------
test("3-5. subject resolution rules exist for self, named_user, and team", () => {
  assert.ok(subjectResolverSource.includes('{ type: "self" }'));
  assert.ok(subjectResolverSource.includes("named_user"));
  assert.ok(subjectResolverSource.includes('{ type: "team" }'));
  assert.match(subjectResolverSource, /const SELF_PATTERN = \/\\b\(i\|me\|my\|mine\)\\b\/i;/);
});

// 6. period normalization
test("6. period normalization covers exactly the five supported values, no timezone math", () => {
  assert.match(subjectResolverSource, /"today"/);
  assert.match(subjectResolverSource, /"yesterday"/);
  assert.match(subjectResolverSource, /"this_week"/);
  assert.match(subjectResolverSource, /"last_7_days"/);
  assert.match(subjectResolverSource, /"this_month"/);
  assert.ok(!/timezone|getTimezoneOffset|Intl\.DateTimeFormat/i.test(subjectResolverSource));
});

// 7. malformed provider output -> Unclear
test("7. any extraction failure (disabled, error, malformed/off-schema JSON) returns UNCLEAR_SEMANTIC_REQUEST, never a thrown answer-generation error", () => {
  assert.ok(extractorSource.includes("return UNCLEAR_SEMANTIC_REQUEST;"));
  assert.ok(extractorSource.includes("isNoaSemanticRequest(parsed) ? parsed : UNCLEAR_SEMANTIC_REQUEST"));
  const tryIndex = extractorSource.indexOf("try {");
  const catchIndex = extractorSource.indexOf("} catch {");
  assert.ok(tryIndex >= 0 && catchIndex >= 0 && tryIndex < catchIndex);
});

// 8. no capability/auth imports
test("8. the extractor and resolver never import any require*() auth helper or a NOA capability", () => {
  for (const source of [extractorSource, subjectResolverSource, semanticRequestSource]) {
    assert.ok(!/requireActiveUser|requireSystemOwner|requireSettingsManager|requireProductLibraryManager|requireProcurementManager/.test(source));
    assert.ok(!/noa-.*-capability/.test(source));
  }
});

// 9. no Supabase imports
test("9. the extractor and resolver never import or reference Supabase", () => {
  for (const source of [extractorSource, subjectResolverSource, semanticRequestSource]) {
    assert.ok(!/supabase/i.test(source));
  }
});

// 10. no provider registry entry added
test("10. no new AI agent registry entry was added - C1 reuses the existing noa_orchestrator runtime", () => {
  assert.ok(!registrySource.includes('id: "noa_intent_extractor"'));
  assert.ok(!registrySource.includes('id: "intent_extractor"'));
  const agentIdCount = (registrySource.match(/id: "/g) ?? []).length;
  assert.equal(agentIdCount, 4, "expected exactly the 4 pre-existing agents, no new registry entry");
  assert.ok(extractorSource.includes('resolveAiAgentRuntimeConfig("noa_orchestrator")'));
});

// Cost control (PART 7) -----------------------------------------------------------

test("cost control: only the current message and a compact page-context hint are ever sent to the extractor - no recentMessages, capabilityData, or database rows", () => {
  assert.ok(!extractorSource.includes("recentMessages"));
  assert.ok(!extractorSource.includes("capabilityData"));
  assert.match(extractorSource, /pageContext:\s*\{\s*section:\s*input\.context\.section\s*\}/);
});

// Security (PART 6) ---------------------------------------------------------------

test("security: C1 never authorizes and never queries profiles/activity/quotations/products data", () => {
  for (const source of [extractorSource, subjectResolverSource, semanticRequestSource]) {
    assert.ok(!/\.from\(["'`]/.test(source));
  }
});

test("the pure resolver module has no server-only/provider/auth imports at all", () => {
  assert.ok(!subjectResolverSource.includes('import "server-only";'));
  assert.ok(!subjectResolverSource.includes("runAiProvider"));
  assert.ok(!subjectResolverSource.includes('from "@/'));
});
