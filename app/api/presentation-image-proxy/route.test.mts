/* eslint-disable @typescript-eslint/no-explicit-any -- Isolate route dependencies and upstream fetch. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import test from "node:test";
import ts from "typescript";

function route(upstream: Response, warehouse = false) {
  const calls: any[] = [];
  const dependencies: Record<string, any> = {
    "node:net": { isIP },
    "@/lib/auth": { isWarehouseStaffRequest: async () => warehouse },
    "@/lib/supabase/server": { createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { account_status: "active" } }) }) }) }),
    }) },
  };
  const compiled = { exports: {} as any };
  const output = ts.transpileModule(readFileSync("app/api/presentation-image-proxy/route.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("require", "module", "exports", "fetch", output)((name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, compiled, compiled.exports, async (...args: any[]) => { calls.push(args); return upstream; });
  return { ...compiled.exports, calls };
}
function request(source = "https://noaoffices.com/logo.svg") { return new Request(`https://app.example/api/presentation-image-proxy?src=${encodeURIComponent(source)}`); }
test("SVG is served only with sandbox, attachment and nosniff headers", async () => {
  const handler = route(new Response("<svg/>", { headers: { "Content-Type": "image/svg+xml" } }));
  const response = await handler.GET(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.equal(response.headers.get("content-disposition"), "attachment");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});
test("upstream redirect to an outside host is never followed or relayed", async () => {
  const handler = route(new Response(null, { status: 302, headers: { Location: "https://evil.site/private" } }));
  const response = await handler.GET(request());
  assert.equal(handler.calls.length, 1);
  assert.equal(handler.calls[0][1].redirect, "manual");
  assert.ok(response.status >= 400);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});
test("nosniff covers validation errors, denied access and raster success", async () => {
  for (const [source, warehouse, type, status] of [
    ["https://evil.site/x", false, "image/png", 403],
    ["https://noaoffices.com/x", true, "image/png", 403],
    ["https://noaoffices.com/x", false, "text/html", 415],
    ["https://noaoffices.com/x", false, "image/png", 200],
  ] as const) {
    const response = await route(new Response("image", { headers: { "Content-Type": type } }), warehouse).GET(request(source));
    assert.equal(response.status, status);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  }
});
