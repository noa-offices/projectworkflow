// NOA 2.0B-2: QN/CO scoped Catch-Up - Quotation + ERP Project File change history, reusing the
// existing UserActivity domain and the proven quotation/Project File resolvers verbatim.
// noa-user-activity-capability.server.ts/noa-orchestrator.ts/noa-intent-router.ts have "@/..."
// aliases and/or `import "server-only"`, or (for noa-intent-router.ts specifically) a cross-file
// relative import that hits this repo's pre-existing Node-ESM `.js`->`.ts` resolution gap
// (documented in every earlier N2A*/N2B1 phase) - none resolvable by Node's plain ESM resolver
// outside the Next.js build. These are source-level wiring/safety checks, matching the convention
// already used throughout lib/noa/'s other *-safety.test.mts files. The routing-precedence checks
// re-implement the exact same CATCH_UP_PATTERNS array locally (verified byte-for-byte against the
// real source first) rather than importing classifyNoaRoute(), so this file stays independently
// executable.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const capability = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");
const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const router = readFileSync("lib/noa/noa-intent-router.ts", "utf8");
const quotationCapability = readFileSync("lib/noa/noa-quotation-capability.server.ts", "utf8");
const projectCapability = readFileSync("lib/noa/noa-project-capability.server.ts", "utf8");
const typesSource = readFileSync("lib/noa/noa-types.ts", "utf8");

function sliceFunctionBody(source: string, startIndex: number): string {
  const rest = source.slice(startIndex);
  const relativeEnd = rest.search(/\r?\n\}\r?\n/);
  return relativeEnd === -1 ? rest : rest.slice(0, relativeEnd);
}

// 1. no new CatchUp domain
test("1. no CatchUp NoaDomain was added", () => {
  const domainLine = typesSource.match(/export type NoaDomain = .*;/)?.[0] ?? "";
  assert.ok(domainLine.includes('"UserActivity"'));
  assert.ok(!domainLine.includes('"CatchUp"'));
});

// Verify the real CATCH_UP_PATTERNS array (checked against the actual router source) before
// reusing it to test routing behavior below - this is the same idiom noa-phase-n2b1-safety.test.mts
// already uses successfully.
const CATCH_UP_PATTERNS = [/\bwhat changed\b/, /\bwhat happened\b/, /\bcatch me up\b/];
test("router source still defines CATCH_UP_PATTERNS exactly as re-implemented above", () => {
  assert.ok(router.includes("const CATCH_UP_PATTERNS = [/\\bwhat changed\\b/, /\\bwhat happened\\b/, /\\bcatch me up\\b/];"));
});

function matchesCatchUp(message: string): boolean {
  return CATCH_UP_PATTERNS.some((pattern) => pattern.test(message.toLowerCase()));
}

// 2/3/4. QN historical phrasing matches Catch-Up patterns (-> UserActivity at the router)
test("2/3/4. QN historical phrasing (changed/happened/catch me up) matches CATCH_UP_PATTERNS", () => {
  for (const message of ["what changed on QN-0005-001", "what happened on QN-0005-001", "catch me up on QN-0005-001"]) {
    assert.ok(matchesCatchUp(message), message);
  }
});

// 5/6/7. CO historical phrasing matches Catch-Up patterns
test("5/6/7. CO historical phrasing (changed/happened/catch me up) matches CATCH_UP_PATTERNS", () => {
  for (const message of ["what changed on CO-0003-001", "what happened on CO-0003-001", "catch me up on CO-0003-001"]) {
    assert.ok(matchesCatchUp(message), message);
  }
});

// 8/9. QN current-state phrasing does NOT match Catch-Up patterns (so the orchestrator's
// identifier fast path still applies, forcing Quotation, exactly as before).
test("8/9. QN current-state phrasing does not match CATCH_UP_PATTERNS", () => {
  for (const message of ["tell me about QN-0005-001", "what is QN-0005-001 worth"]) {
    assert.ok(!matchesCatchUp(message), message);
  }
});

// 10. CO current-state phrasing does not match Catch-Up patterns
test("10. CO current-state phrasing does not match CATCH_UP_PATTERNS", () => {
  assert.ok(!matchesCatchUp("tell me about CO-0003-001"));
});

