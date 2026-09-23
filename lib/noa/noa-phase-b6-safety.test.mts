import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-admin-capability.server.ts and noa-orchestrator.ts have "@/..." aliases and/or
// `import "server-only"`, neither resolvable by Node's plain ESM resolver outside the Next.js
// build. These are source-level wiring/safety checks, not runtime execution tests, matching the
// convention already used throughout lib/noa/'s other *-safety.test.mts files.

const adminSource = readFileSync("lib/noa/noa-admin-capability.server.ts", "utf8");
const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const typesSource = readFileSync("lib/noa/noa-types.ts", "utf8");
const registrySource = readFileSync("lib/ai/agent-registry.ts", "utf8");
const resolverSource = readFileSync("lib/ai/resolve-agent-runtime-config.server.ts", "utf8");

const MUTATION_PATTERN = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/;

// 1. requireSystemOwner() exists
test("1. Admin capability imports and calls requireSystemOwner()", () => {
  assert.ok(adminSource.includes('import { requireSystemOwner } from "@/lib/auth";'));
  assert.ok(adminSource.includes("await requireSystemOwner();"));
});

// 2. auth gate precedes all queries
test("2. requireSystemOwner() is the first thing the entry point does, before any query", () => {
  const entryIndex = adminSource.indexOf("export async function fetchNoaAdminCapability");
  const requireIndex = adminSource.indexOf("await requireSystemOwner();", entryIndex);
  const firstCreateClientIndex = adminSource.indexOf("await createClient();", entryIndex);
  const firstAgentsCallIndex = adminSource.indexOf("listAiAgents();", entryIndex);
  assert.ok(entryIndex >= 0 && requireIndex >= 0);
  assert.ok(requireIndex < firstCreateClientIndex);
  assert.ok(requireIndex < firstAgentsCallIndex);
});

// 3. user-scoped client only
test("3. only the user-scoped Supabase client is used", () => {
  assert.ok(adminSource.includes('import { createClient } from "@/lib/supabase/server";'));
});

// 4. no createAdminClient
test("4. no createAdminClient or service-role access", () => {
  assert.ok(!adminSource.includes("createAdminClient"));
  assert.ok(!/service[-_]?role|SUPABASE_SERVICE_ROLE/i.test(adminSource));
});

// 5. no writes
test("5. no mutation method calls", () => {
  assert.ok(!MUTATION_PATTERN.test(adminSource));
});

// 6. user list bounded
test("6. user list is hard-capped", () => {
  assert.match(adminSource, /const MAX_USER_ROWS = 20;/);
  assert.ok(adminSource.includes(".limit(MAX_USER_ROWS)"));
});

// 7. email excluded from provider payload
test("7. email is never selected or forwarded", () => {
  assert.ok(!adminSource.includes("email"));
});

// 8. phone excluded
test("8. phone is never selected or forwarded", () => {
  assert.ok(!adminSource.includes("phone"));
});

// 9. user IDs excluded
test("9. profiles.id / user id is never selected or forwarded", () => {
  assert.match(adminSource, /const USER_SELECT = "full_name,role,account_status";/);
  assert.ok(!/\bid,full_name|full_name,.*\bid\b/.test(adminSource));
});

