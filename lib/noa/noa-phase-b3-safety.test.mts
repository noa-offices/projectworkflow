import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const capability = readFileSync("lib/noa/noa-project-capability.server.ts", "utf8");
const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");

test("B3 Project capability preserves authorization, read-only access, bounds, and safe fields", () => {
  const authIndex = capability.indexOf("await requireActiveUser();");
  const clientIndex = capability.indexOf("await createClient();");
  assert.ok(authIndex >= 0 && clientIndex > authIndex);
  assert.ok(capability.includes('from "@/lib/supabase/server"'));
  assert.ok(!capability.includes("createAdminClient"));
  assert.ok(!/\.(insert|update|delete|upsert)\(/.test(capability));
  assert.ok(capability.includes('["active", "on_hold", "completed", "cancelled"]'));
  assert.ok(capability.includes('.eq("is_active", !archived)'));
  assert.ok(capability.includes('query.eq("project_status", requestedStatus)'));
  assert.ok(capability.includes("MAX_PROJECT_ROWS = 20"));
  assert.ok(capability.includes("MAX_PROJECT_ORDER_ROWS = 20"));
  assert.ok(capability.includes("deterministicText"));
  assert.ok(!/attention_mobile|attention_landline|attention_email|project_address|po_box/.test(capability));
});

test("B3 Project Orders preserve the proven app rules and helper precedence", () => {
  assert.ok(capability.includes("settings?.projectCompletedAt"));
  assert.ok(capability.includes("settings?.projectCancelledAt"));
  assert.ok(capability.includes("completed ? !completedAt : completedAt || cancelledAt"));
  assert.ok(capability.indexOf("projectFileFromLayoutSettings") < capability.indexOf("clientApprovalDraftFromLayoutSettings(quotation.layout_settings)?.confirmedOrder"));
});

test("B3 orchestrator dispatches Project and blocks failed capabilities before provider use", () => {
  assert.ok(orchestrator.includes("fetchNoaProjectCapability"));
  assert.ok(orchestrator.includes('domain === "Project"'));
  assert.ok(orchestrator.indexOf("if (!capabilityResult.ok)") < orchestrator.indexOf("await runNoaProvider"));
});
