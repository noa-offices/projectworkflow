import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-client-capability.server.ts and noa-orchestrator.ts have "@/..." aliases and/or
// `import "server-only"`, neither resolvable by Node's plain ESM resolver outside the Next.js
// build (`server-only` isn't even physically present in node_modules - Next.js provides it
// specially). These are source-level wiring/safety checks, not runtime execution tests, matching
// the convention already used throughout lib/noa/'s other *-safety.test.mts files.

const clientSource = readFileSync("lib/noa/noa-client-capability.server.ts", "utf8");
const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");

const MUTATION_PATTERN = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/;

// 1. Client capability calls requireActiveUser()
test("1. Client capability calls requireActiveUser()", () => {
  assert.ok(clientSource.includes('import { requireActiveUser } from "@/lib/auth";'));
  assert.ok(clientSource.includes("await requireActiveUser();"));
});

// 2. auth occurs before query
test("2. auth is checked before any Supabase query runs", () => {
  const authIndex = clientSource.indexOf("await requireActiveUser();");
  const firstQueryIndex = clientSource.indexOf("await createClient();");
  assert.ok(authIndex >= 0 && firstQueryIndex >= 0 && authIndex < firstQueryIndex);
});

// 3. user-scoped client only
test("3. only the user-scoped Supabase client is used", () => {
  assert.ok(clientSource.includes('import { createClient } from "@/lib/supabase/server";'));
});

// 4. no createAdminClient
test("4. no createAdminClient or service-role access", () => {
  assert.ok(!clientSource.includes("createAdminClient"));
  assert.ok(!/service[-_]?role|SUPABASE_SERVICE_ROLE/i.test(clientSource));
});

// 5. no writes
test("5. no mutation method calls", () => {
  assert.ok(!MUTATION_PATTERN.test(clientSource));
});

// 6. Client list bounded to 20
test("6. Client list is hard-capped at 20", () => {
  assert.match(clientSource, /const MAX_CLIENT_ROWS = 20;/);
  assert.ok(clientSource.includes(".limit(MAX_CLIENT_ROWS)"));
});

// 7. related Project list bounded to 10
test("7. related Project list is hard-capped at 10", () => {
  assert.match(clientSource, /const MAX_CLIENT_PROJECT_ROWS = 10;/);
  assert.ok(clientSource.includes(".limit(MAX_CLIENT_PROJECT_ROWS)"));
});

// 8. deterministicText exists
test("8. every Client result path emits deterministicText", () => {
  const count = (clientSource.match(/deterministicText:/g) ?? []).length;
  assert.ok(count >= 3, "expected deterministicText in detail/projects/list result branches");
});

// 9. Client counts calculated in code
test("9. project/quotation counts are computed via bounded server-side queries, never handed to the model to tally", () => {
  // ERP-NOA-3 (PART 1, documented in noa-client-capability.server.ts) later reused the same
  // bounded ERP Project File source (clientProjectFiles(), capped by
  // CLIENT_PROJECT_FILE_SCAN_LIMIT) for the project count instead of a separate head-only count
  // query - still bounded, still computed in code, never hitting the model. Quotation count is
  // untouched (still the original head-only count query).
  assert.ok(clientSource.includes('{ count: "exact", head: true }'));
  assert.ok(clientSource.includes("const projects = projectFiles.length;"));
  assert.ok(clientSource.includes("CLIENT_PROJECT_FILE_SCAN_LIMIT"));
  assert.ok(clientSource.includes("const quotations = quotationCount ?? 0;"));
});

// 10. contact fields excluded from general provider payloads
test("10. contact fields (email/phone/website/address/city/country/trn/notes) are never selected", () => {
  for (const field of ["email", "phone", "website", "address", "city", "country", "trn", "notes", "contact_person"]) {
    assert.ok(!clientSource.includes(`"${field}"`) && !new RegExp(`,${field}[,"]`).test(clientSource), `expected ${field} to be excluded from every select()`);
  }
  assert.match(clientSource, /const CLIENT_SELECT = "id,company_name,client_number,client_code,is_active";/);
});

// 11. Quotation-specific Client questions are not stolen by Client routing
test("11. Client capability itself never queries quotation_items or product_templates (no cross-domain duplication)", () => {
  assert.ok(!clientSource.includes('.from("quotation_items")'));
  assert.ok(!clientSource.includes('.from("product_templates")'));
  // Only bounded queries scoped to a specific already-resolved client are allowed. ERP-NOA-3
  // (PART 1) added a second `quotations` read (clientProjectFiles(), reused for the project
  // count - see test 9) alongside the original quotation-count query; both are still bounded
  // (head-only count / .limit(CLIENT_PROJECT_FILE_SCAN_LIMIT)) and scoped by client_id, never an
  // unbounded or cross-domain scan.
  const quotationsFromMatches = [...clientSource.matchAll(/\.from\("quotations"\)([\s\S]{0,200}?)(?:\.limit\(|;)/g)];
  assert.equal(quotationsFromMatches.length, 2, "expected exactly two bounded quotations reads");
  for (const match of quotationsFromMatches) {
    assert.ok(match[1].includes("client_id"), "expected every quotations read to be scoped by client_id");
    assert.ok(match[1].includes("{ count: \"exact\", head: true }") || match[1].includes("CLIENT_PROJECT_FILE_SCAN_LIMIT") || clientSource.slice(clientSource.indexOf(match[0]), clientSource.indexOf(match[0]) + 300).includes("CLIENT_PROJECT_FILE_SCAN_LIMIT"), "expected every quotations read to be bounded");
  }
});

// 12. orchestrator dispatches Client
test("12. orchestrator dispatches to fetchNoaClientCapability for the Client domain", () => {
  assert.ok(orchestratorSource.includes('import { fetchNoaClientCapability } from "@/lib/noa/noa-client-capability.server";'));
  // A later, unrelated phase added clientMessageOverride (I5 bound-follow-up canonical phrase
  // swap) and an options object - the dispatch gate itself (domain === "Client") is unchanged.
  assert.match(orchestratorSource, /domain === "Client"\s*\n\s*\? await fetchNoaClientCapability\([^,]+, request\.context/);
});

// 13. unauthorized result prevents provider call
test("13. an unauthorized result returns before runNoaProvider is ever reached", () => {
  const capabilityResultIndex = orchestratorSource.indexOf("const capabilityResult");
  const notOkIndex = orchestratorSource.indexOf("if (!capabilityResult.ok)");
  const providerCallIndex = orchestratorSource.indexOf("runNoaProvider(");
  assert.ok(capabilityResultIndex >= 0 && notOkIndex >= 0 && providerCallIndex >= 0);
  assert.ok(capabilityResultIndex < notOkIndex && notOkIndex < providerCallIndex);
});

test("no cross-capability chaining: Client capability never imports another NOA capability", () => {
  assert.ok(!clientSource.includes("noa-product-capability"));
  assert.ok(!clientSource.includes("noa-quotation-capability"));
  assert.ok(!clientSource.includes("noa-price-capability"));
  assert.ok(!clientSource.includes("noa-project-capability"));
});

test("Client is registered as a real NoaDomain and gets its own thinking-status text", () => {
  const routerSource = readFileSync("lib/noa/noa-intent-router.ts", "utf8");
  assert.match(routerSource, /Client: "Checking client records\.\.\."/);
});