// Orchestrator precedence: verifies the ACTUAL fix (identifier fast path deferring to
// classifyNoaRoute's own UserActivity decision) exists, narrowly, without touching the other
// precedence tiers (quotationMessageOverride, referenceFollowUpRoute).
test("orchestrator precedence fix is narrow: only intervenes when an identifier is present", () => {
  assert.ok(orchestrator.includes("const deterministicRoute = classifyNoaRoute(request.message, request.context);"));
  assert.ok(orchestrator.includes('const identifierRoute = quotationIdentifierTotal > 0 ? "Quotation" : projectFileIdentifierTotal > 0 ? "Project" : null;'));
  assert.ok(orchestrator.includes('identifierRoute && deterministicRoute !== "UserActivity"'));
  // referenceFollowUpRoute/quotationMessageOverride still sit in the SAME final-fallback tail,
  // untouched relative to each other and to deterministicRoute as the final fallback.
  assert.ok(orchestrator.includes("referenceFollowUpRoute ?? deterministicRoute"));
});

// 11/12. quotation resolver reused, no duplicate QN resolver invented
test("11/12. quotationForIdentifier()/quotationStructuredRequest() are imported and reused - no second QN regex/resolver", () => {
  assert.ok(capability.includes('import { quotationForIdentifier, quotationIdentifierCount, quotationStructuredRequest } from "@/lib/noa/noa-quotation-capability.server";'));
  assert.ok(capability.includes("await quotationForIdentifier(supabase, structured.quotationNo)"));
  assert.ok(!/function\s+quotationForIdentifier|function\s+extractQuotationIdentifier/.test(capability));
  assert.ok(quotationCapability.includes("export async function quotationForIdentifier("));
});

// 13. Project File helper reused
test("13. allProjectFiles()/projectFileIdentifierFromMessage() are imported and reused - no duplicate Project File parser", () => {
  assert.ok(capability.includes('import { allProjectFiles, projectFileIdentifierCount, projectFileIdentifierFromMessage } from "@/lib/noa/noa-project-capability.server";'));
  assert.ok(capability.includes("const orders = await allProjectFiles(supabase);"));
  assert.ok(!/projectFileFromLayoutSettings|clientApprovalDraftFromLayoutSettings/.test(capability));
  assert.ok(projectCapability.includes("export async function allProjectFiles("));
  assert.ok(projectCapability.includes("export function projectFileIdentifierFromMessage(message: string): string | null {"));
});

// 14. standalone projects table never queried
test("14. the standalone projects table is never queried in the UserActivity capability", () => {
  assert.ok(!capability.includes('.from("projects")'));
});

// 15/16. quotation top-level/child audit queries bounded
test("15/16. the quotation top-level and child audit queries are both bounded", () => {
  const start = capability.indexOf("async function catchUpQuotationRows(");
  const body = sliceFunctionBody(capability, start);
  assert.ok(body.includes(".limit(CATCH_UP_QUOTATION_TOP_LIMIT)"));
  assert.ok(body.includes(".limit(CATCH_UP_QUOTATION_CHILD_LIMIT)"));
  assert.ok(body.includes('.eq("entity_type", "quotation")') && body.includes('.eq("entity_id", quotationId)'));
  assert.ok(body.includes('.eq("parent_entity_type", "quotation")') && body.includes('.eq("parent_entity_id", quotationId)'));
});

// 17/18/19. project/orderNo audit query bounded, metadata.orderNo join present, top-level
// owning-quotation events included
test("17/18/19. the Project File query is bounded, joins via metadata->>orderNo, and includes the top-level owning-quotation leg", () => {
  const start = capability.indexOf("async function catchUpProjectFileRows(");
  const body = sliceFunctionBody(capability, start);
  assert.ok(body.includes(".limit(CATCH_UP_PROJECT_FILE_LIMIT)"));
  assert.ok(body.includes(".limit(CATCH_UP_QUOTATION_TOP_LIMIT)"));
  assert.ok(body.includes("`parent_entity_id.eq.${quotationId},metadata->>orderNo.eq.${orderNo}`"));
  assert.ok(body.includes('.eq("entity_type", "quotation")') && body.includes('.eq("entity_id", quotationId)'));
});

// 20. internal audit id dedupe before presentation
test("20. rows are deduped by internal id before consolidation/presentation", () => {
  assert.ok(capability.includes("function dedupeAndSortCatchUpRows(rows: CatchUpAuditRow[]): CatchUpAuditRow[] {"));
  assert.ok(capability.includes("if (!byId.has(row.id)) byId.set(row.id, row);"));
  assert.ok(capability.includes("return dedupeAndSortCatchUpRows([...(topRows ?? []), ...(childRows ?? [])]);"));
  assert.ok(capability.includes("return dedupeAndSortCatchUpRows([...(topRows ?? []), ...(linkedRows ?? [])]);"));
});

