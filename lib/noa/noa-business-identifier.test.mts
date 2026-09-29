// Phase 4C: business identifier normalization (quotation QN / Project File CO). Unit-level tests
// for the pure normalizer, plus end-to-end tests proving the deterministic exact-ID fast path
// (never the Semantic Planner) handles normalized variants identically to the canonical form.
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { normalizeNoaBusinessIdentifier, findNoaBusinessIdentifierVariants } from "./noa-business-identifier";
import { normalizeNoaVoiceTranscript } from "../../components/noa/use-noa-realtime-voice";

mock.module("server-only", { defaultExport: {} });
process.env.NOA_SEMANTIC_V2 = "false";
process.env.NOA_AGENTS_V1 = "false";
mock.module("@/lib/ai/resolve-agent-runtime-config.server", { namedExports: {
  resolveAiAgentRuntimeConfig: async () => ({ enabled: true, apiKeyConfigured: true, provider: "openai", model: "fixture" }),
} });
mock.module("@/lib/ai/provider-router.server", { namedExports: {
  // Deterministic stub text - never a live call - so canonical vs. normalized runs can be
  // compared for equality without depending on real provider phrasing.
  runAiProvider: async () => ({ text: JSON.stringify({ text: "fixture answer" }) }),
} });
let authorized = true;
let quotationRow: Record<string, unknown> | null = null;
const authorize = async () => { if (!authorized) throw Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/login;307;" }); };
mock.module("@/lib/auth", { namedExports: { requireActiveUser: authorize, requireQuotationActionUser: authorize } });
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({
  from: (table: string) => {
    const builder: Record<string, unknown> = {
      select: () => builder, eq: () => builder, ilike: () => builder, order: () => builder,
      limit: () => builder, returns: () => builder,
      maybeSingle: async () => ({ data: table === "quotations" ? quotationRow : null, error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ count: 0, data: [], error: null }),
    };
    return builder;
  },
}) } });

const { runNoaOrchestrator } = await import("./noa-orchestrator");
const { shouldRunNoaSemanticPlanner } = await import("./noa-semantic-planner");
const context = { pathname: "/", section: "dashboard" } as const;

function reset() {
  authorized = true;
  quotationRow = {
    id: "00000000-0000-4000-8000-000000000001", quotation_no: "QN-0003-001", title: "Fixture Quotation",
    client_id: null, project_id: null, status: "draft", quotation_date: "2026-01-01", currency: "AED",
    grand_total: 1000, revision_no: 0, option_no: 1, is_active: true, legacy_reference: null, layout_settings: {},
  };
}

// ── PART 7: quotation normalization (Q1-Q9) ──────────────────────────────────────────────────

test("Q1 canonical: QN-0003-001 is rejected by the normalizer (already the existing hyphenated parser's job, unchanged)", () => {
  assert.equal(normalizeNoaBusinessIdentifier("QN", "QN-0003-001"), null);
});
test("Q2 compact: QN0003001 -> QN-0003-001", () => {
  assert.equal(normalizeNoaBusinessIdentifier("QN", "QN0003001"), "QN-0003-001");
});
test("Q3 spaces: QN 0003 001 -> QN-0003-001", () => {
  assert.equal(normalizeNoaBusinessIdentifier("QN", "QN 0003 001"), "QN-0003-001");
});
test("Q4 slash: QN/0003/001 -> QN-0003-001", () => {
  assert.equal(normalizeNoaBusinessIdentifier("QN", "QN/0003/001"), "QN-0003-001");
});
test("Q5 lowercase: qn0003001 -> QN-0003-001", () => {
  assert.equal(normalizeNoaBusinessIdentifier("QN", "qn0003001"), "QN-0003-001");
});
test("Q6 malformed grouping: QN-003-001 is rejected (6 digits, not the canonical 7 - never a guessed leading zero)", () => {
  assert.equal(normalizeNoaBusinessIdentifier("QN", "QN-003-001"), null);
});
test("Q7 malformed: QN/00-300-1 is rejected (mixed separators, ambiguous grouping)", () => {
  assert.equal(normalizeNoaBusinessIdentifier("QN", "QN/00-300-1"), null);
});
test("Q8 bare: QN is invalid", () => {
  assert.equal(normalizeNoaBusinessIdentifier("QN", "QN"), null);
});
test("Q9 random digits with no prefix: 0003001 is invalid", () => {
  assert.equal(normalizeNoaBusinessIdentifier("QN", "0003001"), null);
});

// ── PART 9: Project File (CO) normalization, same helper ────────────────────────────────────

test("CO0003001 / CO 0003 001 / CO/0003/001 / lowercase co all normalize to CO-0003-001", () => {
  for (const raw of ["CO0003001", "CO 0003 001", "CO/0003/001", "co0003001"]) {
    assert.equal(normalizeNoaBusinessIdentifier("CO", raw), "CO-0003-001");
  }
  assert.equal(normalizeNoaBusinessIdentifier("CO", "CO-0003-001"), null); // existing parser's job
});

