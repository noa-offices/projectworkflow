import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { agentForNoaDomain, NOA_AGENT_REGISTRY } from "./noa-agent-registry.js";
import { planSingleAgentRequest, validateNoaAgentPlan } from "./noa-agent-planner.js";
import type { NoaDomain } from "../noa-types.js";

const single = () => structuredClone(planSingleAgentRequest({ resolvedDomain: "Quotation", canonicalMessage: "show quotations" })!);
const multi = () => ({ mode: "multi", responseMode: "compose", steps: [
  { stepId: "project", agentId: "project_agent", domain: "Project", canonicalMessage: "project details for CO-0003-001", dependsOn: [] as string[] },
  { stepId: "orders", agentId: "procurement_agent", domain: "Procurement", canonicalMessage: "show active procurement orders", dependsOn: ["project"] },
  { stepId: "history", agentId: "project_agent", domain: "UserActivity", canonicalMessage: "what changed on CO-0003-001", dependsOn: ["orders"] },
] });

test("registry contains exactly six immutable, unique orchestration identities and real domains", () => {
  assert.deepEqual(Object.keys(NOA_AGENT_REGISTRY).sort(), ["admin_insights_agent", "procurement_agent", "product_price_agent", "project_agent", "quotation_agent", "sales_client_agent"]);
  const domains: NoaDomain[] = ["Product", "Quotation", "Price", "Project", "Client", "Procurement", "UserActivity", "Admin", "Insights", "Attention", "Help"];
  assert.ok(Object.isFrozen(NOA_AGENT_REGISTRY));
  const entries = Object.values(NOA_AGENT_REGISTRY);
  assert.equal(new Set(entries.map(x => x.id)).size, 6);
  for (const entry of entries) {
    assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry.allowedDomains));
    assert.ok(entry.allowedDomains.every(domain => domains.includes(domain)));
  }
});

for (const [domain, owner] of Object.entries({ Quotation: "quotation_agent", Project: "project_agent", Client: "sales_client_agent", Procurement: "procurement_agent", Product: "product_price_agent", Price: "product_price_agent", Admin: "admin_insights_agent" })) {
  test(`${domain} has explicit ownership and creates a validated plan without changing canonical text`, () => {
    assert.equal(agentForNoaDomain(domain as NoaDomain), owner);
    const message = "  already resolved canonical text  ";
    const plan = planSingleAgentRequest({ resolvedDomain: domain as NoaDomain, canonicalMessage: message });
    assert.ok(plan);
    assert.equal(plan.steps[0].canonicalMessage, message);
    assert.equal(plan.steps[0].agentId, owner);
    assert.deepEqual(validateNoaAgentPlan(plan), { ok: true });
  });
}
test("contextual domains have no inferred owner; selection still checks scope", () => {
  for (const domain of ["Insights", "UserActivity", "Attention", "Help"] as const) {
    assert.equal(agentForNoaDomain(domain), null);
    assert.equal(planSingleAgentRequest({ resolvedDomain: domain, canonicalMessage: "anything" }), null);
  }
  assert.ok(planSingleAgentRequest({ resolvedDomain: "Insights", agentId: "sales_client_agent", canonicalMessage: "top clients by quotation value" }));
  assert.equal(planSingleAgentRequest({ resolvedDomain: "Insights", agentId: "sales_client_agent", canonicalMessage: "payment analytics" }), null);
  assert.equal(planSingleAgentRequest({ resolvedDomain: "UserActivity", agentId: "project_agent", canonicalMessage: "what changed today" }), null);
  assert.equal(planSingleAgentRequest({ resolvedDomain: "Attention", agentId: "procurement_agent", canonicalMessage: "what needs my attention" }), null);
});

const invalidCases: Array<[string, (plan: ReturnType<typeof multi>) => unknown]> = [
  ["unknown agent", p => ({ ...p, steps: [{ ...p.steps[0], agentId: "unknown" }, ...p.steps.slice(1)] })],
  ["prototype agent", p => ({ ...p, steps: [{ ...p.steps[0], agentId: "toString" }, ...p.steps.slice(1)] })],
  ["unknown domain", p => ({ ...p, steps: [{ ...p.steps[0], domain: "Unknown" }, ...p.steps.slice(1)] })],
  ["wrong pair", p => ({ ...p, steps: [{ ...p.steps[0], agentId: "quotation_agent" }, ...p.steps.slice(1)] })],
  ["too many steps", p => ({ ...p, steps: [...p.steps, ...p.steps] })],
  ["duplicate id", p => { p.steps[1].stepId = "project"; return p; }],
  ["missing dependency", p => { p.steps[1].dependsOn = ["missing"]; return p; }],
  ["self dependency", p => { p.steps[1].dependsOn = ["orders"]; return p; }],
  ["cycle", p => { p.steps[0].dependsOn = ["history"]; return p; }],
  ["duplicate dependency", p => { p.steps[1].dependsOn = ["project", "project"]; return p; }],
  ["blank message", p => { p.steps[0].canonicalMessage = "  "; return p; }],
  ["oversized message", p => { p.steps[0].canonicalMessage = "x".repeat(1001); return p; }],
  ["bad response mode", p => ({ ...p, responseMode: "other" })],
  ["direct multi", p => ({ ...p, responseMode: "direct" })],
  ["single multi", p => ({ ...p, mode: "single" })],
  ["empty steps", p => ({ ...p, steps: [] })],
  ["null", () => null],
];
for (const [label, make] of invalidCases) test(`reject ${label}`, () => assert.equal(validateNoaAgentPlan(make(multi())).ok, false));

test("accept finite DAG including forward references, but not a disconnected cycle", () => {
  assert.deepEqual(validateNoaAgentPlan(multi()), { ok: true });
  const p = multi(); p.steps.reverse();
  assert.deepEqual(validateNoaAgentPlan(p), { ok: true });
  const cyclic = multi(); cyclic.steps[1].dependsOn = ["history"];
  assert.equal(validateNoaAgentPlan(cyclic).ok, false);
});
test("strict shape rejects executable, auth, data, and recursive-plan fields at both levels", () => {
  for (const key of ["sql", "table", "filters", "userId", "authOverride", "serviceRole", "provider", "model", "rows", "total", "plan"]) {
    const plan = single();
    assert.equal(validateNoaAgentPlan({ ...plan, [key]: "injected" }).ok, false, key);
    assert.equal(validateNoaAgentPlan({ ...plan, steps: [{ ...plan.steps[0], [key]: "injected" }] }).ok, false, key);
  }
});
test("foundation is pure, has no runtime activation and no capability calculations", () => {
  for (const name of ["types", "registry", "planner"]) {
    const source = readFileSync(`lib/noa/agents/noa-agent-${name}.ts`, "utf8");
    const imports = source.match(/^import .*$/gm) ?? [];
    for (const statement of imports) assert.match(statement, /from "(?:\.\/noa-agent-(?:types|registry)|\.\.\/noa-types)"/);
    assert.doesNotMatch(source, /\b(?:fetch|fetchNoa\w+Capability|runAiProvider)\s*\(|\.from\s*\(|\.rpc\s*\(/);
  }
  for (const file of ["noa-semantic-resolver.ts", "noa-intent-router.ts"]) {
    assert.doesNotMatch(readFileSync(`lib/noa/${file}`, "utf8"), /from ["'][^"']*agents\/noa-agent/);
  }
});
