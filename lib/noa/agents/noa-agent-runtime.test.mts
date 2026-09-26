import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { tryNoaAgentBrief } from "./noa-agent-runtime.js";
import { validateNoaAgentPlan } from "./noa-agent-planner.js";
import { executeAgentPlanWithAdapters, type NoaAgentAdapters } from "./noa-agent-executor-core.js";
import type { NoaAgentPlan } from "./noa-agent-types.js";
import type { NoaPageContext } from "../noa-types.js";

function harness(refuse = false) {
  const plans: NoaAgentPlan[] = [];
  let resolutions = 0;
  const deps = {
    validIdentifier: (type: string, label: string) => (type === "quotation" ? /^QN-\d{4}-\d{3}$/ : /^CO-\d{4}-\d{3}$/).test(label),
    resolveClient: async (name: string) => { resolutions++; return name === "EXQUITECH" ? name : null; },
    execute: async (plan: NoaAgentPlan, context: NoaPageContext) => {
      assert.equal(validateNoaAgentPlan(plan).ok, true); plans.push(plan);
      const adapter = async (message: string) => {
        if (refuse && message.startsWith("order details")) return { ok: false as const, reason: "unauthorized" as const, message: "SECRET ROLE" };
        const kind = message.startsWith("project details") ? "project_file_detail" : message.startsWith("order details") ? "procurement_order_detail" : message.startsWith("what changed") ? "user_activity_catch_up" : message.includes("client") ? "client_record_detail" : undefined;
        return { ok: true as const, sources: [], data: { kind, quotationNo: "QN-0005-001", title: "Quotation", deterministicText: "Existing safe display summary.", rows: "SECRET RAW DATA" } };
      };
      const adapters: NoaAgentAdapters = { Project: adapter, Procurement: adapter, UserActivity: adapter, Client: adapter, Quotation: adapter, Product: adapter, Price: adapter, Admin: adapter, Insights: adapter };
      return executeAgentPlanWithAdapters(plan, context, adapters);
    },
  };
  return { plans, deps, resolutions: () => resolutions };
}
const request = (message: string) => ({ message, context: { pathname: "/", section: "dashboard" as const } });
test("flag off bypasses all resolution and execution", async () => {
  const h = harness();
  assert.equal(await tryNoaAgentBrief(request("Give me a complete update on CO-0003-001"), false, h.deps), null);
  assert.equal(h.plans.length, 0); assert.equal(h.resolutions(), 0);
});
for (const [message, domain, steps] of [
  ["Give me a complete update on CO-0003-001", "Project", 3],
  ["Give me a client briefing for EXQUITECH", "Client", 1],
  ["Give me a quotation briefing on QN-0005-001", "Quotation", 1],
] as const) test(`${domain} runs validated A1/A2/A3 and sends only display transport`, async () => {
  const h = harness(); const answer = await tryNoaAgentBrief(request(message), true, h.deps);
  assert.ok(answer?.agentBrief); assert.equal(h.plans[0].steps.length, steps);
  assert.equal(answer.conversationReference?.domain, domain);
  const json = JSON.stringify(answer.agentBrief);
  for (const forbidden of ["SECRET", "stepId", "sourceStepId", "sourceSteps", "dependsOn", "agentId"]) assert.ok(!json.includes(forbidden));
});
test("missing/ambiguous/invalid entities never execute", async () => {
  for (const message of ["project briefing", "project briefing on CO-invalid", "quotation briefing on QN-0005-001 and QN-0006-001", "client briefing for ambiguous", "complete update on Galleria"]) {
    const h = harness(); const answer = await tryNoaAgentBrief(request(message), true, h.deps);
    assert.ok(answer?.text); assert.equal(h.plans.length, 0);
  }
});
test("secondary refusal is partial and contains no auth detail", async () => {
  const h = harness(true); const answer = await tryNoaAgentBrief(request("project briefing on CO-0003-001"), true, h.deps);
  assert.equal(answer?.agentBrief?.partial, true);
  assert.ok(!JSON.stringify(answer).includes("SECRET"));
  assert.equal(answer?.conversationReference?.entities?.[0].label, "CO-0003-001");
});
test("existing routing phrases always fall through", async () => {
  const h = harness();
  for (const message of ["what needs my attention", "what changed today", "What changed on it?", "quotation analytics", "project summary", "client summary", "tell me about CO-0003-001", "tell me about QN-0005-001", "show client EXQUITECH", "Who is our best client based on quotation?"]) assert.equal(await tryNoaAgentBrief(request(message), true, h.deps), null);
  assert.equal(h.plans.length, 0);
});
test("fixed server integration and mutually exclusive wrapping UI", () => {
  const source = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
  assert.ok(source.includes('process.env.NOA_AGENTS_V1 === "true"'));
  assert.ok(source.includes("execute: executeNoaAgentPlan"));
  assert.ok(source.includes("agentAnswer ?? await runNoaOrchestratorCore(request)"));
  const runtime = readFileSync("lib/noa/agents/noa-agent-runtime.ts", "utf8");
  assert.doesNotMatch(runtime, /supabase|runAiProvider|setInterval|\.from\(/);
  const ui = readFileSync("components/noa/noa-messages.tsx", "utf8");
  assert.ok(ui.includes("[overflow-wrap:anywhere]")); assert.ok(ui.includes("min-w-0 max-w-full"));
  assert.ok(ui.includes(") : hasAttentionCards"));
  assert.ok(ui.indexOf("message.agentBrief ? (") < ui.indexOf("<NoaAttentionCards attention={message.attention}"));
});
