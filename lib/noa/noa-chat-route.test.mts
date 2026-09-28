// Real Request -> POST validation/auth -> real orchestrator -> NextResponse JSON.
// Only auth/profile and capability/runtime dependencies are fixtures. No route/orchestrator mock.
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import { installNoaGoldenFixtures } from "./testing/noa-golden-harness";
installNoaGoldenFixtures(mock, { mockDatabase: false });
let authenticated = true;
mock.module("@/lib/supabase/server", { namedExports: { createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: authenticated ? { id: "fixture-user" } : null } }) },
  from: (table: string) => {
    assert.equal(table, "profiles");
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { full_name: null } }) }) }) };
  },
}) } });
const { POST } = await import("../../app/api/noa/chat/route");
const { runNoaOrchestrator } = await import("./noa-orchestrator");
const context = { pathname: "/dashboard", section: "dashboard" as const };
const configuration = { templateId: "fixture-template", mode: "configuring" as const, selections: {} };
const request = (body: unknown) => new Request("http://localhost/api/noa/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("route boundary preserves both references through serialized multi-turn answers", async () => {
  const first = await POST(request({ context, message: "Tell me about CO-0003-001", productConfigurationReference: configuration }));
  assert.equal(first.status, 200);
  const answer = await first.json();
  assert.equal(answer.conversationReference.domain, "Project");
  assert.deepEqual(answer.productConfigurationReference, configuration);
  const next = { context, message: "Hello", conversationReference: answer.conversationReference, productConfigurationReference: answer.productConfigurationReference, recentMessages: [] };
  const response = await POST(request(next));
  assert.equal(response.status, 200);
  const serialized = await response.json();
  assert.deepEqual(serialized, JSON.parse(JSON.stringify(await runNoaOrchestrator(next))));
  assert.deepEqual(serialized.conversationReference, answer.conversationReference);
  assert.deepEqual(serialized.productConfigurationReference, configuration);
  assert.equal("scopeSource" in serialized, false);
});

test("route rejects malformed JSON/messages and unauthenticated requests; invalid references are discarded", async () => {
  const malformed = new Request("http://localhost/api/noa/chat", { method: "POST", body: "{" });
  assert.equal((await POST(malformed)).status, 400);
  for (const body of [null, {}, { message: 3 }, { message: " " }, { message: "x".repeat(2001) }]) assert.equal((await POST(request(body))).status, 400);
  const invalid = await POST(request({ message: "Hello", context, conversationReference: { domain: "invalid" }, productConfigurationReference: { templateId: 4 } }));
  const answer = await invalid.json();
  assert.equal(answer.conversationReference, undefined);
  assert.equal(answer.productConfigurationReference, undefined);
  authenticated = false;
  try { assert.equal((await POST(request({ message: "Hello" }))).status, 401); }
  finally { authenticated = true; }
});
