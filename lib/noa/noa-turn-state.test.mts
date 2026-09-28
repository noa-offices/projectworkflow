import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { applyNoaConversationTurnState, noaRecentMessages, NOA_GREETING_TEXT } from "./noa-turn-state";
import { installNoaGoldenFixtures, createNoaGoldenSession } from "./testing/noa-golden-harness";
import type { NoaAnswer, NoaChatRequest } from "./noa-types";
installNoaGoldenFixtures(mock);
const { runNoaOrchestrator } = await import("./noa-orchestrator");
const reference = { domain: "Project" as const, entities: [{ type: "project_file" as const, label: "CO-0003-001" }], intent: "lookup" };
const configuration = { templateId: "fixture-template", mode: "configuring" as const, selections: {} };
const previous = { conversationReference: reference, productConfigurationReference: configuration };
const plain: NoaAnswer = { domain: "Help", sources: [], text: "fixture" };

test("client parity: success replaces references wholesale; missing fields clear; errors preserve", () => {
  const replacement = { ...reference, entities: [{ type: "project_file" as const, label: "CO-0004-001" }] };
  assert.deepEqual(applyNoaConversationTurnState(previous, { ...plain, conversationReference: replacement }), { conversationReference: replacement, productConfigurationReference: undefined });
  assert.deepEqual(applyNoaConversationTurnState(previous, plain), { conversationReference: undefined, productConfigurationReference: undefined });
  assert.equal(applyNoaConversationTurnState(previous), previous);
  assert.equal(applyNoaConversationTurnState(previous, { ...plain, productConfigurationReference: configuration }).productConfigurationReference, configuration);
});

test("client parity: prior six messages preserve order and discard UI metadata", () => {
  const messages = Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? "user" as const : "assistant" as const, text: String(i), id: String(i) }));
  assert.deepEqual(noaRecentMessages(messages), messages.slice(3).map(({ role, text }) => ({ role, text })));
});

test("harness includes greeting, errors and prior turns; current user is excluded from request history", async () => {
  const requests: NoaChatRequest[] = [];
  const session = createNoaGoldenSession({ initialState: previous, execute: async (request, collect) => {
    requests.push(request);
    if (request.message === "fail") {
      await runNoaOrchestrator({ ...request, message: "Hello" }, collect);
      throw new Error("fixture failure");
    }
    return runNoaOrchestrator(request, collect);
  } });
  await session.send("fail");
  assert.deepEqual(session.snapshot().conversationReference, reference);
  assert.deepEqual(session.snapshot().productConfigurationReference, configuration);
  await session.send("Hello");
  assert.deepEqual(requests[0].recentMessages, [{ role: "assistant", text: NOA_GREETING_TEXT }]);
  assert.deepEqual(requests[1].recentMessages?.slice(-2), [{ role: "user", text: "fail" }, { role: "assistant", text: "fixture failure" }]);
  assert.equal(requests[1].conversationReference, reference);
  await session.send("Hello"); await session.send("Hello"); await session.send("Hello");
  assert.equal(requests.at(-1)?.recentMessages?.length, 6);
  assert.equal(requests.at(-1)?.recentMessages?.[0].role, "user");
});

test("server owns configuration passthrough, while explicit cancellation clears it", async () => {
  const request = { context: { pathname: "/dashboard", section: "dashboard" as const }, productConfigurationReference: configuration };
  const unrelated = await runNoaOrchestrator({ ...request, message: "List the projects." });
  assert.deepEqual(unrelated.productConfigurationReference, configuration);
  const cancelled = await runNoaOrchestrator({ ...request, message: "cancel configuration" });
  assert.equal(cancelled.productConfigurationReference, undefined);
});

test("diagnostic collector is isolated, optional, metadata-only and cannot alter answers", async () => {
  const request = { context: { pathname: "/dashboard", section: "dashboard" as const }, message: "Tell me about CO-0003-001" };
  const plain = await runNoaOrchestrator(request);
  assert.deepEqual(await runNoaOrchestrator(request, () => { throw new Error("collector failure"); }), plain);
  const results = await Promise.all([createNoaGoldenSession().send(request.message), createNoaGoldenSession().send("Hello")]);
  assert.equal(results[0].trace.scopeSource, "explicit_identifier");
  assert.equal(results[1].trace.scopeSource, "none");
  assert.equal(results[1].trace.routeDecision, "social");
  assert.equal(results[1].trace.capabilitySelected, null);
  for (const { trace } of results) {
    assert.deepEqual(Object.keys(trace).sort(), ["turnId", "routeDecision", "semanticUsed", "referenceAvailable", "referenceDomain", "referenceBindingKind", "scopeSource", "capabilitySelected", "resultCount", "clarifyReason", "errorCode", "durationMs",
      "sessionMode", "shadowResultKind", "shadowResultEntityType", "shadowSave",
      "plannerMode", "plannerAction", "plannerSourceType", "plannerValidation", "plannerExecution",
      "referenceBinding", "resultSetRecency", "ordinalResolution"].sort());
    assert.doesNotMatch(JSON.stringify(trace), /CO-0003|fixture|Tell me|ready to help/);
    assert.ok(trace.durationMs >= 0);
  }
  const failed = await createNoaGoldenSession().send("List products.");
  assert.equal(failed.answer, null);
  assert.equal(failed.trace.errorCode, "turn_failed");
});
