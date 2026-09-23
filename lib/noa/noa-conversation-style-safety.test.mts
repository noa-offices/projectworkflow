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
