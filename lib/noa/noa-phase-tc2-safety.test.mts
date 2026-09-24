import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const project = readFileSync("lib/noa/noa-project-capability.server.ts", "utf8");

test("TC-2 routes strict CO identifiers directly to Project without semantic extraction", () => {
  assert.ok(project.includes('const PROJECT_FILE_IDENTIFIER_PATTERN = /\\bCO-\\d{3,}(?:-\\d+)*\\b/gi;'));
  assert.ok(orchestrator.includes("const projectFileIdentifierTotal = projectFileIdentifierCount(request.message);"));
  assert.ok(orchestrator.includes('projectFileIdentifierTotal > 0\n        ? "Project"'));
  assert.equal((orchestrator.match(/extractNoaSemanticRequest\(/g) ?? []).length, 1);
});

test("TC-2 uses a single CO as the existing Project File detail target for detail, status, client, and total wording", () => {
  assert.ok(project.includes("if (identifiers.length === 1) return identifiers[0];"));
  assert.ok(project.includes("projectFileIdentifierCount(message) > 0"));
  assert.ok(project.includes('kind: "project_file_detail"'));
  assert.ok(project.includes("projectFile: safeProjectFileRow(match)"));
});

test("TC-2 leaves multi-CO requests raw and keeps them on the ERP Project File source", () => {
  assert.ok(project.includes("if (identifiers.length === 1) return identifiers[0];"));
  assert.ok(project.includes("if (!target) return { message: \"Please specify the Project File number or reference.\""));
  assert.ok(project.includes("projectFileFromLayoutSettings(quotation.layout_settings) ??"));
  assert.ok(project.includes("clientApprovalDraftFromLayoutSettings(quotation.layout_settings)?.confirmedOrder"));
  assert.ok(project.includes("PROJECT_RECORD_PATTERN.test(message) && projectFileIdentifierCount(message) === 0"));
});

test("TC-2 preserves QN routing and Project authorization", () => {
  assert.ok(orchestrator.includes('quotationIdentifierTotal > 0\n      ? "Quotation"'));
  assert.ok(project.includes("await requireActiveUser();"));
});
