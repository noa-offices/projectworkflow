/* eslint-disable @typescript-eslint/no-explicit-any -- Execute the real server action with isolated external dependencies. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function setup({ previous = "active", denied = false, authFailure = false, throws = false, configured = true, saveFailure = false } = {}) {
  const events: any[] = [];
  const saved: any[] = [];
  const dependencies: Record<string, any> = {
    "next/cache": { revalidatePath() {} },
    "next/navigation": { redirect(url: string) { throw new Error(decodeURIComponent(url)); } },
    "@/lib/action-errors": { formatSafeActionError: () => "Save failed", logServerActionError() {} },
    "@/lib/audit-log": { createAuditLog: async () => events.push("audit") },
    "@/lib/auth": { requireSystemOwner: async () => { if (denied) throw new Error("Forbidden"); return { user: { id: "owner" }, displayName: "Owner" }; } },
    "@/lib/user-management": { USER_ROLE_OPTIONS: ["system_owner", "viewer"], USER_STATUS_OPTIONS: ["active", "disabled", "pending"] },
    "@/lib/supabase/server": { createClient: async () => ({ from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { role: "viewer", account_status: previous } }) }) }),
      update: (value: any) => ({ eq: async (key: string, id: string) => { events.push("save"); if (!saveFailure) saved.push({ id, ...value }); return { error: saveFailure ? new Error("save") : null }; } }),
    }) }) },
    "@/lib/supabase/admin": { createAdminClient: () => ({ client: configured ? { auth: { admin: { updateUserById: async (id: string, attributes: any) => {
      events.push({ id, ...attributes });
      if (throws) throw new Error("secret-service-key");
      return { error: authFailure ? new Error("secret-service-key") : null };
    } } } } : null, error: configured ? null : "secret-service-key" }) },
  };
  const compiled = { exports: {} as any };
  const output = ts.transpileModule(readFileSync("app/settings/users/actions.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "module", "exports", output)((name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, compiled, compiled.exports);
  return { ...compiled.exports, events, saved };
}
function form(status: string, role = "viewer") {
  const data = new FormData(); data.set("role", role); data.set("account_status", status); return data;
}
for (const status of ["disabled", "pending"]) test(`${status} saves the profile before banning only the target user`, async () => {
  const action = setup();
  await assert.rejects(action.updateUserAccess("target", form(status)), /User access updated/);
  assert.deepEqual(action.events, ["save", { id: "target", ban_duration: "876000h" }, "audit"]);
  assert.equal(action.saved[0].account_status, status);
});
test("reactivation lifts the auth ban", async () => {
  const action = setup({ previous: "disabled" });
  await assert.rejects(action.updateUserAccess("target", form("active")), /User access updated/);
  assert.deepEqual(action.events[1], { id: "target", ban_duration: "none" });
});
for (const options of [{ authFailure: true }, { throws: true }, { configured: false }]) test(`auth failure preserves profile, audit and safe admin message ${JSON.stringify(options)}`, async () => {
  const action = setup(options);
  await assert.rejects(action.updateUserAccess("target", form("disabled")), (error: Error) => {
    assert.match(error.message, /Account disabled, but sign-out failed:/);
    assert.doesNotMatch(error.message, /secret-service-key/); return true;
  });
  assert.equal(action.saved[0].account_status, "disabled");
  assert.equal(action.events.at(-1), "audit");
});
test("cannot disable or pend your own account", async () => {
  for (const status of ["disabled", "pending"]) {
    const action = setup();
    await assert.rejects(action.updateUserAccess("owner", form(status, "system_owner")), /own account away from Active/);
    assert.deepEqual(action.events, []);
  }
});
test("non-owner is refused before any database or auth mutation", async () => {
  const action = setup({ denied: true });
  await assert.rejects(action.updateUserAccess("target", form("disabled")), /Forbidden/);
  assert.deepEqual(action.events, []);
});
test("profile save failure prevents the auth ban", async () => {
  const action = setup({ saveFailure: true });
  await assert.rejects(action.updateUserAccess("target", form("disabled")), /Save failed/);
  assert.deepEqual(action.events, ["save"]);
});
