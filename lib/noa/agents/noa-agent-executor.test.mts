import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { executeAgentPlanWithAdapters, type NoaAgentAdapters } from "./noa-agent-executor-core.js";
import { planSingleAgentRequest } from "./noa-agent-planner.js";
import type { NoaAgentPlan } from "./noa-agent-types.js";
import type { NoaCapabilityResult, NoaPageContext } from "../noa-types.js";

const context: NoaPageContext = Object.freeze({ pathname: "/projects", section: "projects", projectId: "context-only" });
const success: NoaCapabilityResult = { ok: true, data: { marker: "capability-owned" }, sources: [] };
function harness(effect?: NoaAgentAdapters[keyof NoaAgentAdapters]) {
  const calls: Array<{ domain: string; message: string; context: NoaPageContext }> = [];
  const adapters = Object.fromEntries(["Quotation", "Project", "Client", "Procurement", "Product", "Price", "Insights", "Admin", "UserActivity"].map(domain => [domain, async (message: string, ctx: NoaPageContext) => {
    calls.push({ domain, message, context: ctx });
    return effect ? effect(message, ctx) : success;
  }])) as NoaAgentAdapters;
  return { calls, adapters };
}
function chain(): NoaAgentPlan {
  return { mode: "multi", responseMode: "compose", steps: [
    { stepId: "history", agentId: "project_agent", domain: "UserActivity", canonicalMessage: "what changed on CO-0003-001", dependsOn: ["orders"] },
    { stepId: "orders", agentId: "procurement_agent", domain: "Procurement", canonicalMessage: "show active procurement orders", dependsOn: ["project"] },
    { stepId: "project", agentId: "project_agent", domain: "Project", canonicalMessage: "project details for CO-0003-001", dependsOn: [] },
  ] };
}
for (const domain of ["Quotation", "Project", "Client", "Procurement", "Product", "Price", "Admin", "Insights"] as const) {
  test(`${domain} invokes only its adapter with exact message/context and preserves result`, async () => {
    const h = harness();
    const message = "  canonical message\nunchanged  ";
    const plan = planSingleAgentRequest({ resolvedDomain: domain, canonicalMessage: message, ...(domain === "Insights" ? { agentId: "admin_insights_agent" as const } : {}) });
    const output = await executeAgentPlanWithAdapters(plan, context, h.adapters);
    assert.deepEqual(h.calls, [{ domain, message, context }]);
    assert.equal(h.calls[0].context, context);
    assert.equal(output.completed, true);
    assert.equal(output.responseMode, "direct");
    assert.equal(output.stepResults[0].status, "success");
    if (output.stepResults[0].status === "success") assert.equal(output.stepResults[0].result, success);
  });
}
test("invalid plans, scope violations and extra privilege fields execute zero calls", async () => {
  const base = chain();
  const first = base.steps[2];
  const badSteps = [
    { ...first, agentId: "unknown" }, { ...first, agentId: "quotation_agent" },
    { ...first, domain: "Attention" }, { ...first, domain: "Help" },
    { ...first, domain: "UserActivity", canonicalMessage: "what changed today" },
    { ...first, agentId: "sales_client_agent", domain: "Insights", canonicalMessage: "payment analytics" },
    { ...first, userId: "override" }, { ...first, role: "override" }, { ...first, sql: "injected" },
  ];
  const plans: unknown[] = [null, { ...base, steps: [...base.steps, ...base.steps] }, ...badSteps.map(step => ({ mode: "single", responseMode: "direct", steps: [step] }))];
  for (const plan of plans) {
    const h = harness();
    await assert.rejects(executeAgentPlanWithAdapters(plan, context, h.adapters), /^Error: invalid_agent_plan$/);
    assert.equal(h.calls.length, 0);
  }
});
test("four permitted client ranking scopes invoke Insights", async () => {
  for (const canonicalMessage of ["top clients by quotation value", "top clients by confirmed value", "top clients by project value", "how many quotations does each client have"]) {
    const h = harness();
    const plan = planSingleAgentRequest({ resolvedDomain: "Insights", agentId: "sales_client_agent", canonicalMessage });
    assert.equal((await executeAgentPlanWithAdapters(plan, context, h.adapters)).completed, true);
    assert.equal(h.calls[0].domain, "Insights");
  }
});
test("forward dependencies execute topologically with exact scoped history; independent order is stable", async () => {
  const h = harness();
  const output = await executeAgentPlanWithAdapters(chain(), context, h.adapters);
  assert.deepEqual(output.stepResults.map(step => step.stepId), ["project", "orders", "history"]);
  assert.deepEqual(h.calls.map(call => call.message), [...chain().steps].reverse().map(step => step.canonicalMessage));
  const independent = { ...chain(), steps: chain().steps.map(step => ({ ...step, dependsOn: [] })) };
  const other = harness();
  assert.deepEqual((await executeAgentPlanWithAdapters(independent, context, other.adapters)).stepResults.map(step => step.stepId), ["history", "orders", "project"]);
});
for (const kind of ["exception", "unauthorized", "not_found", "ambiguous"] as const) {
  test(`${kind} is contained, descendants skip and independent work continues`, async () => {
    const h = harness(async message => {
      if (message.startsWith("project details")) {
        if (kind === "exception") throw new Error("sensitive exception payload");
        return { ok: false, reason: kind, message: "existing refusal" };
      }
      return success;
    });
    const plan = { ...chain(), steps: [...chain().steps, { stepId: "independent", agentId: "quotation_agent", domain: "Quotation", canonicalMessage: "show quotations", dependsOn: [] }] };
    const output = await executeAgentPlanWithAdapters(plan, context, h.adapters);
    assert.equal(output.completed, false);
    assert.deepEqual(output.stepResults.map(step => step.status), [kind === "exception" ? "failed" : "refused", "skipped", "skipped", "success"]);
    assert.equal(h.calls.length, 2);
    assert.equal(output.stepResults.length, 4);
    assert.ok(!JSON.stringify(output).includes("sensitive exception payload"));
  });
}
test("caller mutation during await cannot change later canonical messages", async () => {
  const plan = structuredClone(chain());
  const h = harness(async () => {
    (plan.steps[1] as { canonicalMessage: string }).canonicalMessage = "mutated";
    return success;
  });
  await executeAgentPlanWithAdapters(plan, context, h.adapters);
  assert.equal(h.calls[1].message, "show active procurement orders");
});
test("fixed server facade maps real entry points and exposes no adapter injection or runtime activation", () => {
  const facade = readFileSync("lib/noa/agents/noa-agent-executor.server.ts", "utf8");
  assert.match(facade, /import "server-only"/);
  for (const domain of ["Quotation", "Project", "Client", "Procurement", "Product", "Price", "Insights", "Admin", "UserActivity"]) {
    assert.ok(facade.includes(`${domain}: fetchNoa${domain}Capability`));
  }
  for (const file of ["noa-agent-executor.server.ts", "noa-agent-executor-core.ts", "noa-agent-execution-types.ts"]) {
    const source = readFileSync(`lib/noa/agents/${file}`, "utf8");
    assert.doesNotMatch(source, /\.from\s*\(|\.rpc\s*\(|createClient|service_role|runAiProvider|console\.|\beval\s*\(|\bimport\s*\(/);
    assert.doesNotMatch(source, /import .*from ["'][^"']*(?:supabase|provider|intent-router)/);
  }
  for (const file of ["noa-intent-router.ts", "noa-semantic-resolver.ts"]) {
    assert.doesNotMatch(readFileSync(`lib/noa/${file}`, "utf8"), /noa-agent-executor/);
  }
});
