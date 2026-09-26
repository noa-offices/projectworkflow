/* eslint-disable @typescript-eslint/no-explicit-any -- Runtime harness for server-only modules without provider or database access. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const cache = new Map<string, any>();
function compile(path: string): any {
  if (cache.has(path)) return cache.get(path);
  const compiled = { exports: {} as any };
  const output = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", output)((id: string) => {
    if (id === "server-only") return {};
    if (id.startsWith("./")) return compile(`lib/noa/${id.slice(2).replace(/\.js$/, "")}.ts`);
    return require(id);
  }, compiled, compiled.exports);
  cache.set(path, compiled.exports); return compiled.exports;
}
const { buildNoaPreviousFinding: build, resolveNoaFindingFollowUp: follow, withoutNoaPreviousFinding: clear } = compile("lib/noa/noa-finding-reference.server.ts");
const { sanitizeNoaConversationReference: sanitize, detectNoaFindingFollowUp: detect } = compile("lib/noa/noa-conversation-reference.ts");
const { classifyNoaRoute } = compile("lib/noa/noa-intent-router.ts");
const { withNoaSpokenResponse } = compile("lib/noa/noa-spoken-response.ts");
const now = 1_000_000;
const data = { kind: "price_summary", entityLabel: "Interstuhl chair", counts: [{ statusKey: "no_price_list_date", count: 2 }], scanCapped: false, scannedCount: 2, totalMatching: 2 };
const reference = () => ({ domain: "Price", intent: "price_finding", previousFinding: build(data, now) });

test("only complete, homogeneous authorized structured status creates a bounded finding", () => {
  const finding = build({ ...data, deterministicText: "Do not store this prose", rows: [{ secret: "raw" }] }, now);
  assert.equal(finding.findingKind, "no_price_list_date"); assert.equal(finding.entityLabel, "Interstuhl chair");
  assert.deepEqual(finding.allowedFollowUps, ["explain", "guidance", "confirm"]);
  assert.ok(JSON.stringify(finding).length < 450); assert.doesNotMatch(JSON.stringify(finding), /prose|rows|secret|raw/);
  for (const invalid of [null, { deterministicText: "Interstuhl has no price list date" }, { ...data, scanCapped: true }, { ...data, totalMatching: 3 },
    { ...data, counts: [{ statusKey: "current", count: 2 }] }, { ...data, counts: [{ statusKey: "no_price_list_date", count: 1 }, { statusKey: "due", count: 1 }] },
    { ...data, entityLabel: "x".repeat(121) }, { ...data, entityLabel: "43b1c104-1234-4321-1234-123456789012" }]) assert.equal(build(invalid, now), undefined);
  assert.ok(build({ name: "EVERY", brand: "Interstuhl", statusKey: "no_price_list_date" }, now));
  assert.ok(build({ kind: "price_list", entityLabel: "Interstuhl chair", rows: [{ statusKey: "no_price_list_date" }], scanCapped: false, truncatedCount: 0, totalMatching: 1 }, now));
});

test("signature prevents client-authored findings; closed sanitizer strips unknown metadata", () => {
  const r = reference();
  const clean = sanitize({ ...r, previousFinding: { ...r.previousFinding, raw: "secret" } });
  assert.equal(clean.previousFinding.raw, undefined);
  for (const change of [{ entityLabel: "Forged label" }, { proof: "0".repeat(64) }, { issuedAt: now + 1 }]) {
    assert.equal(follow("Why is that?", { ...r, previousFinding: { ...r.previousFinding, ...change } }, now).domain, "Help");
  }
  assert.equal(follow("Why is that?", r, now + 900_001).domain, "Help");
  assert.equal(sanitize({ ...r, previousFinding: { ...r.previousFinding, allowedFollowUps: ["write"] } }), undefined);
});

test("Interstuhl C-D-E-F chain explains, guides, preserves context and refuses mutation", () => {
  let r = reference();
  for (const message of ["I think you need to configure that.", "Why is that?", "How do I fix that?", "Configure that for me."]) {
    const answer = withNoaSpokenResponse(follow(message, r, now));
    assert.equal(answer.domain, "Price"); assert.match(answer.text, /Interstuhl chair/);
    assert.match(answer.text, /previous price-status result/); assert.match(answer.text, /no brand price-list date/);
    assert.ok(answer.voiceText); assert.ok(answer.voiceText.length <= 600); r = answer.conversationReference;
    if (message.startsWith("How")) assert.match(answer.text, /Product Library.*Price list updates.*Add update/);
    if (message.startsWith("Configure")) assert.match(answer.text, /can't change that setting/);
  }
  assert.equal(follow("How do I fix that?", undefined, now).domain, "Help");
  assert.equal(follow("Show projects", r, now), undefined);
});

test("closed cues do not hijack fresh product lookups or entity/ordinal/analytics follow-ups", () => {
  for (const message of ["what about that", "why is that", "how do I fix that", "how can I fix that", "what should I do about that", "can you explain that", "I think you need to configure that", "does that need to be configured", "can that be configured"]) assert.ok(detect(message));
  for (const message of ["What changed on it?", "Which client is second?", "What about last month?", "Configure EVERY", "What about that quotation QN-0001-001?", "How do I fix that other product?"]) assert.equal(detect(message), undefined);
  assert.equal(detect("Can you configure that for me?"), "action");
  assert.equal(classifyNoaRoute("Hello NOA, how are you?", { pathname: "", section: "other" }), "greeting");
  assert.equal(classifyNoaRoute("Hey NOA, what needs my attention?", { pathname: "", section: "other" }), "Attention");
  assert.equal(classifyNoaRoute("Can you find me price for every chair from Interstuhl?", { pathname: "", section: "other" }), "Price");
});

test("actual public orchestrator handles finding chain before any capability, provider, or configuration engine", async () => {
  const source = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
  const ast = ts.createSourceFile("orchestrator.ts", source, ts.ScriptTarget.Latest, true);
  const node = ast.statements.find((entry) => ts.isFunctionDeclaration(entry) && entry.name?.text === "runNoaOrchestrator");
  assert.ok(node);
  const output = ts.transpileModule(node.getText(ast).replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const execute = new Function("resolveNoaFindingFollowUp", "withNoaSpokenResponse", "isNoaProductConfigurationReference", "maybeHandleProductConfigurationTurn", "tryNoaAgentBrief", "runNoaOrchestratorCore", `${output}; return runNoaOrchestrator;`)(
    (message: string, r: unknown) => follow(message, r, now), withNoaSpokenResponse, (value: unknown) => value !== undefined,
    () => assert.fail("No configuration engine"), () => assert.fail("No agent"), () => assert.fail("No fresh capability/provider read"));
  const config = { mode: "configuring", templateId: "existing-configuration" };
  let r = reference();
  for (const message of ["I think you need to configure that.", "How do I fix that?", "Configure that for me."]) {
    const answer = await execute({ message, conversationReference: r, productConfigurationReference: config });
    assert.match(answer.voiceText, /Interstuhl chair/); assert.equal(answer.productConfigurationReference, config);
    r = answer.conversationReference;
  }
});

test("fresh results clear finding only while existing I5 entity/metric context survives", () => {
  const r = { domain: "Price", intent: "price_lookup", entities: [{ type: "product", label: "EVERY" }], previousFinding: reference().previousFinding };
  assert.deepEqual(clear(r), { domain: "Price", intent: "price_lookup", entities: r.entities });
  assert.equal(clear(reference()), undefined);
  const i5 = { domain: "Insights", intent: "analytics", metric: "quotation_count", analyticsPeriod: "this_month" };
  assert.equal(clear(i5), i5);
});

test("integration is before configuration/agents, after authorized Price result, and read-only", () => {
  const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
  const wrapper = orchestrator.slice(orchestrator.indexOf("export async function runNoaOrchestrator("));
  assert.ok(wrapper.indexOf("resolveNoaFindingFollowUp") < wrapper.indexOf("maybeHandleProductConfigurationTurn"));
  assert.match(wrapper, /withNoaSpokenResponse\(findingAnswer\)/);
  assert.ok(orchestrator.indexOf("buildNoaPreviousFinding(capabilityResult.data)") > orchestrator.indexOf("if (!capabilityResult.ok)"));
  assert.match(orchestrator, /domain === "Price" \? buildNoaPreviousFinding/);
  const helper = readFileSync("lib/noa/noa-finding-reference.server.ts", "utf8");
  assert.doesNotMatch(helper, /supabase|fetch\(|\.insert\(|\.delete\(|\.upsert\(|runNoaProvider|deterministicText/);
  const ui = readFileSync("app/products/templates/page.tsx", "utf8");
  for (const label of ["Price list updates", "Add update", "BrandPriceListUpdateForm"]) assert.ok(ui.includes(label));
});
