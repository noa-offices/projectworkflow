import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-user-activity-capability.server.ts has "@/..." aliases and `import "server-only"`, neither
// resolvable by Node's plain ESM resolver outside the Next.js build. These are source-level
// wiring/safety checks, not runtime execution tests, matching the convention already used
// throughout lib/noa/'s other *-safety.test.mts files.

const activitySource = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");
const registrySource = readFileSync("lib/ai/agent-registry.ts", "utf8");

const MUTATION_PATTERN = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/;

// 1. own activity path still uses requireActiveUser()
test("1. own-scope activity path still uses requireActiveUser()", () => {
  assert.ok(activitySource.includes('import { requireActiveUser, requireSettingsManager, requireSystemOwner } from "@/lib/auth";'));
  assert.ok(activitySource.includes("await requireActiveUser();"));
});

// 2. team/other path uses requireSettingsManager()
test("2. team/other-user path uses requireSettingsManager() before any cross-user query", () => {
  assert.ok(activitySource.includes("await requireSettingsManager();"));
  const requireIndex = activitySource.indexOf("await requireSettingsManager();");
  const teamCreateClientIndex = activitySource.indexOf("const supabase = await createClient();", requireIndex);
  assert.ok(requireIndex >= 0 && teamCreateClientIndex >= 0 && requireIndex < teamCreateClientIndex);
});

// 3. specific arbitrary profile lookup is System Owner-only
test("3. specific named other-user profile lookup requires requireSystemOwner()", () => {
  assert.ok(activitySource.includes("await requireSystemOwner();"));
  // Check call-site order inside the entry point (function declarations like resolveTargetProfile
  // appear earlier in source text but are only invoked after this check passes).
  const requireSystemOwnerIndex = activitySource.indexOf("await requireSystemOwner();");
  const resolveCallIndex = activitySource.indexOf("resolveTargetProfile(supabase, targetName)");
  assert.ok(requireSystemOwnerIndex >= 0 && resolveCallIndex >= 0 && requireSystemOwnerIndex < resolveCallIndex);
});

// 4. no createAdminClient
test("4. no createAdminClient anywhere", () => {
  assert.ok(!activitySource.includes("createAdminClient"));
});

// 5. no service-role use
test("5. no service-role access anywhere", () => {
  assert.ok(!/service[-_]?role|SUPABASE_SERVICE_ROLE/i.test(activitySource));
});

// 6. no mutation
test("6. no mutation method calls", () => {
  assert.ok(!MUTATION_PATTERN.test(activitySource));
});

// 7. team reads bounded
test("7. team-wide audit reads are hard-capped, separately from own/other-user bounds", () => {
  assert.match(activitySource, /const MAX_TEAM_AUDIT_ROWS = 100;/);
  assert.match(activitySource, /const MAX_TEAM_USER_ROWS = 20;/);
  assert.ok(activitySource.includes(".limit(MAX_TEAM_AUDIT_ROWS)"));
  assert.ok(activitySource.includes(".slice(0, MAX_TEAM_USER_ROWS)"));
});

// 8. actor UUID not included in provider payload
test("8. no created_by/actor uuid field is ever placed into a returned data payload", () => {
  assert.ok(!/actorId:|actorUserId:|userId: targetId|targetId,\s*\n?\s*kind:/.test(activitySource));
  // The only places `created_by`/uuid identifiers appear are query filters (.eq(...)), never as a
  // key inside a returned `data: { ... }` object literal.
  assert.ok(!/data:\s*{\s*[^}]*created_by/.test(activitySource));
});

// 9. email not included in provider payload
test("9. email is never selected or forwarded anywhere in this file", () => {
  assert.ok(!activitySource.includes("email"));
});

// 10. raw metadata not forwarded
test("10. the raw metadata object is never placed into a returned data payload - only metadata.actorName is extracted", () => {
  assert.ok(!/data:\s*{\s*[^}]*\bmetadata\b/.test(activitySource));
  assert.ok(activitySource.includes("row.metadata.actorName") || activitySource.includes("row.metadata && typeof row.metadata.actorName"));
});

// 11. metadata.actorName is optional/fallback only
test("11. metadata.actorName is treated as optional with an explicit fallback label", () => {
  assert.ok(activitySource.includes("UNRESOLVED_ACTOR_LABEL"));
  assert.match(activitySource, /const UNRESOLVED_ACTOR_LABEL = "Unresolved user";/);
  assert.ok(activitySource.includes("return actorName || UNRESOLVED_ACTOR_LABEL;"));
});

// 12. admin_manager does not directly query arbitrary profiles
test("12. team aggregation never queries the profiles table (admin_manager cannot resolve arbitrary profiles under RLS)", () => {
  const teamSummaryStart = activitySource.indexOf("async function teamSummaryAnswer");
  const teamQuotationStart = activitySource.indexOf("async function teamQuotationActivityAnswer");
  const teamRecentStart = activitySource.indexOf("async function teamRecentActivityAnswer");
  const teamRecentEnd = activitySource.indexOf("\n}\n", teamRecentStart);
  const teamSection = activitySource.slice(teamSummaryStart, teamRecentEnd);
  assert.ok(teamSummaryStart >= 0 && teamQuotationStart >= 0 && teamRecentStart >= 0);
  assert.ok(!teamSection.includes('.from("profiles")'));
});

