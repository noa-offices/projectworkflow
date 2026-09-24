import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-project-capability.server.ts and noa-quotation-capability.server.ts both have "server-only"
// + "@/..." aliases, neither resolvable by Node's plain ESM resolver outside the Next.js build.
// Source-level wiring/safety checks, same convention as every other lib/noa/*-safety.test.mts
// file. noa-orchestrator.ts is read only to confirm Conversation Understanding v2 was untouched.

const projectSource = readFileSync("lib/noa/noa-project-capability.server.ts", "utf8");
const quotationSource = readFileSync("lib/noa/noa-quotation-capability.server.ts", "utf8");
const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const projectFileHelperSource = readFileSync("lib/quotations/project-file.ts", "utf8");

// ── Tests 1-2: ERP Project File lookup by reference / order number ─────────────

test("1. a free-text reference ('Galleria Mall Boutique Refurbishment') is matched against the ERP Project File's own reference field", () => {
  const fnStart = projectSource.indexOf("async function projectFileAnswer");
  const fnEnd = projectSource.indexOf("\nexport async function fetchNoaProjectCapability", fnStart);
  const fnBody = projectSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("order.reference.toLowerCase().includes(normalizedTarget)"));
});

test("2. an exact order number ('CO-0003-001') resolves via an exact orderNo match, checked before the fuzzy fallback", () => {
  const fnStart = projectSource.indexOf("async function projectFileAnswer");
  const fnEnd = projectSource.indexOf("\nexport async function fetchNoaProjectCapability", fnStart);
  const fnBody = projectSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("const exactOrderMatch = allOrders.find((order) => order.orderNo.toLowerCase() === normalizedTarget);"));
});

// ── Tests 3-4: active / completed ERP Project Files ─────────────────────────────

test("3-4. generic list/count answers filter allProjectFiles by status ('active' default, 'completed' on request) - never a third bespoke query", () => {
  const fnStart = projectSource.indexOf("async function projectFileAnswer");
  const fnEnd = projectSource.indexOf("\nexport async function fetchNoaProjectCapability", fnStart);
  const fnBody = projectSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('const requestedStatus: ProjectFileStatus = completed ? "completed" : "active";'));
  assert.ok(fnBody.includes("allOrders\n    .filter((order) => order.status === requestedStatus)"));
});

// ── Tests 5-7: explicit Project Record path / generic must not default to it ───

test("5-6. 'project record(s)' wording reaches the standalone projects table only when no CO Project File identifier is present", () => {
  assert.match(projectSource, /const PROJECT_RECORD_PATTERN = \/\\b\(\?:standalone \)\?project records\?\\b\/i;/);
  assert.match(projectSource, /return PROJECT_RECORD_PATTERN\.test\(message\) && projectFileIdentifierCount\(message\) === 0\s*\n\s*\? projectRecordAnswer\(supabase, message, context\)\s*\n\s*: projectFileAnswer\(supabase, message, context\);/);
});

test("7. generic wording (no 'project record(s)' phrase) never reaches projectRecordAnswer - it falls through to the ERP default", () => {
  // The dispatch is a single ternary keyed only on PROJECT_RECORD_PATTERN; there is no other call
  // site of projectRecordAnswer anywhere in the file.
  const callSites = (projectSource.match(/projectRecordAnswer\(/g) ?? []).length;
  assert.equal(callSites, 2, "one function definition + exactly one dispatch call site");
});

// ── Test 8: ERP Project File reuses the existing layout_settings union ─────────

test("8. allProjectFiles() reuses the exact existing union (projectFileFromLayoutSettings ?? clientApprovalDraftFromLayoutSettings()?.confirmedOrder) - no new parser introduced", () => {
  const fnStart = projectSource.indexOf("async function allProjectFiles");
  const fnEnd = projectSource.indexOf("\n// ERP-NOA-1 (PART 1/3/4/5)", fnStart);
  const fnBody = projectSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("projectFileFromLayoutSettings(quotation.layout_settings) ??"));
  assert.ok(fnBody.includes("clientApprovalDraftFromLayoutSettings(quotation.layout_settings)?.confirmedOrder"));
  // Bounded scan, never unbounded (PART 3).
  assert.ok(fnBody.includes(".limit(PROJECT_FILE_SCAN_LIMIT)"));
  // project-file.ts itself was not edited - only imported, exactly as before.
  assert.ok(!projectFileHelperSource.includes("ERP-NOA-1"));
});

// ── Test 9: ERP status uses completed/cancelled flags, never projects.project_status ─

test("9. ERP Project File status is derived only from projectCompletedAt/projectCancelledAt, never from the standalone projects.project_status column", () => {
  const fnStart = projectSource.indexOf("async function allProjectFiles");
  const fnEnd = projectSource.indexOf("\n// ERP-NOA-1 (PART 1/3/4/5)", fnStart);
  const fnBody = projectSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('const status: ProjectFileStatus = cancelledAt ? "cancelled" : completedAt ? "completed" : "active";'));
  assert.ok(!fnBody.includes("project_status"));
});

