/* eslint-disable @typescript-eslint/no-explicit-any -- Run the callback with mocked auth and real URL redirect resolution. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function compile(path: string, dependencies: Record<string, any>) {
  const compiled = { exports: {} as any };
  const output = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "module", "exports", output)((name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, compiled, compiled.exports);
  return compiled.exports;
}
const safeRedirect = compile("lib/auth-redirect.ts", {});
function callback(warehouse = false) {
  return compile("app/auth/callback/route.ts", {
    "next/server": { NextResponse: { redirect: (url: URL) => Response.redirect(url) } },
    "@/lib/auth": { isWarehouseStaffRequest: async () => warehouse },
    "@/lib/supabase/server": { createClient: async () => ({ auth: { exchangeCodeForSession: async () => ({ error: null }) } }) },
    "@/lib/auth-redirect": safeRedirect,
  });
}
for (const [input, expected] of [
  ["/products", "/products"], ["/", "/"], ["/a?b=1", "/a?b=1"],
  ["https://evil.site", "/"], ["//evil.site", "/"], ["/\\evil.site", "/"],
  ["javascript:alert(1)", "/"], ["%2F%2Fevil.site", "/"],
  ["/%5Cevil.site", "/"], ["/%2f%2fevil.site", "/"], ["/javascript:alert(1)", "/"],
  ["/%09/evil.site", "/"], ["/%ZZ", "/"],
] as const) test(`callback safely handles ${JSON.stringify(input)}`, async () => {
  const response = await callback().GET(new Request(`https://app.example/auth/callback?code=mock&next=${encodeURIComponent(input)}`));
  assert.equal(response.headers.get("location"), `https://app.example${expected}`);
});
test("warehouse routing and password reset destination remain intact", async () => {
  for (const [input, expected] of [["/products", "/inventory"], ["/reset-password", "/reset-password"]]) {
    const response = await callback(true).GET(new Request(`https://app.example/auth/callback?next=${encodeURIComponent(input)}`));
    assert.equal(response.headers.get("location"), `https://app.example${expected}`);
  }
});
