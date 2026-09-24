import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-client-capability.server.ts and noa-orchestrator.ts both have "server-only" + "@/..."
// aliases, neither resolvable by Node's plain ESM resolver outside the Next.js build.
// Source-level wiring/safety checks, same convention as every other lib/noa/*-safety.test.mts
// file. Quotation/Procurement/project-file sources are read only to confirm they were NOT
// touched by this phase.

const clientSource = readFileSync("lib/noa/noa-client-capability.server.ts", "utf8");
const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const quotationSource = readFileSync("lib/noa/noa-quotation-capability.server.ts", "utf8");
const procurementSource = readFileSync("lib/noa/noa-procurement-capability.server.ts", "utf8");
const projectFileHelperSource = readFileSync("lib/quotations/project-file.ts", "utf8");

// ── Tests 1-2: Client ERP Project File questions ────────────────────────────────

test("1-2. the 'projects' question kind dispatches to clientProjectFilesAnswer by default (ERP), and to clientProjectsAnswer only for explicit 'project record(s)' wording", () => {
  assert.match(
    clientSource,
    /return CLIENT_PROJECT_RECORD_PATTERN\.test\(message\)\s*\n\s*\? clientProjectsAnswer\(supabase, client, countOnly\)\s*\n\s*: clientProjectFilesAnswer\(supabase, client, countOnly\);/,
  );
});

// ── Test 3: layout_settings union reused ────────────────────────────────────────

// ERP-NOA-3 extracted this query into a shared clientProjectFiles(supabase, clientId) helper
// (reused by both clientProjectFilesAnswer and clientDetailAnswer's inline count) - that phase's
// own safety test covers the extraction itself; these checks now look at the helper directly,
// which still contains the exact same query/union this test originally verified.
test("3. clientProjectFiles() reuses the exact existing union (projectFileFromLayoutSettings ?? clientApprovalDraftFromLayoutSettings()?.confirmedOrder) - no new parser", () => {
  const fnStart = clientSource.indexOf("async function clientProjectFiles(");
  const fnEnd = clientSource.indexOf("\nasync function clientProjectFilesAnswer", fnStart);
  const fnBody = clientSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("projectFileFromLayoutSettings(quotation.layout_settings) ??"));
  assert.ok(fnBody.includes("clientApprovalDraftFromLayoutSettings(quotation.layout_settings)?.confirmedOrder"));
  assert.ok(!projectFileHelperSource.includes("ERP-NOA-2"));
});

// ── Test 4: generic client-project query does not use projects.client_id ───────

test("4. clientProjectFiles() queries only quotations (by client_id FK), never the standalone projects table", () => {
  const fnStart = clientSource.indexOf("async function clientProjectFiles(");
  const fnEnd = clientSource.indexOf("\nasync function clientProjectFilesAnswer", fnStart);
  const fnBody = clientSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('.from("quotations")'));
  assert.ok(!fnBody.includes('.from("projects")'));
  assert.ok(fnBody.includes('.eq("client_id", clientId)'));
});

// ── Test 5: bounded scan only ────────────────────────────────────────────────────

test("5. the quotations scan is bounded (CLIENT_PROJECT_FILE_SCAN_LIMIT), never unbounded", () => {
  const fnStart = clientSource.indexOf("async function clientProjectFiles(");
  const fnEnd = clientSource.indexOf("\nasync function clientProjectFilesAnswer", fnStart);
  const fnBody = clientSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes(".limit(CLIENT_PROJECT_FILE_SCAN_LIMIT)"));
});

// ── Tests 6-7: Client follow-up (rewired capability, unchanged orchestrator resolver) ─

test("6-7. resolveClientFollowUp (orchestrator) is untouched by this phase - the ERP correction lives entirely in the capability's own dispatch", () => {
  const fnStart = orchestratorSource.indexOf("function resolveClientFollowUp");
  const fnEnd = orchestratorSource.indexOf("\n// C4C: builds a bounded Client conversationReference", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("CLIENT_PRONOUN_FOLLOW_UP_PATTERN"));
  assert.ok(fnBody.includes("CLIENT_BARE_FOLLOW_UP_PATTERN"));
});

// ── Tests 8-9: Project conversation reference (ERP shape) ──────────────────────

test("8-9. buildProjectConversationReference recognizes the ERP Project File shape (data.projectFile.orderNo / rows[].orderNo) first, using type 'project_file', and never reads an id/UUID/client id", () => {
  const fnStart = orchestratorSource.indexOf("function buildProjectConversationReference");
  const fnEnd = orchestratorSource.indexOf("\n// C4C: resolves a Client follow-up", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("record.projectFile"));
  assert.ok(fnBody.includes('type: "project_file"'));
  assert.ok(fnBody.includes("boundConversationReferenceEntities("));
  assert.ok(!/\.id\b|clientId|client_id|quotationId/.test(fnBody.replace(/entities\.map/g, "")));
});