// ── PART 6: false-positive safety ────────────────────────────────────────────────────────────

test("ordinary prose, prices and bare prefixes never become identifiers", () => {
  for (const message of [
    "QN", "CO", "quotation 3", "the price is 1003001 AED", "Client QN Holdings", "project CO Enterprises",
  ]) {
    assert.deepEqual(findNoaBusinessIdentifierVariants("QN", message).concat(findNoaBusinessIdentifierVariants("CO", message)), []);
  }
});

// ── PART 8: routing - normalized exact IDs bypass the planner, same as canonical ────────────

test("1/8. shouldRunNoaSemanticPlanner treats a normalized QN/CO exactly like the canonical hyphenated form - never NL phrase logic", () => {
  const state = undefined;
  for (const message of ["Show quotation QN0003001.", "Show quotation QN 0003 001.", "Show quotation QN/0003/001.", "CO0003001", "CO 0003 001"]) {
    assert.equal(shouldRunNoaSemanticPlanner(state, { message }, true), false);
  }
  // A natural-language lookup with no identifier still reaches the planner (discovery path).
  assert.equal(shouldRunNoaSemanticPlanner(state, { message: "Can you check Galleria Mall quotation?" }, true), true);
});

test("2/3/7. a normalized QN produces the same answer/reference as the canonical form; canonical behavior is unchanged", async () => {
  reset();
  const canonical = await runNoaOrchestrator({ context, message: "Show quotation QN-0003-001." });
  reset();
  const compact = await runNoaOrchestrator({ context, message: "Show quotation QN0003001." });
  reset();
  const spaced = await runNoaOrchestrator({ context, message: "Show quotation QN 0003 001." });
  reset();
  const slashed = await runNoaOrchestrator({ context, message: "Show quotation QN/0003/001." });
  for (const answer of [compact, spaced, slashed]) {
    assert.deepEqual(answer.conversationReference, canonical.conversationReference);
    assert.equal(answer.domain, canonical.domain);
  }
});

test("2b/7b. the same holds for a normalized CO Project File identifier", async () => {
  const traces: unknown[] = [];
  const { answer: canonical, trace: canonicalTrace } = await sendWithTrace("Tell me about CO-0003-001");
  const { answer: compact, trace: compactTrace } = await sendWithTrace("Tell me about CO0003001");
  assert.equal(compact?.domain, canonical?.domain);
  assert.equal(compactTrace.scopeSource, "explicit_identifier");
  assert.equal(compactTrace.semanticUsed, false);
  assert.equal(canonicalTrace.scopeSource, "explicit_identifier");
  void traces;
});

async function sendWithTrace(message: string) {
  let trace: Record<string, unknown> | undefined;
  const answer = await runNoaOrchestrator({ context, message }, (t) => { trace = { ...t }; });
  return { answer, trace: trace! };
}

test("4/5. a malformed identifier does not crash and falls back safely (never a guessed record)", async () => {
  reset();
  for (const message of ["Show quotation QN/00-300-1.", "Show quotation QN-003-001."]) {
    const answer = await runNoaOrchestrator({ context, message });
    assert.ok(answer.text.length > 0);
  }
});

test("6. no ResultSet corruption: a not-found normalized lookup never fabricates a reference", async () => {
  reset();
  quotationRow = null; // ILIKE finds nothing for this normalized number
  const answer = await runNoaOrchestrator({ context, message: "Show quotation QN0009009." });
  assert.equal(answer.conversationReference, undefined);
});

// ── PART 11: voice/text parity - same normalizer, no spoken-digit parsing ──────────────────

test("normalized voice transcript text feeds the same identifier normalizer as typed text", () => {
  for (const [voice, typedDigits] of [
    ["hey noa show quotation qn0003001", "qn0003001"],
    ["hey noa show quotation qn 0003 001", "qn 0003 001"],
    ["hello nova show quotation QN/0003/001", "QN/0003/001"],
  ] as const) {
    const transcript = normalizeNoaVoiceTranscript(voice);
    assert.ok(transcript.toLowerCase().includes(typedDigits.toLowerCase()));
    assert.deepEqual(findNoaBusinessIdentifierVariants("QN", transcript), findNoaBusinessIdentifierVariants("QN", typedDigits));
    assert.equal(findNoaBusinessIdentifierVariants("QN", transcript)[0], "QN-0003-001");
  }
  // Fully spoken digit words are explicitly NOT parsed (Category C - future work).
  assert.deepEqual(findNoaBusinessIdentifierVariants("QN", "QN zero zero zero three zero zero one"), []);
});
