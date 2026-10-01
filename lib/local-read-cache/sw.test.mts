import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
const source = readFileSync("public/sw.js", "utf8");
function fixture(fail = false, online = true) {
  const handlers = new Map<string, (event: unknown) => void>();
  const stores = new Map<string, Map<string, Response>>();
  const key = (r: string | { url: string }) => typeof r === "string" ? r : r.url;
  const caches = {
    open: async (name: string) => {
      const records = stores.get(name) ?? new Map<string, Response>(); stores.set(name, records);
      return {
        addAll: async (paths: string[]) => paths.forEach(path => records.set(path, new Response("PUBLIC SHELL"))),
        match: async (request: string | { url: string }) => records.get(key(request)),
        put: async (request: string | { url: string }, response: Response) => { records.set(key(request), response); },
        keys: async () => [...records.keys()],
        delete: async (request: string | { url: string }) => records.delete(key(request)),
      };
    },
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (path: string) => [...stores.values()].map(cache => cache.get(path)).find(Boolean),
  };
  vm.runInNewContext(source, {
    URL, Response, Promise, caches,
    self: { navigator: { onLine: online }, location: { origin: "https://app.test" }, addEventListener: (name: string, fn: (event: unknown) => void) => handlers.set(name, fn), skipWaiting: async () => undefined, clients: { claim: async () => undefined } },
    fetch: async () => { if (fail) throw new TypeError("Offline"); const response = new Response("PRIVATE NETWORK RESPONSE"); Object.defineProperty(response, "type", { value: "basic" }); return response; },
  });
  async function lifecycle(name: string) {
    let promise: Promise<unknown> | undefined;
    handlers.get(name)!({ waitUntil: (p: Promise<unknown>) => { promise = p; } }); await promise;
  }
  async function request(path: string, options: { method?: string; mode?: string; headers?: Record<string, string> } = {}) {
    let promise: Promise<Response> | undefined;
    handlers.get("fetch")!({ request: { url: "https://app.test" + path, method: options.method ?? "GET", mode: options.mode ?? "cors", headers: new Headers(options.headers) },
      respondWith: (p: Promise<Response>) => { promise = p; } });
    return promise ? await promise : undefined;
  }
  return { stores, caches, lifecycle, request };
}
test("SW install stores only public recovery assets", async () => {
  const f = fixture(); await f.lifecycle("install");
  assert.deepEqual([...f.stores.get("projectworkflow-shell-v1")!.keys()], ["/offline.html", "/offline.js", "/offline.css"]);
});
test("POST/auth/API/RSC requests never enter service-worker cache path", async () => {
  const f = fixture(); await f.lifecycle("install");
  for (const [path, options] of [
    ["/products", { method: "POST" }], ["/auth/callback", {}], ["/api/local-read-cache/products", {}],
    ["/products?_rsc=private", {}], ["/products", { headers: { RSC: "1" } }],
  ] as const) assert.equal(await f.request(path, options), undefined);
});
test("successful authenticated HTML stays network-only and is never stored", async () => {
  const f = fixture(); await f.lifecycle("install");
  assert.equal(await (await f.request("/products", { mode: "navigate" }))?.text(), "PRIVATE NETWORK RESPONSE");
  assert.ok([...f.stores.values()].every(store => !store.has("https://app.test/products")));
});
test("offline navigation receives public recovery shell, not private HTML", async () => {
  const f = fixture(true); await f.lifecycle("install");
  assert.equal(await (await f.request("/products", { mode: "navigate" }))?.text(), "PUBLIC SHELL");
});

test("explicit browser offline navigation skips a still-reachable worker network", async () => {
  const f = fixture(false, false); await f.lifecycle("install");
  assert.equal(await (await f.request("/products", { mode: "navigate" }))?.text(), "PUBLIC SHELL");
});
test("version cleanup touches only owned shell/static caches", async () => {
  const f = fixture(); await f.caches.open("projectworkflow-shell-v0"); await f.caches.open("other-app");
  await f.lifecycle("activate");
  assert.equal(f.stores.has("projectworkflow-shell-v0"), false); assert.equal(f.stores.has("other-app"), true);
});
test("immutable build assets are capped and uploads/images are excluded", async () => {
  const f = fixture();
  for (let i = 0; i < 85; i++) await f.request("/_next/static/chunks/" + i.toString(16).padStart(12, "0") + ".js");
  assert.equal(f.stores.get("projectworkflow-static-v1")?.size, 80);
  assert.equal(await f.request("/uploads/private.png"), undefined);
});
test("recovery script has no draft mutations, authorizes access hints, and exports original JSON", () => {
  const script = readFileSync("public/offline.js", "utf8");
  assert.match(script, /userId === lease.userId/);
  assert.match(script, /generation !== lease.generation/);
  assert.match(script, /transaction\(store, "readonly"\)/);
  assert.match(script, /JSON.stringify\(draft, null, 2\)/);
  assert.match(script, /publish.disabled = true/);
  assert.ok(!script.includes("saveWorkspaceDocument")); assert.ok(!script.includes("quotationWorkspaces.clear"));
});
test("cache-first navigation instruments reads and waits for authoritative API without queued writes", () => {
  const script = readFileSync("components/local-read-cache/local-read-runtime.tsx", "utf8");
  assert.match(script, /void openPreview\(entity\)/);
  assert.match(script, /pw:cache-read:/); assert.match(script, /pw:first-usable-read:/); assert.match(script, /pw:read-refresh:/);
  assert.match(script, /router.push/); assert.match(script, /No server writes are queued/);
});
