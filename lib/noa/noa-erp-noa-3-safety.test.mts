import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-client-capability.server.ts and noa-quotation-capability.server.ts both have "server-only"
// + "@/..." aliases, neither resolvable by Node's plain ESM resolver outside the Next.js build.
// Source-level wiring/safety checks, same convention as every other lib/noa/*-safety.test.mts
// file.

const clientSource = readFileSync("lib/noa/noa-client-capability.server.ts", "utf8");
const quotationSource = readFileSync("lib/noa/noa-quotation-capability.server.ts", "utf8");

// ── Tests 1-2: Client detail project count uses ERP Project Files ──────────────

test("1-2. clientDetailAnswer's inline project count reads clientProjectFiles(...).length - the same bounded ERP source, never a standalone projects.client_id count", () => {
  const fnStart = clientSource.indexOf("async function clientDetailAnswer");
  const fnEnd = clientSource.indexOf("\n// PART 6: Client-specific bounded read", fnStart);
  const fnBody = clientSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes("clientProjectFiles(supabase, client.id)"));
  assert.ok(fnBody.includes("const projects = projectFiles.length;"));
  assert.ok(!fnBody.includes('.from("projects")'));
});

// ── Test 3: quotation count unchanged ────────────────────────────────────────────

test("3. quotation count query inside clientDetailAnswer is untouched", () => {
  const fnStart = clientSource.indexOf("async function clientDetailAnswer");
  const fnEnd = clientSource.indexOf("\n// PART 6: Client-specific bounded read", fnStart);
  const fnBody = clientSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('supabase.from("quotations").select("id", { count: "exact", head: true }).eq("client_id", client.id)'));
});

// ── Test 4: explicit Project Record paths unchanged ─────────────────────────────

test("4. clientProjectsAnswer (the explicit 'project record(s)' path) still queries the standalone projects table by client_id, byte-for-byte unchanged", () => {
  const fnStart = clientSource.indexOf("async function clientProjectsAnswer");
  const fnEnd = clientSource.indexOf("\ntype ClientProjectFileStatus", fnStart);
  const fnBody = clientSource.slice(fnStart, fnEnd);
  assert.ok(fnBody.includes('.from("projects")'));
  assert.ok(fnBody.includes('.eq("client_id", client.id)'));
  assert.ok(clientSource.includes("const CLIENT_PROJECT_RECORD_PATTERN = /\\bproject records?\\b/i;"));
});

test("only one bounded ERP Project File scan implementation exists - clientProjectFilesAnswer and clientDetailAnswer both call the same clientProjectFiles() helper, no duplicated query", () => {
  const scanCallSites = (clientSource.match(/clientProjectFiles\(supabase, client\.id\)/g) ?? []).length;
  assert.equal(scanCallSites, 2, "clientDetailAnswer + clientProjectFilesAnswer, exactly");
  const limitDeclarations = (clientSource.match(/\.limit\(CLIENT_PROJECT_FILE_SCAN_LIMIT\)/g) ?? []).length;
  assert.equal(limitDeclarations, 1, "the bounded scan itself must only be written once");
});

// ── Tests 5-9: Quotation list reference fallback chain ──────────────────────────

test("5-9. the list path's `project` field is computed via quotationDisplayReference() - the exact same fallback chain (Project File reference -> legacy_reference -> title -> standalone Project name -> quotation_no) as the single-quotation detail answer, never a second implementation", () => {
  const fnStart = quotationSource.indexOf("function quotationDisplayReference");
  const fnEnd = quotationSource.indexOf("\nasync function buildQuotationAnswer", fnStart);
  const fnBody = quotationSource.slice(fnStart, fnEnd);
  const projectFileIndex = fnBody.indexOf("projectFileReference");
  const legacyIndex = fnBody.indexOf("quotation.legacy_reference");
  const titleIndex = fnBody.indexOf("quotation.title");
  const projectNameIndex = fnBody.lastIndexOf("projectName");
  const quotationNoIndex = fnBody.lastIndexOf("quotation.quotation_no");
  assert.ok(projectFileIndex >= 0 && projectFileIndex < legacyIndex);
  assert.ok(legacyIndex < titleIndex);
  assert.ok(titleIndex < projectNameIndex);
  assert.ok(projectNameIndex < quotationNoIndex);

  // Only ONE definition of quotationDisplayReference exists (used by both detail and list paths).
  const definitionCount = (quotationSource.match(/function quotationDisplayReference\(/g) ?? []).length;
  assert.equal(definitionCount, 1);
  const listUsage = quotationSource.indexOf("project: quotationDisplayReference(quotation, projectName) || null,");
  assert.ok(listUsage >= 0);
});

test("QUOTATION_STATUS_SELECT now includes title/legacy_reference/layout_settings so the list path can compute the fallback chain", () => {
  assert.ok(quotationSource.includes('const QUOTATION_STATUS_SELECT = "id,quotation_no,title,status,created_at,client_id,project_id,legacy_reference,layout_settings";'));
});

test("no raw layout_settings is ever included in a list row - only the derived project/reference string", () => {
  const fnStart = quotationSource.indexOf('if (questionKind === "list")');
  const fnEnd = quotationSource.indexOf("const totalMatching = matching.length;", fnStart);
  const fnBody = quotationSource.slice(fnStart, fnEnd);
  assert.ok(!/layoutSettings|layout_settings:/i.test(fnBody));
});

// ── Test 10: quotation_no/status/total behavior unchanged ──────────────────────

test("10. quotation_no resolution, status classification, and total/comparison logic are untouched", () => {
  assert.ok(quotationSource.includes('function extractQuotationIdentifier(message: string): string | null {\n  const match = message.match(/[A-Za-z]{0,4}-?\\d{3,}(?:-\\d+)*/);\n  return match ? match[0] : null;\n}'));
  assert.ok(quotationSource.includes("quotationStatusDisplayLabel"));
  assert.ok(quotationSource.includes('kind: "quotation_comparison"'));
  // The list row's quotationNo/status/createdAt fields are untouched - only `project` changed.
  assert.ok(quotationSource.includes("quotationNo: quotation.quotation_no,\n        status: quotation.status,"));
});

// ── Test 11: no schema/auth/RLS change ──────────────────────────────────────────

test("11. Client auth (requireActiveUser) and Quotation auth (requireQuotationActionUser) remain the sole, unconditional gates; no mutation/DDL calls introduced", () => {
  assert.ok(clientSource.includes("await requireActiveUser();"));
  assert.ok(quotationSource.includes("await requireQuotationActionUser();"));
  const mutationPattern = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(|ALTER TABLE|CREATE TABLE/i;
  assert.ok(!mutationPattern.test(clientSource));
  assert.ok(!mutationPattern.test(quotationSource));
});

// ── Regression: no other file touched ───────────────────────────────────────────

test("regression: Project/Procurement/orchestrator files were not touched by this phase", () => {
  const projectSource = readFileSync("lib/noa/noa-project-capability.server.ts", "utf8");
  const procurementSource = readFileSync("lib/noa/noa-procurement-capability.server.ts", "utf8");
  const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
  const projectFileHelperSource = readFileSync("lib/quotations/project-file.ts", "utf8");
  assert.ok(!projectSource.includes("ERP-NOA-3"));
  assert.ok(!procurementSource.includes("ERP-NOA-3"));
  assert.ok(!orchestratorSource.includes("ERP-NOA-3"));
  assert.ok(!projectFileHelperSource.includes("ERP-NOA-3"));
});
