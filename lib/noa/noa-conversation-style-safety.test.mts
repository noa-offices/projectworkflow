import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync("app/api/noa/chat/route.ts", "utf8");
const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const router = readFileSync("lib/noa/noa-intent-router.ts", "utf8");
const provider = readFileSync("lib/noa/noa-provider.server.ts", "utf8");

test("conversation styling keeps profile lookup optional, safe, and fully wired", () => {
  assert.ok(route.includes('.select("full_name")'));
  assert.ok(!/\.select\([^)]*(?:email|phone)/.test(route));
  assert.ok(route.includes('typeof profile?.full_name === "string"'));
  // Structural check (each field is its own key in the request object literal, now formatted one
  // per line with an added productConfigurationReference field) rather than pinning the old
  // single-line "displayName, message, recentMessages" formatting.
  const chatRequestStart = route.indexOf("const chatRequest: NoaChatRequest = {");
  const chatRequestEnd = route.indexOf("};", chatRequestStart);
  const chatRequestBody = route.slice(chatRequestStart, chatRequestEnd);
  for (const field of ["displayName", "message", "recentMessages"]) {
    assert.ok(new RegExp(`\\b${field}\\b`).test(chatRequestBody), field);
  }
  assert.ok(!route.includes("user.email"));
  assert.ok(orchestrator.includes("request.displayName"));
  assert.ok(provider.includes("userDisplayName: request.displayName ?? null"));
});

test("conversation routes are deterministic, concise, and capability-on-demand", () => {
  assert.ok(router.includes("GREETING_PATTERNS"));
  assert.ok(router.includes("CAPABILITY_HELP_PHRASES"));
  assert.ok(
    router.indexOf("if (GREETING_PATTERNS.some") <
      router.indexOf("if (includesAny(normalized, HELP_PHRASES))"),
  );
  assert.ok(router.includes('return { route: "greeting", rule: "greeting", strength: "exact" };')); // I3: classifyNoaRouteWithStrength branch
  assert.ok(router.includes('return { route: "capabilities", rule: "capabilities", strength: "exact" };')); // I3: classifyNoaRouteWithStrength branch
  assert.ok(router.includes("NOA_CAPABILITY_SUMMARY_TEXT"));
  const summary = router.match(/export const NOA_CAPABILITY_SUMMARY_TEXT\s*=\s*"([^"]+)"/)?.[1] ?? "";
  assert.ok(!/attendance/i.test(summary));
});

// Stale generic fallback removal -------------------------------------------------

test("the generic Help/out-of-scope fallback is a short clarification, not the old capability-listing intro", () => {
  assert.ok(!orchestrator.includes("I'm NOA, the ProjectWorkflow assistant. I can help with"));
  assert.match(orchestrator, /I couldn't match that to a ProjectWorkflow action\./);
});

// Deterministic provider-failure fallback ----------------------------------------

test("a capability's ok:true result still tries the provider first, and only falls back to deterministicText if the provider call throws", () => {
  const tryIndex = orchestrator.indexOf("try {");
  const runNoaProviderIndex = orchestrator.indexOf("await runNoaProvider(", tryIndex);
  const catchIndex = orchestrator.indexOf("} catch (error) {", runNoaProviderIndex);
  const deterministicFallbackIndex = orchestrator.indexOf("capabilityResult.data.deterministicText", catchIndex);
  assert.ok(tryIndex >= 0 && runNoaProviderIndex >= 0 && catchIndex >= 0 && deterministicFallbackIndex >= 0);
  assert.ok(tryIndex < runNoaProviderIndex && runNoaProviderIndex < catchIndex && catchIndex < deterministicFallbackIndex);
});

test("an ok:false capability result returns before the provider try block is ever reached - never treated as a provider-failure fallback candidate", () => {
  const notOkIndex = orchestrator.indexOf("if (!capabilityResult.ok)");
  const tryIndex = orchestrator.indexOf("try {");
  assert.ok(notOkIndex >= 0 && tryIndex >= 0 && notOkIndex < tryIndex);
});

test("provider failure with no deterministicText available still rethrows, preserving the existing unavailable/error response", () => {
  assert.match(orchestrator, /if \(deterministicText\) return \{[^}]*\};\s*\n\s*throw error;/);
});