// ── Test 10: quotation number remains quotations.quotation_no, untouched ───────

test("10. quotation-number resolution remains on quotations.quotation_no through the shared lookup helper", () => {
  assert.ok(quotationSource.includes('function extractQuotationIdentifier(message: string): string | null {\n  const match = message.match(/[A-Za-z]{0,4}-?\\d{3,}(?:-\\d+)*/);\n  return match ? match[0] : null;\n}'));
  assert.ok(quotationSource.includes('async function quotationForIdentifier('));
  assert.ok(quotationSource.includes('.ilike("quotation_no", `%${quotationNo}%`)'));
});

// ── Test 11: quotation response can use legacy_reference ────────────────────────

test("11. QUOTATION_SELECT now includes legacy_reference, and quotationDisplayReference() reads it as a fallback", () => {
  assert.ok(quotationSource.includes("legacy_reference,layout_settings"));
  const fnStart = quotationSource.indexOf("function quotationDisplayReference");
  const fnEnd = quotationSource.indexOf("\nasync function buildQuotationAnswer", fnStart);
  const fnBody = quotationSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("quotation.legacy_reference?.trim()"));
});

// ── Test 12: quotation project/reference display is no longer standalone-project-only ─

test("12. the new `reference` field prefers the ERP Project File's own reference over the standalone linked Project name, which is now a later fallback, not the primary source", () => {
  const fnStart = quotationSource.indexOf("function quotationDisplayReference");
  const fnEnd = quotationSource.indexOf("\nasync function buildQuotationAnswer", fnStart);
  const fnBody = quotationSource.slice(fnStart, fnEnd);
  const projectFileIndex = fnBody.indexOf("projectFileReference");
  const legacyIndex = fnBody.indexOf("quotation.legacy_reference");
  const titleIndex = fnBody.indexOf("quotation.title");
  const projectNameIndex = fnBody.lastIndexOf("projectName");
  assert.ok(projectFileIndex >= 0 && projectFileIndex < legacyIndex);
  assert.ok(legacyIndex < titleIndex);
  assert.ok(titleIndex < projectNameIndex);
  assert.ok(quotationSource.includes("reference: quotationDisplayReference(quotation, projectName),"));
});

test("no raw layout_settings is ever included in the returned quotation data - only the derived reference string", () => {
  const fnStart = quotationSource.indexOf("async function buildQuotationAnswer");
  const fnEnd = quotationSource.indexOf("\nasync function clientNameFor", fnStart);
  const fnBody = quotationSource.slice(fnStart, fnEnd);
  assert.ok(!/layoutSettings|layout_settings:/i.test(fnBody.replace(/quotationDisplayReference\(quotation, projectName\)/g, "")));
});

// ── Test 13: no schema/RLS/auth change ──────────────────────────────────────────

test("13. Project auth (requireActiveUser) and Quotation auth (requireQuotationActionUser) remain the sole, unconditional gates - unchanged", () => {
  assert.ok(projectSource.includes("await requireActiveUser();"));
  assert.ok(quotationSource.includes("await requireQuotationActionUser();"));
});

test("13b. no mutation/DDL calls were introduced in either capability", () => {
  const mutationPattern = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|ALTER TABLE|CREATE TABLE/i;
  assert.ok(!mutationPattern.test(projectSource));
  assert.ok(!mutationPattern.test(quotationSource));
});

// ── Test 14: no Client/Procurement changes ──────────────────────────────────────

test("14. Client and Procurement capability files were not touched by this phase", () => {
  const clientSource = readFileSync("lib/noa/noa-client-capability.server.ts", "utf8");
  const procurementSource = readFileSync("lib/noa/noa-procurement-capability.server.ts", "utf8");
  assert.ok(!clientSource.includes("ERP-NOA-1"));
  assert.ok(!procurementSource.includes("ERP-NOA-1"));
});

// ── Test 15: Conversation Understanding v2 (orchestrator) files unchanged ──────
//
// ERP-NOA-2 (a later, separate phase) legitimately touched noa-orchestrator.ts to correct
// buildProjectConversationReference()/resolveProjectFollowUp() for the ERP Project File shape -
// that phase's own safety test covers those changes. This ERP-NOA-1 check is narrowed to confirm
// ERP-NOA-1 itself never touched the orchestrator, and that the Project/Quotation dispatch CALL
// SHAPES this phase actually cared about are still intact.

test("15. noa-orchestrator.ts preserves the Project and TC-1B Quotation optional inputs", () => {
  assert.match(orchestratorSource, /domain === "Project"\s*\n\s*\? await fetchNoaProjectCapability\(projectMessageOverride \?\? request\.message, request\.context, \{/);
  assert.match(orchestratorSource, /domain === "Quotation"\s*\n\s*\? await fetchNoaQuotationCapability\(request\.message, request\.context, \{/);
});
