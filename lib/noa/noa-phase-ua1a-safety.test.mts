import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-user-activity-capability.server.ts and noa-orchestrator.ts have "@/..." aliases and/or
// `import "server-only"`, neither resolvable by Node's plain ESM resolver outside the Next.js
// build. These are source-level wiring/safety checks, not runtime execution tests, matching the
// convention already used throughout lib/noa/'s other *-safety.test.mts files.

const activitySource = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");
const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const typesSource = readFileSync("lib/noa/noa-types.ts", "utf8");
const registrySource = readFileSync("lib/ai/agent-registry.ts", "utf8");

const MUTATION_PATTERN = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/;

// 1. requireActiveUser() is used (own activity only - no elevated role needed). UA-1B (a later,
// separately safety-tested phase) additionally imports requireSettingsManager/requireSystemOwner
// from the same "@/lib/auth" import statement for its own team/other-user paths.
test("1. User Activity capability calls requireActiveUser()", () => {
  assert.ok(activitySource.includes('import { requireActiveUser, requireSettingsManager, requireSystemOwner } from "@/lib/auth";'));
  assert.ok(activitySource.includes("await requireActiveUser();"));
});

// 2. auth before any query. UA-1B added an earlier (team/other-user) createClient() call in this
// same file, so this checks the own-scope requireActiveUser() call precedes ITS OWN subsequent
// createClient() call, not the first createClient() in the whole file.
test("2. auth is checked before any Supabase query runs", () => {
  const authIndex = activitySource.indexOf("await requireActiveUser();");
  const firstQueryIndex = activitySource.indexOf("await createClient();", authIndex);
  assert.ok(authIndex >= 0 && firstQueryIndex >= 0 && authIndex < firstQueryIndex);
});

// 3. user-scoped client only
test("3. only the user-scoped Supabase client is used", () => {
  assert.ok(activitySource.includes('import { createClient } from "@/lib/supabase/server";'));
});

// 4. no admin/service-role client
test("4. no createAdminClient or service-role access", () => {
  assert.ok(!activitySource.includes("createAdminClient"));
  assert.ok(!/service[-_]?role|SUPABASE_SERVICE_ROLE/i.test(activitySource));
});

// 5. no writes
test("5. no mutation method calls", () => {
  assert.ok(!MUTATION_PATTERN.test(activitySource));
});

// 6. own-user filtering exists on every query
test("6. every activity/price query is filtered to the caller's own user id", () => {
  const eqCreatedByCount = (activitySource.match(/\.eq\("created_by", userId\)/g) ?? []).length;
  const eqCheckedByCount = (activitySource.match(/\.eq\("last_price_checked_by", userId\)/g) ?? []).length;
  const eqChangedByCount = (activitySource.match(/\.eq\("changed_by", userId\)/g) ?? []).length;
  assert.ok(eqCreatedByCount >= 4, "expected created_by = userId on every audit_activity_log query");
  assert.equal(eqCheckedByCount, 2, "expected last_price_checked_by = userId on both price-checked queries");
  assert.equal(eqChangedByCount, 2, "expected changed_by = userId on both price-history queries");
});

// 7. UA-1A's own-scope path never uses a service-role/admin client. UA-1B (a later, separately
// safety-tested phase - see noa-phase-ua1b-safety.test.mts) legitimately added
// requireSettingsManager()/requireSystemOwner()/profiles reads to this same file for team/
// other-user activity, so this assertion no longer checks for their total absence - only that no
// admin/service-role path was introduced, which remains true for both phases.
test("7. no admin/service-role query path exists anywhere in this file", () => {
  assert.ok(!activitySource.includes("loadTeamStats"));
  assert.ok(!activitySource.includes("createAdminClient"));
});

// 8. activity-log reads bounded
test("8. audit_activity_log reads are hard-capped", () => {
  assert.match(activitySource, /const MAX_ACTIVITY_LOG_ROWS = 50;/);
  assert.ok(activitySource.includes(".limit(MAX_ACTIVITY_LOG_ROWS)"));
});

// 9. recent-detail reads bounded
test("9. recent-activity reads are hard-capped separately", () => {
  assert.match(activitySource, /const MAX_RECENT_ACTIVITY_ROWS = 20;/);
  assert.ok(activitySource.includes(".limit(MAX_RECENT_ACTIVITY_ROWS)"));
});

// 10. time-range helper reused, not reinvented
test("10. the existing Insights date-range helper is reused, not reimplemented", () => {
  assert.ok(activitySource.includes('import { resolveDateRange, type DateRangeKey } from "@/lib/insights/date-ranges";'));
  assert.ok(!/function resolveDateRange/.test(activitySource));
});

// 11. no working-hours subtraction logic
test("11. no last-activity-minus-first-activity or working-hours computation exists", () => {
  assert.ok(!/hoursWorked|workingHours|workedHours/i.test(activitySource));
  assert.ok(!/getTime\(\)\s*-\s*.*getTime\(\)/.test(activitySource));
});