// 21/22. existing adjacent consolidation and ×N rendering reused via the shared builder
test("21/22. both scoped answers funnel through the SAME buildCatchUpResult()/groupAdjacentCatchUpRows()/catchUpGroupLine() pipeline - no second formatter", () => {
  assert.equal((capability.match(/return buildCatchUpResult\(/g) ?? []).length, 3);
  assert.equal((capability.match(/function groupAdjacentCatchUpRows\(/g) ?? []).length, 1);
  assert.equal((capability.match(/function catchUpGroupLine\(/g) ?? []).length, 1);
});

// 23/24. actor behavior unchanged, no profiles lookup
test("23/24. scoped answers reuse actorLabelFor()/catchUpGroupLine() as-is - no profiles lookup anywhere in the scoped functions", () => {
  const quotationAnswerStart = capability.indexOf("async function catchUpQuotationAnswer(");
  const quotationAnswerBody = sliceFunctionBody(capability, quotationAnswerStart);
  const projectAnswerStart = capability.indexOf("async function catchUpProjectFileAnswer(");
  const projectAnswerBody = sliceFunctionBody(capability, projectAnswerStart);
  assert.ok(!quotationAnswerBody.includes('.from("profiles")'));
  assert.ok(!projectAnswerBody.includes('.from("profiles")'));
});

// 25. empty state says recorded activity
test("25. scoped empty-state wording says recorded activity, never claims nothing changed", () => {
  assert.ok(capability.includes("`I couldn't find any recorded activity for ${label}.`"));
  assert.ok(capability.includes("`I couldn't find any recorded activity for ${order.orderNo}.`"));
  // The two scoped emptyText arguments both use the same "recorded activity" phrasing above -
  // confirmed exact-string-equal to N2B1's own already-approved wording, never a new "nothing
  // changed"-style claim.
  assert.equal((capability.match(/`I couldn't find any recorded activity for [^`]*\.`/g) ?? []).length, 3);
});

// 26. no provider call for scoped Catch-Up
test("26. scoped Catch-Up responses are deterministicOnly - no provider call", () => {
  const quotationAnswerStart = capability.indexOf("async function catchUpQuotationAnswer(");
  const quotationAnswerBody = sliceFunctionBody(capability, quotationAnswerStart);
  const projectAnswerStart = capability.indexOf("async function catchUpProjectFileAnswer(");
  const projectAnswerBody = sliceFunctionBody(capability, projectAnswerStart);
  assert.ok(!quotationAnswerBody.includes("runNoaProvider"));
  assert.ok(!projectAnswerBody.includes("runNoaProvider"));
  const builderStart = capability.indexOf("function buildCatchUpResult(");
  const builderBody = sliceFunctionBody(capability, builderStart);
  assert.ok(builderBody.includes("deterministicOnly: true"));
});

// 27. no client-payment history claim
test("27. no client-payment history claim is made anywhere in the Project File scoped path", () => {
  const projectAnswerStart = capability.indexOf("async function catchUpProjectFileAnswer(");
  const projectAnswerBody = sliceFunctionBody(capability, projectAnswerStart);
  assert.ok(!/client_payment|clientPayment/i.test(projectAnswerBody));
});

// 28. no schema/RLS changes
test("28. no schema/migration/RLS reference was added in any touched file", () => {
  for (const source of [capability, orchestrator, quotationCapability, projectCapability]) {
    assert.ok(!/alter table|create table|create policy/i.test(source));
  }
});

// 29. direct current-state QN/CO behavior preserved (the identifier-forced branches themselves
// are untouched - same literal ternary shape as before this phase, just now conditioned on
// `identifierRoute` instead of the two raw counts directly).
test("29. current-state QN/CO fast-path routing code is untouched", () => {
  assert.ok(orchestrator.includes('const identifierRoute = quotationIdentifierTotal > 0 ? "Quotation" : projectFileIdentifierTotal > 0 ? "Project" : null;'));
  assert.ok(orchestrator.includes("? identifierRoute"));
});

// 30. no general pronoun-follow-up architecture added
test("30. no new conversation-reference/pronoun-follow-up machinery was added for Catch-Up", () => {
  assert.ok(!/catch_up.*conversationReference|conversationReference.*catch_up/i.test(capability));
  assert.ok(!capability.includes("resolveCatchUpFollowUp"));
});

// auth: quotation-scoped Catch-Up reuses requireQuotationActionUser(); Project-File-scoped needs
// no extra gate beyond the base requireActiveUser() already checked.
test("auth: quotation-scoped Catch-Up requires requireQuotationActionUser() before its query runs; Project-File-scoped uses only the base gate", () => {
  const gateIndex = capability.indexOf("await requireQuotationActionUser();");
  const dispatchIndex = capability.indexOf("return catchUpQuotationAnswer(supabase, message);");
  assert.ok(gateIndex > -1 && dispatchIndex > -1 && gateIndex < dispatchIndex);
  assert.ok(capability.includes('if (kind === "catch_up_project_file") return catchUpProjectFileAnswer(supabase, message);'));
});
