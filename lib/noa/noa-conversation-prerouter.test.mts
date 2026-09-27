/* eslint-disable @typescript-eslint/no-explicit-any -- Execute the actual public orchestrator with isolated dependency spies. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { classifyNoaRouteWithStrength } from "./noa-intent-router.js";

function compile(path: string) {
  const compiled = { exports: {} as any };
  const output = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("module", "exports", output)(compiled, compiled.exports);
  return compiled.exports;
}
const { prerouteNoaConversation: route, normalizeNoaBusinessParaphrase: paraphrase } = compile("lib/noa/noa-conversation-prerouter.ts");
const { sanitizeNoaConversationReference } = compile("lib/noa/noa-conversation-reference.ts");
const { withNoaSpokenResponse } = compile("lib/noa/noa-spoken-response.ts");
const cases: Array<[string, string]> = [
  ["Hello", "greeting"], ["Hello there.", "greeting"], ["Bonjour.", "greeting"], ["Hi", "greeting"], ["Hey NOA", "greeting"], ["Good morning", "greeting"],
  ["Who are you?", "assistant_identity"], ["What are you?", "assistant_identity"], ["Tell me about yourself.", "assistant_identity"], ["What can you do?", "assistant_identity"], ["Who is NOA?", "assistant_identity"],
  ["OK", "acknowledgement"], ["OK, OK.", "acknowledgement"], ["Alright", "acknowledgement"], ["Got it", "acknowledgement"], ["Well...", "acknowledgement"], ["Hmm", "acknowledgement"],
  ["Thanks", "thanks"], ["Thank you.", "thanks"], ["How are you?", "social"], ["How's it going?", "social"], ["Nice to hear from you", "social"], ["Hello NOA, how are you?", "social"],
  ["...?!", "unclear"], ["uh um uh", "unclear"],
];
for (const [message, kind] of cases) test(`${message} -> ${kind}`, () => {
  const result = route(message); assert.equal(result.kind, kind); assert.ok(result.reply.length < 250);
});

const business = ["What needs my attention?", "What is today's activity?", "Hi NOA, what needs my attention?", "Hello there, list quotations", "Tell me about CO-0003-001", "What changed on QN-0005-001?", "Interstuhl chair price", "quotation analytics this month", "Give me a complete update on CO-0003-001", "Procurement ETA missing", "How do I fix that?", "I think you need to configure that.", "What about last month?", "Which client is second?", "I spoke to Noah yesterday", "EXQUITECH RFQ ETA/ETD?", "OK show my projects"];
test("business and uncertain language pass through without returned rewrites", () => {
  for (const message of business) assert.deepEqual(route(message), { kind: "business_passthrough" });
});

function orchestrator(spies: Record<string, any> = {}) {
  const source = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
  const ast = ts.createSourceFile("orchestrator.ts", source, ts.ScriptTarget.Latest, true);
  const entry = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === "runNoaOrchestrator")!;
  const output = ts.transpileModule(entry.getText(ast).replace("export ", ""), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const dependencies = { prerouteNoaConversation: route, normalizeNoaBusinessParaphrase: paraphrase, classifyNoaRouteWithStrength, sanitizeNoaConversationReference, withNoaSpokenResponse,
    isNoaProductConfigurationReference: (v: unknown) => v !== undefined,
    resolveNoaFindingFollowUp: () => assert.fail("No finding resolver for social turns"),
    maybeHandleProductConfigurationTurn: () => assert.fail("No configuration engine"),
    tryNoaAgentBrief: () => assert.fail("No agent"), runNoaOrchestratorCore: () => assert.fail("No capability/provider"),
    isNoaIdentifierLabel: () => true, executeNoaAgentPlan: () => assert.fail("No agent execution"), ...spies };
  return new Function(...Object.keys(dependencies), `${output}; return runNoaOrchestrator;`)(...Object.values(dependencies));
}

test("all social turns short-circuit public orchestrator and keep valid references without creating any", async () => {
  const run = orchestrator();
  const reference = { domain: "Project", intent: "project_lookup", entities: [{ type: "project_file", label: "CO-0003-001" }] };
  const config = { mode: "configuring" };
  for (const [message] of cases) {
    const answer = await run({ message, conversationReference: reference, productConfigurationReference: config });
    assert.equal(answer.domain, "Help"); assert.deepEqual(answer.conversationReference, reference); assert.equal(answer.productConfigurationReference, config);
    assert.ok(answer.voiceText); assert.deepEqual(answer.sources, []);
  }
  assert.equal((await run({ message: "Thanks" })).conversationReference, undefined);
});

const page = { pathname: "/dashboard", section: "dashboard" as const };
const natural = (message: string) => {
  const classification = classifyNoaRouteWithStrength(message, page);
  return paraphrase(message, classification.strength === "exact" || classification.strength === "anchored");
};
const groups: Array<[string[], string]> = [
  [["What's today's status?", "What is today's status?", "Give me today's status.", "How are things today?", "What's going on today?", "What's happening today?", "Give me an update for today.", "Anything I should know today?"], "clarify"],
  [["Anything important today?", "Anything I need to deal with?", "What do I need to deal with?", "What should I look at today?", "Is there anything I should check?", "Anything urgent?", "What needs checking?"], "Attention"],
  [["What's changed today?", "What happened today?", "What's been happening today?", "Any updates today?", "Catch me up on today.", "What's going on with updates today?"], "UserActivity"],
  [["What did I do today?", "What have I worked on today?", "What was my activity today?", "Show my activity today.", "What have I done today?"], "UserActivity"],
  [["How are our projects doing?", "What's the status of our projects?", "Any quotations I should check?", "What's happening with quotations?", "Are there quotations waiting?", "Any quotation updates?", "Who's our biggest client?", "Which customer gives us the most business?", "Any procurement issues?", "What's happening with procurement?", "Anything missing in procurement?"], "clarify"],
  [["Which projects are active?", "Show active projects."], "Project"],
  [["Show me pending quotations."], "Quotation"],
  [["What procurement orders are active?"], "Procurement"],
];
for (const [messages, expected] of groups) for (const message of messages) test(`CFI2.2 ${message} -> ${expected}`, () => {
  const result = natural(message);
  if (expected === "clarify") {
    assert.equal(result.kind, "clarify"); assert.ok(result.choices.length > 0 && result.choices.length <= 4);
    assert.deepEqual(result, natural(message));
    for (const choice of result.choices) assert.ok(choice.label && choice.value);
  } else {
    assert.notEqual(result.kind, "clarify");
    assert.equal(classifyNoaRouteWithStrength(result.kind === "canonical" ? result.message : message, page).route, expected);
  }
});

test("CFI2.2 protected and scoped requests remain byte-for-byte passthrough", () => {
  for (const message of ["Tell me about CO-0003-001", "Show QN-0005-001", "PO-0001 details", "show Interstuhl EVERY", "EVERY price", "quotation analytics", "what changed today", "what needs my attention", "What needs my attention today?", "Give me a complete update on CO-0003-001", "I think you need to configure that", "How do I fix that?", "Who is our best client based on quotation?", "Who do we quote the most?", "Which client has the most confirmed business?", "top clients by quotation value", "Which projects are finished?", "procurement orders missing ETA", "Any procurement issues missing ETD?", "What should I look at today for CO-0003-001?", "Admin permissions", "Hello there.", "Thanks"]) {
    assert.deepEqual(natural(message), { kind: "passthrough" }, message);
  }
});

test("CFI2.2 changes preserve Catch-Up while personal work stays UserActivity", () => {
  for (const message of ["What happened today?", "Any updates today?", "What's changed today?"]) {
    const result = natural(message);
    assert.equal(classifyNoaRouteWithStrength(result.kind === "canonical" ? result.message : message, page).rule, "catch_up");
  }
  for (const message of ["What did I do today?", "What have I worked on today?"]) {
    const result = natural(message);
    const classification = classifyNoaRouteWithStrength(result.kind === "canonical" ? result.message : message, page);
    assert.equal(classification.route, "UserActivity");
    assert.notEqual(classification.rule, "catch_up");
  }
});

test("CFI2.2 actual shared orchestrator clarifies without capability calls and only rewrites interpretation", async () => {
  const seen: any[] = [];
  const run = orchestrator({ resolveNoaFindingFollowUp: () => undefined, maybeHandleProductConfigurationTurn: () => null,
    tryNoaAgentBrief: () => null, runNoaOrchestratorCore: (r: any) => { seen.push(r); return { domain: "Help", text: "Existing result" }; } });
  const reference = { domain: "Project", intent: "project_lookup", entities: [{ type: "project_file", label: "CO-0003-001" }] };
  const answer = await run({ message: "What's today's status?", context: page, conversationReference: reference });
  assert.equal(answer.choices.length, 4); assert.ok(answer.voiceText); assert.equal(seen.length, 0);
  // CFI2.5b: the daily-status clarify now creates its OWN fresh reference (so a following typed/
  // spoken chip label can be resolved) instead of preserving whatever reference came in.
  assert.deepEqual(answer.conversationReference, { domain: "Help", intent: "daily_status_clarification" });
  const original = { message: "Anything important today?", context: page, conversationReference: reference };
  await run(original);
  assert.equal(original.message, "Anything important today?"); assert.equal(seen[0].message, "what needs my attention"); assert.equal(seen[0].conversationReference, reference);
  for (const choice of answer.choices) {
    const next = natural(choice.value);
    assert.ok(next.kind === "clarify" || classifyNoaRouteWithStrength(next.kind === "canonical" ? next.message : choice.value, page).route !== "Help");
  }
});

test("CFI2.5b: typing/speaking a daily-status chip label reaches the exact same route as clicking it, only right after that clarification", async () => {
  const seen: any[] = [];
  const run = orchestrator({ resolveNoaFindingFollowUp: () => undefined, maybeHandleProductConfigurationTurn: () => null,
    tryNoaAgentBrief: () => null, runNoaOrchestratorCore: (r: any) => { seen.push(r); return { domain: "Help", text: "Existing result" }; } });
  const dailyStatusReference = { domain: "Help", intent: "daily_status_clarification" };
  // Expected route is whatever clicking the SAME chip already reaches - "My activity today." is
  // already anchored to UserActivity by the existing classifier before paraphrase even runs (the
  // exact "caller protects stronger routes" rule CFI2.2 already established), so it correctly
  // reaches UserActivity even though this specific rewrite never fires for it.
  const mappings: Array<[string, string]> = [
    ["Attention items.", "Attention"],
    ["Changes today.", "UserActivity"],
    ["My activity today.", "UserActivity"],
    ["Project status.", "Project"],
    ["Changes.", "UserActivity"],
  ];
  for (const [typed, expectedRoute] of mappings) {
    seen.length = 0;
    const answer = await run({ message: typed, context: page, conversationReference: dailyStatusReference });
    assert.equal(seen.length, 1, typed);
    assert.equal(classifyNoaRouteWithStrength(seen[0].message, page).route, expectedRoute, typed);
    assert.equal(answer.text, "Existing result", typed);
  }
});

test("CFI2.5b: the same bare option words never invent daily-status routing without that exact preceding clarification", async () => {
  const seen: any[] = [];
  const run = orchestrator({ resolveNoaFindingFollowUp: () => undefined, maybeHandleProductConfigurationTurn: () => null,
    tryNoaAgentBrief: () => null, runNoaOrchestratorCore: (r: any) => { seen.push(r); return { domain: "Help", text: "Existing result" }; } });
  for (const message of ["Changes.", "My activity."]) {
    seen.length = 0;
    await run({ message, context: page });
    // "Changes." alone stays exactly what it is - never rewritten to "what changed today".
    assert.ok(seen.length === 0 || seen[0].message === message, message);
  }
  // A stale, unrelated reference (e.g. still-active Project lookup) must not be mistaken for the
  // daily-status marker either - only the exact domain+intent pair gates this.
  seen.length = 0;
  await run({ message: "Changes.", context: page, conversationReference: { domain: "Project", intent: "project_lookup" } });
  assert.ok(seen.length === 0 || seen[0].message === "Changes.");
});

test("business reaches existing routing with the exact original request; Agent Brief can still own the turn", async () => {
  const seen: any[] = [];
  const run = orchestrator({ resolveNoaFindingFollowUp: () => undefined, maybeHandleProductConfigurationTurn: () => null,
    tryNoaAgentBrief: (r: any) => r.message.startsWith("Give me a complete") ? { domain: "Project", text: "Agent brief result" } : null,
    runNoaOrchestratorCore: (r: any) => { seen.push(r); return { domain: "Help", text: "Existing answer" }; } });
  for (const message of business.filter((text) => !text.startsWith("Give me a complete"))) {
    const request = { message, context: { section: "other" } }; await run(request); assert.equal(seen.at(-1), request); assert.equal(seen.at(-1).message, message);
  }
  assert.equal((await run({ message: "Give me a complete update on CO-0003-001" })).text, "Agent brief result");
});