test("who-is-currently-working stays factually accurate: recorded activity is distinguished from verified attendance/presence, with no 'online now'/'currently working' claim", () => {
  const activityCapability = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");
  assert.match(activityCapability, /not verified attendance or working hours/);
  assert.ok(!/\bonline now\b/i.test(activityCapability));
  assert.ok(!/"[^"]*\byou are online\b[^"]*"/i.test(activityCapability));
});

// ── Phase 3B: humanized deterministic response wording ─────────────────────────────────────────

test("16/20. quotation status count wording is grammatical (Oxford-comma join, proper status labels), never a raw persisted key", () => {
  const quotationCapability = readFileSync("lib/noa/noa-quotation-capability.server.ts", "utf8");
  assert.ok(quotationCapability.includes('if (key === "senttoclient") return "Sent to Client";')); // no more raw "sent_to_client" leak
  assert.ok(quotationCapability.includes("function joinNoaCountedList"));
  assert.ok(quotationCapability.includes("joinNoaCountedList(counts.map"));
  // Facts (counts) are still computed from the same authorized `counts`/`totalCount` data - only
  // the prose join changed, never dropped or recomputed here.
  assert.ok(quotationCapability.includes("totalCount"));
});

test("17. client-confirmed (and other single-status) list wording reads as a sentence, not '<n> <status>s:'", () => {
  const quotationCapability = readFileSync("lib/noa/noa-quotation-capability.server.ts", "utf8");
  assert.ok(quotationCapability.includes("function quotationStatusAdjective"));
  assert.ok(quotationCapability.includes('return "client-confirmed";'));
  assert.ok(quotationCapability.includes("These are the ${totalMatching} ${quotationStatusAdjective(statusIntent.statuses[0])} quotations:"));
  // The old mechanical "<n> <label>s:" pluralization (e.g. "2 client confirmeds:") is gone.
  assert.ok(!/\$\{sourceStatus\.trim\(\) \|\| "quotation"\}\$\{totalMatching === 1 \? "" : "s"\}/.test(quotationCapability));
});

test("18. Project list wording omits the redundant 'Showing N.' when nothing was truncated", () => {
  const projectCapability = readFileSync("lib/noa/noa-project-capability.server.ts", "utf8");
  assert.ok(projectCapability.includes("rows.length < filtered.length"));
  assert.ok(!projectCapability.includes("`I found ${filtered.length} ${label} Project File${filtered.length === 1 ? \"\" : \"s\"}.${countOnly ? \"\" : ` Showing ${rows.length}.`}`"));
});

test("19. the generic fallback names concrete supported topics instead of a vague 'not sure' phrase", () => {
  assert.match(orchestrator, /I couldn't match that to a ProjectWorkflow action\. You can ask about quotations, projects, products, prices, or recent activity\./);
});

test("social 'how are you' wording also covers a trailing 'today' by widening the existing bounded pattern, not a new regex list", () => {
  const prerouter = readFileSync("lib/noa/noa-conversation-prerouter.ts", "utf8");
  assert.ok(prerouter.includes("how are you(?: doing)?(?: today)?|hows it going(?: today)?"));
});

test("daily-status options are a single shared source of truth, never duplicated literal strings", () => {
  const prerouter = readFileSync("lib/noa/noa-conversation-prerouter.ts", "utf8");
  const shadowTurn = readFileSync("lib/noa/noa-shadow-turn.ts", "utf8");
  assert.ok(prerouter.includes("export const NOA_DAILY_STATUS_OPTIONS"));
  assert.ok(prerouter.includes("NOA_DAILY_STATUS_ORDER.map((action) => [NOA_DAILY_STATUS_OPTIONS[action].label, NOA_DAILY_STATUS_OPTIONS[action].value])"));
  assert.ok(shadowTurn.includes('import { NOA_DAILY_STATUS_OPTIONS, NOA_DAILY_STATUS_ORDER } from "./noa-conversation-prerouter";'));
  assert.ok(!shadowTurn.includes('"Attention items"')); // no re-declared literal option strings
});