// 13. System Owner may resolve target profiles.full_name
test("13. resolveTargetProfile selects only minimal profile columns (id, full_name) and is gated behind requireSystemOwner()", () => {
  assert.ok(activitySource.includes('.select("id,full_name")'));
  const resolveFnIndex = activitySource.indexOf("async function resolveTargetProfile");
  assert.ok(resolveFnIndex >= 0);
});

// 14. salesperson_id is not treated as activity
test("14. salesperson_id is never used as evidence of activity anywhere in this file", () => {
  assert.ok(!activitySource.includes("salesperson_id"));
});

// 15. distinct quotations counted by entity ID, not event count
test("15. team quotation activity counts distinct quotation entity ids per actor, not raw event counts", () => {
  assert.ok(activitySource.includes("Set<string>()"));
  assert.ok(activitySource.includes("quotationCount: ids.size"));
});

// 16. recorded-activity wording exists
test("16. team/other-user results use 'recorded' activity wording, not a completeness claim", () => {
  assert.ok(activitySource.includes("recorded quotation activity from"));
  assert.ok(!/\d users? definitely edited/i.test(activitySource));
});

// 17. no online/currently-working claims
test("17. no online/currently-working/at-work claim exists anywhere in this file", () => {
  assert.ok(!/\bonline now\b/i.test(activitySource));
  assert.ok(!/"[^"]*\byou are online\b[^"]*"/i.test(activitySource));
  assert.ok(!/"[^"]*\bcurrently at work\b[^"]*"/i.test(activitySource));
});

// 18. attendance limitation preserved
test("18. the UA-1A attendance limitation text and no-query behavior are unchanged", () => {
  assert.match(activitySource, /tracks recorded application activity, not verified attendance or working hours/);
  assert.ok(activitySource.includes('kind === "attendance_boundary"'));
});

// 19. team output capped
test("19. every team result path caps its output rows at MAX_TEAM_USER_ROWS", () => {
  const sliceCount = (activitySource.match(/\.slice\(0, MAX_TEAM_USER_ROWS\)/g) ?? []).length;
  assert.ok(sliceCount >= 2, "expected MAX_TEAM_USER_ROWS slicing in both team_summary and team_quotation_activity");
});

// 20. deterministicText exists
test("20. every UA-1B result path emits deterministicText", () => {
  const count = (activitySource.match(/deterministicText:/g) ?? []).length;
  assert.ok(count >= 10, "expected deterministicText across own (UA-1A) and team/other-user (UA-1B) result branches");
});

// 21. no separate provider/runtime framework added
test("21. no separate user_activity provider/runtime was added - the existing noa_orchestrator provider is reused", () => {
  assert.ok(!activitySource.includes("runAiProvider"));
  assert.ok(!activitySource.includes("runNoaProvider"));
  assert.ok(!activitySource.includes("resolveAiAgentRuntimeConfig"));
  assert.ok(!registrySource.includes('id: "user_activity"'));
});

test("UA-1A own-scope behavior is unchanged: attendance_boundary is reached via requireActiveUser(), not requireSettingsManager()", () => {
  const ownAuthIndex = activitySource.lastIndexOf("await requireActiveUser();");
  const attendanceIndex = activitySource.indexOf('kind === "attendance_boundary"');
  assert.ok(ownAuthIndex >= 0 && attendanceIndex >= 0 && ownAuthIndex < attendanceIndex);
});

test("named other-user resolution never guesses from a raw name without a profiles match, and disambiguates ambiguous matches", () => {
  assert.ok(activitySource.includes('kind: "not_found"'));
  assert.ok(activitySource.includes('kind: "ambiguous"'));
  assert.ok(activitySource.includes(".limit(2)"));
});

test("a normal active user asking a team/other-user question gets a safe unauthorized result, not a redirect or cross-user data", () => {
  assert.match(activitySource, /const TEAM_UNAUTHORIZED_RESULT: NoaCapabilityResult = {\s*\n\s*message: "I can only show your own recorded ProjectWorkflow activity with your current permissions\."/);
});

test("an admin_manager asking about a specific named user gets a graceful limitation, not the generic team-unauthorized message", () => {
  assert.match(activitySource, /const OTHER_USER_NAME_LIMITATION_RESULT: NoaCapabilityResult = {\s*\n\s*message: "I can access team activity summaries with your current permissions/);
});

test("confirmed-quotation team activity is explicitly left unsupported rather than silently ignoring the qualifier", () => {
  assert.ok(activitySource.includes("team_confirmed_quotation_unsupported"));
  assert.match(activitySource, /can't yet safely filter that to only confirmed quotations/);
});

test("no cross-capability chaining: User Activity capability never imports another NOA capability", () => {
  assert.ok(!activitySource.includes("noa-product-capability"));
  assert.ok(!activitySource.includes("noa-quotation-capability"));
  assert.ok(!activitySource.includes("noa-price-capability"));
  assert.ok(!activitySource.includes("noa-project-capability"));
  assert.ok(!activitySource.includes("noa-client-capability"));
  assert.ok(!activitySource.includes("noa-procurement-capability"));
});

test("audit_activity_log and profiles queries use fixed column selects, never select('*')", () => {
  assert.ok(!activitySource.includes('.select("*")'));
});
