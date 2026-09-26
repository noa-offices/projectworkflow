import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { composeNoaAgentExecution, projectAgentStepResultForComposition } from "./noa-agent-composer.js";
import { NOA_AGENT_COMPOSITION_RECIPES } from "./noa-agent-recipes.js";
import type { NoaAgentPlan } from "./noa-agent-types.js";
import type { NoaAgentPlanExecution } from "./noa-agent-execution-types.js";

function fixture() {
  const plan: NoaAgentPlan = { mode: "multi", responseMode: "compose", steps: [
    { stepId: "project", agentId: "project_agent", domain: "Project", canonicalMessage: "project details for CO-0003-001", dependsOn: [] },
    { stepId: "orders", agentId: "procurement_agent", domain: "Procurement", canonicalMessage: "show active procurement orders", dependsOn: [] },
  ] };
  const execution: NoaAgentPlanExecution = { responseMode: "compose", completed: true, stepResults: plan.steps.map((step, i) => ({ ...step, status: "success", result: { ok: true, sources: [], data: {
    kind: i ? "procurement_order_detail" : "project_file_detail",
    deterministicText: i ? "Order CO-0003-001 is active with no vendor groups yet." : "CO-0003-001 (Galleria) for Example is active.",
    id: "internal-secret", metadata: { role: "hidden", query: "hidden" }, rows: [{ amount: "hidden" }],
  } } })) };
  return { plan, execution };
}
test("recipes are closed and unknown recipe fails", () => {
  assert.deepEqual(Object.keys(NOA_AGENT_COMPOSITION_RECIPES), ["project_brief", "client_brief", "quotation_brief"]);
  const { plan, execution } = fixture();
  for (const id of ["unknown", "toString", null]) assert.deepEqual(composeNoaAgentExecution(plan, execution, id), { status: "failed", reason: "invalid_recipe" });
});
test("Project and Procurement expose only existing display prose in plan order", () => {
  const { plan, execution } = fixture();
  execution.stepResults.reverse();
  const output = composeNoaAgentExecution(plan, execution, "project_brief");
  assert.notEqual(output.status, "failed");
  if (output.status === "failed") return;
  assert.deepEqual(output.sourceSteps, ["project", "orders"]);
  assert.equal(output.sections[0].facts[0], "CO-0003-001 (Galleria) for Example is active.");
  assert.ok(!JSON.stringify(output).includes("hidden"));
  assert.ok(!JSON.stringify(output).includes("internal-secret"));
});
for (const status of ["refused", "failed", "skipped"] as const) {
  test(`${status} never contributes sensitive payload or permission details`, () => {
    const { plan, execution } = fixture();
    if (status === "skipped") {
      // A skipped dependency cannot have a successful prerequisite.
      execution.stepResults[1] = { ...plan.steps[1], status, reason: "dependency_not_successful" };
      execution.completed = false;
      assert.equal(composeNoaAgentExecution(plan, execution, "project_brief").status, "failed");
      assert.equal(projectAgentStepResultForComposition(execution.stepResults[1]), null);
      return;
    }
    execution.stepResults[1] = status === "refused"
      ? { ...plan.steps[1], status, result: { ok: false, reason: "unauthorized", message: "secret role details" } }
      : { ...plan.steps[1], status, reason: "capability_exception" };
    execution.completed = false;
    const output = composeNoaAgentExecution(plan, execution, "project_brief");
    assert.equal(output.status, "partial");
    assert.ok(!JSON.stringify(output).includes("secret"));
    assert.equal(output.omissions[0], "Procurement information was not available for this request.");
  });
}
test("missing successful primary and all-refused return controlled failure", () => {
  const { plan, execution } = fixture();
  execution.completed = false;
  execution.stepResults[0] = { ...plan.steps[0], status: "refused", result: { ok: false, reason: "unauthorized", message: "hidden" } };
  assert.deepEqual(composeNoaAgentExecution(plan, execution, "project_brief"), { status: "failed", reason: "primary_unavailable" });
  execution.stepResults[1] = { ...plan.steps[1], status: "failed", reason: "capability_exception" };
  assert.equal(composeNoaAgentExecution(plan, execution, "project_brief").status, "failed");
});
test("Catch-Up and Insights project only known display text", () => {
  for (const [domain, kind, agentId, message] of [
    ["UserActivity", "user_activity_catch_up", "project_agent", "what changed on CO-0003-001"],
    ["Insights", "insights_payment_analytics", "admin_insights_agent", "payment analytics"],
  ] as const) {
    const { plan, execution } = fixture();
    const step = { ...plan.steps[1], domain, agentId, canonicalMessage: message };
    const nextPlan = { ...plan, steps: [plan.steps[0], step] };
    execution.stepResults[1] = { ...step, status: "success", result: { ok: true, sources: [], data: { kind, deterministicText: "Existing displayed summary.", metadata: "secret", items: [{ id: "secret" }] } } };
    const output = composeNoaAgentExecution(nextPlan, execution, "project_brief");
    assert.equal(output.status, "complete");
    assert.ok(!JSON.stringify(output).includes("secret"));
  }
});
test("bounded projection drops whole oversized lines and UUIDs, limits facts", () => {
  const { execution } = fixture();
  const step = execution.stepResults[0];
  assert.equal(step.status, "success");
  if (step.status !== "success") return;
  step.result.data = { kind: "project_file_detail", deterministicText: ["x".repeat(501), "12345678-1234-1234-1234-123456789abc", ...Array(12).fill("CO-0003-001 remains intact.")].join("\n") };
  const output = projectAgentStepResultForComposition(step)!;
  assert.equal(output.section.facts.length, 8);
  assert.equal(output.omitted, true);
  assert.ok(output.section.facts.every(fact => fact === "CO-0003-001 remains intact."));
  step.result.data = { kind: "unknown", deterministicText: "secret" };
  assert.equal(projectAgentStepResultForComposition(step), null);
});
test("unexpected, duplicate, mismatched results and more than four steps rejected", () => {
  for (const mutation of [
    (e: NoaAgentPlanExecution) => e.stepResults.push(e.stepResults[0]),
    (e: NoaAgentPlanExecution) => { e.stepResults[1] = e.stepResults[0]; },
    (e: NoaAgentPlanExecution) => { e.completed = false; },
    (e: NoaAgentPlanExecution) => { e.stepResults[0] = { ...e.stepResults[0], domain: "Product" }; },
  ]) {
    const { plan, execution } = fixture(); mutation(execution);
    assert.equal(composeNoaAgentExecution(plan, execution, "project_brief").status, "failed");
  }
  const { plan, execution } = fixture();
  assert.equal(composeNoaAgentExecution({ ...plan, steps: [...plan.steps, ...plan.steps, ...plan.steps] }, execution, "project_brief").status, "failed");
});
test("client brief requires Client and accepts existing client rankings", () => {
  const plan: NoaAgentPlan = { mode: "multi", responseMode: "compose", steps: [
    { stepId: "client", agentId: "sales_client_agent", domain: "Client", canonicalMessage: "tell me about client Example", dependsOn: [] },
    { stepId: "ranking", agentId: "sales_client_agent", domain: "Insights", canonicalMessage: "top clients by quotation value", dependsOn: [] },
  ] };
  const execution: NoaAgentPlanExecution = { completed: true, responseMode: "compose", stepResults: plan.steps.map((step, i) => ({ ...step, status: "success", result: { ok: true, sources: [], data: { kind: i ? "insights_client_ranking" : "client_record_detail", deterministicText: "Existing summary." } } })) };
  assert.equal(composeNoaAgentExecution(plan, execution, "client_brief").status, "complete");
  assert.equal(composeNoaAgentExecution(fixture().plan, fixture().execution, "client_brief").status, "failed");
});
test("quotation detail drops raw items and id; quotation history respects A1 rejection", () => {
  const plan: NoaAgentPlan = { mode: "single", responseMode: "direct", steps: [{ stepId: "quote", agentId: "quotation_agent", domain: "Quotation", canonicalMessage: "what is QN-0005-001 worth", dependsOn: [] }] };
  const execution: NoaAgentPlanExecution = { completed: true, responseMode: "direct", stepResults: [{ ...plan.steps[0], status: "success", result: { ok: true, sources: [], data: { quotationNo: "QN-0005-001", title: "Example", id: "secret", items: [{ cost: "secret" }] } } }] };
  const output = composeNoaAgentExecution(plan, execution, "quotation_brief");
  assert.equal(output.status, "complete");
  assert.ok(!JSON.stringify(output).includes("secret"));
  assert.equal(composeNoaAgentExecution({ ...plan, steps: [{ ...plan.steps[0], domain: "UserActivity", canonicalMessage: "what changed on QN-0005-001" }] }, execution, "quotation_brief").status, "failed");
});
test("no production activation, queries, calculations or provider imports", () => {
  const source = readFileSync("lib/noa/agents/noa-agent-composer.ts", "utf8");
  assert.doesNotMatch(source, /JSON\.stringify|\.from\(|createClient|runAiProvider|\.reduce\(|\bfetch\(/);
  assert.doesNotMatch(source, /import .*?(?:supabase|provider|executor)/);
  for (const file of ["lib/noa/noa-orchestrator.ts", "lib/noa/agents/noa-agent-planner.ts", "lib/noa/agents/noa-agent-executor-core.ts"]) assert.doesNotMatch(readFileSync(file, "utf8"), /noa-agent-composer/);
  assert.match(readFileSync("lib/noa/agents/noa-agent-composer.server.ts", "utf8"), /import "server-only"/);
});

test("successful primary survives failed Catch-Up and a skipped dependent section", () => {
  const { plan, execution } = fixture();
  const history = { stepId: "history", agentId: "project_agent" as const, domain: "UserActivity" as const, canonicalMessage: "what changed on CO-0003-001", dependsOn: [] };
  const orders = { ...plan.steps[1], dependsOn: ["history"] };
  const nextPlan = { ...plan, steps: [plan.steps[0], history, orders] };
  const nextExecution: NoaAgentPlanExecution = { responseMode: "compose", completed: false, stepResults: [execution.stepResults[0],
    { ...history, status: "failed", reason: "capability_exception" },
    { ...orders, status: "skipped", reason: "dependency_not_successful" },
  ] };
  const output = composeNoaAgentExecution(nextPlan, nextExecution, "project_brief");
  assert.equal(output.status, "partial");
  if (output.status !== "partial") return;
  assert.equal(output.sections.length, 1);
  assert.equal(output.omissions.length, 2);
});

test("project recipe rejects a valid Product plan", () => {
  const { plan, execution } = fixture();
  const product = { ...plan.steps[1], agentId: "product_price_agent" as const, domain: "Product" as const };
  assert.deepEqual(composeNoaAgentExecution({ ...plan, steps: [plan.steps[0], product] }, execution, "project_brief"), { status: "failed", reason: "recipe_scope" });
});