test("9b. a single ERP Project File detail result also carries a secondary 'reference' entity for the human-readable label", () => {
  const fnStart = orchestratorSource.indexOf("function buildProjectConversationReference");
  const fnEnd = orchestratorSource.indexOf("\n// C4C: resolves a Client follow-up", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('type: "reference"'));
  assert.ok(fnBody.includes("uniqueOrderNos.length === 1"));
});

test("the standalone Project Record shape (data.project.projectName / rows[].projectName) is still supported unchanged as a fallback", () => {
  const fnStart = orchestratorSource.indexOf("function buildProjectConversationReference");
  const fnEnd = orchestratorSource.indexOf("\n// C4C: resolves a Client follow-up", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("record.project;"));
  assert.ok(fnBody.includes('type: "project" }))'));
});

// ── Tests 10-11: Project File follow-up resolution ──────────────────────────────

test("10-11. resolveProjectFollowUp looks up a 'project_file' entity first, falling back to 'project' - so an ERP Project File follow-up ('what status is it?'/'what client is it for?') resolves the inherited orderNo", () => {
  const fnStart = orchestratorSource.indexOf("function resolveProjectFollowUp");
  const fnEnd = orchestratorSource.indexOf("\n// C4B/ERP-NOA-2: builds a bounded Project conversationReference", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('entity.type === "project_file"'));
  assert.ok(fnBody.includes('entity.type === "project"'));
  assert.ok(fnBody.includes("`project ${projectLabel}`"));
});

test("the Project File follow-up always re-dispatches through the unchanged capability for a fresh read - the resolver itself never returns a status/client fact", () => {
  const fnStart = orchestratorSource.indexOf("function resolveProjectFollowUp");
  const fnEnd = orchestratorSource.indexOf("\n// C4B/ERP-NOA-2: builds a bounded Project conversationReference", fnStart);
  const fnBody = orchestratorSource.slice(fnStart, fnEnd);
  assert.ok(!/\bstatus\b|\bclient\b/i.test(fnBody.replace(/\/\/.*$/gm, "")));
});

// ── Test 12: explicit standalone Project Record behavior preserved ─────────────

test("12. CLIENT_PROJECT_RECORD_PATTERN still routes explicit 'project record(s)' wording to the unchanged clientProjectsAnswer/standalone projects table", () => {
  assert.match(clientSource, /const CLIENT_PROJECT_RECORD_PATTERN = \/\\bproject records\?\\b\/i;/);
  const fnStart = clientSource.indexOf("async function clientProjectsAnswer");
  const fnEnd = clientSource.indexOf("\ntype ClientProjectFileStatus", fnStart);
  const fnBody = clientSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('.from("projects")'));
  assert.ok(fnBody.includes('.eq("client_id", client.id)'));
});

// ── Tests 13-14: Quotation/Procurement regression ───────────────────────────────

test("13. Quotation capability file was not touched by this phase", () => {
  assert.ok(!quotationSource.includes("ERP-NOA-2"));
});

test("14. Procurement capability file was not touched at all", () => {
  assert.ok(!procurementSource.includes("ERP-NOA-2"));
  assert.ok(!procurementSource.includes("semanticRequest"));
  assert.ok(!procurementSource.includes("conversationReference"));
});

// ── Test 15: Project generic ERP behavior (ERP-NOA-1) unchanged ────────────────

test("15. noa-project-capability.server.ts was not touched by this phase", () => {
  const projectSource = readFileSync("lib/noa/noa-project-capability.server.ts", "utf8");
  assert.ok(!projectSource.includes("ERP-NOA-2"));
});

// ── Test 16: no schema/RLS/auth change ──────────────────────────────────────────

test("16. Client auth (requireActiveUser) remains the sole, unconditional gate; no mutation/DDL calls were introduced", () => {
  assert.ok(clientSource.includes("await requireActiveUser();"));
  const mutationPattern = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|ALTER TABLE|CREATE TABLE/i;
  assert.ok(!mutationPattern.test(clientSource));
  assert.ok(!mutationPattern.test(orchestratorSource.slice(orchestratorSource.indexOf("function resolveProjectFollowUp"))));
});

// ── Cost/token control (unchanged, still checked for safety) ───────────────────

test("still exactly one extractor invocation per request", () => {
  const count = (orchestratorSource.match(/extractNoaSemanticRequest\(/g) ?? []).length;
  assert.equal(count, 1);
});
