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
  assert.ok(route.includes("displayName, message, recentMessages"));
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
  assert.ok(router.includes('return "greeting"'));
  assert.ok(router.includes('return "capabilities"'));
  assert.ok(router.includes("NOA_CAPABILITY_SUMMARY_TEXT"));
  const summary = router.match(/export const NOA_CAPABILITY_SUMMARY_TEXT\s*=\s*"([^"]+)"/)?.[1] ?? "";
  assert.ok(!/attendance/i.test(summary));
});

// Stale generic fallback removal -------------------------------------------------

test("the generic Help/out-of-scope fallback is a short clarification, not the old capability-listing intro", () => {
  assert.ok(!orchestrator.includes("I'm NOA, the ProjectWorkflow assistant. I can help with"));
  assert.match(orchestrator, /I'm not sure what you'd like me to check\./);
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
