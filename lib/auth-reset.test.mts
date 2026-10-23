import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";
import { activeUserRedirect } from "./auth-access";

// Match the existing runtime-module pattern in noa-realtime-voice.test.mts.
const require = createRequire(import.meta.url);
function compile(path: string, overrides: Record<string, unknown>) {
  const source = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const compiled = { exports: {} as Record<string, (...args: never[]) => unknown> };
  new Function("require", "module", "exports", "console", source)(
    (id: string) => overrides[id] ?? require(id), compiled, compiled.exports, { error() {} },
  );
  return compiled.exports;
}

function harness(role = "warehouse_staff", lookupError = false, signedIn = true) {
  const updates: unknown[] = [];
  const exchanged: string[] = [];
  let updateError = false;
  const client = {
    auth: {
      getUser: async () => ({ data: { user: signedIn ? { id: "reset-user" } : null } }),
      exchangeCodeForSession: async (code: string) => { exchanged.push(code); },
      updateUser: async (input: unknown) => { updates.push(input); return { error: updateError ? { message: "failed" } : null }; },
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({
      data: lookupError ? null : { role, account_status: "active" },
      error: lookupError ? { message: "lookup unavailable" } : null,
    }) }) }) }),
  };
  const redirect = (path: string): never => { throw new Error(`redirect:${path}`); };
  const shared = {
    "@/lib/supabase/server": { createClient: async () => client },
    "next/navigation": { redirect },
  };
  const auth = compile("lib/auth.ts", {
    ...shared,
    react: { cache: (fn: unknown) => fn },
    "@/lib/auth-access": { activeUserRedirect },
    "@/lib/projects/client-payment-attachment-permissions": {},
    "@/lib/products/brand-price-permissions": {},
  }) as unknown as { isWarehouseStaffRequest(): Promise<boolean>; redirectWarehouseStaff(): Promise<void> };
  const overrides = { ...shared, "@/lib/auth": auth };
  const callback = compile("app/auth/callback/route.ts", {
    ...overrides, "next/server": { NextResponse: { redirect: (url: URL) => Response.redirect(url) } },
  }) as unknown as { GET(request: Request): Promise<Response> };
  const actions = compile("app/auth/actions.ts", overrides) as unknown as { updatePassword(form: FormData): Promise<void> };
  const page = compile("app/reset-password/page.tsx", {
    ...overrides, "@/app/auth/actions": actions,
  }) as unknown as { default(props: object): Promise<unknown> };
  return { auth, callback, actions, page, updates, exchanged, failUpdate: () => { updateError = true; } };
}

test("callback preserves password-reset destinations for warehouse staff and redirects other destinations", async () => {
  for (const [role, next, expected] of [
    ["warehouse_staff", "/reset-password", "/reset-password"],
    ["warehouse_staff", "/reset-password?type=recovery", "/reset-password?type=recovery"],
    ["warehouse_staff", "/dashboard", "/inventory"],
    ["viewer", "/dashboard", "/dashboard"],
  ]) {
    const h = harness(role);
    const url = new URL("https://app.test/auth/callback");
    url.searchParams.set("code", "recovery-code");
    url.searchParams.set("next", next);
    const response = await h.callback.GET(new Request(url));
    assert.equal(response.headers.get("location"), `https://app.test${expected}`);
    assert.deepEqual(h.exchanged, ["recovery-code"]);
  }
});

test("warehouse staff can render the reset page and save a password before the inventory redirect", async () => {
  for (const role of ["warehouse_staff", "viewer"]) {
    const h = harness(role);
    assert.ok(await h.page.default({}));
    const form = new FormData();
    form.set("password", "new-password-123");
    form.set("confirmPassword", "new-password-123");
    await assert.rejects(h.actions.updatePassword(form), {
      message: role === "warehouse_staff" ? "redirect:/inventory" : "redirect:/dashboard?message=Password+updated+successfully",
    });
    assert.deepEqual(h.updates, [{ password: "new-password-123" }]);
  }
});

test("password validation and update failures keep warehouse staff on the reset flow", async () => {
  const h = harness();
  const form = new FormData();
  form.set("password", "new-password-123");
  form.set("confirmPassword", "different-password");
  await assert.rejects(h.actions.updatePassword(form), { message: "redirect:/reset-password?message=Passwords+do+not+match&type=error" });
  assert.deepEqual(h.updates, []);
  form.set("confirmPassword", "new-password-123");
  h.failUpdate();
  await assert.rejects(h.actions.updatePassword(form), { message: "redirect:/reset-password?message=Password+could+not+be+updated&type=error" });
});

test("role lookup fails closed for a signed-in user while anonymous requests remain unaffected", async () => {
  assert.equal(await harness("viewer", true).auth.isWarehouseStaffRequest(), true);
  assert.equal(await harness("viewer").auth.isWarehouseStaffRequest(), false);
  assert.equal(await harness("warehouse_staff").auth.isWarehouseStaffRequest(), true);
  assert.equal(await harness("viewer", true, false).auth.isWarehouseStaffRequest(), false);
});