// 10. API keys/secrets excluded
test("10. no API key or secret value is ever read or forwarded", () => {
  assert.ok(!/process\.env\[/.test(adminSource));
  assert.ok(!/API_KEY/.test(adminSource));
});

// 11. provider env values not exposed
test("11. credential status is a reused boolean helper, never a raw env value", () => {
  assert.ok(adminSource.includes("isProviderCredentialConfigured"));
  assert.ok(!adminSource.includes("process.env"));
  assert.match(resolverSource, /export function isProviderCredentialConfigured/);
});

// 12. counts computed in code
test("12. counts are computed via head-only count queries or resolver output, never handed to the model to tally", () => {
  assert.ok(adminSource.includes('{ count: "exact", head: true }') || adminSource.includes('{ count: "exact" }'));
  assert.ok(!adminSource.includes('.select("*")'));
});

// 13. agent/provider lists bounded
test("13. agent and provider lists are hard-capped", () => {
  assert.match(adminSource, /const MAX_PROVIDER_ROWS = 10;/);
  assert.match(adminSource, /const MAX_AGENT_ROWS = 10;/);
  assert.ok(adminSource.includes(".slice(0, MAX_PROVIDER_ROWS)") || adminSource.includes(".limit(MAX_PROVIDER_ROWS)"));
  assert.ok(adminSource.includes(".slice(0, MAX_AGENT_ROWS)"));
});

// 14. only real registry agent IDs used
test("14. agent listing/lookup is sourced from listAiAgents(), never an invented agent id", () => {
  assert.ok(adminSource.includes('import { listAiAgents } from "@/lib/ai/agent-registry";'));
  assert.ok(adminSource.includes("listAiAgents()"));
  assert.ok(!/const\s+AGENT_IDS\s*=/.test(adminSource));
});

// 15. UserActivity does not gain a fake runtime entry
test("15. no user_activity registry entry was added, and B6 reuses the existing noa_orchestrator provider", () => {
  assert.ok(!registrySource.includes('id: "user_activity"'));
  assert.ok(!adminSource.includes("runAiProvider"));
  assert.ok(!adminSource.includes("runNoaProvider"));
});

// 16. orchestrator dispatches Admin
test("16. orchestrator dispatches to fetchNoaAdminCapability for the Admin domain", () => {
  assert.ok(orchestratorSource.includes('import { fetchNoaAdminCapability } from "@/lib/noa/noa-admin-capability.server";'));
  assert.match(orchestratorSource, /domain === "Admin"\s*\n\s*\? await fetchNoaAdminCapability\(request\.message, request\.context\)/);
});

// 17. unauthorized result prevents provider call
test("17. an unauthorized result returns before any Supabase/registry query runs", () => {
  assert.ok(adminSource.includes("UNAUTHORIZED_RESULT"));
  const catchIndex = adminSource.indexOf("if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;");
  // agentSummaryAnswer() (defined earlier in source text) also calls listAiAgents() - search for
  // the entry point's OWN call, which appears after the catch block in source order.
  const agentsCallIndex = adminSource.indexOf("listAiAgents();", catchIndex);
  assert.ok(catchIndex >= 0 && agentsCallIndex >= 0 && catchIndex < agentsCallIndex);

  const capabilityResultIndex = orchestratorSource.indexOf("const capabilityResult");
  const notOkIndex = orchestratorSource.indexOf("if (!capabilityResult.ok)");
  const providerCallIndex = orchestratorSource.indexOf("runNoaProvider(");
  assert.ok(capabilityResultIndex < notOkIndex && notOkIndex < providerCallIndex);
});

// 18. deterministicText exists
test("18. every Admin result path emits deterministicText", () => {
  const count = (adminSource.match(/deterministicText:/g) ?? []).length;
  assert.ok(count >= 6, "expected deterministicText across user list/count/detail, role, provider, agent, and system summary branches");
});

test("Admin is a real NoaDomain", () => {
  assert.match(typesSource, /export type NoaDomain = "Product" \| "Quotation" \| "Price" \| "Project" \| "Client" \| "Procurement" \| "UserActivity" \| "Admin" \| "Help";/);
});

test("role/status vocabulary matches the actual AppRole/AccountStatus types, no invented values", () => {
  assert.ok(adminSource.includes('import type { AccountStatus, AppRole } from "@/lib/supabase/types";'));
  for (const role of ["system_owner", "admin_manager", "procurement_manager", "sales_designer", "sales_coordinator", "designer", "viewer"]) {
    assert.ok(adminSource.includes(`"${role}"`) || adminSource.includes(`${role}:`), `expected role ${role} to be referenced`);
  }
  assert.ok(!/\blocked\b|\bsuspended\b|\binactive\b/i.test(adminSource));
});

test("no cross-capability chaining: Admin capability never imports another NOA capability", () => {
  assert.ok(!adminSource.includes("noa-product-capability"));
  assert.ok(!adminSource.includes("noa-quotation-capability"));
  assert.ok(!adminSource.includes("noa-price-capability"));
  assert.ok(!adminSource.includes("noa-project-capability"));
  assert.ok(!adminSource.includes("noa-client-capability"));
  assert.ok(!adminSource.includes("noa-procurement-capability"));
  assert.ok(!adminSource.includes("noa-user-activity-capability"));
});

test("named-user lookup never guesses between multiple matches", () => {
  assert.ok(adminSource.includes('reason: "not_found"'));
  assert.ok(adminSource.includes('reason: "ambiguous"'));
  assert.ok(adminSource.includes(".limit(2)"));
});