// 12. attendance limitation text exists and is fixed/deterministic
test("12. a fixed attendance/presence limitation text exists and is returned without a query", () => {
  assert.ok(activitySource.includes("ATTENDANCE_LIMITATION_TEXT"));
  assert.match(activitySource, /tracks recorded application activity, not verified attendance or working hours/);
  // UA-1B added an earlier (team/other-user) createClient() call in this same file, so anchor on
  // the own-scope entry point specifically rather than the first createClient() in the file.
  const ownScopeAnchor = activitySource.indexOf("// Own-scope kinds (UA-1A, unchanged): requireActiveUser() only.");
  const kindIndex = activitySource.indexOf('kind === "attendance_boundary"', ownScopeAnchor);
  const supabaseCreateIndex = activitySource.indexOf("const supabase = await createClient();", ownScopeAnchor);
  assert.ok(ownScopeAnchor >= 0 && kindIndex >= 0 && supabaseCreateIndex >= 0 && kindIndex < supabaseCreateIndex);
});

// 13. no "online now" / presence claims
test("13. no online/presence/working-now claim is ever made", () => {
  assert.ok(!/\bonline now\b/i.test(activitySource));
  assert.ok(!/\bcurrently at work\b/i.test(activitySource));
  assert.ok(!/"[^"]*\byou are online\b[^"]*"/i.test(activitySource));
});

// 14. quotation ownership (salesperson_id) is never treated as edit activity
test("14. salesperson_id/ownership is never used as evidence of edit activity", () => {
  assert.ok(!activitySource.includes("salesperson_id"));
});

// 15. price checked vs price changed remain separate
test("15. price-checked and price-changed are computed and reported as separate counts", () => {
  assert.ok(activitySource.includes("priceCheckedCount"));
  assert.ok(activitySource.includes("priceChangedCount"));
  assert.ok(activitySource.includes('.from("product_templates")'));
  assert.ok(activitySource.includes('.from("product_components")'));
  assert.ok(activitySource.includes('.from("product_template_price_history")'));
  assert.ok(activitySource.includes('.from("quotation_item_price_history")'));
});

// 16. Project/Client update attribution is not fabricated
test("16. no fabricated Project/Client update-attribution query exists", () => {
  assert.ok(!/from\("projects"\)/.test(activitySource));
  assert.ok(!/from\("clients"\)/.test(activitySource));
});

// 17. deterministicText exists on every result path
test("17. every User Activity result path emits deterministicText", () => {
  const count = (activitySource.match(/deterministicText:/g) ?? []).length;
  assert.ok(count >= 6, "expected deterministicText across summary/quotation/price/last/recent/attendance branches");
});

// 18. canWrite:false if a registry entry was added
test("18. no dead user_activity agent-registry entry was added (existing single noa_orchestrator provider is reused)", () => {
  assert.ok(!registrySource.includes('id: "user_activity"'));
});

// 19. provider only ever receives this capability's own already-computed data (no direct provider call here)
test("19. this capability never calls the AI provider itself - only the orchestrator does, after this returns", () => {
  assert.ok(!activitySource.includes("runAiProvider"));
  assert.ok(!activitySource.includes("runNoaProvider"));
});

// 20. orchestrator dispatches UserActivity
test("20. orchestrator dispatches to fetchNoaUserActivityCapability for the UserActivity domain", () => {
  assert.ok(orchestratorSource.includes('import { fetchNoaUserActivityCapability } from "@/lib/noa/noa-user-activity-capability.server";'));
  assert.match(orchestratorSource, /domain === "UserActivity"\s*\n\s*\? await fetchNoaUserActivityCapability\(request\.message, request\.context\)/);
});

test("UserActivity is a real NoaDomain", () => {
  assert.match(typesSource, /export type NoaDomain = "Product" \| "Quotation" \| "Price" \| "Project" \| "Client" \| "Procurement" \| "UserActivity" \| "Help";/);
});

test("no cross-capability chaining: User Activity capability never imports another NOA capability", () => {
  assert.ok(!activitySource.includes("noa-product-capability"));
  assert.ok(!activitySource.includes("noa-quotation-capability"));
  assert.ok(!activitySource.includes("noa-price-capability"));
  assert.ok(!activitySource.includes("noa-project-capability"));
  assert.ok(!activitySource.includes("noa-client-capability"));
  assert.ok(!activitySource.includes("noa-procurement-capability"));
});

test("an unauthorized result returns before any Supabase query runs", () => {
  assert.ok(activitySource.includes("UNAUTHORIZED_RESULT"));
  const catchIndex = activitySource.indexOf("if (isNextRedirectError(error)) return UNAUTHORIZED_RESULT;");
  // UA-1B added an earlier (team/other-user) createClient() call in this same file - search for
  // the own-scope's own subsequent createClient() call, not the first one in the file.
  const supabaseCreateIndex = activitySource.indexOf("const supabase = await createClient();", catchIndex);
  assert.ok(catchIndex >= 0 && supabaseCreateIndex >= 0 && catchIndex < supabaseCreateIndex);
});

test("audit_activity_log queries use fixed column selects, never select('*')", () => {
  assert.ok(!activitySource.includes('.select("*")'));
});
