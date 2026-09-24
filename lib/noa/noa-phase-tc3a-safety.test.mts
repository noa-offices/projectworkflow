import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const semantic = readFileSync("lib/noa/noa-semantic-request.ts", "utf8");
const extractor = readFileSync("lib/noa/noa-intent-extractor.server.ts", "utf8");
const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const project = readFileSync("lib/noa/noa-project-capability.server.ts", "utf8");
const client = readFileSync("lib/noa/noa-client-capability.server.ts", "utf8");

test("TC-3A carries only bounded Project File/client candidate text through the strict schema", () => {
  assert.ok(semantic.includes('| { type: "project_file"; text: string }'));
  assert.ok(semantic.includes('| { type: "client"; text: string };'));
  assert.ok(semantic.includes('| { type: "unknown"; text: string }'));
  assert.ok(extractor.includes('type: { type: "string", enum: ["unknown", "project_file", "client"] }'));
  assert.ok(extractor.includes('text: { type: "string", maxLength: 160 }'));
  assert.ok(!extractor.includes("recentMessages"));
  assert.ok(!extractor.includes("capabilityData"));
});

test("TC-3A dispatches semantic candidates only to their matching authenticated capability", () => {
  assert.ok(orchestrator.includes('extracted.entity?.type === "project_file"'));
  assert.ok(orchestrator.includes('extracted.entity?.type === "client"'));
  assert.ok(orchestrator.includes('entity: semanticRequest?.entity?.type === "project_file" ? semanticRequest.entity : undefined'));
  assert.ok(orchestrator.includes('entity: semanticRequest?.entity?.type === "client" ? semanticRequest.entity : undefined'));
  assert.equal((orchestrator.match(/extractNoaSemanticRequest\(/g) ?? []).length, 1);
});

test("TC-3A resolves Project File candidates after auth from the existing ERP source, never standalone Project records", () => {
  const authIndex = project.indexOf("await requireActiveUser();");
  const resolveIndex = project.indexOf("projectFileEntityResult(await allProjectFiles(supabase), options.entity.text)");
  assert.ok(authIndex >= 0 && authIndex < resolveIndex);
  assert.ok(project.includes("projectFileFromLayoutSettings(quotation.layout_settings) ??"));
  assert.ok(project.includes("clientApprovalDraftFromLayoutSettings(quotation.layout_settings)?.confirmedOrder"));
  assert.ok(project.includes('I found more than one Project File matching'));
  assert.ok(project.includes("I couldn't find a matching Project File for"));
});

test("TC-3A resolves client candidates after auth with deterministic exact/ambiguous/not-found outcomes", () => {
  const authIndex = client.indexOf("await requireActiveUser();");
  const resolveIndex = client.indexOf("resolveClientEntity(supabase, options.entity.text)");
  assert.ok(authIndex >= 0 && authIndex < resolveIndex);
  assert.ok(client.includes('.ilike("company_name", `%${safeCandidate}%`)'));
  assert.ok(client.includes('I found more than one client matching'));
  assert.ok(client.includes("I couldn't find a matching client for"));
});

test("TC-3A preserves exact QN/CO routing and existing conversation-reference builders", () => {
  assert.ok(orchestrator.includes('quotationIdentifierTotal > 0'));
  assert.ok(orchestrator.includes('projectFileIdentifierTotal > 0'));
  assert.ok(orchestrator.includes("function buildProjectConversationReference"));
  assert.ok(orchestrator.includes("function buildClientConversationReference"));
});

test("TC-3A.1 resolves an unknown candidate across authorized Project Files and clients before capability dispatch", () => {
  assert.ok(orchestrator.includes('route === "Help" && extracted.entity?.type === "unknown"'));
  assert.ok(orchestrator.includes("const resolved = await resolveNoaEntityCandidate(extracted.entity.text);"));
  assert.ok(project.includes("export async function resolveNoaEntityCandidate"));
  assert.ok(project.includes('if (projectMatches.length === 1 && clientMatches.length === 0)'));
  assert.ok(project.includes('if (projectMatches.length === 0 && clientMatches.length === 1)'));
  assert.ok(project.includes('if (projectMatches.length > 0 || clientMatches.length > 0) return { domain: "ambiguous" };'));
});

test("TC-3A.1 keeps explicit domains scoped and returns deterministic cross-domain ambiguity/not-found", () => {
  assert.ok(orchestrator.includes('I found both a Project File and a Client matching'));
  assert.ok(orchestrator.includes("I couldn't find a matching Project File or client for"));
  assert.ok(orchestrator.includes('extracted.entity?.type === "project_file" || extracted.entity?.type === "unknown"'));
  assert.ok(orchestrator.includes('extracted.entity?.type === "client" || extracted.entity?.type === "unknown"'));
});
